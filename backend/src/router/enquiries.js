// Enquiry inbox + AI routing.
//
// Guard rails (from the brief, "when the AI is wrong"):
//  1. Confidence below 0.7, or category "other"  -> UNSORTED lane, no owner; the GM sorts it.
//  2. Staff can re-route in one click (routeEnquiry), and every change is logged.
//  3. Drafts are never sent automatically — sending is a separate, explicit staff action.
//  4. Prices in drafts come from the rate table, never the AI: amounts the AI writes are stripped
//     and {{PRICE_QUOTE}} is filled from live inventory.
//  5. Complaints always alert the GM — even if the AI calls it something else, a keyword
//     safety net raises the alert.

const { pool, withTransaction } = require("../db/pool");
const config = require("../config");
const { rulesClassify, hasComplaintSignal, summarise, CATEGORY_LABEL } = require("./rules");
const { geminiClassify, getClient } = require("./gemini");
const { searchAvailability } = require("../services/inventory");
const { isValidIsoDate, diffDays, todayIST, addDays } = require("../lib/dates");
const { notFound, badRequest, conflict } = require("../lib/errors");

const OWNER_TEAM = { room_booking: "reservations", wedding: "sales", corporate_offsite: "sales", complaint: "management" };
const PLACEHOLDER = "{{PRICE_QUOTE}}";

const rupees = (paise) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const fmtDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Remove any money amount from AI-written text.
const MONEY_RE = /(?:₹|\brs\.?|\binr\b|\brupees\b)\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:\/-|k\b|lakhs?|lacs?|crores?))?|\b\d[\d,]*(?:\.\d+)?\s*(?:\/-|rupees\b|inr\b|lakhs?\b|lacs?\b)(?:\s*rupees)?/gi;
function stripPrices(text) {
  let removed = 0;
  const clean = text.replace(MONEY_RE, () => { removed++; return "[price removed]"; });
  return { text: clean, removed };
}

// Drop AI/rules extraction that doesn't make sense, rather than show staff wrong facts.
function sanitiseExtraction(x, today) {
  const out = { ...x };
  const notes = [];
  for (const key of ["check_in", "check_out"]) {
    if (out[key] && !isValidIsoDate(out[key])) { notes.push(`ignored invalid ${key}`); out[key] = null; }
  }
  if (out.check_in && out.check_in < today) { notes.push("ignored past check-in date"); out.check_in = null; out.check_out = null; }
  if (out.check_in && out.check_out && diffDays(out.check_in, out.check_out) <= 0) { notes.push("ignored check-out before check-in"); out.check_out = null; }
  if (out.check_in && out.check_out) out.nights = diffDays(out.check_in, out.check_out);
  if (out.month && !/^\d{4}-\d{2}$/.test(out.month)) out.month = null;
  for (const key of ["nights", "adults", "children", "guests", "rooms", "budget_inr"]) {
    if (out[key] != null && (!Number.isInteger(out[key]) || out[key] < 0)) { out[key] = null; }
  }
  if (out.nights != null && (out.nights < 1 || out.nights > 60)) out.nights = null;
  if (out.adults != null && out.adults > 500) out.adults = null;
  return { extracted: out, notes };
}

async function pickOwner(db, team) {
  const { rows } = await db.query(
    `SELECT u.id, u.name FROM users u
     LEFT JOIN enquiries e ON e.owner_id = u.id AND e.status = 'new'
     WHERE ${team === "management" ? "u.role = 'gm'" : "u.role = 'staff' AND u.team = $1"}
     GROUP BY u.id ORDER BY COUNT(e.id), u.id LIMIT 1`,
    team === "management" ? [] : [team]
  );
  return rows[0] || null;
}

const PREF_SLUGS = {
  room: ["estate-room", "valley-view-room"], suite: ["coffee-suite"], villa: ["plantation-villa", "pool-villa"], pool_villa: ["pool-villa"],
};

