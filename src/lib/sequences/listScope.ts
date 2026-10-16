/**
 * Which Sequences the list shows. A BD sees only their own, always; an admin chooses "Mías" (default, their own work) or
 * "Todas", optionally narrowed to one BD. Pure: the page resolves the request here, so `?scope=all&owner=<id>` from a
 * BD is forced back to their own list on the server and never reaches a read that returns other BDs' rows.
 */
import { isAdminRole } from "@/lib/auth/adminRole";
import { isUuid } from "@/lib/uuid";
import type { SequenceListRow } from "./listView";

export type ListScope = "mine" | "all";
export type ScopeRequest = { scope: ListScope; ownerId: string | null };
export type OwnerOption = { id: string; name: string; count: number; isMe: boolean };

export function resolveScope(viewer: { role: string }, params: { scope?: string; owner?: string }): ScopeRequest {
  if (!isAdminRole(viewer) || params.scope !== "all") return { scope: "mine", ownerId: null };
  return { scope: "all", ownerId: params.owner && isUuid(params.owner) ? params.owner : null };
}

/** `rows` must carry `owner` (the all-owners read). Counts are over every row, so the tabs and the menu do not move with the filter. */
export function scopeView(rows: readonly SequenceListRow[], meId: string, req: ScopeRequest) {
  const byOwner = new Map<string, OwnerOption>();
  for (const r of rows) {
    if (!r.owner) continue;
    const o = byOwner.get(r.owner.id) ?? { id: r.owner.id, name: r.owner.name, count: 0, isMe: r.owner.id === meId };
    o.count += 1;
    byOwner.set(r.owner.id, o);
  }
  const owners = [...byOwner.values()].sort((a, b) => Number(b.isMe) - Number(a.isMe) || b.count - a.count || a.name.localeCompare(b.name));
  const mine = rows.filter((r) => r.owner?.id === meId);
  const chipOwner = req.scope === "all" && req.ownerId ? byOwner.get(req.ownerId) ?? null : null;
  const visible = req.scope === "mine" ? mine : chipOwner ? rows.filter((r) => r.owner?.id === chipOwner.id) : rows;
  return { rows: visible, tabs: { mine: mine.length, all: rows.length }, owners, ownerCount: owners.length, chipOwner };
}
