export function Loading({ label = "Loading" }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorNote({ error, onRetry, children }) {
  if (!error && !children) return null;
  return (
    <div className="note note-error" role="alert">
      <p>{children || error.message}</p>
      {onRetry && <button type="button" className="btn btn-quiet" onClick={() => onRetry()}>Try again</button>}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3 }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${90 - i * 15}%` }} />)}
    </div>
  );
}
