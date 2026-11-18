import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import { getLocale } from "@/lib/i18n/server";
import { listTenders } from "@/lib/tenders/queries";
import { isTenderTriage, type TenderTriage } from "@/lib/tenders/triage";
import { formatArgentinaDayMonthTime } from "@/lib/i18n/format";
import { TenderImportForm } from "./TenderImportForm";
import { setTenderTriageAction } from "./actions";
import { TenderTriageSelect } from "./TenderTriageSelect";

// The session decides who may see the page, and the day count depends on "now": neither can be cached.
export const dynamic = "force-dynamic";

/** Open tenders inside this many days get the warning colour. */
const SOON_DAYS = 3;

export default async function TendersPage() {
  // Anyone signed in sees every tender; getCurrentBd is the session gate, not an owner filter.
  await getCurrentBd();
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const l = dict.tendersPage;
  // One round trip: the rows and the total ride on the same statement.
  const { rows, total } = await listTenders();
  const open = rows.filter((r) => !r.closed).length;

  const triageLabels: Record<TenderTriage, string> = l.triage;
  const daysText = (daysLeft: number, closed: boolean) =>
    closed
      ? l.closedAgo(Math.max(1, -daysLeft))
      : daysLeft === 0
        ? l.daysToday
        : daysLeft === 1
          ? l.daysTomorrow
          : l.daysIn(daysLeft);

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
        </div>
      </div>

      <TenderImportForm locale={locale} />

      {rows.length === 0 ? (
        <div className="empty">
          <p>{l.empty}</p>
        </div>
      ) : (
        <div className="table-wrap mb-lg">
          <table className="data">
            <thead>
              <tr>
                <th className="sorted">{l.colDays}</th>
                <th>{l.colProcess}</th>
                <th>{l.colTitle}</th>
                <th>{l.colAgency}</th>
                <th>{l.colPortalState}</th>
                <th>{l.colTriage}</th>
                <th>
                  <span className="sr-only">{l.colActions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">
                    <span className="strong">{formatArgentinaDayMonthTime(r.openingAt)}</span>
                    <div>
                      <span
                        className={`badge no-dot ${r.closed ? "badge-discarded" : r.daysLeft <= SOON_DAYS ? "badge-warn" : "badge-neutral"}`}
                      >
                        {r.closed ? `${l.closedLabel}, ` : ""}
                        {daysText(r.daysLeft, r.closed)}
                      </span>
                    </div>
                  </td>
                  <td className="nowrap">
                    <span className="mono">{r.processNumber}</span>
                  </td>
                  <td>
                    <div className="stack-sm">
                      <Link className="strong" href={`/licitaciones/${r.id}`}>
                        {r.name}
                      </Link>
                      {r.processType && <div className="meta">{r.processType}</div>}
                    </div>
                  </td>
                  <td>
                    {r.executingUnit}
                    {r.financialAdminService && <div className="meta">{r.financialAdminService}</div>}
                  </td>
                  <td>
                    <span className="badge badge-neutral no-dot">{r.portalStatus || "—"}</span>
                  </td>
                  <td>
                    <TenderTriageSelect
                      id={r.id}
                      value={isTenderTriage(r.triageStatus) ? r.triageStatus : "a_revisar"}
                      labels={triageLabels}
                      ariaLabel={l.triageAria(r.processNumber)}
                      errorLabel={l.triageError}
                      setTriage={setTenderTriageAction}
                    />
                  </td>
                  <td className="right">
                    <Link className="btn btn-secondary btn-sm" href={`/licitaciones/${r.id}`}>
                      {l.open}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-footer">
            <span>{l.footer(rows.length, total, open)}</span>
          </div>
        </div>
      )}
    </main>
  );
}
