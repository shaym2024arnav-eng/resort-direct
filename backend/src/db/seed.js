// Realistic sample data. Re-running it resets the database to a known demo state.
// All guests, emails and phone numbers are made up (example.com / reserved number ranges).

const bcrypt = require("bcryptjs");
const { pool } = require("./pool");
const { migrate } = require("./migrate");
const { priceStay } = require("../services/pricing");
const { makeRef } = require("../services/inventory");
const { todayIST, addDays, isWeekendNight } = require("../lib/dates");

const ROOM_TYPES = [
  {
    slug: "estate-room", name: "Estate Room", kind: "room", units: 30, allotment: 6, rate: 6800, extra: 1500, maxA: 3, maxC: 2, size: 360,
    bed: "King or twin", view: "Coffee garden",
    summary: "Calm, wood-panelled rooms that open onto the coffee garden.",
    description: "Our most loved rooms: a deep king bed (or twins), a reading nook by the window and a private sit-out looking into shade-grown arabica. Mornings start with estate coffee brewed in your room.",
    amenities: ["Private sit-out", "In-room coffee brewer", "Rain shower", "Wi-Fi", "Heater"],
  },
  {
    slug: "valley-view-room", name: "Valley View Room", kind: "room", units: 24, allotment: 5, rate: 8200, extra: 1500, maxA: 3, maxC: 2, size: 420,
    bed: "King", view: "Baba Budangiri valley",
    summary: "Higher up the slope, with a wide window over the misty valley.",
    description: "Set on the upper terraces with floor-to-ceiling glass facing the Baba Budangiri hills. Watch the mist roll in from a window seat built for long afternoons.",
    amenities: ["Valley-facing window seat", "Bathtub", "In-room coffee brewer", "Wi-Fi", "Heater"],
  },
  {
    slug: "coffee-suite", name: "Coffee Suite", kind: "room", units: 10, allotment: 2, rate: 11500, extra: 1800, maxA: 3, maxC: 2, size: 640,
    bed: "King + day bed", view: "Estate and valley",
    summary: "A separate living room and a wraparound balcony over the estate.",
    description: "A suite with a separate living room, a day bed for a child, and a wraparound balcony. Good for families or a slow, long stay.",
    amenities: ["Separate living room", "Wraparound balcony", "Bathtub", "Mini bar", "Wi-Fi"],
  },
  {
    slug: "plantation-villa", name: "Plantation Villa", kind: "villa", units: 8, allotment: 2, rate: 14500, extra: 2000, maxA: 4, maxC: 2, size: 1100,
    bed: "2 bedrooms", view: "Private garden",
    summary: "Two-bedroom villas with a private garden and fireplace.",
    description: "Standalone cottages tucked between pepper vines and silver oak: two bedrooms, a fireplace for cold evenings and a private garden with a hammock.",
    amenities: ["2 bedrooms", "Fireplace", "Private garden", "Kitchenette", "Wi-Fi"],
  },
  {
    slug: "pool-villa", name: "Pool Villa", kind: "villa", units: 4, allotment: 1, rate: 21000, extra: 2500, maxA: 4, maxC: 2, size: 1500,
    bed: "2 bedrooms", view: "Valley, from a heated pool",
    summary: "Our most private stay: a heated plunge pool facing the valley.",
    description: "Four villas at the edge of the estate, each with a heated plunge pool, an outdoor shower and an uninterrupted view of the valley.",
    amenities: ["Heated plunge pool", "2 bedrooms", "Outdoor shower", "Butler on call", "Wi-Fi"],
  },
];

const RATE_PLANS = [
  { code: "RO", name: "Stay only", description: "Room only. Free cancellation up to 7 days before arrival.", breakfast: 0, discount: 0, refundable: true },
  { code: "BB", name: "Bed & breakfast", description: "Estate breakfast for every adult. Free cancellation up to 7 days before arrival.", breakfast: 65000, discount: 0, refundable: true },
  { code: "NRF", name: "Advance saver", description: "Breakfast included, 12% off. Non-refundable once paid.", breakfast: 65000, discount: 12, refundable: false },
];

