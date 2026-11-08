// Rule-based classifier and extractor.
// Used (1) when no Gemini key is configured or the AI call fails, and (2) always, as a
// complaint safety net and to cross-check AI extraction. Deterministic, so it is fully tested.

const { addDays, diffDays, isValidIsoDate, todayIST } = require("../lib/dates");

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ORD = "(?:st|nd|rd|th)?";
const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const NUM = "(\\d{1,4}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const toNum = (s) => (s == null ? null : /^\d+$/.test(s) ? Number(s) : WORD_NUMBERS[s.toLowerCase()] ?? null);
const pad = (n) => String(n).padStart(2, "0");

// Weighted keywords. Strong signals weigh 3, supporting words 1.
const KEYWORDS = {
  complaint: {
    3: ["complaint", "complain", "disappointed", "disappointing", "terrible", "worst", "rude", "dirty", "unacceptable",
        "charged twice", "overcharged", "not happy", "refund", "bad experience", "poor service", "cockroach",
        "no hot water", "horrible", "awful", "pathetic", "never again", "unhygienic"],
    1: ["issue", "problem", "broken", "noisy", "delay", "waited", "smell", "leak"],
  },
  wedding: {
    3: ["wedding", "marriage", "shaadi", "shadi", "sangeet", "mehendi", "mehndi", "haldi", "bride", "groom",
        "engagement ceremony", "reception", "muhurtham", "vivaha"],
    1: ["venue", "mandap", "decor", "baraat", "family function", "lawn"],
  },
  corporate_offsite: {
    3: ["offsite", "off-site", "conference", "corporate", "team building", "team-building", "delegates", "mice",
        "company retreat", "board meeting", "workshop", "team outing"],
    1: ["team", "colleagues", "employees", "meeting", "projector", "hall", "office", "company", "breakout", "gst invoice"],
  },
  room_booking: {
    3: ["available", "availability", "free for", "villa free", "room free", "rooms free", "book a room", "book a villa",
        "booking for", "want to book", "like to book", "rooms beku", "room beku", "reserve"],
    1: ["room", "rooms", "villa", "villas", "suite", "stay", "night", "nights", "adults", "adult", "child", "children",
        "kids", "kid", "couple", "honeymoon", "weekend", "check-in", "check in"],
  },
};

function scoreCategories(text) {
  const t = ` ${text.toLowerCase()} `;
  const scores = {};
  const strong = {};
  for (const [cat, groups] of Object.entries(KEYWORDS)) {
    scores[cat] = 0;
    strong[cat] = false;
    for (const [weight, words] of Object.entries(groups)) {
      for (const w of words) {
        const re = new RegExp(`(^|[^a-z])${w.replace(/[-]/g, "\\-")}(?=[^a-z]|$)`, "i");
        if (re.test(t)) { scores[cat] += Number(weight); if (weight === "3") strong[cat] = true; }
      }
    }
  }
  Object.defineProperty(scores, "strong", { value: strong, enumerable: false });
  return scores;
}

function hasComplaintSignal(text) {
  return scoreCategories(text).complaint >= 3;
}

// Next occurrence of a day/month on or after today, unless a year is given.
function resolveDate(day, month, year, today) {
  if (year) {
    const iso = `${year}-${pad(month)}-${pad(day)}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  const y = Number(today.slice(0, 4));
  for (const candidate of [y, y + 1]) {
    const iso = `${candidate}-${pad(month)}-${pad(day)}`;
    if (isValidIsoDate(iso) && iso >= today) return iso;
  }
  return null;
}

function resolveMonth(month, year, today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const yy = year ? Number(year) : month >= m ? y : y + 1;
  return `${yy}-${pad(month)}`;
}

function extractDates(text, today) {
  const t = text.toLowerCase();
  const out = { check_in: null, check_out: null, nights: null, month: null };

  let m = t.match(new RegExp(`(\\d{4}-\\d{2}-\\d{2})\\s*(?:-|–|to|till|until)\\s*(\\d{4}-\\d{2}-\\d{2})`));
  if (m && isValidIsoDate(m[1]) && isValidIsoDate(m[2])) { out.check_in = m[1]; out.check_out = m[2]; }

  if (!out.check_in) {
    // "14 nov to 16 nov 2026"
    m = t.match(new RegExp(`\\b(\\d{1,2})${ORD}\\s+${MONTH_RE}\\s*(?:-|–|to|till|until)\\s*(\\d{1,2})${ORD}\\s+${MONTH_RE}(?:,?\\s*(\\d{4}))?`));
    if (m) {
      out.check_in = resolveDate(+m[1], MONTHS[m[2]], m[5], today);
      out.check_out = out.check_in && resolveDate(+m[3], MONTHS[m[4]], m[5] || out.check_in.slice(0, 4), today);
    }
  }
  if (!out.check_in) {
    // "14-16 nov", "14th to 16th of november 2026"
    m = t.match(new RegExp(`\\b(\\d{1,2})${ORD}\\s*(?:-|–|to|till|until|and)\\s*(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s*(\\d{4}))?`));
    if (m) {
      out.check_in = resolveDate(+m[1], MONTHS[m[3]], m[4], today);
      if (out.check_in) {
        const y = Number(out.check_in.slice(0, 4));
        out.check_out = +m[2] > +m[1] ? resolveDate(+m[2], MONTHS[m[3]], y, today) : null;
      }
    }
  }
  if (!out.check_in) {
    m = t.match(new RegExp(`\\b(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s*(\\d{4}))?`)) ||
        t.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})${ORD}\\b(?:,?\\s*(\\d{4}))?`));
    if (m) {
      const [day, mon] = /^\d/.test(m[1]) ? [+m[1], MONTHS[m[2]]] : [+m[2], MONTHS[m[1]]];
      out.check_in = resolveDate(day, mon, m[3], today);
    }
  }

  m = t.match(new RegExp(`\\b${NUM}\\s*(?:-\\s*)?nights?\\b`));
  if (m) out.nights = toNum(m[1]);

  if (out.check_in && out.check_out) {
    const n = diffDays(out.check_in, out.check_out);
    if (n > 0) out.nights = n; else out.check_out = null;
  }
  if (out.check_in && !out.check_out && out.nights) out.check_out = addDays(out.check_in, out.nights);

  if (!out.check_in) {
    m = t.match(new RegExp(`\\b${MONTH_RE}\\b(?:\\s*(\\d{4}))?`));
    if (m) out.month = resolveMonth(MONTHS[m[1]], m[2], today);
  } else {
    out.month = out.check_in.slice(0, 7);
  }
  return out;
}

