import Link from "next/link";
import {
  getCompanyCategorySummaries,
  getCurrentBd,
  getRoleGroupSummaries,
  listContacts,
  RELATIONSHIP_FILTERS,
  type RelationshipFilterKey,
} from "@/lib/queries";
import { getHiringCompanyKeys } from "@/lib/hiring/queries";
import { ROLE_GROUPS, type RoleGroupKey } from "@/lib/roleGroups";
import { COMPANY_CATEGORIES, type CompanyCategoryKey } from "@/lib/companyCategories";
import { UploadForm, UploadMessagesForm } from "./UploadForm";
import { SignOutButton } from "./SignOutButton";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { relativeTime } from "@/lib/i18n/format";
import { LocaleSwitcher } from "@/lib/i18n/LocaleSwitcher";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const ROLE_GROUP_KEYS = new Set(ROLE_GROUPS.map((g) => g.key));
const COMPANY_CATEGORY_KEYS = new Set(COMPANY_CATEGORIES.map((c) => c.key));
const RELATIONSHIP_KEYS = new Set(RELATIONSHIP_FILTERS.map((r) => r.key));

function isRoleGroupKey(v: string | undefined): v is RoleGroupKey {
  return !!v && ROLE_GROUP_KEYS.has(v as RoleGroupKey);
}

function isCompanyCategoryKey(v: string | undefined): v is CompanyCategoryKey {
  return !!v && COMPANY_CATEGORY_KEYS.has(v as CompanyCategoryKey);
}

