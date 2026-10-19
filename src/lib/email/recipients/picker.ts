/**
 * The "Añadir destinatario" picker's list logic, pure. Mirrors the mockup (redactar-email.html section 1b): it lists the
 * other contacts of the record's company that are not recipients yet, shows the ones without email disabled, and filters
 * as the BD types. A typed address becomes a chip only when it is a listed contact's email; there are no free addresses.
 * The server re-checks all of it (src/lib/email/recipients/para.ts), so this is only the interface's convenience.
 */
export interface PickerCandidate {
  id: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
}

export interface PickerOption extends PickerCandidate {
  disabled: boolean;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function filterPickerOptions(candidates: readonly PickerCandidate[], pickedIds: ReadonlySet<string>, query: string): PickerOption[] {
  const q = fold(query);
  return candidates
    .filter((c) => !pickedIds.has(c.id))
    .filter((c) => q === "" || fold(`${c.name} ${c.email ?? ""} ${c.jobTitle ?? ""}`).includes(q))
    .map((c) => ({ ...c, disabled: !c.email }));
}

/** The listed contact whose email is exactly what was typed (case-insensitive), or null. */
export function matchTypedAddress(candidates: readonly PickerCandidate[], pickedIds: ReadonlySet<string>, typed: string): PickerCandidate | null {
  const address = typed.trim().toLowerCase();
  if (!address.includes("@")) return null;
  return candidates.find((c) => !pickedIds.has(c.id) && c.email?.trim().toLowerCase() === address) ?? null;
}
