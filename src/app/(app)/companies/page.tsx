import Link from "next/link";
import { LinkedInIcon } from "@/components/icons";
import { companyLinkedinUrlHref } from "@/lib/companies/linkedinUrl";
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
import { accountTypeLabel, industryLabel, ownerLabel, stageBadgeClass, vacantesLabel } from "@/lib/companies/listMappers";
import { ACCOUNT_TYPES, isAccountType, type AccountType } from "@/lib/companies/accountTypeFilter";
import { LINKEDIN_PRESENCES, isLinkedinPresence, linkedinPresenceLabel, type LinkedinPresence } from "@/lib/companies/linkedinPresence";
import { CLIENT_STATUSES, clientStatusLabel } from "@/lib/companies/clientStatus";
import { CLIENT_STATUS_FILTER_NONE, isClientStatusFilter, type ClientStatusFilter } from "@/lib/companies/clientStatusFilter";
import { BULK_COMPANY_TARGET_CAP } from "@/lib/companies/bulkClientStatus";
import { SELECT_ALL_COMPANIES_CHECKBOX_ID } from "@/lib/contacts/bulkSelection";
import { BulkResultToast } from "../contacts/BulkResultToast";
import { CompanyBulkBar } from "./CompanyBulkBar";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STAGES = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];

function isStage(value: string | undefined): value is Stage {
  return !!value && (STAGES as readonly string[]).includes(value);
}

const CLIENT_STATUS_OPTIONS: ClientStatusFilter[] = [...CLIENT_STATUSES, CLIENT_STATUS_FILTER_NONE];

/** Parses the `?bulkResult=` redirect param (bulkActions.ts) into the toast text. */
function bulkResultMessage(raw: string | undefined, l: Awaited<ReturnType<typeof getDictionary>>["companyList"]): string | null {
  if (!raw) return null;
  const [kind, a, b] = raw.split(":");
  if (kind !== "clientStatus") return null;
  if (a === "confirm") return l.bulkResultClientStatusConfirm;
  if (a === "invalid") return l.bulkResultClientStatusInvalid;
  return l.bulkResultClientStatus(Number(a) || 0, Number(b) || 0);
}

function isView(value: string | undefined): value is CompanyListView {
  return value === "all" || value === "mine" || value === "hiring";
}

interface CompaniesPageProps {
  searchParams: Promise<{
    view?: string;
    stage?: string;
    page?: string;
    industry?: string;
    owner?: string;
    accountType?: string;
    clientStatus?: string;
    linkedin?: string;
    q?: string;
    bulkResult?: string;
    bulkLimited?: string;
  }>;
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
  const accountType: AccountType | undefined = isAccountType(sp.accountType) ? sp.accountType : undefined;
  const clientStatus: ClientStatusFilter | undefined = isClientStatusFilter(sp.clientStatus) ? sp.clientStatus : undefined;
  const linkedin: LinkedinPresence | undefined = isLinkedinPresence(sp.linkedin) ? sp.linkedin : undefined;
  // Text search (owner report 2026-09-30: "no tengo buscador de empresas") —
  // trimmed here once so every consumer below (the two list reads, every
  // href builder) agrees on what counts as "no search term".
  const q = sp.q?.trim() || undefined;

  // Fetched once per request (React `cache()`, see getHiringMatchIndex's
  // doc comment) and threaded through both the view-tab count and the list
  // query below — never computed twice.
  const hiringIndex = await getHiringMatchIndex();

