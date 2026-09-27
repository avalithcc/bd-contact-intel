import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { relativeTime } from "@/lib/i18n/format";
import { getHiringMatchIndex } from "@/lib/hiring/queries";
import {
  getCompanyFilterOptions,
  getCompanyListPage,
  getCompanyViewCounts,
  type CompanyListView,
} from "@/lib/companies/listQueries";
import { listOwnerOptions } from "@/lib/contacts/bulkOwnerDb";
import { companyLogoInitials } from "@/lib/contacts/companyLogo";
import { industryLabel, ownerLabel, stageBadgeClass, vacantesLabel } from "@/lib/companies/listMappers";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STAGES = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];

function isStage(value: string | undefined): value is Stage {
  return !!value && (STAGES as readonly string[]).includes(value);
}

function isView(value: string | undefined): value is CompanyListView {
  return value === "all" || value === "mine" || value === "hiring";
}

interface CompaniesPageProps {
  searchParams: Promise<{ view?: string; stage?: string; page?: string; industry?: string; owner?: string }>;
}

/**
 * `/companies` list (mockup-port c02; mockups/companies.html). The mockup's
 * own note: same index pattern as `/contacts` — header, view tabs, filter
 * chips, table — companies-checklist.md has the full element-by-element
 * mapping. Board/pipeline redesign stays out of scope (later change).
 */
