/**
 * Pure planning for an opt-out: which of an address's memberships get discarded. Reused by the unsubscribe POST and
 * by the BD's "No contactar" action (PR 10) so both go through the same state machine.
 */
import { canTransition, MEMBER_STATES, type MemberState } from "@/lib/sequences/memberState";

export const OPT_OUT_DISCARD_REASON = "opt_out";

export interface MembershipRef {
  id: string;
  state: string;
}

function isMemberState(state: string): state is MemberState {
  return (MEMBER_STATES as readonly string[]).includes(state);
}

/** Ids whose `opt_out` transition to `discarded` the state machine allows. Unknown states are never touched. */
export function planOptOutDiscards(memberships: readonly MembershipRef[]): string[] {
  return memberships
    .filter((m) => isMemberState(m.state) && canTransition(m.state, "discarded", "opt_out"))
    .map((m) => m.id);
}
