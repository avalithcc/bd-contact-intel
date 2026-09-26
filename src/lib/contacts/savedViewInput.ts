/**
 * Pure planner for a BD-created saved view (task 12.3; design D7:
 * "BD-created views go in the `saved_view` table (filters/columns/sort as
 * jsonb)"). No I/O — the thin DB glue (savedViews.ts) calls this before
 * every insert/update so a malformed or oversized name never reaches the
 * DB, same convention as propertyEdit.ts/propertyEditDb.ts.
 */
import { sanitizeContactFilters, type ContactFilters } from "@/lib/contacts/viewFilters";

export type SavedViewNameReason = "blank" | "too_long";

export class SavedViewNameError extends Error {
  constructor(public readonly reason: SavedViewNameReason) {
    super(`Invalid saved view name: ${reason}`);
    this.name = "SavedViewNameError";
  }
}

const MAX_NAME_LENGTH = 100;

export interface SavedViewSort {
  field?: string;
  direction?: "asc" | "desc";
}

export interface SavedViewInput {
  name: string;
  filters: ContactFilters;
  columns: string[];
  sort: SavedViewSort;
}

function sanitizeColumns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function sanitizeSort(value: unknown): SavedViewSort {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const sort: SavedViewSort = {};
  if (typeof raw.field === "string") sort.field = raw.field;
  if (raw.direction === "asc" || raw.direction === "desc") sort.direction = raw.direction;
  return sort;
}

/**
 * `name` is trimmed; a blank name (after trim) or one over 100 characters
 * throws before any write is attempted. `filters`/`columns`/`sort` are
 * defensively sanitized the same way a read of an existing row is
 * (sanitizeContactFilters), so a caller passing an unexpected shape gets a
 * clean, storable value rather than garbage jsonb.
 */
export function planSavedViewInput(input: {
  name: string;
  filters: unknown;
  columns: unknown;
  sort: unknown;
}): SavedViewInput {
  const trimmed = input.name.trim();
  if (trimmed === "") throw new SavedViewNameError("blank");
  if (trimmed.length > MAX_NAME_LENGTH) throw new SavedViewNameError("too_long");

  return {
    name: trimmed,
    filters: sanitizeContactFilters(input.filters),
    columns: sanitizeColumns(input.columns),
    sort: sanitizeSort(input.sort),
  };
}
