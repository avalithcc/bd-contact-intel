import { getCurrentBd } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { MailIcon, LockIcon, ChevronRightIcon } from "@/components/icons";
import { SignOutButton } from "../../SignOutButton";
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
  const gmailConnected = account?.status === "connected";

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

      <div className={styles.card}>
        <h3 className={styles.cardHeader}>{l.connectionsTitle}</h3>
        <a className={styles.listLink} href="/account/email">
          <MailIcon className={styles.listLinkIcon} />
          <span className={styles.listLinkGrow}>
            <span className={styles.listLinkTitle}>{l.gmailRowTitle}</span>
            <span className={styles.listLinkMeta}>
              {gmailConnected ? l.gmailConnectedMeta(account.emailAddress) : l.gmailNotConnectedMeta}
            </span>
          </span>
          {gmailConnected && <span className="badge green">{l.badgeConnected}</span>}
          <ChevronRightIcon className={styles.listLinkChevron} />
        </a>
        <a className={styles.listLink} href="/account/password">
          <LockIcon className={styles.listLinkIcon} />
          <span className={styles.listLinkGrow}>
            <span className={styles.listLinkTitle}>{l.passwordRowTitle}</span>
            <span className={styles.listLinkMeta}>{l.passwordRowMeta}</span>
          </span>
          <ChevronRightIcon className={styles.listLinkChevron} />
        </a>
      </div>

      <div className={styles.signOutRow}>
        <SignOutButton locale="es" />
      </div>
    </main>
  );
}
