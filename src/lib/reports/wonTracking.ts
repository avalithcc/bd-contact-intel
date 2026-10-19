/**
 * When "won" dates start to mean something. The companies that were already won when the CRM went live were loaded
 * with `status_change` activities dated 2026-10-01..06 (ART): 57 of them, written by the initial data load, not by a BD
 * closing a deal. Counting them as October wins would make "Empresas ganadas" read 57 for a month in which nothing was
 * closed. Owner decision 2026-10-19: real tracking starts 2026-10-07 00:00 America/Argentina/Buenos_Aires.
 *
 * A won company whose latest move to 'won' is BEFORE this instant (or that has no recorded move at all) has no real
 * close date: it belongs to no period and is reported apart in the card foot. Nothing in the database is changed.
 */
import { argentinaInstantBoundary } from "@/lib/tasks/argentinaDate";

export const WON_TRACKING_STARTS_AT_ISO = argentinaInstantBoundary("2026-10-07").toISOString(); // 2026-10-07T03:00:00.000Z
