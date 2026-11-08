import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api";
import { ErrorNote } from "../components/States";
import { todayIST } from "../format";

const NEEDS = [
  ["accommodation", "Rooms for guests"], ["venue", "Venue or lawn"], ["catering", "Catering"], ["conference_hall", "Conference hall"],
  ["av", "Projector and sound"], ["decor", "Decor"], ["transport", "Transport from Bengaluru"],
];

function Done({ result, onAnother }) {
  return (
    <div className="done" role="status">
      <h2 className="h3">Message received</h2>
      <p>{result.message}</p>
      <p className="muted">Your reference is <strong className="ref">{result.ref}</strong>.</p>
      <button className="btn btn-secondary" onClick={onAnother}>Send another</button>
    </div>
  );
}

function Contact({ f, set, errors }) {
  return (
    <>
      <label className="field"><span>Your name</span><input value={f.name} onChange={set("name")} autoComplete="name" aria-invalid={!!errors.name} />{errors.name && <small className="field-error">{errors.name}</small>}</label>
      <div className="field-row">
        <label className="field"><span>Email</span><input type="email" value={f.email} onChange={set("email")} autoComplete="email" aria-invalid={!!errors.email} />{errors.email && <small className="field-error">{errors.email}</small>}</label>
        <label className="field"><span>Mobile (optional)</span><input value={f.phone} onChange={set("phone")} autoComplete="tel" inputMode="tel" /></label>
      </div>
    </>
  );
}

function Consent({ f, set, errors }) {
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={f.consent} onChange={set("consent")} />
        <span>Kaapi Hills may use these details to reply to this enquiry. We keep them only as long as we need to.</span>
      </label>
      {errors.consent && <small className="field-error">{errors.consent}</small>}
    </>
  );
}

const blank = { name: "", email: "", phone: "", consent: false };

export default function Enquire() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("type") === "event" ? "event" : "general";
  const [f, setF] = useState({ ...blank, message: "", eventType: "wedding", date: "", month: "", nights: "2", guests: "", roomsNeeded: "", budgetInr: "", needs: [] });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const toggleNeed = (n) => setF((x) => ({ ...x, needs: x.needs.includes(n) ? x.needs.filter((y) => y !== n) : [...x.needs, n] }));

  function validate() {
    const e = {};
    if (f.name.trim().length < 2) e.name = "Tell us your name.";
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "Enter an email so we can reply.";
    if (!f.consent) e.consent = "Please agree so we can reply to you.";
    if (tab === "general" && f.message.trim().length < 10) e.message = "Tell us a little more, at least a sentence.";
    if (tab === "event") {
      if (!f.date && !f.month) e.date = "Give a date, or at least the month.";
      if (!(Number(f.guests) >= 2)) e.guests = "Roughly how many guests?";
    }
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!validate()) return;
    setBusy(true);
    const contact = { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), consent: true };
    try {
      const res = tab === "general"
        ? await api("/enquiries", { method: "POST", body: { ...contact, message: f.message.trim() } })
        : await api("/enquiries/event", {
            method: "POST",
            body: {
              ...contact, eventType: f.eventType, date: f.date, month: f.date ? "" : f.month, nights: Number(f.nights) || undefined,
              guests: Number(f.guests), roomsNeeded: f.roomsNeeded ? Number(f.roomsNeeded) : undefined,
              budgetInr: f.budgetInr ? Number(f.budgetInr) : undefined, needs: f.needs, message: f.message.trim(),
            },
          });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap page narrow-page">
      <h1 className="page-title">{tab === "event" ? "Plan a wedding or offsite" : "Ask us anything"}</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "general"} onClick={() => { setParams({}); setResult(null); }}>A question or a stay</button>
        <button role="tab" aria-selected={tab === "event"} onClick={() => { setParams({ type: "event" }); setResult(null); }}>Wedding or event</button>
      </div>

      {result ? <Done result={result} onAnother={() => { setResult(null); setF((x) => ({ ...x, message: "" })); }} /> : (
        <form className="enquiry-form" onSubmit={submit} noValidate>
          {tab === "general" ? (
            <>
              <p className="muted">Ask about rooms, dates, or anything else. A person reads every message, usually within 30 minutes during the day. To see prices now, <Link to="/stay">check availability</Link>.</p>
              <Contact f={f} set={set} errors={errors} />
              <label className="field"><span>Your message</span>
                <textarea rows={6} value={f.message} onChange={set("message")} maxLength={2000} placeholder="e.g. Is a villa free 14–16 Nov for 2 adults and a child?" aria-invalid={!!errors.message} />
                {errors.message && <small className="field-error">{errors.message}</small>}
              </label>
            </>
          ) : (
            <>
              <p className="muted">Tell us the basics and our events team will send a proposal with venues, rooms and food, usually within a working day.</p>
              <fieldset className="radio-row">
                <legend>What are you planning?</legend>
                {[["wedding", "A wedding or family celebration"], ["corporate_offsite", "A company offsite or conference"], ["other_event", "Something else"]].map(([v, l]) => (
                  <label key={v} className="radio"><input type="radio" name="eventType" value={v} checked={f.eventType === v} onChange={set("eventType")} /> {l}</label>
                ))}
              </fieldset>
              <div className="field-row">
                <label className="field"><span>Date, if you know it</span><input type="date" min={todayIST()} value={f.date} onChange={set("date")} aria-invalid={!!errors.date} /></label>
                <label className="field"><span>Or the month</span><input type="month" min={todayIST().slice(0, 7)} value={f.month} onChange={set("month")} disabled={!!f.date} /></label>
              </div>
              {errors.date && <small className="field-error">{errors.date}</small>}
              <div className="field-row field-row-3">
                <label className="field"><span>Guests</span><input type="number" min={2} max={1500} value={f.guests} onChange={set("guests")} aria-invalid={!!errors.guests} />{errors.guests && <small className="field-error">{errors.guests}</small>}</label>
                <label className="field"><span>Nights</span><input type="number" min={1} max={10} value={f.nights} onChange={set("nights")} /></label>
                <label className="field"><span>Rooms needed</span><input type="number" min={0} max={76} value={f.roomsNeeded} onChange={set("roomsNeeded")} /></label>
              </div>
              <label className="field"><span>Budget in ₹ (optional)</span><input type="number" min={0} step={10000} value={f.budgetInr} onChange={set("budgetInr")} placeholder="e.g. 1500000" /></label>
              <fieldset className="chips">
                <legend>What will you need?</legend>
                {NEEDS.map(([v, l]) => (
                  <label key={v} className={`chip ${f.needs.includes(v) ? "on" : ""}`}><input type="checkbox" checked={f.needs.includes(v)} onChange={() => toggleNeed(v)} /> {l}</label>
                ))}
              </fieldset>
              <Contact f={f} set={set} errors={errors} />
              <label className="field"><span>Anything else (optional)</span><textarea rows={4} value={f.message} onChange={set("message")} maxLength={2000} /></label>
            </>
          )}
          <Consent f={f} set={set} errors={errors} />
          {error && <ErrorNote>{error}</ErrorNote>}
          <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send message"}</button>
        </form>
      )}
    </div>
  );
}
