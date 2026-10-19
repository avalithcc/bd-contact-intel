"use client";

import { useState } from "react";
import { MeetingIcon } from "@/components/icons";
import { OutcomeDialog, type OutcomeEntry } from "@/components/meetings/OutcomeDialog";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { fillTemplate } from "@/lib/i18n/template";

/** One scheduled meeting of the Contact, prepared on the server (the date already formatted) so both sides render the same text. */
export interface RecordMeeting {
  id: string;
  bdName: string;
  scheduledAtIso: string;
  whenText: string;
  notes: string | null;
  /** The viewer owns this meeting. An admin reading another BD's meeting gets no buttons. */
  canMutate: boolean;
  /** Its time has passed and it has no outcome yet ("Por confirmar"). */
  pending: boolean;
}

interface Shared {
  meeting: RecordMeeting;
  personName: string;
  company: string | null;
  labels: ContactRecordLabels;
}

/** The buttons and their dialog: Confirmar (only once the time has passed), Reprogramar and Cancelar. */
function useMeetingActions({ meeting, personName, company, labels }: Shared) {
  const m = labels.meetings;
  const [entry, setEntry] = useState<OutcomeEntry | null>(null);
  const dialog = entry && (
    <OutcomeDialog
      meeting={{
        id: meeting.id,
        contactName: personName,
        company,
        scheduledAtIso: meeting.scheduledAtIso,
        whenText: meeting.whenText,
        notes: meeting.notes,
      }}
      entry={entry}
      labels={m}
      onClose={() => setEntry(null)}
    />
  );
  const buttons = meeting.canMutate && (
    <>
      {meeting.pending && (
        <button type="button" className="btn btn-primary btn-sm" aria-haspopup="dialog" onClick={() => setEntry("confirm")}>
          {m.actionConfirm}
        </button>
      )}
      <button type="button" className="btn btn-secondary btn-sm" aria-haspopup="dialog" onClick={() => setEntry("reschedule")}>
        {m.actionReschedule}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" aria-haspopup="dialog" onClick={() => setEntry("cancel")}>
        {m.actionCancel}
      </button>
    </>
  );
  return { dialog, buttons };
}

/** "Reunión agendada · jue 22 oct, 15:00" under the identity header, with its notes and the buttons (meetings mockup s2). */
export function UpcomingMeetingStrip(props: Shared) {
  const { meeting, labels } = props;
  const m = labels.meetings;
  const { dialog, buttons } = useMeetingActions(props);
  return (
    <>
      <div className="upnext" role="status">
        <MeetingIcon className="icon" />
        <div className="grow">
          <strong>{fillTemplate(meeting.pending ? m.upNextPendingTitle : m.upNextTitle, { when: meeting.whenText })}</strong>
          {meeting.notes && (
            <>
              <br />
              <span className="meta">{meeting.notes}</span>
            </>
          )}
        </div>
        {buttons}
      </div>
      {dialog}
    </>
  );
}

/** The dashed "Próximas" card of the timeline (meetings mockup s2). */
export function UpcomingMeetingCard(props: Shared) {
  const { meeting, labels } = props;
  const m = labels.meetings;
  const { dialog, buttons } = useMeetingActions(props);
  return (
    <div className="tl-item">
      <div className="tl-icon upcoming">
        <MeetingIcon className="icon" />
      </div>
      <div className="tl-card upcoming">
        <div className="tl-head">
          <span className="what">{fillTemplate(m.tlScheduledWhat, { when: meeting.whenText })}</span>
          <span className={`badge ${meeting.pending ? "badge-warn" : "badge-meeting"} no-dot`}>
            {meeting.pending ? m.statusPending : m.statusScheduled}
          </span>
          <span className="when">{fillTemplate(m.tlScheduledBy, { name: meeting.bdName })}</span>
        </div>
        {meeting.notes && <div className="tl-body">{meeting.notes}</div>}
        {buttons && <div className="tl-actions">{buttons}</div>}
      </div>
      {dialog}
    </div>
  );
}