function isRelationshipKey(v: string | undefined): v is RelationshipFilterKey {
  return !!v && RELATIONSHIP_KEYS.has(v as RelationshipFilterKey);
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string;
    position?: string;
    roleGroup?: string;
    companyCategory?: string;
    companyKey?: string;
    relationship?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const dict = t(locale);
  const me = await getCurrentBd();
  const page = Math.max(1, Number(sp.page) || 1);
  const roleGroup = isRoleGroupKey(sp.roleGroup) ? sp.roleGroup : undefined;
  const companyCategory = isCompanyCategoryKey(sp.companyCategory)
    ? sp.companyCategory
    : undefined;
  const relationship = isRelationshipKey(sp.relationship) ? sp.relationship : undefined;
  const filters = {
    company: sp.company,
    position: sp.position,
    roleGroup,
    companyCategory,
    companyKey: sp.companyKey,
    relationship,
  };
  const [
    { rows, total, page: current, totalPages },
    roleGroupSummaries,
    companyCategorySummaries,
    hiringCompanyKeys,
  ] = await Promise.all([
    listContacts(me.id, filters, page, PAGE_SIZE),
    getRoleGroupSummaries(me.id),
    getCompanyCategorySummaries(me.id),
    getHiringCompanyKeys(),
  ]);
  const countByGroup = new Map(
    [...roleGroupSummaries.entries()].map(([key, s]) => [key, s.count]),
  );
  const countByCategory = new Map(
    [...companyCategorySummaries.entries()].map(([key, s]) => [key, s.count]),
  );

  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (sp.company) params.set("company", sp.company);
    if (sp.position) params.set("position", sp.position);
    if (roleGroup) params.set("roleGroup", roleGroup);
    if (companyCategory) params.set("companyCategory", companyCategory);
    if (sp.companyKey) params.set("companyKey", sp.companyKey);
    if (relationship) params.set("relationship", relationship);
    params.set("page", String(p));
    return `/?${params.toString()}`;
  };

  const qsWithout = (
    field:
      | "company"
      | "position"
      | "roleGroup"
      | "companyCategory"
      | "companyKey"
      | "relationship",
  ) => {
    const params = new URLSearchParams();
    if (sp.company && field !== "company") params.set("company", sp.company);
    if (sp.position && field !== "position") params.set("position", sp.position);
    if (roleGroup && field !== "roleGroup") params.set("roleGroup", roleGroup);
    if (companyCategory && field !== "companyCategory")
      params.set("companyCategory", companyCategory);
    if (sp.companyKey && field !== "companyKey") params.set("companyKey", sp.companyKey);
    if (relationship && field !== "relationship") params.set("relationship", relationship);
    const qsStr = params.toString();
    return qsStr ? `/?${qsStr}` : "/";
  };

  const selectedRoleGroup = roleGroup ? ROLE_GROUPS.find((g) => g.key === roleGroup) : undefined;
  const roleGroupExamples = roleGroup ? roleGroupSummaries.get(roleGroup) : undefined;
  const roleGroupTitlesRemaining = roleGroupExamples
    ? roleGroupExamples.totalDistinctTitles - roleGroupExamples.titles.length
    : 0;

  const selectedCompanyCategory = companyCategory
    ? COMPANY_CATEGORIES.find((c) => c.key === companyCategory)
    : undefined;
  const companyCategoryExamples = companyCategory
    ? companyCategorySummaries.get(companyCategory)
    : undefined;
  const companyCategoryCompaniesRemaining = companyCategoryExamples
    ? companyCategoryExamples.totalDistinctCompanies - companyCategoryExamples.companies.length
    : 0;

  return (
    <main>
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        <div className="row" style={{ gap: "0.75rem" }}>
          <Link className="secondary-btn" href="/outreach">
            {dict.common.priorityOutreach}
          </Link>
          <Link className="secondary-btn" href="/hiring">
            {dict.common.hiringSignals}
          </Link>
          <SignOutButton locale={locale} />
          <LocaleSwitcher locale={locale} />
        </div>
      </div>

      <div style={{ marginBottom: "1.75rem" }}>
        <div className="eyebrow">{dict.common.brandEyebrow}</div>
        <h1>
          {dict.home.title}
          <span className="dot">.</span>
        </h1>
        <p className="soft" style={{ margin: 0 }}>
          {dict.home.signedInAs(me.name, me.email)}
        </p>
      </div>

      <details className="import-block">
        <summary>{dict.home.importConnectionsSummary}</summary>
        <div className="import-body">
          <UploadForm locale={locale} />
        </div>
      </details>

      <details className="import-block">
        <summary>{dict.home.importMessagesSummary}</summary>
        <div className="import-body">
          <UploadMessagesForm locale={locale} />
        </div>
      </details>

      <section className="panel">
        <div className="eyebrow">{dict.common.filterEyebrow}</div>
        <form method="get" className="filter-toolbar">
          <div className="filter-field">
            <label htmlFor="company">{dict.home.companyLabel}</label>
            <input
              id="company"
              name="company"
              type="text"
              defaultValue={sp.company ?? ""}
              placeholder={dict.home.companyPlaceholder}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="roleGroup">{dict.common.roleGroupLabel}</label>
            <select id="roleGroup" name="roleGroup" defaultValue={roleGroup ?? ""}>
              <option value="">{dict.common.allGroups}</option>
              {ROLE_GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {dict.roleGroups[g.key]} ({countByGroup.get(g.key) ?? 0})
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="companyCategory">{dict.home.companyCategoryLabel}</label>
            <select
              id="companyCategory"
              name="companyCategory"
              defaultValue={companyCategory ?? ""}
            >
              <option value="">{dict.home.allCategories}</option>
              {COMPANY_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {dict.companyCategories[c.key]} ({countByCategory.get(c.key) ?? 0})
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="position">{dict.home.positionLabel}</label>
            <input
              id="position"
              name="position"
              type="text"
              defaultValue={sp.position ?? ""}
              placeholder={dict.home.positionPlaceholder}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="relationship">{dict.home.relationshipLabel}</label>
            <select id="relationship" name="relationship" defaultValue={relationship ?? ""}>
              <option value="">{dict.home.anyRelationship}</option>
              {RELATIONSHIP_FILTERS.map((r) => (
                <option key={r.key} value={r.key}>
                  {dict.relationshipFilters[r.key]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="filter-submit">
            {dict.common.filter}
          </button>
        </form>

        {(sp.company ||
          roleGroup ||
          companyCategory ||
          sp.position ||
          sp.companyKey ||
          relationship) && (
          <div className="active-filters">
            {sp.companyKey && (
              <span className="chip">
                {dict.home.companyFromHiringChip(sp.companyKey)}
                <Link href={qsWithout("companyKey")} aria-label={dict.home.removeCompanyKeyFilter}>
                  ×
                </Link>
              </span>
            )}
            {sp.company && (
              <span className="chip">
                {dict.home.companyChip(sp.company)}
                <Link href={qsWithout("company")} aria-label={dict.home.removeCompanyFilter}>
                  ×
                </Link>
              </span>
            )}
            {roleGroup && (
              <span className="chip">
                {dict.home.roleChip(dict.roleGroups[roleGroup])}
                <Link href={qsWithout("roleGroup")} aria-label={dict.home.removeRoleGroupFilter}>
                  ×
                </Link>
              </span>
            )}
            {companyCategory && (
              <span className="chip">
                {dict.home.categoryChip(dict.companyCategories[companyCategory])}
                <Link
                  href={qsWithout("companyCategory")}
                  aria-label={dict.home.removeCompanyCategoryFilter}
                >
                  ×
                </Link>
              </span>
            )}
            {sp.position && (
              <span className="chip">
                {dict.home.positionChip(sp.position)}
                <Link href={qsWithout("position")} aria-label={dict.home.removePositionFilter}>
                  ×
                </Link>
              </span>
            )}
            {relationship && (
              <span className="chip">
                {dict.home.relationshipChip(dict.relationshipFilters[relationship])}
                <Link
                  href={qsWithout("relationship")}
                  aria-label={dict.home.removeRelationshipFilter}
                >
                  ×
                </Link>
              </span>
            )}
            <Link href="/" className="clear-all">
              {dict.common.clearAll}
            </Link>
          </div>
        )}

        {selectedRoleGroup && roleGroupExamples && roleGroupExamples.titles.length > 0 && (
          <details className="filter-helper">
            <summary>
              {dict.home.roleGroupSummary(
                dict.roleGroups[selectedRoleGroup.key],
                countByGroup.get(selectedRoleGroup.key) ?? 0,
                roleGroupExamples.totalDistinctTitles,
              )}
              <span className="filter-helper-hint">{dict.home.showExampleTitles}</span>
            </summary>
            <div className="filter-helper-body">
              <ul className="example-list">
                {roleGroupExamples.titles.map((title) => (
                  <li key={title.position}>
                    {title.position} <span className="muted">({title.count})</span>
                  </li>
                ))}
              </ul>
              {roleGroupTitlesRemaining > 0 && (
                <p className="muted example-more">{dict.home.moreTitles(roleGroupTitlesRemaining)}</p>
              )}
            </div>
          </details>
        )}

        {selectedCompanyCategory &&
          companyCategoryExamples &&
          companyCategoryExamples.companies.length > 0 && (
            <details className="filter-helper">
              <summary>
                {dict.home.companyCategorySummary(
                  dict.companyCategories[selectedCompanyCategory.key],
                  countByCategory.get(selectedCompanyCategory.key) ?? 0,
                  companyCategoryExamples.totalDistinctCompanies,
                )}
                <span className="filter-helper-hint">{dict.home.showExampleCompanies}</span>
              </summary>
              <div className="filter-helper-body">
                <ul className="example-list">
                  {companyCategoryExamples.companies.map((co) => (
                    <li key={co.company}>
                      {co.company} <span className="muted">({co.count})</span>
                    </li>
                  ))}
                </ul>
                {companyCategoryCompaniesRemaining > 0 && (
                  <p className="muted example-more">
                    {dict.home.moreCompanies(companyCategoryCompaniesRemaining)}
                  </p>
                )}
              </div>
            </details>
          )}
      </section>

      <section className="panel">
        <div className="eyebrow">{dict.home.contactsEyebrow}</div>
        <p className="soft" style={{ marginTop: 0 }}>
          {dict.common.totalPage(total, current, totalPages)}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{dict.home.tableName}</th>
                <th>{dict.home.tableCompany}</th>
                <th>{dict.home.tablePosition}</th>
                <th>{dict.home.tableRelationship}</th>
                <th>{dict.home.tableTeamOverlap}</th>
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
                  <td>
                    {c.company ?? "—"}
                    {c.companyKey && hiringCompanyKeys.has(c.companyKey) && (
                      <span className="badge hiring">{dict.common.hiringBadge}</span>
                    )}
                  </td>
                  <td>{c.position ?? "—"}</td>
                  <td>
                    {c.messageCount > 0 ? (
                      <span className="relationship">
                        {dict.home.msgsCount(c.messageCount)}
                        {c.lastMessageAt && (
                          <> · {relativeTime(new Date(c.lastMessageAt), locale)}</>
                        )}
                        {c.dormant && <span className="badge dormant">{dict.common.dormantBadge}</span>}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {c.overlapWith.length ? (
                      <span className="badge">{dict.common.alsoIn(c.overlapWith.join(", "))}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    {dict.home.noContacts}
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
                {dict.common.prev}
              </Link>
            ) : (
              <span className="secondary-btn disabled">{dict.common.prev}</span>
            )}
            <span className="soft">{dict.common.pageOf(current, totalPages)}</span>
            {current < totalPages ? (
              <Link className="secondary-btn" href={qs(current + 1)}>
                {dict.common.next}
              </Link>
            ) : (
              <span className="secondary-btn disabled">{dict.common.next}</span>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
