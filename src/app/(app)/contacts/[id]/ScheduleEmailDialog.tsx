"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { ClockIcon } from "@/components/icons";
import type { ContactRecordLabels } from "@/lib/contacts/labels";
import { formatSendAt, planSchedule, wallTimeToInstant, type ZoneKey } from "@/lib/scheduledEmail/plan";
import { nextMondayNineMiami, whenLabel } from "@/lib/scheduledEmail/view";
import { addDaysToDateString, argentinaCalendarDate } from "@/lib/tasks/argentinaDate";

const ART_OFFSET_MS = 3 * 60 * 60 * 1000;
const artWall = (at: Date) => new Date(at.getTime() - ART_OFFSET_MS).toISOString();

type Chip = "hour" | "today" | "tomorrow" | "monday";

/**
 * Approved mockup envio-programado.html, view 1b: date/time/zone picker. The time is read as Argentina by default.
 * With `edit` it is the same dialog reopened on an existing row (section 2: "Editar reabre el mismo diálogo con todo cargado").
 */
export function ScheduleEmailDialog(props: {
  labels: ContactRecordLabels;
  name: string;
  subject: string;
  body: string;
  busy: boolean;
  error: string | null;
  edit?: { initialSendAt: Date; allowUnchanged: boolean };
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onBack?: () => void;
  onSendNow?: () => void;
  onCancel: () => void;
  onSubmit: (sendAt: Date) => void;
}) {
  const { labels: l, busy, edit } = props;
  const ids = useId();
  const today = argentinaCalendarDate(new Date());
  const initial = edit ? artWall(edit.initialSendAt) : null;
  const [date, setDate] = useState(initial ? initial.slice(0, 10) : addDaysToDateString(today, 1));
  const [time, setTime] = useState(initial ? initial.slice(11, 16) : "09:00");
  const [zone, setZone] = useState<ZoneKey>("argentina");
  const [chip, setChip] = useState<Chip | null>(null);

  const sendAt = wallTimeToInstant(date, time, zone);
  const unchanged = !!edit?.allowUnchanged && !!sendAt && sendAt.getTime() === edit.initialSendAt.getTime();
  const plan = sendAt ? (unchanged ? { ok: true as const } : planSchedule({ sendAt, now: new Date(), pendingCount: 0 })) : null;
  const hint = !plan || (!plan.ok && plan.reason === "schedule_too_soon") ? l.scheduleTooSoonHint : !plan.ok && plan.reason === "schedule_too_far" ? l.errorScheduleTooFar : null;
  const canSubmit = !busy && !!sendAt && !!plan?.ok && !!props.subject.trim() && !!props.body.trim();
  const other: ZoneKey = zone === "argentina" ? "miami" : "argentina";

  const presets: { key: Chip; label: string; at: () => Date }[] = [
    { key: "hour", label: l.schedulePresetHour, at: () => new Date(Date.now() + 60 * 60_000) },
    { key: "today", label: l.schedulePresetToday, at: () => wallTimeToInstant(today, "17:00", "argentina")! },
    { key: "tomorrow", label: l.schedulePresetTomorrow, at: () => wallTimeToInstant(addDaysToDateString(today, 1), "09:00", "argentina")! },
    { key: "monday", label: l.schedulePresetMonday, at: () => nextMondayNineMiami(new Date()) },
  ];
  function pick(preset: (typeof presets)[number]) {
    const wall = artWall(preset.at());
    setZone("argentina");
    setDate(wall.slice(0, 10));
    setTime(wall.slice(11, 16));
    setChip(preset.key);
  }
  const edited = (set: () => void) => {
    set();
    setChip(null);
  };

  return (
    <Dialog
      open
      wide
      onClose={props.onCancel}
      closeDisabled={busy}
      title={`${edit ? l.scheduleEditTitle : l.scheduleTitle} ${props.name}`}
      footer={
        <>
          {props.onBack && (
            <button type="button" className="btn btn-ghost left" onClick={props.onBack} disabled={busy}>
              {l.scheduleBack}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={props.onCancel} disabled={busy}>
            {l.cancel}
          </button>
          {props.onSendNow && (
            <button type="button" className="btn btn-secondary" onClick={props.onSendNow} disabled={busy || !props.subject.trim() || !props.body.trim()}>
              {l.scheduleSendNow}
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => sendAt && props.onSubmit(sendAt)}>
            <ClockIcon className="icon" />
            {edit ? l.scheduleEditSubmit : l.scheduleSubmit}
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
          {presets.map((p) => (
            <button key={p.key} className="chip" type="button" aria-pressed={chip === p.key} onClick={() => pick(p)} disabled={busy}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="form-grid mt-lg">
          <div className="field">
            <label className="label" htmlFor={`${ids}-date`}>{l.scheduleDate}</label>
            <input id={`${ids}-date`} className="input" type="date" value={date} onChange={(e) => edited(() => setDate(e.target.value))} disabled={busy} />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${ids}-time`}>{l.scheduleTime}</label>
            <input id={`${ids}-time`} className="input" type="time" value={time} onChange={(e) => edited(() => setTime(e.target.value))} disabled={busy} />
          </div>
        </div>
        <div className="field mt-lg">
          <label className="label" htmlFor={`${ids}-zone`}>{l.scheduleZone}</label>
          <select id={`${ids}-zone`} className="select input" value={zone} onChange={(e) => edited(() => setZone(e.target.value as ZoneKey))} disabled={busy}>
            <option value="argentina">{l.scheduleZoneArgentina}</option>
            <option value="miami">{l.scheduleZoneMiami}</option>
          </select>
          {hint ? (
            <p className="help help-warn mt-md">{hint}</p>
          ) : (
            sendAt && (
              <p className="help mt-md">
                {zone === "argentina" ? l.scheduleHelpArgentina : l.scheduleHelpMiami} <strong>{whenLabel(sendAt, other)}</strong>.
              </p>
            )
          )}
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
