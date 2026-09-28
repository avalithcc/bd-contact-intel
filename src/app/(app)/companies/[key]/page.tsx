import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getCompanyByKey } from "@/lib/companies/queries";
import {
  getCompanyOpenTasks,
  getCompanyPeople,
  getCompanyPropertyHistory,
  getCompanyTimeline,
} from "@/lib/companies/recordQueries";
import { getHiringMatchIndex, getCompanyPostingsForKey } from "@/lib/hiring/queries";
import { industryLabel, stageBadgeClass, vacantesLabel } from "@/lib/companies/listMappers";
import { latestEditByProperty, startupLabel, type CompanyActivityFilter } from "@/lib/companies/recordMappers";
import { listOwnerOptions } from "@/lib/contacts/bulkOwnerDb";
import { pickCompanyRecordLabels } from "@/lib/companies/labels";
import { companyLogoInitials } from "@/lib/contacts/companyLogo";
import { statusBadgeClass } from "@/lib/contacts/statusBadge";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { getDictionary } from "@/lib/i18n/server";
import { RecordTabs } from "@/app/(app)/contacts/[id]/RecordTabs";
import type { NewContactDialogLabels } from "@/app/(app)/contacts/NewContactDialog";
import { CompanyAboutPane } from "./CompanyAboutPane";
import { CompanyTimeline } from "./CompanyTimeline";
import { completeCompanyTaskAction } from "../actions";

export const dynamic = "force-dynamic";

const STAGES = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;
type Stage = (typeof STAGES)[number];

const ACTIVITY_FILTERS: CompanyActivityFilter[] = ["all", "note", "stage_change", "contact_activity"];
function isActivityFilter(value: string | undefined): value is CompanyActivityFilter {
  return !!value && (ACTIVITY_FILTERS as readonly string[]).includes(value);
}

interface CompanyDetailPageProps {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ activityFilter?: string }>;
}

/**
 * `/companies/[key]` record (mockup-port c03; company-record.html). Reuses
 * the Contact record's three-panel `RecordShell` markup pattern (`.record`/
 * `.record-left`/`.record-main`/`.record-right`) and the shared `RecordTabs`
 * component; company-specific content (About pane, quick actions, timeline)
 * gets its own components — see CompanyAboutPane.tsx/CompanyTimeline.tsx's
 * doc comments for why those aren't a literal reuse of the Contact ones.
 */