export default async function CompaniesPage({ searchParams }: CompaniesPageProps) {
  const sp = await searchParams;
  const me = await getCurrentBd();
  const dict = await getDictionary();
  const l = dict.companyList;
  const locale = await getLocale();
  const relTime = (d: Date) => relativeTime(d, locale);

  const view: CompanyListView = isView(sp.view) ? sp.view : "all";
  const stage = isStage(sp.stage) ? sp.stage : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const industry = sp.industry || undefined;
  const owner = sp.owner || undefined;

  // Fetched once per request (React `cache()`, see getHiringMatchIndex's
  // doc comment) and threaded through both the view-tab count and the list
  // query below — never computed twice.
  const hiringIndex = await getHiringMatchIndex();

  const [{ rows, total, totalPages }, viewCounts, filterOptions, ownerOptions] = await Promise.all([
    getCompanyListPage(view, stage, me.id, hiringIndex, page, PAGE_SIZE, industry, owner),
    getCompanyViewCounts(me.id, hiringIndex),
    getCompanyFilterOptions(),
    listOwnerOptions(),
  ]);

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  function baseParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (stage) params.set("stage", stage);
    if (industry) params.set("industry", industry);
    if (owner) params.set("owner", owner);
    return params;
  }

  function viewHref(target: CompanyListView): string {
    const params = baseParams();
    params.set("view", target);
    return `/companies?${params.toString()}`;
  }

  function pageHref(target: number): string {
    const params = baseParams();
    params.set("view", view);
    params.set("page", String(target));
    return `/companies?${params.toString()}`;
  }

  function stageLabel(s: Stage): string {
    switch (s) {
      case "prospect":
        return l.stageProspect;
      case "qualified":
        return l.stageQualified;
      case "proposal_sent":
        return l.stageProposalSent;
      case "won":
        return l.stageWon;
      case "lost":
        return l.stageLost;
    }
  }

  function clearFilterHref(key: "stage" | "industry" | "owner"): string {
    const params = baseParams();
    params.delete(key);
    params.set("view", view);
    return `/companies?${params.toString()}`;
  }

  function ownerNameFor(id: string): string {
    return ownerOptions.find((o) => o.id === id)?.name ?? l.emptyValue;
  }

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>
            {l.pageTitle.replace(/\.$/, "")}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{l.subtitle}</p>
        </div>
        <div className="actions">
          <Link className="btn btn-primary" href="/companies/new">
            {l.newCompany}
          </Link>
        </div>
      </div>

      <nav className="view-tabs">
        <Link href={viewHref("all")} className={view === "all" ? "view-tab active" : "view-tab"} aria-current={view === "all" ? "page" : undefined}>
          {l.viewAll}
          <span className="count">{viewCounts.all}</span>
        </Link>
        <Link href={viewHref("mine")} className={view === "mine" ? "view-tab active" : "view-tab"} aria-current={view === "mine" ? "page" : undefined}>
          {l.viewMine}
          <span className="count">{viewCounts.mine}</span>
        </Link>
        <Link href={viewHref("hiring")} className={view === "hiring" ? "view-tab active" : "view-tab"} aria-current={view === "hiring" ? "page" : undefined}>
          {l.viewHiring}
          <span className="count">{viewCounts.hiring}</span>
        </Link>
      </nav>

      <div className="toolbar">
        <span className="chip">
          <span className="k">{l.stageFilterLabel}</span> {stage ? stageLabel(stage) : l.stageAny}
          {stage && (
            <Link href={clearFilterHref("stage")} aria-label={l.removeFilter}>
              ×
            </Link>
          )}
        </span>
        {/* Industria/Responsable chips (mockup-port c05, owner-directed
            addition — companies.html itself shows only the Etapa chip, but
            the mockup's "Agregar filtro" affordance exists precisely for
            adding more, same as /contacts' own beyond-mockup filters). Both
            are index-backed (company_industry_idx/company_owner_idx,
            migration 0017). */}
        {industry && (
          <span className="chip">
            <span className="k">{l.filterIndustryLabel}</span> {industry}
            <Link href={clearFilterHref("industry")} aria-label={l.removeFilter}>
              ×
            </Link>
          </span>
        )}
        {owner && (
          <span className="chip">
            <span className="k">{l.filterOwnerLabel}</span> {ownerNameFor(owner)}
            <Link href={clearFilterHref("owner")} aria-label={l.removeFilter}>
              ×
            </Link>
          </span>
        )}
        <details className="dropdown">
          <summary className="chip chip-add">{l.addFilter}</summary>
          <form method="get" action="/companies" className="menu">
            <input type="hidden" name="view" value={view} />
            <label className="menu-item">
              {l.stageFilterLabel}
              <select name="stage" defaultValue={stage ?? ""}>
                <option value="">{l.stageAny}</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="menu-item">
              {l.filterIndustryLabel}
              <select name="industry" defaultValue={industry ?? ""}>
                <option value="">{l.filterIndustryAny}</option>
                {filterOptions.industries.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="menu-item">
              {l.filterOwnerLabel}
              <select name="owner" defaultValue={owner ?? ""}>
                <option value="">{l.filterOwnerAny}</option>
                {ownerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-primary btn-sm">
              {l.applyFilter}
            </button>
          </form>
        </details>
        <span className="spacer" />
        {/* Mockup's own "Columnas" button (companies.html:66) is static
            chrome with no menu behind it — matches the approved mockup
            exactly, kept disabled here rather than inventing a column
            picker the mockup itself doesn't show. See companies-checklist.md D2. */}
        <button type="button" className="btn btn-secondary btn-sm" disabled title={l.columnsComingSoon}>
          {l.columnsButton}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="muted">{l.noResults}</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{l.colCompany}</th>
                <th>{l.colIndustry}</th>
                <th>{l.colStage}</th>
                <th>{l.colOwner}</th>
                <th>{l.colContacts}</th>
                <th>{l.colOpenings}</th>
                <th>{l.colLastActivity}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const vacantes = vacantesLabel(row.hiring?.openItCount);
                return (
                  <tr key={row.companyKey}>
                    <td>
                      <Link className="row" href={`/companies/${encodeURIComponent(row.companyKey)}`}>
                        <span className="company-logo" aria-hidden="true">
                          {companyLogoInitials(row.displayName)}
                        </span>
                        <span className="strong">{row.displayName}</span>
                      </Link>
                    </td>
                    <td className="soft">{industryLabel(row)}</td>
                    <td>
                      <span className={stageBadgeClass(row.relationshipStage)}>
                        {row.relationshipStage ? stageLabel(row.relationshipStage as Stage) : l.emptyValue}
                      </span>
                    </td>
                    <td>{ownerLabel(row)}</td>
                    <td className="num">{row.contactCount}</td>
                    <td>
                      {vacantes ? (
                        <span className="badge badge-success no-dot">{vacantes}</span>
                      ) : (
                        <span className="meta">{l.emptyValue}</span>
                      )}
                    </td>
                    <td className="meta">{row.lastActivityAt ? relTime(row.lastActivityAt) : l.emptyValue}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="table-footer">
            <span>{l.showingRange(from, to, total)}</span>
            <div className="row">
              {page > 1 && (
                <Link href={pageHref(page - 1)} className="btn btn-secondary btn-sm">
                  {l.prevPage}
                </Link>
              )}
              <span>{l.pageOf(page, totalPages)}</span>
              {page < totalPages && (
                <Link href={pageHref(page + 1)} className="btn btn-secondary btn-sm">
                  {l.nextPage}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
