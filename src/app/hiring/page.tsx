import Link from "next/link";
import { getCompanyHiringSummaries } from "@/lib/hiring/queries";

export const dynamic = "force-dynamic";

export default async function HiringPage() {
  const summaries = await getCompanyHiringSummaries();

  return (
    <main>
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        <Link className="secondary-btn" href="/">
          ← contacts
        </Link>
      </div>

      <div style={{ marginBottom: "1.75rem" }}>
        <div className="eyebrow">// hiring_signals</div>
        <h1>
          open IT roles<span className="dot">.</span>
        </h1>
        <p className="soft" style={{ margin: 0 }}>
          Target companies currently hiring for IT roles, tracked from their public job boards.
        </p>
      </div>

      <section className="panel">
        <div className="eyebrow">// companies</div>
        {!summaries.length && (
          <p className="muted">
            No open IT postings tracked yet. Seed target companies (see
            scripts/seed-target-companies.ts) and run a sync.
          </p>
        )}
        {summaries.map((s) => (
          <details key={s.companyKey} className="filter-helper" style={{ marginBottom: "0.75rem" }}>
            <summary>
              {s.displayName} — {s.openItCount} open IT posting{s.openItCount === 1 ? "" : "s"}
              {s.newLast7Days > 0 && (
                <span className="badge green">
                  {s.newLast7Days} new
                </span>
              )}
              <span className="filter-helper-hint">show postings</span>
            </summary>
            <div className="filter-helper-body">
              <ul className="example-list">
                {s.postings.map((p) => (
                  <li key={p.id}>
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      {p.title}
                    </a>{" "}
                    <span className="muted">
                      — {p.location || "location n/a"}
                      {p.postedAt ? ` · posted ${p.postedAt.toLocaleDateString()}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        ))}
      </section>
    </main>
  );
}
