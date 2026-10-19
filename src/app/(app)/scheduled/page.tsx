import { getDictionary } from "@/lib/i18n/server";
import { pickContactRecordLabels } from "@/lib/contacts/labels";
import { getCurrentBd } from "@/lib/queries";
import { isGmailConnected, listOwnScheduled } from "@/lib/scheduledEmail/queries";
import { ScheduledListView } from "./ScheduledListView";

export const dynamic = "force-dynamic";
// Hosts editScheduledEmailAction, which re-reads attachments from Storage. 60 s matches the contact page (which hosts the
// send actions) and the other routes of this repo; more than the 10 s default of a Vercel function.
export const maxDuration = 60;

/**
 * "Programados" (mockups/envio-programado.html section 3). Every BD, admins included, sees only their own scheduled
 * emails: the read itself is scoped to the session BD. The mailbox state is read only when a dead-token row needs it.
 */
export default async function ScheduledPage() {
  const me = await getCurrentBd();
  const items = await listOwnScheduled(me.id);
  const gmailConnected = items.some((i) => i.status === "failed" && i.error === "gmail_not_connected") ? await isGmailConnected(me.id) : true;
  return (
    <main className="page">
      <ScheduledListView items={items} labels={pickContactRecordLabels(await getDictionary())} gmailConnected={gmailConnected} now={new Date()} />
    </main>
  );
}
