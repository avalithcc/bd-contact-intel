import { MailIcon } from "@/components/icons";
import { bounceEntryText } from "@/lib/contacts/bounceView";
import type { BounceEntryMetadata } from "@/lib/gmail/bouncePlan";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { fill } from "@/lib/sequences/viewText";

/**
 * One `email_bounced` timeline entry (contact-bounce mockup, sections 2 and 3). A hard bounce is a normal card with the
 * danger icon, the "Rebotado" badge and the effects as chips; a soft one is the neutral dotted `tl-card system` with
 * the "Temporal" badge and no chips. Only existing design-system classes.
 */
export function BounceTimelineCard({ meta, when, labels: l }: { meta: BounceEntryMetadata; when: string; labels: ContactRecordLabels }) {
  const text = bounceEntryText(meta, l);
  const hard = meta.severity === "hard";
  const scheduled = meta.scheduledCancelled ?? 0;
  const effects = hard
    ? [
        ...(meta.sequenceNames ?? []).map((name) => fill(l.timelineBouncedEffectSequence, { name })),
        ...(scheduled > 0 ? [scheduled === 1 ? l.timelineBouncedEffectScheduledOne : fill(l.timelineBouncedEffectScheduledMany, { count: scheduled })] : []),
        ...(meta.suppressed ? [l.timelineBouncedEffectSuppressed] : []),
      ]
    : [];
  return (
    <div className="tl-item">
      <div className={hard ? "tl-icon discard" : "tl-icon system"}>
        <MailIcon className="icon" />
      </div>
      <div className={hard ? "tl-card" : "tl-card system"}>
        <div className="tl-head">
          <span className="what">{text.headline}</span>
          <span className={hard ? "badge badge-danger no-dot" : "badge badge-neutral no-dot"}>{hard ? l.timelineBouncedBadgeHard : l.timelineBouncedBadgeSoft}</span>
          <span className="when">{when}</span>
        </div>
        <div className="tl-body">
          {text.body}
          {meta.originalSubject && (
            <>
              {" "}
              {l.timelineBouncedOriginalSubject}: <strong>{meta.originalSubject}</strong>
            </>
          )}
          {effects.length > 0 && (
            <div className="row wrap mt-md">
              {effects.map((effect) => (
                <span key={effect} className="chip">
                  <span className="k">{l.timelineBouncedEffectLabel}</span> {effect}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
