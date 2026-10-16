"use client";

// The Lusha slice of one Contact property row (email or phone): the priced control, the reason or hint lines, the
// duplicate-email warning and the dialogs. It decides nothing about money: `view` was resolved on the server
// (src/lib/lusha/revealView.ts). Every spend is one explicit click on a primary button; nothing retries on its own.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/Dialog";
import { InfoIcon, LockIcon, WarningIcon } from "@/components/icons";
import { useToast } from "@/components/ToastProvider";
import { diffIdentity, type IdentityFields } from "@/lib/contacts/identityDiff";
import { contactActionErrorMessage, type ContactRecordLabels } from "@/lib/contacts/labels";
import type { LushaField, LushaNote, LushaView } from "@/lib/lusha/revealView";
import type { ContactActionErrorReason } from "../actionErrors";
import { applyStoredLushaValueAction, getLushaAccountUsageAction, rejectLushaMatchAction, revealLushaFieldAction, searchLushaContactAction } from "../lushaActions";

type Failure = { reason: ContactActionErrorReason; retryable: boolean };
type Step = { kind: "cost" } | { kind: "identity"; match: IdentityFields; price: number | null; searchId: string } | null;

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
const rich = (t: string) => t.split("**").map((s, i) => (i % 2 ? <strong key={i}>{s}</strong> : s));
const TITLE: Partial<Record<ContactActionErrorReason, keyof ContactRecordLabels>> = { lusha_cap_reached: "lushaTitleCapReached", lusha_no_credits: "lushaTitleNoCredits", lusha_rate_limited: "lushaTitleRateLimited", lusha_protected: "lushaTitleProtected" };
const DANGER: ContactActionErrorReason[] = ["lusha_no_credits", "lusha_protected", "lusha_outcome_unknown", "lusha_unreadable"];
const LushaBadge = ({ l }: { l: ContactRecordLabels }) => <span className="badge badge-outline no-dot">{l.lushaBadge}</span>;

