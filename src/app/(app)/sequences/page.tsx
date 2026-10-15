import { getDictionary } from "@/lib/i18n/server";
import { getCurrentBd } from "@/lib/queries";
import { listSequencesForBd } from "@/lib/sequences/pageQueries";
import { SequenceListView } from "./_components/SequenceListView";

export const dynamic = "force-dynamic";

/**
 * The Sequences list (mockups/secuencias-lista.html). Owner-scoped by the read itself: a BD, an admin included, sees only
 * their own Sequences here. One round trip for the page (the shell's getCurrentBd is already paid by the layout).
 */
export default async function SequencesPage() {
  const me = await getCurrentBd();
  const dict = await getDictionary();
  const rows = await listSequencesForBd(me.id);
  return (
    <main className="page">
      <SequenceListView rows={rows} labels={dict.sequences} now={new Date()} />
    </main>
  );
}
