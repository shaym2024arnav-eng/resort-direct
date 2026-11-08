import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { isStaff, useAuth } from "../auth";

export function SiteLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="wrap header-inner">
          <Link to="/" className="brand" onClick={close}>Kaapi Hills</Link>
          <button className="menu-btn" aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen((o) => !o)}>
            {open ? "Close" : "Menu"}
          </button>
          <nav id="site-nav" className={`site-nav ${open ? "open" : ""}`} onClick={close}>
            <NavLink to="/stay">Rooms &amp; villas</NavLink>
            <NavLink to="/enquire?type=event">Weddings &amp; offsites</NavLink>
            <NavLink to="/enquire">Contact</NavLink>
            {isStaff(user) && <NavLink to="/staff">Staff</NavLink>}
            {user ? (
              <>
                {!isStaff(user) && <NavLink to="/account">My bookings</NavLink>}
                <button className="link-btn" onClick={async () => { await logout(); navigate("/"); }}>Sign out</button>
              </>
            ) : (
              user === null && <NavLink to="/login">Sign in</NavLink>
            )}
          </nav>
        </div>
      </header>
      <main id="main"><Outlet /></main>
      <footer className="site-footer">
        <div className="wrap footer-inner">
          <div>
            <p className="brand">Kaapi Hills</p>
            <p className="muted">Mullayanagiri Road, Chikkamagaluru, Karnataka 577101</p>
          </div>
          <div>
            <p>Reservations: <a href="tel:+919000000000">+91 90000 00000</a></p>
            <p><Link to="/enquire">Send us a message</Link></p>
          </div>
          <div className="muted small">
            <p>We collect only what we need to look after your stay, under India's Digital Personal Data Protection Act, 2023. Passport details for foreign nationals (Form C) are taken at check-in, never online.</p>
            <p>This is a demo site with sample data. No real payments are taken.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
