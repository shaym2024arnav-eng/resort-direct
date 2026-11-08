import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, qs, useApi } from "../../api";
import { useAuth } from "../../auth";
import { Empty, ErrorNote, Loading, Skeleton } from "../../components/States";
import { CATEGORY, CHANNEL, fmtDate, fmtDateTime, rupees, timeAgo } from "../../format";

const LANES = [
  ["all", "All open"], ["unsorted", "Unsorted"], ["mine", "Mine"], ["complaints", "Complaints"], ["routed", "Routed"],
];

function Metrics() {
  const { data } = useApi("/staff/metrics");
  if (!data) return null;
  const m = data.metrics;
  return (
    <dl className="metrics">
      <div><dt>Median first reply, 30 days</dt><dd className={m.median_first_reply_min != null && m.median_first_reply_min > 30 ? "warn" : ""}>{m.median_first_reply_min ?? "–"} min <span className="muted">target under 30</span></dd></div>
      <div><dt>Direct bookings, 30 days</dt><dd>{m.direct_bookings_30d} <span className="muted">{rupees(m.direct_revenue_30d_paise)}</span></dd></div>
      <div><dt>Overbooked nights</dt><dd className={m.overbooked_nights ? "warn" : "good"}>{m.overbooked_nights}</dd></div>
    </dl>
  );
}

function GmAlerts() {
  const { data, reload } = useApi("/staff/alerts");
  const unread = (data?.alerts || []).filter((a) => !a.read_at);
  if (!unread.length) return null;
  return (
    <section className="alerts" aria-label="Complaint alerts">
      {unread.slice(0, 3).map((a) => (
        <div key={a.id} className="alert">
          <p><strong>Complaint, {timeAgo(a.created_at)}.</strong> {a.message}</p>
          <div className="alert-actions">
            <Link to={`/staff?lane=complaints&ref=${a.enquiry_ref}`}>Open {a.enquiry_ref}</Link>
            <button className="link-btn" onClick={async () => { await api(`/staff/alerts/${a.id}/read`, { method: "POST" }); reload({ quiet: true }); }}>Mark as seen</button>
          </div>
        </div>
      ))}
      {unread.length > 3 && <p className="small">{unread.length - 3} more complaint alerts.</p>}
    </section>
  );
}

function Confidence({ value, source }) {
  const pct = Math.round(Number(value) * 100);
  return (
    <span className="conf" title={`${source === "gemini" ? "Gemini" : "Rule-based"} classifier, ${pct}% confident`}>
      <span className="conf-bar"><span style={{ width: `${pct}%` }} className={pct < 70 ? "low" : ""} /></span>
      {pct}%
    </span>
  );
}

function SimulateInbound({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ channel: "whatsapp", name: "", contact: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  if (!open) return <button className="btn btn-quiet" onClick={() => setOpen(true)}>Simulate an incoming message</button>;
  return (
    <form className="simulate" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError("");
      try { const { enquiry } = await api("/staff/inbound", { method: "POST", body: f }); setOpen(false); setF({ ...f, name: "", contact: "", message: "" }); onCreated(enquiry); }
      catch (err) { setError(err.message); } finally { setBusy(false); }
    }}>
      <p className="small muted">Stands in for a forwarded email or a WhatsApp Business message arriving.</p>
      <div className="field-row">
        <label className="field"><span>Channel</span><select value={f.channel} onChange={set("channel")}><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></label>
        <label className="field"><span>From</span><input value={f.name} onChange={set("name")} placeholder="Guest name" required /></label>
      </div>
      <label className="field"><span>{f.channel === "email" ? "Email address" : "Phone"}</span><input value={f.contact} onChange={set("contact")} required /></label>
      <label className="field"><span>Message</span><textarea rows={3} value={f.message} onChange={set("message")} required /></label>
      {error && <p className="field-error">{error}</p>}
      <div className="actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Classifying…" : "Add to inbox"}</button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

const FIELD_LABEL = {
  check_in: "Check-in", check_out: "Check-out", month: "Month", nights: "Nights", adults: "Adults", children: "Children",
  guests: "Guests", rooms: "Rooms", budget_inr: "Budget", room_preference: "Prefers",
};

