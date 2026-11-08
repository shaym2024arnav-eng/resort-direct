import { useState } from "react";
import { api, useApi } from "../../api";
import { Empty, ErrorNote, Skeleton } from "../../components/States";
import { addDays, fmtDate, todayIST } from "../../format";

export default function Promos() {
  const list = useApi("/staff/promos");
  const today = todayIST();
  const blank = { code: "", description: "", discountPct: "10", minNights: "1", validFrom: today, validTo: addDays(today, 60), maxUses: "" };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: k === "code" ? e.target.value.toUpperCase() : e.target.value }));

  async function create(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const { promo } = await api("/staff/promos", {
        method: "POST",
        body: { code: f.code, description: f.description, discountPct: Number(f.discountPct), minNights: Number(f.minNights), validFrom: f.validFrom, validTo: f.validTo, maxUses: f.maxUses ? Number(f.maxUses) : null },
      });
      setMsg({ ok: true, text: `${promo.code} created.` });
      setF(blank);
      list.reload({ quiet: true });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p) {
    await api(`/staff/promos/${p.id}`, { method: "PATCH", body: { active: !p.active } }).catch((err) => setMsg({ ok: false, text: err.message }));
    list.reload({ quiet: true });
  }

  const promos = list.data?.promos || [];
  return (
    <div className="staff-page">
      <div className="page-head"><h1 className="page-title">Promo codes</h1></div>
      {list.loading && <Skeleton lines={4} />}
      <ErrorNote error={list.error} onRetry={list.reload} />
      {list.data && !promos.length && <Empty title="No promo codes yet." />}
      {promos.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Code</th><th>Discount</th><th>Minimum stay</th><th>Check-ins</th><th>Used</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {promos.map((p) => {
                const expired = p.valid_to < today;
                return (
                  <tr key={p.id}>
                    <td className="ref">{p.code}<span className="muted small">{p.description}</span></td>
                    <td className="num">{p.discount_pct}%</td>
                    <td>{p.min_nights} night{p.min_nights > 1 ? "s" : ""}</td>
                    <td>{fmtDate(p.valid_from)} to {fmtDate(p.valid_to)}</td>
                    <td className="num">{p.used}{p.max_uses ? ` of ${p.max_uses}` : ""}</td>
                    <td><span className={`tag ${expired ? "tag-expired" : p.active ? "tag-confirmed" : "tag-cancelled"}`}>{expired ? "Ended" : p.active ? "Active" : "Off"}</span></td>
                    <td>{!expired && <button className="btn btn-quiet btn-small" onClick={() => toggle(p)}>{p.active ? "Turn off" : "Turn on"}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <form className="bulk" onSubmit={create}>
        <h2 className="h3">New promo code</h2>
        <div className="field-row">
          <label className="field"><span>Code</span><input value={f.code} onChange={set("code")} pattern="[A-Z0-9]{4,20}" title="4 to 20 letters or digits" required /></label>
          <label className="field"><span>Description</span><input value={f.description} onChange={set("description")} maxLength={200} /></label>
        </div>
        <div className="field-row field-row-3">
          <label className="field"><span>Discount %</span><input type="number" min={1} max={50} value={f.discountPct} onChange={set("discountPct")} required /></label>
          <label className="field"><span>Minimum nights</span><input type="number" min={1} max={14} value={f.minNights} onChange={set("minNights")} required /></label>
          <label className="field"><span>Uses allowed</span><input type="number" min={1} value={f.maxUses} onChange={set("maxUses")} placeholder="No limit" /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Check-ins from</span><input type="date" value={f.validFrom} onChange={set("validFrom")} required /></label>
          <label className="field"><span>Check-ins until</span><input type="date" value={f.validTo} min={f.validFrom} onChange={set("validTo")} required /></label>
        </div>
        {msg && <p className={msg.ok ? "note note-ok" : "note note-error"} role="status">{msg.text}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create promo code"}</button>
      </form>
    </div>
  );
}
