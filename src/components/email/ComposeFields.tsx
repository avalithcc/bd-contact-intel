"use client";

import { useId } from "react";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { CcField, ParaField } from "./RecipientFields";
import type { ComposeDraft } from "./useComposeDraft";

/** The record's contact, as the composer shows it (always the first recipient, never removable). */
export interface ComposePrimary {
  personId: string;
  name: string;
  email: string;
  companyName: string | null;
  hasCompany: boolean;
}

/** "Para" (+ optional "CC") of a composed email. */
export function RecipientBlock({ labels, draft, primary, disabled }: { labels: ContactRecordLabels; draft: ComposeDraft; primary: ComposePrimary; disabled: boolean }) {
  const ccRowId = `${useId()}-cc`;
  return (
    <>
      <ParaField
        labels={labels}
        personId={primary.personId}
        primary={{ name: primary.name, email: primary.email }}
        companyName={primary.companyName}
        hasCompany={primary.hasCompany}
        others={draft.others}
        onChange={draft.setOthers}
        disabled={disabled}
        ccOpen={draft.ccOpen}
        ccRowId={ccRowId}
        onToggleCc={() => draft.setCcOpen(!draft.ccOpen)}
      />
      {draft.ccOpen && (
        <CcField labels={labels} id={ccRowId} items={draft.cc} onChange={draft.setCc} paraAddresses={[primary.email, ...draft.others.map((o) => o.email)]} disabled={disabled} />
      )}
    </>
  );
}
