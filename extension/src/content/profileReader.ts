/**
 * Reads the four basics of the profile that is open: full name, current position (headline), current company
 * and location. Called ONLY from the click handler of "Agregar al CRM" (card.ts), never on page load or in the
 * background, and it only touches the open profile's top card. A field it cannot read is `""`: nothing is guessed.
 */
import type { ProfileBasics } from "../shared/messages";
import { cleanName, cleanText, companyFromLabel } from "./profileText";
import { NOT_A_LOCATION, SELECTORS, TITLE_NAME } from "./selectors";

function firstText(root: ParentNode, selectors: readonly string[], accept: (text: string) => boolean = () => true): string {
  for (const selector of selectors) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      const text = cleanText(element.textContent);
      if (text && accept(text)) return text;
    }
  }
  return "";
}

function readCompany(topCard: ParentNode): string {
  for (const selector of SELECTORS.companyLabelled) {
    for (const element of Array.from(topCard.querySelectorAll(selector))) {
      const company = companyFromLabel(element.getAttribute("aria-label"));
      if (company) return company;
    }
  }
  const link = topCard.querySelector(SELECTORS.companyLink);
  return link ? cleanText(link.getAttribute("aria-label") || link.textContent).slice(0, 120) : "";
}

export function readProfileBasics(doc: Document): ProfileBasics {
  const nameElement = SELECTORS.name.map((selector) => doc.querySelector(selector)).find((el) => cleanText(el?.textContent));
  let name = cleanName(nameElement?.textContent);
  if (!name) name = cleanName(TITLE_NAME.exec(doc.title)?.[1]);

  const topCard: ParentNode = nameElement?.closest(SELECTORS.topCardRoot) ?? doc.querySelector("main") ?? doc;
  return {
    name,
    title: firstText(topCard, SELECTORS.headline),
    company: readCompany(topCard),
    location: firstText(topCard, SELECTORS.location, (text) => !NOT_A_LOCATION.test(text)),
  };
}
