import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import {
  getWhatsNewFeed,
  parseWhatsNewWindow,
  WHATS_NEW_WINDOWS,
} from "@/lib/whatsnew/queries";
import { MARKETS, isMarketKey } from "@/lib/hiring/markets";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { FilterCheckbox } from "./FilterCheckbox";
import { GenerateMessageButton } from "../outreach/GenerateMessageButton";
import { generateOutreachMessage } from "../outreach/actions";
import { pickGenerateMessageLabels } from "@/lib/outreach/messageLabels";

export const dynamic = "force-dynamic";

// Everything on this page is server-rendered from src/lib/whatsnew/queries.ts
// (getWhatsNewFeed — see that file for the exact query count and BD-scoping
// notes). Job postings, target companies and closures are shared, cross-BD
// data; contact counts and suggested contacts are scoped to the signed-in
// BD via getCurrentBd().
export default async function WhatsNewPage({
  searchParams,
}: {
  searchParams: Promise<{
    window?: string;
    market?: string;
    miamiOnly?: string;
    hideOffshore?: string;
  }>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const dict = t(locale);
  const messageLabels = pickGenerateMessageLabels(dict);
  const me = await getCurrentBd();
  const windowDays = parseWhatsNewWindow(sp.window);
  const market = isMarketKey(sp.market) ? sp.market : undefined;
  // Only meaningful when the market filter is exactly "us" — validated
  // server-side here so a URL crafted with e.g. market=latam&miamiOnly=on
  // can never mean "Miami postings in LATAM"; it's simply ignored. The `qs`
  // helper below also actively drops `miamiOnly` from generated links the
  // moment `market` isn't "us", so switching markets can't carry it along.
  const miamiOnly = market === "us" && sp.miamiOnly === "on";
  // Opt-in hide, off by default (see resolveHiringCompanies' `hideOffshore`
  // param in src/lib/hiring/queries.ts).
  const hideOffshore = sp.hideOffshore === "on";
  const feed = await getWhatsNewFeed(me.id, windowDays, market, miamiOnly, hideOffshore);

  // Composes the window + market + miamiOnly + hideOffshore filters into one
  // query string so neither Link-button group clobbers the others' current
  // selection.
  const qs = (overrides: {
    window?: number;
    market?: string | null;
    miamiOnly?: boolean;
    hideOffshore?: boolean;
  }) => {
    const params = new URLSearchParams();
    params.set("window", String(overrides.window ?? windowDays));
    const nextMarket = overrides.market !== undefined ? overrides.market : market;
    if (nextMarket) params.set("market", nextMarket);
    const nextMiamiOnly = overrides.miamiOnly !== undefined ? overrides.miamiOnly : miamiOnly;
    if (nextMarket === "us" && nextMiamiOnly) params.set("miamiOnly", "on");
    const nextHideOffshore =
      overrides.hideOffshore !== undefined ? overrides.hideOffshore : hideOffshore;
    if (nextHideOffshore) params.set("hideOffshore", "on");
    return `/whats-new?${params.toString()}`;
  };

  return (
    <main>
      {/* The page-local logo/header and cross-link nav row (BackButton +
          Outreach/Vacantes/Contactos secondary-btns) were removed here
          (mockup-parity 6.1) — the app shell ((app)/layout.tsx -> Sidebar
          + TopBar breadcrumb) already covers both. */}
      <div className="mb-3xl">
        <div className="eyebrow">{dict.whatsNew.eyebrow}</div>
        <h1>
          {dict.whatsNew.title}
          <span className="dot">.</span>
        </h1>
        <p className="soft m-0">
          {dict.whatsNew.subtitle}
        </p>
      </div>

      <section className="panel">
        <div className="whats-new-toolbar">
          <div className="whats-new-window-select">
            <span className="soft">{dict.whatsNew.windowLabel}</span>
            <div className="whats-new-window-options">
              {WHATS_NEW_WINDOWS.map((w) => (
                <Link
                  key={w}
                  href={qs({ window: w })}
                  className={w === windowDays ? "secondary-btn active" : "secondary-btn"}
                >
                  {dict.whatsNew.windowDays(w)}
                </Link>
              ))}
            </div>
          </div>
          <div className="whats-new-window-select">
            <span className="soft">{dict.common.marketLabel}</span>
            <div className="whats-new-window-options">
              <Link
                href={qs({ market: null })}
                className={!market ? "secondary-btn active" : "secondary-btn"}
              >
                {dict.common.allMarkets}
              </Link>
              {MARKETS.map((m) => (
                <Link
                  key={m}
                  href={qs({ market: m })}
                  className={m === market ? "secondary-btn active" : "secondary-btn"}
                >
                  {dict.markets[m]}
                </Link>
              ))}
            </div>
          </div>
          {market === "us" && (
            <div className="whats-new-window-select">
              <div className="whats-new-window-options">
                <FilterCheckbox
                  id="miamiOnly"
                  label={dict.common.miamiOnlyLabel}
                  checked={miamiOnly}
                  href={qs({ miamiOnly: !miamiOnly })}
                />
              </div>
            </div>
          )}
          <div className="whats-new-window-select">
            <div className="whats-new-window-options">
              <FilterCheckbox
                id="hideOffshore"
                label={dict.common.hideOffshoreLabel}
                checked={hideOffshore}
                href={qs({ hideOffshore: !hideOffshore })}
              />
            </div>
          </div>
          <p className="whats-new-sync-status">
            {feed.lastSuccessfulSyncAt
              ? dict.whatsNew.lastSyncAt(formatDateTime(feed.lastSuccessfulSyncAt, locale))
              : dict.whatsNew.neverSynced}
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="eyebrow">{dict.whatsNew.companiesEyebrow}</div>

        {feed.monitoredCompanyCount === 0 && (
          <p className="muted">
            {dict.whatsNew.noMonitoredCompaniesPrefix}
            <Link href="/hiring">{dict.whatsNew.noMonitoredCompaniesLinkText}</Link>
            {dict.whatsNew.noMonitoredCompaniesSuffix}
          </p>
        )}

        {feed.monitoredCompanyCount > 0 && !feed.hasAnySyncRun && (
          <p className="muted">{dict.whatsNew.noSyncYet}</p>
        )}

        {feed.monitoredCompanyCount > 0 && feed.hasAnySyncRun && feed.companies.length === 0 && (
          <p className="muted">{dict.whatsNew.noNewPostings(windowDays)}</p>
        )}

        {feed.companies.map((c) => (
          <div key={c.companyKey} className="whats-new-company">
            <div className="whats-new-company-head">
              <span className="whats-new-company-name">{c.displayName}</span>
              <span className="badge green">{dict.whatsNew.newPostingsCount(c.newPostingCount)}</span>
              {c.offshoreHeavy && (
                <span className="badge offshore">
                  {dict.common.offshoreBadge(c.offshoreItCount, c.latamItCount)}
                </span>
              )}
              <span className="soft">{dict.hiring.postingCount(c.openItCount)}</span>
              {c.contactCount > 0 && (
                <span className="soft">
                  {dict.hiring.contactCount(c.contactCount)}
                  {c.leadershipContactCount > 0 &&
                    ` ${dict.hiring.leadershipCount(c.leadershipContactCount)}`}
                  {c.restContactCount > 0 && ` ${dict.whatsNew.restContactCount(c.restContactCount)}`}
                </span>
              )}
            </div>

            {c.suggestedContacts.length > 0 && (
              <div className="whats-new-suggested">
                <span className="soft">{dict.whatsNew.suggestedContactsLabel}:</span>
                {c.suggestedContacts.map((sc) => (
                  <span key={sc.id} className="whats-new-suggested-item">
                    <Link className="rowlink" href={`/contact/${sc.id}`}>
                      {sc.name ?? dict.contact.unnamed}
                    </Link>
                    {sc.roleGroup && (
                      <span className={sc.isLeadership ? "badge green" : "badge"}>
                        {dict.roleGroups[sc.roleGroup]}
                      </span>
                    )}
                    <GenerateMessageButton
                      boundAction={generateOutreachMessage.bind(null, sc.id, locale)}
                      labels={messageLabels}
                    />
                  </span>
                ))}
              </div>
            )}

            <details className="filter-helper">
              <summary>{dict.whatsNew.showPostings}</summary>
              <div className="filter-helper-body">
                <ul className="example-list">
                  {c.newPostings.map((p) => (
                    <li key={p.id}>
                      <a href={p.url} target="_blank" rel="noopener noreferrer">
                        {p.title}
                      </a>{" "}
                      <span className="muted">
                        — {p.location || dict.hiring.locationNA}
                        {p.postedAt
                          ? ` ${dict.hiring.postedOn(formatDate(p.postedAt, locale))}`
                          : ` ${dict.whatsNew.firstSeenOn(formatDate(p.firstSeen, locale))}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </div>
        ))}
      </section>

      {feed.closures.length > 0 && (
        <section className="panel whats-new-closures">
          <div className="eyebrow">{dict.whatsNew.closuresEyebrow}</div>
          <h2>{dict.whatsNew.closuresTitle}</h2>
          <p className="soft mt-0">
            {dict.whatsNew.closuresSubtitle}
          </p>
          <ul className="example-list">
            {feed.closures.map((cl) => (
              <li key={cl.id}>
                <span className="muted">
                  {cl.displayName} — {cl.title} ({cl.location || dict.hiring.locationNA}) ·{" "}
                  {dict.whatsNew.closedOn(formatDate(cl.closedAt, locale))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
