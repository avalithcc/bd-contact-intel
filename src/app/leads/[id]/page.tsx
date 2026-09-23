import { notFound } from "next/navigation";
import { getLeadById, getLeadFilterOptions } from "@/lib/leads/queries";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { LocaleSwitcher } from "@/lib/i18n/LocaleSwitcher";
import { ThemeSwitcher } from "@/lib/theme/ThemeSwitcher";
import { getTheme } from "@/lib/theme/server";
import { SignOutButton } from "../../SignOutButton";
import { UserMenu } from "../../UserMenu";
import { BackButton } from "../../BackButton";
import { getCurrentBd } from "@/lib/queries";
import { LeadEditForm } from "../LeadEditForm";
import { pickLeadEditLabels } from "@/lib/leads/labels";

export const dynamic = "force-dynamic";

function Field({
  label,
  value,
  emptyLabel,
}: {
  label: string;
  value: React.ReactNode;
  emptyLabel: string;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className={empty ? "field-value empty" : "field-value"}>
        {empty ? emptyLabel : value}
      </div>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const theme = await getTheme();
  const dict = t(locale);
  const editLabels = pickLeadEditLabels(dict);
  const me = await getCurrentBd();
  const [leadRow, filterOptions] = await Promise.all([
    getLeadById(id),
    getLeadFilterOptions(),
  ]);
  if (!leadRow) notFound();

  const fullName = [leadRow.firstName, leadRow.lastName].filter(Boolean).join(" ");
  const emailBadgeClass =
    leadRow.emailStatus === "verified"
      ? "badge green"
      : leadRow.emailStatus === "probable"
        ? "badge warn"
        : "badge offshore";

  return (
    <main className="detail-narrow">
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        <div className="row row-md">
          <BackButton label={dict.leads.backToLeads} fallbackHref="/leads" />
          <UserMenu
            label={me.name || dict.common.account}
            changePasswordHref="/account/password"
            changePasswordLabel={dict.common.changePassword}
            localeSwitcher={<LocaleSwitcher locale={locale} />}
            themeSwitcher={<ThemeSwitcher theme={theme} locale={locale} />}
            themeLabel={dict.common.themeLabel}
            signOutButton={<SignOutButton locale={locale} />}
          />
        </div>
      </div>

      <div className="mb-2xl">
        <div className="eyebrow">{dict.leads.detailEyebrow}</div>
        <h1>
          {fullName || dict.leads.empty}
          <span className="dot">.</span>
        </h1>
        <p className="soft m-0">
          {dict.leads.fieldSource(leadRow.sourceKey)}
          {" · "}
          {dict.leads.fieldImportedAt(formatDate(leadRow.lastImportedAt, locale))}
        </p>
      </div>

      <section className="panel">
        <Field label={dict.leads.fieldFirstName} value={leadRow.firstName} emptyLabel={dict.leads.empty} />
        <Field label={dict.leads.fieldLastName} value={leadRow.lastName} emptyLabel={dict.leads.empty} />
        <Field label={dict.leads.fieldJobTitle} value={leadRow.jobTitle} emptyLabel={dict.leads.empty} />
        <Field label={dict.leads.fieldSeniority} value={leadRow.seniority} emptyLabel={dict.leads.empty} />
        <Field
          label={dict.leads.fieldCompany}
          value={leadRow.companyDisplay ?? leadRow.companyRaw}
          emptyLabel={dict.leads.empty}
        />
        <Field label={dict.leads.fieldCompanyGroup} value={leadRow.companyGroup} emptyLabel={dict.leads.empty} />
        <Field label={dict.leads.fieldIndustry} value={leadRow.industryRaw} emptyLabel={dict.leads.empty} />
        <Field
          label={dict.leads.fieldIndustryGroup}
          value={leadRow.industryGroup}
          emptyLabel={dict.leads.empty}
        />
        <Field label={dict.leads.fieldCity} value={leadRow.city} emptyLabel={dict.leads.empty} />
        <Field label={dict.leads.fieldRegion} value={leadRow.region} emptyLabel={dict.leads.empty} />
        <Field label={dict.leads.fieldCountry} value={leadRow.country} emptyLabel={dict.leads.empty} />
        <Field
          label={dict.leads.fieldAttendeeType}
          value={leadRow.attendeeType}
          emptyLabel={dict.leads.empty}
        />
        <Field
          label={dict.leads.fieldEmail}
          value={leadRow.email}
          emptyLabel={dict.leads.empty}
        />
        <Field
          label={dict.leads.fieldEmailStatus}
          value={<span className={emailBadgeClass}>{dict.leadEmailStatuses[leadRow.emailStatus]}</span>}
          emptyLabel={dict.leads.empty}
        />
        <Field
          label={dict.leads.fieldEmailConfidence}
          value={leadRow.emailConfidence != null ? String(leadRow.emailConfidence) : null}
          emptyLabel={dict.leads.empty}
        />
        <Field label={dict.leads.fieldEmailSource} value={leadRow.emailSource} emptyLabel={dict.leads.empty} />
      </section>

      <section className="panel">
        <LeadEditForm
          leadId={leadRow.id}
          initialStatus={leadRow.status}
          initialNotes={leadRow.notes ?? ""}
          initialOwnerId={leadRow.ownerBdId}
          owners={filterOptions.owners}
          labels={editLabels}
        />
        <p className="soft mt-md mb-0">
          {leadRow.updatedAt && leadRow.updatedByName
            ? `${dict.leads.fieldUpdatedBy(leadRow.updatedByName)} ${dict.leads.fieldUpdatedAt(
                formatDateTime(leadRow.updatedAt, locale),
              )}`
            : dict.leads.neverUpdated}
        </p>
      </section>
    </main>
  );
}
