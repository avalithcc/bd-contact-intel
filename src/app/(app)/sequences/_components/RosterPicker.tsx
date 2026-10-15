"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { SearchIcon } from "@/components/icons";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { COMPANY_MEMBER_LIMIT } from "@/lib/sequences/rosterGuards";
import { emailBadge, pickerView, toggleAllVisible, toggleOne, type PickerContact, type PickerRow, type Selection } from "@/lib/sequences/pickerView";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";

const MAX = COMPANY_MEMBER_LIMIT;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function CompanyCell({ c, linked, l }: { c: PickerContact; linked: boolean; l: SequenceLabels }) {
  const name = c.company && (
    <>
      <span className="company-logo" aria-hidden="true">{initialsFromName(c.company)}</span> <span className="soft">{c.company}</span>
    </>
  );
  return (
    <td className="nowrap">
      <div className="row" style={{ gap: ".4rem" }}>
        {name && (linked && c.companyKey ? <Link className="row row-xs" href={`/companies/${encodeURIComponent(c.companyKey)}`}>{name}</Link> : <span className="row row-xs">{name}</span>)}
        {c.florida && <span className="badge badge-outline">{l.florida}</span>}
      </div>
      <div className="meta">{fill(c.openIt === 1 ? l.pickOpenItOne : l.pickOpenIt, { n: c.openIt })}</div>
    </td>
  );
}

function Availability({ r, l }: { r: PickerRow; l: SequenceLabels }) {
  const c = r.contact;
  if (r.kind !== "blocked") {
    return <td><span className="badge badge-success">{r.kind === "selected" ? l.pickChosenBadge : l.pickAvailable}</span> <span className="meta">{fill(l.pickInCompany, { n: r.inCompany, max: MAX })}</span></td>;
  }
  const kind = r.block!;
  // Intl, not a literal " y ": a hardcoded conjunction bypasses the dictionary and prints Spanish inside the
  // English locale. The dictionary tests only assert that keys exist, so nothing else would catch it.
  const names = new Intl.ListFormat(l.dateLocale, { style: "long", type: "conjunction" }).format(r.limitNames);
  const why = fill(l.blockWhy[kind], { company: c.company ?? "", sequence: c.blockDetail ?? "", max: MAX, names });
  return (
    <td>
      <span className="badge badge-danger">{l.blockLabels[kind]}</span>
      <div className="meta">{why}{kind === "merged" && c.survivorId && <> <Link href={`/contacts/${c.survivorId}`}>{l.actions.openContact}</Link>.</>}</div>
    </td>
  );
}

function Row({ r, l, statusLabels, onToggle }: { r: PickerRow; l: SequenceLabels; statusLabels: Dictionary["leadStatuses"]; onToggle: (c: PickerContact) => void }) {
  const c = r.contact;
  const blocked = r.kind === "blocked";
  const badge = emailBadge(c.emailStatus, c.emailSource, c.email);
  return (
    <tr className={r.kind === "selected" ? "selected" : undefined}>
      <td className="col-check"><input type="checkbox" aria-label={fill(blocked ? l.pickCannot : l.pickChoose, { name: c.name })} checked={r.kind === "selected"} disabled={blocked} onChange={() => onToggle(c)} /></td>
      <td><div className="cell-person"><Avatar id={c.personId} initials={initialsFromName(c.name)} /><div>
        {blocked ? <span className="strong soft">{c.name}</span> : (
          <div className="row" style={{ gap: ".4rem" }}><Link className="name" href={`/contacts/${c.personId}`}>{c.name}</Link><span className={`badge badge-${c.status}`}>{statusLabels[c.status]}</span></div>
        )}
        {c.jobTitle && <div className="sub">{c.jobTitle}</div>}
      </div></div></td>
      <CompanyCell c={c} linked={!blocked} l={l} />
      <td className="nowrap">{badge ? <><span className={`badge badge-${badge === "inferred" ? "warn" : badge}`}>{l.emailBadges[badge]}</span><div className="meta">{c.email}</div></> : <span className="meta">{l.pickNoEmail}</span>}</td>
      <Availability r={r} l={l} />
    </tr>
  );
}

