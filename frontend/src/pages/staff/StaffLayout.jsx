import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useAuth } from "../../auth";

export default function StaffLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="staff">
      <a className="skip" href="#staff-main">Skip to content</a>
      <header className="staff-header">
        <Link to="/staff" className="brand">Kaapi Hills <span className="muted">staff</span></Link>
        <nav className="staff-nav">
          <NavLink to="/staff" end>Inbox</NavLink>
          <NavLink to="/staff/rates">Rates &amp; allotment</NavLink>
          <NavLink to="/staff/bookings">Bookings</NavLink>
          <NavLink to="/staff/promos">Promo codes</NavLink>
        </nav>
        <div className="staff-user">
          <span>{user.name}, {user.role === "gm" ? "General Manager" : user.team === "sales" ? "Sales" : "Reservations"}</span>
          <Link to="/">Website</Link>
          <button className="link-btn" onClick={async () => { await logout(); navigate("/login?staff=1"); }}>Sign out</button>
        </div>
      </header>
      <main id="staff-main" className="staff-main"><Outlet /></main>
    </div>
  );
}
