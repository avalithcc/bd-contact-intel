import Link from "next/link";
import { headers } from "next/headers";
import { getDictionary } from "@/lib/i18n/server";
import { defaultBrowserTab } from "@/lib/extension/install";
import { currentExtensionRelease } from "@/lib/extension/release";
import { ExtensionGuide } from "./ExtensionGuide";
import styles from "./guide.module.css";

export const dynamic = "force-dynamic";

/**
 * `/account/extension` (linkedin-extension mockup instalar-extension.html, sections 2 to 4): the in-CRM guide to
 * install the extension unpacked in Chrome or Edge. The tab it opens on follows the visitor's user agent. Version
 * and zip name come from the extension manifest source (single source of truth); the download is the session-gated
 * route /api/extension/download.
 */
export default async function ExtensionGuidePage() {
  const [dict, requestHeaders] = await Promise.all([getDictionary(), headers()]);
  const l = dict.extensionGuide;

  return (
    <main className="page page-narrow">
      <div className={styles.guide}>
        <nav className="breadcrumbs mb-md" aria-label={l.breadcrumbAria}>
          <Link href="/account">{l.breadcrumbAccount}</Link>
          <span className="sep">/</span>
          <span aria-current="page">{l.breadcrumbCurrent}</span>
        </nav>

        <div className="page-header">
          <div className="titles">
            <h1>
              {l.title}
              <span className="dot">.</span>
            </h1>
            <p className="meta">
              {l.subtitle} <strong>{l.subtitleStrong}</strong>
            </p>
          </div>
        </div>

        <ExtensionGuide
          labels={{ ...l }}
          release={currentExtensionRelease()}
          initialBrowser={defaultBrowserTab(requestHeaders.get("user-agent"))}
          privacyTitle={dict.accountSettings.toolPrivacyTitle}
          privacyBody={dict.accountSettings.toolPrivacyBody}
        />
      </div>
    </main>
  );
}
