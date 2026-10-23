"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { DAILY_SEND_CAP_CEILING } from "@/lib/sequences/capValidation";
import type { PickerPage } from "@/lib/sequences/pickerFilters";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import { addMembers, createSequence, loadPickerPage } from "../actions";
import type { CreateSequenceIntent } from "../_components/actions";
import { SequenceCreateForm } from "../_components/SequenceCreateForm";

/**
 * The container of /sequences/new. The form reports the validated values; this creates the Sequence and then adds the
 * members, and both re-run every rule on the server, so nothing the form showed is trusted. A Contact the server
 * refuses is never dropped silently: the BD lands on the new Sequence with a toast that says how many were left out.
 * A failure stays on the form with the reason.
 */
export function NewSequenceScreen({ firstPage, account, labels: l, statusLabels }: { firstPage: PickerPage; account: { id: string; address: string } | null; labels: SequenceLabels; statusLabels: Dictionary["leadStatuses"] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(intent: CreateSequenceIntent) {
    if (!account) return;
    setBusy(true);
    setError(null);
    // Stays busy once the Sequence exists: re-enabling the button while the navigation is pending would create a second one.
    let navigating = false;
    try {
      const created = await createSequence({ name: intent.name, emailAccountId: account.id, dailySendCap: intent.dailySendCap });
      if (!created.ok) {
        setError(created.error === "name_required" ? l.newNameError : created.error === "account_not_owned" ? l.createErrorAccount : fill(created.error === "above_ceiling" ? l.newCapCeiling : l.newCapInvalid, { max: DAILY_SEND_CAP_CEILING }));
        return;
      }
      const added = await addMembers(created.sequenceId, intent.personIds);
      const left = added.ok ? added.rejected.length : intent.personIds.length;
      if (left > 0) showToast(fill(left === 1 ? l.createdPartialOne : l.createdPartial, { n: left }), "error");
      navigating = true;
      router.push(`/sequences/${created.sequenceId}`);
    } catch {
      setError(l.actionFailed);
    } finally {
      if (!navigating) setBusy(false);
    }
  }

  return <SequenceCreateForm contacts={firstPage.contacts} hasMore={firstPage.hasMore} loadPage={loadPickerPage} industryCounts={firstPage.industryCounts} account={account} labels={l} statusLabels={statusLabels} onSubmit={submit} busy={busy} error={error} />;
}
