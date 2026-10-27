"use client";

import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { GenerateIcon, InfoIcon, WarningIcon } from "@/components/icons";
import { flagEmoji } from "@/lib/sequences/countryDisplay";
import { memberLanguage } from "@/lib/sequences/audienceCard";
import { buildFooter } from "@/lib/sequences/complianceFooter";
import { COMPLIANCE_CONFIG } from "@/lib/sequences/config";
import type { AudienceLanguage } from "@/lib/sequences/complianceAudience";
import type { DetailMember } from "@/lib/sequences/detailQueries";
import { formatArgentinaDayMonth } from "@/lib/i18n/format";
import { fillStrong } from "@/lib/sequences/fillStrong";
import { preferredCheckbox } from "@/lib/sequences/languageChoice";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import { AudienceWhy } from "./AudienceBlock";

const FLAG: Record<AudienceLanguage, string> = { es: "AR", en: "US" };

/**
 * The question asked before EVERY draft is generated or regenerated: which language to write it in. The resolved language is
 * preselected with its reason; the BD confirms or overrides. Only the language is a control. The postal address is shown as
 * fixed (it comes from where the recipient is, CAN-SPAM), and the footer preview is built by the same buildFooter the draft
 * uses, from the same config, so it cannot drift from what is sent. A HOLD never reaches this dialog (no audience, no draft).
 * With a preferred language on the contact, THAT is the preselected "resolved" language and its reason names who set it. When the
 * selection differs from it, a checkbox offers to save the selection as the contact's preferred language (preferredCheckbox).
 */
export function LanguageChoiceDialog({ member: m, name, mode, labels: l, busy, locked, error, onCancel, onConfirm }: { member: DetailMember; name: string; mode: "generate" | "regenerate"; labels: SequenceLabels; busy: boolean; locked: boolean; error: string | null; onCancel: () => void; onConfirm: (language: AudienceLanguage, saveAsPreferred: boolean) => void }) {
  const resolved = m.audience!.audience!;
  const current = memberLanguage(m)!;
  const baseline = current.baseline;
  const preferred = m.preferredLanguage ?? null;
  const [selected, setSelected] = useState<AudienceLanguage>(current.language);
  const [saveChoice, setSaveChoice] = useState<boolean | null>(null);
  const box = preferredCheckbox(preferred?.language ?? null, baseline, selected);
  const save = box !== null && (saveChoice ?? box.checked);
  const t = l.audience;
  const lc = l.languageChoice;
  const first = m.firstName?.trim() || name;
  const word = (lang: AudienceLanguage) => (lang === "es" ? t.langEs : t.langEn);
  const other: AudienceLanguage = baseline === "es" ? "en" : "es";
  const evidence = m.audience!.reason === "posting_markets" ? (m.audience!.evidence === "latam" ? t.zoneLatam : t.zoneUs) : m.audience!.evidence ?? "";
  const footer = buildFooter(COMPLIANCE_CONFIG, resolved.address, selected, selected === "es" ? lc.linkEs : lc.linkEn);
  const footerLines = footer.status === "ok" ? footer.text.split("\n").filter(Boolean) : [];
  const option = (lang: AudienceLanguage) => (
    <label className="check"><input type="radio" name="draft-language" value={lang} checked={selected === lang} onChange={() => setSelected(lang)} />{" "}
      <span className={lang !== baseline && baseline === "en" && current.baselineSource === "audience" && selected !== lang ? "meta" : undefined}><span aria-hidden="true">{flagEmoji(FLAG[lang])}</span> {word(lang)}</span>
      {lang === baseline
        ? <span className={`badge ${selected === lang ? "badge-success" : "badge-outline"}`}>{current.baselineSource === "preferred" ? lc.badgePreferred : selected === lang && lang === "en" ? lc.badgeRecommended : lc.badgeResolved}</span>
        : selected === lang && <span className="badge badge-info">{lc.badgeChosen}</span>}
    </label>
  );
  // Same `label.check` markup as the radios above (approved mockup), built outside the Dialog JSX like them.
  const saveBox = box && (
    <div className="field"><label className="check"><input type="checkbox" checked={save} onChange={(e) => setSaveChoice(e.target.checked)} /> <span>{fill(lc.savePreferred, { name: first })}</span></label>
      <span className="help">{box.replaces && preferred ? fill(lc.savePreferredReplaces, { lang: word(preferred.language), by: preferred.byName ?? "?", when: preferred.at ? formatArgentinaDayMonth(preferred.at) : "" }) : lc.savePreferredHelp}</span></div>
  );
  return (
    <Dialog open onClose={onCancel} icon={<GenerateIcon className="icon" />} closeDisabled={busy} title={fill(mode === "generate" ? lc.title : lc.titleRegen, { name })}
      footer={<><button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>{lc.cancel}</button><button type="button" className="btn btn-primary" disabled={busy || locked} onClick={() => onConfirm(selected, save)}>{fill(mode === "generate" ? lc.confirmGenerate : lc.confirmRegenerate, { lang: word(selected) })}</button></>}>
      <div className="stack">
        {selected === baseline
          ? <div className="alert alert-success"><div><strong>{lc.okStrong}</strong> {lc.okRest}</div></div>
          : <div className="alert alert-info"><InfoIcon className="icon" /><div>{fill(lc.changingBefore, { resolved: word(baseline) })} <strong>{word(selected)}</strong>. {fill(save ? lc.changingAfterPreferred : lc.changingAfter, { name: first, chosen: word(selected) })}</div></div>}
        <fieldset className="field fieldset"><legend className="label">{lc.legend}</legend>
          <div className="stack-sm">
            {option(baseline)}
            <div className="meta">↳ {preferred && current.baselineSource === "preferred" ? fillStrong(lc.preferredReason, { name: first, by: preferred.byName ?? "?", when: preferred.at ? formatArgentinaDayMonth(preferred.at) : "" }, ["name", "by"]) : <AudienceWhy m={m} name={name} l={l} />}</div>
            {option(other)}
            {baseline === "en" && current.baselineSource === "audience" && selected === "en" && <div className="alert alert-warn" style={{ padding: "var(--space-sm) var(--space-md)" }}><WarningIcon className="icon" /><div>{fill(lc.warnEs, { name: first })}</div></div>}
          </div>
        </fieldset>
        {box && saveBox}
        <div className="field"><span className="label">{lc.addressLabel} <span className="badge badge-outline">{lc.addressFixed}</span></span>
          <div className="card"><div className="card-body stack-sm">
            <div><strong>{resolved.address === "mdp" ? t.addrMdp : t.addrMiami}</strong> <span className="meta">· {COMPLIANCE_CONFIG[resolved.address]?.postalAddress}</span></div>
            <div className="meta">{fill(lc.addressWhy, { where: evidence })}</div>
          </div></div></div>
        <div className="field"><span className="label">{lc.footerLabel}</span>
          <div className="card"><div className="card-body stack-sm">{footerLines.map((line, i) => <div key={i} className="mono">{line}</div>)}</div></div>
          <span className="help">{lc.footerHelp}</span></div>
        <p className="meta">{lc.oneAtATime}</p>
        {error && <div className="alert alert-danger" role="alert"><WarningIcon className="icon" /><div>{error}</div></div>}
      </div>
    </Dialog>
  );
}
