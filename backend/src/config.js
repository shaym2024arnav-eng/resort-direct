require("dotenv").config({ quiet: true });

const isTest = process.env.NODE_ENV === "test";

const config = {
  isProd: process.env.NODE_ENV === "production",
  isTest,
  port: Number(process.env.PORT) || 5000,
  databaseUrl: isTest ? process.env.TEST_DATABASE_URL || process.env.DATABASE_URL : process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || (isTest ? "test-secret-not-for-production" : ""),
  geminiApiKey: isTest ? "" : process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  clientOrigin: process.env.CLIENT_ORIGIN || "",

  // Business rules (all labelled as assumptions in the TDD).
  holdMinutes: 10,              // a guest has 10 minutes to pay before the rooms are released
  maxNights: 14,
  maxRoomsPerBooking: 4,
  bookingWindowDays: 365,
  gstThresholdPaise: 750000,    // ₹7,500 per room per night
  gstLowPct: 5,
  gstHighPct: 18,
  routingConfidence: 0.7,       // below this, an enquiry goes to the unsorted lane
};

if (!config.jwtSecret) throw new Error("JWT_SECRET is not set.");
if (!config.databaseUrl) throw new Error("DATABASE_URL is not set.");

module.exports = config;
