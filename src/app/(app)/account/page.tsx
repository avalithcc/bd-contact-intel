import Link from "next/link";
import { headers } from "next/headers";
import { getCurrentBd, getMessageImportStats } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { MailIcon, LockIcon, LinkedInIcon, ChevronRightIcon } from "@/components/icons";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { gmailConnectionState } from "@/lib/gmail/connectionState";
import { formatArgentinaDayMonth } from "@/lib/i18n/format";
import { getSiteUrl } from "@/lib/config/siteUrl";
import { buildBookmarkletHref, resolveAppOrigin } from "@/lib/contacts/linkedinBookmarklet";
import { LinkedinBookmarklet } from "./LinkedinBookmarklet";
import { SignOutButton } from "../../SignOutButton";
import { SignatureEditor } from "./SignatureEditor";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

/**
 * Account settings hub (tasks.md mockup-parity 5.1; mockups/account.html).
 * Lives under the `(app)` shell (Sidebar/TopBar already wrap it), matching
 * the mockup which shows this screen inside the full app chrome.
 *
 * Deviations from the mockup (see apply-progress for the full rationale):
 * - No "Preferencias > Idioma" toggle: product decision D10 (locales.ts)
 *   ships Spanish-only with no LocaleSwitcher, so the language row is a
 *   static, non-interactive value instead of the mockup's segmented button.
 * - No multi-collaborator avatar stack — not applicable to a single BD's
 *   own account page.
 * - "Contraseña" row shows a generic reminder instead of "Cambiada hace 3
 *   meses" — the app doesn't track a last-password-change timestamp.
 */
