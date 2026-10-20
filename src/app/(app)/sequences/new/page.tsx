import { getDictionary } from "@/lib/i18n/server";
import { getCurrentBd } from "@/lib/queries";
import { getSendingAccount, listPickerPage } from "@/lib/sequences/pageQueries";
import { DEFAULT_PICKER_QUERY } from "@/lib/sequences/pickerFilters";
import { NewSequenceScreen } from "./NewSequenceScreen";

export const dynamic = "force-dynamic";

/** "Nueva secuencia" (mockups/secuencia-nueva.html): the BD's own connected account and the first page of the contact picker (every live contact with an email; the rest loads on demand). */
export default async function NewSequencePage() {
  const me = await getCurrentBd();
  const dict = await getDictionary();
  const account = await getSendingAccount(me.id);
  const firstPage = await listPickerPage(DEFAULT_PICKER_QUERY, me.id, dict.sequences.unnamed);
  return (
    <main className="page">
      <NewSequenceScreen firstPage={firstPage} account={account} labels={dict.sequences} statusLabels={dict.leadStatuses} />
    </main>
  );
}
