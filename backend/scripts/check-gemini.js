// Quick Gemini check: which model the app will use, and which models your key can call right now.
//   node scripts/check-gemini.js
require("dotenv").config({ quiet: true });
process.env.DATABASE_URL ||= "postgres://unused";
const config = require("../src/config");
const { GoogleGenAI } = require("@google/genai");

const candidates = [config.geminiModel, "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-omni-1.2-flash"]
  .filter((m, i, all) => all.indexOf(m) === i);

(async () => {
  console.log(`Key found: ${config.geminiApiKey ? "yes" : "NO"}`);
  console.log(`App will use: ${config.geminiModel}\n`);
  if (!config.geminiApiKey) return;
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  for (const model of candidates) {
    try {
      await ai.models.generateContent({ model, contents: "Reply with the word OK." });
      console.log(`OK    ${model}`);
    } catch (err) {
      const msg = String(err.message);
      const code = (msg.match(/"code":\s*(\d+)/) || [])[1] || "?";
      const billed = (msg.match(/"model":\s*"([^"]+)"/) || [])[1];
      const why = code === "429" ? `quota used up${billed ? ` (counted against ${billed})` : ""}`
        : code === "404" ? "model not available to this key"
        : code === "403" || code === "400" ? "key rejected" : msg.slice(0, 120);
      console.log(`FAIL  ${model}  [${code}] ${why}`);
    }
  }
})();
