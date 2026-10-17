/**
 * Pure: the follow-up task a BD gets when a scheduled email ends 'failed'. No DB, no clock of its own, and the input is
 * never mutated. Idempotency is not decided here: the row moves to 'failed' exactly once (a guarded UPDATE), and the task
 * is written in that same transaction (queries.ts), so a rerun finds nothing to fail and creates nothing.
 */
export interface FailedScheduledRow {
  id: string;
  bdId: string;
  personId: string;
  personName: string;
  subject: string;
  error: string | null;
}

export interface FailureTaskFields {
  personId: string;
  actorBdId: string;
  assignedToBdId: string;
  title: string;
  description: string;
  dueAt: Date;
}

export function failureTaskTitle(personName: string): string {
  const name = personName.trim();
  return name ? `Revisar envío programado fallido a ${name}` : "Revisar envío programado fallido";
}

function reasonText(error: string | null): string {
  if (error === "gmail_not_connected") return "Gmail no está conectado: reconectá la cuenta y volvé a enviarlo desde Programados.";
  if (error === "gmail_unavailable") return "Gmail no aceptó el envío, así que el correo no salió. Podés reenviarlo desde Programados.";
  return "No se pudo confirmar si salió: revisá la carpeta Enviados antes de reenviarlo desde Programados.";
}

/** The owning BD both owns the task and is its actor: the system acts on their behalf, on their own scheduled email. */
export function buildFailureTask(row: FailedScheduledRow, now: Date): FailureTaskFields {
  return {
    personId: row.personId,
    actorBdId: row.bdId,
    assignedToBdId: row.bdId,
    title: failureTaskTitle(row.personName),
    description: `Asunto: ${row.subject}. ${reasonText(row.error)}`,
    dueAt: new Date(now.getTime()),
  };
}
