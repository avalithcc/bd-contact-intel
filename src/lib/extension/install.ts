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

/** `NEXT_PUBLIC_EXTENSION_STORE_URL` when it is a real https URL; otherwise null and the button stays disabled. */
export function resolveExtensionStoreUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