/**
 * The contact picker of the create form. `selection` belongs to the form: every counter here is computed from it, and the
 * search, the Florida filter and the blocked toggle only change which rows are drawn.
 */
export function RosterPicker({ contacts, selection, onChange, labels: l, statusLabels }: { contacts: readonly PickerContact[]; selection: Selection; onChange: (next: Selection) => void; labels: SequenceLabels; statusLabels: Dictionary["leadStatuses"] }) {
  const [search, setSearch] = useState("");
  const [florida, setFlorida] = useState(false);
  const [showBlocked, setShowBlocked] = useState(true);
  const v = pickerView(contacts, selection, { search, florida, showBlocked });
  const open = v.rows.filter((r) => r.kind !== "blocked");
  const firstBlocked = v.rows.findIndex((r) => r.kind === "blocked");
  const quota = v.full.map((f) => fill(l.pickQuotaEntry, { company: f.company, n: f.count, max: MAX })).join(", ");
  const toggle = (c: PickerContact) => onChange(toggleOne(selection, c));
  return (
    <>
      <div className="toolbar">
        <label className="search"><span className="sr-only">{l.pickSearchLabel}</span><SearchIcon className="icon" /><input type="search" placeholder={l.pickSearchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <div className="segmented" role="group" aria-label={l.pickLocation}>
          <button type="button" className={florida ? undefined : "on"} aria-pressed={!florida} onClick={() => setFlorida(false)}>{l.pickAllUs}</button>
          <button type="button" className={florida ? "on" : undefined} aria-pressed={florida} onClick={() => setFlorida(true)}>{l.florida}</button>
        </div>
        <span className="spacer"></span>
        <label className="check"><input type="checkbox" checked={showBlocked} onChange={(e) => setShowBlocked(e.target.checked)} /> {l.pickShowBlocked} <span className="meta">({v.blockedMatching})</span></label>
      </div>
      <div className="bulk-bar" role="region" aria-label={l.pickBarAria}>
        <span className="count">{fill(plural(v.selectedCount, l.pickChosenOne, l.pickChosen), { n: v.selectedCount })}</span><span className="sep"></span>
        <span className="small">{v.companyCount} {plural(v.companyCount, l.unitCompanyOne, l.unitCompanyMany)}{quota && ` · ${fill(l.pickQuota, { list: quota })}`}</span><span className="grow"></span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={v.selectedCount === 0} onClick={() => onChange(new Map())}>{l.pickClear}</button>
      </div>
      <div className="table-wrap"><table className="data">
        <thead><tr>
          <th className="col-check"><input type="checkbox" aria-label={l.pickColAll} checked={open.length > 0 && open.every((r) => r.kind === "selected")} disabled={open.length === 0} onChange={() => onChange(toggleAllVisible(selection, v.rows))} /></th>
          <th className="sorted">{l.pickColContact}</th><th>{l.pickColCompany}</th><th>{l.pickColEmail}</th><th>{l.pickColAvail}</th>
        </tr></thead>
        <tbody>
          {v.rows.length === 0 && <tr><td colSpan={5} className="meta">{l.pickEmpty}</td></tr>}
          {v.rows.map((r, i) => (
            <FragmentRow key={r.contact.personId} header={i === firstBlocked ? fill(l.pickBlockedHeader, { n: v.blockedShown }) : null}>
              <Row r={r} l={l} statusLabels={statusLabels} onToggle={toggle} />
            </FragmentRow>
          ))}
        </tbody>
      </table>
      <div className="table-footer">
        <span>{[fill(plural(v.availableShown, l.pickFooterAvailableOne, l.pickFooterAvailable), { n: v.availableShown }), v.blockedShown > 0 && fill(plural(v.blockedShown, l.pickFooterBlockedOne, l.pickFooterBlocked), { n: v.blockedShown })].filter(Boolean).join(" · ")}</span>
        <span>{fill(l.pickFooterQuota, { max: MAX })}</span>
      </div></div>
    </>
  );
}

function FragmentRow({ header, children }: { header: string | null; children: React.ReactNode }) {
  return <>{header && <tr><td colSpan={5} className="meta strong">{header}</td></tr>}{children}</>;
}
