import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { DropdownMenu } from "@/components/DropdownMenu";
import { initialsFromName } from "@/components/initials";
import { CloseIcon, FilterIcon, MoreIcon, PlusIcon, SendIcon } from "@/components/icons";
import type { AdminListView } from "@/lib/sequences/adminListView";
import { DAILY_SEND_CAP_WARN_ABOVE } from "@/lib/sequences/capValidation";
import { companiesLine, createdAgo, createdOn, listView, type SequenceListRow } from "@/lib/sequences/listView";
import { fill, type SequenceLabels } from "@/lib/sequences/viewText";
import { queuedFoot } from "./StatCards";

const NewButton = ({ label }: { label: string }) => (
  <Link className="btn btn-primary btn-sm" href="/sequences/new"><PlusIcon className="icon" />{label}</Link>
);

const ALL_HREF = "/sequences?scope=all";

/** The admin's Mías / Todas tabs (view-tabs, as contacts.html). */
function Tabs({ admin: a, l }: { admin: AdminListView; l: SequenceLabels }) {
  const tab = (active: boolean, href: string, label: string, count: number) => (
    <Link className={`view-tab${active ? " active" : ""}`} href={href} aria-current={active ? "page" : undefined}>{label}<span className="count">{count}</span></Link>
  );
  return <nav className="view-tabs" aria-label={l.listTabsLabel}>{tab(a.scope === "mine", "/sequences", l.listTabMine, a.tabs.mine)}{tab(a.scope === "all", ALL_HREF, l.listTabAll, a.tabs.all)}</nav>;
}

/** Todas only: the Responsable filter chip (one BD), or the applied chip with its remove and clear-all. */
function OwnerToolbar({ admin: a, l }: { admin: AdminListView; l: SequenceLabels }) {
  const o = a.chipOwner;
  return (
    <div className="toolbar">
      {o ? (
        <>
          <span className="chip"><span className="k">{l.listColOwner}:</span> {o.name}<form method="get" action="/sequences"><input type="hidden" name="scope" value="all" /><button type="submit" aria-label={l.listRemoveFilter}><CloseIcon className="icon" /></button></form></span>
          <Link className="btn btn-ghost btn-sm" href={ALL_HREF}>{l.listClearAll}</Link>
        </>
      ) : (
        <DropdownMenu trigger={<><FilterIcon className="icon" />{l.listColOwner}</>} triggerClassName="chip chip-add" align="left">
          <div className="menu-label">{l.listOwnerFilterLabel}</div>
          {a.owners.map((b) => (
            <Link key={b.id} className="menu-item" role="menuitem" href={`${ALL_HREF}&owner=${b.id}`}>
              <Avatar id={b.id} initials={initialsFromName(b.name)} variant="bd" size="sm" /><span className="grow">{b.name}{b.isMe && ` ${l.listOwnerMe}`}</span><span className="meta">{b.count}</span>
            </Link>
          ))}
        </DropdownMenu>
      )}
      <span className="spacer" />
      <span className="meta">{o ? fill(l.listOwnerNote, { name: o.name }) : l.listAllNote}</span>
    </div>
  );
}

/**
 * The Sequences list (mockups/secuencias-lista.html; admin: secuencias-lista-admin.html). Presentational (mounted by /sequences): a BD's
 * rows are their own Sequences (the read scopes them), with EVERY member so the counts are true. `admin` adds the tabs, the
 * Responsable column and filter, and read-only rows for other BDs. It only links; creating is /sequences/new.
 */
