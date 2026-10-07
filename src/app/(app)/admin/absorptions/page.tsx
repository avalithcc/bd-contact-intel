import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, CloseIcon, CompaniesIcon, LockIcon, WarningIcon } from "@/components/icons";
import { initialsFromName } from "@/components/initials";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { listOpenAbsorptionProposals } from "@/lib/companies/absorptionDb";
import { keptSide, keptStage, outcomeTone, parseOutcome, type Side } from "@/lib/companies/absorptionReview";
import type { ProposalCompanyView } from "@/lib/companies/absorption";
import { stageBadgeClass, stageLabelOf } from "@/lib/companies/listMappers";
import { es } from "@/lib/i18n/dictionaries/es";
import { formatDate, relativeTime } from "@/lib/i18n/format";
import { isUuid } from "@/lib/uuid";
import { ApplyDialog } from "./ApplyDialog";
import { applyAbsorptionAction, rejectAbsorptionAction } from "./actions";

export const dynamic = "force-dynamic";

// Spanish-only regardless of `locale`, same rationale as /admin/duplicates.
const dict = es.absorptions;
const PAGE_SIZE = 25;

export default async function AbsorptionsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ proposal?: string; page?: string; result?: string; detail?: string }>;
}) {
  try {
    await requireAdmin();
  } catch (err) {
    // Admin screens 404 for non-admins, same as /admin/duplicates.
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }

  const sp = await searchParams;
  const page = Math.max(1, Math.trunc(Number(sp.page)) || 1);
  const items = await listOpenAbsorptionProposals(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const total = items[0]?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedIndex = Math.max(0, sp.proposal && isUuid(sp.proposal) ? items.findIndex((i) => i.id === sp.proposal) : 0);
  const selected = items[selectedIndex] ?? null;
  const outcome = parseOutcome(sp);
  const tone = outcome ? outcomeTone(outcome.code) : null;
  const href = (p: number, proposal?: string) => `/admin/absorptions?page=${p}${proposal ? `&proposal=${proposal}` : ""}`;
  const oldestAgo = page === 1 && items[0] ? relativeTime(items[0].createdAt, "es") : null;

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{dict.eyebrow}</div>
          <h1>
            {dict.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{dict.subtitle(total, oldestAgo)}</p>
        </div>
        <div className="actions">
          <span className="badge badge-neutral no-dot">
            <LockIcon className="icon" />
            {dict.adminOnlyBadge}
          </span>
        </div>
      </div>

      {outcome && tone && (
        <div className={`alert alert-${tone} mb-lg`} role={tone === "success" ? "status" : "alert"}>
          {tone === "success" ? <CheckIcon className="icon" /> : <WarningIcon className="icon" />}
          <div>
            <div className="title">{dict.outcomes[outcome.code]}</div>
            {outcome.detail && (
              <>
                {dict.blockedReasonsLabel}: {outcome.detail}
              </>
            )}
          </div>
        </div>
      )}

      {selected ? (
        <div className="split">
          <div className="card">
            <div className="card-header">
              <h3 className="m-0">{dict.queueTitle}</h3>
              <span className="actions">
                <span className="meta">{total}</span>
              </span>
            </div>
            <div className="pad-2xs">
              {items.map((item, i) => (
                <Link key={item.id} href={href(page, item.id)} className={`queue-item${i === selectedIndex ? " active" : ""}`}>
                  <div>
                    <div className="strong">{item.absorbed.displayName}</div>
                    <div className="meta">{dict.queueItemMeta(item.survivor.displayName, item.proposedBy.name, relativeTime(item.createdAt, "es"))}</div>
                  </div>
                </Link>
              ))}
            </div>
            {pageCount > 1 && (
              <div className="card-footer row between">
                {page > 1 ? <Link href={href(page - 1)}>{dict.prevPage}</Link> : <span />}
                <span className="meta">{dict.pageOf(page, pageCount)}</span>
                {page < pageCount ? <Link href={href(page + 1)}>{dict.nextPage}</Link> : <span />}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="reason">
                <span className="badge badge-warn no-dot">{dict.reasonBadge}</span>
                <span className="mono soft">
                  {selected.absorbed.key} &rarr; {selected.survivor.key}
                </span>
              </div>
              <span className="actions">
                <span className="meta">{dict.proposalOf((page - 1) * PAGE_SIZE + selectedIndex + 1, total)}</span>
              </span>
            </div>
            <div className="card-body">
              <div className="alert alert-warn mb-lg">
                <WarningIcon className="icon" />
                <div>
                  <div className="title">{dict.warnLead(selected.absorbed.displayName, selected.survivor.displayName, selected.absorbed.contacts)}</div>
                  {dict.warnBody}
                </div>
              </div>

              <blockquote className="note-quote">
                <p>{selected.note ?? dict.noNote}</p>
                <footer className="meta">
                  {selected.proposedBy.name} · {formatDate(selected.createdAt, "es")}
                </footer>
              </blockquote>

              <CompareTable absorbed={selected.absorbed} survivor={selected.survivor} />
            </div>
            <div className="card-footer row">
              <form action={rejectAbsorptionAction}>
                <input type="hidden" name="proposalId" value={selected.id} />
                <button type="submit" className="btn btn-secondary">
                  <CloseIcon className="icon" />
                  {dict.rejectButton}
                </button>
              </form>
              <span className="grow" />
              <ApplyDialog
                key={selected.id}
                proposalId={selected.id}
                expectedName={selected.absorbed.displayName}
                action={applyAbsorptionAction}
                labels={{
                  open: dict.applyButton,
                  title: dict.dialogTitle,
                  body: dict.dialogBody(selected.absorbed.displayName, selected.survivor.displayName, selected.absorbed.contacts),
                  confirm: dict.confirmLabel,
                  audit: dict.dialogAudit(selected.survivor.displayName),
                  cancel: dict.cancelButton,
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="empty">
            <div className="empty-icon">
              <CompaniesIcon className="icon icon-lg" />
            </div>
            <h3 className="m-0">{dict.emptyTitle}</h3>
            <p>{dict.emptyBody}</p>
          </div>
        </div>
      )}
    </main>
  );
}

const keep = (side: Side, mine: Exclude<Side, null>) => side === mine && <span className="keep">{dict.kept}</span>;

/** `table.compare` of /admin/duplicates: what each company holds and which value survives the merge. */
function CompareTable({ absorbed: a, survivor: s }: { absorbed: ProposalCompanyView; survivor: ProposalCompanyView }) {
  const text = (v: string | null) => v ?? dict.noValue;
  const ago = (d: Date | null) => (d ? relativeTime(d, "es") : dict.noValue);
  const stage = (v: string | null) =>
    v ? <span className={stageBadgeClass(v)}>{stageLabelOf(v, es.companyList)}</span> : dict.noValue;
  const owner = (name: string | null) =>
    name ? (
      <span className="owner-chip">
        <Avatar id={name} initials={initialsFromName(name)} variant="bd" size="sm" />
        {name}
      </span>
    ) : (
      dict.noValue
    );
  const rows: { label: string; a: React.ReactNode; s: React.ReactNode; side?: Side; differs?: boolean }[] = [
    { label: dict.rowName, a: a.displayName, s: s.displayName, side: "survivor", differs: true },
    { label: dict.rowDomain, a: text(a.domain), s: text(s.domain), side: keptSide(a.domain, s.domain) },
    { label: dict.rowStage, a: stage(a.stage), s: stage(s.stage), side: keptStage(a.stage, s.stage) },
    {
      label: dict.rowContacts,
      a: (
        <>
          {a.contacts} <span className="meta">{dict.moving}</span>
        </>
      ),
      s: (
        <>
          {s.contacts} <span className="meta">{dict.remaining(s.contacts + a.contacts)}</span>
        </>
      ),
      differs: true,
    },
    { label: dict.rowOwner, a: owner(a.ownerName), s: owner(s.ownerName), side: keptSide(a.ownerName, s.ownerName) },
    { label: dict.rowLastActivity, a: ago(a.lastActivityAt), s: ago(s.lastActivityAt) },
  ];
  const head = (c: ProposalCompanyView, role: string) => (
    <th scope="col">
      <div className="row">
        <span className="company-logo" aria-hidden="true">
          {initialsFromName(c.displayName)}
        </span>
        <div>
          <div className="strong">{c.displayName}</div>
          <div className="meta">{role}</div>
        </div>
      </div>
    </th>
  );
  return (
    <div className="table-wrap">
      <table className="compare">
        <thead>
          <tr>
            <th />
            {head(a, dict.absorbedRole)}
            {head(s, dict.survivorRole)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td className={r.differs ? "differs" : ""}>
                {r.a}
                {keep(r.side ?? null, "absorbed")}
              </td>
              <td className={r.differs ? "differs" : ""}>
                {r.s}
                {keep(r.side ?? null, "survivor")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
