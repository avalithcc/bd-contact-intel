/**
 * Reads the four basics of the profile that is open: full name, current position (headline), current company
 * and location. Called ONLY from the click handler of "Agregar al CRM" (card.ts), never on page load or in the
 * background, and it only touches the open profile's top card (never <main>: the right-column ads live there).
 * A field it cannot read is `""`: nothing is guessed.
 */
import type { ProfileBasics } from "../shared/messages";
import { ensureExperienceLoaded, readCurrentRole } from "./experience";
import { cleanName, cleanText, companyFromLabel, stripCompanyPrefix } from "./profileText";
import { NOT_A_HEADLINE, NOT_A_LOCATION, PAREN_NOTE, PHOTO_LABEL, SELECTORS, TITLE_NAME } from "./selectors";

function firstText(root: ParentNode, selectors: readonly string[], accept: (text: string) => boolean = () => true): string {
  for (const selector of selectors) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      const text = cleanText(element.textContent);
      if (text && accept(text)) return text;
    }
  }
  return "";
}

/** A candidate is the top card only when it is a single profile card: no aside, no other card, one contact link. */
function isTopCardCandidate(candidate: Element, link: Element | null): boolean {
  if (candidate.querySelector("aside, main") || candidate.matches("main, aside")) return false;
  if (!link) return Boolean(candidate.querySelector(SELECTORS.heading));
  if (candidate.querySelectorAll(SELECTORS.contactInfoLink).length !== 1) return false;
  return Array.from(candidate.querySelectorAll(SELECTORS.heading)).some((h) => follows(h, link));
}

/** The top card, or null. New layout by `componentkey`, then by the contact-info link, then the old h1 section. */
function findTopCard(doc: Document): Element | null {
  const byKey = doc.querySelector(SELECTORS.topCardByKey);
  if (byKey) return byKey;
  const link = doc.querySelector(SELECTORS.contactInfoLink);
  let ancestor = link?.parentElement ?? null;
  while (link && ancestor && !ancestor.matches("main, body, html")) {
    const key = ancestor.getAttribute("componentkey");
    if (key !== null && !key.endsWith("Topcard")) return null; // a different card
    if (isTopCardCandidate(ancestor, link)) return ancestor;
    if (ancestor.querySelector("aside")) return null;
    ancestor = ancestor.parentElement;
  }
  if (link) return null;
  const section = doc.querySelector("h1")?.closest(SELECTORS.topCardRoot) ?? null;
  return section && isTopCardCandidate(section, null) ? section : null;
}

function follows(anchor: Element, node: Element): boolean {
  return Boolean(anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const PAIR_ITEM = `${SELECTORS.pairButton}, figure`;

/** Leaf paragraphs of the card. Text inside a company/school button is not a profile line. */
function paragraphs(topCard: Element): Element[] {
  return Array.from(topCard.querySelectorAll("p")).filter((p) => !p.querySelector("p") && !p.closest(PAIR_ITEM));
}

/** The company/school pair candidates: buttons with a figure after the name, minus profile-photo buttons. */
function pairButtons(topCard: Element, nameElement: Element | null): Element[] {
  return Array.from(topCard.querySelectorAll(SELECTORS.pairButton)).filter(
    (button) =>
      button.querySelector("figure") &&
      (!nameElement || follows(nameElement, button)) &&
      cleanText(button.textContent) &&
      !PHOTO_LABEL.test(`${cleanText(button.textContent)} ${button.getAttribute("aria-label") ?? ""}`),
  );
}

function readHeadline(topCard: Element, nameElement: Element | null): string {
  if (nameElement) {
    for (const p of paragraphs(topCard)) {
      const text = cleanText(p.textContent);
      if (follows(nameElement, p) && text && text !== "·" && !NOT_A_HEADLINE.test(text) && !PAREN_NOTE.test(text)) return text;
    }
  }
  return firstText(topCard, SELECTORS.headline);
}

function pairTexts(topCard: Element, nameElement: Element | null): string[] {
  return pairButtons(topCard, nameElement).map((button) => cleanText(button.textContent));
}

function readCompany(topCard: Element, nameElement: Element | null): string {
  for (const selector of SELECTORS.companyLabelled) {
    for (const element of Array.from(topCard.querySelectorAll(selector))) {
      const company = companyFromLabel(element.getAttribute("aria-label"));
      if (company) return stripCompanyPrefix(company);
    }
  }
  // Only a company AND a school together tell which is which (the first button is the current company); a lone
  // button can be either, so it is not guessed.
  const pair = pairTexts(topCard, nameElement);
  return pair.length === 2 ? stripCompanyPrefix(pair[0]).slice(0, 120) : "";
}

function readLocation(topCard: Element, headline: string, pair: string[]): string {
  const link = topCard.querySelector(SELECTORS.contactInfoLink);
  if (link) {
    const before = paragraphs(topCard).filter((p) => follows(p, link) && !p.contains(link));
    for (const p of before.reverse()) {
      const text = cleanText(p.textContent);
      if (!text || text === "·") continue;
      // The first real line before the contact info is the location; the company/school line is not one.
      if (text !== headline && !pair.includes(text) && !text.includes(" · ") && !NOT_A_LOCATION.test(text)) return text;
      break;
    }
  }
  return firstText(topCard, SELECTORS.location, (text) => !NOT_A_LOCATION.test(text));
}

function readTopCard(doc: Document): ProfileBasics {
  const topCard = findTopCard(doc);
  const nameElement = topCard
    ? (SELECTORS.name.flatMap((s) => Array.from(topCard.querySelectorAll(s))).find((el) => cleanText(el.textContent)) ?? null)
    : null;
  let name = cleanName(nameElement?.textContent);
  if (!name) name = cleanName(TITLE_NAME.exec(doc.title)?.[1]);
  if (!topCard) return { name, title: "", company: "", location: "" };

  const title = readHeadline(topCard, nameElement);
  return { name, title, company: readCompany(topCard, nameElement), location: readLocation(topCard, title, pairTexts(topCard, nameElement)) };
}

/** Name and location from the top card; title and company from the current Experience role when there is one. */
export function readProfileBasics(doc: Document): ProfileBasics {
  try {
    const basics = readTopCard(doc);
    const role = readCurrentRole(doc);
    return role ? { ...basics, title: role.title, company: role.company || basics.company } : basics;
  } catch {
    // Total: a markup surprise reads as empty (name from the title if possible), never as a throw.
    let name = "";
    try {
      name = cleanName(TITLE_NAME.exec(doc.title)?.[1]);
    } catch {
      // keep it empty
    }
    return { name, title: "", company: "", location: "" };
  }
}

/** Same, after waiting (up to `timeoutMs`) for the lazy Experience section. Never throws. */
export async function readProfileBasicsWhenLoaded(doc: Document, timeoutMs = 3000): Promise<ProfileBasics> {
  await ensureExperienceLoaded(doc, timeoutMs);
  return readProfileBasics(doc);
}
