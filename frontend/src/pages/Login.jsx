import { Navigate, useNavigate, useSearchParams } from "react-router";
import { isStaff, useAuth } from "../auth";
import AuthForm from "../components/AuthForm";

export default function Login() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const where = (u) => safeNext || (isStaff(u) ? "/staff" : "/account");

  if (user) return <Navigate to={where(user)} replace />;

  return (
    <div className="wrap page login-page">
      <h1 className="page-title">{params.get("staff") ? "Staff sign in" : "Sign in"}</h1>
      <AuthForm heading={false} onDone={(u) => navigate(where(u), { replace: true })} />
      <details className="demo">
        <summary>Demo accounts</summary>
        <ul className="plain-list small">
          <li>Guest: guest@kaapihills.test / Guest@123</li>
          <li>Reservations: reservations@kaapihills.test / Staff@123</li>
          <li>Sales (weddings, offsites): sales@kaapihills.test / Staff@123</li>
          <li>General Manager: gm@kaapihills.test / Gm@12345</li>
        </ul>
      </details>
    </div>
  );
}