// Demo logins (also listed in deployment.md). These are sample accounts, not real secrets.
const USERS = [
  { email: "guest@kaapihills.test", password: "Guest@123", name: "Ananya Rao", phone: "+91 90000 11111", role: "guest" },
  { email: "reservations@kaapihills.test", password: "Staff@123", name: "Ravi Gowda", role: "staff", team: "reservations" },
  { email: "reservations2@kaapihills.test", password: "Staff@123", name: "Meera Shetty", role: "staff", team: "reservations" },
  { email: "sales@kaapihills.test", password: "Staff@123", name: "Kavya Nair", role: "staff", team: "sales" },
  { email: "gm@kaapihills.test", password: "Gm@12345", name: "Suresh Hegde", role: "gm", team: "management" },
  { email: "rahul.k@example.com", password: "Guest@123", name: "Rahul Kulkarni", phone: "+91 90000 22222", role: "guest" },
  { email: "sneha.p@example.com", password: "Guest@123", name: "Sneha Pai", phone: "+91 90000 33333", role: "guest" },
];

function nightlyRate(base, date) {
  let r = base;
  if (isWeekendNight(date)) r *= 1.15;
  const md = date.slice(5);
  if (md >= "12-20" || md <= "01-02") r *= 1.3; // festive peak
  return Math.round(r / 50) * 50 * 100; // round to ₹50, store paise
}

async function seed({ days = 365, enquiries = true } = {}) {
  const today = todayIST();
  await pool.query(`TRUNCATE alerts, enquiry_events, enquiries, bookings, promo_codes, inventory, rate_plans, room_types, users RESTART IDENTITY CASCADE`);
  await pool.query("ALTER SEQUENCE enquiry_ref_seq RESTART WITH 4500");

  const userIds = {};
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 8);
    const { rows: [row] } = await pool.query(
      "INSERT INTO users (email, password_hash, name, phone, role, team) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [u.email, hash, u.name, u.phone || null, u.role, u.team || null]
    );
    userIds[u.email] = row.id;
  }

  const rt = {};
  for (const [i, r] of ROOM_TYPES.entries()) {
    const photos = [1, 2, 3].map((n) => `/images/rooms/${r.slug}-${n}.svg`);
    const { rows: [row] } = await pool.query(
      `INSERT INTO room_types (slug, name, kind, summary, description, size_sqft, bed, view, max_adults, max_children, base_occupancy,
                               extra_adult_paise, total_units, amenities, photos, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,2,$11,$12,$13,$14,$15) RETURNING *`,
      [r.slug, r.name, r.kind, r.summary, r.description, r.size, r.bed, r.view, r.maxA, r.maxC, r.extra * 100, r.units,
       JSON.stringify(r.amenities), JSON.stringify(photos), i]
    );
    rt[r.slug] = { ...row, seed: r };
  }

  const plans = {};
  for (const [i, p] of RATE_PLANS.entries()) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO rate_plans (code, name, description, breakfast_per_adult_paise, discount_pct, refundable, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [p.code, p.name, p.description, p.breakfast, p.discount, p.refundable, i]
    );
    plans[p.code] = row;
  }

  // Inventory: website allotment and daily rate for every room type for the next year.
  const ids = [], dates = [], allot = [], rates = [], closed = [];
  for (const r of Object.values(rt)) {
    for (let d = 0; d < days; d++) {
      const date = addDays(today, d);
      ids.push(r.id); dates.push(date); allot.push(r.seed.allotment); rates.push(nightlyRate(r.seed.rate, date));
      // Blackouts: a whole-resort wedding buyout, and pool-villa maintenance.
      closed.push(d === 45 || d === 46 || (r.slug === "pool-villa" && d >= 20 && d <= 22));
    }
  }
  await pool.query(
    `INSERT INTO inventory (room_type_id, stay_date, allotment, rate_paise, closed)
     SELECT * FROM unnest($1::int[], $2::date[], $3::int[], $4::int[], $5::bool[])`,
    [ids, dates, allot, rates, closed]
  );

  await pool.query(
    `INSERT INTO promo_codes (code, description, discount_pct, min_nights, valid_from, valid_to, max_uses, used, active) VALUES
     ('DIRECT10', '10% off for booking direct, 2 nights or more', 10, 2, $1, $2, NULL, 14, true),
     ('LONGSTAY15', '15% off stays of 4 nights or more (first 50 bookings)', 15, 4, $1, $2, 50, 3, true),
     ('MONSOON20', 'Monsoon offer (ended)', 20, 1, '2026-06-01', '2026-09-30', NULL, 41, true)`,
    [addDays(today, -30), addDays(today, 180)]
  );

  // Confirmed bookings so the admin screens and availability have real numbers in them.
  const sample = [
    { user: "guest@kaapihills.test", slug: "valley-view-room", plan: "BB", inDays: 12, nights: 2, rooms: 1, adults: 2, children: 0, ago: 26 },
    { user: "rahul.k@example.com", slug: "pool-villa", plan: "BB", inDays: 3, nights: 2, rooms: 1, adults: 2, children: 0, ago: 50 },
    { user: "sneha.p@example.com", slug: "estate-room", plan: "RO", inDays: 1, nights: 3, rooms: 2, adults: 4, children: 1, ago: 5 },
    { user: "rahul.k@example.com", slug: "coffee-suite", plan: "NRF", inDays: 6, nights: 2, rooms: 2, adults: 4, children: 0, ago: 3 },
    { user: "sneha.p@example.com", slug: "plantation-villa", plan: "BB", inDays: 9, nights: 3, rooms: 1, adults: 4, children: 2, ago: 1 },
    { user: "guest@kaapihills.test", slug: "estate-room", plan: "BB", inDays: 30, nights: 2, rooms: 1, adults: 2, children: 1, ago: 0.5, promo: "DIRECT10" },
  ];
  for (const s of sample) {
    const r = rt[s.slug];
    const checkIn = addDays(today, s.inDays);
    const checkOut = addDays(checkIn, s.nights);
    const { rows: nights } = await pool.query(
      `UPDATE inventory SET sold = sold + $4 WHERE room_type_id = $1 AND stay_date >= $2 AND stay_date < $3
       RETURNING stay_date AS date, rate_paise AS "ratePaise"`,
      [r.id, checkIn, checkOut, s.rooms]
    );
    nights.sort((a, b) => (a.date < b.date ? -1 : 1));
    const promo = s.promo ? { code: s.promo, discount_pct: 10 } : null;
    const price = priceStay({ nights, roomType: r, plan: plans[s.plan], adults: s.adults, children: s.children, rooms: s.rooms, promo });
    const u = USERS.find((x) => x.email === s.user);
    await pool.query(
      `INSERT INTO bookings (ref, user_id, room_type_id, rate_plan_id, check_in, check_out, nights, rooms, adults, children, guest_name,
                             guest_email, guest_phone, promo_code, price, total_paise, status, payment_ref, consent_at, created_at, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'confirmed',$17,
               now() - make_interval(mins => $18), now() - make_interval(mins => $18), now() - make_interval(mins => $18))`,
      [makeRef(), userIds[s.user], r.id, plans[s.plan].id, checkIn, checkOut, s.nights, s.rooms, s.adults, s.children, u.name, u.email,
       u.phone, s.promo || null, price, price.totalPaise, `pay_test_seed${String(sample.indexOf(s)).padStart(2, "0")}`, Math.round(s.ago * 60)]
    );
  }

  if (enquiries) await seedEnquiries();
  return { today };
}

