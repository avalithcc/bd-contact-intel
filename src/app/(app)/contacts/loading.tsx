/**
 * Route-level Suspense fallback for /contacts (owner feedback round 18:
 * "the user must see progress immediately on click"). Next.js shows this
 * instantly on navigation, before the Server Component's data (listPage,
 * boardColumns, systemViewCounts, hiring index, ...) resolves — independent
 * of how slow any of those queries happen to be. Deliberately a loose
 * approximation of the real page shell (header, view-tabs, toolbar, a few
 * table rows), built from design-system.css's `.skeleton` block only — no
 * new CSS.
 */
export default function ContactsLoading() {
  return (
    <main className="page" aria-busy="true">
      <div className="page-header">
        <div className="titles">
          <div className="skeleton" style={{ width: 120, height: 10, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 220, height: 24, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: 320, height: 12 }} />
        </div>
        <div className="actions">
          <div className="skeleton" style={{ width: 160, height: 32 }} />
        </div>
      </div>

      <nav className="view-tabs" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton" style={{ width: 96, height: 28, marginRight: 8 }} />
        ))}
      </nav>

      <div className="panel" aria-hidden="true">
        <div className="skeleton" style={{ width: "100%", height: 36, marginBottom: 12 }} />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton" style={{ width: "100%", height: 20, marginBottom: 8 }} />
        ))}
      </div>
    </main>
  );
}
