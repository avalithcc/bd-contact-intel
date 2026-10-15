import Link from "next/link";
import { DropdownMenu } from "@/components/DropdownMenu";
import { MoreIcon, PlusIcon, SendIcon } from "@/components/icons";
import { DAILY_SEND_CAP_WARN_ABOVE } from "@/lib/sequences/capValidation";
import { companiesLine, createdAgo, createdOn, listView, type SequenceListRow } from "@/lib/sequences/listView";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import { queuedFoot } from "./StatCards";

const NewButton = ({ label }: { label: string }) => (
  <Link className="btn btn-primary btn-sm" href="/sequences/new"><PlusIcon className="icon" />{label}</Link>
);

/**
 * The Sequences list (mockups/secuencias-lista.html). Presentational and unrouted: the rows are the signed-in BD's own
 * Sequences (the read scopes them), with EVERY member so the counts are true. It only links; creating is /sequences/new.
 */
export function SequenceListView({ rows, labels: l, now }: { rows: readonly SequenceListRow[]; labels: SequenceLabels; now: Date }) {
  const { rows: views, summary: s } = listView(rows);
  const head = (
    <div className="page-header">
      <div className="titles"><div className="eyebrow">{l.listEyebrow}</div><h1>{l.listTitle}<span className="dot">.</span></h1>
        {views.length > 0 && <p className="meta">{l.listIntroLead} <strong>{l.listIntroStrong}</strong>{l.listIntroTail}</p>}</div>
      <div className="actions"><NewButton label={l.listNew} /></div>
    </div>
  );
  if (views.length === 0) {
    return (
      <>
        {head}
        <div className="card"><div className="empty">
          <div className="empty-icon"><SendIcon className="icon icon-lg" /></div>
          <h3>{l.listEmptyTitle}</h3><p>{l.listEmptyBody}</p><NewButton label={l.listNew} />
        </div></div>
      </>
    );
  }
  const cards = [
    { tone: "neutral", label: l.listStatSequences, value: s.sequences, foot: fill(s.contacts === 1 ? l.listStatSequencesFootOne : l.listStatSequencesFoot, { n: s.contacts }) },
    { tone: "info", label: l.statReview, value: s.review, foot: fill(s.reviewIn === 1 ? l.listStatReviewFootOne : l.listStatReviewFoot, { n: s.reviewIn }) },
    { tone: "accent", label: l.statQueued, value: s.queued, foot: queuedFoot(s.nextReleaseAt, now, l) },
    { tone: "success", label: l.statReplied, value: s.replied, foot: l.listStatRepliedFoot },
  ];
  return (
    <>
      {head}
      <div className="grid-4 mb-lg">
        {cards.map((c) => <div key={c.tone} className={`stat ${c.tone}`}><div className="label">{c.label}</div><div className="value">{c.value}</div><div className="foot">{c.foot}</div></div>)}
      </div>
      <div className="table-wrap"><table className="data">
        <thead><tr>
          <th className="sorted">{l.listColSequence}</th><th>{l.listColContacts}</th><th>{l.listColStates}</th><th>{l.listColCap}</th><th>{l.listColCadence}</th>
          <th className="sorted">{l.listColCreated} <span className="sort">↓</span></th><th><span className="sr-only">{l.listColActions}</span></th>
        </tr></thead>
        <tbody>
          {views.map((v) => {
            const href = `/sequences/${v.id}`;
            const c = v.counts;
            const one = (n: number, many: string, single: string) => fill(n === 1 ? single : many, { n });
            return (
              <tr key={v.id}>
                <td><div className="stack-sm"><Link className="strong" href={href}>{v.name}</Link><div className="meta">{companiesLine(v.companies, l)}</div></div></td>
                <td className="num"><span className="strong">{v.total}</span> <span className="meta">{v.total === 1 ? l.unitContactOne : l.unitContactMany}</span></td>
                <td><div className="stack-sm">
                  <div className="bar-track" style={{ width: 200 }} role="img" aria-label={fill(v.total === 1 ? l.listBarOne : l.listBar, { n: v.total })}>
                    <span className="bar-success" style={{ width: `${v.segments.sentPct}%` }} /><span className="bar-info" style={{ width: `${v.segments.queuedPct}%` }} /><span className="bar-neutral" style={{ width: `${v.segments.restPct}%` }} />
                  </div>
                  <div className="row wrap" style={{ gap: ".35rem" }}>
                    {c.review > 0 && <span className="badge badge-info">{fill(l.listReview, { n: c.review })}</span>}
                    {c.noDraft > 0 && <span className="badge badge-neutral">{fill(l.listNoDraft, { n: c.noDraft })}</span>}
                    {c.queued > 0 && <span className="badge badge-brand">{fill(l.listQueued, { n: c.queued })}</span>}
                    {c.sent > 0 && <span className="badge badge-contacted">{one(c.sent, l.listSent, l.listSentOne)}</span>}
                    {c.replied > 0 && <span className="badge badge-replied">{one(c.replied, l.listReplied, l.listRepliedOne)}</span>}
                    {c.removed > 0 && <span className="badge badge-discarded">{one(c.removed, l.listRemoved, l.listRemovedOne)}</span>}
                  </div>
                </div></td>
                <td className="nowrap"><span className="num strong">{v.cap}</span> <span className="meta">{l.listPerDay}</span>{v.capHigh && <> <span className="badge badge-warn">{fill(l.listOverCap, { n: DAILY_SEND_CAP_WARN_ABOVE })}</span></>}</td>
                <td className="soft">{fill(l.listCadence, { n: v.afterDays })}</td>
                <td className="nowrap"><span className="soft">{createdOn(v.createdAt, l)}</span><div className="meta">{createdAgo(v.createdAt, now, l)}</div></td>
                <td className="right">
                  <DropdownMenu trigger={<MoreIcon className="icon" />} triggerClassName="btn btn-ghost btn-sm btn-icon" ariaLabel={fill(l.listMoreActions, { name: v.name })}>
                    <Link className="menu-item" role="menuitem" href={href}>{l.listOpen}</Link>
                    <Link className="menu-item" role="menuitem" href={href}>{l.listEdit}</Link>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="table-footer"><span>{fill(views.length === 1 ? l.listFooterOne : l.listFooter, { n: views.length })}</span><span>{l.listFooterOrder}</span></div></div>
    </>
  );
}
