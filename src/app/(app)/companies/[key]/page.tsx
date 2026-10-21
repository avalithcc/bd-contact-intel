import Link from "next/link";
import { formatTaskDueDate } from "@/lib/tasks/argentinaDate";
import { getCompanyByKey } from "@/lib/companies/queries";
import {
  getCompanyOpenTasks,
  getCompanyPersonIds,
  getCompanyPeople,
  getCompanyPropertyHistory,
  getCompanyTimeline,
  getCompanyTimelineFilterCounts,
} from "@/lib/companies/recordQueries";
import { getOpenAbsorptionNotice } from "@/lib/companies/absorptionDb";
import { relativeTime } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/server";
import { getHiringMatchIndex, getCompanyPostingsForKey } from "@/lib/hiring/queries";
import { accountTypeLabel, industryLabel, stageBadgeClass, stageLabelOf } from "@/lib/companies/listMappers";
import {
  isCompanyActivityFilter,
  resolveCompanyTab,
  latestEditByProperty,
  startupLabel,
} from "@/lib/companies/recordMappers";
import { buildCompanyTimelineViewRows } from "@/lib/companies/timelineView";
import { listOwnerOptions } from "@/lib/contacts/bulkOwnerDb";
import { getCurrentBd } from "@/lib/queries";
import { isAdminRole } from "@/lib/auth/adminRole";
import { pickCompanyRecordLabels } from "@/lib/companies/labels";
import { companyLogoInitials } from "@/lib/contacts/companyLogo";
import { statusBadgeClass } from "@/lib/contacts/statusBadge";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { getDictionary } from "@/lib/i18n/server";
import { companyPostingsHref, resolvePostingFilter } from "@/lib/hiring/delta";
import { HiringPostingsTable } from "./HiringPostingsTable";
import { RecordTabs } from "@/app/(app)/contacts/[id]/RecordTabs";
import type { NewContactDialogLabels } from "@/app/(app)/contacts/NewContactDialog";
import { CompanyAboutPane } from "./CompanyAboutPane";
import { AbsorptionNotice } from "./AbsorptionNotice";
import { CompanyTimeline } from "./CompanyTimeline";
import { CompleteTaskCheckbox } from "./CompleteTaskCheckbox";
import { TaskTitleLink } from "@/app/(app)/tasks/TaskTitleLink";
import type { EditTaskLabels } from "@/app/(app)/tasks/EditTaskDialog";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/** Maps this page's companyRecord dict section into EditTaskDialog's shape
 * — see that component's doc comment for why each page builds its own. */
function pickEditTaskLabels(l: Dictionary["companyRecord"]): EditTaskLabels {
  return {
    dialogTitle: l.taskEditDialogTitle,
    fieldTitle: l.taskTitleLabel,
    fieldDue: l.taskDueLabel,
    fieldAssignee: l.taskAssigneeLabel,
    fieldDescription: l.taskDescriptionLabel,
    fieldAssociation: l.taskAssociationLabel,
    associationHelp: l.taskAssociationHelp,
    titleRequiredError: l.taskTitleRequiredError,
    markComplete: l.taskMarkComplete,
    reopenTask: l.taskReopenDialogAction,
    cancel: l.cancel,
    saveChanges: l.taskSaveChanges,
    saving: l.taskSaving,
    saveError: l.taskSaveError,
    genericError: l.genericError,
    completedBadge: l.taskCompletedBadge,
    completedCaptionPrefix: l.taskCompletedCaptionPrefix,
    toastUpdated: l.toastTaskUpdated,
    toastCompleted: l.toastTaskCompleted,
    toastReopened: l.toastTaskReopened,
  };
}

export const dynamic = "force-dynamic";

