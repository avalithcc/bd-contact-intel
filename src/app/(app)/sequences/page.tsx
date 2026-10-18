import { getDictionary } from "@/lib/i18n/server";
import { getCurrentBd } from "@/lib/queries";
import { isAdminRole } from "@/lib/auth/adminRole";
import { resolveScope, scopeView } from "@/lib/sequences/listScope";
import { listAllSequences, listSequencesForBd } from "@/lib/sequences/pageQueries";
import { SequenceListView } from "./_components/SequenceListView";

export const dynamic = "force-dynamic";

/**
 * The Sequences list (mockups/secuencias-lista.html; the admin view is secuencias-lista-admin.html). A BD sees only their
 * own, by the read itself, and `?scope=` / `?owner=` are resolved server-side so a BD can never ask for others'. An admin
 * gets the tabs Mías (default) and Todas from ONE all-owners read. One round trip for the page (the shell's getCurrentBd
 * is already paid by the layout).
 */
export default async function SequencesPage({ searchParams }: { searchParams: Promise<{ scope?: string; owner?: string }> }) {
  const me = await getCurrentBd();
  const req = resolveScope(me, await searchParams);
  const dict = await getDictionary();
  if (!isAdminRole(me)) {
    return (
      <main className="page">
        <SequenceListView rows={await listSequencesForBd(me.id)} labels={dict.sequences} now={new Date()} />
      </main>
    );
  }
  const view = scopeView(await listAllSequences(me.id), me.id, req);
  return (
    <main className="page">
      <SequenceListView rows={view.rows} labels={dict.sequences} now={new Date()} admin={{ scope: req.scope, meId: me.id, tabs: view.tabs, owners: view.owners, chipOwner: view.chipOwner }} />
    </main>
  );
}
