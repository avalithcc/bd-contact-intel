"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { FollowUpIcon } from "@/components/icons";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { formatSendAt, planSchedule, wallTimeToInstant, type ZoneKey } from "@/lib/scheduledEmail/plan";
import { addDaysToDateString, argentinaCalendarDate } from "@/lib/tasks/argentinaDate";

const ART_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Approved mockup envio-programado.html, view 1b: date/time/zone picker. The time is read as Argentina by default. */
export function ScheduleEmailDialog(props: {
  labels: ContactRecordLabels;
  name: string;
  subject: string;
  body: string;
  busy: boolean;
  error: string | null;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onBack: () => void;
  onCancel: () => void;
  onSubmit: (sendAt: Date) => void;
}) {
  const { labels: l, busy } = props;
  const ids = useId();
  const today = argentinaCalendarDate(new Date());
  const [date, setDate] = useState(addDaysToDateString(today, 1));
  const [time, setTime] = useState("09:00");
  const [zone, setZone] = useState<ZoneKey>("argentina");

  const sendAt = wallTimeToInstant(date, time, zone);
  const plan = sendAt ? planSchedule({ sendAt, now: new Date(), pendingCount: 0 }) : null;
  const tooSoon = !plan || (!plan.ok && plan.reason === "schedule_too_soon");
  const canSubmit = !busy && !!sendAt && !!plan?.ok && !!props.subject.trim() && !!props.body.trim();

  function preset(at: Date | null, fallbackTime: string, fallbackDate: string) {
    setZone("argentina");
    setDate(at ? new Date(at.getTime() - ART_OFFSET_MS).toISOString().slice(0, 10) : fallbackDate);
    setTime(at ? new Date(at.getTime() - ART_OFFSET_MS).toISOString().slice(11, 16) : fallbackTime);
  }

  return (
    <Dialog
      open
      wide
      onClose={props.onCancel}
      closeDisabled={busy}
      title={`${l.scheduleTitle} ${props.name}`}
      footer={
        <>
          <button type="button" className="btn btn-ghost left" onClick={props.onBack} disabled={busy}>
            {l.scheduleBack}
          </button>
          <button type="button" className="btn btn-secondary" onClick={props.onCancel} disabled={busy}>
            {l.cancel}
          </button>
          <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => sendAt && props.onSubmit(sendAt)}>
            <FollowUpIcon className="icon" />
            {l.scheduleSubmit}
          </button>
        </>
      }
    >
      {props.error && <div className="error-text" role="alert">{props.error}</div>}
      <div className="field">
        <label className="label" htmlFor={`${ids}-subject`}>{l.emailSubjectLabel}</label>
        <input id={`${ids}-subject`} className="input" value={props.subject} onChange={(e) => props.onSubjectChange(e.target.value)} disabled={busy} />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${ids}-body`}>{l.emailBodyLabel}</label>
        <textarea id={`${ids}-body`} className="textarea" rows={3} value={props.body} onChange={(e) => props.onBodyChange(e.target.value)} disabled={busy} />
      </div>
      <div className="fieldset">
        <div className="label" id={`${ids}-when`}>{l.scheduleWhen}</div>
        <div className="row wrap mt-md" role="group" aria-labelledby={`${ids}-when`}>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => preset(new Date(Date.now() + 60 * 60_000), "", "")}>{l.schedulePresetHour}</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => preset(null, "17:00", today)}>{l.schedulePresetToday}</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => preset(null, "09:00", addDaysToDateString(today, 1))}>{l.schedulePresetTomorrow}</button>
        </div>
        <div className="form-grid mt-lg">
          <div className="field">
            <label className="label" htmlFor={`${ids}-date`}>{l.scheduleDate}</label>
            <input id={`${ids}-date`} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${ids}-time`}>{l.scheduleTime}</label>
            <input id={`${ids}-time`} className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={busy} />
          </div>
        </div>
        <div className="field mt-lg">
          <label className="label" htmlFor={`${ids}-zone`}>{l.scheduleZone}</label>
          <select id={`${ids}-zone`} className="select input" value={zone} onChange={(e) => setZone(e.target.value as ZoneKey)} disabled={busy}>
            <option value="argentina">{l.scheduleZoneArgentina}</option>
            <option value="miami">{l.scheduleZoneMiami}</option>
          </select>
          {tooSoon && <p className="help help-warn mt-md">{l.scheduleTooSoonHint}</p>}
        </div>
      </div>
      {sendAt && plan?.ok && (
        <div className="alert alert-neutral">
          <div>
            {l.scheduleWillSend} <strong>{formatSendAt(sendAt, "argentina")} {l.scheduleInArgentina}</strong>. {l.scheduleInMiami} {formatSendAt(sendAt, "miami")}. {l.scheduleExplain}
          </div>
        </div>
      )}
    </Dialog>
  );
}
