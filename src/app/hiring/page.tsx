import Link from "next/link";
import { getCompanyHiringSummaries } from "@/lib/hiring/queries";
import { MARKETS, isMarketKey } from "@/lib/hiring/markets";
import { getCurrentBd } from "@/lib/queries";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { LocaleSwitcher } from "@/lib/i18n/LocaleSwitcher";
import { ThemeSwitcher } from "@/lib/theme/ThemeSwitcher";
import { getTheme } from "@/lib/theme/server";
import { SignOutButton } from "../SignOutButton";
import { UserMenu } from "../UserMenu";
import { BackButton } from "../BackButton";

export const dynamic = "force-dynamic";

export default async function HiringPage({
  searchParams,
}: {
  searchParams: Promise<{ market?: string; miamiOnly?: string; hideOffshore?: string }>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const theme = await getTheme();
  const dict = t(locale);
  const me = await getCurrentBd();
  const market = isMarketKey(sp.market) ? sp.market : undefined;
  // Only meaningful (and only rendered as a control below) when the market
  // filter is exactly "us" — validated server-side here so a URL crafted
  // with e.g. market=latam&miamiOnly=on can never mean "Miami postings in
  // LATAM"; it's simply ignored.
  const miamiOnly = market === "us" && sp.miamiOnly === "on";
  // Opt-in hide, off by default — an absent/unchecked checkbox is
  // indistinguishable from "form never submitted", so "on" is the only
  // value that means "hide" (see resolveHiringCompanies' `hideOffshore`
  // param in src/lib/hiring/queries.ts).
  const hideOffshore = sp.hideOffshore === "on";
  const summaries = await getCompanyHiringSummaries(me.id, market, miamiOnly, hideOffshore);

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
          <Link className="secondary-btn" href="/whats-new">
            {dict.common.whatsNew}
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
        <div className="eyebrow">{dict.hiring.eyebrow}</div>
        <h1>
          {dict.hiring.title}
          <span className="dot">.</span>
        </h1>
        <p className="soft m-0">
          {dict.hiring.subtitle}
        </p>
      </div>

      <section className="panel">
        <div className="eyebrow">{dict.common.filterEyebrow}</div>
        <form method="get" className="filter-toolbar">
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
          </div>
          <button type="submit" className="filter-submit">
            {dict.common.filter}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="eyebrow">{dict.hiring.companiesEyebrow}</div>
        {!summaries.length && <p className="muted">{dict.hiring.empty}</p>}
        {summaries.map((s) => (
          <div key={s.companyKey} className="mb-md">
            <details className="filter-helper">
              <summary>
                {s.displayName} — {dict.hiring.postingCount(s.openItCount)}
                {s.newLast7Days > 0 && (
                  <span className="badge green">{dict.hiring.newBadge(s.newLast7Days)}</span>
                )}
                {s.offshoreHeavy && (
                  <span className="badge offshore">
                    {dict.common.offshoreBadge(s.offshoreItCount, s.latamItCount)}
                  </span>
                )}
                <span className="filter-helper-hint">{dict.hiring.showPostings}</span>
              </summary>
              <div className="filter-helper-body">
                <ul className="example-list">
                  {s.postings.map((p) => (
                    <li key={p.id}>
                      <a href={p.url} target="_blank" rel="noopener noreferrer">
                        {p.title}
                      </a>{" "}
                      <span className="muted">
                        — {p.location || dict.hiring.locationNA} · {dict.markets[p.market]}
                        {p.postedAt ? ` ${dict.hiring.postedOn(formatDate(p.postedAt, locale))}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
            <Link
              className="soft inline-block mt-2xs"
              href={`/?companyKey=${encodeURIComponent(s.companyKey)}`}
            >
              {dict.hiring.contactCount(s.contactCount)}
              {s.leadershipContactCount > 0 && ` ${dict.hiring.leadershipCount(s.leadershipContactCount)}`} →
            </Link>
          </div>
        ))}
      </section>
    </main>
  );
}
