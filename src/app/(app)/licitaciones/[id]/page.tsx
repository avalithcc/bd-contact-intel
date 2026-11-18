import { notFound } from "next/navigation";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import { getTenderDetail } from "@/lib/tenders/workspace";
import { analyseTenderAction, registerTenderDocumentAction, saveTenderNoteAction, setTenderOwnerAction, setTenderTriageAction } from "../actions";
import { TenderFicha } from "./TenderFicha";

// The session gates the page and the day count depends on "now".
export const dynamic = "force-dynamic";

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  await getCurrentBd();
  const { id } = await params;
  // One round trip: the tender, its documents and its log.
  const detail = await getTenderDetail(id);
  if (!detail) notFound();
  const dict = await getDictionary();
  return (
    <TenderFicha
      detail={detail}
      labels={dict.tenderDetail}
      triageLabels={dict.tendersPage.triage}
      actions={{ saveNote: saveTenderNoteAction, registerDocument: registerTenderDocumentAction, analyse: analyseTenderAction, setTriage: setTenderTriageAction, setOwner: setTenderOwnerAction }}
    />
  );
}
