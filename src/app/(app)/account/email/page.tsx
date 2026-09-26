import { getCurrentBd } from "@/lib/queries";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import Link from "next/link";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

interface EmailPageProps {
  searchParams: Promise<{ error?: string; success?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Gmail is not configured on the server. Contact an admin.",
};

export default async function EmailPage({ searchParams }: EmailPageProps) {
  const me = await getCurrentBd();
  const { error, success } = await searchParams;

  const [account] = await db
    .select()
    .from(emailAccount)
    .where(eq(emailAccount.bdId, me.id));

  const configResult = getGmailOAuthConfig();

  return (
    <main>
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>
          ← Home
        </Link>

        <div className={styles.card}>
          <h1>Gmail Connection</h1>

          {error && (
            <div className={styles.error}>
              <p>Error: {ERROR_MESSAGES[error] ?? error}</p>
            </div>
          )}

          {!error && account?.status === "error" && account.lastErrorMessage && (
            <div className={styles.error}>
              <p>{account.lastErrorMessage}</p>
            </div>
          )}

          {success && (
            <div className={styles.success}>
              <p>Gmail connected successfully!</p>
            </div>
          )}

          {!configResult.ok ? (
            <div className={styles.disconnected}>
              <p className={styles.description}>
                Gmail is not configured on the server. Contact an admin to set it up.
              </p>
            </div>
          ) : account && account.status === "connected" ? (
            <div className={styles.connected}>
              <div className={styles.status}>
                <span className={styles.statusBadge}>✓ Connected</span>
                <p className={styles.email}>{account.emailAddress}</p>
              </div>

              <p className={styles.description}>
                You can now send emails from your Avalith mailbox. Emails will be sent with this account.
              </p>

              <div className={styles.actions}>
                <form action="/api/gmail/oauth/start" method="GET">
                  <button type="submit" className={styles.secondaryButton}>
                    Reconnect Gmail
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className={styles.disconnected}>
              <p className={styles.description}>
                Connect your Gmail account to enable email sending from Avalith.
              </p>
              <p className={styles.note}>
                Note: External+Testing mode requires reconnection every 7 days.
              </p>

              <div className={styles.actions}>
                <form action="/api/gmail/oauth/start" method="GET">
                  <button type="submit" className={styles.primaryButton}>
                    Connect Gmail
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>

        <div className={styles.info}>
          <h2>Email Sources</h2>
          <ul>
            <li>
              <strong>Gmail:</strong> Personal Gmail account (current)
            </li>
            <li>
              <strong>Hostgator SMTP:</strong> Coming soon — use your Hostgator mail server
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
