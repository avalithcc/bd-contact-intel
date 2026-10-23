import Link from "next/link";
import type { ReactNode } from "react";
import { DropdownMenu } from "@/components/DropdownMenu";
import { ChevronDownIcon, WarningIcon } from "@/components/icons";
import type { MemberAudience } from "@/lib/sequences/audienceView";
import { countryNameEs, flagEmoji } from "@/lib/sequences/countryDisplay";
import type { DetailMember } from "@/lib/sequences/detailQueries";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";

/** The "corregir" menu: links to the existing contact and company records, where the country is already editable. */
function FixMenu({ m, a, name, first, l }: { m: DetailMember; a: MemberAudience; name: string; first: string; l: SequenceLabels }) {
  const t = l.audience;
  return (
    <DropdownMenu trigger={<>{t.fix}<ChevronDownIcon className="icon" /></>} triggerClassName="btn btn-ghost btn-sm" ariaLabel={fill(t.fixAria, { name })}>
      <div className="menu-label">{t.fixMenuLabel}</div>
      {(a.reason !== "person_country" || !a.audience) && <Link role="menuitem" className="menu-item" href={`/contacts/${m.personId}`}>{fill(t.fixPerson, { name: first })}</Link>}
      {m.companyKey && m.company && <Link role="menuitem" className="menu-item" href={`/companies/${encodeURIComponent(m.companyKey)}`}>{fill(t.fixCompany, { company: m.company })}</Link>}
      {a.reason !== "phone" && !a.unusedPhone && <Link role="menuitem" className="menu-item" href={`/contacts/${m.personId}`}>{t.fixPhone}</Link>}
    </DropdownMenu>
  );
}

/** Language and legal address the draft will use, and WHY: the same chain as the draft itself (audienceView.ts). */
export function AudienceBlock({ m, name, l }: { m: DetailMember; name: string; l: SequenceLabels }) {
  const a = m.audience;
  if (!a) return null;
  const t = l.audience;
  const first = m.firstName?.trim() || name;
  const fix = a.reason === "person_country" && a.audience ? null : <FixMenu m={m} a={a} name={name} first={first} l={l} />;

  if (!a.audience) {
    const text = a.reason === null ? t.holdNoSignal : fill(a.iso ? t.holdSanctioned : t.holdUnrecognised, { value: a.evidence ?? "" });
    return (
      <div className="alert alert-danger" role="alert">
        <WarningIcon className="icon" />
        <div className="grow"><strong>{fill(t.holdTitle, { name })}</strong> {text}</div>
        {fix}
      </div>
    );
  }

  const company = m.company ?? "";
  let why: ReactNode;
  if (a.reason === "person_country") {
    why = <>{t.byPersonCountry} <strong>{first}</strong> ({a.evidence})</>;
  } else if (a.reason === "company_country") {
    why = <>{t.byCompanyCountry} <strong>{company}</strong> ({a.evidence})<br />{fill(t.noOwnCountry, { name: first })}</>;
  } else if (a.reason === "posting_markets") {
    why = <>{t.byPostings} <strong>{t.postingsStrong}</strong> {fill(t.postingsOf, { company })} ({a.evidence === "latam" ? t.zoneLatam : t.zoneUs})<br />{fill(t.postingsNote, { name: first })}</>;
  } else {
    why = <>{t.byPhone} <span className="badge badge-outline">{a.evidence}</span></>;
  }
  const impact = a.companyImpact;
  const decided = impact ? impact.decides + 1 : 0;
  return (
    <div className="stack-sm" aria-label={t.label}>
      <div className="row wrap" style={{ gap: ".5rem" }}>
        <span aria-hidden="true">{a.iso ? flagEmoji(a.iso) : "🌐"}</span>
        <strong>{a.audience.language === "es" ? t.langEs : t.langEn}</strong>
        <span className="meta">·</span>
        <strong>{a.audience.address === "mdp" ? t.addrMdp : t.addrMiami}</strong>
      </div>
      <div className="row wrap" style={{ gap: ".5rem", justifyContent: "space-between" }}>
        <div className="meta">↳ {why}</div>
        {fix}
      </div>
      {impact && (
        <div className="alert alert-warn" style={{ padding: "var(--space-sm) var(--space-md)" }}>
          <div>
            <strong>{fill(t.companyDecides, { n: decided })}</strong>{" "}
            {fill(impact.contradicting === 1 ? t.companyContradictsOne : t.companyContradictsMany, { company, k: impact.contradicting, country: impact.topCountry, filed: a.evidence ?? "" })}{" "}
            <span className="meta">{fill(t.companyFixNote, { n: decided })}</span>
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
