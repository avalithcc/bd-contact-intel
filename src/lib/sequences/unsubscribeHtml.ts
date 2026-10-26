/**
 * The recipient-facing unsubscribe screens (mockups/baja-opciones.html, Option B: screens 2 and 3, plus the generic
 * invalid page), as an escaped HTML string. Rendered in the language the recipient's email was written in (the language chosen for the draft, else their compliance
 * audience: Spanish for Spanish-speaking countries, English otherwise). The invalid page is always English: see `pageLocale`.
 *
 * A string and not a React component on purpose: the screens are served by a route handler (/api/unsubscribe), and Next
 * refuses `react-dom/server` inside the app router's server layer, so the same markup cannot be rendered to HTML there.
 * Classes are the design system's (tests/unit/sequencesUnsubscribePagesUsage.test.ts checks each one exists).
 * Every interpolated value goes through `esc`: the address and the token come from the database and the URL.
 */
import { t } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import type { UnsubscribeView } from "./unsubscribeHandlers";
import type { UnsubscribePageAudience } from "./unsubscribePageAudience";

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(content: string, postalAddress?: string): string {
  const address = postalAddress ? `<p class="help center mt-md">${esc(postalAddress)}</p>` : "";
  return `<div class="auth"><div class="auth-card"><div class="auth-brand"><span class="logo">avalith<span class="dot">.</span></span></div><div class="card"><div class="card-body">${content}${address}</div></div></div></div>`;
}

const CHECK = '<svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/**
 * The language of a page, shared by the markup and by `<html lang>` so they cannot disagree.
 *
 * The invalid view is ALWAYS English: it has no token, so no contact and no language signal, and it is deliberately
 * generic (it names no address and does not reveal whether the token was unknown or malformed). Do not "fix" it to
 * follow a language it cannot know. English is also the answer when a valid view has no audience.
 */
export function pageLocale(view: UnsubscribeView, page?: UnsubscribePageAudience): Locale {
  return view.kind === "invalid" ? "en" : (page?.locale ?? "en");
}

/** `page` is the recipient's compliance audience (postal address from the compliance config, and email language); the invalid page never shows an address. */
export function renderUnsubscribeHtml(view: UnsubscribeView, page?: UnsubscribePageAudience): string {
  return renderUnsubscribeMarkup(view, page, pageLocale(view, page));
}

/** The markup in an already-decided `locale`. Production goes through `renderUnsubscribePage`, which decides it once. */
export function renderUnsubscribeMarkup(view: UnsubscribeView, page: UnsubscribePageAudience | undefined, locale: Locale): string {
  const copy = t(locale).sequenceUnsubscribe;
  const postalAddress = page?.postalAddress;
  switch (view.kind) {
    case "confirm":
      return shell(
        `<h3 class="center">${esc(copy.confirmTitle)}</h3><p class="meta center mt-md">${esc(copy.confirmBody(view.email))}</p>` +
          `<form class="form-actions mt-xl" method="post" action="/api/unsubscribe"><input type="hidden" name="t" value="${esc(view.token)}"><button class="btn btn-primary btn-block" type="submit">${esc(copy.confirmButton)}</button></form>`,
        postalAddress,
      );
    case "done":
      return shell(`<div class="empty"><div class="empty-icon">${CHECK}</div><h3>${esc(copy.doneTitle)}</h3><p>${esc(copy.doneBody(view.email))}</p></div>`, postalAddress);
    case "invalid":
      return shell(`<div class="empty"><h3>${esc(copy.invalidTitle)}</h3><p>${esc(copy.invalidBody)}</p></div>`);
  }
}
