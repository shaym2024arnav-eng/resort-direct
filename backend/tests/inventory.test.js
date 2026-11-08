// The hard part: the website must never sell more than the allotment.
const { pool, resetDb, inventoryRow, makeGuests, bookingInput } = require("./helpers");
const inventory = require("../src/services/inventory");
const { addDays, todayIST } = require("../src/lib/dates");

const today = todayIST();
const D60 = addDays(today, 60);
const D61 = addDays(today, 61);
const D62 = addDays(today, 62);
const card = { cardNumber: "4242 4242 4242 4242", expiry: "12/30", cvc: "123", nameOnCard: "Test Guest" };

beforeAll(() => resetDb());
afterAll(() => pool.end());

test("20 guests racing for the last pool villa: exactly one gets it", async () => {
  const before = await inventoryRow("pool-villa", D60);
  expect(before.allotment - before.sold - before.held).toBe(1);

  const guests = await makeGuests(20);
  const results = await Promise.allSettled(
    guests.map((g) => inventory.createHold(g, bookingInput({ checkIn: D60, checkOut: D61 })))
  );
  const ok = results.filter((r) => r.status === "fulfilled");
  const failed = results.filter((r) => r.status === "rejected");
  expect(ok).toHaveLength(1);
  expect(failed).toHaveLength(19);
  for (const f of failed) expect(f.reason.status).toBe(409);

  const after = await inventoryRow("pool-villa", D60);
  expect(after.held).toBe(1);
  expect(after.sold + after.held).toBeLessThanOrEqual(after.allotment);
});

test("overlapping multi-night stays under load never exceed the allotment on any night", async () => {
  await pool.query("UPDATE inventory SET allotment = 2 WHERE room_type_id = (SELECT id FROM room_types WHERE slug = 'coffee-suite') AND stay_date BETWEEN $1 AND $2", [D60, addDays(D60, 5)]);
  const guests = await makeGuests(30);
  const ranges = [[0, 2], [1, 3], [2, 4], [0, 4], [3, 5], [1, 2]];
  await Promise.allSettled(guests.map((g, i) => {
    const [a, b] = ranges[i % ranges.length];
    return inventory.createHold(g, bookingInput({ roomType: "coffee-suite", checkIn: addDays(D60, a), checkOut: addDays(D60, b) }));
  }));
  const { rows } = await pool.query(
    `SELECT stay_date, allotment, sold, held FROM inventory WHERE room_type_id = (SELECT id FROM room_types WHERE slug = 'coffee-suite')
     AND stay_date BETWEEN $1 AND $2`, [D60, addDays(D60, 5)]);
  for (const r of rows) expect(r.sold + r.held).toBeLessThanOrEqual(r.allotment);
  // And the held counts agree exactly with the bookings that hold them.
  const { rows: [{ mismatches }] } = await pool.query(`
    SELECT COUNT(*)::int AS mismatches FROM inventory i
    WHERE i.room_type_id = (SELECT id FROM room_types WHERE slug = 'coffee-suite') AND i.stay_date BETWEEN $1 AND $2
      AND i.held <> COALESCE((SELECT SUM(b.rooms) FROM bookings b WHERE b.room_type_id = i.room_type_id AND b.status = 'held'
                              AND b.check_in <= i.stay_date AND b.check_out > i.stay_date), 0)`, [D60, addDays(D60, 5)]);
  expect(mismatches).toBe(0);
});

test("the database itself refuses to oversell, even if application code is wrong", async () => {
  await expect(
    pool.query("UPDATE inventory SET sold = allotment + 1 WHERE stay_date = $1 AND room_type_id = (SELECT id FROM room_types WHERE slug = 'estate-room')", [D62])
  ).rejects.toMatchObject({ code: "23514" });
});

