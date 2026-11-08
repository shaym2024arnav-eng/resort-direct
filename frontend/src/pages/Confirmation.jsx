import { Link, useParams } from "react-router";
import { useApi } from "../api";
import PriceBreakdown from "../components/PriceBreakdown";
import { ErrorNote, Loading } from "../components/States";
import { fmtDateLong, guestsLabel, plural, photo } from "../format";

export default function Confirmation() {
  const { ref } = useParams();
  const { data, error, loading, reload } = useApi(`/bookings/${ref}`);
  if (loading) return <Loading label="Loading your booking" />;
  if (error) return <div className="wrap page"><ErrorNote error={error} onRetry={reload} /></div>;
  const b = data.booking;

  if (b.status === "held") {
    return <div className="wrap page"><ErrorNote>This booking isn't paid yet. <Link to={`/book/${b.ref}`}>Complete payment</Link>.</ErrorNote></div>;
  }

  return (
    <div className="wrap page narrow-page confirmation">
      {b.status === "confirmed" ? (
        <>
          <h1 className="page-title">You're booked, {b.guestName.split(" ")[0]}.</h1>
          <p className="lede">Your reference is <strong className="ref">{b.ref}</strong>. Keep it handy for check-in. (Confirmation emails to {b.guestEmail} are simulated in this demo.)</p>
        </>
      ) : (
        <h1 className="page-title">Booking {b.ref} is {b.status}</h1>
      )}

      <div className="confirm-grid">
        <section>
          <img src={photo(b.roomType.photo)} alt="" className="confirm-photo" />
          <dl className="facts">
            <div><dt>Room</dt><dd>{b.rooms > 1 ? `${b.rooms} × ` : ""}{b.roomType.name}</dd></div>
            <div><dt>Rate</dt><dd>{b.plan.name}</dd></div>
            <div><dt>Check-in</dt><dd>{fmtDateLong(b.checkIn)}, from 2 pm</dd></div>
            <div><dt>Check-out</dt><dd>{fmtDateLong(b.checkOut)}, by 11 am</dd></div>
            <div><dt>Guests</dt><dd>{guestsLabel(b)}, {plural(b.nights, "night")}</dd></div>
            {b.specialRequests && <div><dt>Requests</dt><dd>{b.specialRequests}</dd></div>}
            <div><dt>Payment</dt><dd className="muted">{b.paymentRef} (test)</dd></div>
          </dl>
        </section>
        <section>
          <h2 className="h3">What you paid</h2>
          <PriceBreakdown price={b.price} open />
          <h2 className="h3">Before you arrive</h2>
          <ul className="plain-list small">
            <li>Bring a government photo ID for each adult.</li>
            <li>Guests from outside India: bring your passport and visa. We complete Form C at the front desk.</li>
            <li>The last 6 km are a narrow estate road. Leave Chikkamagaluru town before dark if you can.</li>
          </ul>
          <p className="actions">
            <button className="btn btn-secondary" onClick={() => window.print()}>Print</button>
            <Link className="btn btn-quiet" to="/account">All my bookings</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
