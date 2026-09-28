/**
 * Pure planner for the "Cambiar empresa" dialog on the Contact record page
 * (contact-record.html:160's pencil icon, previously inert — see
 * page.tsx's comment history). No I/O — the thin DB glue
 * (companyChangeDb.ts) reads the current `person` row, resolves the picked
 * company by its `companyKey` (never trusting a client-supplied display
 * name), calls this, and writes the person update plus the history rows in
 * one transaction so they never diverge — same convention as
 * propertyEdit.ts/propertyEditDb.ts.
 *
 * `company` and `companyKey` always move together: `companyKey` drives the
 * company record's contacts count (getCompanyContactCount), the list's
 * batched per-page count (getCompanyListPage), and the name+company review
 * match (src/lib/identity/matcher.ts) — setting one without the other would
 * desync the contact from its own company record. There is deliberately no
 * free-text path here: the only inputs are `null` (detach) or a company
 * already on file (picked through the search dialog), never a typed name
 * that could mint "Globant", "globant SA" and "Globant." as three
 * companies.
 */
import type { NewPerson, NewPersonPropertyHistory, Person } from "@/db/schema";

type HistoryRow = Omit<NewPersonPropertyHistory, "id" | "at">;

export interface CompanyChangePlan {
  changed: boolean;
  personUpdate: Partial<NewPerson> | null;
  historyRows: HistoryRow[];
}

export type PersonForCompanyChange = Pick<Person, "id" | "company" | "companyKey">;

/** The company picked in the dialog's search results, or `null` to detach
 * (clear the contact's company). Always the company's OWN key/display name
 * as stored in `company` — never re-derived from free text. */
export type PickedCompany = { companyKey: string; displayName: string } | null;

function historyRow(
  personId: string,
  property: "company" | "companyKey",
  oldValue: string | null,
  newValue: string | null,
  changedByBdId: string,
): HistoryRow | null {
  if (oldValue === newValue) return null;
  return { personId, property, oldValue, newValue, changedByBdId, source: "edit" };
}

export function planCompanyChange(
  person: PersonForCompanyChange,
  newCompany: PickedCompany,
  changedByBdId: string,
): CompanyChangePlan {
  const oldCompany = person.company ?? null;
  const oldKey = person.companyKey ?? null;
  const newCompanyValue = newCompany?.displayName ?? null;
  const newKey = newCompany?.companyKey ?? null;

  if (oldCompany === newCompanyValue && oldKey === newKey) {
    return { changed: false, personUpdate: null, historyRows: [] };
  }

  const historyRows = [
    historyRow(person.id, "company", oldCompany, newCompanyValue, changedByBdId),
    historyRow(person.id, "companyKey", oldKey, newKey, changedByBdId),
  ].filter((r): r is HistoryRow => r !== null);

  return {
    changed: true,
    personUpdate: {
      company: newCompanyValue,
      companyKey: newKey,
      updatedAt: new Date(),
      updatedByBdId: changedByBdId,
    },
    historyRows,
  };
}
