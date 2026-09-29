/**
 * Pure resolver for a task's assignee `<select>` (task-essentials backlog
 * item 2: "let the creator pick any active BD, defaulting to themselves").
 * Reuses normalizeOwnerSelectValue's uuid validation (src/lib/contacts/
 * bulkOwner.ts) — same "blank or uuid, else reject" contract as every owner
 * `<select>` in this app — but a task is never "unassigned", so blank means
 * "assign it to me" instead of null. The caller still validates the
 * resolved id against real `bd` rows before writing (see
 * src/lib/tasks/queries.ts#assertAssigneeExists) — this function only
 * decides WHICH id to check, it never touches the database.
 */
import { normalizeOwnerSelectValue } from "@/lib/contacts/bulkOwner";

export function resolveTaskAssignee(raw: string, creatorBdId: string): string | undefined {
  const normalized = normalizeOwnerSelectValue(raw);
  if (normalized === undefined) return undefined;
  return normalized ?? creatorBdId;
}

export interface TaskAssigneeBd {
  id: string;
  name: string;
}

export interface TaskAssigneeSelectOption {
  id: string;
  label: string;
}

/**
 * Builds the "Asignado a" `<select>` option list (approved mockup
 * contact-record.html `#task`: `<option>Cristian Civita (yo)</option>
 * <option>Ana Pereyra (responsable)</option>` — one entry per BD, no
 * separate blank "Yo" option, current BD first and preselected by the
 * caller via its `id`). `ownerBdId` is the record's own owner — passed in
 * ONLY when the caller already has it loaded (e.g. the Contact/Company
 * record's `ownerBdId` prop); never fetched here. When the owner IS the
 * current BD, "(yo)" wins — a person is never labeled twice. Pure: never
 * mutates `bds`, and the same input always produces the same output.
 */
export function buildTaskAssigneeOptions(
  bds: readonly TaskAssigneeBd[],
  meId: string,
  ownerBdId?: string | null,
): TaskAssigneeSelectOption[] {
  const labelFor = (bd: TaskAssigneeBd): string => {
    if (bd.id === meId) return `${bd.name} (yo)`;
    if (ownerBdId && bd.id === ownerBdId) return `${bd.name} (responsable)`;
    return bd.name;
  };
  const toOption = (bd: TaskAssigneeBd): TaskAssigneeSelectOption => ({ id: bd.id, label: labelFor(bd) });
  const me = bds.filter((bd) => bd.id === meId).map(toOption);
  const rest = bds.filter((bd) => bd.id !== meId).map(toOption);
  return [...me, ...rest];
}

/** Thrown when a task write's `assignedToBdId` doesn't reference a real `bd`
 * row (task-essentials backlog item 2). Lives here (not in tasks/queries.ts,
 * which imports the live `db` connection) so DB-free callers — like
 * src/app/(app)/contacts/actionErrors.ts, unit-tested without a database —
 * can map it to a reason without pulling in `db`. There is no "active" flag
 * on `bd` — every row is a currently valid BD account — so existence in
 * `bd` is the full "real, active BD" check this schema supports. */
export class InvalidAssigneeError extends Error {
  constructor() {
    // Spanish, user-facing: companies/actions.ts forwards this message
    // as-is (no reason-mapping layer there — see addCompanyTaskAction);
    // contacts/actions.ts maps this error to the existing
    // `l.errorOwnerInvalid` string instead (see actionErrors.ts).
    super("Seleccionar un responsable válido.");
    this.name = "InvalidAssigneeError";
  }
}
