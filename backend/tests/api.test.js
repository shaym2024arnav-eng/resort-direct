// HTTP-level checks: sign-in, roles and access control, validation, the full booking flow, admin and export.
const request = require("supertest");
const app = require("../src/app");
const { pool, resetDb, inventoryRow } = require("./helpers");
const { addDays, todayIST } = require("../src/lib/dates");

const today = todayIST();
let guest, guest2, staff, gm, anon;

async function login(email, password) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  await resetDb({ enquiries: true });
  guest = await login("guest@kaapihills.test", "Guest@123");
  guest2 = await login("sneha.p@example.com", "Guest@123");
  staff = await login("reservations@kaapihills.test", "Staff@123");
  gm = await login("gm@kaapihills.test", "Gm@12345");
  anon = request(app);
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300)); // let background enquiry processing finish
  await pool.end();
});

describe("auth and access control", () => {
  test("wrong password gives one generic message", async () => {
    const res = await anon.post("/api/auth/login").send({ email: "guest@kaapihills.test", password: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("That email and password don't match.");
  });

  test("session cookie is httpOnly", async () => {
    const res = await anon.post("/api/auth/login").send({ email: "guest@kaapihills.test", password: "Guest@123" });
    expect(res.headers["set-cookie"][0]).toMatch(/HttpOnly/);
    expect(res.headers["set-cookie"][0]).toMatch(/SameSite=Lax/);
  });

  test("self sign-up always creates a guest, even if a role is sent", async () => {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/register").send({ name: "New Person", email: "new@example.com", password: "longenough1", role: "gm" });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("guest");
    expect((await agent.get("/api/staff/enquiries")).status).toBe(403);
  });

  test("staff routes: 401 signed out, 403 for guests, 200 for staff", async () => {
    expect((await anon.get("/api/staff/inventory")).status).toBe(401);
    expect((await guest.get("/api/staff/inventory")).status).toBe(403);
    expect((await guest.put("/api/staff/inventory").send({})).status).toBe(403);
    expect((await guest.get("/api/staff/bookings/export.csv")).status).toBe(403);
    expect((await staff.get("/api/staff/inventory")).status).toBe(200);
  });

  test("GM alerts are GM-only", async () => {
    expect((await staff.get("/api/staff/alerts")).status).toBe(403);
    const res = await gm.get("/api/staff/alerts");
    expect(res.status).toBe(200);
    expect(res.body.alerts.length).toBeGreaterThan(0);
  });
});

describe("guest booking flow", () => {
  const checkIn = addDays(today, 20);
  const checkOut = addDays(today, 22);
  let ref;

  test("search returns prices with GST and a status per room type", async () => {
    const res = await anon.get("/api/availability").query({ checkIn, checkOut, adults: 2, children: 0, rooms: 1 });
    expect(res.status).toBe(200);
    const estate = res.body.results.find((r) => r.slug === "estate-room");
    expect(estate.status).toBe("available");
    expect(estate.plans.map((p) => p.code)).toEqual(["RO", "BB", "NRF"]);
    expect(estate.plans[0].price.taxPaise).toBeGreaterThan(0);
    const pool = res.body.results.find((r) => r.slug === "pool-villa");
    expect(pool.status).toBe("closed"); // seeded maintenance blackout
  });

  test("bad input is rejected with a readable message", async () => {
    let res = await anon.get("/api/availability").query({ checkIn: addDays(today, -1), checkOut, adults: 2 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/checkIn: can't be in the past/);
    res = await anon.get("/api/availability").query({ checkIn, checkOut: checkIn, adults: 2 });
    expect(res.body.message).toMatch(/checkOut: must be after check-in/);
    res = await anon.get("/api/availability").query({ checkIn: "2026-02-30", checkOut, adults: 2 });
    expect(res.status).toBe(400);
  });

  test("booking needs sign-in and consent", async () => {
    const body = { roomType: "estate-room", plan: "BB", checkIn, checkOut, adults: 2, children: 0, rooms: 1, guestName: "Ananya Rao", guestEmail: "guest@kaapihills.test", guestPhone: "+91 90000 11111" };
    expect((await anon.post("/api/bookings").send({ ...body, consent: true })).status).toBe(401);
    const noConsent = await guest.post("/api/bookings").send(body);
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.message).toMatch(/consent/);
    const res = await guest.post("/api/bookings").send({ ...body, consent: true, promoCode: "DIRECT10" });
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe("held");
    expect(res.body.booking.price.promoDiscountPaise).toBeGreaterThan(0);
    ref = res.body.booking.ref;
  });

  test("another guest can't see or pay for it", async () => {
    expect((await guest2.get(`/api/bookings/${ref}`)).status).toBe(404);
    expect((await guest2.post(`/api/bookings/${ref}/pay`).send({ cardNumber: "4242424242424242", expiry: "12/30", cvc: "123", nameOnCard: "X Y" })).status).toBe(404);
  });

  test("staff can't book online", async () => {
    const res = await staff.post("/api/bookings").send({});
    expect(res.status).toBe(403);
  });

  test("declined card, then success", async () => {
    const bad = await guest.post(`/api/bookings/${ref}/pay`).send({ cardNumber: "4000 0000 0000 0002", expiry: "12/30", cvc: "123", nameOnCard: "Ananya Rao" });
    expect(bad.status).toBe(402);
    const ok = await guest.post(`/api/bookings/${ref}/pay`).send({ cardNumber: "4242 4242 4242 4242", expiry: "12/30", cvc: "123", nameOnCard: "Ananya Rao" });
    expect(ok.status).toBe(200);
    expect(ok.body.booking.status).toBe("confirmed");
    const mine = await guest.get("/api/bookings/mine");
    expect(mine.body.bookings.some((b) => b.ref === ref)).toBe(true);
  });

  test("the confirmed booking appears in today's CSV export", async () => {
    const res = await staff.get("/api/staff/bookings/export.csv").query({ date: today });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text).toContain(ref);
    expect(res.text.split("\r\n")[0]).toContain("Booking ref");
  });
});

describe("rate and allotment admin", () => {
  const day = addDays(today, 3); // seeded: pool villa sold out on this night

  test("can't drop allotment below what's already sold", async () => {
    const pv = await inventoryRow("pool-villa", day);
    expect(pv.sold).toBe(1);
    const res = await staff.put("/api/staff/inventory").send({ roomTypeIds: [pv.room_type_id], from: day, to: day, allotment: 0 });
    expect(res.status).toBe(409);
    expect(res.body.details[0]).toMatchObject({ date: day, sold: 1 });
    expect((await inventoryRow("pool-villa", day)).allotment).toBe(1);
  });

  test("can't allot more than the resort physically has", async () => {
    const pv = await inventoryRow("pool-villa", addDays(today, 50));
    const res = await staff.put("/api/staff/inventory").send({ roomTypeIds: [pv.room_type_id], from: addDays(today, 50), to: addDays(today, 50), allotment: 5 });
    expect(res.status).toBe(400);
  });

  test("bulk-edit rates on weekends only and set a blackout", async () => {
    const er = await inventoryRow("estate-room", addDays(today, 60));
    const from = addDays(today, 56), to = addDays(today, 69);
    const res = await staff.put("/api/staff/inventory").send({ roomTypeIds: [er.room_type_id], from, to, weekdays: [5, 6], ratePaise: 900000 });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(4);
    const blk = await staff.put("/api/staff/inventory").send({ roomTypeIds: [er.room_type_id], from, to: from, closed: true });
    expect(blk.body.updated).toBe(1);
    expect((await inventoryRow("estate-room", from)).closed).toBe(true);
  });

  test("promo codes can be created and switched off", async () => {
    const res = await staff.post("/api/staff/promos").send({ code: "winter12", discountPct: 12, minNights: 2, validFrom: today, validTo: addDays(today, 90) });
    expect(res.status).toBe(201);
    expect(res.body.promo.code).toBe("WINTER12");
    const off = await staff.patch(`/api/staff/promos/${res.body.promo.id}`).send({ active: false });
    expect(off.body.promo.active).toBe(false);
  });
});

describe("enquiries", () => {
  test("public web form accepts an enquiry and it gets classified", async () => {
    const res = await anon.post("/api/enquiries").send({ name: "Test Person", email: "t@example.com", message: "Is a villa free 14-16 Nov for 2 adults and a child?", consent: true });
    expect(res.status).toBe(201);
    let e;
    for (let i = 0; i < 20; i++) {
      e = (await staff.get(`/api/staff/enquiries/${res.body.ref}`)).body.enquiry;
      if (e.processing === "done") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(e.category).toBe("room_booking");
  });

  test("event form requires a date or month, and lands as a wedding with sales", async () => {
    const bad = await anon.post("/api/enquiries/event").send({ name: "A B", email: "a@example.com", eventType: "wedding", guests: 200, consent: true });
    expect(bad.status).toBe(400);
    const ok = await anon.post("/api/enquiries/event").send({ name: "A B", email: "a@example.com", eventType: "wedding", month: "2027-02", nights: 2, guests: 200, roomsNeeded: 40, needs: ["venue", "catering"], consent: true });
    expect(ok.status).toBe(201);
  });

  test("simulated WhatsApp message lands in the inbox, classified", async () => {
    const res = await staff.post("/api/staff/inbound").send({ channel: "whatsapp", name: "Ravi K", contact: "+91 90000 12345", message: "The room was dirty and nobody answered the phone. Very disappointed." });
    expect(res.status).toBe(201);
    expect(res.body.enquiry.category).toBe("complaint");
    expect(res.body.enquiry.needs_gm).toBe(true);
  });

  test("inbox lanes and metrics", async () => {
    const res = await staff.get("/api/staff/enquiries").query({ lane: "unsorted" });
    expect(res.status).toBe(200);
    expect(res.body.items.every((e) => e.lane === "unsorted")).toBe(true);
    const m = await staff.get("/api/staff/metrics");
    expect(m.body.metrics.overbooked_nights).toBe(0);
    expect(m.body.metrics.median_first_reply_min).toBeLessThan(30);
  });
});
