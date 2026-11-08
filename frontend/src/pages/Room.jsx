import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { qs, useApi } from "../api";
import PriceBreakdown from "../components/PriceBreakdown";
import SearchBar from "../components/SearchBar";
import { ErrorNote, Loading, Skeleton } from "../components/States";
import { fmtDate, guestsLabel, rupees, stayFromParams, photo } from "../format";

export default function Room() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const hasDates = params.has("checkIn");
  const stay = stayFromParams(params);
  const navigate = useNavigate();
  const room = useApi(`/rooms/${slug}`);
  const calendar = useApi(`/rooms/${slug}/calendar?days=42`);
  const avail = useApi(hasDates ? `/availability?${qs(stay)}` : null);
  const [shown, setShown] = useState(0);

  if (room.loading) return <Loading label="Loading room" />;
  if (room.error) return <div className="wrap page"><ErrorNote error={room.error} onRetry={room.reload} /></div>;
  const r = room.data.room;
  const result = avail.data?.results.find((x) => x.slug === slug);

  return (
    <div className="wrap page">
      <p className="crumbs"><Link to={`/stay?${hasDates ? qs(stay) : ""}`}>All rooms</Link></p>
      <h1 className="page-title">{r.name}</h1>
      <div className="gallery">
        <img className="gallery-main" src={photo(r.photos[shown])} alt={`${r.name}, view ${shown + 1} of ${r.photos.length}`} />
        <div className="gallery-thumbs">
          {r.photos.map((p, i) => (
            <button key={p} className={i === shown ? "active" : ""} onClick={() => setShown(i)} aria-label={`Show image ${i + 1}`}>
              <img src={photo(p)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      </div>

      <div className="room-detail">
        <div className="room-about">
          <p className="lede">{r.description}</p>
          <dl className="facts">
            <div><dt>Size</dt><dd>{r.sizeSqft} sq ft</dd></div>
            <div><dt>Beds</dt><dd>{r.bed}</dd></div>
            <div><dt>View</dt><dd>{r.view}</dd></div>
            <div><dt>Sleeps</dt><dd>{r.maxAdults} adults, {r.maxChildren} children</dd></div>
            <div><dt>Extra adult</dt><dd>{rupees(r.extraAdultPaise)} a night, above {r.baseOccupancy} adults</dd></div>
          </dl>
          <h2 className="h3">In the {r.kind}</h2>
          <ul className="amenities">{r.amenities.map((a) => <li key={a}>{a}</li>)}</ul>

          <h2 className="h3">Next six weeks</h2>
          {calendar.loading && <Skeleton lines={2} />}
          <ErrorNote error={calendar.error} onRetry={calendar.reload} />
          {calendar.data && (
            <ol className="cal" aria-label="Nightly availability and rate">
              {calendar.data.days.map((d) => (
                <li key={d.date} className={d.available ? "" : "cal-off"} title={d.available ? `${d.free} left online` : "Not available online"}>
                  <span className="cal-date">{fmtDate(d.date, { weekday: "short", day: "numeric", month: undefined })}</span>
                  <span className="cal-rate">{d.available ? rupees(d.ratePaise) : "Full"}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="muted small">Nightly room rates before tax. Weekends and the festive season cost more.</p>
        </div>

        <aside className="book-box">
          <h2 className="h3">Check prices</h2>
          <SearchBar key={params.toString()} initial={stay} target={`/rooms/${slug}`} compact />
          {!hasDates && <p className="muted small">Pick dates to see the total price, with tax.</p>}
          {avail.loading && <Skeleton lines={3} />}
          <ErrorNote error={avail.error} onRetry={avail.reload} />
          {result && result.status !== "available" && <p className="unavailable">{result.message}</p>}
          {result?.status === "available" && (
            <>
              <p className="muted small">{fmtDate(stay.checkIn)} to {fmtDate(stay.checkOut)}, {guestsLabel(stay)}</p>
              {result.plans.map((p) => (
                <div key={p.code} className="plan-box">
                  <div className="plan-box-head">
                    <div>
                      <p className="plan-name">{p.name}</p>
                      <p className="muted small">{p.description}</p>
                    </div>
                    <button className="btn btn-primary" onClick={() => navigate(`/checkout?${qs({ ...stay, room: slug, plan: p.code })}`)}>Choose</button>
                  </div>
                  <PriceBreakdown price={p.price} />
                </div>
              ))}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
