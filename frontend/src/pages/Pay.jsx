import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { api, useApi } from "../api";
import PriceBreakdown from "../components/PriceBreakdown";
import { ErrorNote, Loading } from "../components/States";
import Steps from "../components/Steps";
import { fmtDate, guestsLabel, plural, rupees } from "../format";

function useCountdown(until) {
  const [left, setLeft] = useState(() => (until ? new Date(until) - Date.now() : 0));
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setLeft(new Date(until) - Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return Math.max(0, left);
}

const formatCard = (v) => v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
const formatExpiry = (v) => {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

// Step 3: test payment. The hold countdown is the server's, not the browser's.
export default function Pay() {
  const { ref } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi(`/bookings/${ref}`);
  const booking = data?.booking;
  const left = useCountdown(booking?.status === "held" ? booking.holdExpiresAt : null);
  const [card, setCard] = useState({ cardNumber: "", expiry: "", cvc: "", nameOnCard: "" });
  const [payError, setPayError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (booking?.status === "held" && left === 0) reload({ quiet: true });
  }, [left, booking?.status, reload]);

  if (loading) return <Loading label="Loading your booking" />;
  if (error) return <div className="wrap page"><ErrorNote error={error} onRetry={reload} /></div>;
  if (booking.status === "confirmed") return <Navigate to={`/booking/${ref}`} replace />;

  const set = (k, fmt = (v) => v) => (e) => setCard((c) => ({ ...c, [k]: fmt(e.target.value) }));

  async function pay(e) {
    e.preventDefault();
    setPayError("");
    setBusy(true);
    try {
      await api(`/bookings/${ref}/pay`, { method: "POST", body: card });
      navigate(`/booking/${ref}`);
    } catch (err) {
      setPayError(err.message);
      if (err.status === 409) reload({ quiet: true });
      setBusy(false);
    }
  }

  async function cancelHold() {
    setCancelling(true);
    await api(`/bookings/${ref}/cancel`, { method: "POST" }).catch(() => {});
    navigate(`/stay?checkIn=${booking.checkIn}&checkOut=${booking.checkOut}&adults=${booking.adults}&children=${booking.children}&rooms=${booking.rooms}`);
  }

  const mm = String(Math.floor(left / 60000)).padStart(1, "0");
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  const searchAgain = `/stay?checkIn=${booking.checkIn}&checkOut=${booking.checkOut}&adults=${booking.adults}&children=${booking.children}&rooms=${booking.rooms}`;

  return (
    <div className="wrap page narrow-page">
      <Steps current={3} />
      <h1 className="page-title">Pay {rupees(booking.totalPaise)}</h1>

      {booking.status !== "held" ? (
        <ErrorNote>
          {booking.status === "expired"
            ? "Your 10-minute hold ran out and the room was released. Nothing was charged."
            : `This booking was ${booking.status}.`}{" "}
          <Link to={searchAgain}>Search these dates again</Link>.
        </ErrorNote>
      ) : (
        <div className="checkout">
          <section className="checkout-summary">
            <p className={`hold ${left < 120000 ? "hold-low" : ""}`} role="timer" aria-live="off">
              Room held for <strong>{mm}:{ss}</strong>
            </p>
            <h2 className="h3">{booking.roomType.name}, {booking.plan.name}</h2>
            <p className="muted">{fmtDate(booking.checkIn)} to {fmtDate(booking.checkOut)}, {plural(booking.nights, "night")}, {guestsLabel(booking)}</p>
            <p className="muted small">Booking reference {booking.ref}, for {booking.guestName}</p>
            <PriceBreakdown price={booking.price} />
          </section>

          <section className="checkout-form">
            <div className="note note-info">
              <p><strong>Test payments only.</strong> Use card 4242 4242 4242 4242 (succeeds) or 4000 0000 0000 0002 (declined), any future expiry and any CVC.</p>
            </div>
            <form onSubmit={pay}>
              <label className="field"><span>Card number</span>
                <input value={card.cardNumber} onChange={set("cardNumber", formatCard)} inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" required />
              </label>
              <div className="field-row">
                <label className="field"><span>Expiry</span>
                  <input value={card.expiry} onChange={set("expiry", formatExpiry)} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" required />
                </label>
                <label className="field"><span>CVC</span>
                  <input value={card.cvc} onChange={set("cvc", (v) => v.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="cc-csc" placeholder="123" required />
                </label>
              </div>
              <label className="field"><span>Name on card</span>
                <input value={card.nameOnCard} onChange={set("nameOnCard")} autoComplete="cc-name" required />
              </label>
              {payError && <ErrorNote>{payError}</ErrorNote>}
              <button className="btn btn-primary btn-wide" disabled={busy || left === 0}>{busy ? "Processing…" : `Pay ${rupees(booking.totalPaise)}`}</button>
              <p className="small">
                {booking.plan.refundable ? "Free cancellation up to 7 days before arrival." : "This rate can't be refunded once paid."}{" "}
                <button type="button" className="link-btn" onClick={cancelHold} disabled={cancelling}>Release this room and go back</button>
              </p>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
