import { useState } from "react";
import { api, qs, useApi } from "../../api";
import { Empty, ErrorNote, Skeleton } from "../../components/States";
import { fmtDate, fmtDateTime, guestsLabel, rupees, todayIST } from "../../format";

const STATUS = { confirmed: "Confirmed", held: "Held", cancelled: "Cancelled", expired: "Expired" };

export default function Bookings() {
  const [filters, setFilters] = useState({ date: "", by: "created", status: "all", q: "" });
  const [applied, setApplied] = useState(filters);
  const list = useApi(`/staff/bookings?${qs(applied)}`);
  const [confirming, setConfirming] = useState(null);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const exportDate = filters.date || todayIST();

  async function cancel(ref) {
    setMsg(null);
    try {
      await api(`/staff/bookings/${ref}/cancel`, { method: "POST" });
      setMsg({ ok: true, text: `${ref} cancelled. Its rooms are back on sale.` });
      list.reload({ quiet: true });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setConfirming(null);
    }
  }

  const rows = list.data?.bookings || [];
  return (
    <div className="staff-page">
      <div className="page-head">
        <h1 className="page-title">Bookings</h1>
        <a className="btn btn-secondary" href={`/api/staff/bookings/export.csv?${qs({ date: exportDate, by: filters.by, status: filters.status })}`} download>
          Download CSV for {fmtDate(exportDate)}
        </a>
      </div>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setApplied(filters); }}>
        <label className="field"><span>Date</span><input type="date" value={filters.date} onChange={set("date")} /></label>
        <label className="field"><span>Date means</span>
          <select value={filters.by} onChange={set("by")}><option value="created">Booked on</option><option value="arrival">Arriving on</option><option value="staying">Staying that night</option></select>
        </label>
        <label className="field"><span>Status</span>
          <select value={filters.status} onChange={set("status")}><option value="all">All</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="field"><span>Search</span><input type="search" value={filters.q} onChange={set("q")} placeholder="Reference, name or email" /></label>
        <button className="btn btn-primary">Show</button>
      </form>
      {msg && <p className={msg.ok ? "note note-ok" : "note note-error"} role="status">{msg.text}</p>}
      {list.loading && <Skeleton lines={6} />}
      <ErrorNote error={list.error} onRetry={list.reload} />
      {list.data && !rows.length && <Empty title="No bookings match these filters." />}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Reference</th><th>Guest</th><th>Stay</th><th>Room</th><th>Total</th><th>Status</th><th>Booked</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.ref}>
                  <td className="ref">{b.ref}</td>
                  <td>{b.guestName}<span className="muted small">{b.guestPhone}</span></td>
                  <td>{fmtDate(b.checkIn)} to {fmtDate(b.checkOut)}<span className="muted small">{guestsLabel(b)}</span></td>
                  <td>{b.rooms > 1 ? `${b.rooms} × ` : ""}{b.roomType.name}<span className="muted small">{b.plan.name}{b.promoCode ? `, ${b.promoCode}` : ""}</span></td>
                  <td className="num">{rupees(b.totalPaise)}</td>
                  <td><span className={`tag tag-${b.status}`}>{STATUS[b.status]}</span></td>
                  <td className="small">{fmtDateTime(b.createdAt)}</td>
                  <td>
                    {b.status === "confirmed" && (confirming === b.ref ? (
                      <span className="actions">
                        <button className="btn btn-danger btn-small" onClick={() => cancel(b.ref)}>Confirm cancel</button>
                        <button className="btn btn-quiet btn-small" onClick={() => setConfirming(null)}>Keep</button>
                      </span>
                    ) : <button className="btn btn-quiet btn-small" onClick={() => setConfirming(b.ref)}>Cancel</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
