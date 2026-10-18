/**
 * Turns the CRM's answer into a card state. The fetch uses `redirect: "manual"`, so the middleware's 307 to
 * /login arrives as an opaque redirect: any redirect, a 401 or an answer that is not JSON means "not signed
 * in". Anything else unexpected is an error. Nothing is ever invented: a body that does not have the exact
 * shape is an error, not a half-filled card.
 */
import type { LookupResult } from "../shared/messages";

export interface ResponseLike {
  type?: string;
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 300;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.slice(0, MAX_TEXT) : null;
}

function parseBody(body: unknown): LookupResult {
  if (typeof body !== "object" || body === null) return { kind: "error" };
  const data = body as Record<string, unknown>;
  switch (data.state) {
    case "not_found":
      return { kind: "not_found" };
    case "invalid":
      return { kind: "invalid" };
    case "signed_out":
      return { kind: "signed_out" };
    case "found": {
      const name = text(data.name);
      if (typeof data.personId !== "string" || !UUID.test(data.personId) || !name) return { kind: "error" };
      const activity = data.lastActivity as { label?: unknown; date?: unknown } | undefined;
      const label = text(activity?.label);
      const date = text(activity?.date);
      return {
        kind: "found",
        personId: data.personId,
        name,
        jobTitle: text(data.jobTitle),
        company: text(data.company),
        ownerName: text(data.ownerName),
        lastActivity: label && date && !Number.isNaN(Date.parse(date)) ? { label, date } : null,
      };
    }
    default:
      return { kind: "error" };
  }
}

export async function classifyLookupResponse(response: ResponseLike): Promise<LookupResult> {
  if (response.type === "opaqueredirect" || response.status === 0) return { kind: "signed_out" };
  if (response.status >= 300 && response.status < 400) return { kind: "signed_out" };
  if (response.status === 401 || response.status === 403) return { kind: "signed_out" };
  if (!response.ok) return { kind: "error" };
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return { kind: "signed_out" };
  try {
    return parseBody(await response.json());
  } catch {
    return { kind: "error" };
  }
}
