import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import { getCompanyByKey } from "@/lib/companies/queries";
import { createCompanyAction } from "../actions";
import { normalizeCompanyKey } from "@/lib/companyCategories";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const STAGES = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;

/**
 * Create form behind the "+ Add company" link on /companies. The company
 * key is derived from the display name with the same normalization the
 * rest of the app uses (see normalizeCompanyKey), so a company created
 * here lines up with contact/lead company keys instead of a hand-typed
 * variant.
 */
export default async function NewCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  await getCurrentBd();

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
    <main>
      <Link href="/companies" className={styles.backLink}>
        ← Back to companies
      </Link>

      <div className={styles.header}>
        <h1>Add company</h1>
      </div>

      {error && (
        <p className={styles.error}>
          {error === "duplicate"
            ? "A company with that name already exists."
            : "Enter a company name first."}
        </p>
      )}

      <form action={create} className={styles.form}>
        <label className={styles.field}>
          <span>Company name</span>
          <input name="displayName" type="text" required autoFocus />
        </label>

        <label className={styles.field}>
          <span>Stage</span>
          <select name="relationshipStage" defaultValue="prospect">
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>Revenue potential</span>
          <input name="revenuePotential" type="number" min="0" step="1" />
        </label>

        <label className={styles.field}>
          <span>Notes</span>
          <textarea name="notes" rows={4} />
        </label>

        <div className={styles.actions}>
          <button type="submit">Create company</button>
        </div>
      </form>
    </main>
  );
}
