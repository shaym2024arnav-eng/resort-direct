import { useState } from "react";
import { fmtDate, rupees } from "../format";

// Shows exactly what the server calculated: nightly lines, discounts and GST by slab.
export default function PriceBreakdown({ price, open: startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  if (!price) return null;
  const discount = price.planDiscountPaise + price.promoDiscountPaise;
  return (
    <div className="price">
      <dl className="price-lines">
        <div><dt>Room{price.rooms > 1 ? `s (${price.rooms})` : ""}, {price.nights.length} night{price.nights.length > 1 ? "s" : ""}</dt><dd>{rupees(price.nights.reduce((s, n) => s + n.roomCharge, 0))}</dd></div>
        {price.nights.some((n) => n.extraAdults) && <div><dt>Extra adults</dt><dd>{rupees(price.nights.reduce((s, n) => s + n.extraAdults, 0))}</dd></div>}
        {price.nights.some((n) => n.breakfast) && <div><dt>Breakfast</dt><dd>{rupees(price.nights.reduce((s, n) => s + n.breakfast, 0))}</dd></div>}
        {price.planDiscountPaise > 0 && <div className="saving"><dt>{price.plan.name} discount</dt><dd>−{rupees(price.planDiscountPaise)}</dd></div>}
        {price.promoDiscountPaise > 0 && <div className="saving"><dt>Promo {price.promo.code}</dt><dd>−{rupees(price.promoDiscountPaise)}</dd></div>}
        {price.taxByRate.map((t) => (
          <div key={t.pct}><dt>GST {t.pct}% <span className="muted">(CGST {t.pct / 2}% + SGST {t.pct / 2}%)</span></dt><dd>{rupees(t.taxPaise)}</dd></div>
        ))}
        <div className="price-total"><dt>Total</dt><dd>{rupees(price.totalPaise)}</dd></div>
      </dl>
      {discount > 0 && <p className="saving small">You save {rupees(discount)} by booking direct.</p>}
      <button type="button" className="link-btn small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : "Show"} night-by-night prices
      </button>
      {open && (
        <table className="nightly">
          <thead><tr><th>Night</th><th>Taxable</th><th>GST</th><th>Total</th></tr></thead>
          <tbody>
            {price.nights.map((n) => (
              <tr key={n.date}>
                <td>{fmtDate(n.date)}</td>
                <td>{rupees(n.taxable)}</td>
                <td>{n.gstPct.join(" / ")}%</td>
                <td>{rupees(n.taxable + n.tax)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">GST is 5% when a room's price for a night is ₹7,500 or less after discounts, and 18% above that.</p>
    </div>
  );
}