export function LushaRow({ personId, field, column, fieldLabel, view, labels: l }: { personId: string; field: LushaField; column: "email" | "phone" | "mobilePhone"; fieldLabel: string; view: LushaView; labels: ContactRecordLabels }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const f = view[field];
  const c = f.control;
  const noun = field === "emails" ? l.lushaFieldEmail : l.lushaFieldPhone;
  const credits = (n: number) => (n === 1 ? l.lushaCreditOne : fill(l.lushaCreditMany, { n }));
  const left = Math.max(0, view.cap - view.spent);
  const remaining = left === 1 ? fill(l.lushaRemainingOne, { cap: view.cap }) : fill(l.lushaRemaining, { left, cap: view.cap });
  const close = () => {
    setStep(null);
    setError(null);
    setBalance(null); // a reopened dialog must never show the previous figure
  };

  // The free balance call, once per open identity dialog; a failure here never blocks the reveal.
  const identityOpen = step?.kind === "identity";
  useEffect(() => {
    if (!identityOpen) return;
    let live = true;
    // The usage body shape is unmeasured: show a figure only when it is internally consistent (total - used = remaining), else nothing.
    getLushaAccountUsageAction()
      .then((r) => {
        if (!live || !r.ok || !("usage" in r)) return;
        const { total, used, remaining } = r.usage;
        if (total !== null && used !== null && remaining !== null && remaining >= 0 && total - used === remaining) setBalance(remaining);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [identityOpen]);

  const noteText = (n: LushaNote): string => {
    const t: Record<LushaNote, string> = {
      no_value: fill(l.lushaNoteNoValue, { field: noun }),
      no_match: l.lushaNoteNoMatch,
      rejected: fill(l.lushaNoteRejected, { label: view.matchLabel ?? "" }),
      blocked: l.lushaNoteBlocked,
      already_held: l.lushaNoteAlreadyHeld,
      outcome_unknown: l.lushaNoteOutcomeUnknown,
      not_revealable: l.lushaNoteNotRevealable,
      write_failed: l.lushaNoteWriteFailed,
      capped: fill(l.lushaNoteCapped, { spent: view.spent, cap: view.cap }),
      unconfigured: l.lushaNoteUnconfigured,
      // As drawn: the email row says who to ask, the phone row repeats it shorter.
      not_enabled: field === "emails" ? l.lushaNoteNotEnabled : l.lushaNoteNotEnabledShort,
    };
    return t[n];
  };

  const label = !c ? "" : c.kind === "apply" ? l.lushaBtnApply : [c.kind === "search" ? fill(l.lushaBtnSearch, { field: noun }) : c.kind === "reveal" ? fill(l.lushaBtnReveal, { field: noun }) : l.lushaBtnResearch, c.price === null ? null : c.kind === "search" ? fill(l.lushaCreditApprox, { n: c.price }) : credits(c.price)].filter(Boolean).join(" · ");

  /** Runs one action: a failure keeps the dialog open with the error; success hands the result to `onOk`. */
  async function run<T extends { ok: boolean }>(action: () => Promise<T>, onOk: (r: Extract<T, { ok: true }>) => void) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await action();
      if (r.ok) onOk(r as Extract<T, { ok: true }>);
      else setError(r as unknown as Failure);
    } catch {
      // The request died after a paid action may have landed: say "unconfirmed", never invite a blind second click.
      setError({ reason: "unconfirmed", retryable: false });
    } finally {
      setBusy(false);
    }
  }

  const announce = (r: { outcome?: string; value: string | null; written: string | null; duplicate: { personId: string; name: string } | null; writeFailed?: boolean; unreadable?: boolean }, applied = false) => {
    if (r.unreadable) return showToast(l.errorLushaUnreadable, "error");
    if (r.writeFailed) return showToast(noteText("write_failed"), "error");
    if (r.outcome === "already_held") return showToast(noteText("already_held"), "error");
    if (r.outcome === "no_value") return showToast(noteText("no_value"), "error");
    if (r.duplicate) {
      const dup = r.duplicate;
      return showToast(fill(l.lushaToastDuplicate, { name: dup.name }), "success", { actionLabel: l.lushaViewContact, onAction: () => router.push(`/contacts/${dup.personId}`) });
    }
    if (!r.written && r.value) return showToast(fill(l.lushaToastNotPlaced, { value: r.value }), "error");
    showToast(applied ? l.lushaToastApplied : field === "emails" ? l.lushaToastRevealedEmail : l.lushaToastRevealedPhone, "success");
  };

  const search = () =>
    run(() => searchLushaContactAction(personId, field), (r) => {
      if (r.outcome === "matched" && r.price !== null) return setStep({ kind: "identity", match: r.identity, price: r.price, searchId: r.searchId });
      close();
      showToast(noteText(r.outcome === "matched" ? "not_revealable" : r.outcome === "no_match" ? "no_match" : "blocked"), "error");
    });
  const reveal = (s: { price: number | null; searchId: string }) =>
    run(() => revealLushaFieldAction(personId, field, { searchId: s.searchId, price: s.price ?? -1 }), (r) => (close(), announce(r)));
  const reject = () => run(() => rejectLushaMatchAction(personId), () => (close(), showToast(l.lushaToastRejected, "success")));
  const apply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await applyStoredLushaValueAction(personId, field);
      if (r.ok) announce(r, true);
      else showToast(contactActionErrorMessage(l, r.reason as ContactActionErrorReason), "error");
    } catch {
      showToast(l.errorUnconfirmed, "error");
    } finally {
      setBusy(false);
    }
  };

  const onControl = () => {
    if (c?.kind === "apply") return apply();
    if (c?.kind !== "reveal") return setStep({ kind: "cost" });
    // Never open a paid reveal over a blank identity: the view only offers it with a readable match and its search id.
    if (view.match && view.matchSearchId) setStep({ kind: "identity", match: view.match, price: c.price, searchId: view.matchSearchId });
  };
  const title = (t: string) => (
    <>
      {t} <LushaBadge l={l} />
    </>
  );

  const alert = (e: Failure) => {
    const tk = TITLE[e.reason];
    const body = fill(contactActionErrorMessage(l, e.reason), { spent: view.spent, cap: view.cap });
    return (
      <div className={`alert ${DANGER.includes(e.reason) ? "alert-danger" : "alert-warn"}`} role="alert">
        {e.reason === "lusha_protected" ? <LockIcon className="icon" /> : <WarningIcon className="icon" />}
        <div>
          {tk && <div className="title">{l[tk] as string}</div>}
          {body}
        </div>
      </div>
    );
  };

  const fieldPrice = c?.kind === "search" && c.price !== null ? c.price - 1 : (c?.price ?? 0);
  // The 5-credit phone reveal can come back as a number the Contact already has: the human decides, but not blindly.
  const held = (amount: string) => field === "phones" && view.holdsPhone && (
    <div className="alert alert-warn" role="note">
      <WarningIcon className="icon" />
      <div>
        <div className="title">{l.lushaHeldTitle}</div>
        {fill(l.lushaHeldBody, { credits: amount })}
      </div>
    </div>
  );
  const costDialog = step?.kind === "cost" && c && (
    <Dialog
      open
      onClose={close}
      closeDisabled={busy}
      title={title(c.kind === "research" ? l.lushaDlgResearchTitle : fill(l.lushaDlgSearchTitle, { field: noun }))}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
            {error ? l.lushaClose : l.cancel}
          </button>
          {(!error || error.retryable) && (
            <button type="button" className="btn btn-primary" onClick={search} disabled={busy}>
              {fill(error ? l.lushaConfirmRetry : c.kind === "research" ? l.lushaConfirmResearch : l.lushaConfirmSearch, { credits: l.lushaCreditOne })}
            </button>
          )}
        </>
      }
    >
      {error ? (
        alert(error)
      ) : c.kind === "research" ? (
        <>
          <p>{rich(view.matchLabel ? fill(l.lushaResearchRejected, { name: view.matchLabel.split(" · ")[0] }) : l.lushaResearchGeneric)}</p>
          <table className="data compact">
            <thead>
              <tr><th>{l.lushaColConcept}</th><th className="right">{l.lushaColCredits}</th><th>{l.lushaColWhen}</th></tr>
            </thead>
            <tbody>
              <tr><td>{l.lushaRowResearch}</td><td className="right">1</td><td>{l.lushaWhenResearch}</td></tr>
              <tr><td>{l.lushaRowEither}</td><td className="right">~1 / ~5</td><td>{l.lushaWhenEither}</td></tr>
            </tbody>
          </table>
          {view.matchLabel && view.crm.domain && view.companyHref && (
            <p className="meta">{l.lushaDomainTip.replace("{domain}", view.crm.domain)} <Link href={view.companyHref}>{l.lushaOpenCompany}</Link>.</p>
          )}
        </>
      ) : (
        <>
          <p>{rich(l.lushaDlgIntro)}</p>
          {held(fill(l.lushaCreditApprox, { n: fieldPrice }))}
          <table className="data compact">
            <thead>
              <tr><th>{l.lushaColConcept}</th><th className="right">{l.lushaColCredits}</th><th>{l.lushaColWhen}</th></tr>
            </thead>
            <tbody>
              <tr><td>{l.lushaRowSearch}</td><td className="right">1</td><td>{l.lushaWhenSearch}</td></tr>
              <tr><td>{fieldLabel}</td><td className="right">{fieldPrice}</td><td>{l.lushaWhenField}</td></tr>
              <tr><td><strong>{l.lushaRowTotal}</strong></td><td className="right"><strong>{fill(l.lushaUpTo, { n: c.price ?? 0 })}</strong></td><td></td></tr>
            </tbody>
          </table>
        </>
      )}
      <p className="meta">{remaining}</p>
    </Dialog>
  );

  const identity = step?.kind === "identity" ? step : null;
  const price = identity?.price ?? c?.price ?? 0;
  const identityDialog = identity && (
    <Dialog
      open
      wide
      onClose={close}
      closeDisabled={busy}
      title={title(error || f.confirmed ? fill(l.lushaDlgRevealTitle, { field: noun }) : l.lushaDlgIdentityTitle)}
      footer={
        error ? (
          <button type="button" className="btn btn-secondary" onClick={close}>{l.lushaClose}</button>
        ) : (
          <>
            <button type="button" className={`btn ${f.confirmed ? "btn-secondary" : "btn-ghost left"}`} onClick={close} disabled={busy}>{l.cancel}</button>
            {!f.confirmed && <button type="button" className="btn btn-secondary" onClick={reject} disabled={busy}>{l.lushaNotMine}</button>}
            <button type="button" className="btn btn-primary" onClick={() => reveal(identity)} disabled={busy}>{fill(l.lushaConfirmReveal, { field: noun, credits: credits(price) })}</button>
          </>
        )
      }
    >
      {error ? (
        alert(error)
      ) : (
        <>
          {f.confirmed ? (
            <p>{l.lushaConfirmedIntro}</p>
          ) : (
            <div className="alert alert-warn" role="note">
              <WarningIcon className="icon" />
              <div>
                <div className="title">{fill(l.lushaReviewTitle, { credits: credits(price) })}</div>
                {fill(l.lushaReviewBody, { field: noun })}
              </div>
            </div>
          )}
          <table className="data compact">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">{l.lushaColData}</span></th>
                <th scope="col">{l.lushaColCrm}</th>
                <th scope="col">{f.confirmed ? l.lushaColLushaConfirmed : l.lushaColLusha}</th>
                <th scope="col">{l.lushaColCompare}</th>
              </tr>
            </thead>
            <tbody>
              {diffIdentity(view.crm, identity.match).map((row) => {
                const mono = row.key === "domain" || row.key === "linkedin" ? "mono" : undefined;
                const cell = (v: string | null) => (row.key === "linkedin" && v ? <a href={/^https?:\/\//i.test(v) ? v : `https://${v}`} target="_blank" rel="noreferrer">{v}</a> : (v ?? l.emptyValue));
                const rowLabel = { name: l.lushaRowName, company: l.lushaRowCompany, domain: l.lushaRowDomain, linkedin: l.linkedInBadge }[row.key];
                return (
                  <tr key={row.key}>
                    <th scope="row">{rowLabel}</th>
                    <td className={mono}>{cell(row.crm)}</td>
                    <td className={mono}>{cell(row.lusha)}</td>
                    <td>{row.same ? <span className="meta">{l.lushaSame}</span> : <span className="badge badge-neutral no-dot">{l.lushaDifferent}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {held(credits(price))}
          <div>
            <p>{rich(fill(l.lushaRevealCost, { field: noun, credits: credits(price) }))}</p>
            <p className="meta mt-md">
              {remaining}
              {balance !== null && (
                <>
                  <br />
                  {fill(l.lushaBalance, { n: balance })}
                </>
              )}
            </p>
          </div>
        </>
      )}
    </Dialog>
  );

  const revealed = f.revealed?.column === column ? f.revealed : null;
  const dupName = f.twin?.name ?? "";
  const [dupBefore, dupAfter] = l.lushaDuplicateWhy.split("{name}");
  const isOwnRow = column !== "mobilePhone";
  // The mockup draws the disabled control first and its reason under it (states 7, 10); every other reason sits above the control.
  const noteLast = f.note === "capped" || f.note === "unconfigured";
  const notice = f.note && (
    <div className="locked">
      <LockIcon className="icon" />
      <span>{noteText(f.note)}</span>
    </div>
  );
  return (
    <>
      {isOwnRow && !noteLast && notice}
      {isOwnRow && c && (
        <dd className="row">
          <button type="button" className="btn btn-secondary btn-sm" disabled={c.disabled} title={c.disabled ? (f.note === "capped" ? l.lushaTitleCap : l.lushaTitleUnconfigured) : undefined} onClick={onControl}>
            <LushaBadge l={l} />
            {label}
          </button>
        </dd>
      )}
      {isOwnRow && noteLast && notice}
      {isOwnRow && f.hint && <dd className="hint">{f.hint === "search" ? fill(l.lushaHintSearch, { n: fieldPrice, field: noun }) : { paid: l.lushaHintPaid, paidConfirmed: l.lushaHintPaidConfirmed, paidAvailable: l.lushaHintPaidAvailable, same: l.lushaHintSame }[f.hint]}</dd>}
      {revealed?.by && revealed.at && <dd className="hint">{fill(l.lushaRevealedHint, { name: revealed.by, date: revealed.at })}</dd>}
      {revealed && column === "email" && f.twin && (
        <dd className="why">
          <span>
            <InfoIcon className="icon" /> {dupBefore}
            <Link href={`/contacts/${f.twin.id}`}>{dupName}</Link>
            {dupAfter}
          </span>
        </dd>
      )}
      {costDialog}
      {identityDialog}
    </>
  );
}

export const lushaBadgeFor = (view: LushaView | null, key: string) => !!view && (key === "email" ? view.emails.revealed?.column === "email" : (key === "phone" || key === "mobilePhone") && view.phones.revealed?.column === key);
/**
 * Drawn ONLY when Lusha flagged the number (`doNotCall: true`). Never render anything for false or missing: Lusha checks the
 * UK and US registries only, so "not flagged" over an Argentine number would read as "safe to call", which nobody can say.
 * Same badge class as the Lusha badge; the country scope lives in the tooltip.
 */
/** Same shape as lushaBadgeFor: the flag counts only for the column that still holds the revealed number (the view already enforces it). */
export const doNotCallFor = (view: LushaView | null, key: string) => !!view && (key === "phone" || key === "mobilePhone") && view.phones.revealed?.column === key && view.phones.revealed.doNotCall === true;

export const DoNotCallBadge = ({ l }: { l: ContactRecordLabels }) => (
  <span className="badge badge-outline no-dot" title={l.lushaDncTitle}>
    {l.lushaDncBadge}
  </span>
);
export { LushaBadge };
