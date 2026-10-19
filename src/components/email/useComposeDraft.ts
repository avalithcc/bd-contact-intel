import { useCallback, useState } from "react";
import type { ComposeExtras } from "@/lib/email/compose/prepare";
import type { CcDraft, RecipientDraft } from "./RecipientFields";
import { useEmailAttachments } from "./useEmailAttachments";

/**
 * What a composed email carries besides subject and body: the other "Para" contacts, the Cc colleagues and the files. One
 * object so "Enviar correo", "Programar…" and the reschedule dialog share it and it survives moving between dialogs.
 */
export function useComposeDraft() {
  const [others, setOthers] = useState<RecipientDraft[]>([]);
  const [cc, setCc] = useState<CcDraft[]>([]);
  const [ccOpen, setCcOpen] = useState(false);
  const attachments = useEmailAttachments();
  const { clear, discardNew } = attachments;

  /** What the server action receives: ids for Para, plain addresses for Cc, descriptors for files. */
  const extras = (): ComposeExtras => ({
    recipientPersonIds: others.map((o) => o.id),
    ccAddresses: cc.map((c) => c.address),
    attachments: attachments.refs,
  });

  const forget = useCallback(() => {
    setOthers([]);
    setCc([]);
    setCcOpen(false);
  }, []);

  return {
    others,
    setOthers,
    cc,
    setCc,
    ccOpen,
    setCcOpen,
    attachments,
    extras,
    /** The email went out or was scheduled: forget the draft, keep the files (the server deleted or holds them). */
    sent: useCallback(() => {
      forget();
      clear();
    }, [forget, clear]),
    /** The composer was closed without sending: forget the draft and delete what was uploaded for it. */
    discard: useCallback(() => {
      forget();
      discardNew();
    }, [forget, discardNew]),
    /** Load a scheduled email's recipients, Cc and files to edit them. */
    seed: (input: { others: RecipientDraft[]; cc: CcDraft[]; files: Parameters<typeof attachments.seed>[0] }) => {
      setOthers(input.others);
      setCc(input.cc);
      setCcOpen(input.cc.length > 0);
      attachments.seed(input.files);
    },
  };
}

export type ComposeDraft = ReturnType<typeof useComposeDraft>;
