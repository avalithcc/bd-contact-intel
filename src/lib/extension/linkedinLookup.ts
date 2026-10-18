/**
 * Decisions of GET /api/extension/linkedin-lookup?url=… (the LinkedIn extension's only CRM read). Port-injected
 * so the privacy-critical ordering is unit-testable without a database: the session is checked FIRST, and a
 * request without a usable session never reaches a lookup, so it can never return person data.
 *
 * Paths in the answer are relative on purpose: the extension joins them to the CRM origin it was configured
 * for and refuses anything that does not match the two shapes below, so the server cannot send a BD elsewhere.
 */
import { parseCaptureUrl } from "@/lib/contacts/linkedinCapture";

export interface LinkedinPersonCard {
  personId: string;
  name: string;
  jobTitle: string | null;
  company: string | null;
  ownerName: string | null;
  lastActivity: { label: string; date: string } | null;
}

export interface LinkedinLookupPorts {
  hasSession(): Promise<boolean>;
  findLivePersonId(profileKey: string): Promise<string | null>;
  loadCard(personId: string): Promise<LinkedinPersonCard | null>;
}

export type LinkedinLookupBody =
  | { state: "signed_out" }
  | { state: "invalid" }
  | { state: "not_found"; addUrl: string }
  | (Omit<LinkedinPersonCard, "lastActivity"> & {
      state: "found";
      lastActivity?: { label: string; date: string };
      viewUrl: string;
    });

export interface LinkedinLookupResponse {
  status: number;
  body: LinkedinLookupBody;
}

export async function runLinkedinLookup(
  rawUrl: string | null,
  ports: LinkedinLookupPorts,
): Promise<LinkedinLookupResponse> {
  if (!(await ports.hasSession())) return { status: 401, body: { state: "signed_out" } };

  const parsed = parseCaptureUrl(rawUrl);
  if (!parsed.ok) return { status: 200, body: { state: "invalid" } };

  const personId = await ports.findLivePersonId(parsed.profileKey);
  const card = personId ? await ports.loadCard(personId) : null;
  if (!card) {
    return {
      status: 200,
      body: { state: "not_found", addUrl: `/contacts?new=1&linkedin=${encodeURIComponent(parsed.linkedinUrl)}` },
    };
  }
  const { lastActivity, ...rest } = card;
  return {
    status: 200,
    body: { state: "found", ...rest, ...(lastActivity ? { lastActivity } : {}), viewUrl: `/contacts/${card.personId}` },
  };
}
