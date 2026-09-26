import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import { getCompanyByKey } from "@/lib/companies/queries";
import { getDictionary } from "@/lib/i18n/server";
import { createCompanyAction } from "../actions";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const STAGES = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;

/**
 * Create form behind the "+ Add company" link on /companies. No dedicated
 * mockup exists for this screen (mockups/companies.html only links to it) —
 * per the apply instructions, it gets the shared page chrome (page-header,
 * card-style field group) instead. The company key is derived from the
 * display name with the same normalization the rest of the app uses (see
 * normalizeCompanyKey), so a company created here lines up with
 * contact/lead company keys instead of a hand-typed variant.
 */
export default async function NewCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  await getCurrentBd();
  const dict = await getDictionary();
  const l = dict.companyForm;
  const stageLabels: Record<string, string> = {
    prospect: dict.companiesPage.stageProspect,
    qualified: dict.companiesPage.stageQualified,
    proposal_sent: dict.companiesPage.stageProposalSent,
    won: dict.companiesPage.stageWon,
    lost: dict.companiesPage.stageLost,
  };

  async function create(formData: FormData) {
    "use server";

    const displayName = String(formData.get("displayName") ?? "").trim();
    if (!displayName) redirect("/companies/new?error=missingName");

    const companyKey = normalizeCompanyKey(displayName);
    if (!companyKey) redirect("/companies/new?error=missingName");

    if (await getCompanyByKey(companyKey)) {
      redirect("/companies/new?error=duplicate");
    }

    const stage = String(formData.get("relationshipStage") ?? "");
    const revenueRaw = String(formData.get("revenuePotential") ?? "").trim();
    const revenue = revenueRaw ? Number(revenueRaw) : undefined;

    await createCompanyAction({
      companyKey,
      displayName,
      relationshipStage: (STAGES as readonly string[]).includes(stage) ? stage : "prospect",
      revenuePotential: Number.isFinite(revenue) ? revenue : undefined,
      notes: String(formData.get("notes") ?? "").trim() || undefined,
    });

    redirect(`/companies/${companyKey}`);
  }

  return (
    <main className={styles.page}>
      <Link href="/companies" className={styles.backLink}>
        {l.backLink}
      </Link>

      <div className={styles.pageHeader}>
        <div className={styles.eyebrow}>{l.eyebrow}</div>
        <h1 className={styles.title}>{l.title}</h1>
      </div>

      {error && (
        <p className={styles.error}>
          {error === "duplicate" ? l.errorDuplicate : l.errorMissingName}
        </p>
      )}

      <form action={create} className={styles.form}>
        <label className={styles.field}>
          <span>{l.companyNameLabel}</span>
          <input name="displayName" type="text" required autoFocus />
        </label>

        <label className={styles.field}>
          <span>{l.stageLabel}</span>
          <select name="relationshipStage" defaultValue="prospect">
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {stageLabels[s] ?? s}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>{l.revenueLabel}</span>
          <input name="revenuePotential" type="number" min="0" step="1" />
        </label>

        <label className={styles.field}>
          <span>{l.notesLabel}</span>
          <textarea name="notes" rows={4} />
        </label>

        <div className={styles.actions}>
          <button type="submit">{l.submit}</button>
        </div>
      </form>
    </main>
  );
}
