import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { listOutreachCandidates, outreachReasons } from "@/lib/outreach/queries";
import { ROLE_GROUPS, type RoleGroupKey } from "@/lib/roleGroups";
import { COMPANY_CATEGORIES, type CompanyCategoryKey } from "@/lib/companyCategories";
import { MARKETS, isMarketKey } from "@/lib/hiring/markets";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { relativeTime } from "@/lib/i18n/format";
import { LocaleSwitcher } from "@/lib/i18n/LocaleSwitcher";
import { ThemeSwitcher } from "@/lib/theme/ThemeSwitcher";
import { getTheme } from "@/lib/theme/server";
import { SignOutButton } from "../SignOutButton";
import { UserMenu } from "../UserMenu";
import { BackButton } from "../BackButton";
import { GenerateMessageButton } from "./GenerateMessageButton";
import { pickGenerateMessageLabels } from "@/lib/outreach/messageLabels";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const ROLE_GROUP_KEYS = new Set(ROLE_GROUPS.map((g) => g.key));
const COMPANY_CATEGORY_KEYS = new Set(COMPANY_CATEGORIES.map((c) => c.key));

function isRoleGroupKey(v: string | undefined): v is RoleGroupKey {
  return !!v && ROLE_GROUP_KEYS.has(v as RoleGroupKey);
}

