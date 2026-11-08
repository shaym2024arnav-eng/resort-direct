// AI enquiry router: rule-based classifier + the guard rails around any AI output.
const { pool, resetDb } = require("./helpers");
const { rulesClassify, extractDates } = require("../src/router/rules");
const enquiries = require("../src/router/enquiries");
const { parseResult } = require("../src/router/gemini");
const { addDays, todayIST } = require("../src/lib/dates");

const TODAY = "2026-11-08";

describe("rule-based classifier on the brief's sample enquiries", () => {
  test("ENQ-4410 -> wedding, Feb 2027, 250 guests, 2 nights", () => {
    const r = rulesClassify("Venue for my sister's wedding in Feb 2027, about 250 guests, 2 nights", TODAY);
    expect(r.category).toBe("wedding");
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.extracted).toMatchObject({ month: "2027-02", guests: 250, nights: 2 });
  });

  test("ENQ-4411 -> room booking, 14-16 Nov, 2 adults + 1 child, villa", () => {
    const r = rulesClassify("Is a villa free 14-16 Nov for 2 adults and a child?", TODAY);
    expect(r.category).toBe("room_booking");
    expect(r.extracted).toMatchObject({ check_in: "2026-11-14", check_out: "2026-11-16", nights: 2, adults: 2, children: 1, room_preference: "villa" });
  });

  test("ENQ-4412 -> corporate offsite, 45 guests, January", () => {
    const r = rulesClassify("Team of 45 wants a January offsite with a conference hall", TODAY);
    expect(r.category).toBe("corporate_offsite");
    expect(r.extracted).toMatchObject({ guests: 45, month: "2027-01" });
  });

  test("a complaint wins even when the guest also asks about rooms", () => {
    const r = rulesClassify("The room was dirty and the staff were rude. Do you have another room for tonight?", TODAY);
    expect(r.category).toBe("complaint");
  });

  test("vague messages get low confidence (they go to the unsorted lane)", () => {
    expect(rulesClassify("Hi, do you do anything special for birthdays?", TODAY).confidence).toBeLessThan(0.7);
    expect(rulesClassify("want to know about rooms and a hall for an office meeting of 12", TODAY).confidence).toBeLessThan(0.7);
  });

  test("dates without a year resolve to the next future occurrence", () => {
    expect(extractDates("arriving 2 Jan for 3 nights", TODAY)).toMatchObject({ check_in: "2027-01-02", check_out: "2027-01-05", nights: 3 });
    expect(extractDates("14th to 16th of November", TODAY)).toMatchObject({ check_in: "2026-11-14", check_out: "2026-11-16" });
    expect(extractDates("Dec 24 2026 to Dec 26", TODAY).check_in).toBe("2026-12-24");
  });

  test("budget is read in lakh and k", () => {
    expect(rulesClassify("offsite for 60, budget around ₹12 lakh", TODAY).extracted.budget_inr).toBe(1200000);
    expect(rulesClassify("budget 80k for the weekend", TODAY).extracted.budget_inr).toBe(80000);
  });
});

