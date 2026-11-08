// Inventory and bookings: the "never overbook" part.
//
// The website can only sell the allotment the reservations team sets per room type per night.
// A booking first takes a HOLD (10 minutes) and becomes SOLD when the test payment succeeds.
//
// The hold is one conditional UPDATE over every night of the stay:
//     ... SET held = held + n WHERE <each night> AND NOT closed AND allotment - sold - held >= n
// Postgres locks each row and re-checks the WHERE clause after any concurrent writer commits,
// so two guests can never both take the last room. If fewer rows come back than there are nights,
// at least one night was full and the whole transaction rolls back.
// A CHECK constraint (sold + held <= allotment) backs this up at the database level.

const crypto = require("crypto");
const { pool, withTransaction } = require("../db/pool");
const config = require("../config");
const { priceStay, checkOccupancy } = require("./pricing");
const { badRequest, notFound, conflict, HttpError } = require("../lib/errors");
const { diffDays, nightsBetween } = require("../lib/dates");

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function makeRef(prefix = "KH") {
  const bytes = crypto.randomBytes(6);
  let s = "";
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `${prefix}-${s}`;
}

// Release every hold whose 10 minutes are up. Safe to run concurrently: the first UPDATE on
// bookings locks each row, so a second caller sees status <> 'held' and releases nothing twice.
async function releaseExpiredHolds(db = pool) {
  const { rows } = await db.query(`
    WITH expired AS (
      UPDATE bookings SET status = 'expired'
      WHERE status = 'held' AND hold_expires_at < now()
      RETURNING id, room_type_id, check_in, check_out, rooms
    ), nights AS (
      SELECT e.room_type_id, d::date AS stay_date, SUM(e.rooms)::int AS rooms
      FROM expired e, generate_series(e.check_in, e.check_out - 1, interval '1 day') d
      GROUP BY 1, 2
    ), released AS (
      UPDATE inventory i SET held = i.held - n.rooms, updated_at = now()
      FROM nights n
      WHERE i.room_type_id = n.room_type_id AND i.stay_date = n.stay_date
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM expired)::int AS bookings`);
  return rows[0].bookings;
}

async function getRoomType(db, slug) {
  const { rows } = await db.query("SELECT * FROM room_types WHERE slug = $1", [slug]);
  if (!rows[0]) throw notFound("Room type");
  return rows[0];
}

async function getPlan(db, code) {
  const { rows } = await db.query("SELECT * FROM rate_plans WHERE code = $1", [code]);
  if (!rows[0]) throw notFound("Rate plan");
  return rows[0];
}

async function listPlans(db = pool) {
  const { rows } = await db.query("SELECT * FROM rate_plans ORDER BY sort");
  return rows;
}

// Returns the promo row or throws a 400 that says exactly why it can't be used.
async function loadPromo(db, code, { checkIn, nights }) {
  if (!code) return null;
  const { rows } = await db.query("SELECT * FROM promo_codes WHERE upper(code) = upper($1)", [code]);
  const p = rows[0];
  if (!p || !p.active) throw badRequest("That promo code isn't valid.");
  if (checkIn < p.valid_from || checkIn > p.valid_to) throw badRequest(`${p.code} is valid for check-ins from ${p.valid_from} to ${p.valid_to}.`);
  if (nights < p.min_nights) throw badRequest(`${p.code} needs a stay of at least ${p.min_nights} nights.`);
  if (p.max_uses != null && p.used >= p.max_uses) throw badRequest(`${p.code} has been fully used.`);
  return p;
}

