/**
 * Fallback for /companies/[key]. A route-segment loading.tsx wraps every
 * nested route, so without this file the record page would flash the list
 * skeleton from ../loading.tsx — the wrong shape. Mirrors the real page:
 * breadcrumbs, then the `.record` two-column layout (about pane + main
 * column), from design-system.css's `.skeleton` block only — no new CSS.
 */
export default function CompanyRecordLoading() {
  return (
    <main aria-busy="true">
      <div className="breadcrumbs" aria-hidden="true">
        <div className="skeleton" style={{ width: 180, height: 12 }} />
      </div>

      <div className="record" aria-hidden="true">
        <div>
          <div className="skeleton" style={{ width: 56, height: 56, marginBottom: 12 }} />
          <div className="skeleton" style={{ width: 200, height: 24, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 160, height: 12, marginBottom: 20 }} />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton" style={{ width: "100%", height: 20, marginBottom: 10 }} />
          ))}
        </div>
        <div className="record-main">
          <div className="skeleton" style={{ width: 280, height: 28, marginBottom: 16 }} />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton" style={{ width: "100%", height: 48, marginBottom: 10 }} />
          ))}
        </div>
      </div>
    </main>
  );
}
