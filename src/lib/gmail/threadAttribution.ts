// Attributes a reply from an address we do not hold to the person we wrote to in the same
// thread. Pure planner + a thin orchestrator that takes the DB read as a port (the convention
// of src/lib/lusha/revealPlan.ts): the planner does no IO, never mutates its inputs, and is
// what the unit tests exercise. The DB read is getOutboundThreadRefs in syncQueries.ts.
//
// Why it exists: classify.ts matches an inbound message on its From address only, so a reply
// from a mailbox we never held was dropped without a trace. A human reads "answered in the
// thread I wrote to Jonathan" as Jonathan, and so do we, but ONLY when that reading is
// unambiguous. A wrong attribution is worse than a missing one (scripts/cleanup-misattributed-
// inbound.ts exists because To/Cc matching once got this wrong), so every rule below refuses
// rather than guesses.
//
// Out of scope on purpose: this never promotes email_status, never writes person.email and
// never records an alias. The address the reply came from is kept only on the message row.
import { isNeverLogged, type ClassifiedMessage, type ClassifiedMatch, type NeverLogRule } from "./classify";

/** One outbound message of ours, with the persons it is attributed to (email_message_person). */
export interface OutboundThreadRef {
  gmailThreadId: string;
  rfcMessageId: string | null;
  sentAt: Date;
  personIds: readonly string[];
  /** The addresses we wrote to (email_message_person.matched_email); checked against never-log. */
  matchedEmails: readonly string[];
}

export interface AttributionContext {
  bdEmail: string;
  /** Every connected email_account address (all BDs): any of them answering is us, not a contact. */
  ownAddresses: readonly string[];
  neverLogRules: readonly NeverLogRule[];
}

export interface ThreadAttributionPorts {
  getOutboundThreadRefs: ThreadRefLookup;
  getOwnMailboxAddresses(): Promise<string[]>;
}

export interface ThreadRefQuery {
  threadIds: string[];
  rfcMessageIds: string[];
}

export type ThreadRefLookup = (query: ThreadRefQuery) => Promise<OutboundThreadRef[]>;

/** Closest ancestors only: a long chain adds lookups, not certainty. */
const MAX_REFERENCED_IDS = 10;

// Secondary net behind the protocol signals (automatedMessage.ts): role senders that answer in a
// thread without being the person we wrote to. Includes VERP bounces (bounces-123@, bounce_x@)
// and Exchange / Office 365 NDR mailboxes (MicrosoftExchange329e...@tenant).
const AUTOMATED_LOCAL_PART = /^(mailer-daemon|postmaster|bounces?([-_.].*)?|no[-_.]?reply|do[-_.]?not[-_.]?reply|microsoftexchange[0-9a-f]+)$/;
const PUBLIC_MAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"]);

function domainOf(address: string): string {
  return address.split("@")[1] ?? "";
}

// Domains that mean "us". For a BD on a public mailbox (gmail.com) no domain can be used, so a
// teammate writing from a public address cannot be told apart from a contact: unavoidable, and
// the reason the connected-address list is checked first. A Workspace ALIAS domain that is not
// a connected address is likewise unknowable here.
function ownDomains(ctx: AttributionContext): Set<string> {
  const all = [ctx.bdEmail, ...ctx.ownAddresses].map((a) => domainOf(a.trim().toLowerCase()));
  return new Set(all.filter((d) => d !== "" && !PUBLIC_MAIL_DOMAINS.has(d)));
}

function isCandidate(m: ClassifiedMessage, ctx: AttributionContext, own: ReadonlySet<string>): boolean {
  if (m.direction !== "inbound" || m.matches.length > 0 || m.neverLogged === true || m.automated === true || m.fromAddress === "") return false;
  // Fail closed: without a usable BD address we cannot tell whose mailbox this is.
  if (domainOf(ctx.bdEmail) === "") return false;
  const localPart = (m.fromAddress.split("@")[0] ?? "").split("+")[0]!;
  if (AUTOMATED_LOCAL_PART.test(localPart)) return false;
  if (ctx.ownAddresses.some((a) => a.trim().toLowerCase() === m.fromAddress)) return false;
  // A teammate answering inside a thread we wrote to a contact is not the contact.
  return !own.has(domainOf(m.fromAddress));
}

/** Message-IDs this message answers, closest ancestor first, deduped, capped. */
export function referencedMessageIds(m: Pick<ClassifiedMessage, "inReplyTo" | "references">): string[] {
  const chain = `${m.references ?? ""} ${m.inReplyTo ?? ""}`.match(/<[^<>\s]+>/g) ?? [];
  const out: string[] = [];
  for (let i = chain.length - 1; i >= 0 && out.length < MAX_REFERENCED_IDS; i--) {
    if (!out.includes(chain[i]!)) out.push(chain[i]!);
  }
  return out;
}

/** Outbound mail from earlier in the same batch: its reply can arrive before it is stored. */
function batchRefs(classified: readonly ClassifiedMessage[]): OutboundThreadRef[] {
  return classified
    .filter((m) => m.direction === "outbound" && m.matches.length > 0)
    .map((m) => ({ gmailThreadId: m.gmailThreadId, rfcMessageId: m.rfcMessageId, sentAt: m.sentAt, personIds: m.matches.map((x) => x.personId), matchedEmails: m.matches.map((x) => x.matchedEmail) }));
}

