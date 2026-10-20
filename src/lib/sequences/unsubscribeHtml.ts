/**
 * The recipient-facing unsubscribe screens (mockups/baja-opciones.html, Option B: screens 2 and 3, plus the generic
 * invalid page), as an escaped HTML string. Rendered in English like the emails.
 *
 * A string and not a React component on purpose: the screens are served by a route handler (/api/unsubscribe), and Next
 * refuses `react-dom/server` inside the app router's server layer, so the same markup cannot be rendered to HTML there.
 * Classes are the design system's (tests/unit/sequencesUnsubscribePagesUsage.test.ts checks each one exists).
 * Every interpolated value goes through `esc`: the address and the token come from the database and the URL.
 */
import { t } from "@/lib/i18n/dictionaries";
import type { UnsubscribeView } from "./unsubscribeHandlers";

const copy = t("en").sequenceUnsubscribe;

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(content: string, postalAddress?: string): string {
  const address = postalAddress ? `<p class="help center mt-md">${esc(postalAddress)}</p>` : "";
  return `<div class="auth"><div class="auth-card"><div class="auth-brand"><span class="logo">avalith<span class="dot">.</span></span></div><div class="card"><div class="card-body">${content}${address}</div></div></div></div>`;
}

const CHECK = '<svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/** `postalAddress` is the recipient's compliance-audience address (compliance config); the invalid page never shows one. */
export function renderUnsubscribeHtml(view: UnsubscribeView, postalAddress?: string): string {
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
