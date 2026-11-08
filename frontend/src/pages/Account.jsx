import { Link } from "react-router";
import { useApi } from "../api";
import { useAuth } from "../auth";
import { Empty, ErrorNote, Skeleton } from "../components/States";
import { fmtDate, plural, rupees, todayIST, photo } from "../format";

const STATUS = { confirmed: "Confirmed", held: "Awaiting payment", cancelled: "Cancelled" };

export default function Account() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi("/bookings/mine");
  const today = todayIST();
  const bookings = data?.bookings || [];
  const upcoming = bookings.filter((b) => b.checkOut >= today && b.status !== "cancelled");
  const past = bookings.filter((b) => !upcoming.includes(b));

  const list = (items) => (
    <ul className="booking-list">
      {items.map((b) => (
        <li key={b.ref}>
          <Link to={b.status === "held" ? `/book/${b.ref}` : `/booking/${b.ref}`} className="booking-item">
            <img src={photo(b.roomType.photo)} alt="" />
            <div>
              <p className="booking-title">{b.roomType.name}</p>
              <p className="muted small">{fmtDate(b.checkIn)} to {fmtDate(b.checkOut)}, {plural(b.nights, "night")}</p>
              <p className="small">{b.ref} <span className={`tag tag-${b.status}`}>{STATUS[b.status]}</span></p>
            </div>
            <p className="amount">{rupees(b.totalPaise)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="wrap page narrow-page">
      <h1 className="page-title">My bookings</h1>
      <p className="muted">Signed in as {user.name} ({user.email})</p>
      {loading && <Skeleton lines={4} />}
      <ErrorNote error={error} onRetry={reload} />
      {data && !bookings.length && (
        <Empty title="You haven't booked with us yet." action={<Link className="btn btn-primary" to="/stay">Find a room</Link>} />
      )}
      {upcoming.length > 0 && <><h2 className="h3">Upcoming</h2>{list(upcoming)}</>}
      {past.length > 0 && <><h2 className="h3">Past and cancelled</h2>{list(past)}</>}
    </div>
  );
}
