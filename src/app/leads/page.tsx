import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { getLeadFilterOptions, listLeads, type OwnerFilterValue } from "@/lib/leads/queries";
import { isEmailStatusKey, isLeadStatusKey } from "@/lib/leads/types";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { LocaleSwitcher } from "@/lib/i18n/LocaleSwitcher";
import { ThemeSwitcher } from "@/lib/theme/ThemeSwitcher";
import { getTheme } from "@/lib/theme/server";
import { SignOutButton } from "../SignOutButton";
import { UserMenu } from "../UserMenu";
import { BackButton } from "../BackButton";
import { UploadLeadsForm } from "./UploadLeadsForm";
import { pickLeadsUploadLabels } from "@/lib/leads/labels";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function isOwnerFilterValue(v: string | undefined): v is OwnerFilterValue {
  return !!v;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    name?: string;
    company?: string;
    industryGroup?: string;
    seniority?: string;
    owner?: string;
    emailStatus?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const theme = await getTheme();
  const dict = t(locale);
  const uploadLabels = pickLeadsUploadLabels(dict);
  const me = await getCurrentBd();
  const page = Math.max(1, Number(sp.page) || 1);

  const name = sp.name?.trim() || undefined;
  const company = sp.company?.trim() || undefined;
  const industryGroup = sp.industryGroup?.trim() || undefined;
  const seniority = sp.seniority?.trim() || undefined;
  const owner = isOwnerFilterValue(sp.owner) && sp.owner ? sp.owner : undefined;
  const emailStatus = isEmailStatusKey(sp.emailStatus) ? sp.emailStatus : undefined;
  const status = isLeadStatusKey(sp.status) ? sp.status : undefined;

  const [filterOptions, { rows, total, page: current, totalPages }] = await Promise.all([
    getLeadFilterOptions(),
    listLeads(
      me.id,
      { name, company, industryGroup, seniority, owner, emailStatus, status },
      page,
      PAGE_SIZE,
    ),
  ]);

  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    if (company) params.set("company", company);
    if (industryGroup) params.set("industryGroup", industryGroup);
    if (seniority) params.set("seniority", seniority);
    if (owner) params.set("owner", owner);
    if (emailStatus) params.set("emailStatus", emailStatus);
    if (status) params.set("status", status);
    params.set("page", String(p));
    return `/leads?${params.toString()}`;
  };

  const emailBadgeClass = (s: string) =>
    s === "verified" ? "badge green" : s === "probable" ? "badge warn" : "badge offshore";

  return (
    <main>
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        <div className="row row-md">
          <BackButton label={dict.common.goBack} fallbackHref="/" />
          <Link className="secondary-btn" href="/outreach">
            {dict.common.priorityOutreach}
          </Link>
          <Link className="secondary-btn" href="/hiring">
            {dict.common.hiringSignals}
          </Link>
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

      <div className="mb-3xl">
        <div className="eyebrow">{dict.leads.eyebrow}</div>
        <h1>
          {dict.leads.title}
          <span className="dot">.</span>
        </h1>
        <p className="soft m-0">{dict.leads.subtitle}</p>
      </div>

      <section className="panel">
        <div className="eyebrow">{dict.leads.importEyebrow}</div>
        <h2 className="m-0">{dict.leads.importTitle}</h2>
        <p className="soft">{dict.leads.importHint}</p>
        <UploadLeadsForm labels={uploadLabels} />
      </section>

      <section className="panel">
        <div className="eyebrow">{dict.common.filterEyebrow}</div>
        <form method="get" className="filter-toolbar">
          <div className="filter-field">
            <label htmlFor="name">{dict.leads.nameFilterLabel}</label>
            <input
              id="name"
              name="name"
              type="text"
              defaultValue={name ?? ""}
              placeholder={dict.leads.nameFilterPlaceholder}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="company">{dict.leads.companyFilterLabel}</label>
            <input
              id="company"
              name="company"
              type="text"
              defaultValue={company ?? ""}
              placeholder={dict.leads.companyFilterPlaceholder}
            />
          </div>
          <div className="filter-field">
            <label htmlFor="industryGroup">{dict.leads.industryGroupLabel}</label>
            <select id="industryGroup" name="industryGroup" defaultValue={industryGroup ?? ""}>
              <option value="">{dict.leads.allIndustryGroups}</option>
              {filterOptions.industryGroups.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="seniority">{dict.leads.seniorityLabel}</label>
            <select id="seniority" name="seniority" defaultValue={seniority ?? ""}>
              <option value="">{dict.leads.allSeniorities}</option>
              {filterOptions.seniorities.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="owner">{dict.leads.ownerLabel}</label>
            <select id="owner" name="owner" defaultValue={owner ?? ""}>
              <option value="">{dict.leads.allOwners}</option>
              <option value="mine">{dict.leads.ownerMine}</option>
              <option value="unassigned">{dict.leads.ownerUnassigned}</option>
              {filterOptions.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="emailStatus">{dict.leads.emailStatusLabel}</label>
            <select id="emailStatus" name="emailStatus" defaultValue={emailStatus ?? ""}>
              <option value="">{dict.leads.allEmailStatuses}</option>
              {(["verified", "probable", "none"] as const).map((k) => (
                <option key={k} value={k}>
                  {dict.leadEmailStatuses[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="status">{dict.leads.statusLabel}</label>
            <select id="status" name="status" defaultValue={status ?? ""}>
              <option value="">{dict.leads.allStatuses}</option>
              {(["new", "contacted", "replied", "meeting", "discarded"] as const).map((k) => (
                <option key={k} value={k}>
                  {dict.leadStatuses[k]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="filter-submit">
            {dict.common.filter}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="eyebrow">{dict.leads.candidatesEyebrow}</div>
        <p className="soft mt-0">{dict.common.totalPage(total, current, totalPages)}</p>

        {!rows.length && <p className="muted">{dict.leads.noLeads}</p>}

        {rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{dict.leads.tableName}</th>
                  <th>{dict.leads.tableJobTitle}</th>
                  <th>{dict.leads.tableSeniority}</th>
                  <th>{dict.leads.tableCompany}</th>
                  <th>{dict.leads.tableIndustry}</th>
                  <th>{dict.leads.tableEmail}</th>
                  <th>{dict.leads.tableOwner}</th>
                  <th>{dict.leads.tableStatus}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="rowlink" href={`/leads/${r.id}`}>
                        {[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}
                      </Link>
                    </td>
                    <td>{r.jobTitle ?? "—"}</td>
                    <td>{r.seniority ?? "—"}</td>
                    <td>{r.companyDisplay ?? r.companyRaw ?? "—"}</td>
                    <td>{r.industryGroup ?? "—"}</td>
                    <td>
                      {r.email ?? dict.leads.noEmail}{" "}
                      <span className={emailBadgeClass(r.emailStatus)}>
                        {dict.leadEmailStatuses[r.emailStatus]}
                      </span>
                    </td>
                    <td>{r.ownerName ?? dict.leads.unassignedOwner}</td>
                    <td>{dict.leadStatuses[r.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