/** Live quote from the rate table for a room enquiry, or null if we don't know enough. */
async function buildQuote(x) {
  const today = todayIST();
  if (!x.check_in || !x.check_out) return null;
  const nights = diffDays(x.check_in, x.check_out);
  if (nights < 1 || nights > config.maxNights || x.check_in < today || x.check_in > addDays(today, config.bookingWindowDays)) return null;
  const children = x.children || 0;
  const adults = x.adults || (x.guests ? Math.max(1, x.guests - children) : 2);
  const results = await searchAvailability({ checkIn: x.check_in, checkOut: x.check_out, adults, children, rooms: 1 });
  const wanted = PREF_SLUGS[x.room_preference] || null;
  const candidates = results.filter((r) => !wanted || wanted.includes(r.slug));
  const open = candidates.filter((r) => r.status === "available").sort((a, b) => a.fromTotalPaise - b.fromTotalPaise);
  const base = { checkIn: x.check_in, checkOut: x.check_out, nights, adults, children, computedAt: new Date().toISOString() };
  if (!open.length) return { ...base, available: false, options: [] };
  const options = open.slice(0, 2).map((r) => ({
    roomType: r.name, slug: r.slug,
    plans: r.plans.filter((p) => p.code !== "NRF").map((p) => ({ code: p.code, name: p.name, totalPaise: p.price.totalPaise, taxPaise: p.price.taxPaise })),
  }));
  return { ...base, available: true, options };
}

function quoteText(q) {
  if (!q) return "Could you share your check-in and check-out dates and the number of guests? We'll send you exact rates straight away.";
  const who = `${q.adults} adult${q.adults > 1 ? "s" : ""}${q.children ? ` and ${q.children} child${q.children > 1 ? "ren" : ""}` : ""}`;
  const head = `For ${fmtDate(q.checkIn)} to ${fmtDate(q.checkOut)} (${q.nights} night${q.nights > 1 ? "s" : ""}, ${who}):`;
  if (!q.available) return `${head} our online allotment is full for those dates, but our reservations team is checking other options for you and will get back shortly.`;
  const lines = q.options.flatMap((o) => o.plans.map((p) => `• ${o.roomType}, ${p.name}: ${rupees(p.totalPaise)} in total, including GST`));
  return `${head}\n${lines.join("\n")}\nRates are from today's tariff and are confirmed when you book.`;
}

function templateDraft(category, enquiry) {
  const first = enquiry.name.split(/\s+/)[0];
  const sign = "Warm regards,\nReservations, Kaapi Hills";
  switch (category) {
    case "room_booking":
      return `Dear ${first},\n\nThank you for writing to Kaapi Hills — we'd love to host you.\n\n${PLACEHOLDER}\n\nYou can book directly on our website, or reply here and we'll reserve it for you.\n\n${sign}`;
    case "wedding":
      return `Dear ${first},\n\nCongratulations, and thank you for considering Kaapi Hills for the wedding. Our events team will send you a tailored proposal covering venues, rooms and catering. To get it right, could you confirm the dates, the number of guests staying overnight, and any budget you have in mind?\n\n${sign}`;
    case "corporate_offsite":
      return `Dear ${first},\n\nThank you for thinking of Kaapi Hills for your team. Our events team will share a proposal with meeting spaces, rooms and meals. Could you confirm your preferred dates, group size and any AV or breakout needs?\n\n${sign}`;
    case "complaint":
      return `Dear ${first},\n\nI'm very sorry about your experience, and thank you for telling us. I've shared your message with our General Manager, who will personally follow up with you today.\n\n${sign}`;
    default:
      return `Dear ${first},\n\nThank you for getting in touch with Kaapi Hills. Could you tell us a little more about what you're planning, including dates and the number of guests, so we can help?\n\n${sign}`;
  }
}

async function finaliseDraft(category, rawDraft, extracted, enquiry, aiWrote) {
  const notes = [];
  let draft = rawDraft || templateDraft(category, enquiry);
  if (aiWrote) {
    const { text, removed } = stripPrices(draft);
    if (removed) notes.push(`removed ${removed} AI-written price${removed > 1 ? "s" : ""} from the draft`);
    draft = text;
  }
  let quote = null;
  if (category === "room_booking") {
    quote = await buildQuote(extracted);
    const text = quoteText(quote);
    draft = draft.includes(PLACEHOLDER) ? draft.replace(PLACEHOLDER, text) : `${draft}\n\n${text}`;
  } else {
    draft = draft.replaceAll(PLACEHOLDER, "");
  }
  return { draft: draft.replace(/\n{3,}/g, "\n\n").trim(), quote, notes };
}

