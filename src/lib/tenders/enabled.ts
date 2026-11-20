/**
 * THE one switch for the Licitaciones (public tenders) module.
 *
 * PAUSED on 2026-11-20 (owner): Avalith is not a registered state supplier, so none of these tenders can be bid on, and the
 * module is on standby. Nothing was removed: the code, the tables, the downloaded pliegos, the analyses and the migrations are
 * all intact. Set this to `true` and the whole module is back; there is no second flag and no env var.
 *
 * It gates, and only through this constant:
 *  - the "Licitaciones" link in the sidebar (src/app/contacts/Sidebar.tsx)
 *  - /licitaciones, /licitaciones/[id] and /licitaciones/[id]/documento (404 when off)
 *  - every server action in src/app/(app)/licitaciones/actions.ts (requireTendersEnabled)
 *  - the tender block, count and subject wording of the daily digest (src/lib/tasks/digest.ts, src/lib/tenders/digestGate.ts)
 *  - the cron routes /api/tenders/portal and /api/tenders/pliegos (no DB read, no request to COMPR.AR; the bearer check stays first)
 *
 * Typed `boolean` (not the literal) so the gated branches stay type-checked instead of being narrowed away as dead code.
 */
export const TENDERS_ENABLED: boolean = false;

/** For server actions: a stale tab or a direct call must not reach the module (or its model call) while it is paused. */
export function requireTendersEnabled(enabled: boolean = TENDERS_ENABLED): void {
  if (!enabled) throw new Error("Tenders module is disabled");
}
