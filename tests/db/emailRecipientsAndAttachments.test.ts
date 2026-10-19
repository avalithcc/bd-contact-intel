/**
 * email-attachments-recipients against a scratch database (migration 0053 applied). Opt-in and fail-closed:
 * DATABASE_URL must be a local `_e2e` database. Storage is never touched (it cannot run locally). Everything is created
 * under a per-run token and removed.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { assertScratchDatabaseUrl } from "../launch-readiness/scratchDbGuard";

assertScratchDatabaseUrl(process.env.DATABASE_URL);

const run = randomUUID().slice(0, 8);
const bdIds: string[] = [];
const personIds: string[] = [];
const companyKeys: string[] = [];
const aliasKeys: string[] = [];

async function mkBd(name: string) {
  const { db } = await import("@/db");
  const { bd } = await import("@/db/schema");
  const [b] = await db.insert(bd).values({ name: `${name} ${run}`, email: `zz-${name.toLowerCase()}-${run}@example.test` }).returning();
  bdIds.push(b!.id);
  return b!;
}
async function mkCompany(key: string) {
  const { db } = await import("@/db");
  const { company } = await import("@/db/schema");
  const companyKey = `${key}-${run}`;
  await db.insert(company).values({ companyKey, displayName: companyKey });
  companyKeys.push(companyKey);
  return companyKey;
}
async function mkAlias(aliasKey: string, companyKey: string) {
  const { db } = await import("@/db");
  const { companyAlias } = await import("@/db/schema");
  await db.insert(companyAlias).values({ aliasKey, companyKey });
  aliasKeys.push(aliasKey);
}
async function mkPerson(label: string, over: Record<string, unknown> = {}) {
  const { db } = await import("@/db");
  const { person } = await import("@/db/schema");
  const email = `${label}-${run}@prospect.test`;
  const [p] = await db.insert(person).values({ firstName: label, lastName: run, email, emailNormalized: email, ...over }).returning();
  personIds.push(p!.id);
  return p!;
}

after(async () => {
  const { db } = await import("@/db");
  const { bd, person, company, companyAlias } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  if (bdIds.length) await db.delete(bd).where(inArray(bd.id, bdIds)); // cascades scheduled_email and email_attachment
  if (personIds.length) await db.delete(person).where(inArray(person.id, personIds));
  if (aliasKeys.length) await db.delete(companyAlias).where(inArray(companyAlias.aliasKey, aliasKeys));
  if (companyKeys.length) await db.delete(company).where(inArray(company.companyKey, companyKeys));
});

test("Para: contacts of the same company are accepted, in the order picked, record first", async () => {
  const { resolveParaRecipients } = await import("@/lib/email/recipients/queries");
  const key = await mkCompany("acme");
  const a = await mkPerson("a", { companyKey: key });
  const b = await mkPerson("b", { companyKey: key });
  const c = await mkPerson("c", { companyKey: key });
  const r = await resolveParaRecipients(a.id, [c.id, b.id]);
  assert.equal(r.ok && r.recipients.map((x) => x.personId).join(), [a.id, c.id, b.id].join());
  assert.equal(r.ok && r.to, `${a.email}, ${c.email}, ${b.email}`);
});

test("Para: a contact of another company, or with no company, is refused", async () => {
  const { resolveParaRecipients } = await import("@/lib/email/recipients/queries");
  const k1 = await mkCompany("one");
  const k2 = await mkCompany("two");
  const a = await mkPerson("a", { companyKey: k1 });
  const stranger = await mkPerson("s", { companyKey: k2 });
  const loner = await mkPerson("l", { companyKey: null });
  assert.deepEqual(await resolveParaRecipients(a.id, [stranger.id]), { ok: false, reason: "recipient_other_company" });
  assert.deepEqual(await resolveParaRecipients(a.id, [loner.id]), { ok: false, reason: "recipient_other_company" });
  assert.deepEqual(await resolveParaRecipients(loner.id, [a.id]), { ok: false, reason: "recipient_other_company" });
  assert.equal((await resolveParaRecipients(loner.id, [])).ok, true, "a contact without company can only send to itself");
});

test("Para: a person sitting on an alias key counts as the canonical company", async () => {
  const { resolveParaRecipients } = await import("@/lib/email/recipients/queries");
  const key = await mkCompany("brand");
  const aliasKey = `legal-entity-${run}`;
  await mkAlias(aliasKey, key);
  const a = await mkPerson("a", { companyKey: key });
  const onAlias = await mkPerson("b", { companyKey: aliasKey });
  assert.equal((await resolveParaRecipients(a.id, [onAlias.id])).ok, true);
  assert.equal((await resolveParaRecipients(onAlias.id, [a.id])).ok, true);
});

test("Para: a merged-away id resolves to its live survivor; a dangling or unknown id is unavailable", async () => {
  const { resolveParaRecipients } = await import("@/lib/email/recipients/queries");
  const key = await mkCompany("merge");
  const a = await mkPerson("a", { companyKey: key });
  const survivor = await mkPerson("s", { companyKey: key });
  const gone = await mkPerson("g", { companyKey: key, mergedIntoId: survivor.id });
  const r = await resolveParaRecipients(a.id, [gone.id]);
  assert.equal(r.ok && r.recipients.map((x) => x.personId).join(), [a.id, survivor.id].join());
  assert.deepEqual(await resolveParaRecipients(a.id, [randomUUID()]), { ok: false, reason: "recipient_unavailable" });
});

test("Para: a contact without email is refused; duplicate emails collapse", async () => {
  const { resolveParaRecipients } = await import("@/lib/email/recipients/queries");
  const key = await mkCompany("mail");
  const a = await mkPerson("a", { companyKey: key });
  const noMail = await mkPerson("n", { companyKey: key, email: null, emailNormalized: null });
  const twin = await mkPerson("t", { companyKey: key, email: a.email, emailNormalized: a.emailNormalized });
  assert.deepEqual(await resolveParaRecipients(a.id, [noMail.id]), { ok: false, reason: "recipient_no_email" });
  const r = await resolveParaRecipients(a.id, [twin.id]);
  assert.equal(r.ok && r.recipients.length, 1);
});

test("Picker: same-company live contacts (aliases included), not self, not merged, not other companies; no-email ones are listed", async () => {
  const { listParaCandidates } = await import("@/lib/email/recipients/queries");
  const key = await mkCompany("pick");
  const aliasKey = `pick-alias-${run}`;
  await mkAlias(aliasKey, key);
  const other = await mkCompany("pick-other");
  const a = await mkPerson("a", { companyKey: key });
  const b = await mkPerson("b", { companyKey: key, jobTitle: "CTO" });
  const onAlias = await mkPerson("c", { companyKey: aliasKey });
  const noMail = await mkPerson("d", { companyKey: key, email: null, emailNormalized: null });
  await mkPerson("m", { companyKey: key, mergedIntoId: b.id });
  await mkPerson("x", { companyKey: other });
  const list = await listParaCandidates(a.id);
  assert.deepEqual(new Set(list.map((c) => c.id)), new Set([b.id, onAlias.id, noMail.id]));
  assert.equal(list.find((c) => c.id === noMail.id)!.email, null);
  assert.equal(list.find((c) => c.id === b.id)!.jobTitle, "CTO");
  // Seen from the alias side the answer is the same company.
  assert.deepEqual(new Set((await listParaCandidates(onAlias.id)).map((c) => c.id)), new Set([a.id, b.id, noMail.id]));
  const loner = await mkPerson("l", { companyKey: null });
  assert.deepEqual(await listParaCandidates(loner.id), []);
});

test("Attachments sweeper selects orphans over 24 h, cancelled over 30 days and sent leftovers, and nothing else", async () => {
  const { db } = await import("@/db");
  const { emailAttachment, scheduledEmail } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");
  const { selectSweepable, markAttachmentsRemoved } = await import("@/lib/email/attachments/queries");
  const owner = await mkBd("Sweep");
  const p = await mkPerson("sweep");
  const uid = randomUUID();
  async function mkSched(status: string, updatedAgo: string) {
    const [row] = await db.insert(scheduledEmail).values({ bdId: owner.id, personId: p.id, toAddress: "x@prospect.test", subject: "s", body: "b", sendAt: sql`now() + interval '1 day'`, status }).returning({ id: scheduledEmail.id });
    await db.execute(sql.raw(`update scheduled_email set updated_at = now() - interval '${updatedAgo}' where id = '${row!.id}'`));
    return row!.id;
  }
  async function mkFile(tag: string, createdAgo: string, scheduledEmailId: string | null) {
    const storagePath = `${uid}/${randomUUID()}/${tag}.pdf`;
    await db.insert(emailAttachment).values({ bdId: owner.id, ownerAuthUid: uid, storagePath, filename: `${tag}.pdf`, contentType: "application/pdf", sizeBytes: 10, scheduledEmailId });
    await db.execute(sql.raw(`update email_attachment set created_at = now() - interval '${createdAgo}' where storage_path = '${storagePath}'`));
    return storagePath;
  }
  const oldOrphan = await mkFile("old-orphan", "25 hours", null);
  await mkFile("new-orphan", "2 hours", null);
  const cancelledOld = await mkFile("cancelled-old", "40 days", await mkSched("cancelled", "31 days"));
  await mkFile("cancelled-recent", "40 days", await mkSched("cancelled", "2 days"));
  const sentLeft = await mkFile("sent", "1 hour", await mkSched("sent", "1 hour"));
  await mkFile("scheduled", "40 days", await mkSched("scheduled", "40 days"));
  await mkFile("failed", "40 days", await mkSched("failed", "40 days"));
  await mkFile("held", "40 days", await mkSched("on_hold", "40 days"));
  const alreadyGone = await mkFile("gone", "90 days", null);
  await markAttachmentsRemoved([alreadyGone]);

  const mine = (await selectSweepable(500)).map((c) => c.storagePath).filter((s) => s.startsWith(`${uid}/`));
  assert.deepEqual(new Set(mine), new Set([oldOrphan, cancelledOld, sentLeft]));

  await markAttachmentsRemoved(mine);
  assert.equal((await selectSweepable(500)).filter((c) => c.storagePath.startsWith(`${uid}/`)).length, 0);
});

test("Deleting a scheduled email turns its files into orphans instead of losing track of them", async () => {
  const { db } = await import("@/db");
  const { emailAttachment, scheduledEmail } = await import("@/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const owner = await mkBd("Orphan");
  const p = await mkPerson("orphan");
  const uid = randomUUID();
  const [s] = await db.insert(scheduledEmail).values({ bdId: owner.id, personId: p.id, toAddress: "x@prospect.test", subject: "s", body: "b", sendAt: sql`now() + interval '1 day'` }).returning({ id: scheduledEmail.id });
  const storagePath = `${uid}/${randomUUID()}/f.pdf`;
  await db.insert(emailAttachment).values({ bdId: owner.id, ownerAuthUid: uid, storagePath, filename: "f.pdf", contentType: "application/pdf", sizeBytes: 1, scheduledEmailId: s!.id });
  await db.delete(scheduledEmail).where(eq(scheduledEmail.id, s!.id));
  const [row] = await db.select().from(emailAttachment).where(eq(emailAttachment.storagePath, storagePath));
  assert.ok(row, "the bookkeeping row survives");
  assert.equal(row!.scheduledEmailId, null);
});

test("setScheduledAttachments links the wanted files and unlinks the dropped ones", async () => {
  const { db } = await import("@/db");
  const { emailAttachment, scheduledEmail } = await import("@/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { setScheduledAttachments, listScheduledAttachments } = await import("@/lib/email/attachments/queries");
  const { validateAttachmentRefs } = await import("@/lib/email/attachments/load");
  const { buildAttachmentPath } = await import("@/lib/email/attachments/storagePath");
  const owner = await mkBd("Link");
  const p = await mkPerson("link");
  const uid = randomUUID();
  const [s] = await db.insert(scheduledEmail).values({ bdId: owner.id, personId: p.id, toAddress: "x@prospect.test", subject: "s", body: "b", sendAt: sql`now() + interval '1 day'` }).returning({ id: scheduledEmail.id });
  const ref = (name: string) => ({ storagePath: buildAttachmentPath(uid, randomUUID(), name), filename: name, contentType: "application/pdf", size: 10 });
  const [r1, r2, r3] = [ref("a.pdf"), ref("b.pdf"), ref("c.pdf")];
  const first = validateAttachmentRefs([r1!, r2!], uid);
  assert.ok(first.ok);
  await db.transaction((tx) => setScheduledAttachments(tx, s!.id, owner.id, uid, first.items));
  assert.deepEqual((await listScheduledAttachments([s!.id])).map((r) => r.filename).sort(), ["a.pdf", "b.pdf"]);
  const second = validateAttachmentRefs([r2!, r3!], uid);
  assert.ok(second.ok);
  await db.transaction((tx) => setScheduledAttachments(tx, s!.id, owner.id, uid, second.items));
  assert.deepEqual((await listScheduledAttachments([s!.id])).map((r) => r.filename).sort(), ["b.pdf", "c.pdf"]);
  const [dropped] = await db.select().from(emailAttachment).where(eq(emailAttachment.storagePath, r1!.storagePath));
  assert.equal(dropped!.scheduledEmailId, null, "the dropped file is an orphan for the sweeper");
});

test("recordSentEmail writes ONE email_message and one email_sent per Para contact, and every one becomes Contactado", async () => {
  const { db } = await import("@/db");
  const { activity, emailMessage, emailMessagePerson, person } = await import("@/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { recordSentEmail } = await import("@/lib/gmail/sentEmailQueries");
  const sender = await mkBd("Sender");
  const key = await mkCompany("fanout");
  const a = await mkPerson("a", { companyKey: key });
  const b = await mkPerson("b", { companyKey: key });
  const c = await mkPerson("c", { companyKey: key });
  const gmailMessageId = `gm-${run}`;
  const metadata = { to: [a.email, b.email, c.email], cc: ["ana@avalith.net"], subject: "Hola", gmailMessageId, gmailThreadId: `th-${run}`, attachments: [{ filename: "Propuesta.pdf", size: 10 }] };
  await recordSentEmail({
    bdId: sender.id,
    message: { bdEmail: sender.email, to: `${a.email}, ${b.email}, ${c.email}`, subject: "Hola", content: { body: "Texto" }, cc: ["ana@avalith.net"], gmailMessageId, gmailThreadId: `th-${run}`, metadata: null },
    activity: { type: "email_sent", personId: a.id, actorBdId: sender.id, metadata } as never,
    alsoRecordFor: [b.id, c.id],
  });
  const messages = await db.select().from(emailMessage).where(eq(emailMessage.gmailMessageId, gmailMessageId));
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0]!.ccAddresses, ["ana@avalith.net"]);
  const links = await db.select().from(emailMessagePerson).where(eq(emailMessagePerson.emailMessageId, messages[0]!.id));
  assert.deepEqual(new Set(links.map((l) => l.personId)), new Set([a.id, b.id, c.id]), "the colleague in Cc is not linked as a contact");
  const acts = await db.select().from(activity).where(inArray(activity.personId, [a.id, b.id, c.id]));
  assert.equal(acts.length, 3);
  assert.ok(acts.every((x) => x.type === "email_sent" && (x.metadata as Record<string, unknown>).emailMessageId === messages[0]!.id));
  assert.deepEqual(new Set(acts.map((x) => x.personId)), new Set([a.id, b.id, c.id]));
  const rows = await db.select({ id: person.id, status: person.status }).from(person).where(inArray(person.id, [a.id, b.id, c.id]));
  assert.ok(rows.every((r) => r.status === "contacted"), JSON.stringify(rows));
  await db.delete(emailMessage).where(eq(emailMessage.gmailMessageId, gmailMessageId));
});

test("a scheduled email keeps its other recipients, Cc and files; the card reads them, the claim hands them to the sender", async () => {
  const { scheduleEmail, editScheduled, listScheduledForPerson, claimDue, cancelScheduled } = await import("@/lib/scheduledEmail/queries");
  const { validateAttachmentRefs } = await import("@/lib/email/attachments/load");
  const { buildAttachmentPath } = await import("@/lib/email/attachments/storagePath");
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const owner = await mkBd("Compose");
  const key = await mkCompany("sched");
  const a = await mkPerson("a", { companyKey: key });
  const b = await mkPerson("b", { companyKey: key, firstName: "Beatriz", lastName: "Paz" });
  const uid = randomUUID();
  const ref = (name: string, size: number) => ({ storagePath: buildAttachmentPath(uid, randomUUID(), name), filename: name, contentType: "application/pdf", size });
  const checked = validateAttachmentRefs([ref("Propuesta.pdf", 2_000_000), ref("Tarifas.pdf", 100)], uid);
  assert.ok(checked.ok);
  const scheduled = await scheduleEmail({
    bdId: owner.id, personId: a.id, toAddress: a.email!, subject: "Seguimiento", body: "Texto", sendAt: new Date(Date.now() + 60 * 60_000),
    compose: { recipientPersonIds: [b.id], ccAddresses: ["ana@avalith.net"], attachments: checked.items, ownerAuthUid: uid },
  });
  assert.ok(scheduled.ok);
  const [item] = await listScheduledForPerson(a.id, owner.id);
  assert.deepEqual(item!.attachments.map((f) => [f.filename, f.size, f.contentType, f.storagePath.startsWith(`${uid}/`)]), [["Propuesta.pdf", 2_000_000, "application/pdf", true], ["Tarifas.pdf", 100, "application/pdf", true]], "files come back in the order they were attached");
  assert.deepEqual(item!.otherRecipients, [{ id: b.id, name: "Beatriz Paz", email: b.email }]);
  assert.deepEqual(item!.ccAddresses, ["ana@avalith.net"]);

  // Editing replaces the files and Cc, and drops the other recipients when none are sent.
  const only = validateAttachmentRefs([checked.items[1]!], uid);
  assert.ok(only.ok);
  assert.deepEqual(await editScheduled({ id: scheduled.id, bdId: owner.id, subject: "Seguimiento", body: "Texto", sendAt: new Date(Date.now() + 90 * 60_000), compose: { recipientPersonIds: [], ccAddresses: [], attachments: only.items, ownerAuthUid: uid } }), { ok: true });
  const [edited] = await listScheduledForPerson(a.id, owner.id);
  assert.deepEqual(edited!.attachments.map((f) => f.filename), ["Tarifas.pdf"]);
  assert.deepEqual(edited!.otherRecipients, []);
  assert.deepEqual(edited!.ccAddresses, []);

  // Editing WITHOUT compose leaves all of it as it was.
  assert.deepEqual(await editScheduled({ id: scheduled.id, bdId: owner.id, subject: "Otro asunto", body: "Texto", sendAt: new Date(Date.now() + 90 * 60_000) }), { ok: true });
  assert.deepEqual((await listScheduledForPerson(a.id, owner.id))[0]!.attachments.map((f) => f.filename), ["Tarifas.pdf"]);

  // Due: the claim carries the files (with the owner uid the cron checks).
  await db.execute(sql.raw(`update scheduled_email set send_at = now() - interval '1 minute' where id = '${scheduled.id}'`));
  const claimed = (await claimDue(50)).filter((c) => c.id === scheduled.id);
  assert.equal(claimed.length, 1);
  assert.deepEqual(claimed[0]!.attachments.map((x) => [x.filename, x.ownerAuthUid, x.bdId]), [["Tarifas.pdf", uid, owner.id]]);
  assert.deepEqual(claimed[0]!.recipientPersonIds, []);
  void cancelScheduled;
});

test("a file already held by another scheduled email is never taken over", async () => {
  const { scheduleEmail } = await import("@/lib/scheduledEmail/queries");
  const { listScheduledAttachments } = await import("@/lib/email/attachments/queries");
  const { validateAttachmentRefs } = await import("@/lib/email/attachments/load");
  const { buildAttachmentPath } = await import("@/lib/email/attachments/storagePath");
  const owner = await mkBd("Steal");
  const p = await mkPerson("steal");
  const uid = randomUUID();
  const checked = validateAttachmentRefs([{ storagePath: buildAttachmentPath(uid, randomUUID(), "x.pdf"), filename: "x.pdf", contentType: "application/pdf", size: 10 }], uid);
  assert.ok(checked.ok);
  const input = { bdId: owner.id, personId: p.id, toAddress: p.email!, subject: "s", body: "b", sendAt: new Date(Date.now() + 60 * 60_000) };
  const compose = { recipientPersonIds: [], ccAddresses: [], attachments: checked.items, ownerAuthUid: uid };
  const first = await scheduleEmail({ ...input, compose });
  assert.ok(first.ok);
  // The second email cannot take the file: scheduling REFUSES (it would otherwise go out without the file the BD attached),
  // and the transaction leaves no second row behind.
  const { AttachmentLinkError } = await import("@/lib/email/attachments/errors");
  await assert.rejects(scheduleEmail({ ...input, compose }), (e: unknown) => e instanceof AttachmentLinkError);
  assert.equal((await listScheduledAttachments([first.id])).length, 1, "the file stays with the first email");
  const { db } = await import("@/db");
  const { scheduledEmail } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  assert.equal((await db.select().from(scheduledEmail).where(eq(scheduledEmail.personId, p.id))).length, 1);
  assert.equal((await db.select().from(scheduledEmail).where(eq(scheduledEmail.personId, p.id)))[0]!.attachmentCount, 1);
});

test("recordSentEmail for a single contact still writes exactly one activity", async () => {
  const { db } = await import("@/db");
  const { activity } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { recordSentEmail } = await import("@/lib/gmail/sentEmailQueries");
  const sender = await mkBd("Single");
  const a = await mkPerson("solo", { companyKey: null });
  const gmailMessageId = `gm-solo-${run}`;
  await recordSentEmail({
    bdId: sender.id,
    message: { bdEmail: sender.email, to: a.email!, subject: "Hola", content: { body: "Texto" }, gmailMessageId, gmailThreadId: `th-${run}`, metadata: null },
    activity: { type: "email_sent", personId: a.id, actorBdId: sender.id, metadata: { to: a.email, subject: "Hola", gmailMessageId, gmailThreadId: `th-${run}` } } as never,
  });
  assert.equal((await db.select().from(activity).where(eq(activity.personId, a.id))).length, 1);
});
