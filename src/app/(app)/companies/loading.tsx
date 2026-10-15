/**
 * Route-level Suspense fallback for /companies. Without it nothing changed on
 * screen between the click and the server's response (owner report: "demora en
 * cargar, no se entiende si el click hizo efecto"). Same pattern as
 * contacts/loading.tsx: a loose approximation of the real page shell (header,
 * three view tabs, toolbar, table rows) built from design-system.css's
 * `.skeleton` block only — no new CSS.
 */
export default function CompaniesLoading() {
  return (
    <main className="page" aria-busy="true">
      <div className="page-header">
        <div className="titles">
          <div className="skeleton" style={{ width: 120, height: 10, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 220, height: 24, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 320, height: 12 }} />
        </div>
        <div className="actions">
          <div className="skeleton" style={{ width: 140, height: 32 }} />
        </div>
      </div>

      <nav className="view-tabs" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="skeleton" style={{ width: 96, height: 28, marginRight: 8 }} />
        ))}
      </nav>

      <div className="toolbar" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton" style={{ width: 110, height: 28, marginRight: 8 }} />
        ))}
      </div>

      <div className="panel" aria-hidden="true">
        <div className="skeleton" style={{ width: "100%", height: 36, marginBottom: 12 }} />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton" style={{ width: "100%", height: 20, marginBottom: 8 }} />
        ))}
      </div>
    </main>
  );
}
