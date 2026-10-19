/**
 * The most recent position of the profile's Experience section: its title and company. The section is lazy
 * (a skeleton until it scrolls into view), so `ensureExperienceLoaded` brings it in when the BD presses
 * "Agregar al CRM". Only the FIRST item is read, only when it is a current position; anything else is `null` and
 * the caller falls back to the top card. Nothing is guessed and nothing here throws.
 */
import { cleanText } from "./profileText";
import { COMPANY_SEPARATOR, CURRENT_POSITION, DATE_RANGE, SELECTORS } from "./selectors";

export interface CurrentRole {
  title: string;
  company: string;
}

const ITEM = `${SELECTORS.experienceSection} ${SELECTORS.experienceItem}`;

const texts = (root: Element) => Array.from(root.querySelectorAll("p")).map((p) => cleanText(p.textContent));

/** Links of an item that hold text lines (the logo link has none). */
function textLinks(item: Element): Element[] {
  return Array.from(item.querySelectorAll("a")).filter((a) => a.querySelector("p"));
}

const CURRENT_MARKER = /^(?:actualidad|presente?)$/i;

function isCurrent(lines: string[]): boolean {
  return lines.some((line) => (DATE_RANGE.test(line) && CURRENT_POSITION.test(line)) || CURRENT_MARKER.test(line));
}

/** Several roles at one company: the header link names the company, the list holds the roles, newest first. */
function fromMultiRole(item: Element): CurrentRole | null {
  const role = item.querySelector("ul li");
  const roleLink = role?.querySelector("a");
  if (!role || !roleLink?.querySelector("p")) return null;
  const header = textLinks(item).find((a) => !a.closest("ul"));
  const title = cleanText(roleLink.querySelector("p")?.textContent);
  // Only the role link's own lines, plus the exact marker next to it: a description below must not count.
  const markers = Array.from(role.children).filter((c) => c.tagName === "P").map((c) => cleanText(c.textContent));
  if (!title || !(isCurrent(texts(roleLink)) || markers.some((m) => CURRENT_MARKER.test(m)))) return null;
  return { title, company: cleanText(header?.querySelector("p")?.textContent) };
}

/** One role: title, then "Company · employment type", then the dates. */
function fromSingleRole(item: Element): CurrentRole | null {
  const link = textLinks(item)[0];
  if (!link) return null;
  const lines = texts(link);
  const title = lines[0];
  if (!title || !isCurrent(lines)) return null;
  const second = lines[1] ?? "";
  const company = second && !DATE_RANGE.test(second) ? second.split(COMPANY_SEPARATOR)[0]!.trim() : "";
  return { title, company };
}

export function readCurrentRole(doc: Document): CurrentRole | null {
  try {
    const item = doc.querySelector(ITEM);
    if (!item) return null;
    return item.querySelector("ul li a p") ? fromMultiRole(item) : fromSingleRole(item);
  } catch {
    return null;
  }
}

/**
 * Scrolls the lazy placeholder into view and waits (up to `timeoutMs`) for the first Experience item, then puts
 * the page back where it was. Resolves either way; never rejects.
 */
export async function ensureExperienceLoaded(doc: Document, timeoutMs: number): Promise<void> {
  try {
    if (doc.querySelector(ITEM)) return;
    const anchor = SELECTORS.experienceLazyAnchors.map((s) => doc.querySelector(s)).find(Boolean);
    const view = doc.defaultView;
    if (!anchor || !view) return;
    const { scrollX, scrollY } = view;
    const href = view.location.href;
    try {
      await new Promise<void>((resolve) => {
        const observer = new view.MutationObserver(() => {
          if (doc.querySelector(ITEM)) finish();
        });
        const timer = view.setTimeout(finish, timeoutMs);
        function finish() {
          observer.disconnect();
          view!.clearTimeout(timer);
          resolve();
        }
        observer.observe(doc.documentElement, { childList: true, subtree: true });
        try {
          anchor.scrollIntoView({ block: "center", behavior: "instant" });
        } catch {
          // Keep waiting: the section may still load.
        }
      });
    } finally {
      // Not when the BD navigated meanwhile: that scroll position belongs to another page.
      if (view.location.href === href) view.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    }
  } catch {
    // Never break "Agregar al CRM": the top card answers instead.
  }
}
