import { useState } from "react";
import { useNavigate } from "react-router";
import { qs } from "../api";
import { addDays, diffDays, todayIST } from "../format";

// Dates and guests. Submits to /stay with the choice in the URL, so results are shareable.
export default function SearchBar({ initial, target = "/stay", compact = false }) {
  const navigate = useNavigate();
  const today = todayIST();
  const [s, setS] = useState(initial);
  const [error, setError] = useState("");
  const set = (k) => (e) => {
    const v = e.target.value;
    setS((prev) => {
      const next = { ...prev, [k]: v };
      if (k === "checkIn" && v && next.checkOut <= v) next.checkOut = addDays(v, 1);
      return next;
    });
  };

  function submit(e) {
    e.preventDefault();
    const nights = diffDays(s.checkIn, s.checkOut);
    if (!s.checkIn || !s.checkOut) return setError("Choose your check-in and check-out dates.");
    if (s.checkIn < today) return setError("Check-in can't be in the past.");
    if (nights < 1) return setError("Check-out must be after check-in.");
    if (nights > 14) return setError("For stays longer than 14 nights, please send us an enquiry.");
    setError("");
    navigate(`${target}?${qs(s)}`);
  }

  return (
    <form className={`search ${compact ? "search-compact" : ""}`} onSubmit={submit} noValidate>
      <label className="field">
        <span>Check-in</span>
        <input type="date" value={s.checkIn} min={today} max={addDays(today, 365)} onChange={set("checkIn")} required />
      </label>
      <label className="field">
        <span>Check-out</span>
        <input type="date" value={s.checkOut} min={addDays(s.checkIn || today, 1)} max={addDays(today, 380)} onChange={set("checkOut")} required />
      </label>
      <label className="field field-narrow">
        <span>Adults</span>
        <select value={s.adults} onChange={set("adults")}>
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}
        </select>
      </label>
      <label className="field field-narrow">
        <span>Children</span>
        <select value={s.children} onChange={set("children")}>
          {Array.from({ length: 7 }, (_, i) => <option key={i}>{i}</option>)}
        </select>
      </label>
      <label className="field field-narrow">
        <span>Rooms</span>
        <select value={s.rooms} onChange={set("rooms")}>
          {[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}
        </select>
      </label>
      <button className="btn btn-primary search-go" type="submit">Check availability</button>
      {error && <p className="field-error search-error" role="alert">{error}</p>}
    </form>
  );
}
