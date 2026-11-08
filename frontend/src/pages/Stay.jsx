import { Link, useNavigate, useSearchParams } from "react-router";
import { qs, useApi } from "../api";
import SearchBar from "../components/SearchBar";
import { Empty, ErrorNote, Skeleton } from "../components/States";
import { diffDays, fmtDate, guestsLabel, plural, rupees, stayFromParams, photo } from "../format";

export default function Stay() {
  const [params] = useSearchParams();
  const stay = stayFromParams(params);
  const res = useApi(`/availability?${qs(stay)}`);
  const navigate = useNavigate();
  const nights = diffDays(stay.checkIn, stay.checkOut);
  const results = res.data?.results || [];
  const available = results.filter((r) => r.status === "available");

  return (
    <div className="wrap page">
      <h1 className="page-title">Choose your room</h1>
      <SearchBar key={params.toString()} initial={stay} compact />
      <p className="muted results-for">
        {fmtDate(stay.checkIn)} to {fmtDate(stay.checkOut)}, {plural(nights, "night")}, {guestsLabel(stay)}
      </p>

      {res.loading && <Skeleton lines={6} />}
      <ErrorNote error={res.error} onRetry={res.reload} />

      {res.data && !available.length && (
        <Empty title="Nothing is available online for these dates.">
          Try moving your dates by a day or two, or <Link to="/enquire">send us a message</Link> and our reservations team will check every option, including rooms held for other channels.
        </Empty>
      )}

      <div className="results">
        {results.map((r) => (
          <article key={r.slug} className={`result ${r.status !== "available" ? "result-off" : ""}`}>
            <Link to={`/rooms/${r.slug}?${qs(stay)}`} className="result-photo" tabIndex={-1} aria-hidden="true">
              <img src={photo(r.photos[0])} alt="" loading="lazy" />
            </Link>
            <div className="result-body">
              <div className="result-head">
                <h2><Link to={`/rooms/${r.slug}?${qs(stay)}`}>{r.name}</Link></h2>
                {r.status === "available" && r.unitsLeft <= 2 && <span className="tag tag-warn">{r.unitsLeft === 1 ? "Last one" : "2 left"} online</span>}
              </div>
              <p className="muted">{r.summary}</p>
              {r.status !== "available" ? (
                <p className="unavailable">{r.message}</p>
              ) : (
                <ul className="plans">
                  {r.plans.map((p) => (
                    <li key={p.code} className="plan">
                      <div>
                        <p className="plan-name">{p.name}</p>
                        <p className="muted small">{p.description}</p>
                      </div>
                      <div className="plan-price">
                        <p className="amount">{rupees(p.price.totalPaise)}</p>
                        <p className="muted small">total incl. {rupees(p.price.taxPaise)} GST</p>
                        <button className="btn btn-primary" onClick={() => navigate(`/checkout?${qs({ ...stay, room: r.slug, plan: p.code })}`)}>
                          Choose
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
