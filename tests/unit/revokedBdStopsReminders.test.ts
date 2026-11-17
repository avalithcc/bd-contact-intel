/**
 * Revoking a BD must stop the automated Gmail reminders.
 *
 * `src/lib/gmail/reminderRows.ts` has long said the flag is off "for the e2e test accounts (and any BD who left)" —
 * but nothing performed the second half. A departing BD stayed `email_reminders_enabled = true`, kept receiving
 * "reconnect your Gmail" mail, and at the third reminder the system emails the OWNER about someone who no longer
 * works here. It happened to a real person on 2026-11-11: her mailbox was disconnected, two reminders went out, and
 * the owner found it himself.
 *
 * The comment described an invariant nobody enforced. These two tests are the enforcement: one that the planner
 * honours the flag, one that revoking actually clears it.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { planGmailReminders, planManualReminder, type ReminderCandidate } from "@/lib/gmail/reminderPlan";

const NOW = new Date("2026-11-17T12:00:00Z");

/** A BD who would otherwise be due a reminder: not an admin, Gmail unhealthy, long past the first interval. */
const due = (over: Partial<ReminderCandidate> = {}): ReminderCandidate =>
  ({
    bdId: "bd-1",
    role: "bd",
    excluded: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastSeenAt: new Date("2026-11-01T00:00:00Z"),
    gmailUnhealthy: true,
    sentReminders: [],
    ...over,
  }) as ReminderCandidate;

describe("a revoked BD stops receiving reminders", () => {
  it("the scheduled run would otherwise send to this candidate", () => {
    const [plan] = planGmailReminders([due()], NOW);
    assert.equal(plan!.action, "send", "precondition: without the flag they are due, or the next test proves nothing");
  });

  it("and skips them once reminders are switched off", () => {
    const [plan] = planGmailReminders([due({ excluded: true })], NOW);
    assert.deepEqual([plan!.action, plan!.action === "skip" ? plan!.reason : null], ["skip", "excluded"]);
  });

  it("the exclusion wins at the third reminder too, the one that emails the owner", () => {
    // The series only counts reminders sent AFTER lastSeenAt, so these two are hers.
    const sent = [new Date("2026-11-05T12:00:00Z"), new Date("2026-11-10T12:00:00Z")];
    const third = planManualReminder(due({ sentReminders: sent }), NOW);
    assert.deepEqual([third.action, third.action === "send" ? third.number : null], ["send", 3]);
    assert.equal(third.action === "send" && third.notifyOwner, true, "the third is the one that emails the owner");
    assert.equal(planManualReminder(due({ sentReminders: sent, excluded: true }), NOW).action, "skip");
  });

  /**
   * Source-level on purpose: the write lives in a script that calls the Supabase admin API, which a unit test cannot
   * reach. Checking the behaviour is impossible here; checking that the script still performs the write is not, and
   * its absence is exactly the defect this file exists for.
   */
  it("revoke-bd-access.ts turns the flag off as part of revoking", () => {
    const source = readFileSync("scripts/revoke-bd-access.ts", "utf8");
    assert.match(source, /\.set\(\{\s*emailRemindersEnabled:\s*false\s*\}\)/, "the revoke script must clear the flag");
    assert.match(source, /emailRemindersTurnedOff/, "and the audit row must record whether it did");
  });
});