function Detail({ refId, staffUsers, onChange, onBack }) {
  const { data, error, loading, reload, setData } = useApi(`/staff/enquiries/${refId}`);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const e = data?.enquiry;

  useEffect(() => { if (e) setDraft(e.draft_reply || ""); setConfirmSend(false); setMsg(null); }, [e?.id, e?.draft_reply]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Loading label="Opening enquiry" />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;

  async function act(name, path, body, okText) {
    setBusy(name); setMsg(null);
    try {
      const res = await api(`/staff/enquiries/${e.ref}${path}`, { method: path === "/draft" ? "PUT" : "POST", body });
      setData(res);
      setMsg({ ok: true, text: okText });
      onChange();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(""); setConfirmSend(false);
    }
  }

  const x = e.extracted || {};
  const shown = Object.entries(FIELD_LABEL).filter(([k]) => x[k] != null && x[k] !== "");
  const isOpen = e.status === "new";
  const channelVerb = e.channel === "whatsapp" ? "WhatsApp" : "email";

  return (
    <article className="enquiry">
      <button className="link-btn back-btn" onClick={onBack}>Back to list</button>
      <header className="enquiry-head">
        <div>
          <h2>{e.name}</h2>
          <p className="muted small">{e.ref}, {CHANNEL[e.channel]}, {e.contact}, {fmtDateTime(e.received_at)}</p>
        </div>
        <span className={`tag tag-${e.status}`}>{e.status === "new" ? "Open" : e.status === "replied" ? "Replied" : "Closed"}</span>
      </header>
      {e.needs_gm && <p className="note note-alert">Complaint: the General Manager has been alerted.</p>}
      <blockquote className="message">{e.message}</blockquote>

      <section className="triage">
        <h3 className="h4">How it was sorted</h3>
        {e.processing !== "done" ? <p className="muted">Still classifying… <button className="link-btn" onClick={() => reload()}>Refresh</button></p> : (
          <>
            <p>
              <strong>{CATEGORY[e.category]}</strong>{" "}
              <Confidence value={e.confidence} source={e.ai_source} />{" "}
              <span className="muted small">by {e.ai_source === "gemini" ? "Gemini" : "rule-based fallback"}</span>
            </p>
            <p className="small">{e.lane === "unsorted" ? "Not confident enough to route. Waiting for someone to sort it." : `Routed to ${e.owner_name || "nobody"}.`}</p>
            {e.ai_note && <p className="muted small">Note: {e.ai_note}</p>}
            {shown.length > 0 && (
              <dl className="extracted">
                {shown.map(([k, label]) => (
                  <div key={k}><dt>{label}</dt><dd>{k === "budget_inr" ? `₹${Number(x[k]).toLocaleString("en-IN")}` : k.startsWith("check") ? fmtDate(x[k]) : String(x[k]).replace("_", " ")}</dd></div>
                ))}
              </dl>
            )}
          </>
        )}
        <div className="reroute">
          <p className="small">Wrong? Re-route in one click:</p>
          <div className="chip-row">
            {Object.entries(CATEGORY).map(([k, label]) => (
              <button key={k} className={`chip ${e.category === k ? "on" : ""}`} disabled={!!busy} onClick={() => act("route", "/route", { category: k }, `Marked as ${label.toLowerCase()}.`)}>{label}</button>
            ))}
          </div>
          <label className="field field-inline">
            <span>Owner</span>
            <select value={e.owner_id || ""} disabled={!!busy} onChange={(ev) => act("route", "/route", { category: e.category || "other", ownerId: ev.target.value ? Number(ev.target.value) : null }, "Owner changed.")}>
              <option value="">Unassigned</option>
              {staffUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role === "gm" ? "GM" : u.team})</option>)}
            </select>
          </label>
        </div>
      </section>

      {e.quote && (
        <section className="quote">
          <h3 className="h4">Prices from today's rate table</h3>
          {e.quote.available ? (
            <ul className="plain-list small">
              {e.quote.options.flatMap((o) => o.plans.map((p) => <li key={o.slug + p.code}>{o.roomType}, {p.name}: <strong>{rupees(p.totalPaise)}</strong> incl. {rupees(p.taxPaise)} GST</li>))}
            </ul>
          ) : <p className="small">No online allotment left for {fmtDate(e.quote.checkIn)} to {fmtDate(e.quote.checkOut)}. Check the full house before replying.</p>}
        </section>
      )}

      <section className="reply">
        <h3 className="h4">{isOpen ? "Reply draft" : "Reply sent"}</h3>
        {msg && <p className={msg.ok ? "note note-ok" : "note note-error"} role="status">{msg.text}</p>}
        {isOpen ? (
          <>
            <p className="muted small">Drafted for you. Nothing is sent until you press Send.</p>
            <textarea rows={12} value={draft} onChange={(ev) => setDraft(ev.target.value)} aria-label="Reply draft" />
            <div className="actions">
              {!confirmSend ? (
                <button className="btn btn-primary" disabled={!!busy || draft.trim().length < 10} onClick={() => setConfirmSend(true)}>Send reply</button>
              ) : (
                <>
                  <button className="btn btn-primary" disabled={!!busy} onClick={() => act("send", "/send", { body: draft }, "Reply sent.")}>
                    {busy === "send" ? "Sending…" : `Send by ${channelVerb} to ${e.contact.split(" · ")[0]}`}
                  </button>
                  <button className="btn btn-quiet" onClick={() => setConfirmSend(false)}>Not yet</button>
                </>
              )}
              <button className="btn btn-secondary" disabled={!!busy || draft === e.draft_reply} onClick={() => act("save", "/draft", { draft }, "Draft saved.")}>Save draft</button>
              <button className="btn btn-quiet" disabled={!!busy} onClick={() => act("reprocess", "/reprocess", undefined, "Classified again.")}>Re-run AI</button>
              <button className="btn btn-quiet" disabled={!!busy} onClick={() => act("close", "/close", undefined, "Closed without a reply.")}>Close</button>
            </div>
            <p className="muted small">Sending is simulated in this demo: the reply is logged, not delivered.</p>
          </>
        ) : (
          <pre className="sent">{e.sent_reply || "Closed without a reply."}</pre>
        )}
      </section>

      <section className="history">
        <h3 className="h4">History</h3>
        <ol className="timeline">
          <li><span className="muted small">{fmtDateTime(e.received_at)}</span> Received via {CHANNEL[e.channel]}</li>
          {e.events.map((ev) => (
            <li key={ev.id}>
              <span className="muted small">{fmtDateTime(ev.created_at)}</span>{" "}
              {ev.action === "classified" && `Sorted as ${CATEGORY[ev.detail.category]?.toLowerCase()} (${Math.round(ev.detail.confidence * 100)}%), ${ev.detail.lane === "routed" ? `routed to ${ev.detail.owner}` : "left unsorted"}`}
              {ev.action === "rerouted" && `${ev.user_name} re-routed to ${CATEGORY[ev.detail.to.category]?.toLowerCase()}${ev.detail.to.owner ? `, ${ev.detail.to.owner}` : ""}`}
              {ev.action === "draft_edited" && `${ev.user_name} edited the draft`}
              {ev.action === "reply_sent" && `${ev.user_name || "Staff"} sent the reply`}
              {ev.action === "closed" && `${ev.user_name} closed it`}
              {ev.action === "reprocess_requested" && `${ev.user_name} re-ran the classifier`}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

export default function Inbox() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const lane = params.get("lane") || (user.role === "gm" ? "unsorted" : "mine");
  const selected = params.get("ref");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const list = useApi(`/staff/enquiries?${qs({ lane, q: query })}`);
  const staffUsers = useApi("/staff/staff-users");
  const items = list.data?.items || [];
  const counts = list.data?.counts || {};

  const go = (next) => setParams(qs({ lane, ref: selected, ...next }));

  return (
    <div className="inbox-page">
      {user.role === "gm" && <GmAlerts />}
      <Metrics />
      <div className={`inbox ${selected ? "has-selection" : ""}`}>
        <section className="inbox-list" aria-label="Enquiries">
          <div className="lanes" role="tablist">
            {LANES.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={lane === k} onClick={() => go({ lane: k, ref: undefined })}>
                {label} <span className="count">{counts[k] ?? ""}</span>
              </button>
            ))}
          </div>
          <form className="inbox-search" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, message or ENQ number" aria-label="Search enquiries" />
          </form>
          <SimulateInbound onCreated={(enq) => { list.reload({ quiet: true }); go({ lane: "all", ref: enq.ref }); }} />
          {list.loading && <Skeleton lines={6} />}
          <ErrorNote error={list.error} onRetry={list.reload} />
          {list.data && !items.length && (
            <Empty title={lane === "unsorted" ? "Nothing waiting to be sorted." : lane === "mine" ? "Nothing assigned to you right now." : "No open enquiries here."}>
              {lane !== "all" && <button className="link-btn" onClick={() => go({ lane: "all" })}>See all open enquiries</button>}
            </Empty>
          )}
          <ul className="enq-items">
            {items.map((e) => (
              <li key={e.ref}>
                <button className={`enq-item ${selected === e.ref ? "active" : ""} ${e.needs_gm ? "is-complaint" : ""}`} onClick={() => go({ ref: e.ref })}>
                  <span className="enq-top">
                    <strong>{e.name}</strong>
                    <span className="muted small">{timeAgo(e.received_at)}</span>
                  </span>
                  <span className="enq-msg">{e.message}</span>
                  <span className="enq-meta small">
                    <span className={`tag tag-cat-${e.category || "pending"}`}>{e.category ? CATEGORY[e.category] : "Classifying"}</span>
                    {e.lane === "unsorted" && <span className="tag tag-unsorted">Unsorted</span>}
                    <span className="muted">{CHANNEL[e.channel]}{e.owner_name ? `, ${e.owner_name}` : ""}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="inbox-detail" aria-label="Selected enquiry">
          {selected ? (
            <Detail key={selected} refId={selected} staffUsers={staffUsers.data?.users || []} onChange={() => list.reload({ quiet: true })} onBack={() => go({ ref: undefined })} />
          ) : (
            <Empty title="Pick an enquiry to read it and reply." />
          )}
        </section>
      </div>
    </div>
  );
}
