import Link from "next/link";
import {
  getCompanyCategorySummaries,
  getCurrentBd,
  getRoleGroupSummaries,
  listContacts,
} from "@/lib/queries";
import { ROLE_GROUPS, type RoleGroupKey } from "@/lib/roleGroups";
import { COMPANY_CATEGORIES, type CompanyCategoryKey } from "@/lib/companyCategories";
import { UploadForm } from "./UploadForm";
import { SignOutButton } from "./SignOutButton";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const ROLE_GROUP_KEYS = new Set(ROLE_GROUPS.map((g) => g.key));
const COMPANY_CATEGORY_KEYS = new Set(COMPANY_CATEGORIES.map((c) => c.key));

function isRoleGroupKey(v: string | undefined): v is RoleGroupKey {
  return !!v && ROLE_GROUP_KEYS.has(v as RoleGroupKey);
}

function isCompanyCategoryKey(v: string | undefined): v is CompanyCategoryKey {
  return !!v && COMPANY_CATEGORY_KEYS.has(v as CompanyCategoryKey);
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string;
    position?: string;
    roleGroup?: string;
    companyCategory?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getCurrentBd();
  const page = Math.max(1, Number(sp.page) || 1);
  const roleGroup = isRoleGroupKey(sp.roleGroup) ? sp.roleGroup : undefined;
  const companyCategory = isCompanyCategoryKey(sp.companyCategory)
    ? sp.companyCategory
    : undefined;
  const filters = {
    company: sp.company,
    position: sp.position,
    roleGroup,
    companyCategory,
  };
  const [
    { rows, total, page: current, totalPages },
    roleGroupSummaries,
    companyCategorySummaries,
  ] = await Promise.all([
    listContacts(me.id, filters, page, PAGE_SIZE),
    getRoleGroupSummaries(me.id),
    getCompanyCategorySummaries(me.id),
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
    params.set("page", String(p));
    return `/?${params.toString()}`;
  };

  const qsWithout = (field: "company" | "position" | "roleGroup" | "companyCategory") => {
    const params = new URLSearchParams();
    if (sp.company && field !== "company") params.set("company", sp.company);
    if (sp.position && field !== "position") params.set("position", sp.position);
    if (roleGroup && field !== "roleGroup") params.set("roleGroup", roleGroup);
    if (companyCategory && field !== "companyCategory")
      params.set("companyCategory", companyCategory);
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
          <Link className="secondary-btn" href="/hiring">
            hiring signals →
          </Link>
          <SignOutButton />
        </div>
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
        <form method="get" className="filter-toolbar">
          <div className="filter-field">
            <label htmlFor="company">Company</label>
            <input
              id="company"
              name="company"
              type="text"
              defaultValue={sp.company ?? ""}
              placeholder="e.g. Acme"
            />
          </div>
          <div className="filter-field">
            <label htmlFor="roleGroup">Role group</label>
            <select id="roleGroup" name="roleGroup" defaultValue={roleGroup ?? ""}>
              <option value="">All groups</option>
              {ROLE_GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label} ({countByGroup.get(g.key) ?? 0})
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="companyCategory">Company category</label>
            <select
              id="companyCategory"
              name="companyCategory"
              defaultValue={companyCategory ?? ""}
            >
              <option value="">All categories</option>
              {COMPANY_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} ({countByCategory.get(c.key) ?? 0})
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="position">Position</label>
            <input
              id="position"
              name="position"
              type="text"
              defaultValue={sp.position ?? ""}
              placeholder="e.g. Engineering"
            />
          </div>
          <button type="submit" className="filter-submit">
            Filter
          </button>
        </form>

        {(sp.company || roleGroup || companyCategory || sp.position) && (
          <div className="active-filters">
            {sp.company && (
              <span className="chip">
                Company: {sp.company}
                <Link href={qsWithout("company")} aria-label="Remove company filter">
                  ×
                </Link>
              </span>
            )}
            {roleGroup && (
              <span className="chip">
                Role: {ROLE_GROUPS.find((g) => g.key === roleGroup)?.label ?? roleGroup}
                <Link href={qsWithout("roleGroup")} aria-label="Remove role group filter">
                  ×
                </Link>
              </span>
            )}
            {companyCategory && (
              <span className="chip">
                Category:{" "}
                {COMPANY_CATEGORIES.find((c) => c.key === companyCategory)?.label ??
                  companyCategory}
                <Link
                  href={qsWithout("companyCategory")}
                  aria-label="Remove company category filter"
                >
                  ×
                </Link>
              </span>
            )}
            {sp.position && (
              <span className="chip">
                Position: {sp.position}
                <Link href={qsWithout("position")} aria-label="Remove position filter">
                  ×
                </Link>
              </span>
            )}
            <Link href="/" className="clear-all">
              Clear all
            </Link>
          </div>
        )}

        {selectedRoleGroup && roleGroupExamples && roleGroupExamples.titles.length > 0 && (
          <details className="filter-helper">
            <summary>
              {selectedRoleGroup.label} — {countByGroup.get(selectedRoleGroup.key) ?? 0}{" "}
              contacts · {roleGroupExamples.totalDistinctTitles} distinct titles
              <span className="filter-helper-hint">show example titles</span>
            </summary>
            <div className="filter-helper-body">
              <ul className="example-list">
                {roleGroupExamples.titles.map((t) => (
                  <li key={t.position}>
                    {t.position} <span className="muted">({t.count})</span>
                  </li>
                ))}
              </ul>
              {roleGroupTitlesRemaining > 0 && (
                <p className="muted example-more">
                  +{roleGroupTitlesRemaining} more title
                  {roleGroupTitlesRemaining === 1 ? "" : "s"}
                </p>
              )}
            </div>
          </details>
        )}

        {selectedCompanyCategory &&
          companyCategoryExamples &&
          companyCategoryExamples.companies.length > 0 && (
            <details className="filter-helper">
              <summary>
                {selectedCompanyCategory.label} —{" "}
                {countByCategory.get(selectedCompanyCategory.key) ?? 0} contacts ·{" "}
                {companyCategoryExamples.totalDistinctCompanies} distinct companies
                <span className="filter-helper-hint">show example companies</span>
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
                    +{companyCategoryCompaniesRemaining} more compan
                    {companyCategoryCompaniesRemaining === 1 ? "y" : "ies"}
                  </p>
                )}
              </div>
            </details>
          )}
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
