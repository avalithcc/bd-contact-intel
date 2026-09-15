import Link from "next/link";
import { getCurrentBd, listContacts } from "@/lib/queries";
import { UploadForm } from "./UploadForm";
import { SignOutButton } from "./SignOutButton";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; position?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const me = await getCurrentBd();
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = { company: sp.company, position: sp.position };
  const { rows, total, page: current, totalPages } = await listContacts(
    me.id,
    filters,
    page,
    PAGE_SIZE,
  );

  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (sp.company) params.set("company", sp.company);
    if (sp.position) params.set("position", sp.position);
    params.set("page", String(p));
    return `/?${params.toString()}`;
  };

  return (
    <main>
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        <SignOutButton />
      </div>

      <div style={{ marginBottom: "1.75rem" }}>
        <div className="eyebrow">// bd_contact_intelligence</div>
        <h1>
          contact base<span className="dot">.</span>
        </h1>
        <p className="soft" style={{ margin: 0 }}>
          Signed in as <strong>{me.name}</strong> ({me.email})
        </p>
      </div>

      <details className="import-block">
        <summary>Import LinkedIn database</summary>
        <div className="import-body">
          <UploadForm />
        </div>
      </details>

      <section className="panel">
        <div className="eyebrow">// filter</div>
        <form method="get" className="row">
          <div>
            <label htmlFor="company">Company</label>
            <input
              id="company"
              name="company"
              type="text"
              defaultValue={sp.company ?? ""}
              placeholder="e.g. YPF"
            />
          </div>
          <div>
            <label htmlFor="position">Position</label>
            <input
              id="position"
              name="position"
              type="text"
              defaultValue={sp.position ?? ""}
              placeholder="e.g. Engineering"
            />
          </div>
          <button type="submit">Filter</button>
        </form>
      </section>

      <section className="panel">
        <div className="eyebrow">// contacts</div>
        <p className="soft" style={{ marginTop: 0 }}>
          {total} total · page {current} of {totalPages}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Position</th>
                <th>Team overlap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="rowlink" href={`/contact/${c.id}`}>
                      {[c.firstName, c.lastName].filter(Boolean).join(" ") ||
                        "—"}
                    </Link>
                  </td>
                  <td>{c.company ?? "—"}</td>
                  <td>{c.position ?? "—"}</td>
                  <td>
                    {c.overlapWith.length ? (
                      <span className="badge">
                        also in {c.overlapWith.join(", ")}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No contacts yet. Import your Connections.csv above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="pager">
            {current > 1 ? (
              <Link className="secondary-btn" href={qs(current - 1)}>
                ← prev
              </Link>
            ) : (
              <span className="secondary-btn disabled">← prev</span>
            )}
            <span className="soft">
              {current} / {totalPages}
            </span>
            {current < totalPages ? (
              <Link className="secondary-btn" href={qs(current + 1)}>
                next →
              </Link>
            ) : (
              <span className="secondary-btn disabled">next →</span>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
