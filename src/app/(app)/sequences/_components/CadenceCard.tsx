import Link from "next/link";
import type { Schedule } from "@/lib/sequences/schedule";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import type { OnAction } from "./actions";

/** Wording comes from the Sequence's own schedule, so a changed cadence reads true; the mockup's text is the default. */
export function CadenceCard({ schedule, labels: l, onAction }: { schedule: Schedule; labels: SequenceLabels; onAction: OnAction }) {
  const { offsetDays, hour } = schedule.step1;
  const time = `${String(hour).padStart(2, "0")}:00`;
  return (
    <div className="card mb-lg">
      <div className="card-header">
        <h3>{l.cadenceTitle}</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAction({ type: "changeCadence" })}>{l.cadenceChange}</button>
      </div>
      <div className="card-body">
        <div className="assoc">
          <div className="assoc-row"><span className="badge badge-mono">{l.cadenceStep1}</span><span className="grow">{l.cadenceStep1Lead} <strong>{offsetDays === 1 ? l.cadenceStep1Next : fill(l.cadenceStep1Days, { n: offsetDays })}</strong>{fill(l.cadenceStep1Time, { time })}</span></div>
          <div className="assoc-row"><span className="badge badge-mono">{l.cadenceStep2}</span><span className="grow">{l.cadenceStep2Lead} <strong>{fill(l.cadenceStep2When, { n: schedule.step2.afterDays })}</strong>{l.cadenceStep2Tail}</span></div>
          <div className="assoc-row"><span className="badge badge-mono">{l.cadenceEnd}</span><span className="grow">{l.cadenceEndLead} <Link href="/follow-ups">{l.cadenceEndLink}</Link></span></div>
        </div>
        <p className="help mt-md">{l.cadenceHelp}</p>
      </div>
    </div>
  );
}
