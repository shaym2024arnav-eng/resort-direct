const { Pool, types } = require("pg");
const config = require("../config");

// Return DATE columns as plain "YYYY-MM-DD" strings instead of JS Dates,
// so a stay date never shifts by a day because of time zones.
types.setTypeParser(1082, (v) => v);
// NUMERIC as JS numbers (percentages and confidences only; money is integer paise).
types.setTypeParser(1700, (v) => Number(v));

const needsSsl = /sslmode=require|neon\.tech/.test(config.databaseUrl);
const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

// Run fn inside a transaction; commits on success, rolls back on any error.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
