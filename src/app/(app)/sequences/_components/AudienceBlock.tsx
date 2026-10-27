import { Fragment } from "react";
import Link from "next/link";
import { DropdownMenu } from "@/components/DropdownMenu";
import { ChevronDownIcon, WarningIcon } from "@/components/icons";
import { fixMenuItems, formatColleagueBreakdown, holdKind, memberLanguage, preferredStamp } from "@/lib/sequences/audienceCard";
import type { MemberAudience } from "@/lib/sequences/audienceView";
import { countryNameEs, flagEmoji } from "@/lib/sequences/countryDisplay";
import type { DetailMember } from "@/lib/sequences/detailQueries";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import { stampLabel } from "@/lib/scheduledEmail/view";
import { fillStrong } from "@/lib/sequences/fillStrong";
import type { OnAction } from "./actions";

/** The "corregir" menu: links to the existing contact and company records, where the country is already editable. */
function FixMenu({ m, a, name, first, l }: { m: DetailMember; a: MemberAudience; name: string; first: string; l: SequenceLabels }) {
  const t = l.audience;
  return (
    <DropdownMenu trigger={<>{t.fix}<ChevronDownIcon className="icon" /></>} triggerClassName="btn btn-ghost btn-sm" ariaLabel={fill(t.fixAria, { name })}>
      <div className="menu-label">{t.fixMenuLabel}</div>
      {fixMenuItems(a, Boolean(m.companyKey && m.company)).map((item, i, all) => {
        if (item === "person") return <Link key={item} role="menuitem" className="menu-item" href={`/contacts/${m.personId}`}>{fill(t.fixPerson, { name: first })}</Link>;
        if (item === "company") return <Link key={item} role="menuitem" className="menu-item" href={`/companies/${encodeURIComponent(m.companyKey!)}`}>{fill(t.fixCompany, { company: m.company! })}</Link>;
        if (item === "phone") return <Link key={item} role="menuitem" className="menu-item" href={`/contacts/${m.personId}`}>{t.fixPhone}</Link>;
        // The company record lists only a few of its contacts; the Contacts list filtered by company shows every colleague.
        // Set apart from the fixes by a separator once there are three or more items (approved mockup).
        return (
          <Fragment key={item}>
            {all.length > 2 && <div className="menu-sep" />}
            <Link role="menuitem" className="menu-item" href={`/contacts?company=${encodeURIComponent(m.company!)}`}>{fill(t.rosterViewColleagues, { company: m.company! })}</Link>
          </Fragment>
        );
      })}
    </DropdownMenu>
  );
}

/** Why the audience resolved as it did: the same sentence the card and the language dialog show, so they cannot disagree. */
export function AudienceWhy({ m, name, l }: { m: DetailMember; name: string; l: SequenceLabels }) {
  const a = m.audience;
  if (!a?.audience) return null;
  const t = l.audience;
  const first = m.firstName?.trim() || name;
  const company = m.company ?? "";
  if (a.reason === "person_country") return <>{t.byPersonCountry} <strong>{first}</strong> ({a.evidence})</>;
  if (a.reason === "roster_consensus") {
    const agree = a.colleagues?.agree ?? 0;
    return <>{t.rosterBy} <strong>{fill(t.rosterColleagues, { n: agree })}</strong>{company.trim() && <> {fill(t.rosterAt, { company })}</>} ({a.isoName})<br />{fill(t.rosterNote, { name: first, k: agree, total: a.colleagues?.of ?? 0 })}{a.companyIgnored && <><br />{fill(t.rosterCompanyIgnored, { filed: a.companyIgnored })}</>}</>;
  }
  if (a.reason === "company_country") return <>{t.byCompanyCountry} <strong>{company}</strong> ({a.evidence})<br />{fill(t.noOwnCountry, { name: first })}{!a.colleaguesDisagree && a.colleaguesKnown > 0 && <><br />{t.companyUncontradicted}</>}</>;
  if (a.reason === "posting_markets") return <>{t.byPostings} <strong>{t.postingsStrong}</strong> {fill(t.postingsOf, { company })} ({a.evidence === "latam" ? t.zoneLatam : t.zoneUs})<br />{fill(t.postingsNote, { name: first })}</>;
  return <>{t.byPhone} <span className="badge badge-outline">{a.evidence}</span></>;
}

/**
 * The "idioma" menu of the card: change it (opens the dialog) or go back to what the system resolved (the preferred language when
 * there is one). When the preference decides, it also links to the record, where the preference lives. Absent for a read-only viewer.
 */
function LanguageMenu({ m, name, lockTitle, onAction, l }: { m: DetailMember; name: string; lockTitle?: string; onAction: OnAction; l: SequenceLabels }) {
  const lc = l.languageChoice;
  const resolved = memberLanguage(m)!.baseline === "es" ? l.audience.langEs : l.audience.langEn;
  return (
    <DropdownMenu trigger={<>{lc.menuTrigger}<ChevronDownIcon className="icon" /></>} triggerClassName="btn btn-ghost btn-sm" ariaLabel={fill(lc.menuAria, { name })}>
      <div className="menu-label">{lc.menuLabel}</div>
      <button type="button" role="menuitem" className="menu-item" disabled={lockTitle !== undefined} title={lockTitle} onClick={() => void onAction({ type: "chooseLanguage", memberId: m.memberId })}>{lc.menuChange}</button>
      {m.languageChoice && <button type="button" role="menuitem" className="menu-item" disabled={lockTitle !== undefined} title={lockTitle} onClick={() => void onAction({ type: "resetLanguage", memberId: m.memberId })}>{fill(lc.menuReset, { resolved })}</button>}
      {memberLanguage(m)!.source === "preferred" && <Link role="menuitem" className="menu-item" href={`/contacts/${m.personId}`}>{l.audience.menuPreferredInRecord}</Link>}
    </DropdownMenu>
  );
}

