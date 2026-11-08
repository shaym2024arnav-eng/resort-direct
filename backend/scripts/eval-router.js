// Measure the enquiry router on a labelled set.
//   npm run eval              -> rule-based classifier (no key needed)
//   GEMINI_API_KEY=... npm run eval -> also Gemini, side by side
// Reports accuracy, how many would auto-route (confidence >= 0.7), and accuracy among those
// auto-routed — the number that matters, because anything below the bar is checked by a person.

require("dotenv").config({ quiet: true });
process.env.DATABASE_URL ||= "postgres://unused"; // config requires it; this script never touches the DB
const config = require("../src/config");
const cases = require("./enquiry-eval.json");
const { rulesClassify } = require("../src/router/rules");
const { geminiClassify } = require("../src/router/gemini");
const { todayIST } = require("../src/lib/dates");

const CATS = ["room_booking", "wedding", "corporate_offsite", "complaint", "other"];

function report(name, results) {
  const correct = results.filter((r) => r.pred === r.label).length;
  const routed = results.filter((r) => r.confidence >= config.routingConfidence && r.pred !== "other");
  const routedCorrect = routed.filter((r) => r.pred === r.label).length;
  const complaints = results.filter((r) => r.label === "complaint");
  const complaintsCaught = complaints.filter((r) => r.pred === "complaint" || r.gmAlert).length;
  console.log(`\n=== ${name} ===`);
  console.log(`Accuracy:               ${correct}/${results.length} (${Math.round((100 * correct) / results.length)}%)`);
  console.log(`Auto-routed:            ${routed.length}/${results.length} (rest go to the unsorted lane)`);
  console.log(`Accuracy when routed:   ${routedCorrect}/${routed.length} (${routed.length ? Math.round((100 * routedCorrect) / routed.length) : 0}%)`);
  console.log(`Complaints reaching GM: ${complaintsCaught}/${complaints.length}`);
  console.log("\nConfusion (rows = true label, cols = predicted):");
  console.log(["".padEnd(18), ...CATS.map((c) => c.slice(0, 9).padEnd(10))].join(""));
  for (const t of CATS) {
    console.log([t.padEnd(18), ...CATS.map((p) => String(results.filter((r) => r.label === t && r.pred === p).length).padEnd(10))].join(""));
  }
  const misses = results.filter((r) => r.pred !== r.label);
  if (misses.length) {
    console.log("\nMisses:");
    for (const m of misses) console.log(`  [${m.label} -> ${m.pred} @ ${m.confidence}] ${m.message}`);
  }
}

(async () => {
  const today = todayIST();
  const { hasComplaintSignal } = require("../src/router/rules");
  const rules = cases.map((c) => {
    const r = rulesClassify(c.message, today);
    return { ...c, pred: r.category, confidence: r.confidence, gmAlert: hasComplaintSignal(c.message) };
  });
  report("Rule-based fallback — tuning set (keywords were written against these; optimistic)", rules.filter((r) => r.set === "tuning"));
  report("Rule-based fallback — HELD-OUT set (not used to tune the rules)", rules.filter((r) => r.set === "holdout"));

  if (!config.geminiApiKey) {
    console.log("\n(Set GEMINI_API_KEY to evaluate Gemini as well.)");
    return;
  }
  // Free-tier keys allow only a few requests per minute (and per day), so pace the calls
  // and allow testing just the held-out set:  npm run eval -- --holdout
  const onlyHoldout = process.argv.includes("--holdout");
  const delayMs = Number(process.env.EVAL_DELAY_MS ?? 4500);
  const todo = onlyHoldout ? cases.filter((c) => c.set === "holdout") : cases;
  console.log(`\nCalling Gemini for ${todo.length} messages (${delayMs / 1000}s apart, about ${Math.ceil((todo.length * delayMs) / 60000)} min)...`);
  const ai = [];
  for (const [i, c] of todo.entries()) {
    if (i) await new Promise((r) => setTimeout(r, delayMs));
    process.stdout.write(`  ${i + 1}/${todo.length}\r`);
    try {
      const r = await geminiClassify({ channel: "web", name: "Guest", message: c.message }, { today });
      ai.push({ ...c, pred: r.category, confidence: r.confidence, gmAlert: hasComplaintSignal(c.message) });
    } catch (err) {
      ai.push({ ...c, pred: "error", confidence: 0, gmAlert: hasComplaintSignal(c.message), error: err.message });
    }
  }
  const errs = [...new Set(ai.filter((r) => r.error).map((r) => r.error))];
  if (errs.length) {
    console.log(`\n!! ${ai.filter((r) => r.error).length}/${ai.length} Gemini calls failed. Distinct errors:`);
    for (const e of errs.slice(0, 5)) console.log(`   - ${e}`);
  }
  report(`Gemini (${config.geminiModel}) — all ${ai.length} cases`, ai);
  report(`Gemini (${config.geminiModel}) — held-out set`, ai.filter((r) => r.set === "holdout"));
})();
