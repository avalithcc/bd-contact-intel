/**
 * What a draft generation in flight locks on the Sequence screen (sequence-generating-lock mockup, "Qué se bloquea y qué no").
 *
 * The screen holds ONE id, the member being (re)generated. Everything else is derived from it here, so a control cannot be
 * enabled while another card generates: the cards and the bulk bar ask this module instead of each receiving a boolean.
 *
 *  - Generate / regenerate on ANY card: locked. A second generation is the double-click the owner hit.
 *  - Bulk approve and the header's "Aprobar los N listos": locked. Approving while a draft is rewritten is a race: the
 *    approved text can stop existing a moment later.
 *  - Review / approve of the member being generated: locked, same race on its own draft.
 *  - Review / approve of any OTHER member, remove, open contact, navigation: not locked. They do not touch the draft in flight,
 *    and locking them would punish the BD for waiting.
 */
export type CardLock = {
  /** This card is the one being generated: it shows the spinner. */
  busyHere: boolean;
  generateDisabled: boolean;
  regenerateDisabled: boolean;
  /** Revisar / Aprobar of this card. */
  reviewDisabled: boolean;
};

export type GenerationLock = {
  active: boolean;
  /** Who is being generated, worded for the banner and the lock tooltips. Null when nothing is generating. */
  generatingName: string | null;
  bulkApproveDisabled: boolean;
  card: (memberId: string) => CardLock;
};

type Named = { memberId: string; firstName: string | null; lastName: string | null };

export function generationLock(generatingId: string | null, members: readonly Named[], unnamed: string): GenerationLock {
  const active = generatingId !== null;
  const who = active ? members.find((m) => m.memberId === generatingId) : undefined;
  const generatingName = !active ? null : [who?.firstName, who?.lastName].filter(Boolean).join(" ") || unnamed;
  return {
    active,
    generatingName,
    bulkApproveDisabled: active,
    card: (memberId) => ({ busyHere: generatingId === memberId, generateDisabled: active, regenerateDisabled: active, reviewDisabled: generatingId === memberId }),
  };
}
