/**
 * `company.domain` — the web/email domain of a company, typed or pasted by a
 * BD. Pure normaliser + validator; no I/O.
 *
 * ONE stored form: a lowercase ASCII hostname — no protocol, no `www.`, no
 * port, no path/query/fragment, no whitespace, no trailing dot (`galicia.ar`,
 * `clear-tech.com`, `sustentables.com.uy`). This is the shape of all 2,701
 * domains in production (measured 2026-10-09), so every existing row is valid
 * under it and re-entering a stored value is a no-op. The normaliser must
 * never widen this shape.
 *
 * This value feeds the email-to-company matching, so a wrong value is worse
 * than a refused one: when in doubt the input is REJECTED, never guessed.
 *
 * What is normalised (pure noise around the same host):
 *  - case, surrounding whitespace, `http(s)://` (or a leading `//`), a leading
 *    `www.`, a numeric port, a path/query/fragment, one trailing dot;
 *  - other subdomains are kept as typed (`careers.foo.com` stays): finding
 *    the registrable domain needs a public-suffix list we do not ship, and a
 *    guess would be a silent wrong value.
 *
 * What is rejected, and why:
 *  - `email`: `juan@foo.com` (or any `@` in the host part). Reducing it to
 *    `foo.com` would be a guess about intent, so the BD is asked to paste the
 *    domain itself.
 *  - `not_http`: any scheme other than http/https (`ftp:`, `mailto:`,
 *    `javascript:`, `file:`) is not a website address.
 *  - `ip_address`: IPv4 or bracketed IPv6; an IP never appears after the `@`
 *    of a corporate address.
 *  - `no_tld`: a single label (`avalith`, `localhost`). A bare word is not a
 *    domain and must not be completed with a TLD we would have to invent.
 *  - `non_ascii`: `münchen.de`. Converting to punycode ourselves would store a
 *    value the BD never typed; refuse and let them paste the punycode form.
 *    An already-punycode name (`xn--mnchen-3ya.de`) is plain ASCII and is
 *    stored as written.
 *  - `invalid_host`: empty labels (`foo..com`), a label over 63 chars, a
 *    hyphen at a label edge, characters outside `a-z0-9-` (underscore,
 *    `*`, `%`, backslash), a TLD that is not letters (or punycode) of 2+
 *    characters (`foo.c`, `foo.123`), or a host over 253 characters.
 *  - `free_mail`: a consumer mail provider (gmail, hotmail, ...), using the
 *    same `isFreeMailDomain` rule as every other domain check in the app.
 *    Matching a company by `gmail.com` would attach every Gmail contact to it.
 *  - `unparseable`: whitespace inside the text, a path-only string
 *    (`/about`), a scheme with no host (`https://`, `https:foo.com`).
 *
 * Blank or whitespace-only input clears the field (`value: null`), the same
 * precedent as `linkedinUrl`.
 */

import { isFreeMailDomain } from "@/lib/emailPatterns";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export type DomainRejection =
  | "not_http"
  | "email"
  | "ip_address"
  | "no_tld"
  | "non_ascii"
  | "invalid_host"
  | "free_mail"
  | "unparseable";

export type DomainResult = { ok: true; value: string | null } | { ok: false; reason: DomainRejection };

/** Same scheme rule as linkedinUrl.ts: `host:8080` is a port, not a scheme. */
const SCHEME = /^([a-z][a-z0-9+.-]*):(?!\d)/i;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/;
const IPV4 = /^\d+(?:\.\d+){3}$/;
const NON_ASCII = /[^\x00-\x7f]/;
const MAX_HOST_LENGTH = 253;

function reject(reason: DomainRejection): DomainResult {
  return { ok: false, reason };
}

export function normalizeCompanyDomain(raw: string): DomainResult {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  if (/\s/.test(text)) return reject("unparseable");

  let rest = text;
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  if (scheme) {
    if (scheme !== "http" && scheme !== "https") return reject(text.includes("@") ? "email" : "not_http");
    rest = text.slice(scheme.length + 1);
    if (!rest.startsWith("//")) return reject("unparseable");
    rest = rest.slice(2);
  } else if (rest.startsWith("//")) {
    rest = rest.slice(2);
  }

  let authority = rest.split(/[/?#]/, 1)[0] ?? "";
  if (!authority) return reject("unparseable");
  if (authority.includes("@")) return reject("email");
  if (authority.startsWith("[")) return reject("ip_address");
  if (NON_ASCII.test(authority)) return reject("non_ascii");

  authority = authority.replace(/:\d+$/, "").toLowerCase().replace(/\.$/, "");
  if (!authority) return reject("unparseable");
  if (IPV4.test(authority)) return reject("ip_address");

  let labels = authority.split(".");
  if (labels.length < 2 && !authority.includes(":")) return reject("no_tld");
  if (labels[0] === "www" && labels.length > 2) labels = labels.slice(1);

  const host = labels.join(".");
  if (host.length > MAX_HOST_LENGTH) return reject("invalid_host");
  if (!labels.every((l) => LABEL.test(l)) || !TLD.test(labels[labels.length - 1]!)) return reject("invalid_host");
  if (isFreeMailDomain(host)) return reject("free_mail");
  return { ok: true, value: host };
}

/** The clickable `https://` link for a stored value, or null when the value
 * is not in the stored form (never builds a link from arbitrary text). */
export function companyDomainHref(stored: string | null): string | null {
  if (!stored) return null;
  const result = normalizeCompanyDomain(stored);
  return result.ok && result.value === stored ? `https://${stored}` : null;
}

/** Thrown by planCompanyPropertyEdit before building any plan. */
export class InvalidCompanyDomainError extends Error {
  constructor(
    public readonly reason: DomainRejection,
    public readonly value: string,
  ) {
    super(`Invalid company domain (${reason}): ${value}`);
    this.name = "InvalidCompanyDomainError";
  }
}

export type DomainErrorLabels = Pick<
  Dictionary["companyRecord"],
  | "domainErrorNotHttp"
  | "domainErrorEmail"
  | "domainErrorIpAddress"
  | "domainErrorNoTld"
  | "domainErrorNonAscii"
  | "domainErrorInvalidHost"
  | "domainErrorFreeMail"
  | "domainErrorUnparseable"
>;

/** The user-facing message for a rejection reason. */
export function companyDomainErrorMessage(reason: DomainRejection, l: DomainErrorLabels): string {
  switch (reason) {
    case "not_http":
      return l.domainErrorNotHttp;
    case "email":
      return l.domainErrorEmail;
    case "ip_address":
      return l.domainErrorIpAddress;
    case "no_tld":
      return l.domainErrorNoTld;
    case "non_ascii":
      return l.domainErrorNonAscii;
    case "invalid_host":
      return l.domainErrorInvalidHost;
    case "free_mail":
      return l.domainErrorFreeMail;
    case "unparseable":
      return l.domainErrorUnparseable;
  }
}