function extractPeople(text) {
  const t = text.toLowerCase();
  const out = { adults: null, children: null, guests: null, rooms: null };
  let m = t.match(new RegExp(`\\b${NUM}\\s+adults?\\b`));
  if (m) out.adults = toNum(m[1]);
  m = t.match(new RegExp(`\\b${NUM}\\s+(?:child|children|kids?)\\b`));
  if (m) out.children = toNum(m[1]);
  if (!out.adults && /\b(couple|my wife and i|my husband and i|two of us)\b/.test(t)) out.adults = 2;
  m = t.match(/\b(?:team|group|batch|party) of\s+(\d{1,4})\b/) ||
      t.match(/\b(\d{1,4})\s*(?:\+\s*)?(?:guests|people|pax|persons|members|delegates|attendees|participants|employees|colleagues|log|janaru)\b/);
  if (m) out.guests = Number(m[1]);
  m = t.match(new RegExp(`\\b${NUM}\\s+(?:rooms?|villas?|suites?)\\b`));
  if (m) out.rooms = toNum(m[1]);
  if (!out.guests && (out.adults || out.children)) out.guests = (out.adults || 0) + (out.children || 0);
  return out;
}

function extractBudget(text) {
  const t = text.toLowerCase().replace(/,/g, "");
  const m = t.match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l\b|k\b|crores?)?/) ||
            t.match(/\b(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|k|crores?)\b(?=[^.]*\b(?:budget|total|max|maximum)\b)|\bbudget\D{0,20}(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|k|crores?)?/);
  if (!m) return null;
  const value = Number(m[1] ?? m[3]);
  const unit = (m[2] ?? m[4] ?? "").toLowerCase();
  if (!Number.isFinite(value)) return null;
  const mult = unit.startsWith("crore") ? 1e7 : unit.startsWith("la") || unit === "l" ? 1e5 : unit === "k" ? 1e3 : 1;
  return Math.round(value * mult);
}

function extractRoomPreference(text) {
  const t = text.toLowerCase();
  if (/\bpool villa\b/.test(t)) return "pool_villa";
  if (/\bvillas?\b|\bcottages?\b/.test(t)) return "villa";
  if (/\bsuites?\b/.test(t)) return "suite";
  if (/\brooms?\b/.test(t)) return "room";
  return null;
}

function extractAll(text, today = todayIST()) {
  return { ...extractDates(text, today), ...extractPeople(text), budget_inr: extractBudget(text), room_preference: extractRoomPreference(text) };
}

function classify(text) {
  const scores = scoreCategories(text);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [[top, topScore], [, second]] = ranked;
  // A complaint always wins: an unhappy guest asking about rooms is still a complaint.
  if (scores.complaint >= 3) return { category: "complaint", confidence: scores.complaint >= 6 || second < 3 ? 0.85 : 0.7, scores };
  if (topScore === 0) return { category: "other", confidence: 0.3, scores };
  let confidence = 0.5 + 0.35 * ((topScore - second) / topScore);
  if (!scores.strong[top]) confidence = Math.min(confidence, 0.6); // supporting words alone never route
  return { category: top, confidence: Math.round(confidence * 100) / 100, scores };
}

const CATEGORY_LABEL = {
  room_booking: "Room booking", wedding: "Wedding", corporate_offsite: "Corporate offsite", complaint: "Complaint", other: "Other",
};

function summarise(category, x) {
  const bits = [CATEGORY_LABEL[category]];
  if (x.check_in) bits.push(`${x.check_in}${x.check_out ? ` → ${x.check_out}` : ""}`);
  else if (x.month) bits.push(`around ${x.month}`);
  if (x.nights) bits.push(`${x.nights} night${x.nights > 1 ? "s" : ""}`);
  if (x.adults) bits.push(`${x.adults} adult${x.adults > 1 ? "s" : ""}${x.children ? ` + ${x.children} child${x.children > 1 ? "ren" : ""}` : ""}`);
  else if (x.guests) bits.push(`${x.guests} guests`);
  if (x.budget_inr) bits.push(`budget ₹${x.budget_inr.toLocaleString("en-IN")}`);
  return bits.join(" · ");
}

function rulesClassify(message, today = todayIST()) {
  const { category, confidence } = classify(message);
  const extracted = extractAll(message, today);
  return { category, confidence, extracted, summary: summarise(category, extracted), draft: null };
}

module.exports = { rulesClassify, classify, extractAll, extractDates, extractPeople, extractBudget, hasComplaintSignal, scoreCategories, summarise, CATEGORY_LABEL };
