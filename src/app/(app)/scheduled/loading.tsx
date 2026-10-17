/** Route-level fallback for /scheduled: header and table rows, from the design system's `.skeleton` only. */
export default function ScheduledLoading() {
  return (
    <main className="page" aria-busy="true">
      <div className="page-header">
        <div className="titles">
          <div className="skeleton" style={{ width: 90, height: 10, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 260, height: 24, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 420, height: 12 }} />
        </div>
      </div>
      <div className="panel" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ width: "100%", height: 20, marginBottom: 12 }} />)}
      </div>
    </main>
  );
}
