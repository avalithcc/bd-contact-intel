/** Route-level fallback for /sequences/new: header, four stat cards and table rows, from the design system's `.skeleton` only. */
export default function SequencesLoading() {
  return (
    <main className="page" aria-busy="true">
      <div className="page-header">
        <div className="titles">
          <div className="skeleton" style={{ width: 120, height: 10, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 220, height: 24, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 320, height: 12 }} />
        </div>
        <div className="actions"><div className="skeleton" style={{ width: 140, height: 32 }} /></div>
      </div>
      <div className="grid-4 mb-lg" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ width: "100%", height: 84 }} />)}
      </div>
      <div className="panel" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" style={{ width: "100%", height: 20, marginBottom: 12 }} />)}
      </div>
    </main>
  );
}
