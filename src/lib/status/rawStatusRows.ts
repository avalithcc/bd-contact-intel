import { parseDbTimestamp } from "../db/timestamp";
import type { ActivityRowForStatus, ConnectionRowForStatus } from "./deriveStatus";

export interface RawActivityRow {
  id: string;
  type: string;
  created_at: string | Date;
  metadata: unknown;
  person_id: string;
}

export interface RawConnectionRow {
  bd_id: string;
  sent_count: number | string;
  received_count: number | string;
  last_message_at: string | Date | null;
  person_id: string;
}

// Raw `sql` rows deliver timestamps as strings; parseDbTimestamp is correct for
// offset-bearing strings (every column is timestamptz since slice 6) and
// any offset-less string alike.
export function mapRawActivityRow(r: RawActivityRow): ActivityRowForStatus & { personId: string } {
  return {
    id: r.id,
    type: r.type,
    createdAt: parseDbTimestamp(r.created_at),
    metadata: r.metadata,
    personId: r.person_id,
  };
}

export function mapRawConnectionRow(r: RawConnectionRow): ConnectionRowForStatus & { personId: string } {
  return {
    bdId: r.bd_id,
    sentCount: Number(r.sent_count),
    receivedCount: Number(r.received_count),
    lastMessageAt:
      r.last_message_at === null ? null : parseDbTimestamp(r.last_message_at),
    personId: r.person_id,
  };
}
