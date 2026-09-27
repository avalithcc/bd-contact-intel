/**
 * Outreach channel the message generator writes for. Owner direction
 * (2026-09-26): the generator is email-first — `email` is the default
 * everywhere it's used (record dialog, bulk generation). `linkedin` stays
 * available for the first-touch DM, but LinkedIn conversations are never
 * stored (see messagePrompt.ts and the product-direction note in the
 * change description).
 */

export const OUTREACH_CHANNELS = ["email", "linkedin"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const DEFAULT_OUTREACH_CHANNEL: OutreachChannel = "email";

export function isOutreachChannel(value: string | null | undefined): value is OutreachChannel {
  return !!value && (OUTREACH_CHANNELS as readonly string[]).includes(value);
}