  const [{ rows, total, totalPages }, viewCounts, filterOptions, ownerOptions] = await Promise.all([
    getCompanyListPage(view, stage, me.id, hiringIndex, page, PAGE_SIZE, industry, owner, accountType, q, clientStatus, linkedin),
    getCompanyViewCounts(me.id, hiringIndex, q),
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
    if (accountType) params.set("accountType", accountType);
    if (clientStatus) params.set("clientStatus", clientStatus);
    if (linkedin) params.set("linkedin", linkedin);
    if (q) params.set("q", q);
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

  function clearFilterHref(key: "stage" | "industry" | "owner" | "accountType" | "clientStatus" | "linkedin" | "q"): string {
    const params = baseParams();
    params.delete(key);
    params.set("view", view);
    return `/companies?${params.toString()}`;
  }

  // Current list query (filters + view + page): the bulk action re-derives
  // "select all matching" from it and redirects back to the same view.
  const returnQuery = (() => {
    const params = baseParams();
    params.set("view", view);
    if (page > 1) params.set("page", String(page));
    return params.toString();
  })();

  const bulkMessage = bulkResultMessage(sp.bulkResult, l);

  function ownerNameFor(id: string): string {
    return ownerOptions.find((o) => o.id === id)?.name ?? l.emptyValue;
  }

  function accountTypeLabelFor(value: AccountType): string {
    return accountTypeLabel(value, dict.companyRecord);
  }

  function clientStatusLabelFor(value: ClientStatusFilter): string {
    return value === CLIENT_STATUS_FILTER_NONE ? l.filterClientStatusNone : clientStatusLabel(value, dict.companyRecord);
  }

  function linkedinLabelFor(value: LinkedinPresence): string {
    return linkedinPresenceLabel(value, l);
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
        {/* "Búsqueda" chip (owner report 2026-09-30: "no tengo buscador de
            empresas") — same conditional-chip + × pattern as Industria/
            Responsable/Tipo de cuenta below, so clearing the search reuses
            the exact same affordance a BD already knows from those chips. */}
        {q && (
          <span className="chip">
            <span className="k">{l.searchFilterLabel}</span> {q}
            <Link href={clearFilterHref("q")} aria-label={l.removeFilter}>
              ×
            </Link>
          </span>
        )}
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
        {/* Tipo de cuenta chip (BACKLOG.md Layer 3 "account-type-filter") —
            same conditional-chip pattern as Industria/Responsable above:
            only shown once a filter is applied, not always-on like Etapa's
            "Cualquiera" default (companies.html doesn't show this chip at
            all; it's a beyond-mockup addition, same precedent). Filter
            only — no way to edit/reclassify `account_type` here or on the
            record page (deliberately undecided). */}
        {accountType && (
          <span className="chip">
            <span className="k">{l.filterAccountTypeLabel}</span> {accountTypeLabelFor(accountType)}
            <Link href={clearFilterHref("accountType")} aria-label={l.removeFilter}>
              ×
            </Link>
          </span>
        )}
        {/* Estado de cliente chip — same conditional-chip pattern as Tipo de
            cuenta above. Independent of it: usable with or without an
            account-type or stage filter. */}
        {clientStatus && (
          <span className="chip">
            <span className="k">{l.filterClientStatusLabel}</span> {clientStatusLabelFor(clientStatus)}
            <Link href={clearFilterHref("clientStatus")} aria-label={l.removeFilter}>
              ×
            </Link>
          </span>
        )}
        {/* LinkedIn chip — same conditional-chip pattern as Estado de cliente. */}
        {linkedin && (
          <span className="chip">
            <span className="k">{l.filterLinkedinLabel}</span> {linkedinLabelFor(linkedin)}
            <Link href={clearFilterHref("linkedin")} aria-label={l.removeFilter}>
              ×
            </Link>
          </span>
        )}
        <details className="dropdown">
          <summary className="chip chip-add">{l.addFilter}</summary>
          <form method="get" action="/companies" className="menu">
            <input type="hidden" name="view" value={view} />
            {q && <input type="hidden" name="q" value={q} />}
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
            <label className="menu-item">
              {l.filterAccountTypeLabel}
              <select name="accountType" defaultValue={accountType ?? ""}>
                <option value="">{l.filterAccountTypeAny}</option>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {accountTypeLabelFor(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="menu-item">
              {l.filterClientStatusLabel}
              <select name="clientStatus" defaultValue={clientStatus ?? ""}>
                <option value="">{l.filterClientStatusAny}</option>
                {CLIENT_STATUS_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {clientStatusLabelFor(v)}
                  </option>
                ))}
              </select>
            </label>
            <label className="menu-item">
              {l.filterLinkedinLabel}
              <select name="linkedin" defaultValue={linkedin ?? ""}>
                <option value="">{l.filterLinkedinAny}</option>
                {LINKEDIN_PRESENCES.map((v) => (
                  <option key={v} value={v}>
                    {linkedinLabelFor(v)}
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

      <BulkResultToast message={bulkMessage} />
      {sp.bulkLimited === "1" && (
        <div className="alert alert-warn mb-lg">
          <p>{l.bulkLimitedNotice.replace("{n}", BULK_COMPANY_TARGET_CAP.toLocaleString(locale))}</p>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="muted">
          {linkedin === "with" && !q && !stage && !industry && !owner && !accountType && !clientStatus && view === "all"
            ? l.noLinkedinYet
            : l.noResults}
        </p>
      ) : (
        <CompanyBulkBar
          labels={dict.companyBulk}
          statusLabels={{
            active: dict.companyRecord.clientStatusActive,
            inactive: dict.companyRecord.clientStatusInactive,
            none: dict.companyRecord.clientStatusNone,
          }}
          locale={locale}
          total={total}
          returnQuery={returnQuery}
        >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="col-check">
                  <input type="checkbox" id={SELECT_ALL_COMPANIES_CHECKBOX_ID} aria-label={dict.companyBulk.selectAllLabel} />
                </th>
                <th>{l.colCompany}</th>
                <th>{l.colIndustry}</th>
                <th>{l.colStage}</th>
                <th>{l.colClientStatus}</th>
                <th>{l.colOwner}</th>
                <th>{l.colContacts}</th>
                <th>{l.colOpenings}</th>
                <th>{l.colLastActivity}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const vacantes = vacantesLabel(row.hiring?.openItCount);
                const linkedinHref = companyLinkedinUrlHref(row.linkedinUrl);
                return (
                  <tr key={row.companyKey}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        name="companyKey"
                        value={row.companyKey}
                        aria-label={dict.companyBulk.selectRowLabel.replace("{name}", row.displayName)}
                      />
                    </td>
                    <td>
                      <div className="li-cell">
                        <Link className="row" href={`/companies/${encodeURIComponent(row.companyKey)}`}>
                          <span className="company-logo" aria-hidden="true">
                            {companyLogoInitials(row.displayName)}
                          </span>
                          <span className="strong">{row.displayName}</span>
                        </Link>
                        {linkedinHref && (
                          <a
                            className="li-link"
                            href={linkedinHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={l.linkedinLinkLabel(row.displayName)}
                          >
                            <LinkedInIcon className="icon" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="soft">{industryLabel(row)}</td>
                    <td>
                      <span className={stageBadgeClass(row.relationshipStage)}>
                        {row.relationshipStage ? stageLabel(row.relationshipStage as Stage) : l.emptyValue}
                      </span>
                    </td>
                    <td>
                      {row.clientStatus === "active" ? (
                        <span className="badge badge-info">{clientStatusLabelFor("active")}</span>
                      ) : row.clientStatus === "inactive" ? (
                        <span className="badge badge-outline">{clientStatusLabelFor("inactive")}</span>
                      ) : (
                        <span className="meta">{l.emptyValue}</span>
                      )}
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
        </CompanyBulkBar>
      )}
    </main>
  );
}
