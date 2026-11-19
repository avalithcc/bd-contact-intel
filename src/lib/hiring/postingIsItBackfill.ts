import { isItPosting } from "@/lib/hiring/classify";

export interface PostingIsItRow {
  id: string;
  title: string;
  isIt: boolean;
}

export interface PostingIsItChange {
  id: string;
  from: boolean;
  to: boolean;
}

/** Rows whose stored `is_it` differs from the current classifier. The input rows are never modified. */
export function planPostingIsItPage(rows: readonly PostingIsItRow[]): PostingIsItChange[] {
  const changes: PostingIsItChange[] = [];
  for (const row of rows) {
    const next = isItPosting(row.title);
    if (next !== row.isIt) changes.push({ id: row.id, from: row.isIt, to: next });
  }
  return changes;
}
