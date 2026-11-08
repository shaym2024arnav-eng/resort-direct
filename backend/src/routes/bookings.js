const express = require("express");
const { z, bookingBody } = require("../lib/validate");
const { requireAuth } = require("../middleware/auth");
const inventory = require("../services/inventory");
const { forbidden } = require("../lib/errors");

const router = express.Router();
router.use(requireAuth);

const guestOnly = (req, res, next) => (req.user.role === "guest" ? next() : next(forbidden("Staff accounts can't make online bookings. Please sign in as a guest.")));

router.get("/mine", async (req, res) => {
  const rows = await inventory.listBookingsForUser(req.user);
  res.json({ bookings: rows.map(inventory.publicBooking) });
});

// Step 2 of checkout: hold the rooms for 10 minutes.
router.post("/", guestOnly, async (req, res) => {
  const input = bookingBody.parse(req.body);
  const held = await inventory.createHold(req.user, input);
  const booking = await inventory.getBookingForUser(req.user, held.ref);
  res.status(201).json({ booking: inventory.publicBooking(booking) });
});

router.get("/:ref", async (req, res) => {
  await inventory.releaseExpiredHolds();
  const booking = await inventory.getBookingForUser(req.user, req.params.ref);
  res.json({ booking: inventory.publicBooking(booking) });
});

const cardSchema = z.object({
  cardNumber: z.string().regex(/^[\d ]{12,23}$/, "must be a card number"),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, "must be MM/YY").refine((v) => {
    const [mm, yy] = v.split("/").map(Number);
    const now = new Date();
    return 2000 + yy > now.getFullYear() || (2000 + yy === now.getFullYear() && mm >= now.getMonth() + 1);
  }, "card has expired"),
  cvc: z.string().regex(/^\d{3,4}$/, "must be 3 or 4 digits"),
  nameOnCard: z.string().trim().min(2).max(80),
});

// Step 3: test payment. Card details are checked and discarded — never stored or logged.
router.post("/:ref/pay", guestOnly, async (req, res) => {
  const card = cardSchema.parse(req.body);
  await inventory.confirmPayment(req.user, req.params.ref, card);
  const booking = await inventory.getBookingForUser(req.user, req.params.ref);
  res.json({ booking: inventory.publicBooking(booking) });
});

router.post("/:ref/cancel", guestOnly, async (req, res) => {
  await inventory.cancelBooking(req.user, req.params.ref);
  const booking = await inventory.getBookingForUser(req.user, req.params.ref);
  res.json({ booking: inventory.publicBooking(booking) });
});

module.exports = router;