/** Availability and prices for every room type for one stay. */
async function searchAvailability({ checkIn, checkOut, adults, children, rooms }) {
  await releaseExpiredHolds();
  const nights = diffDays(checkIn, checkOut);
  const [{ rows }, plans] = await Promise.all([
    pool.query(
      `SELECT rt.*,
              COUNT(i.stay_date)::int AS nights_found,
              COALESCE(MIN(i.allotment - i.sold - i.held), 0)::int AS min_free,
              COALESCE(BOOL_OR(i.closed), false) AS any_closed,
              COALESCE(json_agg(json_build_object('date', i.stay_date, 'ratePaise', i.rate_paise) ORDER BY i.stay_date)
                       FILTER (WHERE i.stay_date IS NOT NULL), '[]') AS nights
       FROM room_types rt
       LEFT JOIN inventory i ON i.room_type_id = rt.id AND i.stay_date >= $1 AND i.stay_date < $2
       GROUP BY rt.id ORDER BY rt.sort`,
      [checkIn, checkOut]
    ),
    listPlans(),
  ]);

  return rows.map((rt) => {
    const base = publicRoomType(rt);
    let status = "available";
    if (rt.nights_found < nights) status = "not_on_sale";
    else if (rt.any_closed) status = "closed";
    else if (rt.min_free < rooms) status = "sold_out";
    const occupancyProblem = checkOccupancy(rt, { adults, children, rooms });
    if (status === "available" && occupancyProblem) status = "too_many_guests";

    const result = { ...base, status, unitsLeft: Math.max(0, rt.min_free), message: statusMessage(status, rt, occupancyProblem) };
    if (status === "available") {
      result.plans = plans.map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        refundable: plan.refundable,
        price: priceStay({ nights: rt.nights, roomType: rt, plan, adults, children, rooms }),
      }));
      result.fromTotalPaise = Math.min(...result.plans.map((p) => p.price.totalPaise));
    }
    return result;
  });
}

function statusMessage(status, rt, occupancyProblem) {
  switch (status) {
    case "sold_out": return rt.min_free > 0 ? `Only ${rt.min_free} left online for these dates.` : "Sold out online for these dates.";
    case "closed": return "Not available on one or more of these dates.";
    case "not_on_sale": return "These dates aren't open for online booking yet.";
    case "too_many_guests": return occupancyProblem;
    default: return null;
  }
}

/** Night-by-night calendar for one room type (room page). */
async function roomCalendar(slug, from, days) {
  await releaseExpiredHolds();
  const rt = await getRoomType(pool, slug);
  const { rows } = await pool.query(
    `SELECT stay_date AS date, rate_paise AS "ratePaise", closed, GREATEST(allotment - sold - held, 0) AS free
     FROM inventory WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < ($2::date + $3::int) ORDER BY stay_date`,
    [rt.id, from, days]
  );
  return rows.map((r) => ({ date: r.date, ratePaise: r.ratePaise, available: !r.closed && r.free > 0, free: r.closed ? 0 : r.free }));
}

/** Price a stay without holding anything (used to show a promo before booking). */
async function quote(input) {
  const rt = await getRoomType(pool, input.roomType);
  const plan = await getPlan(pool, input.plan);
  const nights = diffDays(input.checkIn, input.checkOut);
  const promo = await loadPromo(pool, input.promoCode, { checkIn: input.checkIn, nights });
  const { rows } = await pool.query(
    `SELECT stay_date AS date, rate_paise AS "ratePaise", closed, allotment - sold - held AS free
     FROM inventory WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3 ORDER BY stay_date`,
    [rt.id, input.checkIn, input.checkOut]
  );
  const available = rows.length === nights && rows.every((r) => !r.closed && r.free >= input.rooms);
  const price = priceStay({ nights: rows, roomType: rt, plan, adults: input.adults, children: input.children, rooms: input.rooms, promo });
  return { roomType: publicRoomType(rt), available, price };
}

const isRetryable = (err) => err.code === "40P01" || err.code === "40001"; // deadlock / serialization

async function createHold(user, input) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await createHoldOnce(user, input);
    } catch (err) {
      if (isRetryable(err) && attempt < 3) continue;
      if (isRetryable(err)) throw conflict("Lots of people are booking right now — please try again.");
      throw err;
    }
  }
}

