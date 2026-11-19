import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/i18n/format";
import { fillTemplate } from "@/lib/i18n/template";
import { listProspectDrafts } from "@/lib/prospecting/queries";

// The session decides who may see the page.
export const dynamic = "force-dynamic";

/**
 * What the auto-prospecting consumer wrote on its own, and what it refused to write. READ-ONLY by construction: this file has no form,
 * no server action and no link to a send path, so there is nothing here that can send or schedule. A server component, so no dictionary
 * slice crosses a client boundary.
 */
export default async function AutoProspectingPage() {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const l = dict.autoProspecting;
  const reasons: Record<string, string> = l.reasons;
  const { rows, drafted, refused } = await listProspectDrafts();
  const drafts = rows.filter((r) => r.outcome === "drafted");
  const refusals = rows.filter((r) => r.outcome === "refused");

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>
            {l.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{l.subtitle}</p>
          <p className="meta">{l.readOnly}</p>
          <p className="meta">{l.inSequences}</p>
        </div>
      </div>

      <h2>{l.draftedTitle}</h2>
      <p className="meta mb-lg">{fillTemplate(l.draftedCount, { n: String(drafted) })}</p>
      {drafts.length === 0 ? (
        <div className="empty mb-lg">
          <p>{l.emptyDrafted}</p>
        </div>
      ) : (
        <div className="stack-sm mb-lg">
          {drafts.map((r) => (
            <article key={r.id} className="card">
              <div className="card-header">
                <h3>
                  {r.personName}
                  {r.jobTitle ? ` · ${r.jobTitle}` : ""}
                </h3>
                <span className="meta">{r.companyName ?? ""}</span>
                <div className="actions meta">{formatDateTime(r.createdAt, locale)}</div>
              </div>
              <div className="card-body stack-sm">
                <div className="meta">
                  <span className="strong">{l.signal}: </span>
                  {r.signalTitle ? fillTemplate(l.signalLine, { title: r.signalTitle, location: r.signalLocation ?? "—" }) : l.signalNone}
                </div>
                <div>
                  <span className="strong">{l.subject}: </span>
                  {r.subject}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{r.body}</div>
                <div className="meta">
                  {l.bd}: {r.bdName ?? "—"}
                </div>
                {r.sequenceId ? (
                  <div className="meta">
                    {l.sequence}: <Link href={`/sequences/${r.sequenceId}`}>{r.sequenceName}</Link>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <h2>{l.refusedTitle}</h2>
      <p className="meta mb-lg">{fillTemplate(l.refusedCount, { n: String(refused) })}</p>
      {refusals.length === 0 ? (
        <div className="empty">
          <p>{l.emptyRefused}</p>
        </div>
      ) : (
        <div className="table-wrap mb-lg">
          <table className="data">
            <thead>
              <tr>
                <th>{l.contact}</th>
                <th>{l.company}</th>
                <th>{l.signal}</th>
                <th>{l.refusedTitle}</th>
              </tr>
            </thead>
            <tbody>
              {refusals.map((r) => (
                <tr key={r.id}>
                  <td>{r.personName}</td>
                  <td>{r.companyName ?? "—"}</td>
                  <td>{r.signalTitle ? fillTemplate(l.signalLine, { title: r.signalTitle, location: r.signalLocation ?? "—" }) : l.signalNone}</td>
                  <td>
                    <span className="badge badge-warn no-dot">{reasons[r.reason ?? ""] ?? r.reason}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