describe("guard rails around AI output", () => {
  test("prices written by the AI are stripped", () => {
    const { text, removed } = enquiries.stripPrices("Our villa is ₹14,500 per night, or Rs. 30000 for two. 2 adults welcome.");
    expect(removed).toBe(2);
    expect(text).not.toMatch(/14,500|30000/);
    expect(text).toMatch(/2 adults/);
  });

  test("invalid or past dates from the AI are dropped, not shown to staff", () => {
    const { extracted, notes } = enquiries.sanitiseExtraction({ check_in: "2026-02-30", check_out: "2026-11-01", nights: 3 }, TODAY);
    expect(extracted.check_in).toBeNull();
    expect(notes.join(" ")).toMatch(/invalid check_in/);
    const past = enquiries.sanitiseExtraction({ check_in: "2026-10-01", check_out: "2026-10-03" }, TODAY);
    expect(past.extracted.check_in).toBeNull();
  });

  test("malformed AI JSON is rejected by the schema", () => {
    expect(() => parseResult("not json")).toThrow(/isn't JSON/);
    expect(() => parseResult(JSON.stringify({ category: "spam", confidence: 2 }))).toThrow(/validation/);
  });
});

describe("processEnquiry end to end (fake AI client, real database)", () => {
  beforeAll(() => resetDb());
  afterAll(() => pool.end());

  const aiResult = (over = {}) => ({
    category: "room_booking", confidence: 0.92, summary: "Villa for 2+1", check_in: addDays(todayIST(), 6), check_out: addDays(todayIST(), 8), month: null,
    nights: 2, adults: 2, children: 1, guests: 3, rooms: 1, budget_inr: null, room_preference: "villa",
    draft: "Dear Arjun,\n\nThanks for asking! Our villa costs ₹9,999 a night.\n\n{{PRICE_QUOTE}}\n\nWarm regards", ...over,
  });

  async function make(message, classifier, extra = {}) {
    const e = await enquiries.createEnquiry({ channel: "whatsapp", name: "Arjun Shetty", contact: "+91 90000 44444", message, ...extra });
    return enquiries.processEnquiry(e.id, { classifier });
  }

  test("confident AI result is routed to reservations, and its price is replaced by the rate table", async () => {
    const r = await make("Is a villa free 14-16 Nov for 2 adults and a child?", async () => aiResult());
    expect(r.ai_source).toBe("gemini");
    expect(r.lane).toBe("routed");
    expect(r.owner_id).not.toBeNull();
    expect(r.draft_reply).not.toMatch(/9,999/);
    expect(r.draft_reply).toMatch(/Plantation Villa/);
    expect(r.quote.available).toBe(true);
    expect(r.ai_note).toMatch(/removed 1 AI-written price/);
    const { rows: [owner] } = await pool.query("SELECT team FROM users WHERE id = $1", [r.owner_id]);
    expect(owner.team).toBe("reservations");
  });

  test("low confidence goes to the unsorted lane with no owner", async () => {
    const r = await make("something about february maybe", async () => aiResult({ category: "wedding", confidence: 0.55, draft: "Hi" }));
    expect(r.lane).toBe("unsorted");
    expect(r.owner_id).toBeNull();
  });

  test("AI failure falls back to the rule-based classifier", async () => {
    const r = await make("Team of 45 wants a January offsite with a conference hall", async () => { throw new Error("quota exceeded"); });
    expect(r.ai_source).toBe("rules");
    expect(r.category).toBe("corporate_offsite");
    expect(r.ai_note).toMatch(/quota exceeded/);
  });

  test("complaints alert the GM even when the AI misses them", async () => {
    const r = await make("We were charged twice and the staff were rude. Also is a room free next week?", async () => aiResult({ check_in: null, check_out: null }));
    expect(r.category).toBe("room_booking");
    expect(r.needs_gm).toBe(true);
    const { rows } = await pool.query("SELECT * FROM alerts WHERE enquiry_id = $1", [r.id]);
    expect(rows).toHaveLength(1);
  });

  test("re-routing is one call, picks an owner from the right team and is logged", async () => {
    const r = await make("something about february maybe", async () => aiResult({ category: "other", confidence: 0.4, draft: "Hi" }));
    const { rows: [gm] } = await pool.query("SELECT * FROM users WHERE role = 'gm'");
    const routed = await enquiries.routeEnquiry(gm, r.ref, { category: "wedding" });
    expect(routed.lane).toBe("routed");
    expect(routed.owner_name).toBe("Kavya Nair");
    expect(routed.events.map((e) => e.action)).toEqual(["classified", "rerouted"]);
  });

  test("drafts are never sent automatically, and a reply with a placeholder is refused", async () => {
    const r = await make("Is a villa free 14-16 Nov for 2 adults and a child?", async () => aiResult());
    expect(r.status).toBe("new");
    expect(r.sent_reply).toBeNull();
    const { rows: [staff] } = await pool.query("SELECT * FROM users WHERE team = 'reservations' LIMIT 1");
    await expect(enquiries.sendReply(staff, r.ref, "Hello {{PRICE_QUOTE}} thanks")).rejects.toMatchObject({ status: 400 });
    // The AI had written a price, so the draft says "[price removed]" — staff must edit before it can go.
    await expect(enquiries.sendReply(staff, r.ref, r.draft_reply)).rejects.toMatchObject({ status: 400 });
    const edited = r.draft_reply.replace(/^.*\[price removed\].*$/m, "Thanks for asking!");
    const sent = await enquiries.sendReply(staff, r.ref, edited);
    expect(sent.status).toBe("replied");
    await expect(enquiries.sendReply(staff, r.ref, edited)).rejects.toMatchObject({ status: 409 });
  });
});
