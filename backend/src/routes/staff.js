// Reservations staff and GM. Every route here requires a staff or GM session.
const express = require("express");
const { pool, withTransaction } = require("../db/pool");
const { z, isoDate } = require("../lib/validate");
const { requireStaff, requireGm } = require("../middleware/auth");
const inventory = require("../services/inventory");
const enquiries = require("../router/enquiries");
const { todayIST, addDays, diffDays, nightsBetween } = require("../lib/dates");
const { badRequest, conflict } = require("../lib/errors");

const router = express.Router();
router.use(requireStaff);

// ---------- rates, allotment and blackout dates ----------

const gridQuery = z.object({ from: isoDate.optional(), days: z.coerce.number().int().min(1).max(31).default(14) });

router.get("/inventory", async (req, res) => {
  await inventory.releaseExpiredHolds();
  const q = gridQuery.parse(req.query);
  const from = q.from || todayIST();
  const [{ rows: roomTypes }, { rows }] = await Promise.all([
    pool.query("SELECT id, slug, name, kind, total_units FROM room_types ORDER BY sort"),
    pool.query(
      `SELECT room_type_id, stay_date, allotment, sold, held, rate_paise, closed FROM inventory
       WHERE stay_date >= $1 AND stay_date < ($1::date + $2::int) ORDER BY stay_date`,
      [from, q.days]
    ),
  ]);
  const dates = nightsBetween(from, addDays(from, q.days));
  const byKey = new Map(rows.map((r) => [`${r.room_type_id}|${r.stay_date}`, r]));
  res.json({
    from, dates,
    roomTypes: roomTypes.map((rt) => ({
      id: rt.id, slug: rt.slug, name: rt.name, kind: rt.kind, totalUnits: rt.total_units,
      cells: dates.map((d) => {
        const c = byKey.get(`${rt.id}|${d}`);
        return c
          ? { date: d, allotment: c.allotment, sold: c.sold, held: c.held, free: c.allotment - c.sold - c.held, ratePaise: c.rate_paise, closed: c.closed }
          : { date: d, missing: true };
      }),
    })),
  });
});

const bulkSchema = z.object({
  roomTypeIds: z.array(z.number().int().positive()).min(1).max(10),
  from: isoDate,
  to: isoDate,                                          // inclusive
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(), // 0 = Sunday
  allotment: z.number().int().min(0).max(100).optional(),
  ratePaise: z.number().int().min(100000).max(20000000).optional(), // ₹1,000 – ₹2,00,000
  closed: z.boolean().optional(),
}).refine((b) => b.allotment !== undefined || b.ratePaise !== undefined || b.closed !== undefined, { message: "choose something to change" })
  .refine((b) => b.to >= b.from, { message: "end date must be on or after start date", path: ["to"] })
  .refine((b) => diffDays(b.from, b.to) <= 370, { message: "pick a range of a year or less", path: ["to"] });

// All-or-nothing: if any night would drop below what is already sold or held, nothing changes.
router.put("/inventory", async (req, res) => {
  const b = bulkSchema.parse(req.body);
  if (b.from < todayIST()) throw badRequest("from: past dates can't be changed");
  const result = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT i.room_type_id, i.stay_date, i.allotment, i.sold, i.held, rt.name, rt.total_units
       FROM inventory i JOIN room_types rt ON rt.id = i.room_type_id
       WHERE i.room_type_id = ANY($1) AND i.stay_date BETWEEN $2 AND $3
       ORDER BY i.room_type_id, i.stay_date FOR UPDATE OF i`,
      [b.roomTypeIds, b.from, b.to]
    );
    const targets = rows.filter((r) => !b.weekdays || b.weekdays.includes(new Date(`${r.stay_date}T00:00:00Z`).getUTCDay()));
    if (!targets.length) throw badRequest("No open nights match that selection.");
    if (b.allotment !== undefined) {
      const overPhysical = targets.find((r) => b.allotment > r.total_units);
      if (overPhysical) throw badRequest(`${overPhysical.name} has only ${overPhysical.total_units} units in total.`);
      const clashes = targets.filter((r) => b.allotment < r.sold + r.held);
      if (clashes.length) {
        throw conflict(
          `Can't set allotment to ${b.allotment}: ${clashes.length} night(s) already have more booked or held online.`,
          clashes.slice(0, 20).map((r) => ({ roomType: r.name, date: r.stay_date, sold: r.sold, held: r.held }))
        );
      }
    }
    const { rowCount } = await db.query(
      `UPDATE inventory i SET allotment = COALESCE($3, i.allotment), rate_paise = COALESCE($4, i.rate_paise),
              closed = COALESCE($5, i.closed), updated_at = now()
       FROM unnest($1::int[], $2::date[]) AS t(room_type_id, stay_date)
       WHERE i.room_type_id = t.room_type_id AND i.stay_date = t.stay_date`,
      [targets.map((r) => r.room_type_id), targets.map((r) => r.stay_date), b.allotment ?? null, b.ratePaise ?? null, b.closed ?? null]
    );
    return rowCount;
  });
  res.json({ updated: result });
});

