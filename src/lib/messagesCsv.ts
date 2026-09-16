import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { normalizeProfileKey } from "./csv";

export interface ParsedMessage {
  externalConversationId: string;
  conversationTitle: string | null;
  senderProfileKey: string | null;
  senderName: string | null;
  sentAt: Date;
  subject: string | null;
  content: string;
  folder: string | null;
  isDraft: boolean;
  contentHash: string;
}

export interface ParsedConversation {
  externalId: string;
  title: string | null;
  // Null for group threads and for threads where the counterpart never
  // resolves to a single profile URL (e.g. only InMail/company senders).
  peerProfileKey: string | null;
}

export interface ParseMessagesResult {
  conversations: ParsedConversation[];
  messages: ParsedMessage[];
  // The BD's own LinkedIn slug, either the caller-supplied override or the
  // slug detected by conversation coverage (see `detectOwnProfileKey`). Null
  // if it couldn't be determined (e.g. every row has an empty SENDER
  // PROFILE URL).
  ownProfileKey: string | null;
  // Coverage ratio (0-1) of the detected slug across all conversations in
  // the file — see `detectOwnProfileKey`. 1 when an explicit override was
  // supplied (trusted unconditionally). Null when there were no usable
  // rows/conversations to score.
  ownProfileConfidence: number | null;
  // Set when detection confidence is below the dominance threshold in
  // `detectOwnProfileKey`. Callers (UI, CLI) MUST surface this instead of
  // silently importing with a possibly-inverted own profile.
  ownProfileWarning: string | null;
  rowCount: number;
}

function blankToNull(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function isTruthyFlag(v: string | undefined): boolean {
  const t = v?.trim().toLowerCase();
  return t === "yes" || t === "true" || t === "1";
}

/** Split "RECIPIENT PROFILE URLS" (whitespace-separated) into normalized keys. */
function parseRecipientKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .map((u) => normalizeProfileKey(u))
    .filter((k): k is string => !!k);
}

/**
 * LinkedIn exports DATE as "YYYY-MM-DD HH:MM:SS UTC" — confirmed directly
 * from a real export sample, which carries a literal "UTC" suffix on every
 * row (e.g. "2026-09-14 11:31:07 UTC"). That suffix is stripped here before
 * building an ISO string, since `Date` doesn't parse "UTC" as a zone
 * designator. If a future export ever drops that suffix or uses a
 * different zone, dormancy cutoffs (see recomputeMessageSignals) and
 * same-day message ordering would silently shift by the real UTC offset.
 */
function parseUtcDate(raw: string): Date {
  const cleaned = raw.trim().replace(/\s+UTC$/i, "");
  return new Date(`${cleaned.replace(" ", "T")}Z`);
}

/**
 * sha256 of conversation id + sent time + sender + content + the message's
 * ordinal position within its conversation (in file order), matching the
 * comment on `message.contentHash` in src/db/schema.ts. The ordinal is
 * included so two genuinely repeated messages from the same sender in the
 * same thread within the same second don't collapse into one via
 * `ON CONFLICT DO NOTHING`. Tradeoff: re-importing the SAME export file
 * stays idempotent (file order is stable across runs), but merging rows
 * from a different export of the same conversation could reorder them and
 * change ordinals, breaking idempotency for that thread.
 */
function hashMessage(
  conversationId: string,
  sentAt: Date,
  senderProfileKey: string | null,
  content: string,
  ordinalInConversation: number,
): string {
  return createHash("sha256")
    .update(
      `${conversationId}|${sentAt.toISOString()}|${senderProfileKey ?? ""}|${content}|${ordinalInConversation}`,
    )
    .digest("hex");
}

