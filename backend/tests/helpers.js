const { pool } = require("../src/db/pool");
const { migrate } = require("../src/db/migrate");
const { seed } = require("../src/db/seed");

// Fresh schema + demo data for each test file.
async function resetDb({ enquiries = false } = {}) {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate();
  await seed({ days: 120, enquiries });
}

async function roomType(slug) {
  const { rows } = await pool.query("SELECT * FROM room_types WHERE slug = $1", [slug]);
  return rows[0];
}

async function inventoryRow(slug, date) {
  const { rows } = await pool.query(
    "SELECT i.* FROM inventory i JOIN room_types rt ON rt.id = i.room_type_id WHERE rt.slug = $1 AND i.stay_date = $2",
    [slug, date]
  );
  return rows[0];
}

async function makeGuests(n) {
  const { rows: [{ password_hash }] } = await pool.query("SELECT password_hash FROM users WHERE email = 'guest@kaapihills.test'");
  const users = [];
  for (let i = 0; i < n; i++) {
    const { rows: [u] } = await pool.query(
      "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'guest') RETURNING id, role, name",
      [`load-${i}-${Date.now()}@example.com`, password_hash, `Load Guest ${i}`]
    );
    users.push(u);
  }
  return users;
}

const bookingInput = (over = {}) => ({
  roomType: "pool-villa", plan: "RO", checkIn: "", checkOut: "", adults: 2, children: 0, rooms: 1, promoCode: "",
  guestName: "Test Guest", guestEmail: "test@example.com", guestPhone: "+91 90000 99999", specialRequests: "", consent: true, ...over,
});

module.exports = { pool, resetDb, roomType, inventoryRow, makeGuests, bookingInput };
