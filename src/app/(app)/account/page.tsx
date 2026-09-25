import Link from "next/link";
import styles from "./email/page.module.css";

export default function AccountPage() {
  return (
    <main>
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>
          ← Home
        </Link>

        <div className={styles.card}>
          <h1>Account</h1>
          <p className={styles.description}>
            Manage the mailbox you send outreach from and your sign-in password.
          </p>
          <div className={styles.actions}>
            <Link href="/account/email" className={styles.primaryButton}>
              Gmail connection
            </Link>
            <Link href="/account/password" className={styles.secondaryButton}>
              Change password
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