export default async function CompanyDetailPage({ params, searchParams }: CompanyDetailPageProps) {
  const { key: rawKey } = await params;
  const { activityFilter: rawActivityFilter } = await searchParams;
  const key = decodeURIComponent(rawKey);
  const activityFilter = isActivityFilter(rawActivityFilter) ? rawActivityFilter : "all";

  const dict = await getDictionary();
  const l = dict.companyRecord;
  const lc = dict.companyList;

  const company = await getCompanyByKey(key);

  if (!company) {
    return (
      <main>
        <div className="page">
          <h1>{l.notFoundTitle}</h1>
          <p>{l.notFoundBody}</p>
          <Link href="/companies">{l.backLink}</Link>
        </div>
      </main>
    );
  }

  const [hiringIndex, people, timelineRows, openTasks, postings, propertyHistoryRows, ownerOptions] = await Promise.all([
    getHiringMatchIndex(),
    getCompanyPeople(key),
    getCompanyTimeline(key),
    getCompanyOpenTasks(key),
    getCompanyPostingsForKey(key),
    getCompanyPropertyHistory(key),
    listOwnerOptions(),
  ]);

  const hiring = hiringIndex.get(key) ?? null;
  // marketBreakdown expects a full posting array; postings.postings is now
  // capped (see getCompanyPostingsForKey's DETAIL_ROW_LIMIT), so the "N
  // vacantes" footer must read the precomputed, uncapped counts instead.
  const breakdown = postings
    ? { latam: postings.latamCount, us: postings.usCount, other: postings.otherCount, total: postings.totalCount }
    : { latam: 0, us: 0, other: 0, total: 0 };
  // Plain object (not the Map recordMappers.ts returns) — see
  // CompanyAboutPane.tsx's `lastEditByProperty` prop doc comment on why.
  const lastEditByProperty = Object.fromEntries(latestEditByProperty(propertyHistoryRows));

  function stageLabelOf(stage: string): string {
    switch (stage) {
      case "prospect":
        return lc.stageProspect;
      case "qualified":
        return lc.stageQualified;
      case "proposal_sent":
        return lc.stageProposalSent;
      case "won":
        return lc.stageWon;
      case "lost":
        return lc.stageLost;
      default:
        return stage;
    }
  }

  const newContactLabels: NewContactDialogLabels = {
    triggerLabel: dict.contactList.newContactTrigger,
    title: dict.contactList.newContactTitle,
    firstNameLabel: dict.contactList.newContactFirstName,
    lastNameLabel: dict.contactList.newContactLastName,
    linkedinLabel: dict.contactList.newContactLinkedin,
    linkedinHelp: dict.contactList.newContactLinkedinHelp,
    emailLabel: dict.contactList.newContactEmail,
    companyLabel: dict.contactList.newContactCompany,
    cancelLabel: dict.contactList.newContactCancel,
    createLabel: dict.contactList.newContactCreate,
    createAnywayLabel: dict.contactList.newContactCreateAnyway,
    openExistingLabel: dict.contactList.newContactOpenExisting,
    duplicateWarningPrefix: dict.contactList.newContactDuplicateWarningPrefix,
    duplicateWarningBody: dict.contactList.newContactDuplicateWarningBody,
    existingMatchTitle: dict.contactList.newContactExistingMatchTitle,
    existingMatchBody: dict.contactList.newContactExistingMatchBody,
    blockedOwnCompany: dict.contactList.newContactBlockedOwnCompany,
    invalidRequiresName: dict.contactList.newContactInvalidRequiresName,
  };

  return (
    <main>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/companies">{l.breadcrumb}</Link>
        <span className="sep">/</span>
        <span>{company.displayName}</span>
      </nav>

      <div className="record">
        <CompanyAboutPane
          companyKey={key}
          companyName={company.displayName}
          logoInitials={companyLogoInitials(company.displayName)}
          headline={[company.domain, industryLabel(company)].filter(Boolean).join(" · ")}
          stage={company.relationshipStage}
          stageBadgeClass={stageBadgeClass(company.relationshipStage)}
          hiringBadgeText={hiring && hiring.openItCount > 0 ? l.hiringBadge : null}
          revenuePotential={company.revenuePotential}
          industry={company.industry}
          ownerBdId={company.ownerBdId}
          ownerName={company.ownerName}
          city={company.city}
          country={company.country}
          ownerOptions={ownerOptions}
          lastEditByProperty={lastEditByProperty}
          startupText={startupLabel(hiring, l.startupYes, l.startupNo)}
          labels={pickCompanyRecordLabels(dict)}
          newContactLabels={newContactLabels}
        />

        <div className="record-main">
          <RecordTabs
            tabs={[
              {
                id: "activity",
                label: l.tabActivity,
                content: (
                  <CompanyTimeline
                    companyKey={key}
                    rows={timelineRows}
                    activeFilter={activityFilter}
                    labels={l}
                    serverStrings={dict.companyRecordServer}
                    stageLabelOf={stageLabelOf}
                  />
                ),
              },
              {
                id: "hiring",
                label: l.tabHiring,
                content: postings && postings.postings.length > 0 ? (
                  <div className="table-wrap mt-xl">
                    <table className="data compact">
                      <thead>
                        <tr>
                          <th>{l.hiringTablePosition}</th>
                          <th>{l.hiringTableLocation}</th>
                          <th>{l.hiringTableMarket}</th>
                          <th>{l.hiringTablePosted}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {postings.postings.map((p) => (
                          <tr key={p.id}>
                            <td>{p.title}</td>
                            <td>{p.location}</td>
                            <td>
                              <span className="badge badge-neutral no-dot">{dict.markets[p.market]}</span>
                            </td>
                            <td className="meta">{format(p.firstSeen, "d MMM", { locale: es })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">{l.hiringEmpty}</p>
                ),
              },
            ]}
          />
        </div>

        <aside className="record-right" aria-label="Associations">
          <div className="card assoc">
            <div className="card-header">
              <h3>{l.assocContactsTitle}</h3>
              <span className="meta">{people.total}</span>
            </div>
            <div className="card-body">
              {people.rows.map((p) => {
                const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || l.emptyValue;
                return (
                  <div key={p.id} className="assoc-row">
                    <Avatar id={p.id} initials={initialsFromName(name)} size="sm" />
                    <div className="grow">
                      <Link className="n" href={`/contacts/${p.id}`}>
                        {name}
                      </Link>
                      <div className="s">{p.jobTitle ?? l.emptyValue}</div>
                    </div>
                    <span className={statusBadgeClass(p.status)}>{p.status}</span>
                  </div>
                );
              })}
              {people.total > people.rows.length && (
                <Link className="btn btn-ghost btn-sm mt-lg" href={`/contacts?company=${encodeURIComponent(company.displayName)}`}>
                  {dict.companyRecordServer.assocViewAll(people.total)}
                </Link>
              )}
            </div>
          </div>

          <div className="card assoc">
            <div className="card-header">
              <h3>{l.assocVacantesTitle}</h3>
            </div>
            <div className="card-body">
              <div className="stat bare">
                <div className="value">{hiring?.openItCount ?? 0}</div>
                <div className="foot">{dict.companyRecordServer.vacantesFooter(breakdown.total, breakdown.latam, breakdown.us)}</div>
              </div>
            </div>
          </div>

          <div className="card assoc">
            <div className="card-header">
              <h3>{l.assocTasksTitle}</h3>
            </div>
            <div className="card-body soft small">
              {openTasks.length === 0 ? (
                <span>{l.tasksEmpty}</span>
              ) : (
                openTasks.map((t) => (
                  <form
                    key={t.id}
                    action={async () => {
                      "use server";
                      await completeCompanyTaskAction(t.id, key);
                    }}
                  >
                    <button type="submit" className="btn btn-ghost btn-sm" title={l.taskMarkDone}>
                      {t.title}
                      {t.dueAt && <> · {format(t.dueAt, "d MMM", { locale: es })}</>}
                    </button>
                  </form>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
