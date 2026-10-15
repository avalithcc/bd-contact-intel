// What the Lusha control on the Contact record shows, decided on the server so no client component decides what a
// reveal costs. Pure: the page reads the ledger rows and the day's spend and passes them in. Everything here is
// serialisable (it crosses to a client component); the client imports only the types.

import type { IdentityFields } from "@/lib/contacts/identityDiff";
import { isReachable } from "@/lib/sequences/rosterGuards";
import type { LushaConfigResult } from "./config";
import { isNumberFlagged } from "./parse";
import { SEARCH_COST } from "./pricing";
import { isOutcomeUnknown, resolveRevealState, type LatestRows, type RevealState } from "./revealState";

/** Shown before any search exists, labelled "~"; the real price comes from the search's own canReveal list afterwards. */
const ESTIMATED_FIELD_PRICE = { emails: 1, phones: 5 } as const;

export type LushaNote = "no_value" | "no_match" | "rejected" | "blocked" | "already_held" | "outcome_unknown" | "not_revealable" | "write_failed" | "capped" | "unconfigured";
export type LushaField = "emails" | "phones";

export interface LushaFieldView {
  /** `price` null = unpriced (unconfigured, or the free apply). */
  control: { kind: "search" | "reveal" | "research" | "apply"; price: number | null; disabled: boolean } | null;
  note: LushaNote | null;
  hint: "search" | "paid" | "paidConfirmed" | "paidAvailable" | "same" | null;
  /** The identity was already confirmed with the other field: the reveal dialog only confirms the price. */
  confirmed: boolean;
  /** `doNotCall` is present ONLY when it is true (see doNotCallOf): there is no "clear" state to draw. */
  revealed: { by: string | null; at: string | null; column: "email" | "phone" | "mobilePhone"; doNotCall?: true } | null;
  twin: { id: string; name: string } | null;
}

export interface LushaView {
  emails: LushaFieldView;
  phones: LushaFieldView;
  /** The stored match, when there is a valid one to confirm. */
  match: IdentityFields | null;
  /** The search row the stored match belongs to: a reveal is confirmed against it. */
  matchSearchId: string | null;
  /** "Company · domain" of the match, for the rejection notice. */
  matchLabel: string | null;
  crm: IdentityFields;
  companyHref: string | null;
  /** The Contact already holds a phone: Lusha may return the same number and still charge 5 credits (PR 5 review). */
  holdsPhone: boolean;
  spent: number;
  cap: number;
}

export type ViewPerson = { email: string | null; emailStatus: string; emailSource: string | null; phone: string | null; mobilePhone: string | null };

const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const identityOf = (row: { payload: unknown } | null | undefined): IdentityFields | null => {
  const id = typeof row?.payload === "object" && row.payload !== null ? (row.payload as { identity?: unknown }).identity : null;
  return typeof id === "object" && id !== null ? (id as IdentityFields) : null;
};