export function SequenceListView({ rows, labels: l, now, admin = null }: { rows: readonly SequenceListRow[]; labels: SequenceLabels; now: Date; admin?: AdminListView | null }) {
  const { rows: views, summary: s } = listView(rows);
  const all = admin?.scope === "all";
  const head = (
    <div className="page-header">
      <div className="titles"><div className="eyebrow">{l.listEyebrow}</div><h1>{l.listTitle}<span className="dot">.</span></h1>
        {admin ? <p className="meta">{l.listAdminIntroLead} <strong>{l.listAdminIntroStrong}</strong>{l.listAdminIntroTail}</p>
          : views.length > 0 && <p className="meta">{l.listIntroLead} <strong>{l.listIntroStrong}</strong>{l.listIntroTail}</p>}</div>
      <div className="actions"><NewButton label={l.listNew} /></div>
    </div>
  );
  if (views.length === 0) {
    const mine = admin && !all;
    return (
      <>
        {head}
        {admin && <Tabs admin={admin} l={l} />}
        {admin && all && <OwnerToolbar admin={admin} l={l} />}
        <div className="card"><div className="empty">
          <div className="empty-icon"><SendIcon className="icon icon-lg" /></div>
          <h3>{mine ? l.listEmptyMineTitle : admin ? l.listEmptyAllTitle : l.listEmptyTitle}</h3><p>{mine ? l.listEmptyMineBody : l.listEmptyBody}</p>
          <div className="row" style={{ justifyContent: "center" }}>{mine && <Link className="btn btn-secondary btn-sm" href={ALL_HREF}>{l.listSeeAll}</Link>}<NewButton label={l.listNew} /></div>
        </div></div>
      </>
    );
  }
  // Todas hides the two cards that are not actionable on other BDs' work (owner decision); Mías keeps all four.
  const cards = [
    { tone: "neutral", label: l.listStatSequences, value: s.sequences, foot: fill(s.contacts === 1 ? l.listStatSequencesFootOne : l.listStatSequencesFoot, { n: s.contacts }) },
    { tone: "info", label: l.statReview, value: s.review, foot: fill(s.reviewIn === 1 ? l.listStatReviewFootOne : l.listStatReviewFoot, { n: s.reviewIn }) },
    { tone: "accent", label: l.statQueued, value: s.queued, foot: queuedFoot(s.nextReleaseAt, now, l) },
    { tone: "success", label: l.statReplied, value: s.replied, foot: l.listStatRepliedFoot },
  ].filter((c) => !all || c.tone === "neutral" || c.tone === "success");
  const n = views.length;
  const footer = !admin ? fill(n === 1 ? l.listFooterOne : l.listFooter, { n })
    : !all || admin.chipOwner?.isMe ? fill(n === 1 ? l.listFooterMineOne : l.listFooterMine, { n })
    : admin.chipOwner ? fill(n === 1 ? l.listFooterOwnerOne : l.listFooterOwner, { n, name: admin.chipOwner.name })
    : fill(n === 1 ? l.listFooterAllOne : l.listFooterAll, { n, bds: new Set(views.map((v) => v.owner?.id)).size });
  return (
    <>
      {head}
      {admin && <Tabs admin={admin} l={l} />}
      {admin && all && <OwnerToolbar admin={admin} l={l} />}
      <div className="grid-4 mb-lg">
        {cards.map((c) => <div key={c.tone} className={`stat ${c.tone}`}><div className="label">{c.label}</div><div className="value">{c.value}</div><div className="foot">{c.foot}</div></div>)}
      </div>
      <div className="table-wrap"><table className="data">
        <thead><tr>
          <th className="sorted">{l.listColSequence}</th>{admin && <th>{l.listColOwner}</th>}<th>{l.listColContacts}</th><th>{l.listColStates}</th><th>{l.listColCap}</th><th>{l.listColCadence}</th>
          <th className="sorted">{l.listColCreated} <span className="sort">↓</span></th><th><span className="sr-only">{l.listColActions}</span></th>
        </tr></thead>
        <tbody>
          {views.map((v) => {
            const href = `/sequences/${v.id}`;
            const c = v.counts;
            const own = !admin || v.owner?.id === admin.meId;
            const one = (n: number, many: string, single: string) => fill(n === 1 ? single : many, { n });
            return (
              <tr key={v.id}>
                <td><div className="stack-sm"><Link className="strong" href={href}>{v.name}</Link><div className="meta">{companiesLine(v.companies, l)}</div></div></td>
                {admin && <td>{v.owner && <><span className="owner-chip"><Avatar id={v.owner.id} initials={initialsFromName(v.owner.name)} variant="bd" size="sm" />{v.owner.name}</span>{own && <> <span className="meta">{l.listOwnerMe}</span></>}</>}</td>}
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
                    {own && <Link className="menu-item" role="menuitem" href={href}>{l.listEdit}</Link>}
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="table-footer"><span>{footer}</span><span>{l.listFooterOrder}</span></div></div>
    </>
  );
}
