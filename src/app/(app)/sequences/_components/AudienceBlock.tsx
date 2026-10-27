import Link from "next/link";
import { DropdownMenu } from "@/components/DropdownMenu";
import { ChevronDownIcon, WarningIcon } from "@/components/icons";
import { fixMenuItems, formatColleagueBreakdown } from "@/lib/sequences/audienceCard";
import type { MemberAudience } from "@/lib/sequences/audienceView";
import { countryNameEs, flagEmoji } from "@/lib/sequences/countryDisplay";
import type { DetailMember } from "@/lib/sequences/detailQueries";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import { stampLabel } from "@/lib/scheduledEmail/view";
import type { OnAction } from "./actions";

/** The "corregir" menu: links to the existing contact and company records, where the country is already editable. */
function FixMenu({ m, a, name, first, l }: { m: DetailMember; a: MemberAudience; name: string; first: string; l: SequenceLabels }) {
  const t = l.audience;
  return (
    <DropdownMenu trigger={<>{t.fix}<ChevronDownIcon className="icon" /></>} triggerClassName="btn btn-ghost btn-sm" ariaLabel={fill(t.fixAria, { name })}>
      <div className="menu-label">{t.fixMenuLabel}</div>
      {fixMenuItems(a, Boolean(m.companyKey && m.company)).map((item) => {
        if (item === "person") return <Link key={item} role="menuitem" className="menu-item" href={`/contacts/${m.personId}`}>{fill(t.fixPerson, { name: first })}</Link>;
        if (item === "company") return <Link key={item} role="menuitem" className="menu-item" href={`/companies/${encodeURIComponent(m.companyKey!)}`}>{fill(t.fixCompany, { company: m.company! })}</Link>;
        if (item === "phone") return <Link key={item} role="menuitem" className="menu-item" href={`/contacts/${m.personId}`}>{t.fixPhone}</Link>;
        // The company record lists only a few of its contacts; the Contacts list filtered by company shows every colleague.
        return <Link key={item} role="menuitem" className="menu-item" href={`/contacts?company=${encodeURIComponent(m.company!)}`}>{fill(t.rosterViewColleagues, { company: m.company! })}</Link>;
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
    return <>{t.rosterBy} <strong>{fill(t.rosterColleagues, { n: agree })}</strong> {fill(t.rosterAt, { company })} ({a.isoName})<br />{fill(t.rosterNote, { name: first, k: agree, total: a.colleagues?.of ?? 0 })}{a.companyIgnored && <> {fill(t.rosterCompanyIgnored, { filed: a.companyIgnored })}</>}</>;
  }
  if (a.reason === "company_country") return <>{t.byCompanyCountry} <strong>{company}</strong> ({a.evidence})<br />{fill(t.noOwnCountry, { name: first })}{a.colleaguesKnown > 0 && <> {t.companyUncontradicted}</>}</>;
  if (a.reason === "posting_markets") return <>{t.byPostings} <strong>{t.postingsStrong}</strong> {fill(t.postingsOf, { company })} ({a.evidence === "latam" ? t.zoneLatam : t.zoneUs})<br />{fill(t.postingsNote, { name: first })}</>;
  return <>{t.byPhone} <span className="badge badge-outline">{a.evidence}</span></>;
}

/** The "idioma" menu of the card: change it (opens the dialog) or go back to what the system resolved. Absent for a read-only viewer. */
function LanguageMenu({ m, name, lockTitle, onAction, l }: { m: DetailMember; name: string; lockTitle?: string; onAction: OnAction; l: SequenceLabels }) {
  const lc = l.languageChoice;
  const resolved = m.audience!.audience!.language === "es" ? l.audience.langEs : l.audience.langEn;
  return (
    <DropdownMenu trigger={<>{lc.menuTrigger}<ChevronDownIcon className="icon" /></>} triggerClassName="btn btn-ghost btn-sm" ariaLabel={fill(lc.menuAria, { name })}>
      <div className="menu-label">{lc.menuLabel}</div>
      <button type="button" role="menuitem" className="menu-item" disabled={lockTitle !== undefined} title={lockTitle} onClick={() => void onAction({ type: "chooseLanguage", memberId: m.memberId })}>{lc.menuChange}</button>
      {m.languageChoice && <button type="button" role="menuitem" className="menu-item" disabled={lockTitle !== undefined} title={lockTitle} onClick={() => void onAction({ type: "resetLanguage", memberId: m.memberId })}>{fill(lc.menuReset, { resolved })}</button>}
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
    const text =
      a.reason === null && a.colleaguesDisagree
        ? fill(t.holdSplitRoster, { company: m.company ?? "", k: a.colleagueCountries.length, breakdown: formatColleagueBreakdown(a.colleagueCountries, t.rosterListAnd), name: first })
        : a.reason === null
          ? t.holdNoSignal
          : fill(a.iso ? t.holdSanctioned : t.holdUnrecognised, { value: a.reason === "roster_consensus" ? (a.isoName ?? "") : (a.evidence ?? "") });
    return (
      <div className="alert alert-danger" role="alert">
        <WarningIcon className="icon" />
        <div className="grow"><strong>{fill(t.holdTitle, { name })}</strong> {text}</div>
        {fix}
      </div>
    );
  }

  const company = m.company ?? "";
  const choice = m.languageChoice ?? null;
  const language = choice?.language ?? a.audience.language;
  const lc = l.languageChoice;
  const why = <AudienceWhy m={m} name={name} l={l} />;
  return (
    <div className="stack-sm" aria-label={t.label}>
      <div className="row wrap" style={{ gap: ".5rem" }}>
        <span aria-hidden="true">{choice ? flagEmoji(choice.language === "es" ? "AR" : "US") : a.iso ? flagEmoji(a.iso) : "🌐"}</span>
        <strong>{language === "es" ? t.langEs : t.langEn}</strong>
        {choice && <span className="badge badge-info">{lc.chosenBadge}</span>}
        <span className="meta">·</span>
        <strong>{a.audience.address === "mdp" ? t.addrMdp : t.addrMiami}</strong>
      </div>
      <div className="row wrap" style={{ gap: ".5rem", justifyContent: "space-between" }}>
        <div className="meta">↳ {choice ? <>{lc.chosenBy} <strong>{choice.byName ?? "?"}</strong> {fill(lc.chosenOn, { when: choice.at ? stampLabel(choice.at) : "", resolved: a.audience.language === "es" ? t.langEs : t.langEn })}<br />{lc.addressNote} {why}</> : why}</div>
        <div className="row" style={{ gap: ".25rem" }}>{onAction && <LanguageMenu m={m} name={name} lockTitle={lockTitle} onAction={onAction} l={l} />}{fix}</div>
      </div>
      {a.colleaguesDisagree && (
        <div className="alert alert-warn" style={{ padding: "var(--space-sm) var(--space-md)" }}>
          <div>
            <strong>{fill(t.rosterSplitTitle, { company, k: a.colleagueCountries.length })}</strong>{" "}
            {fill(t.rosterSplitBody, { breakdown: formatColleagueBreakdown(a.colleagueCountries, t.rosterListAnd) })}
            {a.companyIgnored && <> {fill(t.rosterSplitCompany, { filed: a.companyIgnored })}</>}
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
