import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n/server";
import { getCurrentBd } from "@/lib/queries";
import { getSequenceDetail } from "@/lib/sequences/detailQueries";
import { listReplyPhrases } from "@/lib/sequences/pageQueries";
import { SequenceDetailScreen } from "./SequenceDetailScreen";

export const dynamic = "force-dynamic";
// "Enviar ahora" releases right inside the server action that approves (a few Gmail sends in sequence), so allow more than the default.
export const maxDuration = 60;

/**
 * A Sequence (mockups/secuencia-detalle.html). The owner reads their own; an admin may read another BD's, as a read-only
 * screen (mockups/secuencia-detalle-solo-lectura.html) and with no audit row. Anyone else, and a malformed id, is a 404
 * that does not reveal whether the Sequence exists.
 *
 * The advisory opt-out phrases come from the OWNER's own mailbox only: an admin reading someone else's Sequence does not
 * read that BD's mail through this page.
 */
export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentBd();
  const detail = await getSequenceDetail(me, id);
  if (!detail) notFound();
  const dict = await getDictionary();
  const replied = detail.members.filter((m) => m.state === "replied").map((m) => m.memberId);
  const optOutPhrases = detail.ownerBdId === me.id ? await listReplyPhrases(me.id, replied) : {};
  return (
    <main className="page">
      <SequenceDetailScreen detail={detail} labels={dict.sequences} sendLabels={dict.sendControl} now={new Date()} viewerBdId={me.id} optOutPhrases={optOutPhrases} />
    </main>
  );
}
