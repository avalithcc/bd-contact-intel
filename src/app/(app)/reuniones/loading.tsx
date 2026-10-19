/** Route-level fallback for /reuniones: header, tabs and table rows, from the design system's `.skeleton` only. */
export default function ReunionesLoading() {
  return (
    <main className="page" aria-busy="true">
      <div className="page-header">
        <div className="titles">
          <div className="skeleton" style={{ width: 120, height: 10, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 220, height: 24, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 320, height: 12 }} />
        </div>
      </div>
      <div className="row mb-lg" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton" style={{ width: 110, height: 28 }} />
        ))}
      </div>
      <div className="panel" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton" style={{ width: "100%", height: 20, marginBottom: 12 }} />
        ))}
      </div>
    </main>
  );
}
