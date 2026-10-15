import { getDictionary } from "@/lib/i18n/server";
import { getCurrentBd } from "@/lib/queries";
import { getSendingAccount, listPickerContacts } from "@/lib/sequences/pageQueries";
import { NewSequenceScreen } from "./NewSequenceScreen";

export const dynamic = "force-dynamic";

/** "Nueva secuencia" (mockups/secuencia-nueva.html): the BD's own connected account and the roster pool, kept with the reason each Contact cannot be added. */
export default async function NewSequencePage() {
  const me = await getCurrentBd();
  const dict = await getDictionary();
  const account = await getSendingAccount(me.id);
  const contacts = await listPickerContacts(dict.sequences.unnamed);
  return (
    <main className="page">
      <NewSequenceScreen contacts={contacts} account={account} labels={dict.sequences} statusLabels={dict.leadStatuses} />
    </main>
  );
}
