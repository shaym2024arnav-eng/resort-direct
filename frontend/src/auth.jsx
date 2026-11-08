import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { api } from "./api";
import { Loading } from "./components/States";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking

  useEffect(() => {
    api("/auth/me").then((d) => setUser(d.user)).catch(() => setUser(null));
  }, []);

  const login = useCallback(async (email, password) => {
    const d = await api("/auth/login", { method: "POST", body: { email, password } });
    setUser(d.user);
    return d.user;
  }, []);

  const register = useCallback(async (fields) => {
    const d = await api("/auth/register", { method: "POST", body: fields });
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, login, register, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
export const isStaff = (u) => u && (u.role === "staff" || u.role === "gm");

export function RequireAuth({ staff = false, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <Loading label="Checking your session" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}${staff ? "&staff=1" : ""}`} replace />;
  if (staff && !isStaff(user)) return <Navigate to="/" replace />;
  return children;
}
