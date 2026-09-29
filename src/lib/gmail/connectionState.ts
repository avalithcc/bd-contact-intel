/**
 * The one answer to "what is this BD's Gmail status?", shared by /account
 * and /account/email so the two pages can never disagree again.
 *
 * Missing server OAuth config wins over whatever `email_account` says: on a
 * deploy without the Google variables (every preview — they exist only in
 * Production, deliberately, so a preview can never read tokens or send mail
 * as a BD) a stored "connected" row cannot actually send anything.
 */
export type GmailConnectionState = "unavailable" | "connected" | "disconnected";

export function gmailConnectionState(
  serverConfigured: boolean,
  accountStatus: string | null | undefined,
): GmailConnectionState {
  if (!serverConfigured) return "unavailable";
  return accountStatus === "connected" ? "connected" : "disconnected";
}
