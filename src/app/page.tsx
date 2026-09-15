import { getCurrentBd, listContacts } from "@/lib/queries";
import { UploadForm } from "./UploadForm";
import { SignOutButton } from "./SignOutButton";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; position?: string }>;
}) {
  const sp = await searchParams;
  const me = await getCurrentBd();
  const contacts = await listContacts(me.id, {
    company: sp.company,
    position: sp.position,
  });

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

      <section className="panel">
        <div className="eyebrow">// import</div>
        <UploadForm />
      </section>

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
          {contacts.length}
          {contacts.length === 500 ? "+" : ""} shown
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>name</th>
                <th>company</th>
                <th>position</th>
                <th>team_overlap</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
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
              {!contacts.length && (
                <tr>
                  <td colSpan={4} className="muted">
                    No contacts yet. Import your Connections.csv above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
