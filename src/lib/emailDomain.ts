/**
 * Domain-level deliverability check for a suspected corporate email domain.
 *
 * WHY no SMTP / RCPT-TO probing: Vercel Functions cannot open outbound
 * connections on port 25 (blocked at the platform level), which rules out a
 * real SMTP handshake. Even where port 25 is reachable, issuing RCPT-TO
 * without actually sending mail is unreliable in practice — Microsoft 365
 * accepts (2xx) almost any recipient at a domain it hosts regardless of
 * whether the mailbox exists, catch-all domains do the same, and repeated
 * RCPT-TO probes from a single IP look exactly like the reconnaissance step
 * of a spam run, so mail providers throttle or blocklist the probing IP.
 *
 * What we do instead: resolve the domain's MX records via DNS. This proves
 * only that SOMETHING is configured to receive mail for that domain — it
 * NEVER proves a specific mailbox exists. That's why this module returns a
 * domain-level signal (hasMx/provider), not a per-address verdict, and why
 * emailSuggestion.ts folds it into a "confidence" label rather than a
 * pass/fail check.
 */
import { resolveMx } from "node:dns/promises";

export type LookupStatus = "ok" | "no-mx" | "error";

export type MailProvider =
  | "google"
  | "microsoft"
  | "zoho"
  | "proofpoint"
  | "mimecast"
  | "other"
  | "unknown";

export interface DomainLookupResult {
  status: LookupStatus;
  hasMx: boolean;
  provider: MailProvider;
  mxHosts: string[];
}

const LOOKUP_TIMEOUT_MS = 3000;

// Matchers checked in order against each MX hostname (lowercased). The first
// match wins. Kept as one table, each row commented with why the provider
// matters for confidence scoring downstream:
const PROVIDER_MATCHERS: { provider: MailProvider; test: (host: string) => boolean }[] = [
  {
    // Google Workspace / Gmail. Google rejects RCPT-TO for unknown
    // recipients at the SMTP level (when not caught by a catch-all), so an
    // MX-only signal here is reasonably informative, though this module
    // still never tries a handshake.
    provider: "google",
    test: (h) => h.endsWith(".google.com") || h.includes("googlemail.com"),
  },
  {
    // Microsoft 365 / Exchange Online. IMPORTANT: M365 by default accepts
    // (2xx) mail for recipients that don't exist and silently drops it
    // (or NDRs later, out of band), so even a paid SMTP-verification
    // service cannot reliably confirm a mailbox here. Any suggestion for a
    // "microsoft" domain must say so explicitly in the UI — see
    // emailSuggestion.ts and the contact detail page.
    provider: "microsoft",
    test: (h) => h.endsWith(".mail.protection.outlook.com") || h.includes("outlook.com"),
  },
  {
    // Zoho Mail — small/mid-size company suite, common enough to call out
    // by name rather than bucket into "other".
    provider: "zoho",
    test: (h) => h.includes("zoho.com") || h.includes("zohomail.com"),
  },
  {
    // Proofpoint — an inbound email SECURITY gateway sitting in front of the
    // real mailbox provider (Google/Microsoft/etc.), not a mailbox provider
    // itself. Its presence means the actual accept/reject behavior is
    // whatever Proofpoint's filtering policy decides, which we can't see
    // from MX alone.
    provider: "proofpoint",
    test: (h) => h.includes("pphosted.com"),
  },
  {
    // Mimecast — same situation as Proofpoint: a security gateway in front
    // of the real mailbox, not the mailbox provider.
    provider: "mimecast",
    test: (h) => h.includes("mimecast.com"),
  },
];

function detectProvider(mxHosts: string[]): MailProvider {
  const lowered = mxHosts.map((h) => h.toLowerCase());
  for (const { provider, test } of PROVIDER_MATCHERS) {
    if (lowered.some(test)) return provider;
  }
  return mxHosts.length > 0 ? "other" : "unknown";
}

/**
 * Look up MX records for a domain with a short timeout. Never throws — any
 * failure (NXDOMAIN, timeout, network error) is reported as
 * `{ status: "error", hasMx: false, provider: "unknown" }`, which the caller
 * MUST treat as "unconfirmed", not as "confirmed no mail" (that's
 * `status: "no-mx"`, a successful lookup that returned zero MX records).
 */
export async function lookupDomain(domain: string): Promise<DomainLookupResult> {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) {
    return { status: "error", hasMx: false, provider: "unknown", mxHosts: [] };
  }

  try {
    const records = await Promise.race([
      resolveMx(trimmed),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("MX lookup timed out")), LOOKUP_TIMEOUT_MS);
      }),
    ]);

    if (!records || records.length === 0) {
      // A successful DNS answer with zero MX records is a CONFIRMED fact:
      // this domain does not receive mail. Distinct from a lookup failure.
      return { status: "no-mx", hasMx: false, provider: "unknown", mxHosts: [] };
    }

    const mxHosts = records
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange);

    return { status: "ok", hasMx: true, provider: detectProvider(mxHosts), mxHosts };
  } catch (err) {
    // Node's dns/promises#resolveMx REJECTS (rather than resolving to an
    // empty array) when the domain has zero MX records, so the "no
    // records" case must be told apart here, not above:
    //   - ENODATA: the domain resolved but has no MX records — a CONFIRMED
    //     "does not receive mail" answer, same as an empty array would be.
    //   - anything else (ENOTFOUND/NXDOMAIN, timeout, network error, ...):
    //     the domain's mail status is UNCONFIRMED, not known-bad.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENODATA") {
      return { status: "no-mx", hasMx: false, provider: "unknown", mxHosts: [] };
    }
    return { status: "error", hasMx: false, provider: "unknown", mxHosts: [] };
  }
}
