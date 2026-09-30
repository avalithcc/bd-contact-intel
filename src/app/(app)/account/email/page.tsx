import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import { db } from "@/db";
import { emailAccount } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { deriveEmailConnectionScreenState } from "@/lib/gmail/connectionScreenState";
import { needsReconnectForSync } from "@/lib/gmail/needsReconnectForSync";
import { InfoIcon, LinkIcon, MailIcon, WarningIcon } from "@/components/icons";
import { ConnectSuccessToast } from "./ConnectSuccessToast";
import { DisconnectButton, SyncNowButton } from "./AccountEmailActions";

export const dynamic = "force-dynamic";

interface EmailPageProps {
  searchParams: Promise<{ error?: string; success?: string }>;
}

/**
 * Gmail connection screen (email-sync.html screen 2, all 4 states —
 * task brief §2). Rewritten onto the global design-system classes
 * (`.card`, `.alert-*`, `.badge-*`) instead of the previous per-page
 * `page.module.css` — see tests/unit/iconSizing.test.ts's doc comment for
 * why a CSS-module-only restyle of this exact page broke icon sizing for 3
 * days in production (2026-09-26).
 *
 * Deviation from the mockup (documented in
 * openspec/changes/mockup-port/email-sync-checklist.md): no "· N correos
 * nuevos" suffix next to "Última sincronización" — the last sync's message
 * count is never persisted on `email_account` (only returned transiently by
 * `syncOneAccountNow`), so showing it would mean inventing a new column for
 * a single label; out of this task's explicit scope.
 */