/**
 * Classify, extract, route and draft one enquiry.
 * @param deps.classifier async (enquiry, {today}) => result; defaults to Gemini when a key is set.
 */
async function processEnquiry(id, deps = {}) {
  const today = todayIST();
  const { rows: [enq] } = await pool.query("SELECT * FROM enquiries WHERE id = $1", [id]);
  if (!enq) throw notFound("Enquiry");

  const classifier = deps.classifier !== undefined ? deps.classifier : getClient() ? geminiClassify : null;
  const notes = [];
  let result;
  let source = "rules";

  if (enq.form_data) {
    // Structured event form: the guest told us what it is.
    const f = enq.form_data;
    const extracted = {
      check_in: f.date || null, check_out: f.date && f.nights ? addDays(f.date, f.nights) : null, month: f.month || (f.date ? f.date.slice(0, 7) : null),
      nights: f.nights || null, adults: null, children: null, guests: f.guests || null, rooms: f.roomsNeeded || null,
      budget_inr: f.budgetInr || null, room_preference: null,
    };
    result = { category: f.eventType === "wedding" ? "wedding" : f.eventType === "corporate_offsite" ? "corporate_offsite" : "other", confidence: 1, extracted, draft: null };
    notes.push("structured event form");
  } else if (classifier) {
    try {
      const ai = await classifier(enq, { today });
      const { draft, summary, category, confidence, ...extracted } = ai;
      result = { category, confidence, extracted, draft, summary };
      source = "gemini";
    } catch (err) {
      notes.push(`AI unavailable (${err.message}) — used rule-based classifier`);
    }
  } else {
    notes.push("no AI key configured — used rule-based classifier");
  }
  if (!result) result = rulesClassify(enq.message, today);

  const { extracted, notes: xNotes } = sanitiseExtraction(result.extracted, today);
  notes.push(...xNotes);

  // Safety net: complaints always reach the GM.
  const complaintSignal = hasComplaintSignal(enq.message);
  const needsGm = result.category === "complaint" || complaintSignal;
  if (complaintSignal && result.category !== "complaint") notes.push("complaint words found — GM alerted");

  const confident = result.confidence >= config.routingConfidence && result.category !== "other";
  const lane = confident ? "routed" : "unsorted";

  const { draft, quote, notes: dNotes } = await finaliseDraft(result.category, source === "gemini" ? result.draft : null, extracted, enq, source === "gemini");
  notes.push(...dNotes);

  return withTransaction(async (db) => {
    const owner = confident ? await pickOwner(db, OWNER_TEAM[result.category]) : null;
    const summary = (result.summary && result.summary.slice(0, 200)) || summarise(result.category, extracted);
    const { rows: [updated] } = await db.query(
      `UPDATE enquiries SET processing = 'done', category = $2, confidence = $3, extracted = $4, summary = $5, ai_source = $6,
              ai_note = $7, lane = $8, owner_id = $9, needs_gm = $10, draft_reply = $11, quote = $12
       WHERE id = $1 RETURNING *`,
      [id, result.category, result.confidence, extracted, summary, source, notes.join("; ") || null, lane, owner?.id ?? null, needsGm, draft, quote]
    );
    await db.query("INSERT INTO enquiry_events (enquiry_id, action, detail) VALUES ($1, 'classified', $2)", [
      id, { source, category: result.category, confidence: result.confidence, lane, owner: owner?.name ?? null, notes },
    ]);
    if (needsGm) {
      await db.query("INSERT INTO alerts (kind, enquiry_id, message) VALUES ('complaint', $1, $2)", [
        id, `Complaint from ${enq.name} via ${enq.channel}: "${enq.message.slice(0, 120)}${enq.message.length > 120 ? "…" : ""}"`,
      ]);
    }
    return updated;
  });
}

