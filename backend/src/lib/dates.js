// Stay dates are calendar dates ("YYYY-MM-DD"). All arithmetic is done in UTC
// so the server's time zone can never shift a date. "Today" is taken in IST,
// because that is where the resort is.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s) {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function todayIST(now = new Date()) {
  return new Date(now.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
}

function nightsBetween(checkIn, checkOut) {
  const out = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d);
  return out;
}

function isWeekendNight(iso) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 5 || day === 6; // Friday and Saturday nights
}

module.exports = { isValidIsoDate, addDays, diffDays, todayIST, nightsBetween, isWeekendNight };