function isCompanyCategoryKey(v: string | undefined): v is CompanyCategoryKey {
  return !!v && COMPANY_CATEGORY_KEYS.has(v as CompanyCategoryKey);
}

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<{
    roleGroup?: string;
    companyCategory?: string;
    market?: string;
    miamiOnly?: string;
    excludeNever?: string;
    hideOffshore?: string;
    startupsOnly?: string;
    name?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const theme = await getTheme();
  const dict = t(locale);
  const messageLabels = pickGenerateMessageLabels(dict);
  const relTime = (d: Date) => relativeTime(d, locale);
  const me = await getCurrentBd();
  const page = Math.max(1, Number(sp.page) || 1);
  const roleGroup = isRoleGroupKey(sp.roleGroup) ? sp.roleGroup : undefined;
  const companyCategory = isCompanyCategoryKey(sp.companyCategory) ? sp.companyCategory : undefined;
  const market = isMarketKey(sp.market) ? sp.market : undefined;
  // Only meaningful (and only rendered as a control below) when the market
  // filter is exactly "us" — validated server-side here so a URL crafted
  // with e.g. market=latam&miamiOnly=on can never mean "Miami postings in
  // LATAM"; it's simply ignored.
  const miamiOnly = market === "us" && sp.miamiOnly === "on";
  // A GET checkbox that's unchecked is simply omitted from the submitted
  // query string, indistinguishable from "form never submitted" — so the
  // control is phrased as an opt-in "exclude" checkbox (default unchecked)
  // rather than an "include" one. Unset or absent -> included (the
  // required default); present -> excluded.
  const excludeNeverMessaged = sp.excludeNever === "on";
  const includeNeverMessaged = !excludeNeverMessaged;
  // Opt-in hide, off by default — same "on" convention as excludeNever
  // above (see resolveHiringCompanies' `hideOffshore` param in
  // src/lib/hiring/queries.ts).
  const hideOffshore = sp.hideOffshore === "on";
  // Opt-in filter, off by default — same "on" convention as excludeNever /
  // hideOffshore above (see resolveHiringCompanies' `startupsOnly` param in
  // src/lib/hiring/queries.ts).
  const startupsOnly = sp.startupsOnly === "on";
  // Free-text name search (first or last name). Empty string means "no
  // filter", same as an absent param.
  const name = sp.name?.trim() || undefined;

  const { rows, total, page: current, totalPages, hiringCompanyCount } =
    await listOutreachCandidates(
      me.id,
      { roleGroup, companyCategory, market, miamiOnly, includeNeverMessaged, hideOffshore, startupsOnly, name },
      page,
      PAGE_SIZE,
    );

  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (roleGroup) params.set("roleGroup", roleGroup);
    if (companyCategory) params.set("companyCategory", companyCategory);
    if (market) params.set("market", market);
    if (miamiOnly) params.set("miamiOnly", "on");
    if (excludeNeverMessaged) params.set("excludeNever", "on");
    if (hideOffshore) params.set("hideOffshore", "on");
    if (startupsOnly) params.set("startupsOnly", "on");
    if (name) params.set("name", name);
    params.set("page", String(p));
    return `/outreach?${params.toString()}`;
  };

  return (
    <main>
      <div className="header">
        <span className="logo">
          avalith<span className="dot">.</span>
        </span>
        <div className="row row-md">
          <BackButton label={dict.common.goBack} fallbackHref="/" />
          <Link className="secondary-btn" href="/whats-new">
            {dict.common.whatsNew}
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
        <div className="eyebrow">{dict.outreach.eyebrow}</div>
        <h1>
          {dict.outreach.title}
          <span className="dot">.</span>
        </h1>
        <p className="soft m-0">
          {dict.outreach.subtitle}
        </p>
      </div>

      <section className="panel">
        <div className="eyebrow">{dict.common.filterEyebrow}</div>
        <form method="get" className="filter-toolbar">
          <div className="filter-field">
            <label htmlFor="roleGroup">{dict.common.roleGroupLabel}</label>
            <select id="roleGroup" name="roleGroup" defaultValue={roleGroup ?? ""}>
              <option value="">{dict.common.allGroups}</option>
              {ROLE_GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {dict.roleGroups[g.key]}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="name">{dict.outreach.nameFilterLabel}</label>
            <input
              id="name"
              name="name"
              type="search"
              defaultValue={name ?? ""}
              placeholder={dict.outreach.nameFilterPlaceholder}
            />
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
                  {dict.companyCategories[c.key]}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="market">{dict.common.marketLabel}</label>
            <select id="market" name="market" defaultValue={market ?? ""}>
              <option value="">{dict.common.allMarkets}</option>
              {MARKETS.map((m) => (
                <option key={m} value={m}>
                  {dict.markets[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-checkbox-group" role="group">
            {market === "us" && (
              <div className="filter-checkbox">
                <label htmlFor="miamiOnly" className="checkbox-label">
                  <input
                    id="miamiOnly"
                    name="miamiOnly"
                    type="checkbox"
                    defaultChecked={miamiOnly}
                  />
                  {dict.common.miamiOnlyLabel}
                </label>
              </div>
            )}
            <div className="filter-checkbox">
              <label htmlFor="excludeNever" className="checkbox-label">
                <input
                  id="excludeNever"
                  name="excludeNever"
                  type="checkbox"
                  defaultChecked={excludeNeverMessaged}
                />
                {dict.outreach.excludeNeverMessaged}
              </label>
            </div>
            <div className="filter-checkbox">
              <label htmlFor="hideOffshore" className="checkbox-label">
                <input
                  id="hideOffshore"
                  name="hideOffshore"
                  type="checkbox"
                  defaultChecked={hideOffshore}
                />
                {dict.common.hideOffshoreLabel}
              </label>
            </div>
            <div className="filter-checkbox">
              <label htmlFor="startupsOnly" className="checkbox-label">
                <input
                  id="startupsOnly"
                  name="startupsOnly"
                  type="checkbox"
                  defaultChecked={startupsOnly}
                />
                {dict.outreach.startupsOnlyLabel}
              </label>
            </div>
          </div>
          <button type="submit" className="filter-submit">
            {dict.common.filter}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="eyebrow">{dict.outreach.candidatesEyebrow}</div>
        <p className="soft mt-0">
          {dict.common.totalPage(total, current, totalPages)}
        </p>

        {!hiringCompanyCount && (
          <p className="muted">
            {dict.outreach.noHiringCompaniesPrefix}
            <Link href="/hiring">{dict.outreach.noHiringCompaniesLinkText}</Link>
            {dict.outreach.noHiringCompaniesSuffix}
          </p>
        )}

        {hiringCompanyCount > 0 && !rows.length && (
          <p className="muted">
            {dict.outreach.noMatchingContacts(
              hiringCompanyCount,
              Boolean(roleGroup),
              !includeNeverMessaged,
              Boolean(companyCategory),
              startupsOnly,
            )}
          </p>
        )}

        {rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{dict.outreach.tableName}</th>
                  <th>{dict.outreach.tablePosition}</th>
                  <th>{dict.outreach.tableCompany}</th>
                  <th>{dict.outreach.tableRoleGroup}</th>
                  <th>{dict.outreach.tableOpenRoles}</th>
                  <th>{dict.outreach.tableLastContact}</th>
                  <th>{dict.outreach.tableWhy}</th>
                  <th>{dict.outreach.tableMessage}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link className="rowlink" href={`/contact/${r.id}`}>
                        {[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}
                      </Link>
                    </td>
                    <td>{r.position ?? "—"}</td>
                    <td>
                      {r.company ?? "—"}
                      {r.isStartup && (
                        <span className="badge startup" title={r.startupReason ?? undefined}>
                          {dict.outreach.startupBadge}
                        </span>
                      )}
                      {r.offshoreHeavy && (
                        <span className="badge offshore">
                          {dict.common.offshoreBadge(r.offshoreItCount, r.latamItCount)}
                        </span>
                      )}
                    </td>
                    <td>{r.roleGroup ? dict.roleGroups[r.roleGroup] : "—"}</td>
                    <td>{r.openItCount}</td>
                    <td>{r.lastMessageAt ? relTime(new Date(r.lastMessageAt)) : dict.common.never}</td>
                    <td>
                      <div className="reason-chips">
                        {outreachReasons(r, relTime, dict).map((reason) => (
                          <span
                            key={reason}
                            className={
                              r.relationshipTier === "dormant"
                                ? "badge dormant"
                                : r.isLeadership
                                  ? "badge green"
                                  : "badge"
                            }
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <GenerateMessageButton contactId={r.id} locale={locale} labels={messageLabels} />
                    </td>
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
