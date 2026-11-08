import { Link } from "react-router";
import { useApi } from "../api";
import SearchBar from "../components/SearchBar";
import { ErrorNote, Skeleton } from "../components/States";
import { addDays, rupees, todayIST, photo } from "../format";

export default function Home() {
  const today = todayIST();
  const rooms = useApi("/rooms");
  const initial = { checkIn: addDays(today, 7), checkOut: addDays(today, 9), adults: "2", children: "0", rooms: "1" };

  return (
    <>
      <section className="hero">
        <div className="wrap hero-copy">
          <h1>Wake up on a working coffee estate in the Chikkamagaluru hills.</h1>
          <p className="lede">64 rooms and 12 villas among shade-grown arabica, 1,100 metres up. Booking here gets you our best rate.</p>
        </div>
        <img className="hero-img" src="/images/hero.jpg" alt="Mist over the ridges and coffee rows of the estate" fetchpriority="high" />
        <div className="wrap hero-search">
          <SearchBar initial={initial} />
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <h2>Rooms and villas</h2>
          <Link to="/stay">See prices for your dates</Link>
        </div>
        {rooms.loading && <Skeleton lines={4} />}
        <ErrorNote error={rooms.error} onRetry={rooms.reload} />
        <div className="room-list">
          {rooms.data?.rooms.map((r, i) => (
            <article key={r.slug} className={`room-row ${i % 2 ? "room-row-flip" : ""}`}>
              <Link to={`/rooms/${r.slug}`} className="room-row-photo" tabIndex={-1} aria-hidden="true">
                <img src={photo(r.photos[0])} alt="" loading="lazy" width="1600" height="1000" />
              </Link>
              <div className="room-row-text">
                <h3><Link to={`/rooms/${r.slug}`}>{r.name}</Link></h3>
                <p>{r.summary}</p>
                <p className="muted small">{r.sizeSqft} sq ft, {r.bed.toLowerCase()}, sleeps {r.maxAdults} adults{r.maxChildren ? ` and ${r.maxChildren} children` : ""}</p>
                {r.fromRatePaise && <p className="from">From <strong>{rupees(r.fromRatePaise)}</strong> a night, before tax</p>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="direct">
        <div className="wrap direct-inner">
          <h2>Why book with us directly</h2>
          <ul className="plain-list">
            <li><strong>The lowest price we offer anywhere,</strong> and 10% more off stays of two nights or more with code DIRECT10.</li>
            <li><strong>Free cancellation</strong> up to 7 days before arrival on our flexible rates.</li>
            <li><strong>Every price shows GST</strong> at the rate that applies to your room, so the total you see is what you pay.</li>
          </ul>
        </div>
      </section>

      <section className="wrap section events-teaser">
        <img src="/images/events.jpg" alt="The estate lawns in late afternoon light" loading="lazy" />
        <div>
          <h2>Weddings, family celebrations and team offsites</h2>
          <p>Lawns for up to 400 guests, a 120-seat conference hall, and the whole estate for a buyout. Tell us your dates and numbers and our events team will send you a proposal.</p>
          <Link className="btn btn-secondary" to="/enquire?type=event">Plan an event</Link>
        </div>
      </section>
    </>
  );
}