export default async function EmailPage({ searchParams }: EmailPageProps) {
  const [me, dict, { error, success }] = await Promise.all([getCurrentBd(), getDictionary(), searchParams]);
  const l = dict.accountEmail;

  const [account] = await db.select().from(emailAccount).where(eq(emailAccount.bdId, me.id));

  const screenState = deriveEmailConnectionScreenState(
    {
      serverConfigured: getGmailOAuthConfig().ok,
      accountStatus: account?.status ?? null,
      grantedScopes: account?.grantedScopes ?? null,
      syncError: account?.syncError ?? null,
      backfillPageToken: account?.backfillPageToken ?? null,
    },
    needsReconnectForSync,
  );

  const errorMessage = error
    ? error === "not_configured"
      ? l.errorNotConfigured
      : error
    : null;

  return (
    <main className="page page-narrow">
      <ConnectSuccessToast message={success ? l.connectedSuccessToast : null} />

      <nav className="breadcrumbs" aria-label="Ruta de navegación">
        <Link href="/account">{l.breadcrumbAccount}</Link>
        <span className="sep">/</span>
        <span>{l.breadcrumbGmail}</span>
      </nav>

      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>
            {l.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{l.subtitle}</p>
        </div>
        <div className="actions">
          <Link href="/account/email/never-log" className="btn btn-ghost btn-sm">
            {l.neverLogLink}
          </Link>
        </div>
      </div>

      {errorMessage && (
        <div className="alert alert-warn mt-lg">
          <WarningIcon className="icon" />
          <div>{errorMessage}</div>
        </div>
      )}

      {screenState === "unavailable" && (
        <div className="card mt-lg">
          <div className="card-header">
            <MailIcon className="icon" />
            <h3>{l.notConfiguredTitle}</h3>
            <span className="actions">
              <span className="badge badge-neutral">{l.badgeNotAvailable}</span>
            </span>
          </div>
          <div className="card-body stack">
            <div className="alert alert-warn">
              <WarningIcon className="icon" />
              <div>
                <div className="title">{l.notConfiguredWarning}</div>
                {l.notConfiguredHint}
              </div>
            </div>
            <button type="button" className="btn btn-primary" disabled>
              {l.connectButton}
            </button>
          </div>
        </div>
      )}

      {screenState === "disconnected" && (
        <div className="card mt-lg">
          <div className="card-header">
            <MailIcon className="icon" />
            <h3>{l.disconnectedTitle}</h3>
          </div>
          <div className="card-body stack">
            <p>{l.connectDescription}</p>
            <p className="meta">{l.connectNote}</p>
            <form action="/api/gmail/oauth/start" method="GET">
              <button type="submit" className="btn btn-primary">
                {l.connectButton}
              </button>
            </form>
          </div>
        </div>
      )}

      {screenState === "needs_reconnect" && account && (
        <div className="card mt-lg">
          <div className="card-header">
            <MailIcon className="icon" />
            <h3>{l.connectedTitle}</h3>
            <span className="actions">
              <span className="badge badge-warn">{l.badgeNeedsReconnect}</span>
            </span>
          </div>
          <div className="card-body stack">
            <dl className="props">
              <div className="prop">
                <dt>{l.addressLabel}</dt>
                <dd>{account.emailAddress}</dd>
              </div>
              <div className="prop">
                <dt>{l.permissionsLabel}</dt>
                <dd>{l.permissionsValueSendOnly}</dd>
              </div>
            </dl>
            <div className="alert alert-warn">
              <WarningIcon className="icon" />
              <div>
                <div className="title">{l.reconnectAlertTitle}</div>
                {l.reconnectAlertBody}
              </div>
            </div>
            <form action="/api/gmail/oauth/start" method="GET">
              <button type="submit" className="btn btn-primary">
                <LinkIcon className="icon" />
                {l.reconnectButton}
              </button>
            </form>
          </div>
          <div className="card-footer row">
            <span className="grow" />
            <DisconnectButton label={l.disconnectButton} errorLabel={l.disconnectError} />
          </div>
        </div>
      )}

      {(screenState === "sync_error" || screenState === "backfilling" || screenState === "synced") && account && (
        <div className="card mt-lg">
          <div className="card-header">
            <MailIcon className="icon" />
            <h3>{l.connectedTitle}</h3>
            <span className="actions">
              <span className="badge badge-success">{l.badgeConnected}</span>
            </span>
          </div>
          <div className="card-body stack">
            <dl className="props">
              <div className="prop">
                <dt>{l.addressLabel}</dt>
                <dd>{account.emailAddress}</dd>
              </div>
              <div className="prop">
                <dt>{l.permissionsLabel}</dt>
                <dd>{l.permissionsValueFull}</dd>
              </div>
              {screenState !== "backfilling" && (
                <div className="prop">
                  <dt>{l.lastSyncedLabel}</dt>
                  <dd>
                    {account.lastSyncedAt
                      ? formatDistanceToNow(account.lastSyncedAt, { locale: es, addSuffix: true })
                      : l.lastSyncedNever}
                  </dd>
                </div>
              )}
            </dl>

            {screenState === "sync_error" && (
              <div className="alert alert-danger">
                <WarningIcon className="icon" />
                <div>
                  <div className="title">{l.errorAlertTitle}</div>
                  {account.syncError} {l.errorAlertBodySuffix}
                </div>
              </div>
            )}

            {screenState === "sync_error" && (
              <form action="/api/gmail/oauth/start" method="GET">
                <button type="submit" className="btn btn-primary">
                  <LinkIcon className="icon" />
                  {l.reconnectButton}
                </button>
              </form>
            )}

            {screenState === "backfilling" && (
              <div className="alert alert-info">
                <span className="spinner-standalone" aria-hidden="true" />
                <div>
                  <div className="title">{l.backfillTitle}</div>
                  {l.backfillBody}
                </div>
              </div>
            )}
          </div>
          <div className="card-footer row">
            <span className="grow" />
            {screenState === "backfilling" ? (
              <button type="button" className="btn btn-secondary btn-sm" disabled>
                <span className="spinner" aria-hidden="true" />
                {l.backfillButtonLabel}
              </button>
            ) : (
              <SyncNowButton label={l.syncNowButton} syncingLabel={l.syncNowSyncing} errorLabel={l.syncNowError} />
            )}
            <DisconnectButton label={l.disconnectButton} errorLabel={l.disconnectError} />
          </div>
        </div>
      )}
    </main>
  );
}