/**
 * Detect the BD's own LinkedIn slug by conversation coverage rather than
 * raw message frequency: the account owner is a participant in (nearly)
 * every conversation in the export, whereas any single contact only ever
 * appears in their own thread(s). A BD who mostly receives (low send
 * frequency) is therefore still detected correctly, unlike a "most frequent
 * sender" heuristic which a heavy-sending contact could win.
 *
 * Returns `confidence` as the winner's coverage ratio (conversations
 * containing that slug / total conversations), and flags `lowConfidence`
 * when the signal isn't clearly dominant, so callers can warn instead of
 * silently trusting a possibly-wrong guess.
 *
 * Thresholds (heuristic, not proven): winner ratio >= 0.8 tolerates a
 * handful of group threads or InMail-only conversations that never carry
 * the BD's own slug in RECIPIENT PROFILE URLS; runner-up ratio <= 0.5 of
 * the winner rules out an unusually active single contact who also spans
 * many threads.
 */
function detectOwnProfileKey(
  rows: { externalConversationId: string; senderProfileKey: string | null; recipientKeys: string[] }[],
  override?: string,
): { ownProfileKey: string | null; confidence: number | null; lowConfidence: boolean } {
  if (override) {
    const normalized = normalizeProfileKey(override);
    return { ownProfileKey: normalized, confidence: normalized ? 1 : null, lowConfidence: false };
  }

  const conversationsBySlug = new Map<string, Set<string>>();
  const allConversationIds = new Set<string>();
  for (const row of rows) {
    allConversationIds.add(row.externalConversationId);
    const participants = new Set<string>();
    if (row.senderProfileKey) participants.add(row.senderProfileKey);
    for (const k of row.recipientKeys) participants.add(k);
    for (const slug of participants) {
      const set = conversationsBySlug.get(slug) ?? new Set<string>();
      set.add(row.externalConversationId);
      conversationsBySlug.set(slug, set);
    }
  }

  const totalConversations = allConversationIds.size;
  if (totalConversations === 0 || conversationsBySlug.size === 0) {
    return { ownProfileKey: null, confidence: null, lowConfidence: false };
  }

  const coverage = [...conversationsBySlug.entries()]
    .map(([slug, convs]) => ({ slug, count: convs.size }))
    .sort((a, b) => b.count - a.count);

  const winner = coverage[0];
  const runnerUp = coverage[1];
  const winnerRatio = winner.count / totalConversations;
  const runnerUpRatio = runnerUp ? runnerUp.count / winner.count : 0;
  const lowConfidence = winnerRatio < 0.8 || runnerUpRatio > 0.5;

  return { ownProfileKey: winner.slug, confidence: winnerRatio, lowConfidence };
}

/**
 * Parse a LinkedIn `messages.csv` export.
 *
 * Identity is the lowercased LinkedIn vanity slug (same normalization as
 * `contact.profile_key`, see src/lib/csv.ts#normalizeProfileKey) so parsed
 * senders/recipients join directly against existing contacts.
 *
 * Drafts (IS MESSAGE DRAFT = Yes) are parsed and returned — so re-imports
 * stay idempotent and nothing is silently dropped on the floor — but are
 * flagged via `isDraft` and MUST be excluded from every count/aggregate
 * downstream (see src/lib/queries.ts#recomputeMessageSignals): a draft was
 * never actually sent, so counting it would overstate activity and could
 * make a one-sided draft look "reciprocal".
 *
 * `ownProfileKeyOverride` lets a caller pin the BD's own slug explicitly
 * (e.g. known from BD setup); otherwise it's inferred by conversation
 * coverage (see `detectOwnProfileKey`) — the slug present in nearly every
 * conversation, since a single contact only ever appears in their own
 * thread(s). Check `ownProfileWarning` on the result before trusting the
 * import when no override was given.
 */