export function buildLushaView(i: {
  config: LushaConfigResult;
  rows: LatestRows;
  spentToday: number;
  cap: number;
  person: ViewPerson;
  crm: IdentityFields;
  companyHref: string | null;
  formatDay: (at: Date) => string;
}): LushaView | null {
  const { rows, person } = i;
  if (!i.config.ok && i.config.reason === "not_production") return null;
  const search = rows.search?.state === "settled" ? rows.search : null;
  const stored = rows.search?.outcome === "matched" ? identityOf(rows.search) : null;
  const tied = (r: LedgerRowLike) => r?.state === "settled" && !!search && r.searchId === search.id;
  const reachable = isReachable({ personId: "", email: person.email, emailStatus: person.emailStatus, emailSource: person.emailSource, mergedIntoId: null, companyKey: null, clientStatus: null });

  const fieldView = (field: LushaField): LushaFieldView => {
    const own = rows[field];
    const otherRow = rows[field === "emails" ? "phones" : "emails"];
    const confirmed = tied(otherRow) && otherRow?.outcome === "revealed";
    const out: LushaFieldView = { control: null, note: null, hint: null, confirmed, revealed: null, twin: own?.twin ?? null };
    const live = resolveRevealState(field, rows, { spentToday: i.spentToday, cap: i.cap }, i.config);

    // A paid value parked by a failed settle (state failed, payload keeps it): apply it for free, never buy it again.
    if (live.kind !== "revealed" && own?.state === "failed" && own.errorCode === "settle_failed") {
      return { ...out, twin: null, control: { kind: "apply", price: null, disabled: false }, note: "write_failed" };
    }
    if (live.kind === "revealed") {
      if (own?.errorCode === "write_failed") return { ...out, twin: null, control: { kind: "apply", price: null, disabled: false }, note: "write_failed" };
      const column = field === "emails" ? (person.emailSource === "lusha" && person.email?.trim().toLowerCase() === live.value?.trim().toLowerCase() ? "email" : null) : digits(person.phone) !== "" && digits(person.phone) === digits(live.value) ? "phone" : digits(person.mobilePhone) !== "" && digits(person.mobilePhone) === digits(live.value) ? "mobilePhone" : null;
      // `column` is non-null only while the record still holds the revealed value, so an edited number never keeps a flag that described the old one.
      const dnc = column !== null && field === "phones" && isNumberFlagged((typeof own?.payload === "object" && own.payload !== null ? (own.payload as { phones?: unknown }) : {}).phones, live.value);
      return { ...out, revealed: column ? { by: own?.actorName ?? null, at: own?.settledAt ? i.formatDay(new Date(own.settledAt)) : null, column, ...(dnc ? { doNotCall: true as const } : {}) } : null };
    }
    // Never offered: a Contact that can already be sequenced, or one with no phone column left to place a number in.
    if (field === "emails" ? reachable : !!(person.phone && person.mobilePhone)) return out;

    // A capped action keeps its priced control, disabled: describe what is open without the cap, then close it.
    const open: RevealState = live.kind === "capped" ? resolveRevealState(field, rows, { spentToday: 0, cap: Number.MAX_SAFE_INTEGER }, i.config) : live;
    const unknownOutcome = open.kind === "revealable" && isOutcomeUnknown(own);
    const control = (kind: "search" | "reveal" | "research", price: number | null) => ({ kind, price, disabled: live.kind === "capped" || !i.config.ok });
    switch (open.kind) {
      case "unconfigured":
        out.control = control("search", null);
        out.note = field === "emails" ? "unconfigured" : null;
        break;
      case "searchable":
        out.control = control("search", open.cost + ESTIMATED_FIELD_PRICE[field]);
        out.hint = "search";
        break;
      case "revealable":
        // Without a readable identity there is nothing for the BD to confirm: never offer a blind paid reveal.
        if (!unknownOutcome && !stored) {
          out.note = "not_revealable";
          break;
        }
        out.control = unknownOutcome ? control("research", SEARCH_COST) : control("reveal", open.price);
        out.note = unknownOutcome ? "outcome_unknown" : null;
        out.hint = unknownOutcome ? null : confirmed ? "paidConfirmed" : tied(otherRow) && otherRow?.outcome === "no_value" ? "paidAvailable" : "paid";
        break;
      case "rejected":
        out.control = control("research", open.retryCost);
        out.note = "rejected";
        break;
      case "unavailable":
        out.control = open.retry ? control("research", SEARCH_COST) : null;
        out.note = open.reason;
        out.hint = open.retry ? "same" : null; // a re-search with unchanged data of ours returns the same answer and loses the credit
        break;
      case "blocked":
        out.note = "blocked";
        break;
    }
    if (live.kind === "capped") {
      out.note = "capped";
      out.hint = null;
    }
    return out;
  };

  const emails = fieldView("emails");
  const phones = fieldView("phones");
  const rejected = rows.search?.outcome === "match_rejected" ? identityOf(rows.search) : null;
  const usable = [emails, phones].some((f) => f.control?.kind === "reveal");
  return {
    emails,
    phones,
    match: usable ? stored : null,
    matchSearchId: usable && stored ? (rows.search?.id ?? null) : null,
    matchLabel: rejected ? [rejected.company, rejected.domain].filter(Boolean).join(" · ") || null : null,
    crm: i.crm,
    companyHref: i.companyHref,
    holdsPhone: !!(person.phone?.trim() || person.mobilePhone?.trim()),
    spent: i.spentToday,
    cap: i.cap,
  };
}

type LedgerRowLike = LatestRows["emails"];
