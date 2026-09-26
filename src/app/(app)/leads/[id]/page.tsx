import { notFound, redirect } from "next/navigation";
import { resolveLegacyRedirectTarget } from "@/lib/contacts/legacyRedirect";

export const dynamic = "force-dynamic";

interface LeadDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Redirects to the unified `/contacts/[id]` record (task 11.4; design D8;
 * contact-record spec "Legacy route redirects"). Own-company leads
 * (`person_id` null in `person_id_map`) and unmapped ids answer 404 — see
 * resolveLegacyRedirectTarget.
 *
 * This page used to render the lead detail directly (activity timeline,
 * Gmail composer, task quick-add, manual signal paste). The record page
 * (/contacts/[id]) now covers all of it, including "Pegar señal" (task
 * 11.6, QuickActions.tsx) closing the gap flagged in PR 11c.
 */
export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const { id } = await params;

  const target = await resolveLegacyRedirectTarget("lead", id);
  if (!target) notFound();
  redirect(`/contacts/${target}`);
}
