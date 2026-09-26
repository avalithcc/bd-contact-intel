import { getCurrentBd } from "@/lib/queries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { formatDate } from "@/lib/i18n/format";
import { MailIcon, InfoIcon, WarningIcon } from "@/components/icons";
import { ConnectSuccessToast } from "./ConnectSuccessToast";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface EmailPageProps {
  searchParams: Promise<{ error?: string; success?: string }>;
}

/**
 * Gmail connection screen (tasks.md mockup-parity 5.1;
 * mockups/account-email.html). Presentation only — the connect/reconnect
 * flow (`/api/gmail/oauth/start` GET form) is unchanged.
 *
 * Deviation from the mockup: no "Desconectar" button. There is no
 * disconnect server action/route in this codebase yet (only connect and
 * reconnect through the OAuth start flow) — adding one would be a new
 * feature, not a restyle, so the connected card's footer keeps the
 * existing "Reconectar Gmail" action instead of the mockup's Disconnect
 * button.
 */
export default async function EmailPage({ searchParams }: EmailPageProps) {
  const [me, dict, locale, { error, success }] = await Promise.all([
    getCurrentBd(),
    getDictionary(),
    getLocale(),
    searchParams,
  ]);
  const l = dict.accountEmail;

  const [account] = await db
    .select()
    .from(emailAccount)
    .where(eq(emailAccount.bdId, me.id));

  const configResult = getGmailOAuthConfig();
  const errorMessage = error
    ? error === "not_configured"
      ? l.errorNotConfigured
      : error
    : !error && account?.status === "error" && account.lastErrorMessage
      ? account.lastErrorMessage
      : null;

  return (
    <main className={styles.page}>
      <ConnectSuccessToast message={success ? l.connectedSuccessToast : null} />

      <div className={styles.header}>
        <div className="eyebrow">{l.eyebrow}</div>
        <h1>
          {l.title}
          <span className="dot">.</span>
        </h1>
        <p className={styles.subtitle}>{l.subtitle}</p>
      </div>

      {errorMessage && (
        <div className={`${styles.alert} ${styles.alertWarn}`}>
          <WarningIcon className={styles.alertIcon} />
          <div>{errorMessage}</div>
        </div>
      )}

      {!configResult.ok ? (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <MailIcon className={styles.cardHeaderIcon} />
            <h3>{l.notConfiguredTitle}</h3>
            <span className={styles.badgeNeutral}>{l.badgeNotAvailable}</span>
          </div>
          <div className={styles.cardBody}>
            <div className={`${styles.alert} ${styles.alertWarn}`}>
              <WarningIcon className={styles.alertIcon} />
              <div>
                <strong>{l.notConfiguredWarning}</strong>
                <br />
                {l.notConfiguredHint}
              </div>
            </div>
            <button type="button" className={styles.primaryButton} disabled>
              {l.connectButton}
            </button>
          </div>
        </div>
      ) : account && account.status === "connected" ? (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <MailIcon className={styles.cardHeaderIcon} />
            <h3>{l.connectedTitle}</h3>
            <span className="badge green">{l.badgeConnected}</span>
          </div>
          <div className={styles.cardBody}>
            <dl className={styles.props}>
              <div className={styles.prop}>
                <dt>{l.addressLabel}</dt>
                <dd>{account.emailAddress}</dd>
              </div>
              <div className={styles.prop}>
                <dt>{l.connectedLabel}</dt>
                <dd>{formatDate(account.connectedAt, locale)}</dd>
              </div>
              <div className={styles.prop}>
                <dt>{l.permissionsLabel}</dt>
                <dd>{l.permissionsValue}</dd>
              </div>
            </dl>
            <div className={`${styles.alert} ${styles.alertInfo}`}>
              <InfoIcon className={styles.alertIcon} />
              <div>{l.syncNote}</div>
            </div>
          </div>
          <div className={styles.cardFooter}>
            <form action="/api/gmail/oauth/start" method="GET">
              <button type="submit" className={styles.secondaryButton}>
                {l.reconnectButton}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <MailIcon className={styles.cardHeaderIcon} />
            <h3>{l.disconnectedTitle}</h3>
          </div>
          <div className={styles.cardBody}>
            <p className={styles.description}>{l.connectDescription}</p>
            <p className={styles.note}>{l.connectNote}</p>
            <form action="/api/gmail/oauth/start" method="GET">
              <button type="submit" className={styles.primaryButton}>
                {l.connectButton}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
