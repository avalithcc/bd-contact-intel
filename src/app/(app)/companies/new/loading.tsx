/**
 * Fallback for /companies/new. A route-segment loading.tsx wraps every
 * nested route, so without this file the form page would flash the list
 * skeleton from ../loading.tsx — the wrong shape. Mirrors the real page:
 * back link, header, then the `.composer` form with a name field and a
 * grid of selects, from design-system.css's `.skeleton` block only.
 */
export default function NewCompanyLoading() {
  return (
    <main className="page" aria-busy="true">
      <div aria-hidden="true">
        <div className="skeleton" style={{ width: 120, height: 12, marginBottom: 12 }} />
      </div>

      <div className="page-header">
        <div className="titles">
          <div className="skeleton" style={{ width: 120, height: 10, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 220, height: 24 }} />
        </div>
      </div>

      <div className="composer" aria-hidden="true">
        <div className="skeleton" style={{ width: "100%", height: 36, marginBottom: 16 }} />
        <div className="form-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton" style={{ width: "100%", height: 36 }} />
          ))}
        </div>
      </div>
    </main>
  );
}
