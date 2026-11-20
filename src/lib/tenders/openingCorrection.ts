/**
 * DB-FREE. The decision to move a tender's opening date to the one the live COMPR.AR process page shows.
 *
 * `tender.opening_at` has TWO writers: the Excel import (a snapshot of the day it was exported) and this correction (the
 * portal, refreshed every morning, which moves when an organism publishes a circular). The portal wins, because the days-left
 * clock, the list and the digest all read that column and a wrong date there loses a tender with nothing warning.
 *
 * KNOWN LIMITATION: re-importing an OLD export writes the stale date back, and the next daily portal run corrects it again.
 * We do not block the import (new tenders arrive that way). Instead the correction is idempotent, so the flip-flop is
 * harmless, and each correction logs its own 'opening' event, which makes the flip visible on the ficha.
 */
export interface OpeningCorrection {
  /** The CRM's date before the move. */
  from: Date;
  /** The portal's date, now the tender's. */
  to: Date;
}

/** Compares instants. Null when there is nothing to do: no usable portal date, or the same instant. Never mutates its inputs. */
export function planOpeningCorrection(crmDate: Date, portalDate: Date | null): OpeningCorrection | null {
  if (!portalDate || Number.isNaN(portalDate.getTime())) return null;
  if (!Number.isNaN(crmDate.getTime()) && crmDate.getTime() === portalDate.getTime()) return null;
  return { from: new Date(crmDate.getTime()), to: new Date(portalDate.getTime()) };
}
