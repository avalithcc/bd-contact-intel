/**
 * Shared pure pagination helpers — Registro de auditoría (admin-conversation-
 * access mockup, screen 3) is the first caller; every other list page in
 * this repo inlines the same two computations by hand
 * (`Math.max(1, Number(pageParam) || 1)`, `Math.ceil(total / pageSize)`).
 * Pulled out here so this new page's math is unit-tested without a DB.
 */

/** `searchParams.page` (a raw query-string value) -> a clamped, valid page
 * number. Never below 1; a missing/blank/non-numeric value defaults to 1. */
export function resolvePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export interface PaginationRange {
  totalPages: number;
  offset: number;
  /** 1-based index of the first row on this page, or 0 when `total` is 0. */
  from: number;
  /** 1-based index of the last row on this page, capped at `total`. */
  to: number;
}

export function paginationRange(page: number, pageSize: number, total: number): PaginationRange {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + pageSize, total);
  return { totalPages, offset, from, to };
}
