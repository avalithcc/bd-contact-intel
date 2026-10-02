import { notFound } from "next/navigation";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import {
  ADMIN_BACKFILL_DEFAULT_LIMIT,
  ADMIN_BACKFILL_MAX_LIMIT,
  BD_SKIP_REASONS,
  parseRfcBackfillResultParams,
} from "@/lib/gmail/rfcBackfill";
import { countPendingRfcBackfill } from "@/lib/gmail/rfcBackfillRun";
import { es } from "@/lib/i18n/dictionaries/es";
import { runRfcBackfillAction } from "./actions";

export const dynamic = "force-dynamic";
// One batch is ~100 sequential Gmail reads; the explicit ceiling keeps it
// independent of the plan's default function timeout.
export const maxDuration = 300;

// Spanish-only regardless of `locale`, same as the other admin screens.
const dict = es.rfcBackfill;

export default async function RfcBackfillAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    await requireAdmin();
  } catch (err) {
    // Admin screens 404 for non-admins rather than 403.
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }

  const [params, pending] = await Promise.all([searchParams, countPendingRfcBackfill()]);
  const result = parseRfcBackfillResultParams(params);

  return (
    <main>
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{dict.eyebrow}</div>
          <h1 className="m-0">
            {dict.title}
            <span className="dot">.</span>
          </h1>
          <p className="soft">{dict.subtitle}</p>
        </div>
      </div>

      {result && (
        <section className="panel">
          <div className="eyebrow">{dict.resultTitle}</div>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <td>{dict.resultCandidates}</td>
                  <td>{result.candidates}</td>
                </tr>
                <tr>
                  <td>{dict.resultUpdated}</td>
                  <td>{result.updated}</td>
                </tr>
                <tr>
                  <td>{dict.resultNotFound}</td>
                  <td>{result.notFoundInGmail}</td>
                </tr>
                <tr>
                  <td>{dict.resultNoHeader}</td>
                  <td>{result.noMessageIdHeader}</td>
                </tr>
                <tr>
                  <td>{dict.resultSkippedRows}</td>
                  <td>{result.skippedBdRows}</td>
                </tr>
                <tr>
                  <td>{dict.resultSkippedBds}</td>
                  <td>{result.skippedBds}</td>
                </tr>
                {BD_SKIP_REASONS.filter((reason) => result.skipReasons[reason] > 0).map((reason) => (
                  <tr key={reason}>
                    <td>{dict.skipReasons[reason]}</td>
                    <td>{result.skipReasons[reason]}</td>
                  </tr>
                ))}
                <tr>
                  <td>{dict.resultRemaining}</td>
                  <td>{pending.total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="eyebrow">{dict.pendingTitle}</div>
        {pending.total === 0 ? (
          <p className="muted">{dict.nonePending}</p>
        ) : (
          <>
            <p className="soft">{dict.pendingTotal(pending.total)}</p>
            <p className="muted">{dict.permanentNote}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{dict.colBd}</th>
                    <th>{dict.colPending}</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.perBd.map((row) => (
                    <tr key={row.bdId}>
                      <td>
                        {row.name} · {row.email}
                      </td>
                      <td>{row.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {pending.total > 0 && (
        <section className="panel">
          <div className="eyebrow">{dict.runTitle}</div>
          <p className="soft">{dict.runNote(ADMIN_BACKFILL_MAX_LIMIT)}</p>
          <form action={runRfcBackfillAction} className="filter-toolbar">
            <div className="filter-field">
              <label htmlFor="limit">{dict.limitLabel}</label>
              <input
                id="limit"
                name="limit"
                type="number"
                min={1}
                max={ADMIN_BACKFILL_MAX_LIMIT}
                step={1}
                defaultValue={ADMIN_BACKFILL_DEFAULT_LIMIT}
              />
            </div>
            <button type="submit" className="filter-submit">
              {dict.runButton}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
