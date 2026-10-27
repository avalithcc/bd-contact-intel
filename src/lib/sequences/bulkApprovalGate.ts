/**
 * The "N de M borradores revisados" gate. Pure, and the one rule the client and the server share: bulk approval is
 * enabled only when every selected draft was opened. The server re-runs this on rows it read itself, never on what
 * the client claims.
 */
export type GateRow = { id: string; reviewed: boolean; /** Written in another language than today's (languageMismatch.ts): the selection is blocked, like an unopened draft. The server refuses it too (wrong_language). */ wrongLanguage?: boolean };

export type BulkApprovalGate = { reviewed: number; total: number; enabled: boolean; unreviewedIds: string[]; wrongLanguageIds: string[] };

export function bulkApprovalGate(selected: readonly GateRow[]): BulkApprovalGate {
  const byId = new Map<string, boolean>();
  for (const row of selected) byId.set(row.id, (byId.get(row.id) ?? true) && row.reviewed);
  const unreviewedIds = [...byId].filter(([, reviewed]) => !reviewed).map(([id]) => id);
  const wrongLanguageIds = [...new Set(selected.filter((r) => r.wrongLanguage).map((r) => r.id))];
  const total = byId.size;
  return { reviewed: total - unreviewedIds.length, total, enabled: total > 0 && unreviewedIds.length === 0 && wrongLanguageIds.length === 0, unreviewedIds, wrongLanguageIds };
}
