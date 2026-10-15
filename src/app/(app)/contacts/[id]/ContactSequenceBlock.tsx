"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { contactContextView, optOutErrorKey, type ContactMembership } from "@/lib/sequences/contactContext";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import { OptOutDialog } from "../../sequences/_components/OptOutDialog";
import { SequenceContext } from "../../sequences/_components/SequenceContext";
import { recordOptOut } from "../../sequences/actions";

/**
 * The Contact record's "Secuencias" block with its "No contactar" flow. `memberships` is every membership of this
 * Contact's EMAIL ADDRESS (listContactMemberships), the same key the opt-out write uses. Renders nothing for a Contact
 * in no Sequence.
 */
export function ContactSequenceBlock({ memberships, email, now, labels: l }: { memberships: readonly ContactMembership[]; email: string | null; now: Date; labels: SequenceLabels }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ownLiveCount } = contactContextView(memberships);

  function close() {
    setMemberId(null);
    setError(null);
  }
  async function confirm() {
    if (!memberId) return;
    setBusy(true);
    try {
      const r = await recordOptOut(memberId);
      if (!r.ok) return setError(l[optOutErrorKey(r.error)]);
      showToast(r.discarded === 1 ? l.toastOptOutOne : fill(l.toastOptOut, { n: r.discarded }), "success");
      close();
      router.refresh();
    } catch {
      setError(l.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SequenceContext memberships={memberships} now={now} labels={l} onAction={(a) => { setError(null); setMemberId(a.memberId); }} />
      <OptOutDialog open={memberId !== null} email={email} ownLiveCount={ownLiveCount} labels={l} onClose={close} onConfirm={confirm} busy={busy} error={error} />
    </>
  );
}