async function createEnquiry({ channel, name, contact, message, formData = null, receivedAt = null, ref = null }) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO enquiries (ref, channel, name, contact, message, form_data, received_at)
     VALUES (COALESCE($7, 'ENQ-' || nextval('enquiry_ref_seq')), $1, $2, $3, $4, $5, COALESCE($6, now())) RETURNING *`,
    [channel, name, contact, message, formData, receivedAt, ref]
  );
  return row;
}

// Process in the background so the guest's form submits instantly; failures are retried by the sweeper.
function processInBackground(id) {
  setImmediate(() => processEnquiry(id).catch(async (err) => {
    console.error(`Enquiry ${id} processing failed:`, err.message);
    await pool.query("UPDATE enquiries SET processing = 'failed', ai_note = $2 WHERE id = $1", [id, err.message]).catch(() => {});
  }));
}

async function processPending() {
  const { rows } = await pool.query(
    "SELECT id FROM enquiries WHERE processing <> 'done' AND received_at < now() - interval '30 seconds' ORDER BY id LIMIT 10"
  );
  for (const { id } of rows) await processEnquiry(id).catch((err) => console.error(`Retry of enquiry ${id} failed:`, err.message));
}

// ---------- staff inbox ----------

const LIST_SELECT = `
  SELECT e.id, e.ref, e.channel, e.name, e.contact, e.message, e.received_at, e.processing, e.category, e.confidence,
         e.summary, e.lane, e.needs_gm, e.status, e.ai_source, e.owner_id, u.name AS owner_name, e.replied_at
  FROM enquiries e LEFT JOIN users u ON u.id = e.owner_id`;

async function listEnquiries(user, { lane = "all", status = "open", category, q } = {}) {
  const where = [];
  const params = [];
  if (lane === "routed" || lane === "unsorted") { params.push(lane); where.push(`e.lane = $${params.length}`); }
  if (lane === "mine") { params.push(user.id); where.push(`e.owner_id = $${params.length}`); }
  if (lane === "complaints") where.push("e.needs_gm");
  if (status === "open") where.push("e.status = 'new'");
  else if (status && status !== "all") { params.push(status); where.push(`e.status = $${params.length}`); }
  if (category) { params.push(category); where.push(`e.category = $${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(e.message ILIKE $${params.length} OR e.name ILIKE $${params.length} OR e.ref ILIKE $${params.length})`); }
  const sql = `${LIST_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY (e.needs_gm AND e.status = 'new') DESC, e.received_at DESC LIMIT 200`;
  const [{ rows }, counts] = await Promise.all([pool.query(sql, params), laneCounts(user)]);
  return { items: rows, counts };
}

async function laneCounts(user) {
  const { rows: [c] } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'new')::int AS "all",
            COUNT(*) FILTER (WHERE status = 'new' AND lane = 'routed')::int AS routed,
            COUNT(*) FILTER (WHERE status = 'new' AND lane = 'unsorted')::int AS unsorted,
            COUNT(*) FILTER (WHERE status = 'new' AND owner_id = $1)::int AS mine,
            COUNT(*) FILTER (WHERE status = 'new' AND needs_gm)::int AS complaints
     FROM enquiries`,
    [user.id]
  );
  return c;
}

async function getEnquiry(ref) {
  const { rows: [e] } = await pool.query(`${LIST_SELECT.replace("e.replied_at", "e.replied_at, e.extracted, e.draft_reply, e.quote, e.sent_reply, e.ai_note, e.form_data")} WHERE e.ref = $1`, [ref]);
  if (!e) throw notFound("Enquiry");
  const { rows: events } = await pool.query(
    `SELECT ev.id, ev.action, ev.detail, ev.created_at, u.name AS user_name
     FROM enquiry_events ev LEFT JOIN users u ON u.id = ev.user_id WHERE ev.enquiry_id = $1 ORDER BY ev.created_at, ev.id`,
    [e.id]
  );
  return { ...e, events };
}

async function lockEnquiry(db, ref) {
  const { rows: [e] } = await db.query("SELECT * FROM enquiries WHERE ref = $1 FOR UPDATE", [ref]);
  if (!e) throw notFound("Enquiry");
  return e;
}

