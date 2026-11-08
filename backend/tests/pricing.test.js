const { priceStay, gstRateFor, splitEvenly } = require("../src/services/pricing");

const roomType = { name: "Estate Room", kind: "room", base_occupancy: 2, extra_adult_paise: 150000, max_adults: 3, max_children: 2 };
const RO = { code: "RO", name: "Stay only", breakfast_per_adult_paise: 0, discount_pct: 0 };
const BB = { code: "BB", name: "Bed & breakfast", breakfast_per_adult_paise: 65000, discount_pct: 0 };
const NRF = { code: "NRF", name: "Advance saver", breakfast_per_adult_paise: 65000, discount_pct: 12 };
const night = (date, rupees) => ({ date, ratePaise: rupees * 100 });

describe("GST slab", () => {
  test("₹7,500 per room-night is taxed at 5%", () => {
    expect(gstRateFor(750000)).toBe(5);
    const p = priceStay({ nights: [night("2026-12-01", 7500)], roomType, plan: RO, adults: 2 });
    expect(p.taxPaise).toBe(37500);
    expect(p.totalPaise).toBe(787500);
  });

  test("₹7,501 per room-night is taxed at 18%", () => {
    expect(gstRateFor(750100)).toBe(18);
    const p = priceStay({ nights: [night("2026-12-01", 7501)], roomType, plan: RO, adults: 2 });
    expect(p.taxPaise).toBe(135018);
  });

  test("the slab is decided after discounts: ₹8,000 with a 10% promo drops to 5%", () => {
    const p = priceStay({ nights: [night("2026-12-01", 8000)], roomType, plan: RO, adults: 2, promo: { code: "DIRECT10", discount_pct: 10 } });
    expect(p.promoDiscountPaise).toBe(80000);
    expect(p.taxablePaise).toBe(720000);
    expect(p.nights[0].gstPct).toEqual([5]);
    expect(p.taxPaise).toBe(36000);
  });

  test("a stay can mix slabs: weekday at 5%, weekend at 18%", () => {
    const p = priceStay({ nights: [night("2026-12-03", 6800), night("2026-12-04", 7820)], roomType, plan: RO, adults: 2 });
    expect(p.nights.map((n) => n.gstPct)).toEqual([[5], [18]]);
    expect(p.taxByRate).toEqual([
      { pct: 5, taxablePaise: 680000, taxPaise: 34000 },
      { pct: 18, taxablePaise: 782000, taxPaise: 140760 },
    ]);
    expect(p.totalPaise).toBe(680000 + 782000 + 34000 + 140760);
  });

  test("breakfast counts towards the per-night value (can push a room into 18%)", () => {
    const p = priceStay({ nights: [night("2026-12-01", 6800)], roomType, plan: BB, adults: 2 });
    expect(p.taxablePaise).toBe(680000 + 2 * 65000);
    expect(p.nights[0].gstPct).toEqual([18]);
  });
});

describe("occupancy and multiple rooms", () => {
  test("a third adult adds the extra-adult charge", () => {
    const p = priceStay({ nights: [night("2026-12-01", 6000)], roomType, plan: RO, adults: 3 });
    expect(p.nights[0].extraAdults).toBe(150000);
    expect(p.taxablePaise).toBe(750000); // exactly at the threshold -> still 5%
    expect(p.taxPaise).toBe(37500);
  });

  test("adults are spread across rooms, and each room is taxed on its own value", () => {
    expect(splitEvenly(5, 2)).toEqual([3, 2]);
    const p = priceStay({ nights: [night("2026-12-01", 6500)], roomType, plan: RO, adults: 5, rooms: 2 });
    // Room 1: 6,500 + 1,500 = 8,000 (18%). Room 2: 6,500 (5%).
    expect(p.nights[0].gstPct.sort()).toEqual([18, 5].sort());
    expect(p.taxPaise).toBe(144000 + 32500);
  });

  test("plan discount applies before promo, both before tax", () => {
    const p = priceStay({ nights: [night("2026-12-01", 10000)], roomType, plan: NRF, adults: 2, promo: { code: "X", discount_pct: 10 } });
    const gross = 1000000 + 130000;            // rate + breakfast for 2
    const afterPlan = gross - Math.round(gross * 0.12);
    const unit = afterPlan - Math.round(afterPlan * 0.1);
    expect(p.taxablePaise).toBe(unit);
    expect(p.taxPaise).toBe(Math.round(unit * 0.18));
  });

  test("rejects more guests than the room allows", () => {
    expect(() => priceStay({ nights: [night("2026-12-01", 6000)], roomType, plan: RO, adults: 4 })).toThrow(/up to 3 adults/);
    expect(() => priceStay({ nights: [night("2026-12-01", 6000)], roomType, plan: RO, adults: 1, rooms: 2 })).toThrow(/at least one adult/);
  });

  test("all money is whole paise", () => {
    const p = priceStay({ nights: [night("2026-12-01", 7333), night("2026-12-02", 9111)], roomType, plan: NRF, adults: 3, children: 1, promo: { code: "X", discount_pct: 7 } });
    for (const v of [p.taxablePaise, p.taxPaise, p.totalPaise, ...p.nights.flatMap((n) => [n.taxable, n.tax])]) expect(Number.isInteger(v)).toBe(true);
  });
});
