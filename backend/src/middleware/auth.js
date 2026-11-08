const jwt = require("jsonwebtoken");
const config = require("../config");
const { pool } = require("../db/pool");
const { HttpError, forbidden } = require("../lib/errors");

const COOKIE = "kh_session";
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,            // not readable from JavaScript
    sameSite: "lax",           // not sent on cross-site POSTs (CSRF protection)
    secure: config.isProd,     // HTTPS only in production
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: "/", sameSite: "lax", secure: config.isProd, httpOnly: true });
}

// Attach req.user when a valid session cookie is present. The role is re-read from the
// database on each request so a changed or removed account takes effect immediately.
async function loadUser(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const { rows } = await pool.query("SELECT id, email, name, phone, role, team FROM users WHERE id = $1", [payload.sub]);
    if (rows[0]) req.user = rows[0];
    else clearSession(res);
  } catch {
    clearSession(res);
  }
  next();
}

const requireAuth = (req, res, next) => (req.user ? next() : next(new HttpError(401, "Please sign in to continue.")));

const requireStaff = (req, res, next) => {
  if (!req.user) return next(new HttpError(401, "Please sign in to continue."));
  if (req.user.role !== "staff" && req.user.role !== "gm") return next(forbidden("This area is for resort staff."));
  next();
};

const requireGm = (req, res, next) => {
  if (!req.user) return next(new HttpError(401, "Please sign in to continue."));
  if (req.user.role !== "gm") return next(forbidden("Only the General Manager can do this."));
  next();
};

module.exports = { setSession, clearSession, loadUser, requireAuth, requireStaff, requireGm, COOKIE };
