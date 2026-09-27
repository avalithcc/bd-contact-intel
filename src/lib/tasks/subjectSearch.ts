/**
 * Pure row mappers behind the "Nueva tarea" dialog's subject picker
 * (mockup-port t04, owner instruction: "a picker that searches contacts by
 * name"). Kept DB-free (same split as src/lib/contacts/bulkOwner.ts vs.
 * bulkOwnerDb.ts) so these are plain unit-testable functions; the actual
 * `ilike` search lives in subjectSearchDb.ts. Creating the task itself
 * reuses the existing createTaskAction (src/app/(app)/tasks/actions.ts),
 * no new write path.
 */
export interface TaskSubjectSearchResult {
  type: "person" | "company";
  id: string;
  label: string;
}

export function personSubjectSearchResult(row: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
}): TaskSubjectSearchResult {
  const name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || row.id;
  const label = row.company ? `${name} · ${row.company}` : name;
  return { type: "person", id: row.id, label };
}

export function companySubjectSearchResult(row: {
  companyKey: string;
  displayName: string;
}): TaskSubjectSearchResult {
  return { type: "company", id: row.companyKey, label: row.displayName };
}
