/**
 * What the roster picker on the "Nueva secuencia" form shows. Pure: the rules are the existing ones (the seed
 * admission and `COMPANY_MEMBER_LIMIT`), this only turns them into rows and counters.
 *
 * Every counter (chosen, companies, per-company quota) comes from the SELECTION, a map of the contacts chosen, never
 * from the rows on screen: a search or the Florida filter changes which rows are shown, not what was chosen, and a
 * chosen contact stays counted even when the loaded list no longer contains it.
 *
 * The spec says contacts that cannot be added are "not offered". The owner approved showing them last, dimmed, with the
 * reason, because hiding them leaves the BD guessing why someone is missing. The company limit is the one reason that
 * depends on the selection, so it is derived here and a blocked contact is released as soon as a slot frees up.
 */
import { COMPANY_MEMBER_LIMIT } from "./rosterGuards";
import { resolveSeedRoster, type SeedCandidate, type SeedGuards, type SeedRejection } from "./seedRoster";
import type { LeadStatusKey } from "@/lib/leads/types";

export type BlockKind = "client" | "clientFormer" | "suppressed" | "member" | "merged" | "noEmail" | "unreachable" | "inferred" | "noPosting" | "companyLimit";
export type EmailBadge = "verified" | "probable" | "inferred" | "none";

export type PickerContact = {
  personId: string;
  name: string;
  jobTitle: string | null;
  status: LeadStatusKey;
  company: string | null;
  companyKey: string | null;
  florida: boolean;
  openIt: number;
  email: string | null;
  emailStatus: string;
  emailSource: string | null;
  /** Why this contact cannot be added, decided by the server read with `staticBlock`; the company limit is not here. */
  block: BlockKind | null;
  /** The Sequence a `member` is already in. */
  blockDetail: string | null;
  /** The current record of a `merged` contact. */
  survivorId: string | null;
};

export type Selection = ReadonlyMap<string, PickerContact>;
export type PickerFilter = { search: string; florida: boolean; showBlocked: boolean };
export type PickerRow = { contact: PickerContact; kind: "selected" | "available" | "blocked"; block: BlockKind | null; inCompany: number; limitNames: string[] };

const KIND: Record<SeedRejection, BlockKind> = {
  already_member: "member", merged: "merged", no_email: "noEmail", unreachable: "unreachable",
  no_open_posting: "noPosting", client: "client", suppressed: "suppressed", company_limit: "companyLimit",
};

/** The static reason a contact cannot be added (null when it can): the seed admission, with the two reasons the picker words twice split. */
export function staticBlock(c: SeedCandidate, guards: SeedGuards): BlockKind | null {
  const reason = resolveSeedRoster([c], guards).rejected[0]?.reason;
  if (!reason) return null;
  if (reason === "client" && c.clientStatus === "inactive") return "clientFormer";
  if (reason === "unreachable" && c.emailStatus !== "none" && c.emailSource === "pattern_inferred") return "inferred";
  return KIND[reason];
}

export function emailBadge(status: string, source: string | null, email: string | null): EmailBadge | null {
  if (!email?.trim()) return null;
  if (status === "none") return "none";
  if (source === "pattern_inferred" && status !== "verified") return "inferred";
  return status === "verified" ? "verified" : "probable";
}

const groupKey = (c: PickerContact) => c.companyKey ?? `person:${c.personId}`;

function chosenIn(selection: Selection, c: PickerContact): PickerContact[] {
  return c.companyKey ? [...selection.values()].filter((s) => s.companyKey === c.companyKey) : [];
}

/** The one place the chosen / companies / full-quota counters are computed, so the picker and the form's header cannot disagree. */
export function selectionSummary(selection: Selection) {
  const perCompany = new Map<string, PickerContact[]>();
  for (const c of selection.values()) perCompany.set(groupKey(c), [...(perCompany.get(groupKey(c)) ?? []), c]);
  const full = [...perCompany.values()].filter((g) => g.length >= COMPANY_MEMBER_LIMIT).map((g) => ({ company: g[0].company ?? g[0].name, count: g.length }));
  return { selectedCount: selection.size, companyCount: perCompany.size, full };
}

export function pickerView(contacts: readonly PickerContact[], selection: Selection, filter: PickerFilter) {
  const term = filter.search.trim().toLowerCase();
  const matches = (c: PickerContact) =>
    (!filter.florida || c.florida) && (!term || [c.name, c.company ?? "", c.email ?? ""].some((s) => s.toLowerCase().includes(term)));
  const build = (c: PickerContact): PickerRow => {
    const chosen = chosenIn(selection, c);
    const picked = selection.has(c.personId);
    const limited = !picked && chosen.length >= COMPANY_MEMBER_LIMIT;
    const block = c.block ?? (limited ? "companyLimit" : null);
    return { contact: c, kind: picked ? "selected" : block ? "blocked" : "available", block, inCompany: chosen.length, limitNames: limited ? chosen.map((s) => s.name) : [] };
  };
  const rows = contacts.filter(matches).map(build);
  const open = rows.filter((r) => r.kind !== "blocked");
  const blocked = rows.filter((r) => r.kind === "blocked");
  const shown = filter.showBlocked ? [...open, ...blocked] : open;

  return { rows: shown, ...selectionSummary(selection), availableShown: open.length, blockedShown: shown.length - open.length, blockedMatching: blocked.length };
}

/** Adds or removes one contact. An add that a block or the company limit refuses returns the SAME map, so callers can tell. */
export function toggleOne(selection: Selection, c: PickerContact): Selection {
  if (selection.has(c.personId)) {
    const next = new Map(selection);
    next.delete(c.personId);
    return next;
  }
  if (c.block || chosenIn(selection, c).length >= COMPANY_MEMBER_LIMIT) return selection;
  return new Map(selection).set(c.personId, c);
}

/** The header checkbox: choose every available row in view (in order, within the company limit), or clear the ones in view. */
export function toggleAllVisible(selection: Selection, rows: readonly PickerRow[]): Selection {
  const open = rows.filter((r) => r.kind !== "blocked");
  if (open.length > 0 && open.every((r) => r.kind === "selected")) {
    const next = new Map(selection);
    for (const r of open) next.delete(r.contact.personId);
    return next;
  }
  // A contact the limit stops is not dropped silently: it stays unchosen and the next render shows it as blocked.
  return open.filter((r) => r.kind === "available").reduce((acc, r) => toggleOne(acc, r.contact), selection);
}
