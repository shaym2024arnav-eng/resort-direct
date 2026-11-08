class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const notFound = (what = "Resource") => new HttpError(404, `${what} not found.`);
const conflict = (msg, details) => new HttpError(409, msg, details);
const forbidden = (msg = "You don't have access to this.") => new HttpError(403, msg);

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.name === "ZodError") {
    const first = err.issues[0];
    const field = first.path.join(".");
    return res.status(400).json({ message: field ? `${field}: ${first.message}` : first.message, issues: err.issues });
  }
  if (err.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON body." });
  if (err.type === "entity.too.large") return res.status(413).json({ message: "Request is too large." });
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    message: status >= 500 ? "Something went wrong on our side. Please try again." : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}

module.exports = { HttpError, badRequest, notFound, conflict, forbidden, errorHandler };
