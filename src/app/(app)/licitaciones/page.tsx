import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDictionary } from "@/lib/i18n/server";
import { getLocale } from "@/lib/i18n/server";
import { listTenders, type TenderListRow } from "@/lib/tenders/queries";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { isTenderTriage, type TenderTriage } from "@/lib/tenders/triage";
import { formatArgentinaDayMonthTime } from "@/lib/i18n/format";
import { TenderImportForm } from "./TenderImportForm";
import { setTenderRelevanceAction, setTenderTriageAction } from "./actions";
import { TenderRelevanceSelect } from "./TenderRelevanceSelect";
import { choiceFromOverride, tenderRelevance } from "@/lib/tenders/relevance";
import { TenderTriageSelect } from "./TenderTriageSelect";

// The session decides who may see the page, and the day count depends on "now": neither can be cached.
export const dynamic = "force-dynamic";

/** Open tenders inside this many days get the warning colour. */
const SOON_DAYS = 3;

/** `?ver=todas` is the one-click way to everything, discarded and closed included; anything else is the default view. */
export default async function TendersPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const view = (await searchParams).ver === "todas" ? "all" : "relevant";
  // Admin-only: a public tender is a business decision, not BD work. Admin screens 404 for everyone else.
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const l = dict.tendersPage;
  // One round trip: the rows and the total ride on the same statement.
  const { rows, total, all } = await listTenders(view);
  const open = rows.filter((r) => !r.closed).length;

  const triageLabels: Record<TenderTriage, string> = l.triage;
  const hidden = Math.max(0, all - total);
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

      <div className="legacy-row mb-lg">
        <Link className={`btn btn-sm ${view === "relevant" ? "btn-primary" : "btn-secondary"}`} href="/licitaciones" aria-current={view === "relevant" ? "page" : undefined}>
          {l.viewRelevant}
        </Link>
        <Link className={`btn btn-sm ${view === "all" ? "btn-primary" : "btn-secondary"}`} href="/licitaciones?ver=todas" aria-current={view === "all" ? "page" : undefined}>
          {l.viewAll(all)}
        </Link>
        {view === "relevant" && hidden > 0 && <span className="meta">{l.hiddenNote(hidden)}</span>}
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <p>{all > 0 && view === "relevant" ? l.emptyRelevant(all) : l.empty}</p>
        </div>
      ) : (
        <div className="table-wrap mb-lg">
          <table className="data">
            <thead>
              <tr>
                <th className="sorted">{l.colDays}</th>
                <th>{l.colTitle}</th>
                <th>{l.colBudget}</th>
                <th>{l.colAgency}</th>
                <th>{l.colRelevance}</th>
                <th>{l.colPortalState}</th>
                <th>{l.colOwner}</th>
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
                  <td>
                    <div className="stack-sm">
                      <Link className="strong" href={`/licitaciones/${r.id}`}>
                        {r.name}
                      </Link>
                      {r.processType && <div className="meta">{r.processType}</div>}
                    </div>
                  </td>
                  <td className="nowrap">
                    <BudgetCellView cell={r.budgetCell} labels={l} />
                  </td>
                  <td>
                    {r.executingUnit}
                    {r.financialAdminService && <div className="meta">{r.financialAdminService}</div>}
                  </td>
                  <td>
                    <RelevanceCell row={r} labels={l} />
                  </td>
                  <td>
                    <span className="badge badge-neutral no-dot">{r.portalStatus || "—"}</span>
                  </td>
                  <td className="nowrap">{r.ownerName ?? <span className="meta">{l.ownerNone}</span>}</td>
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

function RelevanceCell({ row, labels: l }: { row: TenderListRow; labels: Dictionary["tendersPage"] }) {
  const rel = tenderRelevance(row);
  const badge = rel.state === "relevant" ? "badge-success" : rel.state === "irrelevant" ? "badge-discarded" : "badge-warn";
  const text = rel.state === "relevant" ? l.relevanceRelevant : rel.state === "irrelevant" ? l.relevanceIrrelevant : l.relevanceUnclassified;
  return (
    <div className="stack-sm">
      <div>
        <span className={`badge no-dot ${badge}`}>{text}</span>
        {rel.source === "human" && <span className="meta"> {l.relevanceByHuman}</span>}
      </div>
      {rel.state === "unclassified" ? <div className="meta">{l.relevanceUnclassifiedHint}</div> : rel.reason && <div className="meta">{rel.reason}</div>}
      <TenderRelevanceSelect
        id={row.id}
        value={choiceFromOverride(row.relevanceOverride)}
        labels={l.relevanceChoices}
        ariaLabel={l.relevanceAria(row.processNumber)}
        errorLabel={l.relevanceError}
        setRelevance={setTenderRelevanceAction}
      />
    </div>
  );
}

function BudgetCellView({ cell, labels: l }: { cell: TenderListRow["budgetCell"]; labels: Dictionary["tendersPage"] }) {
  if (cell.state === "amount") return <span className="mono">{cell.amount}</span>;
  const text = cell.state === "bidder_sets" ? l.budgetBidderSets : cell.state === "reanalyse" ? l.budgetReanalyse : l.budgetNoPliego;
  return <span className="meta">{text}</span>;
}
