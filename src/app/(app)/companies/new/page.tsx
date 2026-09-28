import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import { getCompanyByKey } from "@/lib/companies/queries";
import { getDictionary } from "@/lib/i18n/server";
import { createCompanyAction } from "../actions";
import { normalizeCompanyKey } from "@/lib/companyCategories";

export const dynamic = "force-dynamic";

const STAGES = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;

/**
 * Create form behind the "Nueva empresa" button on /companies
 * (companies.html:64). No dedicated mockup exists for this screen (the
 * mockups folder has no company-new.html; companies.html only links to it)
 * — restyled onto the same global design-system classes (`page-header`,
 * `form-grid`/`field`/`input`) the rest of the mockup-port pages use,
 * instead of this route's own `page.module.css` (removed). The company key
 * is derived from the display name with the same normalization the rest of
 * the app uses (normalizeCompanyKey), so a company created here lines up
 * with contact/lead company keys instead of a hand-typed variant.
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
    prospect: dict.companyList.stageProspect,
    qualified: dict.companyList.stageQualified,
    proposal_sent: dict.companyList.stageProposalSent,
    won: dict.companyList.stageWon,
    lost: dict.companyList.stageLost,
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
    <main className="page">
      <Link href="/companies">{l.backLink}</Link>

      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>{l.title}</h1>
        </div>
      </div>

      {error && <p className="alert alert-warn">{error === "duplicate" ? l.errorDuplicate : l.errorMissingName}</p>}

      <form action={create} className="composer">
        <label className="field">
          {l.companyNameLabel}
          <input className="input" name="displayName" type="text" required autoFocus />
        </label>

        <div className="form-grid">
          <label className="field">
            {l.stageLabel}
            <select className="input" name="relationshipStage" defaultValue="prospect">
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {stageLabels[s] ?? s}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            {l.revenueLabel}
            <input className="input" name="revenuePotential" type="number" min="0" step="1" />
          </label>
        </div>

        <label className="field">
          {l.notesLabel}
          <textarea className="textarea" name="notes" rows={4} />
        </label>

        <div className="bar">
          <Link href="/companies" className="btn btn-secondary">
            {dict.companyRecord.cancel}
          </Link>
          <button type="submit" className="btn btn-primary">
            {l.submit}
          </button>
        </div>
      </form>
    </main>
  );
}
