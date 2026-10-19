/**
 * The extension manifest, built in code so the store variant and the localhost development variant cannot
 * drift: the dev build adds `http://localhost:3000/*` and nothing else. Permission surface (mockup note):
 * the CRM origin and www.linkedin.com only, plus `storage` for the collapsed/expanded card. No tabs, history,
 * webNavigation or <all_urls>.
 */
/**
 * THE extension version, and the only thing to change to release a new one: the build packs a zip with it, the CRM
 * serves that zip and compares the installed version against this very value (src/lib/extension/release.ts).
 */
export const EXTENSION_VERSION = "1.0.2";

/** Name of the downloadable archive for a version; one definition for the packer, the route and the UI. */
export function extensionZipName(version: string): string {
  return `crm-linkedin-v${version}.zip`;
}
export const STORE_CRM_ORIGIN = "https://crm.avalith.net";
export const DEV_CRM_ORIGIN = "http://localhost:3000";
const LINKEDIN_MATCH = "https://www.linkedin.com/*";

export function buildManifest({ dev }: { dev: boolean }) {
  const crmMatch = `${STORE_CRM_ORIGIN}/*`;
  const devMatch = `${DEV_CRM_ORIGIN}/*`;
  const crmMatches = dev ? [crmMatch, devMatch] : [crmMatch];
  return {
    manifest_version: 3 as const,
    name: dev ? "CRM avalith · LinkedIn (desarrollo)" : "CRM avalith · LinkedIn",
    version: EXTENSION_VERSION,
    description: "Muestra en LinkedIn si una persona ya está en el CRM de avalith y te deja agregarla.",
    icons: { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" },
    permissions: ["storage"],
    host_permissions: [...crmMatches, LINKEDIN_MATCH],
    background: { service_worker: "background.js" },
    content_scripts: [
      // Matches every www.linkedin.com page: LinkedIn navigates from the feed to a profile without reloading, so
      // the script must already be there. It shows the card only on /in/<slug>/ (see shared/profileUrl.ts).
      { matches: [LINKEDIN_MATCH], js: ["content-linkedin.js"], run_at: "document_idle" },
      // Tells the CRM's "Herramientas" card the extension is installed (sets a data attribute on <html>).
      { matches: crmMatches, js: ["content-crm.js"], run_at: "document_start" },
    ],
  };
}