/** One-click re-route: set the category and (optionally) a specific owner. */
async function routeEnquiry(user, ref, { category, ownerId }) {
  await withTransaction(async (db) => {
    const e = await lockEnquiry(db, ref);
    let owner = null;
    if (ownerId) {
      const { rows: [u] } = await db.query("SELECT id, name FROM users WHERE id = $1 AND role IN ('staff', 'gm')", [ownerId]);
      if (!u) throw badRequest("That person isn't on the staff list.");
      owner = u;
    } else if (OWNER_TEAM[category]) {
      owner = await pickOwner(db, OWNER_TEAM[category]);
    }
    const needsGm = e.needs_gm || category === "complaint";
    await db.query("UPDATE enquiries SET category = $2, lane = $3, owner_id = $4, needs_gm = $5 WHERE id = $1", [
      e.id, category, owner ? "routed" : "unsorted", owner?.id ?? null, needsGm,
    ]);
    if (category === "complaint" && !e.needs_gm) {
      await db.query("INSERT INTO alerts (kind, enquiry_id, message) VALUES ('complaint', $1, $2)", [e.id, `${user.name} marked ${e.ref} from ${e.name} as a complaint.`]);
    }
    await db.query("INSERT INTO enquiry_events (enquiry_id, user_id, action, detail) VALUES ($1, $2, 'rerouted', $3)", [
      e.id, user.id, { from: { category: e.category, owner_id: e.owner_id }, to: { category, owner: owner?.name ?? null } },
    ]);
    // Changing to/from a room booking changes what the draft should say.
    if (category !== e.category && (category === "room_booking" || e.category === "room_booking") && e.status === "new") {
      const { draft, quote } = await finaliseDraft(category, null, e.extracted, e, false);
      await db.query("UPDATE enquiries SET draft_reply = $2, quote = $3 WHERE id = $1", [e.id, draft, quote]);
    }
  });
  return getEnquiry(ref);
}

async function saveDraft(user, ref, draft) {
  await withTransaction(async (db) => {
    const e = await lockEnquiry(db, ref);
    await db.query("UPDATE enquiries SET draft_reply = $2 WHERE id = $1", [e.id, draft]);
    await db.query("INSERT INTO enquiry_events (enquiry_id, user_id, action) VALUES ($1, $2, 'draft_edited')", [e.id, user.id]);
  });
  return getEnquiry(ref);
}

/** The only way a reply goes out: a staff member presses Send. Delivery is simulated (logged outbox). */
async function sendReply(user, ref, body) {
  if (/\{\{[^}]*\}\}|\[price removed\]/i.test(body)) throw badRequest("The reply still has a placeholder or a removed price in it — please edit it first.");
  await withTransaction(async (db) => {
    const e = await lockEnquiry(db, ref);
    if (e.status !== "new") throw conflict("This enquiry has already been answered or closed.");
    await db.query("UPDATE enquiries SET status = 'replied', sent_reply = $2, replied_at = now() WHERE id = $1", [e.id, body]);
    await db.query("INSERT INTO enquiry_events (enquiry_id, user_id, action, detail) VALUES ($1, $2, 'reply_sent', $3)", [
      e.id, user.id, { channel: e.channel, to: e.contact, simulated: true },
    ]);
  });
  return getEnquiry(ref);
}

async function closeEnquiry(user, ref) {
  await withTransaction(async (db) => {
    const e = await lockEnquiry(db, ref);
    await db.query("UPDATE enquiries SET status = 'closed' WHERE id = $1", [e.id]);
    await db.query("INSERT INTO enquiry_events (enquiry_id, user_id, action) VALUES ($1, $2, 'closed')", [e.id, user.id]);
  });
  return getEnquiry(ref);
}

async function reprocess(user, ref) {
  const { rows: [e] } = await pool.query("SELECT id, status FROM enquiries WHERE ref = $1", [ref]);
  if (!e) throw notFound("Enquiry");
  if (e.status !== "new") throw conflict("Only open enquiries can be re-run.");
  await pool.query("INSERT INTO enquiry_events (enquiry_id, user_id, action) VALUES ($1, $2, 'reprocess_requested')", [e.id, user.id]);
  await processEnquiry(e.id);
  return getEnquiry(ref);
}

module.exports = {
  processEnquiry, createEnquiry, processInBackground, processPending, listEnquiries, getEnquiry, routeEnquiry, saveDraft,
  sendReply, closeEnquiry, reprocess, stripPrices, sanitiseExtraction, quoteText, buildQuote, templateDraft, CATEGORY_LABEL,
};