async function createHoldOnce(user, input) {
  return withTransaction(async (db) => {
    await releaseExpiredHolds(db);
    const rt = await getRoomType(db, input.roomType);
    const plan = await getPlan(db, input.plan);
    const nights = diffDays(input.checkIn, input.checkOut);
    const occupancyProblem = checkOccupancy(rt, input);
    if (occupancyProblem) throw badRequest(occupancyProblem);
    const promo = await loadPromo(db, input.promoCode, { checkIn: input.checkIn, nights });

    const { rows } = await db.query(
      `UPDATE inventory SET held = held + $4, updated_at = now()
       WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3
         AND NOT closed AND allotment - sold - held >= $4
       RETURNING stay_date AS date, rate_paise AS "ratePaise"`,
      [rt.id, input.checkIn, input.checkOut, input.rooms]
    );
    if (rows.length !== nights) {
      throw conflict(`Sorry — ${rt.name} just sold out online for one or more of those nights. Please try other dates or another room.`);
    }
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    const price = priceStay({ nights: rows, roomType: rt, plan, adults: input.adults, children: input.children, rooms: input.rooms, promo });

    const { rows: [booking] } = await db.query(
      `INSERT INTO bookings (ref, user_id, room_type_id, rate_plan_id, check_in, check_out, nights, rooms, adults, children,
                             guest_name, guest_email, guest_phone, special_requests, promo_code, price, total_paise,
                             status, hold_expires_at, consent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'held', now() + make_interval(mins => $18), now())
       RETURNING *`,
      [makeRef(), user.id, rt.id, plan.id, input.checkIn, input.checkOut, nights, input.rooms, input.adults, input.children,
       input.guestName, input.guestEmail, input.guestPhone, input.specialRequests, promo ? promo.code : null,
       price, price.totalPaise, config.holdMinutes]
    );
    return { ...booking, room_type_name: rt.name, room_type_slug: rt.slug, plan_name: plan.name };
  });
}

// Test card numbers (documented in deployment.md). Card details are never stored.
const DECLINED_CARD = "4000000000000002";
function luhnOk(num) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

async function confirmPayment(user, ref, card) {
  const number = card.cardNumber.replace(/\D/g, "");
  if (!luhnOk(number)) throw badRequest("That card number doesn't look right.");

  const outcome = await withTransaction(async (db) => {
    const { rows: [b] } = await db.query("SELECT * FROM bookings WHERE ref = $1 FOR UPDATE", [ref]);
    if (!b || b.user_id !== user.id) throw notFound("Booking");
    if (b.status === "confirmed") return { booking: b };
    if (b.status !== "held") return { gone: b.status };

    const { rows: [{ expired }] } = await db.query("SELECT $1::timestamptz <= now() AS expired", [b.hold_expires_at]);
    if (expired) {
      await releaseBookingUnits(db, b, "held");
      await db.query("UPDATE bookings SET status = 'expired' WHERE id = $1", [b.id]);
      return { gone: "expired" };
    }
    if (number === DECLINED_CARD) {
      throw new HttpError(402, "Your bank declined this test card. Your rooms are still held — try another card.");
    }

    const moved = await db.query(
      `UPDATE inventory SET held = held - $4, sold = sold + $4, updated_at = now()
       WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3`,
      [b.room_type_id, b.check_in, b.check_out, b.rooms]
    );
    if (moved.rowCount !== b.nights) throw new Error(`Inventory mismatch confirming ${b.ref}`);
    if (b.promo_code) await db.query("UPDATE promo_codes SET used = used + 1 WHERE code = $1", [b.promo_code]);
    const { rows: [confirmed] } = await db.query(
      `UPDATE bookings SET status = 'confirmed', confirmed_at = now(), hold_expires_at = NULL, payment_ref = $2
       WHERE id = $1 RETURNING *`,
      [b.id, `pay_test_${crypto.randomBytes(6).toString("hex")}`]
    );
    return { booking: confirmed };
  });

  if (outcome.gone === "expired") throw conflict("Your 10-minute hold ran out and the rooms were released. Please search again — nothing was charged.");
  if (outcome.gone) throw conflict(`This booking is ${outcome.gone}.`);
  return outcome.booking;
}

