/**
 * Reads the four basics of the profile that is open: full name, current position (headline), current company
 * and location. Called ONLY from the click handler of "Agregar al CRM" (card.ts), never on page load or in the
 * background, and it only touches the open profile's top card (never <main>: the right-column ads live there).
 * A field it cannot read is `""`: nothing is guessed.
 */
import type { ProfileBasics } from "../shared/messages";
import { cleanName, cleanText, companyFromLabel, stripCompanyPrefix } from "./profileText";
import { NOT_A_HEADLINE, NOT_A_LOCATION, SELECTORS, TITLE_NAME } from "./selectors";

function firstText(root: ParentNode, selectors: readonly string[], accept: (text: string) => boolean = () => true): string {
  for (const selector of selectors) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      const text = cleanText(element.textContent);
      if (text && accept(text)) return text;
    }
  }
  return "";
}

/** The top card, or null. New layout by `componentkey`, then by the contact-info link, then the old h1 section. */
function findTopCard(doc: Document): Element | null {
  const byKey = doc.querySelector(SELECTORS.topCardByKey);
  if (byKey) return byKey;
  let ancestor = doc.querySelector(SELECTORS.contactInfoLink)?.parentElement ?? null;
  while (ancestor && ancestor !== doc.body && ancestor !== doc.documentElement) {
    if (ancestor.querySelector(SELECTORS.heading)) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return doc.querySelector("h1")?.closest(SELECTORS.topCardRoot) ?? null;
}

const follows = (anchor: Element, node: Element) => Boolean(anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);

function paragraphs(topCard: Element): Element[] {
  return Array.from(topCard.querySelectorAll("p")).filter((p) => !p.querySelector("p"));
}

function readHeadline(topCard: Element, nameElement: Element | null): string {
  if (nameElement) {
    for (const p of paragraphs(topCard)) {
      const text = cleanText(p.textContent);
      if (follows(nameElement, p) && text && text !== "·" && !NOT_A_HEADLINE.test(text)) return text;
    }
  }
  return firstText(topCard, SELECTORS.headline);
}

function readCompany(topCard: Element): string {
  for (const selector of SELECTORS.companyLabelled) {
    for (const element of Array.from(topCard.querySelectorAll(selector))) {
      const company = companyFromLabel(element.getAttribute("aria-label"));
      if (company) return stripCompanyPrefix(company);
    }
  }
  // Only a company AND a school together tell which is which (the first button is the current company); a lone
  // button can be either, so it is not guessed.
  const pair = Array.from(topCard.querySelectorAll(SELECTORS.pairButton))
    .filter((button) => button.querySelector("figure"))
    .map((button) => cleanText(button.textContent))
    .filter(Boolean);
  return pair.length === 2 ? stripCompanyPrefix(pair[0]).slice(0, 120) : "";
}

function readLocation(topCard: Element, headline: string): string {
  const link = topCard.querySelector(SELECTORS.contactInfoLink);
  if (link) {
    const before = paragraphs(topCard).filter((p) => follows(p, link) && !p.contains(link));
    for (const p of before.reverse()) {
      const text = cleanText(p.textContent);
      if (!text || text === "·") continue;
      // The first real line before the contact info is the location; the company/school line is not one.
      if (text !== headline && !text.includes(" · ") && !NOT_A_LOCATION.test(text)) return text;
      break;
    }
  }
  return firstText(topCard, SELECTORS.location, (text) => !NOT_A_LOCATION.test(text));
}

export function readProfileBasics(doc: Document): ProfileBasics {
  const topCard = findTopCard(doc);
  const nameElement = topCard
    ? (SELECTORS.name.flatMap((s) => Array.from(topCard.querySelectorAll(s))).find((el) => cleanText(el.textContent)) ?? null)
    : null;
  let name = cleanName(nameElement?.textContent);
  if (!name) name = cleanName(TITLE_NAME.exec(doc.title)?.[1]);
  if (!topCard) return { name, title: "", company: "", location: "" };

  const title = readHeadline(topCard, nameElement);
  return { name, title, company: readCompany(topCard), location: readLocation(topCard, title) };
}