/** The one index over refs; both lookups below read through it. */
function indexRefs(refs: readonly OutboundThreadRef[]) {
  const byThread = new Map<string, OutboundThreadRef[]>();
  const byRfc = new Map<string, OutboundThreadRef[]>();
  const push = (map: Map<string, OutboundThreadRef[]>, key: string, r: OutboundThreadRef) => map.set(key, [...(map.get(key) ?? []), r]);
  for (const r of refs) {
    push(byThread, r.gmailThreadId, r);
    if (r.rfcMessageId) push(byRfc, r.rfcMessageId, r);
  }
  return { byThread, byRfc };
}

const answered = (rs: readonly OutboundThreadRef[] | undefined, m: ClassifiedMessage) => (rs ?? []).filter((r) => r.sentAt.getTime() <= m.sentAt.getTime());

/** Thread first; the header chain only when NO outbound of ours shares the thread. */
function outboundAnswered(m: ClassifiedMessage, idx: ReturnType<typeof indexRefs>): OutboundThreadRef[] {
  const inThread = answered(idx.byThread.get(m.gmailThreadId), m);
  if (inThread.length > 0) return inThread;
  return referencedMessageIds(m).flatMap((id) => answered(idx.byRfc.get(id), m));
}

/** First-pass keys: the threads of every unmatched inbound candidate. */
export function threadLookupKeys(classified: readonly ClassifiedMessage[], ctx: AttributionContext): ThreadRefQuery {
  const own = ownDomains(ctx);
  return { threadIds: [...new Set(classified.filter((m) => isCandidate(m, ctx, own)).map((m) => m.gmailThreadId))], rfcMessageIds: [] };
}

/**
 * Attributes each unmatched inbound candidate to the single person our outbound mail in its
 * thread went to. Returns a new array (changed messages are copies); inputs are untouched.
 */
export function planThreadAttribution(classified: readonly ClassifiedMessage[], refs: readonly OutboundThreadRef[], ctx: AttributionContext): ClassifiedMessage[] {
  const idx = indexRefs([...refs, ...batchRefs(classified)]);
  const own = ownDomains(ctx);
  return classified.map((m) => {
    if (!isCandidate(m, ctx, own)) return m;
    const used = outboundAnswered(m, idx);
    const personIds = new Set(used.flatMap((r) => r.personIds));
    // Two of our contacts in one thread (or one chain) is ambiguous: any pick could be wrong,
    // and a wrong attribution is worse than a missing one.
    if (personIds.size !== 1) return m;
    // Never-log gap, closed on purpose: classify checks the rules only against this message's own
    // From/To/Cc, so a rule added AFTER we wrote to a contact would not see a reply from another
    // address. The addresses we wrote to in this thread are checked here too.
    if (used.some((r) => r.matchedEmails.some((e) => isNeverLogged(e, ctx.neverLogRules)))) return m;
    const match: ClassifiedMatch = { personId: [...personIds][0]!, matchedEmail: m.fromAddress, matchConfidence: "thread" };
    return { ...m, matches: [match] };
  });
}

/**
 * Thread lookup for every candidate, then one header lookup for those whose thread held no
 * outbound of ours. Attribution is an addition to the address match, never a requirement of the
 * sync: if the DB reads fail (a statement timeout on the header leg, say), fall back to the
 * address-only result rather than throw, because a throw here would stop the history cursor
 * advancing and wedge the sync for every BD.
 */
export async function attributeUnmatchedByThread(classified: readonly ClassifiedMessage[], base: Omit<AttributionContext, "ownAddresses">, ports: ThreadAttributionPorts): Promise<ClassifiedMessage[]> {
  try {
    // Cheap pre-check with no own addresses: skips both reads when nothing could be a candidate.
    if (threadLookupKeys(classified, { ...base, ownAddresses: [] }).threadIds.length === 0) return [...classified];
    const ctx: AttributionContext = { ...base, ownAddresses: await ports.getOwnMailboxAddresses() };
    const keys = threadLookupKeys(classified, ctx);
    if (keys.threadIds.length === 0) return [...classified];
    const threadRefs = await ports.getOutboundThreadRefs(keys);
    const idx = indexRefs([...threadRefs, ...batchRefs(classified)]);
    const own = ownDomains(ctx);
    const rfcMessageIds = [
      ...new Set(classified.filter((m) => isCandidate(m, ctx, own) && answered(idx.byThread.get(m.gmailThreadId), m).length === 0).flatMap(referencedMessageIds)),
    ];
    const headerRefs = rfcMessageIds.length > 0 ? await ports.getOutboundThreadRefs({ threadIds: [], rfcMessageIds }) : [];
    return planThreadAttribution(classified, [...threadRefs, ...headerRefs], ctx);
  } catch (error) {
    console.error("[gmail] thread attribution failed; storing address matches only:", error instanceof Error ? error.message : error);
    return [...classified];
  }
}
