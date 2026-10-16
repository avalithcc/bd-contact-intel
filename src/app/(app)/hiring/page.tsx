import Link from "next/link";
import { FRESH_POSTING_WINDOW_DAYS } from "@/lib/hiring/openPosting";
import { getCompanyHiringSummaries } from "@/lib/hiring/queries";
import { companyContactsHref, companyPostingsHref, formatDeltaAmount, marketLine } from "@/lib/hiring/delta";
import { isMarketKey } from "@/lib/hiring/markets";
import { companyLogoInitials } from "@/lib/contacts/companyLogo";
import { getCurrentBd } from "@/lib/queries";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { FilterCheckbox } from "../whats-new/FilterCheckbox";
import { LinkPendingDot } from "../contacts/LinkPendingDot";

export const dynamic = "force-dynamic";

export default async function HiringPage({
  searchParams,
}: {
  searchParams: Promise<{
    market?: string;
    miamiOnly?: string;
    hideOffshore?: string;
    startupsOnly?: string;
  }>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const dict = t(locale);
  const l = dict.hiring;
  const me = await getCurrentBd();
  const market = isMarketKey(sp.market) ? sp.market : undefined;
  // "Miami" is a sub-filter of US: a URL like market=latam&miamiOnly=on must never mean "Miami postings in LATAM",
  // so it is ignored unless the market is exactly "us".
  const miamiOnly = market === "us" && sp.miamiOnly === "on";
  // Opt-in toggles, off by default: "on" is the only value that means active (see resolveHiringCompanies).
  const hideOffshore = sp.hideOffshore === "on";
  const startupsOnly = sp.startupsOnly === "on";
  const { summaries, lastSyncAt } = await getCompanyHiringSummaries(
    me.id,
    market,
    miamiOnly,
    hideOffshore,
    startupsOnly,
  );

  // One query string for every control, so toggling one filter never clobbers the others.
  const href = (o: { market?: string | null; miamiOnly?: boolean; hideOffshore?: boolean; startupsOnly?: boolean }) => {
    const params = new URLSearchParams();
    const m = o.market !== undefined ? o.market : (market ?? null);
    if (m) params.set("market", m);
    if (m === "us" && (o.miamiOnly ?? miamiOnly)) params.set("miamiOnly", "on");
    if (o.hideOffshore ?? hideOffshore) params.set("hideOffshore", "on");
    if (o.startupsOnly ?? startupsOnly) params.set("startupsOnly", "on");
    const qs = params.toString();
    return qs ? `/hiring?${qs}` : "/hiring";
  };
  const segments = [
    { label: l.allMarketsLabel, on: !market, to: href({ market: null, miamiOnly: false }) },
    { label: dict.markets.latam, on: market === "latam", to: href({ market: "latam", miamiOnly: false }) },
    { label: l.marketUs, on: market === "us" && !miamiOnly, to: href({ market: "us", miamiOnly: false }) },
    { label: l.marketMiami, on: miamiOnly, to: href({ market: "us", miamiOnly: true }) },
  ];
  const lineLabels = { latam: dict.markets.latam, us: l.marketUs, miami: l.marketMiami };

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>
            {l.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">
            {l.subtitleLead}
            <strong>{l.subtitleStrong(FRESH_POSTING_WINDOW_DAYS)}</strong>
            {l.subtitleTail}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label={l.marketGroupLabel}>
          {segments.map((s) => (
            <Link key={s.label} href={s.to} className={s.on ? "on" : undefined} aria-current={s.on ? "true" : undefined}>
              {s.label}
              <LinkPendingDot />
            </Link>
          ))}
        </div>
        <FilterCheckbox
          id="hideOffshore"
          className="check"
          label={l.hideOffshore}
          checked={hideOffshore}
          href={href({ hideOffshore: !hideOffshore })}
        />
        <FilterCheckbox
          id="startupsOnly"
          className="check"
          label={l.startupsOnly}
          checked={startupsOnly}
          href={href({ startupsOnly: !startupsOnly })}
        />
        <span className="spacer" />
        <span className="meta">{lastSyncAt ? l.syncedAt(formatDateTime(lastSyncAt, locale)) : l.neverSynced}</span>
      </div>

      {!summaries.length ? (
        <p className="meta">{market || hideOffshore || startupsOnly ? l.emptyFiltered : l.empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{l.colCompany}</th>
                <th>{l.colVacancies}</th>
                <th>{l.colContacts}</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => {
                const line = marketLine(
                  { latam: s.latamItCount, us: s.usItCount, miami: s.miamiItCount },
                  lineLabels,
                );
                return (
                  <tr key={s.companyKey}>
                    <td>
                      <Link className="row" href={`/companies/${encodeURIComponent(s.companyKey)}`}>
                        <span className="company-logo" aria-hidden="true">
                          {companyLogoInitials(s.displayName)}
                        </span>
                        <span className="strong">{s.displayName}</span>
                      </Link>
                      {s.isStartup === true && <> <span className="badge badge-brand no-dot">{l.startupBadge}</span></>}
                      {s.offshoreHeavy && (
                        <>
                          {" "}
                          <span className="badge badge-offshore no-dot">{l.offshoreBadge}</span>
                        </>
                      )}
                      {line && <div className="meta">{line}</div>}
                    </td>
                    <td className="num">
                      <Link className="strong" href={companyPostingsHref(s.companyKey, { market, miamiOnly })} aria-label={l.vacanciesLinkLabel(s.openItCount, s.displayName)}>
                        {s.openItCount}
                      </Link>
                      {s.delta.kind === "up" && <> <span className="badge badge-success no-dot">{formatDeltaAmount(s.delta)}</span></>}
                      {s.delta.kind === "down" && <> <span className="badge badge-danger no-dot">{formatDeltaAmount(s.delta)}</span></>}
                      {s.delta.kind === "new" && <> <span className="badge badge-info no-dot">{l.newOnRadar}</span></>}
                    </td>
                    <td>
                      {s.contactCount > 0 ? (
                        <Link href={companyContactsHref(s.companyKey)}>
                          {l.contactCount(s.contactCount)}
                        </Link>
                      ) : (
                        <span className="meta">{l.contactCount(0)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
