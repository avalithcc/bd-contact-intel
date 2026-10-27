import { GenerateIcon, WarningIcon } from "@/components/icons";
import { memberLanguage, preferredStamp } from "@/lib/sequences/audienceCard";
import type { DetailMember } from "@/lib/sequences/detailQueries";
import { fillStrong } from "@/lib/sequences/fillStrong";
import type { LanguageMismatch } from "@/lib/sequences/languageMismatch";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import { AudienceWhy } from "./AudienceBlock";

/** The word for a language, in the dictionary's own words (audience.langEs / langEn). */
export const languageWord = (language: "es" | "en", l: SequenceLabels) => (language === "es" ? l.audience.langEs : l.audience.langEn);

/** Why we would write in the language of today: the same fragments the card's "↳" line uses, so the two cannot disagree. */
function Reason({ m, name, l }: { m: DetailMember; name: string; l: SequenceLabels }) {
  const current = memberLanguage(m);
  if (current?.source === "chosen") return <>{l.languageChoice.chosenBadge}</>;
  if (current?.source === "preferred" && m.preferredLanguage) {
    const stamp = preferredStamp(m.preferredLanguage);
    return <>{fillStrong(l.audience.preferredBy, { name: m.firstName?.trim() || name }, ["name"])}{stamp && <> {fillStrong(l.languageChoice.preferredStamp, stamp, ["by"])}</>}</>;
  }
  return <AudienceWhy m={m} name={name} l={l} />;
}

/**
 * The two exits of an unapproved draft in another language (no "Aprobar igual"): regenerate, which opens the language dialog with the
 * language of today chosen, or keep it, which records the draft's language as this member's one-off choice. `onRegenerate` / `onKeep`
 * are absent for a read-only viewer: the alert still says why the draft cannot be approved. `explain` adds what each button does (the review dialog).
 */
export function LanguageMismatchAlert({ m, mismatch, name, l, ownView, explain = false, busy = false, locked = false, lockTitle, onRegenerate, onKeep }: { m: DetailMember; mismatch: LanguageMismatch; name: string; l: SequenceLabels; ownView: boolean; explain?: boolean; busy?: boolean; locked?: boolean; lockTitle?: string; onRegenerate?: () => void; onKeep?: () => void }) {
  const t = l.languageMismatch;
  const vars = { draft: languageWord(mismatch.draft, l), now: languageWord(mismatch.now, l) };
  const reason = <Reason m={m} name={name} l={l} />;
  const edited = m.draft?.edited && ownView && <><br /><strong>{t.editedStrong}</strong> {fill(t.editedRest, vars)}</>;
  const regenerate = onRegenerate && <button type="button" className="btn btn-secondary btn-sm" disabled={busy || locked} title={lockTitle} onClick={onRegenerate}>{explain && <GenerateIcon className="icon" />}{fill(t.regenerate, vars)}</button>;
  const keep = onKeep && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onKeep}>{fill(t.keep, vars)}</button>;
  if (!explain) {
    // The card: one sentence, the reason in parentheses, the two buttons at the right (mockup A1 to A3).
    return (
      <div className="alert alert-warn" role="note" style={{ padding: "var(--space-sm) var(--space-md)" }}>
        <WarningIcon className="icon" />
        <div className="grow"><strong>{fill(t.lead, vars)}</strong> ({reason}). {t.blocked}{edited}</div>
        {(regenerate || keep) && <div className="row" style={{ gap: ".25rem", flex: "none" }}>{regenerate}{keep}</div>}
      </div>
    );
  }
  // The review dialog (mockup B1): the lead and the reason, the buttons BELOW them, then what each button does. `role="alert"` only here.
  const [bodyBefore = "", bodyAfter = ""] = t.dialogBody.split("{reason}");
  return (
    <div className="alert alert-warn" role="alert">
      <WarningIcon className="icon" />
      <div className="grow">
        <strong>{fill(t.dialogLead, vars)}</strong> {fillStrong(bodyBefore, vars, ["now"])}{reason}{fillStrong(bodyAfter, vars, ["now"])}{edited}
        {(regenerate || keep) && <div className="row wrap mt-md" style={{ gap: "var(--space-sm)" }}>{regenerate}{keep}</div>}
        <p className="mt-md" style={{ marginBottom: 0 }}>{fillStrong(t.dialogHowRegenerate, { ...vars, verb: t.verbRegenerate }, ["verb"])} {fillStrong(t.dialogHowKeep, { ...vars, verb: t.verbKeep }, ["verb"])}</p>
      </div>
    </div>
  );
}
