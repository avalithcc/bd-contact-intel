import Link from "next/link";
import { getCompanies } from "@/lib/companies/queries";
import { getDictionary } from "@/lib/i18n/server";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { PlusIcon } from "@/components/icons";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
  stage?: string;
  page?: string;
}

// Presentation-only restyle (mockup-parity 6.2, mockups/companies.html) —
// `getCompanies` and its `search`/`relationshipStage` filters are unchanged.
// The mockup's stage badges are keyed by the exact `relationshipStage`
// column values (see db/schema.ts's company table).
const STAGES = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const dict = await getDictionary();
  const l = dict.companiesPage;

  const { rows, totalPages } = await getCompanies(
    {
      search: params.search,
      relationshipStage: params.stage,
    },
    page,
    20,
  );

  const stageLabel = (stage: string) =>
    ({
      prospect: l.stageProspect,
      qualified: l.stageQualified,
      proposal_sent: l.stageProposalSent,
      won: l.stageWon,
      lost: l.stageLost,
    })[stage] ?? stage;

  return (
    <main className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>{l.eyebrow}</div>
          <h1 className={styles.title}>{l.title}</h1>
          <p className={styles.subtitle}>{l.subtitle}</p>
        </div>
        <Link href="/companies/new" className={styles.newCompanyButton}>
          <PlusIcon className={styles.icon} />
          {l.newCompany}
        </Link>
      </div>

      <form className={styles.toolbar}>
        <input
          type="search"
          name="search"
          placeholder={l.searchPlaceholder}
          className={styles.searchInput}
          defaultValue={params.search || ""}
        />
        <select name="stage" className={styles.stageFilter} defaultValue={params.stage || ""}>
          <option value="">{l.stageAny}</option>
          {STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {stageLabel(stage)}
            </option>
          ))}
        </select>
        <button type="submit" className={styles.searchButton}>
          {l.searchButton}
        </button>
      </form>

      {rows.length === 0 ? (
        <div className={styles.emptyState}>
          <p>{l.emptyState}</p>
          <Link href="/companies/new" className={styles.createLink}>
            {l.createLink}
          </Link>
        </div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{l.colCompany}</th>
                  <th>{l.colStage}</th>
                  <th>{l.colNotes}</th>
                  <th>{l.colRevenue}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((company) => (
                  <tr key={company.companyKey}>
                    <td>
                      <Link
                        // Keys are derived from LinkedIn company names and
                        // routinely contain spaces, pipes and slashes, none
                        // of which survive an unencoded href.
                        href={`/companies/${encodeURIComponent(company.companyKey)}`}
                        className={styles.companyLink}
                      >
                        <Avatar
                          id={company.companyKey}
                          initials={initialsFromName(company.displayName)}
                          variant="bd"
                          size="sm"
                        />
                        <span className={styles.companyName}>{company.displayName}</span>
                      </Link>
                    </td>
                    <td>
                      {company.relationshipStage && (
                        <span
                          className={`${styles.stage} ${styles[`stage-${company.relationshipStage}`] ?? ""}`}
                        >
                          {stageLabel(company.relationshipStage)}
                        </span>
                      )}
                    </td>
                    <td className={styles.notes}>{company.notes ?? "—"}</td>
                    <td className={styles.revenue}>
                      {company.revenuePotential
                        ? `$${company.revenuePotential.toLocaleString()}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <Link
                  key={p}
                  href={`/companies?page=${p}`}
                  className={`${styles.pageLink} ${p === page ? styles.active : ""}`}
                >
                  {p}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
