import Link from "next/link";
import { getCompanies } from "@/lib/companies/queries";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface SearchParams {
  search?: string;
  stage?: string;
  page?: string;
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const { rows, total, totalPages } = await getCompanies(
    {
      search: params.search,
      relationshipStage: params.stage,
    },
    page,
    20,
  );

  const stages = ["prospect", "qualified", "proposal_sent", "won", "lost"];

  return (
    <main>
      <div className={styles.header}>
        <h1>Companies</h1>
        <p className={styles.subtitle}>CRM target accounts</p>
      </div>

      <div className={styles.filters}>
        <input
          type="search"
          placeholder="Search companies..."
          className={styles.searchInput}
          defaultValue={params.search || ""}
        />
        <select className={styles.stageFilter} defaultValue={params.stage || ""}>
          <option value="">All stages</option>
          {stages.map((stage) => (
            <option key={stage} value={stage}>
              {stage.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.listContainer}>
        {rows.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No companies yet</p>
            <Link href="/companies/new" className={styles.createLink}>
              + Add company
            </Link>
          </div>
        ) : (
          <>
            <div className={styles.companiesList}>
              {rows.map((company) => (
                <Link
                  key={company.companyKey}
                  href={`/companies/${company.companyKey}`}
                  className={styles.companyCard}
                >
                  <div className={styles.cardContent}>
                    <h3 className={styles.companyName}>
                      {company.displayName}
                    </h3>
                    {company.relationshipStage && (
                      <span className={`${styles.stage} ${styles[`stage-${company.relationshipStage}`]}`}>
                        {company.relationshipStage}
                      </span>
                    )}
                    {company.notes && (
                      <p className={styles.notes}>{company.notes}</p>
                    )}
                  </div>
                  <div className={styles.revenue}>
                    {company.revenuePotential && (
                      <span>${company.revenuePotential.toLocaleString()}</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {totalPages > 1 && (
              <div className={styles.pagination}>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (p) => (
                    <Link
                      key={p}
                      href={`/companies?page=${p}`}
                      className={`${styles.pageLink} ${
                        p === page ? styles.active : ""
                      }`}
                    >
                      {p}
                    </Link>
                  ),
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
