"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { OutcomeDialog, type OutcomeEntry, type OutcomeDialogMeeting } from "@/components/meetings/OutcomeDialog";
import { meetingStatusBadgeClass, meetingStatusLabel, type MeetingLabels } from "@/lib/meetings/labels";
import type { MeetingStatus } from "@/lib/meetings/status";

/** One table row, fully prepared on the server (dates already formatted) so server and client render the same text. */
export interface MeetingRowView {
  id: string;
  personId: string;
  contactName: string;
  company: string | null;
  bdName: string;
  scheduledAtIso: string;
  whenText: string;
  ago: string | null;
  /** `pending` is a scheduled meeting whose time has passed ("Por confirmar"). */
  status: MeetingStatus | "pending";
  notes: string | null;
  canMutate: boolean;
}

/**
 * The Reuniones table (meetings mockup 3a-3c). Rows are read-only: "Confirmar" (Por confirmar) and "Reprogramar"/"Cancelar"
 * (Agendadas) open the shared outcome dialog, and so does a click anywhere on a Por confirmar row. The contact link and the
 * buttons keep their own behaviour. A meeting that belongs to another BD (an admin looking at the team) has no buttons.
 */
export function MeetingsList({
  rows,
  labels: l,
  showBd,
  actionsVisible,
  emptyText,
}: {
  rows: MeetingRowView[];
  labels: MeetingLabels;
  showBd: boolean;
  /** The Acciones header is visible on every tab except "Por confirmar", where it is screen-reader only. */
  actionsVisible: boolean;
  emptyText: string;
}) {
  const [open, setOpen] = useState<{ meeting: OutcomeDialogMeeting; entry: OutcomeEntry } | null>(null);

  const openDialog = (row: MeetingRowView, entry: OutcomeEntry) =>
    setOpen({
      entry,
      meeting: {
        id: row.id,
        contactName: row.contactName,
        company: row.company,
        scheduledAtIso: row.scheduledAtIso,
        whenText: row.whenText,
        notes: row.notes,
      },
    });

  if (rows.length === 0) {
    return (
      <div className="table-wrap">
        <div className="empty">
          <p>{emptyText}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">{l.colContact}</th>
              <th scope="col">{l.colCompany}</th>
              {showBd && <th scope="col">{l.colBd}</th>}
              <th scope="col">{l.colWhen}</th>
              <th scope="col">{l.colStatus}</th>
              <th scope="col">{l.colNotes}</th>
              <th scope="col">{actionsVisible ? l.colActions : <span className="sr-only">{l.colActions}</span>}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const clickable = row.canMutate && row.status === "pending";
              const onRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
                if ((e.target as HTMLElement).closest("a, button")) return;
                openDialog(row, "confirm");
              };
              return (
                <tr key={row.id} className={clickable ? "clickable" : undefined} onClick={clickable ? onRowClick : undefined}>
                  <td>
                    <div className="cell-person">
                      <Avatar id={row.personId} initials={initialsFromName(row.contactName)} size="sm" />
                      <Link href={`/contacts/${row.personId}`}>
                        <strong>{row.contactName}</strong>
                      </Link>
                    </div>
                  </td>
                  <td>{row.company ?? ""}</td>
                  {showBd && (
                    <td>
                      <span className="owner-chip">
                        <Avatar id={row.bdName} initials={initialsFromName(row.bdName)} variant="bd" size="sm" />
                        {row.bdName}
                      </span>
                    </td>
                  )}
                  <td className="nowrap">
                    {row.whenText}
                    {row.ago && <span className="meta"> · {row.ago}</span>}
                  </td>
                  <td>
                    <span className={`badge ${meetingStatusBadgeClass(row.status)} no-dot`}>{meetingStatusLabel(l, row.status)}</span>
                  </td>
                  <td className="trunc" title={row.notes ?? undefined}>
                    {row.notes ?? ""}
                  </td>
                  <td className={row.status === "pending" ? "right" : undefined}>
                    {row.canMutate && row.status === "pending" && (
                      <button type="button" className="btn btn-primary btn-sm" aria-haspopup="dialog" onClick={() => openDialog(row, "confirm")}>
                        {l.actionConfirm}
                      </button>
                    )}
                    {row.canMutate && row.status === "scheduled" && (
                      <div className="outcomes">
                        <button type="button" className="btn btn-secondary btn-sm" aria-haspopup="dialog" onClick={() => openDialog(row, "reschedule")}>
                          {l.actionReschedule}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" aria-haspopup="dialog" onClick={() => openDialog(row, "cancel")}>
                          {l.actionCancel}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && <OutcomeDialog meeting={open.meeting} entry={open.entry} labels={l} onClose={() => setOpen(null)} />}
    </>
  );
}
