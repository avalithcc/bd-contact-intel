import { getCurrentBd, listContacts } from "@/lib/queries";
import { UploadForm } from "./UploadForm";

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
      <h1>BD Contact Intelligence</h1>
      <p className="muted">
        Signed in as <strong>{me.name}</strong> ({me.email})
      </p>

      <section className="panel">
        <UploadForm />
      </section>

      <section className="panel">
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
        <p className="muted">{contacts.length} contacts</p>
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
      </section>
    </main>
  );
}