interface CompanyDetailPageProps {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ activityFilter?: string; tab?: string; market?: string; miamiOnly?: string }>;
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
  const { activityFilter: rawActivityFilter, tab: rawTab, market: rawMarket, miamiOnly: rawMiami } = await searchParams;
  const key = decodeURIComponent(rawKey);
  const activityFilter = isCompanyActivityFilter(rawActivityFilter) ? rawActivityFilter : "all";
  // `?tab=` only picks the STARTING tab: later clicks are client state and do not rewrite the URL (intentional, not a bug).
  const initialTab = resolveCompanyTab(rawTab);
  // Carried from the Vacantes screen so the hiring tab lists the same subset its number counted.
  const postingFilter = resolvePostingFilter({ market: rawMarket, miamiOnly: rawMiami });
  const filterActive = !!postingFilter.market;

  const dict = await getDictionary();
  const l = dict.companyRecord;
  const lc = dict.companyList;

  const company = await getCompanyByKey(key);
  // React-`cache()`-wrapped (src/lib/queries.ts) — the app-shell layout
  // already calls this once per request for the account menu, so this is a
  // cache hit, not a second round trip (see PERFORMANCE.md).
  const me = await getCurrentBd();

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

  // Resolved ONCE and shared by the three reads that scope to this company's
  // people (timeline, filter counts, open tasks) — one statement, not three.
  const personIds = getCompanyPersonIds(key);

  const [hiringIndex, people, timelineRows, timelineCounts, openTasks, allPostings, propertyHistoryRows, ownerOptions, absorption, filteredPostings] =
    await Promise.all([
      getHiringMatchIndex(),
      getCompanyPeople(key),
      // Scoped to `activityFilter` (fix/company-timeline-filter-no-reload) —
      // a deep link (e.g. `?activityFilter=contact_activity`) must render
      // that filter's own true page on first paint, not the unfiltered
      // "Todas" pool filtered down client-side (which the OLD component did,
      // capped by TIMELINE_LIMIT — see getCompanyTimeline's doc comment).
      getCompanyTimeline(key, { filter: activityFilter }, personIds),
      // TRUE per-filter totals, unbounded — the ground truth
      // CompanyTimeline.tsx compares its own loaded pool against before
      // trusting a purely local filter switch (isCompanyFilterSelectionComplete).
      getCompanyTimelineFilterCounts(key, personIds),
      getCompanyOpenTasks(key, personIds),
      getCompanyPostingsForKey(key),
      getCompanyPropertyHistory(key),
      listOwnerOptions(),
      // The open absorption proposal, if any (one indexed query on the partial unique index).
      getOpenAbsorptionNotice(key),
      // Only when a filter is carried: the record's own breakdown card keeps describing the whole company.
      filterActive ? getCompanyPostingsForKey(key, postingFilter) : Promise.resolve(null),
    ]);
  const postings = filterActive ? filteredPostings : allPostings;

  const hiring = hiringIndex.get(key) ?? null;
  const breakdown = allPostings
    ? { latam: allPostings.latamCount, us: allPostings.usCount, other: allPostings.otherCount, total: allPostings.totalCount }
    : { latam: 0, us: 0, other: 0, total: 0 };
  // Plain object (not the Map recordMappers.ts returns) — see
  // CompanyAboutPane.tsx's `lastEditByProperty` prop doc comment on why.
  const lastEditByProperty = Object.fromEntries(latestEditByProperty(propertyHistoryRows));

  // Formats each row's "what"/"body" SERVER-SIDE, using `dict.companyRecordServer`'s
  // FORMATTER FUNCTIONS — see buildCompanyTimelineViewRows's doc comment for
  // why that step can never move into the "use client" CompanyTimeline.tsx.
  const timelineViewRows = buildCompanyTimelineViewRows(
    timelineRows,
    dict.companyRecordServer,
    l,
    (stage) => stageLabelOf(stage, lc),
    me.id,
    isAdminRole(me),
  );

  const newContactLabels: NewContactDialogLabels = {
    triggerLabel: dict.contactList.newContactTrigger,
    title: dict.contactList.newContactTitle,
    firstNameLabel: dict.contactList.newContactFirstName,
    lastNameLabel: dict.contactList.newContactLastName,
    linkedinLabel: dict.contactList.newContactLinkedin,
    linkedinHelp: dict.contactList.newContactLinkedinHelp,
    emailLabel: dict.contactList.newContactEmail,
    companyLabel: dict.contactList.newContactCompany,
    jobTitleLabel: dict.contactList.newContactJobTitle,
    locationLabel: dict.contactList.newContactLocation,
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

  const filterLabel = postingFilter.miamiOnly ? dict.hiring.marketMiami : postingFilter.market === "us" ? dict.hiring.marketUs : postingFilter.market ? dict.markets[postingFilter.market] : "";
  const filterNote = filterActive ? (
    <p className="meta mt-xl">
      {dict.hiring.filteredBy(filterLabel)} <Link href={companyPostingsHref(key)}>{dict.hiring.showAllPostings}</Link>
    </p>
  ) : null;

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
          assigneeOptions={ownerOptions}
          meId={me.id}
          lastEditByProperty={lastEditByProperty}
          startupText={startupLabel(hiring, l.startupYes, l.startupNo)}
          accountTypeText={accountTypeLabel(company.accountType, l)}
          clientStatus={company.clientStatus}
          linkedinUrl={company.linkedinUrl}
          domain={company.domain}
          labels={pickCompanyRecordLabels(dict)}
          newContactLabels={newContactLabels}
          absorptionOpen={absorption !== null}
        />

        <div className="record-main">
          {absorption && (
            <AbsorptionNotice
              proposalId={absorption.id}
              survivorName={absorption.survivorName}
              proposerName={absorption.proposerName}
              when={relativeTime(absorption.createdAt, await getLocale())}
              canUndo={absorption.proposerId === me.id}
              labels={l}
            />
          )}
          <RecordTabs
            initialTabId={initialTab}
            tabs={[
              {
                id: "activity",
                label: l.tabActivity,
                content: (
                  <CompanyTimeline
                    companyKey={key}
                    rows={timelineViewRows}
                    counts={timelineCounts}
                    activeFilter={activityFilter}
                    labels={l}
                    tombstoneLabels={{
                      noteDeletedTitle: dict.contactRecord.noteDeletedTitle,
                      noteDeletedWrittenBy: dict.contactRecord.noteDeletedWrittenBy,
                      noteDeletedDeletedBy: dict.contactRecord.noteDeletedDeletedBy,
                      noteDeletedAdminSuffix: dict.contactRecord.noteDeletedAdminSuffix,
                      timelineSystemActor: dict.contactRecord.timelineSystemActor,
                    }}
                  />
                ),
              },
              {
                id: "hiring",
                label: l.tabHiring,
                content: postings && postings.postings.length > 0 ? (
                  <>
                  {filterNote}
                  {postings.postings.length < postings.totalCount && (
                    <p className="meta mt-xl">{dict.hiring.showingLatest(postings.postings.length, postings.totalCount)}</p>
                  )}
                  <HiringPostingsTable postings={postings.postings} labels={l} markets={dict.markets} />
                  </>
                ) : (
                  <>
                    {filterNote}
                    <p className="muted">{l.hiringEmpty}</p>
                  </>
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
            <div className="card-body">
              {openTasks.length === 0 ? (
                <span>{l.tasksEmpty}</span>
              ) : (
                openTasks.map((t) => (
                  <div key={t.id} className="assoc-row">
                    <CompleteTaskCheckbox
                      taskId={t.id}
                      companyKey={key}
                      title={t.title}
                      ariaLabel={l.taskMarkDone}
                      errorLabel={l.genericError}
                      completedLabel={dict.tasksPage.completedToast}
                      undoLabel={dict.tasksPage.completeUndo}
                      undoErrorLabel={dict.tasksPage.completeUndoError}
                    />
                    <div className="grow">
                      <TaskTitleLink
                        task={{
                          id: t.id,
                          title: t.title,
                          description: t.description,
                          dueAt: t.dueAt,
                          assignedToBdId: t.assignedToBdId,
                          status: "open",
                          personId: t.personId,
                          companyKey: t.companyKey,
                          // Person-scoped row (one of this company's
                          // contacts): associate with THAT person, not the
                          // company itself — see getCompanyOpenTasks's doc
                          // comment.
                          associationLabel: t.personId
                            ? (t.personName ?? company.displayName)
                            : company.displayName,
                        }}
                        className="n"
                        assigneeOptions={ownerOptions}
                        meId={me.id}
                        labels={pickEditTaskLabels(l)}
                      />
                      <div className="s">
                        {t.dueAt ? formatTaskDueDate(t.dueAt) : l.emptyValue}
                        {t.assignedToName ? ` · ${t.assignedToName}` : ""}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
