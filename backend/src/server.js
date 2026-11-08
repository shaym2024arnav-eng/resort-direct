const config = require("./config");
const app = require("./app");
const { migrate } = require("./db/migrate");
const { releaseExpiredHolds } = require("./services/inventory");
const { processPending } = require("./router/enquiries");

async function start() {
  await migrate();
  app.listen(config.port, () => console.log(`Kaapi Hills API listening on http://localhost:${config.port}`));

  // Background sweeper: release expired holds and retry enquiries whose processing failed.
  // (Holds are also released lazily before every availability check, so this is a backstop.)
  setInterval(() => {
    releaseExpiredHolds().catch((err) => console.error("Hold sweeper:", err.message));
    processPending().catch((err) => console.error("Enquiry retry:", err.message));
  }, 60 * 1000).unref();
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
