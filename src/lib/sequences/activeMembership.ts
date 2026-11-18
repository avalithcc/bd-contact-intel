/**
 * "Live in a sequence": a member whose state is NOT in CLOSED_STATES, i.e. drafted, approved or sent. `sent` counts on
 * purpose: step 1 has gone out and the step 2 reminder is still coming, so a second sequence would put two live threads
 * on one person. A contact whose only memberships are replied / no_reply / discarded is free to be sequenced again.
 *
 * One definition for the server guard (rosterQueries) and the picker read (pickerQuery), both derived from CLOSED_STATES.
 */
import { sql, type SQL } from "drizzle-orm";
import { CLOSED_STATES } from "./memberState";

/** The other sequence that holds a contact, as the guard and the picker word it. */
export interface ActiveSequenceHold {
  sequenceName: string;
  ownerBdId: string;
  ownerName: string;
}

export const isActiveMemberState = (state: string): boolean => !(CLOSED_STATES as readonly string[]).includes(state);

/** `<alias>.state` is a live state, as a predicate for raw SQL. */
export const activeMemberStateSql = (alias: string): SQL =>
  sql`${sql.raw(alias)}.state not in (${sql.join(CLOSED_STATES.map((s) => sql`${s}`), sql`, `)})`;
