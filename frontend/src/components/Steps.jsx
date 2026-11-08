const STEPS = ["Choose room", "Your details", "Pay"];

export default function Steps({ current }) {
  return (
    <ol className="steps" aria-label="Booking steps">
      {STEPS.map((s, i) => (
        <li key={s} className={i + 1 === current ? "current" : i + 1 < current ? "done" : ""} aria-current={i + 1 === current ? "step" : undefined}>
          <span className="step-n">{i + 1}</span> {s}
        </li>
      ))}
    </ol>
  );
}
