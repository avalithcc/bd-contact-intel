/**
 * Which screens a live change message (emitted by the crm_notify_change() trigger, drizzle/0056_crm_live_updates.sql)
 * should refresh. Pure: the client component only feeds it the message and the current pathname. A message carries ids
 * only, never row data: `{kind: <table>, op, ids: {personId?, companyKey?, ...}}` or, for a statement that touched more
 * than 50 distinct ids, `{kind, op, bulk: true, count}`.
 */

export type IdKey = "personId" | "companyKey" | "sequenceId" | "meetingId" | "taskId" | "scheduledEmailId";
const ID_KEYS: readonly IdKey[] = ["personId", "companyKey", "sequenceId", "meetingId", "taskId", "scheduledEmailId"];

export interface LiveChange {
  kind: string;
  op: string;
  ids: Partial<Record<IdKey, string[]>>;
  /** True when the statement touched too many ids to list: nothing can be narrowed. */
  bulk: boolean;
}

/** Validates the broadcast payload; anything that does not look like ours is dropped. */
export function parseChange(raw: unknown): LiveChange | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== "string" || typeof r.op !== "string") return null;
  const ids: Partial<Record<IdKey, string[]>> = {};
  if (r.ids !== undefined) {
    if (typeof r.ids !== "object" || r.ids === null) return null;
    const given = r.ids as Record<string, unknown>;
    for (const key of ID_KEYS) {
      const value = given[key];
      if (value === undefined) continue;
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return null;
      ids[key] = value as string[];
    }
  }
  return { kind: r.kind, op: r.op, ids, bulk: r.bulk === true };
}

interface Feed {
  kinds: ReadonlySet<string>;
  /** The record the screen shows, when it shows one: a message about another record is not relevant. */
  scope?: { key: IdKey; value: string };
}

const set = (...kinds: string[]): ReadonlySet<string> => new Set(kinds);
const SEQUENCE_KINDS = ["sequence", "sequence_member", "sequence_draft"];

const segment = (raw: string | undefined): string | null => {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
};

function feedFor(pathname: string): Feed | null {
  const [a, b, c] = pathname.split("/").filter(Boolean);
  if (a === "contacts") {
    if (!b) return { kinds: set("person", "activity", "company", "task") };
    const id = segment(b);
    // /contacts/import and /contacts/export are not records.
    return id && b !== "import" && b !== "export" && !c
      ? { kinds: set("activity", "task", "meeting", "scheduled_email", "sequence_member", "sequence_draft", "person"), scope: { key: "personId", value: id } }
      : null;
  }
  if (a === "companies") {
    if (!b) return { kinds: set("company", "person") };
    const key = segment(b);
    return key && b !== "new" ? { kinds: set("activity", "task", "person", "company"), scope: { key: "companyKey", value: key } } : null;
  }
  if (a === "sequences") {
    if (!b) return { kinds: set(...SEQUENCE_KINDS) };
    const id = segment(b);
    return id && b !== "new" ? { kinds: set(...SEQUENCE_KINDS), scope: { key: "sequenceId", value: id } } : null;
  }
  if (a === "admin") {
    if (b === "reports") return { kinds: set("activity", "meeting", "task", "scheduled_email", "person", "company", "sequence_member") };
    if (b === "gmail") return { kinds: set("email_account", "scheduled_email", "activity") };
    return null;
  }
  if (a === "follow-ups") return { kinds: set("follow_up_queue_item", "activity", "task", "person") };
  if (a === "tasks") return { kinds: set("task") };
  if (a === "reuniones") return { kinds: set("meeting") };
  if (a === "scheduled") return { kinds: set("scheduled_email") };
  return null;
}

export function isRelevant(change: LiveChange, pathname: string): boolean {
  const feed = feedFor(pathname);
  if (!feed || !feed.kinds.has(change.kind)) return false;
  if (!feed.scope || change.bulk) return true;
  return change.ids[feed.scope.key]?.includes(feed.scope.value) ?? false;
}

/** Quiet period before a refresh. The reports screen is heavy, so it coalesces a longer burst of activity. */
export function debounceMsFor(pathname: string): number {
  return pathname.startsWith("/admin/reports") ? 5_000 : 400;
}
