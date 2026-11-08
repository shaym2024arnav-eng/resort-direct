import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import "@fontsource/spectral/latin-400.css";
import "@fontsource/spectral/latin-500.css";
import "./styles.css";
import { AuthProvider, RequireAuth } from "./auth";
import { SiteLayout } from "./components/Layout";
import { Loading } from "./components/States";
import Home from "./pages/Home";
import Stay from "./pages/Stay";
import Room from "./pages/Room";

// Guest booking pages load first; checkout and the staff app are split out so the
// first visit downloads less on a slow connection.
const Checkout = lazy(() => import("./pages/Checkout"));
const Pay = lazy(() => import("./pages/Pay"));
const Confirmation = lazy(() => import("./pages/Confirmation"));
const Account = lazy(() => import("./pages/Account"));
const Enquire = lazy(() => import("./pages/Enquire"));
const Login = lazy(() => import("./pages/Login"));
const StaffLayout = lazy(() => import("./pages/staff/StaffLayout"));
const Inbox = lazy(() => import("./pages/staff/Inbox"));
const Rates = lazy(() => import("./pages/staff/Rates"));
const Bookings = lazy(() => import("./pages/staff/Bookings"));
const Promos = lazy(() => import("./pages/staff/Promos"));

function NotFound() {
  return (
    <div className="wrap page">
      <h1 className="page-title">We couldn't find that page.</h1>
      <p><Link to="/">Go to the home page</Link> or <Link to="/stay">check availability</Link>.</p>
    </div>
  );
}

// If a real photo (.jpg) isn't there, quietly show the generated placeholder (.svg) instead.
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName === "IMG" && /\/images\/.*\.jpg$/.test(img.getAttribute("src") || "")) {
    img.src = img.getAttribute("src").replace(/\.jpg$/, ".svg");
  }
}, true);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<SiteLayout />}>
              <Route index element={<Home />} />
              <Route path="stay" element={<Stay />} />
              <Route path="rooms/:slug" element={<Room />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="book/:ref" element={<RequireAuth><Pay /></RequireAuth>} />
              <Route path="booking/:ref" element={<RequireAuth><Confirmation /></RequireAuth>} />
              <Route path="account" element={<RequireAuth><Account /></RequireAuth>} />
              <Route path="enquire" element={<Enquire />} />
              <Route path="login" element={<Login />} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="staff" element={<RequireAuth staff><StaffLayout /></RequireAuth>}>
              <Route index element={<Inbox />} />
              <Route path="rates" element={<Rates />} />
              <Route path="bookings" element={<Bookings />} />
              <Route path="promos" element={<Promos />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
