// Gemini classifier. Returns structured JSON that is validated before anything uses it.
// It is never trusted for prices: drafts must use the {{PRICE_QUOTE}} placeholder and any
// amount it writes anyway is stripped by the price guard in enquiries.js.

const { z } = require("zod");
const config = require("../config");

const CATEGORIES = ["room_booking", "wedding", "corporate_offsite", "complaint", "other"];

const nullableString = { type: ["string", "null"] };
const nullableInt = { type: ["integer", "null"] };

const responseJsonSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: CATEGORIES },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    summary: { type: "string", description: "One line for staff, max 140 characters." },
    check_in: { ...nullableString, description: "YYYY-MM-DD or null" },
    check_out: { ...nullableString, description: "YYYY-MM-DD or null" },
    month: { ...nullableString, description: "YYYY-MM if only a month is known, else null" },
    nights: nullableInt,
    adults: nullableInt,
    children: nullableInt,
    guests: nullableInt,
    rooms: nullableInt,
    budget_inr: nullableInt,
    room_preference: { type: ["string", "null"], enum: ["room", "suite", "villa", "pool_villa", null] },
    draft: { type: "string", description: "Reply draft for staff to edit. No prices; use {{PRICE_QUOTE}}." },
  },
  required: ["category", "confidence", "summary", "check_in", "check_out", "month", "nights", "adults", "children",
             "guests", "rooms", "budget_inr", "room_preference", "draft"],
};

const resultSchema = z.object({
  category: z.enum(CATEGORIES),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(400),
  check_in: z.string().nullable(),
  check_out: z.string().nullable(),
  month: z.string().nullable(),
  nights: z.number().int().nullable(),
  adults: z.number().int().nullable(),
  children: z.number().int().nullable(),
  guests: z.number().int().nullable(),
  rooms: z.number().int().nullable(),
  budget_inr: z.number().int().nullable(),
  room_preference: z.enum(["room", "suite", "villa", "pool_villa"]).nullable(),
  draft: z.string().max(4000),
});

function systemInstruction(today) {
  return `You triage guest enquiries for Kaapi Hills, a coffee-estate resort in Chikkamagaluru, Karnataka (64 rooms, 12 villas).
Today's date is ${today} (India). Resolve relative dates ("next weekend", "14-16 Nov") to YYYY-MM-DD, choosing the next future occurrence.

Categories:
- room_booking: a guest asking about staying (availability, rooms, villas, rates for a stay).
- wedding: weddings, receptions, engagement, sangeet, family functions with many guests.
- corporate_offsite: company teams, offsites, conferences, meetings, workshops.
- complaint: anything unhappy about a past or current stay, billing, staff or service. If a message is BOTH a complaint and a request, choose complaint.
- other: anything else, or when you cannot tell.

Confidence: your honest probability (0-1) that the category is right. Use below 0.7 when the message is vague, mixed, or not clearly one category. Messages may mix English with Kannada, Hindi or Tamil.

Extraction: only fields the guest actually stated or that follow directly (e.g. nights from two dates). Use null otherwise; never guess.

Draft: a short, warm reply (under 120 words) from "Reservations, Kaapi Hills" addressed to the guest by first name. NEVER write any price, rate, amount or discount. For room bookings put the exact token {{PRICE_QUOTE}} on its own line where prices belong; the system fills it from the live rate table. For weddings and offsites, say the events team will send a tailored proposal and ask for anything missing (dates, guest count, budget). For complaints, apologise sincerely, promise the General Manager will personally follow up, and make no promises about refunds or compensation. Do not invent facilities or policies.`;
}

let client = null;
function getClient() {
  if (!config.geminiApiKey) return null;
  if (!client) {
    const { GoogleGenAI } = require("@google/genai");
    client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
  return client;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`AI timed out after ${ms / 1000}s`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** classifier(enquiry, { today }) -> validated result. Throws on any failure (caller falls back to rules). */
async function geminiClassify(enquiry, { today }) {
  const ai = getClient();
  if (!ai) throw new Error("No GEMINI_API_KEY configured");
  const response = await withTimeout(
    ai.models.generateContent({
      model: config.geminiModel,
      contents: `Channel: ${enquiry.channel}\nGuest name: ${enquiry.name}\nMessage:\n"""${enquiry.message}"""`,
      config: {
        systemInstruction: systemInstruction(today),
        responseMimeType: "application/json",
        responseJsonSchema,
        temperature: 0,
      },
    }),
    15000
  );
  return parseResult(response.text);
}

function parseResult(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("AI returned something that isn't JSON"); }
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) throw new Error(`AI response failed validation: ${parsed.error.issues[0].path.join(".")}`);
  return parsed.data;
}

module.exports = { geminiClassify, parseResult, getClient, systemInstruction, CATEGORIES };