/** Language and legal address the draft will use, and WHY: the same chain as the draft itself (audienceView.ts). */
export function AudienceBlock({ m, name, l, onAction, lockTitle }: { m: DetailMember; name: string; l: SequenceLabels; onAction?: OnAction; lockTitle?: string }) {
  const a = m.audience;
  if (!a) return null;
  const t = l.audience;
  const first = m.firstName?.trim() || name;
  const fix = a.reason === "person_country" && a.audience ? null : <FixMenu m={m} a={a} name={name} first={first} l={l} />;

  if (!a.audience) {
    const kind = holdKind(a, m.company);
    const text =
      kind === "splitRoster" ? fill(t.holdSplitRoster, { company: m.company!, k: a.colleagueCountries.length, breakdown: formatColleagueBreakdown(a.colleagueCountries, t.rosterListAnd), name: first })
      : kind === "noSignal" ? t.holdNoSignal
      : fill(kind === "sanctioned" ? t.holdSanctioned : t.holdUnrecognised, { value: a.reason === "roster_consensus" ? (a.isoName ?? "") : (a.evidence ?? "") });
    return (
      <div className="alert alert-danger" role="alert">
        <WarningIcon className="icon" />
        <div className="grow"><strong>{fill(t.holdTitle, { name })}</strong> {text}{m.preferredLanguage && <> {fill(t.holdPreferredNote, { lang: m.preferredLanguage.language === "es" ? t.langEs : t.langEn })}</>}</div>
        {fix}
      </div>
    );
  }

  const company = m.company ?? "";
  const choice = m.languageChoice ?? null;
  const preferred = m.preferredLanguage ?? null;
  const { language, source, baseline } = memberLanguage(m)!;
  const word = (lang: string) => (lang === "es" ? t.langEs : t.langEn);
  const lc = l.languageChoice;
  const why = <AudienceWhy m={m} name={name} l={l} />;
  // The language reason and the address reason are independent: with a preference deciding, the reason names who set it and what
  // the system would have resolved without it, and the address keeps its own line (addressNote) with its own reason.
  // No "cargado por" when there is no history row to quote, and no "sin esa preferencia" when the audience would have said the same.
  const stamp = preferred ? preferredStamp(preferred) : null;
  const preferredNote = source === "preferred" && preferred && <>{fillStrong(t.preferredBy, { name: first }, ["name"])}{stamp && <> {fillStrong(lc.preferredStamp, stamp, ["by"])}</>}.{a.audience.language !== language && <> {fill(t.preferredWithout, { resolved: word(a.audience.language) })}</>}<br />{lc.addressNote} {why}</>;
  return (
    <div className="stack-sm" aria-label={t.label}>
      <div className="row wrap" style={{ gap: ".5rem" }}>
        <span aria-hidden="true">{source !== "audience" ? flagEmoji(language === "es" ? "AR" : "US") : a.iso ? flagEmoji(a.iso) : "🌐"}</span>
        <strong>{word(language)}</strong>
        {choice && <span className="badge badge-info">{lc.chosenBadge}</span>}
        {source === "preferred" && <span className="badge badge-info">{lc.badgePreferred}</span>}
        <span className="meta">·</span>
        <strong>{a.audience.address === "mdp" ? t.addrMdp : t.addrMiami}</strong>
      </div>
      <div className="row wrap" style={{ gap: ".5rem", justifyContent: "space-between" }}>
        <div className="meta">↳ {choice ? <>{lc.chosenBy} <strong>{choice.byName ?? "?"}</strong> {fill(lc.chosenOn, { when: choice.at ? stampLabel(choice.at) : "", resolved: word(baseline) })}<br />{lc.addressNote} {why}</> : preferredNote || why}</div>
        <div className="row" style={{ gap: ".25rem" }}>{onAction && <LanguageMenu m={m} name={name} lockTitle={lockTitle} onAction={onAction} l={l} />}{fix}</div>
      </div>
      {company.trim() && a.colleaguesDisagree && a.reason === "company_country" && (
        <div className="alert alert-warn" style={{ padding: "var(--space-sm) var(--space-md)" }}>
          <div>{fill(t.companyDespiteSplit, { company, filed: a.evidence ?? "", breakdown: formatColleagueBreakdown(a.colleagueCountries, t.rosterListAnd) })}</div>
        </div>
      )}
      {company.trim() && a.colleaguesDisagree && a.reason !== "company_country" && (
        <div className="alert alert-warn" style={{ padding: "var(--space-sm) var(--space-md)" }}>
          <div>
            <strong>{fill(t.rosterSplitTitle, { company, k: a.colleagueCountries.length })}</strong>{" "}
            {fill(t.rosterSplitBody, { breakdown: formatColleagueBreakdown(a.colleagueCountries, t.rosterListAnd) })}
            {a.reason === "phone" && <> <span className="meta">{fill(t.rosterSplitToPhone, { name: first })}</span></>}
          </div>
        </div>
      )}
      {a.unusedPhone && (
        <div className="meta">
          {t.unusedPhoneBefore} <span className="badge badge-outline">{a.unusedPhone.number}</span> {fill(t.unusedPhoneAfter, { country: countryNameEs(a.unusedPhone.iso) })}{" "}
          {a.reason === "company_country" ? t.unusedPhoneByCompany : t.unusedPhoneByPostings}
        </div>
      )}
    </div>
  );
}
