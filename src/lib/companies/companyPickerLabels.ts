/** Copy for the new-contact dialog's company autocomplete: plain strings (`{n}`, `{name}`, `{typed}` placeholders), so it crosses the server -> client boundary. */
export interface CompanyComboLabels {
  placeholder: string;
  listLabel: string;
  contactsOne: string;
  contactsMany: string;
  noDomain: string;
  badgeExisting: string;
  badgePossibleDuplicate: string;
  badgeNew: string;
  badgeChosen: string;
  createPrefix: string;
  none: string;
  searching: string;
  searchFailed: string;
  nearTitle: string;
  nearConsequence: string;
  nearUse: string;
  nearCreateAnyway: string;
}

/** The dictionary section the labels come from (`contactList`), typed structurally so both dictionaries satisfy it. */
export interface CompanyComboDictionary {
  companyComboPlaceholder: string;
  companyComboListLabel: string;
  companyComboContactsOne: string;
  companyComboContactsMany: string;
  companyComboNoDomain: string;
  companyComboBadgeExisting: string;
  companyComboBadgePossibleDuplicate: string;
  companyComboBadgeNew: string;
  companyComboBadgeChosen: string;
  companyComboCreatePrefix: string;
  companyComboNone: string;
  companyComboSearching: string;
  companyComboSearchFailed: string;
  companyComboNearTitle: string;
  companyComboNearConsequence: string;
  companyComboNearUse: string;
  companyComboNearCreateAnyway: string;
}

export const companyComboLabels = (d: CompanyComboDictionary): CompanyComboLabels => ({
  placeholder: d.companyComboPlaceholder,
  listLabel: d.companyComboListLabel,
  contactsOne: d.companyComboContactsOne,
  contactsMany: d.companyComboContactsMany,
  noDomain: d.companyComboNoDomain,
  badgeExisting: d.companyComboBadgeExisting,
  badgePossibleDuplicate: d.companyComboBadgePossibleDuplicate,
  badgeNew: d.companyComboBadgeNew,
  badgeChosen: d.companyComboBadgeChosen,
  createPrefix: d.companyComboCreatePrefix,
  none: d.companyComboNone,
  searching: d.companyComboSearching,
  searchFailed: d.companyComboSearchFailed,
  nearTitle: d.companyComboNearTitle,
  nearConsequence: d.companyComboNearConsequence,
  nearUse: d.companyComboNearUse,
  nearCreateAnyway: d.companyComboNearCreateAnyway,
});

/** "andina.tech · 23 contactos" / "sin dominio · 1 contacto" (mockup empresa.html, `.meta` line of each option). */
export function companyMetaLine(l: CompanyComboLabels, domain: string | null, contacts: number, separator = " · "): string {
  const count = contacts === 1 ? l.contactsOne : l.contactsMany.replace("{n}", String(contacts));
  return `${domain ?? l.noDomain}${separator}${count}`;
}
