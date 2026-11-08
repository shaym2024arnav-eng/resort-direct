// Pure pricing. No database access, so every rule here is unit-tested directly.
//
// Per room, per night:
//   gross   = nightly rate + extra-adult charge + breakfast (by plan)
//   unit    = gross - plan discount - promo discount          (the "value of supply per unit per day")
//   GST     = 5% if unit <= ₹7,500, else 18%                   (hotel accommodation, from 22 Sep 2025)
// The slab is decided per room per night, AFTER discounts, so a long stay can mix slabs
// (e.g. a weekday at 5% and a weekend at 18%).

const config = require("../config");
const { badRequest } = require("../lib/errors");

function gstRateFor(unitPaise) {
  return unitPaise <= config.gstThresholdPaise ? config.gstLowPct : config.gstHighPct;
}

// Spread guests across rooms as evenly as possible: 5 adults in 2 rooms -> [3, 2].
function splitEvenly(total, parts) {
  const base = Math.floor(total / parts);
  const rem = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
}

function checkOccupancy(roomType, { adults, children = 0, rooms = 1 }) {
  if (adults < rooms) return `Each room needs at least one adult.`;
  if (adults > roomType.max_adults * rooms)
    return `${roomType.name} sleeps up to ${roomType.max_adults} adults per ${roomType.kind}. Add another ${roomType.kind} or choose a larger one.`;
  if (children > roomType.max_children * rooms)
    return `${roomType.name} allows up to ${roomType.max_children} children per ${roomType.kind}.`;
  return null;
}

/**
 * @param nights   [{ date: "YYYY-MM-DD", ratePaise }]  rates come from the inventory table
 * @param roomType { name, kind, base_occupancy, extra_adult_paise, max_adults, max_children }
 * @param plan     { code, name, breakfast_per_adult_paise, discount_pct }
 * @param promo    { code, discount_pct } | null
 */
function priceStay({ nights, roomType, plan, adults, children = 0, rooms = 1, promo = null }) {
  if (!nights.length) throw badRequest("A stay needs at least one night.");
  const problem = checkOccupancy(roomType, { adults, children, rooms });
  if (problem) throw badRequest(problem);

  const adultsPerRoom = splitEvenly(adults, rooms);
  const totals = { gross: 0, planDiscount: 0, promoDiscount: 0, taxable: 0, tax: 0 };
  const taxByRate = {};

  const lines = nights.map(({ date, ratePaise }) => {
    const line = { date, ratePaise, roomCharge: 0, extraAdults: 0, breakfast: 0, planDiscount: 0, promoDiscount: 0, taxable: 0, tax: 0, gstPct: [] };
    for (const a of adultsPerRoom) {
      const extra = Math.max(0, a - roomType.base_occupancy) * roomType.extra_adult_paise;
      const breakfast = a * plan.breakfast_per_adult_paise;
      const gross = ratePaise + extra + breakfast;
      const planDiscount = Math.round((gross * plan.discount_pct) / 100);
      const afterPlan = gross - planDiscount;
      const promoDiscount = promo ? Math.round((afterPlan * promo.discount_pct) / 100) : 0;
      const unit = afterPlan - promoDiscount;
      const pct = gstRateFor(unit);
      const tax = Math.round((unit * pct) / 100);

      line.roomCharge += ratePaise;
      line.extraAdults += extra;
      line.breakfast += breakfast;
      line.planDiscount += planDiscount;
      line.promoDiscount += promoDiscount;
      line.taxable += unit;
      line.tax += tax;
      if (!line.gstPct.includes(pct)) line.gstPct.push(pct);

      taxByRate[pct] ??= { taxable: 0, tax: 0 };
      taxByRate[pct].taxable += unit;
      taxByRate[pct].tax += tax;
    }
    totals.gross += line.roomCharge + line.extraAdults + line.breakfast;
    totals.planDiscount += line.planDiscount;
    totals.promoDiscount += line.promoDiscount;
    totals.taxable += line.taxable;
    totals.tax += line.tax;
    return line;
  });

  return {
    currency: "INR",
    plan: { code: plan.code, name: plan.name },
    promo: promo ? { code: promo.code, discountPct: promo.discount_pct } : null,
    rooms,
    adults,
    children,
    nights: lines,
    grossPaise: totals.gross,
    planDiscountPaise: totals.planDiscount,
    promoDiscountPaise: totals.promoDiscount,
    taxablePaise: totals.taxable,
    taxPaise: totals.tax,
    totalPaise: totals.taxable + totals.tax,
    taxByRate: Object.entries(taxByRate)
      .map(([pct, v]) => ({ pct: Number(pct), taxablePaise: v.taxable, taxPaise: v.tax }))
      .sort((a, b) => a.pct - b.pct),
  };
}

module.exports = { priceStay, gstRateFor, splitEvenly, checkOccupancy };