export default async function AccountPage() {
  const [me, dict] = await Promise.all([getCurrentBd(), getDictionary()]);
  const l = dict.accountSettings;

  const [account] = await db
    .select()
    .from(emailAccount)
    .where(eq(emailAccount.bdId, me.id));
  // Own LinkedIn messages only: conversations are private per BD (one round trip).
  const importStats = await getMessageImportStats(me.id);
  const numberFormat = new Intl.NumberFormat("es-AR");
  // Same state function as /account/email, so the two pages always agree.
  const gmailState = gmailConnectionState(getGmailOAuthConfig().ok, account?.status);
  // The bookmarklet points at the origin the BD is on right now, so a preview deployment installs one for itself.
  const requestHeaders = await headers();
  const bookmarkletHref = buildBookmarkletHref(
    resolveAppOrigin(
      { host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"), forwardedProto: requestHeaders.get("x-forwarded-proto") },
      getSiteUrl(),
    ),
  );

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div className="eyebrow">{l.eyebrow}</div>
        <h1>
          {l.title}
          <span className="dot">.</span>
        </h1>
      </div>

      <div className={styles.card}>
        <div className={styles.profileRow}>
          <Avatar id={me.id} initials={initialsFromName(me.name)} variant="bd" size="lg" />
          <div className={styles.profileInfo}>
            <h2>{me.name}</h2>
            <p className={styles.profileEmail}>{me.email}</p>
          </div>
          <span className={styles.roleBadge}>
            {me.role === "admin" ? dict.nav.roleAdmin : dict.nav.roleBd}
          </span>
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardHeader}>{l.preferencesTitle}</h3>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{l.languageLabel}</span>
          <span className={styles.segmented}>
            <span className={styles.segmentedOn}>{l.languageValue}</span>
          </span>
        </div>
      </div>

      {/* Card order (account-order mockup, owner-approved 2026-10-03): the
          blocks you CONSULT at a glance come first — who am I, which language,
          is Gmail still connected — and the one you EDIT on purpose, the
          signature, goes last. It is the tallest block on the page, so while it
          sat third it pushed Importación and Conexiones below one laptop
          screen. Keep the editor at the bottom when adding a card here. */}

      <div className={styles.card}>
        <h3 className={styles.cardHeader}>{l.connectionsTitle}</h3>
        <a className={styles.listLink} href="/account/email">
          <MailIcon className={`icon ${styles.listLinkIcon}`} />
          <span className={styles.listLinkGrow}>
            <span className={styles.listLinkTitle}>{l.gmailRowTitle}</span>
            <span className={styles.listLinkMeta}>
              {gmailState === "connected" && account
                ? l.gmailConnectedMeta(account.emailAddress)
                : gmailState === "unavailable"
                  ? l.gmailUnavailableMeta
                  : l.gmailNotConnectedMeta}
            </span>
          </span>
          {gmailState === "connected" && <span className="legacy-badge green">{l.badgeConnected}</span>}
          <ChevronRightIcon className={`icon ${styles.listLinkChevron}`} />
        </a>
        <a className={styles.listLink} href="/account/password">
          <LockIcon className={`icon ${styles.listLinkIcon}`} />
          <span className={styles.listLinkGrow}>
            <span className={styles.listLinkTitle}>{l.passwordRowTitle}</span>
            <span className={styles.listLinkMeta}>{l.passwordRowMeta}</span>
          </span>
          <ChevronRightIcon className={`icon ${styles.listLinkChevron}`} />
        </a>
      </div>

      <div className={styles.card} id="herramientas">
        <h3 className={styles.cardHeader}>{l.toolsTitle}</h3>
        <div className="stack">
          <div className="row row-lg">
            <span className={styles.toolIcon}>
              <LinkedInIcon className="icon" />
            </span>
            <div className="grow">
              <strong>{l.linkedinToolTitle}</strong>
              <p className="meta">{l.linkedinToolBody}</p>
            </div>
          </div>
          <div className={styles.step}>
            <span className={styles.stepN}>1</span>
            <div className="grow">
              <strong>{l.toolStep1Title}</strong>
              <div className="mt-md">
                <LinkedinBookmarklet bookmarkletHref={bookmarkletHref} label={l.toolBookmarkletLabel} helpId="bm-help" />
              </div>
              <p className="help" id="bm-help">
                {l.toolBookmarkBarHelpLead} <kbd>Ctrl</kbd> + <kbd>Mayús</kbd> + <kbd>B</kbd> {l.toolBookmarkBarHelpMac} <kbd>⌘</kbd> +{" "}
                <kbd>Mayús</kbd> + <kbd>B</kbd>). {l.toolBookmarkBarHelpTail}
              </p>
            </div>
          </div>
          <div className={styles.step}>
            <span className={styles.stepN}>2</span>
            <div className="grow">
              <strong>{l.toolStep2Title}</strong>
              <p className="meta">{l.toolStep2Body}</p>
            </div>
          </div>
          <div className="alert alert-neutral">
            <LockIcon className="icon" />
            <div>
              <div className="title">{l.toolPrivacyTitle}</div>
              {l.toolPrivacyBody}
            </div>
          </div>
          <details>
            <summary className="btn btn-ghost btn-sm">{l.toolCodeSummary}</summary>
            <div className="field mt-md">
              <label className="label" htmlFor="bm-code">
                {l.toolCodeLabel}
              </label>
              <textarea className="textarea mono" id="bm-code" rows={3} readOnly defaultValue={bookmarkletHref} />
            </div>
          </details>
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardHeader}>{l.importTitle}</h3>
        <Link className={styles.listLink} href="/account/linkedin-messages">
          <LinkedInIcon className={`icon ${styles.listLinkIcon}`} />
          <span className={styles.listLinkGrow}>
            <span className={styles.listLinkTitle}>{l.linkedinMessagesRowTitle}</span>
            <span className={styles.listLinkMeta}>
              {importStats.lastImportedAt
                ? l.linkedinMessagesRowMeta(
                    numberFormat.format(importStats.messageCount),
                    numberFormat.format(importStats.conversationCount),
                    formatArgentinaDayMonth(importStats.lastImportedAt),
                  )
                : l.linkedinMessagesRowEmptyMeta}
            </span>
          </span>
          <ChevronRightIcon className={`icon ${styles.listLinkChevron}`} />
        </Link>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardHeader}>{l.signatureTitle}</h3>
        <SignatureEditor
          initialHtml={me.signatureHtml}
          labels={{
            title: l.signatureTitle,
            help: l.signatureHelp,
            inputLabel: l.signatureInputLabel,
            placeholder: l.signaturePlaceholder,
            policy: l.signaturePolicy,
            previewLabel: l.signaturePreviewLabel,
            previewTitle: l.signaturePreviewTitle,
            previewEmpty: l.signaturePreviewEmpty,
            save: l.signatureSave,
            saving: l.signatureSaving,
            clear: l.signatureClear,
            saved: l.signatureSaved,
            cleared: l.signatureCleared,
            errorTooLong: l.signatureErrorTooLong,
            errorOutputTooLong: l.signatureErrorOutputTooLong,
            errorNothingLeft: l.signatureErrorNothingLeft,
            errorUnexpected: l.signatureErrorUnexpected,
          }}
        />
      </div>

      <div className={styles.signOutRow}>
        <SignOutButton locale="es" />
      </div>
    </main>
  );
}
