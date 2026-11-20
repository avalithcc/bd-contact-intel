import { notFound } from "next/navigation";
import { TENDERS_ENABLED } from "@/lib/tenders/enabled";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDictionary } from "@/lib/i18n/server";
import { getTenderDetail } from "@/lib/tenders/workspace";
import { analyseTenderAction, registerTenderDocumentAction, saveTenderNoteAction, setTenderOwnerAction, setTenderRequirementStatusAction, setTenderTriageAction } from "../actions";
import { TenderFicha } from "./TenderFicha";

// The admin role gates the page and the day count depends on "now".
export const dynamic = "force-dynamic";

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  // Module on standby (src/lib/tenders/enabled.ts): the page does not exist.
  if (!TENDERS_ENABLED) notFound();
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }
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
      actions={{ saveNote: saveTenderNoteAction, registerDocument: registerTenderDocumentAction, analyse: analyseTenderAction, setTriage: setTenderTriageAction, setOwner: setTenderOwnerAction, setRequirementStatus: setTenderRequirementStatusAction }}
    />
  );
}
