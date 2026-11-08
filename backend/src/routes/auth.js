const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { pool } = require("../db/pool");
const config = require("../config");
const { z, phone } = require("../lib/validate");
const { setSession, clearSession } = require("../middleware/auth");
const { HttpError, conflict } = require("../lib/errors");

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false,
  skip: () => config.isTest, message: { message: "Too many attempts. Please wait a few minutes and try again." },
});

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, team: u.team });

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(120).transform((s) => s.toLowerCase()),
  phone: phone.optional(),
  password: z.string().min(8, "must be at least 8 characters").max(72),
});

router.post("/register", limiter, async (req, res) => {
  const body = registerSchema.parse(req.body);
  const hash = await bcrypt.hash(body.password, 10);
  try {
    // Self sign-up only ever creates guest accounts. Staff accounts are created by the resort.
    const { rows: [user] } = await pool.query(
      "INSERT INTO users (email, password_hash, name, phone, role) VALUES ($1, $2, $3, $4, 'guest') RETURNING *",
      [body.email, hash, body.name, body.phone || null]
    );
    setSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err.code === "23505") throw conflict("An account with this email already exists. Try signing in.");
    throw err;
  }
});

const loginSchema = z.object({ email: z.string().trim().toLowerCase().max(120), password: z.string().max(72) });

router.post("/login", limiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const { rows: [user] } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  // Same message either way so the form can't be used to discover which emails have accounts.
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) throw new HttpError(401, "That email and password don't match.");
  setSession(res, user);
  res.json({ user: publicUser(user) });
});

router.post("/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get("/me", (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

module.exports = router;
