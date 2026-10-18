import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { Tooltip } from "@/components/Tooltip";
import type { Locale } from "@/lib/i18n/locales";
import { formatInstant } from "@/lib/gmail/fleetFormat";
import { bounceCell, failedCell, lastEmailCell, reminderCell, syncCell, type FleetDict } from "@/lib/gmail/fleetText";
import { isNewFleetBd, type FleetRow } from "@/lib/gmail/fleetView";
import { SendReminderButton } from "./SendReminderButton";

type Tip = { title: string; body: string; action?: string };

function Tip({ tip, d, variant, align, children }: { tip: Tip; d: FleetDict; variant?: "inline" | "header"; align?: "start" | "end"; children: React.ReactNode }) {
  return (
    <Tooltip title={tip.title} body={tip.body} action={tip.action} actionLabel={d.whatToDo} variant={variant} align={align}>
      {children}
    </Tooltip>
  );
}

/** The column headers, each with its help tooltip (shared by the table and its loading skeleton). */
export function FleetHead({ d }: { d: FleetDict }) {
  return (
    <thead>
      <tr>
        <th className="sorted">
          {d.colBd} <span className="sort">↑</span>
        </th>
        <th><Tip tip={d.tips.connection} d={d} variant="header">{d.colConnection}</Tip></th>
        <th><Tip tip={d.tips.sync} d={d} variant="header">{d.colSync}</Tip></th>
        <th><Tip tip={d.tips.lastEmail} d={d} variant="header">{d.colLastEmail}</Tip></th>
        <th><Tip tip={d.tips.reminder} d={d} variant="header">{d.colReminder}</Tip></th>
        <th><Tip tip={d.tips.bounces} d={d} variant="header" align="end">{d.colBounces}</Tip></th>
        <th><Tip tip={d.tips.failed} d={d} variant="header" align="end">{d.colFailed}</Tip></th>
        <th>
          <span className="sr-only">{d.colActions}</span>
        </th>
      </tr>
    </thead>
  );
}

const CHIP = {
  connected: { tip: "connected", badge: "badge-success", label: "chipConnected" },
  reconnect: { tip: "reconnect", badge: "badge-danger", label: "chipReconnect" },
  never: { tip: "never", badge: "badge-neutral", label: "chipNever" },
  config: { tip: "config", badge: "badge-danger", label: "chipConfig" },
} as const;

function Row({ row, d, now, locale }: { row: FleetRow; d: FleetDict; now: Date; locale: Locale }) {
  const chip = CHIP[row.connection];
  const sync = syncCell(row, d, now, locale);
  const email = lastEmailCell(row, d, now);
  const bounces = bounceCell(row, d);
  const failed = failedCell(row, d);
  const reminder = reminderCell(row, d, now);
  const visit = row.lastSeenAt ? d.lastVisitTip.replace("{when}", formatInstant(row.lastSeenAt, now, d.time, { timeWhenOlder: false })) : d.lastVisitNever;
  const authorizedButQuiet = row.connection === "connected" && row.sync.state !== "ok";

  return (
    <tr>
      <td>
        <div className="owner-chip">
          <Avatar id={row.bdId} initials={initialsFromName(row.name)} size="sm" />
          <Tooltip title={row.name} body={visit} actionLabel={d.whatToDo}>
            <span className="strong">{row.name}</span>
          </Tooltip>
          {row.role === "admin" && <span className="badge badge-outline no-dot">{d.adminBadge}</span>}
          {isNewFleetBd(row, now) && <span className="badge badge-info">{d.newBadge}</span>}
        </div>
        <div className="meta">{row.email}</div>
      </td>
      <td>
        <Tip tip={d.tips[chip.tip]} d={d}>
          <span className={`badge ${chip.badge}`}>{d[chip.label]}</span>
        </Tip>
        {authorizedButQuiet && <div className="meta mt-md">{d.authorizationValid}</div>}
      </td>
      <td>
        {row.account ? (
          <div className="stack-sm">
            <div>
              <span className="soft">{sync.when}</span>
              {sync.ago && <div className="meta">{sync.ago}</div>}
            </div>
            {sync.chip && (
              <div>
                <Tip tip={d.tips.failing} d={d}>
                  <span className="badge badge-warn">{sync.chip === "failing" ? d.chipFailing : d.chipStale}</span>
                </Tip>
              </div>
            )}
            {sync.lines.map((line) => (
              <div key={line.text} className="meta">
                {line.text}
                {line.mono && (
                  <>
                    {" ("}
                    <span className="mono">{line.mono}</span>
                    {")"}
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            <span className="soft">{sync.when}</span>
            <div className="meta">{sync.lines[0]?.text}</div>
          </>
        )}
      </td>
      <td>
        {email ? (
          <div className="stack-sm">
            <div>
              <span className="soft">{email.when}</span>
              <div className="meta">{email.detail}</div>
            </div>
          </div>
        ) : (
          <span className="meta">{d.noEmails}</span>
        )}
      </td>
      <td>
        {reminder.kind === "note" ? (
          <span className="meta">{reminder.text}</span>
        ) : (
          <div className="stack-sm">
            <div>
              <span className="strong">{reminder.count}</span> {reminder.word}
            </div>
            {reminder.lines.map((line) => (
              <div key={line}>
                <span className="meta">{line}</span>
              </div>
            ))}
          </div>
        )}
      </td>
      <td className="nowrap">
        {bounces.kind === "nodata" ? (
          <span className="meta">{d.noData}</span>
        ) : (
          <>
            <span className="num">{bounces.total}</span>
            {bounces.breakdown && (
              <>
                {" "}
                <Tooltip
                  title={d.tips.bounceBreakdown.title}
                  body={
                    <>
                      <strong>{d.tips.bounceBreakdown.hardLabel}</strong> {d.tips.bounceBreakdown.hard}
                      <br />
                      <strong>{d.tips.bounceBreakdown.softLabel}</strong> {d.tips.bounceBreakdown.soft}
                    </>
                  }
                  action={d.tips.bounceBreakdown.action}
                  actionLabel={d.whatToDo}
                  align="end"
                >
                  <span className="meta">{bounces.breakdown}</span>
                </Tooltip>
              </>
            )}
          </>
        )}
      </td>
      <td className="nowrap">
        {failed.kind === "nodata" ? (
          <span className="meta">{d.noData}</span>
        ) : failed.kind === "zero" ? (
          <span className="num">0</span>
        ) : (
          <>
            <span className="num strong">{failed.count}</span> <span className="meta">{d.failedLabel}</span>
            {failed.code && (
              <div className="meta">
                {d.lastErrorLabel} <span className="mono">{failed.code}</span>
              </div>
            )}
          </>
        )}
      </td>
      <td className="right">
        {row.canSendReminder && (
          <SendReminderButton
            bdId={row.bdId}
            name={row.name}
            labels={{
              send: d.send,
              sendAria: d.sendAria,
              sending: d.sending,
              toastSent: d.toastSent,
              errorSend: d.errorSend,
              errorAlreadySent: d.errorAlreadySent,
              errorNotEligible: d.errorNotEligible,
              errorAuditFailed: d.errorAuditFailed,
            }}
          />
        )}
      </td>
    </tr>
  );
}

export function FleetTable({ rows, d, now, locale }: { rows: readonly FleetRow[]; d: FleetDict; now: Date; locale: Locale }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <FleetHead d={d} />
        <tbody>
          {rows.map((row) => (
            <Row key={row.bdId} row={row} d={d} now={now} locale={locale} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
