/**
 * Pure mapper behind the /tasks "Asociado con" column (mockup-port t02;
 * tasks.html's `<a href="contact-record.html">Name · Company</a>` /
 * `Company (empresa)` cells). Every task belongs to exactly one Contact
 * (`personId`) or one Company (`companyKey`) — design D1 — so this picks
 * whichever subject is actually joined and resolved, and returns null when
 * neither resolved (no subject set, or the joined row is gone — e.g. a
 * merged/deleted person) so the caller renders an em dash instead of a
 * broken link.
 */
export interface TaskSubjectInput {
  personId: string | null;
  companyKey: string | null;
  subjectPersonFirstName: string | null;
  subjectPersonLastName: string | null;
  subjectPersonCompany: string | null;
  subjectCompanyName: string | null;
}

export interface TaskSubject {
  label: string;
  href: string;
}

export function resolveTaskSubject(task: TaskSubjectInput): TaskSubject | null {
  if (task.personId) {
    const name = [task.subjectPersonFirstName, task.subjectPersonLastName].filter(Boolean).join(" ").trim();
    if (!name) return null;
    const label = task.subjectPersonCompany ? `${name} · ${task.subjectPersonCompany}` : name;
    return { label, href: `/contacts/${task.personId}` };
  }

  if (task.companyKey) {
    if (!task.subjectCompanyName) return null;
    return { label: `${task.subjectCompanyName} (empresa)`, href: `/companies/${task.companyKey}` };
  }

  return null;
}