// ---------- promo codes ----------

router.get("/promos", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM promo_codes ORDER BY active DESC, valid_to DESC, code");
  res.json({ promos: rows });
});

const promoSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, "use 4–20 letters or digits"),
  description: z.string().trim().max(200).default(""),
  discountPct: z.number().min(1).max(50),
  minNights: z.number().int().min(1).max(14).default(1),
  validFrom: isoDate,
  validTo: isoDate,
  maxUses: z.number().int().min(1).max(100000).nullable().optional(),
}).refine((p) => p.validTo >= p.validFrom, { message: "must be on or after the start date", path: ["validTo"] });

router.post("/promos", async (req, res) => {
  const p = promoSchema.parse(req.body);
  try {
    const { rows: [promo] } = await pool.query(
      `INSERT INTO promo_codes (code, description, discount_pct, min_nights, valid_from, valid_to, max_uses)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [p.code, p.description, p.discountPct, p.minNights, p.validFrom, p.validTo, p.maxUses ?? null]
    );
    res.status(201).json({ promo });
  } catch (err) {
    if (err.code === "23505") throw conflict("A promo code with that name already exists.");
    throw err;
  }
});

router.patch("/promos/:id", async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const { rows: [promo] } = await pool.query("UPDATE promo_codes SET active = $2 WHERE id = $1 RETURNING *", [Number(req.params.id) || 0, active]);
  if (!promo) throw badRequest("Promo code not found.");
  res.json({ promo });
});

// ---------- bookings and the daily export ----------

const bookingsQuery = z.object({
  date: isoDate.optional(),
  by: z.enum(["created", "arrival", "staying"]).default("created"),
  status: z.enum(["all", "confirmed", "held", "cancelled", "expired"]).default("all"),
  q: z.string().trim().max(60).optional(),
});

async function findBookings({ date, by, status, q }) {
  const where = [];
  const params = [];
  if (date) {
    params.push(date);
    if (by === "created") where.push(`(b.created_at AT TIME ZONE 'Asia/Kolkata')::date = $${params.length}`);
    if (by === "arrival") where.push(`b.check_in = $${params.length}`);
    if (by === "staying") where.push(`b.check_in <= $${params.length} AND b.check_out > $${params.length}`);
  }
  if (status !== "all") { params.push(status); where.push(`b.status = $${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(b.ref ILIKE $${params.length} OR b.guest_name ILIKE $${params.length} OR b.guest_email ILIKE $${params.length})`); }
  const { rows } = await pool.query(
    `${inventory.BOOKING_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY b.created_at DESC LIMIT 500`,
    params
  );
  return rows;
}

router.get("/bookings", async (req, res) => {
  await inventory.releaseExpiredHolds();
  const rows = await findBookings(bookingsQuery.parse(req.query));
  res.json({ bookings: rows.map(inventory.publicBooking) });
});

// Spreadsheet-safe CSV: quote every field and neutralise formula injection (=, +, -, @).
function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

router.get("/bookings/export.csv", async (req, res) => {
  const q = bookingsQuery.parse({ by: "created", ...req.query, date: req.query.date || todayIST() });
  const rows = await findBookings(q);
  const header = ["Booking ref", "Status", "Booked at (IST)", "Guest", "Email", "Phone", "Room type", "Rate plan", "Check-in", "Check-out",
    "Nights", "Rooms", "Adults", "Children", "Promo", "Taxable (INR)", "GST (INR)", "Total (INR)", "Payment ref", "Special requests"];
  const fmtIST = (d) => new Date(new Date(d).getTime() + 5.5 * 3600000).toISOString().replace("T", " ").slice(0, 16);
  const lines = rows.map((b) => [
    b.ref, b.status, fmtIST(b.created_at), b.guest_name, b.guest_email, b.guest_phone, b.room_type_name, b.plan_name, b.check_in, b.check_out,
    b.nights, b.rooms, b.adults, b.children, b.promo_code, (b.price.taxablePaise / 100).toFixed(2), (b.price.taxPaise / 100).toFixed(2),
    (b.total_paise / 100).toFixed(2), b.payment_ref, b.special_requests,
  ].map(csvCell).join(","));
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="kaapi-hills-bookings-${q.by}-${q.date}.csv"`);
  res.send(`﻿${[header.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`);
});

router.post("/bookings/:ref/cancel", async (req, res) => {
  await inventory.cancelBooking(req.user, req.params.ref, { asStaff: true });
  res.json({ booking: inventory.publicBooking(await inventory.getBookingForUser(req.user, req.params.ref)) });
});

// ---------- enquiry inbox ----------

router.get("/staff-users", async (req, res) => {
  const { rows } = await pool.query("SELECT id, name, role, team FROM users WHERE role IN ('staff', 'gm') ORDER BY role DESC, team, name");
  res.json({ users: rows });
});

const listQuery = z.object({
  lane: z.enum(["all", "routed", "unsorted", "mine", "complaints"]).default("all"),
  status: z.enum(["open", "all", "replied", "closed"]).default("open"),
  category: z.enum(["room_booking", "wedding", "corporate_offsite", "complaint", "other"]).optional(),
  q: z.string().trim().max(80).optional(),
});

router.get("/enquiries", async (req, res) => {
  res.json(await enquiries.listEnquiries(req.user, listQuery.parse(req.query)));
});

router.get("/enquiries/:ref", async (req, res) => res.json({ enquiry: await enquiries.getEnquiry(req.params.ref) }));

const routeSchema = z.object({
  category: z.enum(["room_booking", "wedding", "corporate_offsite", "complaint", "other"]),
  ownerId: z.number().int().positive().nullable().optional(),
});
router.post("/enquiries/:ref/route", async (req, res) => {
  res.json({ enquiry: await enquiries.routeEnquiry(req.user, req.params.ref, routeSchema.parse(req.body)) });
});

router.put("/enquiries/:ref/draft", async (req, res) => {
  const { draft } = z.object({ draft: z.string().max(5000) }).parse(req.body);
  res.json({ enquiry: await enquiries.saveDraft(req.user, req.params.ref, draft) });
});

router.post("/enquiries/:ref/send", async (req, res) => {
  const { body } = z.object({ body: z.string().trim().min(10, "the reply is too short").max(5000) }).parse(req.body);
  res.json({ enquiry: await enquiries.sendReply(req.user, req.params.ref, body) });
});

router.post("/enquiries/:ref/close", async (req, res) => res.json({ enquiry: await enquiries.closeEnquiry(req.user, req.params.ref) }));
router.post("/enquiries/:ref/reprocess", async (req, res) => res.json({ enquiry: await enquiries.reprocess(req.user, req.params.ref) }));

// Simulated inbound channels: a forwarded email or a WhatsApp message lands in the same inbox.
const inboundSchema = z.object({
  channel: z.enum(["email", "whatsapp"]),
  name: z.string().trim().min(2).max(80),
  contact: z.string().trim().min(5).max(120),
  message: z.string().trim().min(5).max(2000),
});
router.post("/inbound", async (req, res) => {
  const body = inboundSchema.parse(req.body);
  const enq = await enquiries.createEnquiry(body);
  await enquiries.processEnquiry(enq.id); // staff are waiting on screen, so process now
  res.status(201).json({ enquiry: await enquiries.getEnquiry(enq.ref) });
});

// ---------- metrics and GM alerts ----------

router.get("/metrics", async (req, res) => {
  const { rows: [m] } = await pool.query(`
    SELECT
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM replied_at - received_at) / 60)
         FROM enquiries WHERE replied_at IS NOT NULL AND received_at > now() - interval '30 days') AS median_first_reply_min,
      (SELECT COUNT(*) FROM enquiries WHERE replied_at IS NOT NULL AND received_at > now() - interval '30 days')::int AS replied_30d,
      (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed' AND created_at > now() - interval '30 days')::int AS direct_bookings_30d,
      (SELECT COALESCE(SUM(total_paise), 0) FROM bookings WHERE status = 'confirmed' AND created_at > now() - interval '30 days')::bigint AS direct_revenue_30d_paise,
      (SELECT COUNT(*) FROM inventory WHERE sold + held > allotment)::int AS overbooked_nights,
      (SELECT COUNT(*) FROM alerts WHERE read_at IS NULL)::int AS unread_alerts`);
  res.json({ metrics: { ...m, direct_revenue_30d_paise: Number(m.direct_revenue_30d_paise), median_first_reply_min: m.median_first_reply_min == null ? null : Math.round(m.median_first_reply_min) } });
});

router.get("/alerts", requireGm, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, e.ref AS enquiry_ref FROM alerts a LEFT JOIN enquiries e ON e.id = a.enquiry_id
     ORDER BY a.read_at IS NULL DESC, a.created_at DESC LIMIT 50`
  );
  res.json({ alerts: rows });
});

router.post("/alerts/:id/read", requireGm, async (req, res) => {
  await pool.query("UPDATE alerts SET read_at = now() WHERE id = $1 AND read_at IS NULL", [Number(req.params.id) || 0]);
  res.json({ ok: true });
});

module.exports = router;
