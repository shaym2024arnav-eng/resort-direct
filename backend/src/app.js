const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const config = require("./config");
const { loadUser } = require("./middleware/auth");
const { errorHandler, notFound } = require("./lib/errors");

const app = express();
app.set("trust proxy", 1); // behind Render's proxy: correct client IPs for rate limiting
app.disable("x-powered-by");

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(compression()); // smaller responses for slow hill-station networks
app.use(express.json({ limit: "50kb" }));
app.use(cookieParser());

// Only needed when the frontend runs on a different origin (local dev uses Vite's proxy instead).
if (config.clientOrigin) {
  app.use((req, res, next) => {
    if (req.headers.origin === config.clientOrigin) {
      res.set("Access-Control-Allow-Origin", config.clientOrigin);
      res.set("Access-Control-Allow-Credentials", "true");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE");
      res.set("Vary", "Origin");
      if (req.method === "OPTIONS") return res.sendStatus(204);
    }
    next();
  });
}

app.use("/api", loadUser);
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/bookings", require("./routes/bookings"));
app.use("/api/staff", require("./routes/staff"));
app.use("/api", require("./routes/public"));
app.use("/api", (req, res, next) => next(notFound("API route")));

// In production the API also serves the built React app (same origin: no CORS, first-party cookies).
const dist = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(dist)) {
  app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(express.static(dist, { maxAge: "1h", index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.use(errorHandler);

module.exports = app;
