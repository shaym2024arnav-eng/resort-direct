const { z } = require("zod");
const config = require("../config");
const { isValidIsoDate, diffDays, todayIST } = require("./dates");

const isoDate = z.string().refine(isValidIsoDate, "must be a valid date (YYYY-MM-DD)");

// Shared by search, quote and booking.
const stayFields = {
  checkIn: isoDate,
  checkOut: isoDate,
  adults: z.coerce.number().int().min(1).max(16),
  children: z.coerce.number().int().min(0).max(8).default(0),
  rooms: z.coerce.number().int().min(1).max(config.maxRoomsPerBooking).default(1),
};

function refineStay(s, ctx) {
  const nights = diffDays(s.checkIn, s.checkOut);
  const today = todayIST();
  if (s.checkIn < today) ctx.addIssue({ code: "custom", path: ["checkIn"], message: "can't be in the past" });
  if (diffDays(today, s.checkIn) > config.bookingWindowDays)
    ctx.addIssue({ code: "custom", path: ["checkIn"], message: `we take bookings up to ${config.bookingWindowDays} days ahead` });
  if (nights < 1) ctx.addIssue({ code: "custom", path: ["checkOut"], message: "must be after check-in" });
  if (nights > config.maxNights)
    ctx.addIssue({ code: "custom", path: ["checkOut"], message: `stays of more than ${config.maxNights} nights are handled by our team — please send an enquiry` });
}

const stayQuery = z.object(stayFields).superRefine(refineStay);

const quoteBody = z
  .object({
    ...stayFields,
    roomType: z.string().min(1).max(60),
    plan: z.string().min(1).max(10),
    promoCode: z.string().trim().max(30).optional().default(""),
  })
  .superRefine(refineStay);

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{8,18}$/, "must be a valid phone number");

const bookingBody = z
  .object({
    ...stayFields,
    roomType: z.string().min(1).max(60),
    plan: z.string().min(1).max(10),
    promoCode: z.string().trim().max(30).optional().default(""),
    guestName: z.string().trim().min(2).max(80),
    guestEmail: z.email().max(120),
    guestPhone: phone,
    specialRequests: z.string().trim().max(500).optional().default(""),
    consent: z.literal(true, { message: "please agree to the privacy notice to continue" }),
  })
  .superRefine(refineStay);

module.exports = { z, isoDate, stayQuery, quoteBody, bookingBody, phone };
