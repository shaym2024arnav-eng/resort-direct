import { useState } from "react";
import { api, qs, useApi } from "../../api";
import { ErrorNote, Skeleton } from "../../components/States";
import { addDays, fmtDate, rupees, todayIST } from "../../format";

const WEEKDAYS = [["1", "Mon"], ["2", "Tue"], ["3", "Wed"], ["4", "Thu"], ["5", "Fri"], ["6", "Sat"], ["0", "Sun"]];

export default function Rates() {
  const today = todayIST();
  const [from, setFrom] = useState(today);
  const grid = useApi(`/staff/inventory?${qs({ from, days: 14 })}`);
  const [edit, setEdit] = useState({ roomTypeIds: [], from: today, to: addDays(today, 6), weekdays: [], allotment: "", rate: "", closed: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setEdit((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (k, v) => setEdit((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));

  function pickCell(rt, c) {
    if (c.missing) return;
    setEdit((x) => ({ ...x, roomTypeIds: [rt.id], from: c.date, to: c.date, weekdays: [], allotment: String(c.allotment), rate: String(c.ratePaise / 100), closed: "" }));
    setResult(null);
    document.getElementById("bulk-edit")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function apply(e) {
    e.preventDefault();
    setResult(null);
    const body = { roomTypeIds: edit.roomTypeIds, from: edit.from, to: edit.to };
    if (edit.weekdays.length) body.weekdays = edit.weekdays.map(Number);
    if (edit.allotment !== "") body.allotment = Number(edit.allotment);
    if (edit.rate !== "") body.ratePaise = Math.round(Number(edit.rate) * 100);
    if (edit.closed !== "") body.closed = edit.closed === "close";
    if (!body.roomTypeIds.length) return setResult({ ok: false, text: "Choose at least one room type." });
    setBusy(true);
    try {
      const r = await api("/staff/inventory", { method: "PUT", body });
      setResult({ ok: true, text: `Updated ${r.updated} night${r.updated === 1 ? "" : "s"}.` });
      grid.reload({ quiet: true });
    } catch (err) {
      setResult({ ok: false, text: err.message, details: err.body?.details });
    } finally {
      setBusy(false);
    }
  }

  const data = grid.data;
  return (
    <div className="staff-page">
      <div className="page-head">
        <h1 className="page-title">Rates and website allotment</h1>
        <p className="muted">The website can only sell the allotment set here. Rooms held for agents and walk-ins stay out of it. Click a night to edit it.</p>
      </div>
      <div className="grid-nav">
        <button className="btn btn-quiet" disabled={from <= today} onClick={() => setFrom(addDays(from, -14) < today ? today : addDays(from, -14))}>Previous 2 weeks</button>
        <label className="field field-inline"><span>From</span><input type="date" value={from} min={today} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <button className="btn btn-quiet" onClick={() => setFrom(addDays(from, 14))}>Next 2 weeks</button>
      </div>
      {grid.loading && <Skeleton lines={6} />}
      <ErrorNote error={grid.error} onRetry={grid.reload} />
      {data && (
        <div className="grid-scroll" tabIndex={0} aria-label="Inventory grid, scrolls sideways">
          <table className="inv-grid">
            <thead>
              <tr>
                <th scope="col">Room type</th>
                {data.dates.map((d) => {
                  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
                  return <th key={d} scope="col" className={day === 5 || day === 6 ? "wknd" : ""}>{fmtDate(d)}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {data.roomTypes.map((rt) => (
                <tr key={rt.id}>
                  <th scope="row">{rt.name}<span className="muted small">{rt.totalUnits} units in total</span></th>
                  {rt.cells.map((c) => (
                    <td key={c.date} className={c.missing ? "cell-missing" : c.closed ? "cell-closed" : c.free === 0 ? "cell-full" : ""}>
                      {c.missing ? "–" : (
                        <button onClick={() => pickCell(rt, c)} aria-label={`${rt.name}, ${fmtDate(c.date)}: ${c.closed ? "closed" : `${c.free} of ${c.allotment} free`}, ${rupees(c.ratePaise)}`}>
                          <span className="cell-free">{c.closed ? "Closed" : `${c.free}/${c.allotment}`}</span>
                          <span className="cell-rate">{rupees(c.ratePaise)}</span>
                          {(c.sold > 0 || c.held > 0) && <span className="cell-sold">{c.sold} sold{c.held ? `, ${c.held} held` : ""}</span>}
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Each night shows rooms free online out of the website allotment, then that night's rate before tax.</p>

      <form id="bulk-edit" className="bulk" onSubmit={apply}>
        <h2 className="h3">Change rates, allotment or blackout dates</h2>
        <fieldset className="chips">
          <legend>Room types</legend>
          {data?.roomTypes.map((rt) => (
            <label key={rt.id} className={`chip ${edit.roomTypeIds.includes(rt.id) ? "on" : ""}`}>
              <input type="checkbox" checked={edit.roomTypeIds.includes(rt.id)} onChange={() => toggle("roomTypeIds", rt.id)} /> {rt.name}
            </label>
          ))}
        </fieldset>
        <div className="field-row">
          <label className="field"><span>From</span><input type="date" value={edit.from} min={today} onChange={set("from")} required /></label>
          <label className="field"><span>To (inclusive)</span><input type="date" value={edit.to} min={edit.from} onChange={set("to")} required /></label>
        </div>
        <fieldset className="chips">
          <legend>Only these days (leave empty for every day)</legend>
          {WEEKDAYS.map(([v, l]) => (
            <label key={v} className={`chip ${edit.weekdays.includes(v) ? "on" : ""}`}><input type="checkbox" checked={edit.weekdays.includes(v)} onChange={() => toggle("weekdays", v)} /> {l}</label>
          ))}
        </fieldset>
        <div className="field-row field-row-3">
          <label className="field"><span>Website allotment</span><input type="number" min={0} max={30} value={edit.allotment} onChange={set("allotment")} placeholder="Leave as is" /></label>
          <label className="field"><span>Rate per night, ₹ before tax</span><input type="number" min={1000} step={50} value={edit.rate} onChange={set("rate")} placeholder="Leave as is" /></label>
          <label className="field"><span>Selling</span>
            <select value={edit.closed} onChange={set("closed")}>
              <option value="">Leave as is</option>
              <option value="close">Close (blackout)</option>
              <option value="open">Open for sale</option>
            </select>
          </label>
        </div>
        {result && (
          <div className={`note ${result.ok ? "note-ok" : "note-error"}`} role="status">
            <p>{result.text}</p>
            {result.details && (
              <ul className="plain-list small">
                {result.details.map((d) => <li key={d.roomType + d.date}>{d.roomType}, {fmtDate(d.date)}: {d.sold} sold, {d.held} held</li>)}
              </ul>
            )}
          </div>
        )}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Apply changes"}</button>
        <p className="muted small">If any night already has more rooms booked online than the new allotment, nothing is changed.</p>
      </form>
    </div>
  );
}
