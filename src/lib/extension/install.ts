/**
 * Pure helpers for Cuenta > Herramientas (the LinkedIn extension card). Kept out of the "use client" component
 * because a server component may not call non-component exports of a client file.
 */

const VERSION = /^\d+(?:\.\d+){1,3}$/;

/**
 * The extension's CRM-origin script sets `data-crm-extension="<version>"` on <html>. Only a plain dotted version
 * counts; anything else (empty, markup, a stranger's value) reads as "not installed".
 */
export function readInstalledVersion(attribute: string | null | undefined): string | null {
  const value = attribute?.trim() ?? "";
  return VERSION.test(value) ? value : null;
}

function parseParts(version: string): number[] | null {
  return VERSION.test(version) ? version.split(".").map(Number) : null;
}

/** Numeric, segment-by-segment comparison (1.10.0 > 1.9.0; missing segments are 0). `null` when either side is not a plain dotted version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseParts(a);
  const right = parseParts(b);
  if (!left || !right) return null;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export type ExtensionInstallState =
  | { kind: "not-installed" }
  | { kind: "current"; version: string }
  | { kind: "outdated"; version: string };

/**
 * Not installed / installed / installed but older than what the CRM serves. "Outdated" needs a proven older
 * version: anything that cannot be compared counts as installed, so the BD is never nagged on a guess.
 */
export function extensionInstallState(installed: string | null, served: string): ExtensionInstallState {
  const version = readInstalledVersion(installed);
  if (!version) return { kind: "not-installed" };
  return compareVersions(version, served) === -1 ? { kind: "outdated", version } : { kind: "current", version };
}

/** The install guide opens on the tab matching the visitor's browser: Edge when the user agent says so, Chrome otherwise. */
export function defaultBrowserTab(userAgent: string | null | undefined): "chrome" | "edge" {
  return /\bEdg(?:e|A|iOS)?\//.test(userAgent ?? "") ? "edge" : "chrome";
}