async function releaseBookingUnits(db, b, column) {
  await db.query(
    `UPDATE inventory SET ${column === "sold" ? "sold = sold" : "held = held"} - $4, updated_at = now()
     WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3`,
    [b.room_type_id, b.check_in, b.check_out, b.rooms]
  );
}

/** Guests can drop their own hold; staff can cancel a confirmed booking (refunds are out of scope). */
async function cancelBooking(user, ref, { asStaff = false } = {}) {
  return withTransaction(async (db) => {
    const { rows: [b] } = await db.query("SELECT * FROM bookings WHERE ref = $1 FOR UPDATE", [ref]);
    if (!b || (!asStaff && b.user_id !== user.id)) throw notFound("Booking");
    if (b.status === "held") await releaseBookingUnits(db, b, "held");
    else if (b.status === "confirmed" && asStaff) await releaseBookingUnits(db, b, "sold");
    else if (b.status === "confirmed") throw badRequest("Please contact reservations to cancel a confirmed booking.");
    else throw conflict(`This booking is already ${b.status}.`);
    const { rows: [updated] } = await db.query("UPDATE bookings SET status = 'cancelled', hold_expires_at = NULL WHERE id = $1 RETURNING *", [b.id]);
    return updated;
  });
}

const BOOKING_SELECT = `
  SELECT b.*, rt.name AS room_type_name, rt.slug AS room_type_slug, rt.photos->>0 AS photo, rp.name AS plan_name, rp.code AS plan_code,
         rp.refundable
  FROM bookings b JOIN room_types rt ON rt.id = b.room_type_id JOIN rate_plans rp ON rp.id = b.rate_plan_id`;

async function getBookingForUser(user, ref) {
  const { rows } = await pool.query(`${BOOKING_SELECT} WHERE b.ref = $1`, [ref]);
  const b = rows[0];
  const isStaff = user.role === "staff" || user.role === "gm";
  if (!b || (!isStaff && b.user_id !== user.id)) throw notFound("Booking");
  return b;
}

async function listBookingsForUser(user) {
  await releaseExpiredHolds();
  const { rows } = await pool.query(`${BOOKING_SELECT} WHERE b.user_id = $1 AND b.status <> 'expired' ORDER BY b.created_at DESC`, [user.id]);
  return rows;
}

function publicRoomType(rt) {
  return {
    id: rt.id, slug: rt.slug, name: rt.name, kind: rt.kind, summary: rt.summary, description: rt.description,
    sizeSqft: rt.size_sqft, bed: rt.bed, view: rt.view, maxAdults: rt.max_adults, maxChildren: rt.max_children,
    baseOccupancy: rt.base_occupancy, extraAdultPaise: rt.extra_adult_paise, amenities: rt.amenities, photos: rt.photos,
  };
}

function publicBooking(b) {
  return {
    ref: b.ref, status: b.status, roomType: { name: b.room_type_name, slug: b.room_type_slug, photo: b.photo },
    plan: { name: b.plan_name, code: b.plan_code, refundable: b.refundable }, checkIn: b.check_in, checkOut: b.check_out,
    nights: b.nights, rooms: b.rooms, adults: b.adults, children: b.children, guestName: b.guest_name,
    guestEmail: b.guest_email, guestPhone: b.guest_phone, specialRequests: b.special_requests, promoCode: b.promo_code,
    price: b.price, totalPaise: b.total_paise, holdExpiresAt: b.hold_expires_at, paymentRef: b.payment_ref,
    createdAt: b.created_at, confirmedAt: b.confirmed_at,
  };
}

module.exports = {
  releaseExpiredHolds, searchAvailability, roomCalendar, quote, createHold, confirmPayment, cancelBooking,
  getBookingForUser, listBookingsForUser, listPlans, getRoomType, getPlan, loadPromo, publicRoomType, publicBooking,
  BOOKING_SELECT, makeRef, nightsBetween,
};
