export const rupees = (paise) =>
  paise == null ? "" : `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

const d = (iso) => new Date(`${iso}T00:00:00Z`);

export const fmtDate = (iso, opts = {}) =>
  iso ? d(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC", ...opts }) : "";

export const fmtDateLong = (iso) => fmtDate(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export const fmtDateTime = (ts) =>
  ts ? new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";

export function timeAgo(ts) {
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function todayIST() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const x = d(iso);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export const diffDays = (a, b) => Math.round((d(b) - d(a)) / 86400000);

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function guestsLabel({ adults, children, rooms }) {
  const parts = [plural(Number(adults), "adult")];
  if (Number(children)) parts.push(plural(Number(children), "child", "children"));
  if (Number(rooms) > 1) parts.push(plural(Number(rooms), "room"));
  return parts.join(", ");
}

/** Read the stay from URL search params with safe defaults. */
export function stayFromParams(params) {
  const today = todayIST();
  const checkIn = params.get("checkIn") || addDays(today, 7);
  const checkOut = params.get("checkOut") || addDays(checkIn, 2);
  return {
    checkIn, checkOut,
    adults: params.get("adults") || "2",
    children: params.get("children") || "0",
    rooms: params.get("rooms") || "1",
  };
}

export const CATEGORY = {
  room_booking: "Room booking",
  wedding: "Wedding",
  corporate_offsite: "Corporate offsite",
  complaint: "Complaint",
  other: "Other",
};

export const CHANNEL = { web: "Website", event_form: "Event form", email: "Email", whatsapp: "WhatsApp" };

// Real photos are optional: a .jpg saved next to a placeholder (same name) is used first,
// and the generated .svg is the fallback (see the error handler in main.jsx).
export const photo = (path) => (path ? path.replace(/\.svg$/, ".jpg") : path);
