/**
 * Pure input builder for "Generar mensaje" on the `/contacts/[id]` record
 * page (task 13.3, PR 13c). Maps the unified `person` record — plus the
 * calling BD's own `person_bd_connection` row and any shared research
 * signals — into a `BuildOutreachMessagePromptInput` (messagePrompt.ts),
 * so the SAME prompt/generator works for ANY person, including a
 * teammate-only contact the calling BD has never messaged.
 *
 * R6 (proposal: "non-admins never see another BD's conversation content"):
 * this builder never reads or forwards message content. `history` is
 * always `[]` — the only per-BD relationship data that crosses into the
 * prompt is `connection` (counts/dates only), which comes from the
 * CALLING BD's own row, never another BD's.
 */
import type { RoleGroupKey } from "@/lib/roleGroups";
import { LEADERSHIP_ROLE_GROUPS } from "@/lib/hiring/leadership";
import type { OutreachMessageCompany, BuildOutreachMessagePromptInput } from "@/lib/outreach/messagePrompt";
import type { Locale } from "@/lib/i18n/locales";

// Same rule as isLeadershipRoleGroup (src/lib/outreach/queries.ts) —
// duplicated instead of imported so this module stays DB-free (that file
// imports `db` at module scope, which would drag a live Postgres
// connection into this pure unit-tested builder and its test file).
function isLeadershipRoleGroup(roleGroup: RoleGroupKey | null): boolean {
  return !!roleGroup && (LEADERSHIP_ROLE_GROUPS as readonly string[]).includes(roleGroup);
}

export interface PersonMessageContact {
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  roleGroup: RoleGroupKey | null;
  industry: string | null;
  companyKey: string | null;
}

/** The calling BD's own connection facts for this person — never another
 * BD's row, and never message CONTENT, only aggregate counts/dates
 * (`person_bd_connection.messageCount`/`lastMessageAt`/`reciprocal`). */
export interface PersonConnectionSummary {
  connectedOn: string | null;
  messageCount: number;
  reciprocal: boolean;
  lastMessageAt: Date | null;
}

export interface BuildPersonMessageInputArgs {
  person: PersonMessageContact;
  connection: PersonConnectionSummary | null;
  // Recent signal.data.body text for this person (any BD's research paste
  // or scrape) — shared, non-private data, distinct from message content.
  signalBodies: string[];
  company: OutreachMessageCompany | null;
  senderName: string;
  senderTitle?: string;
  locale: Locale;
}

function connectionSummaryNote(connection: PersonConnectionSummary): string {
  const parts = [
    connection.messageCount > 0
      ? `You (the sender) have exchanged ${connection.messageCount} LinkedIn message(s) with this contact`
      : "You (the sender) have not exchanged any LinkedIn messages with this contact yet",
    connection.reciprocal ? "the relationship is reciprocal" : null,
    connection.lastMessageAt ? `last contact on ${connection.lastMessageAt.toISOString().slice(0, 10)}` : null,
  ].filter((p): p is string => p !== null);
  return `${parts.join("; ")}.`;
}

export function buildPersonMessageInput(args: BuildPersonMessageInputArgs): BuildOutreachMessagePromptInput {
  const { person, connection, signalBodies, company, senderName, senderTitle, locale } = args;

  const notes = [
    ...(connection ? [connectionSummaryNote(connection)] : []),
    ...signalBodies,
  ];

  return {
    contact: {
      firstName: person.firstName,
      lastName: person.lastName,
      position: person.jobTitle,
      roleGroup: person.roleGroup,
      isLeadership: isLeadershipRoleGroup(person.roleGroup),
      connectedOn: connection?.connectedOn ?? null,
    },
    company,
    // Never another BD's message content (R6) — this builder has no path
    // to conversation content at all.
    history: [],
    notes,
    senderName,
    senderTitle,
    locale,
  };
}