export function parseMessagesCsv(
  raw: string,
  opts: { ownProfileKeyOverride?: string } = {},
): ParseMessagesResult {
  const text = raw.replace(/^﻿/, ""); // strip BOM

  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];

  interface Row {
    externalConversationId: string;
    conversationTitle: string | null;
    senderProfileKey: string | null;
    senderName: string | null;
    recipientKeys: string[];
    sentAt: Date;
    subject: string | null;
    content: string;
    folder: string | null;
    isDraft: boolean;
  }

  const rows: Row[] = [];
  for (const r of records) {
    const externalConversationId = blankToNull(r["CONVERSATION ID"]);
    const dateRaw = blankToNull(r["DATE"]);
    if (!externalConversationId || !dateRaw) continue; // unusable row

    rows.push({
      externalConversationId,
      conversationTitle: blankToNull(r["CONVERSATION TITLE"]),
      senderProfileKey: normalizeProfileKey(r["SENDER PROFILE URL"] ?? ""),
      senderName: blankToNull(r["FROM"]),
      recipientKeys: parseRecipientKeys(r["RECIPIENT PROFILE URLS"]),
      sentAt: parseUtcDate(dateRaw),
      subject: blankToNull(r["SUBJECT"]),
      content: r["CONTENT"] ?? "",
      folder: blankToNull(r["FOLDER"]),
      isDraft: isTruthyFlag(r["IS MESSAGE DRAFT"]),
    });
  }

  // Detect the BD's own slug by conversation coverage (including drafts —
  // a drafted-but-unsent message still carries the BD's sender slug, so
  // it's a valid signal for identity detection even though it's excluded
  // from activity counts). See `detectOwnProfileKey` for the rationale.
  const detected = detectOwnProfileKey(rows, opts.ownProfileKeyOverride);
  const ownProfileKey = detected.ownProfileKey;
  const ownProfileConfidence = detected.confidence;
  const ownProfileWarning = detected.lowConfidence
    ? `Own-profile detection is not clearly confident (coverage ${
        ownProfileConfidence !== null ? `${Math.round(ownProfileConfidence * 100)}%` : "n/a"
      } for "${ownProfileKey ?? "(none)"}"). Sent/received counts may be inverted — verify before trusting this import, or re-run with an explicit override.`
    : null;

  // Collect every participant slug seen per conversation (senders +
  // recipients across all rows in that thread), so a peer can be resolved
  // even if a given row only carries one side of the pair.
  const participantsByConversation = new Map<string, Set<string>>();
  const titleByConversation = new Map<string, string | null>();
  for (const row of rows) {
    const set =
      participantsByConversation.get(row.externalConversationId) ?? new Set<string>();
    if (row.senderProfileKey) set.add(row.senderProfileKey);
    for (const k of row.recipientKeys) set.add(k);
    participantsByConversation.set(row.externalConversationId, set);
    if (!titleByConversation.has(row.externalConversationId)) {
      titleByConversation.set(row.externalConversationId, row.conversationTitle);
    }
  }

  const conversations: ParsedConversation[] = [];
  for (const [externalId, participants] of participantsByConversation) {
    const others = [...participants].filter((k) => k !== ownProfileKey);
    conversations.push({
      externalId,
      title: titleByConversation.get(externalId) ?? null,
      peerProfileKey: others.length === 1 ? others[0] : null,
    });
  }

  // Ordinal of each row within its conversation, in file order — see
  // `hashMessage` for why this is part of the content hash.
  const ordinalByConversation = new Map<string, number>();
  const messages: ParsedMessage[] = rows.map((row) => {
    const ordinal = ordinalByConversation.get(row.externalConversationId) ?? 0;
    ordinalByConversation.set(row.externalConversationId, ordinal + 1);
    return {
      externalConversationId: row.externalConversationId,
      conversationTitle: row.conversationTitle,
      senderProfileKey: row.senderProfileKey,
      senderName: row.senderName,
      sentAt: row.sentAt,
      subject: row.subject,
      content: row.content,
      folder: row.folder,
      isDraft: row.isDraft,
      contentHash: hashMessage(
        row.externalConversationId,
        row.sentAt,
        row.senderProfileKey,
        row.content,
        ordinal,
      ),
    };
  });

  return {
    conversations,
    messages,
    ownProfileKey,
    ownProfileConfidence,
    ownProfileWarning,
    rowCount: rows.length,
  };
}