test("hold -> test payment -> confirmed moves the unit from held to sold", async () => {
  const [g] = await makeGuests(1);
  const b = await inventory.createHold(g, bookingInput({ roomType: "estate-room", checkIn: D61, checkOut: D62, plan: "BB" }));
  expect(b.status).toBe("held");
  const mid = await inventoryRow("estate-room", D61);
  expect(mid.held).toBe(1);

  const confirmed = await inventory.confirmPayment(g, b.ref, card);
  expect(confirmed.status).toBe("confirmed");
  expect(confirmed.payment_ref).toMatch(/^pay_test_/);
  const after = await inventoryRow("estate-room", D61);
  expect(after.held).toBe(0);
  expect(after.sold).toBe(mid.sold + 1);

  // Paying twice is harmless.
  const again = await inventory.confirmPayment(g, b.ref, card);
  expect(again.status).toBe("confirmed");
  expect((await inventoryRow("estate-room", D61)).sold).toBe(after.sold);
});

test("a declined test card keeps the hold; another guest can't pay for it", async () => {
  const [g, other] = await makeGuests(2);
  const b = await inventory.createHold(g, bookingInput({ roomType: "valley-view-room", checkIn: D61, checkOut: D62 }));
  await expect(inventory.confirmPayment(g, b.ref, { ...card, cardNumber: "4000 0000 0000 0002" })).rejects.toMatchObject({ status: 402 });
  await expect(inventory.confirmPayment(other, b.ref, card)).rejects.toMatchObject({ status: 404 });
  expect((await inventoryRow("valley-view-room", D61)).held).toBe(1);
});

test("an expired hold releases its rooms and can no longer be paid", async () => {
  const [g] = await makeGuests(1);
  const b = await inventory.createHold(g, bookingInput({ roomType: "plantation-villa", checkIn: D62, checkOut: addDays(D62, 2), adults: 3 }));
  expect((await inventoryRow("plantation-villa", D62)).held).toBe(1);
  await pool.query("UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE ref = $1", [b.ref]);
  await expect(inventory.confirmPayment(g, b.ref, card)).rejects.toMatchObject({ status: 409 });
  expect((await inventoryRow("plantation-villa", D62)).held).toBe(0);
  expect((await inventoryRow("plantation-villa", addDays(D62, 1))).held).toBe(0);
});

test("the sweeper releases expired holds exactly once", async () => {
  const guests = await makeGuests(2);
  for (const g of guests) await inventory.createHold(g, bookingInput({ roomType: "estate-room", checkIn: addDays(today, 70), checkOut: addDays(today, 72) }));
  await pool.query("UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE status = 'held' AND check_in = $1", [addDays(today, 70)]);
  const [a, b] = await Promise.all([inventory.releaseExpiredHolds(), inventory.releaseExpiredHolds()]);
  expect(a + b).toBe(2);
  expect((await inventoryRow("estate-room", addDays(today, 70))).held).toBe(0);
});

test("blackout dates can't be booked", async () => {
  const [g] = await makeGuests(1);
  const closedDay = addDays(today, 45);
  await expect(inventory.createHold(g, bookingInput({ roomType: "estate-room", checkIn: closedDay, checkOut: addDays(closedDay, 1) }))).rejects.toMatchObject({ status: 409 });
  const results = await inventory.searchAvailability({ checkIn: closedDay, checkOut: addDays(closedDay, 1), adults: 2, children: 0, rooms: 1 });
  expect(results.every((r) => r.status === "closed")).toBe(true);
});

test("promo codes are checked: unknown, expired window, and minimum nights", async () => {
  const [g] = await makeGuests(1);
  const base = bookingInput({ roomType: "estate-room", checkIn: addDays(today, 80), checkOut: addDays(today, 81) });
  await expect(inventory.createHold(g, { ...base, promoCode: "NOPE" })).rejects.toThrow(/isn't valid/);
  await expect(inventory.createHold(g, { ...base, promoCode: "MONSOON20" })).rejects.toThrow(/valid for check-ins/);
  await expect(inventory.createHold(g, { ...base, promoCode: "DIRECT10" })).rejects.toThrow(/at least 2 nights/);
  const ok = await inventory.createHold(g, { ...base, checkOut: addDays(today, 82), promoCode: "direct10" });
  expect(ok.price.promoDiscountPaise).toBeGreaterThan(0);
  // A failed promo attempt never left anything held.
  expect((await inventoryRow("estate-room", addDays(today, 80))).held).toBe(1);
});