const ENQUIRIES = [
  { ref: "ENQ-4410", channel: "web", name: "Priya Menon", contact: "priya.menon@example.com", hoursAgo: 30, replyAfterMin: 22,
    message: "Venue for my sister's wedding in Feb 2027, about 250 guests, 2 nights" },
  { ref: "ENQ-4411", channel: "whatsapp", name: "Arjun Shetty", contact: "+91 90000 44444", hoursAgo: 2,
    message: "Is a villa free 14-16 Nov for 2 adults and a child?" },
  { ref: "ENQ-4412", channel: "email", name: "Neha Kapoor", contact: "neha.kapoor@example.com", hoursAgo: 5,
    message: "Team of 45 wants a January offsite with a conference hall" },
  { channel: "email", name: "Rahul Desai", contact: "rahul.desai@example.com", hoursAgo: 1,
    message: "We checked out yesterday and were charged twice for dinner on our bill. The room also had no hot water on the second morning. Quite disappointed — please look into it." },
  { channel: "whatsapp", name: "Lakshmi Bhat", contact: "+91 90000 55555", hoursAgo: 3,
    message: "Namaskara, December last week nalli 2 rooms beku, 4 adults. Rate yeshtu?" },
  { channel: "web", name: "Vikram Iyer", contact: "vikram.iyer@example.com", hoursAgo: 4,
    message: "Hi, do you do anything special for birthdays?" },
  { channel: "web", name: "Sana Qureshi", contact: "sana.q@example.com", hoursAgo: 26, replyAfterMin: 18,
    message: "Planning our honeymoon, looking at a pool villa for 3 nights from 20 Dec. Is it available?" },
  { channel: "email", name: "Karthik Rao", contact: "karthik@zentralabs.example.com", hoursAgo: 50, replyAfterMin: 41,
    message: "We are a 60 member company looking for a 2 night team building retreat in March 2027 with breakout rooms and a projector. Budget around ₹12 lakh." },
  { channel: "whatsapp", name: "Meghna Joshi", contact: "+91 90000 66666", hoursAgo: 20, replyAfterMin: 27,
    message: "Shaadi ke liye venue chahiye, 150 log, March mein. Rooms bhi chahiye." },
  { channel: "web", name: "Aditya Kumar", contact: "aditya.k@example.com", hoursAgo: 6,
    message: "Can we bring our dog along?" },
  { channel: "email", name: "Fatima Sheikh", contact: "fatima.s@example.com", hoursAgo: 45, replyAfterMin: 12,
    message: "Booking for 2 adults, 28 Nov to 30 Nov, Valley View Room with breakfast please." },
  { channel: "web", name: "Rohan Gupta", contact: "rohan.g@example.com", hoursAgo: 70, replyAfterMin: 35,
    message: "Our engagement ceremony and a small reception for 80 guests, sometime in April. Do you have a lawn?" },
  { channel: "whatsapp", name: "Deepa Nair", contact: "+91 90000 77777", hoursAgo: 8, replyAfterMin: 15,
    message: "Staff at the restaurant were rude to my parents last night. Not happy at all." },
  { channel: "email", name: "Imran Ali", contact: "imran.ali@example.com", hoursAgo: 9,
    message: "Hi, want to know about rooms and also if you have a hall for a small office meeting of 12 people" },
  { channel: "web", name: "Ganesh Murthy", contact: "ganesh.m@example.com", hoursAgo: 10,
    message: "Is 5-7 December free for a family of 3 adults and 2 kids? We'd prefer a villa." },
  { channel: "email", name: "Anita D'Souza", contact: "anita.dsouza@example.com", hoursAgo: 12,
    message: "We stayed last month, lovely time! Can you send the invoice with the GST number for my company?" },
];

