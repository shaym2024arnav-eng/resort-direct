// Guest-facing routes that don't need an account: rooms, availability, prices, enquiries.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { pool } = require("../db/pool");
const config = require("../config");
const { z, stayQuery, quoteBody, isoDate, phone } = require("../lib/validate");
const inventory = require("../services/inventory");
const enquiries = require("../router/enquiries");
const { todayIST, addDays } = require("../lib/dates");

const router = express.Router();

router.get("/rooms", async (req, res) => {
  const today = todayIST();
  const [{ rows }, plans] = await Promise.all([
    pool.query(
      `SELECT rt.*, MIN(i.rate_paise) FILTER (WHERE NOT i.closed) AS from_rate_paise
       FROM room_types rt LEFT JOIN inventory i ON i.room_type_id = rt.id AND i.stay_date >= $1 AND i.stay_date < $2
       GROUP BY rt.id ORDER BY rt.sort`,
      [today, addDays(today, 60)]
    ),
    inventory.listPlans(),
  ]);
  res.set("Cache-Control", "public, max-age=60");
  res.json({
    rooms: rows.map((r) => ({ ...inventory.publicRoomType(r), fromRatePaise: r.from_rate_paise })),
    plans: plans.map((p) => ({ code: p.code, name: p.name, description: p.description, refundable: p.refundable, breakfastPerAdultPaise: p.breakfast_per_adult_paise, discountPct: p.discount_pct })),
  });
});

router.get("/rooms/:slug", async (req, res) => {
  const rt = await inventory.getRoomType(pool, req.params.slug);
  res.json({ room: inventory.publicRoomType(rt) });
});

const calendarQuery = z.object({ from: isoDate.optional(), days: z.coerce.number().int().min(1).max(62).default(42) });

router.get("/rooms/:slug/calendar", async (req, res) => {
  const { from, days } = calendarQuery.parse(req.query);
  const start = from && from > todayIST() ? from : todayIST();
  res.json({ from: start, days: await inventory.roomCalendar(req.params.slug, start, days) });
});

router.get("/availability", async (req, res) => {
  const stay = stayQuery.parse(req.query);
  res.json({ stay, results: await inventory.searchAvailability(stay) });
});

router.post("/quote", async (req, res) => {
  res.json(await inventory.quote(quoteBody.parse(req.body)));
});

// ---------- enquiries (web form and structured event form) ----------

const enquiryLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false,
  skip: () => config.isTest, message: { message: "You've sent several enquiries in a short time. Please wait a few minutes." },
});

const contactFields = {
  name: z.string().trim().min(2).max(80),
  email: z.email().max(120),
  phone: phone.optional().or(z.literal("")),
  consent: z.literal(true, { message: "please agree to the privacy notice so we can reply" }),
};

const webEnquiry = z.object({ ...contactFields, message: z.string().trim().min(10, "please tell us a little more").max(2000) });

router.post("/enquiries", enquiryLimiter, async (req, res) => {
  const body = webEnquiry.parse(req.body);
  const contact = [body.email, body.phone].filter(Boolean).join(" · ");
  const enq = await enquiries.createEnquiry({ channel: "web", name: body.name, contact, message: body.message });
  enquiries.processInBackground(enq.id);
  res.status(201).json({ ref: enq.ref, message: "Thanks — we've received your enquiry. Our team usually replies within 30 minutes during the day." });
});

const eventEnquiry = z.object({
  ...contactFields,
  eventType: z.enum(["wedding", "corporate_offsite", "other_event"]),
  date: isoDate.optional().or(z.literal("")),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal("")),
  nights: z.coerce.number().int().min(1).max(10).optional(),
  guests: z.coerce.number().int().min(2).max(1500),
  roomsNeeded: z.coerce.number().int().min(0).max(76).optional(),
  budgetInr: z.coerce.number().int().min(0).max(100000000).optional(),
  needs: z.array(z.enum(["accommodation", "venue", "catering", "conference_hall", "av", "decor", "transport"])).max(7).default([]),
  message: z.string().trim().max(2000).optional().default(""),
}).refine((b) => b.date || b.month, { message: "please give a date or at least a month", path: ["date"] })
  .refine((b) => !b.date || b.date >= todayIST(), { message: "can't be in the past", path: ["date"] });

const EVENT_LABEL = { wedding: "Wedding", corporate_offsite: "Corporate offsite", other_event: "Event" };

router.post("/enquiries/event", enquiryLimiter, async (req, res) => {
  const b = eventEnquiry.parse(req.body);
  const formData = {
    eventType: b.eventType, date: b.date || null, month: b.month || null, nights: b.nights || null, guests: b.guests,
    roomsNeeded: b.roomsNeeded ?? null, budgetInr: b.budgetInr ?? null, needs: b.needs,
  };
  const when = b.date || b.month;
  const message = [
    `${EVENT_LABEL[b.eventType]} enquiry for ${b.guests} guests, ${when}${b.nights ? `, ${b.nights} night(s)` : ""}.`,
    b.roomsNeeded ? `Rooms needed: ${b.roomsNeeded}.` : "",
    b.budgetInr ? `Budget: ₹${b.budgetInr.toLocaleString("en-IN")}.` : "",
    b.needs.length ? `Needs: ${b.needs.join(", ").replaceAll("_", " ")}.` : "",
    b.message,
  ].filter(Boolean).join(" ");
  const contact = [b.email, b.phone].filter(Boolean).join(" · ");
  const enq = await enquiries.createEnquiry({ channel: "event_form", name: b.name, contact, message, formData });
  enquiries.processInBackground(enq.id);
  res.status(201).json({ ref: enq.ref, message: "Thank you — our events team will send you a proposal, usually within a working day." });
});

module.exports = router;
