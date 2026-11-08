import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, qs } from "../api";
import { isStaff, useAuth } from "../auth";
import AuthForm from "../components/AuthForm";
import PriceBreakdown from "../components/PriceBreakdown";
import { ErrorNote, Loading } from "../components/States";
import Steps from "../components/Steps";
import { fmtDate, guestsLabel, plural, stayFromParams, photo } from "../format";

// Step 2: guest details, promo code, consent. Submitting holds the rooms for 10 minutes.
export default function Checkout() {
  const [params] = useSearchParams();
  const stay = stayFromParams(params);
  const roomSlug = params.get("room");
  const planCode = params.get("plan");
  const { user } = useAuth();
  const navigate = useNavigate();

  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [promo, setPromo] = useState("");
  const [appliedPromo, setAppliedPromo] = useState("");
  const [promoMsg, setPromoMsg] = useState("");
  const [f, setF] = useState({ guestName: "", guestEmail: "", guestPhone: "", specialRequests: "", consent: false });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);

  const body = { ...stay, roomType: roomSlug, plan: planCode };

  useEffect(() => {
    if (!roomSlug || !planCode) return;
    setQuoteError(null);
    api("/quote", { method: "POST", body: { ...body, promoCode: appliedPromo } })
      .then(setQuote)
      .catch((err) => {
        if (appliedPromo) { setPromoMsg(err.message); setAppliedPromo(""); } else setQuoteError(err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString(), appliedPromo]);

  useEffect(() => {
    if (user) setF((x) => ({ ...x, guestName: x.guestName || user.name, guestEmail: x.guestEmail || user.email, guestPhone: x.guestPhone || user.phone || "" }));
  }, [user]);

  if (!roomSlug || !planCode) {
    return <div className="wrap page"><ErrorNote>That link is missing the room or rate. <Link to="/stay">Start again</Link>.</ErrorNote></div>;
  }

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  function validate() {
    const e = {};
    if (f.guestName.trim().length < 2) e.guestName = "Enter the lead guest's full name.";
    if (!/^\S+@\S+\.\S+$/.test(f.guestEmail.trim())) e.guestEmail = "Enter an email we can send your confirmation to.";
    if (!/^\+?[0-9 ()-]{8,18}$/.test(f.guestPhone.trim())) e.guestPhone = "Enter a phone number, e.g. +91 98765 43210.";
    if (!f.consent) e.consent = "Please agree so we can process your booking.";
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function submit(e) {
    e.preventDefault();
    setSubmitError("");
    if (!validate()) return;
    setBusy(true);
    try {
      const { booking } = await api("/bookings", {
        method: "POST",
        body: { ...body, promoCode: appliedPromo, guestName: f.guestName.trim(), guestEmail: f.guestEmail.trim(), guestPhone: f.guestPhone.trim(), specialRequests: f.specialRequests.trim(), consent: true },
      });
      navigate(`/book/${booking.ref}`);
    } catch (err) {
      setSubmitError(err.message);
      setBusy(false);
    }
  }

  const price = quote?.price;
  const backToRooms = `/stay?${qs(stay)}`;

  return (
    <div className="wrap page narrow-page">
      <Steps current={2} />
      <h1 className="page-title">Your details</h1>
      {quoteError && <ErrorNote error={quoteError}><>{quoteError.message} <Link to={backToRooms}>Choose another room</Link>.</></ErrorNote>}
      {!quote && !quoteError && <Loading label="Getting your price" />}

      {quote && (
        <div className="checkout">
          <section className="checkout-summary">
            <img src={photo(quote.roomType.photos[0])} alt="" />
            <h2 className="h3">{quote.roomType.name}, {price.plan.name}</h2>
            <p className="muted">{fmtDate(stay.checkIn)} to {fmtDate(stay.checkOut)}, {plural(price.nights.length, "night")}, {guestsLabel(stay)}</p>
            {!quote.available && <ErrorNote>These dates have just sold out for this room online. <Link to={backToRooms}>See other rooms</Link>.</ErrorNote>}
            <PriceBreakdown price={price} />
            <form className="promo" onSubmit={(e) => { e.preventDefault(); setPromoMsg(""); setAppliedPromo(promo.trim()); }}>
              <label className="field"><span>Promo code</span><input value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="e.g. DIRECT10" /></label>
              <button className="btn btn-secondary" disabled={!promo.trim()}>Apply</button>
            </form>
            {promoMsg && <p className="field-error">{promoMsg}</p>}
            {appliedPromo && price.promo && <p className="saving small">{price.promo.code} applied.</p>}
            <p><Link className="small" to={backToRooms}>Change room or dates</Link></p>
          </section>

          <section className="checkout-form">
            {user === null && (
              <div className="inline-auth">
                <p>Sign in or create an account to book. Your booking will be saved there.</p>
                <AuthForm initialMode="register" />
              </div>
            )}
            {user && isStaff(user) && <ErrorNote>You're signed in as staff. Sign out and use a guest account to make a booking.</ErrorNote>}
            {user && !isStaff(user) && (
              <form onSubmit={submit} noValidate>
                <label className="field"><span>Lead guest's full name</span>
                  <input value={f.guestName} onChange={set("guestName")} autoComplete="name" aria-invalid={!!errors.guestName} />
                  {errors.guestName && <small className="field-error">{errors.guestName}</small>}
                </label>
                <label className="field"><span>Email</span>
                  <input type="email" value={f.guestEmail} onChange={set("guestEmail")} autoComplete="email" aria-invalid={!!errors.guestEmail} />
                  {errors.guestEmail && <small className="field-error">{errors.guestEmail}</small>}
                </label>
                <label className="field"><span>Mobile</span>
                  <input value={f.guestPhone} onChange={set("guestPhone")} autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" aria-invalid={!!errors.guestPhone} />
                  {errors.guestPhone && <small className="field-error">{errors.guestPhone}</small>}
                </label>
                <label className="field"><span>Requests (optional)</span>
                  <textarea rows={3} value={f.specialRequests} onChange={set("specialRequests")} maxLength={500} placeholder="Arrival time, dietary needs, a cot for a baby…" />
                </label>
                <label className="check">
                  <input type="checkbox" checked={f.consent} onChange={set("consent")} />
                  <span>I agree that Kaapi Hills may use these details to manage this booking and contact me about it. We don't share them or use them for marketing without asking. Foreign nationals will be asked for passport and visa details at check-in (Form C), not here.</span>
                </label>
                {errors.consent && <small className="field-error">{errors.consent}</small>}
                {submitError && <ErrorNote>{submitError}</ErrorNote>}
                <button className="btn btn-primary btn-wide" disabled={busy || !quote.available}>{busy ? "Holding your room…" : "Continue to payment"}</button>
                <p className="muted small">We'll hold your room for 10 minutes while you pay.</p>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