async function seedEnquiries() {
  // Seed data is classified with the deterministic rule-based router, so the demo is
  // reproducible without an AI key. Live enquiries use Gemini when GEMINI_API_KEY is set.
  const { createEnquiry, processEnquiry } = require("../router/enquiries");
  const { rows: [{ gm }] } = await pool.query("SELECT id AS gm FROM users WHERE role = 'gm' LIMIT 1");
  for (const e of ENQUIRIES) {
    const receivedAt = new Date(Date.now() - e.hoursAgo * 3600 * 1000);
    const row = await createEnquiry({ ...e, receivedAt });
    const processed = await processEnquiry(row.id, { classifier: null });
    if (e.replyAfterMin) {
      const replier = processed.owner_id || gm;
      await pool.query(
        `UPDATE enquiries SET status = 'replied', sent_reply = draft_reply, replied_at = received_at + make_interval(mins => $2),
                owner_id = COALESCE(owner_id, $3), lane = 'routed' WHERE id = $1`,
        [row.id, e.replyAfterMin, replier]
      );
      await pool.query(
        `INSERT INTO enquiry_events (enquiry_id, user_id, action, detail, created_at)
         VALUES ($1, $2, 'reply_sent', '{"simulated": true}', $3::timestamptz + make_interval(mins => $4))`,
        [row.id, replier, receivedAt, e.replyAfterMin]
      );
      await pool.query("UPDATE alerts SET read_at = now() WHERE enquiry_id = $1", [row.id]);
    }
  }
  await pool.query("UPDATE enquiry_events SET created_at = e.received_at + interval '4 seconds' FROM enquiries e WHERE e.id = enquiry_events.enquiry_id AND enquiry_events.action = 'classified'");
  await pool.query("UPDATE alerts SET created_at = e.received_at + interval '4 seconds' FROM enquiries e WHERE e.id = alerts.enquiry_id");
}

if (require.main === module) {
  // --if-empty: used on deploy, so redeploys don't wipe data people have created.
  const ifEmpty = process.argv.includes("--if-empty");
  migrate()
    .then(async () => {
      if (ifEmpty) {
        const { rows: [{ n }] } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
        if (n > 0) { console.log("Database already has data; not seeding."); return null; }
      }
      return seed();
    })
    .then((r) => { if (r) console.log(`Seeded demo data (today = ${r.today}).`); return pool.end(); })
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { seed, USERS, ROOM_TYPES };
