import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { formatTaskDueDate } from "@/lib/tasks/argentinaDate";
import { formatArgentinaDayMonth, formatArgentinaDayMonthYear } from "@/lib/i18n/format";
import { getContactRecord } from "@/lib/contacts/queries";
import { listOwnerOptions } from "@/lib/contacts/bulkOwnerDb";
import { getPersonTimeline } from "@/lib/activity/queries";
import { getLockedConversationSummaries } from "@/lib/activity/lockedConversationSummaries";
import { resolveLockedConnectionCardRows } from "@/lib/contacts/conversationHistoryAccess";
import { resolveConversationDialogParam } from "@/lib/contacts/conversationDialogParam";
import { resolveTimelinePillKey } from "@/lib/activity/timelinePills";
import { getTasksForPerson } from "@/lib/tasks/queries";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { describeStatusReason, pickContactRecordLabels } from "@/lib/contacts/labels";
import { pickGenerateMessageLabels } from "@/lib/outreach/messageLabels";
import { linkedinProfileHref } from "@/lib/contacts/linkedinProfile";
import { getCompanyByKey, getCompanyContactCount } from "@/lib/companies/queries";
import { getCompanyPostingsForKey } from "@/lib/hiring/queries";
import { resolveCompanyDomain } from "@/lib/contacts/companyDomain";
import { resolveCompanyDisplayName } from "@/lib/contacts/companyDisplayName";
import { mostRecentActivity, touchpointTotal, type RecentActivityCandidate } from "@/lib/contacts/recentActivity";
import { classifyPosition } from "@/lib/roleGroups";
import { ROLE_GROUP_PLAYBOOK } from "@/lib/roleGroupPlaybook";
import { describeConnectionHistory } from "@/lib/contacts/connectionHistory";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { PlusIcon } from "@/components/icons";
import { AboutPane, type AboutPaneProperty } from "./AboutPane";
import { ChangeCompanyButton } from "./ChangeCompanyButton";
import { RecordTabs } from "./RecordTabs";
import { Timeline } from "./Timeline";
import { Overview } from "./Overview";
import { ConversationHistoryCard } from "./ConversationHistoryCard";
import { AdminConversationAutoOpen } from "./AdminConversationAutoOpen";
import { CompleteTaskCheckbox } from "./CompleteTaskCheckbox";
import { TaskTitleLink } from "@/app/(app)/tasks/TaskTitleLink";
import type { EditTaskLabels } from "@/app/(app)/tasks/EditTaskDialog";
import styles from "./page.module.css";

/** Maps this page's ContactRecordLabels into EditTaskDialog's shape — see
 * that component's doc comment for why each page builds its own copy. */
function pickEditTaskLabels(l: ReturnType<typeof pickContactRecordLabels>): EditTaskLabels {
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

interface ContactRecordPageProps {
  params: Promise<{ id: string }>;
  // `conversation` — Administración → Registro de auditoría's "Abrir" link
  // (owner decision 2026-09-30: the standalone `/contacts/[id]/conversation/
  // [bdId]` page is deleted; this param + AdminConversationAutoOpen replace
  // it). Validated below (resolveConversationDialogParam) and admin-gated
  // server-side before it ever reaches a client component.
  searchParams: Promise<{ activityType?: string; openAction?: string; conversation?: string }>;
}

// Board drag/keyboard-menu targets (task 10.5, 14.1) plus the follow-up
// queue's deep-link quick actions (openspec/changes/follow-up-queue mockup
// note: "clicking an action navigates to the record with that dialog
// open") — the ONLY quick actions a `?openAction=` link is allowed to
// auto-open; anything else is ignored rather than trusted blindly from a
// query string.
const OPEN_ACTION_VALUES = ["email", "meeting", "discard", "call", "task"] as const;
type OpenActionParam = (typeof OPEN_ACTION_VALUES)[number];
function isOpenActionParam(value: string | undefined): value is OpenActionParam {
  return !!value && (OPEN_ACTION_VALUES as readonly string[]).includes(value);
}

/**
 * Three-pane record shell (task 9.2; mockups/contact-record.html). The
 * read-only shell shipped in PR 09b1; PR 09b2 wired inline property edit
 * (task 9.4); PR 09b3 added the Nota/Correo/Tarea quick actions; PR 10a
 * (task 10.1) replaces the "Actividad" placeholder with the filtered
 * timeline pane.
 */
export default async function ContactRecordPage({ params, searchParams }: ContactRecordPageProps) {
  const { id } = await params;
  const { activityType: rawActivityType, openAction: rawOpenAction, conversation: rawConversation } = await searchParams;
  const openAction = isOpenActionParam(rawOpenAction) ? rawOpenAction : null;
  const result = await getContactRecord(id);

  if (result.kind === "not_found") notFound();
  if (result.kind === "redirect") redirect(`/contacts/${result.personId}`);

  const { record } = result;
  const dict = await getDictionary();
  const l = pickContactRecordLabels(dict);
  const messageLabels = pickGenerateMessageLabels(dict);
  const locale = await getLocale();
  const activePill = resolveTimelinePillKey(rawActivityType);
  // "Tareas" (contact-record.html:104) isn't a real `TimelinePillKey` — see
  // the doc comment on @/lib/activity/timelinePills — so a `?activityType=task`
  // deep link must bypass `resolveTimelinePillKey` (which would silently fall
  // back to "Todo") to still land the Timeline client component on the
  // Tareas pill. `activePill` above stays the one used for the actual
  // `getPersonTimeline` filter, unaffected.
  const timelineTab = rawActivityType === "task" ? ("task" as const) : activePill;
  const me = await getCurrentBd();
  const isAdmin = me.role === "admin";
  const [timeline, ownerOptions, tasksForPerson] = await Promise.all([
    getPersonTimeline(record.person.id, me.id, { pill: activePill }),
    listOwnerOptions(),
    getTasksForPerson(record.person.id),
  ]);
  const personTasks = tasksForPerson.rows;
  // "Próximas" bucket + right-panel "Tareas" card (contact-record.html's
  // r03/r05 cards) only ever show OPEN tasks — unchanged by this pill; the
  // Timeline component itself gets the full `personTasks` (open + done) for
  // its own "Tareas" pill, plus the TRUE (never-capped) counts for its pill/
  // Todo totals.
  const openTasks = personTasks.filter((t) => t.status === "open");
  // Right-rail "Historial de conversaciones" card (admin-conversation-access
  // mockup) — admin-only, so a non-admin's render pays zero extra round
  // trips for this (the ternary skips the query entirely rather than
  // fetching and discarding).
  const lockedConversationSummaries = isAdmin
    ? await getLockedConversationSummaries(record.person.id, me.id)
    : [];
  // Audit log's "Abrir" link (?conversation=<bdId>) — admin-gated here,
  // server-side, BEFORE the param ever reaches a client component: a
  // non-admin never gets AdminConversationAutoOpen rendered at all, so no
  // modal and no data, no matter what the query string says.
  const autoOpenAdminBdId = isAdmin ? resolveConversationDialogParam(rawConversation) : null;
  // R3 (design.md): reassignment is only allowed while the person has no
  // `person_bd_connection` row yet — same rule bulkAssignOwner (task 13.2)
  // enforces server-side for updateContactOwnerAction (task 13.3).
  const ownerLocked = record.connections.length > 0;

  const name = [record.person.firstName, record.person.lastName].filter(Boolean).join(" ") || dict.contact.unnamed;
  const statusLabel = dict.leadStatuses[record.person.status as keyof typeof dict.leadStatuses] ?? record.person.status;

  const toAboutPaneProperty = (p: (typeof record.properties)[number]): AboutPaneProperty => ({
    key: p.key,
    label: l[`prop${p.key.charAt(0).toUpperCase()}${p.key.slice(1)}` as keyof typeof l] as string,
    value: p.value,
    lastUpdatedLabel: p.lastEdit
      ? `${l.lastUpdatedByPrefix} ${p.lastEdit.bdName ?? "—"} · ${formatArgentinaDayMonth(p.lastEdit.at)}`
      : null,
  });

  // "Ubicación" (contact-record.html:86) is ONE row in the mockup, composed
  // from city+country (region never shown) — city/region/country stay
  // separately editable properties with their own audit history (design
  // R7), so they're pulled out of the flat `properties` list and handed to
  // PropertyList as their own trio for the composite row's expanded edit
  // form (see composeLocation, @/lib/contacts/locationDisplay).
  const LOCATION_KEYS = new Set(["city", "region", "country"]);
  const properties: AboutPaneProperty[] = record.properties
    .filter((p) => !LOCATION_KEYS.has(p.key))
    .map(toAboutPaneProperty);
  const locationProperties = {
    city: toAboutPaneProperty(record.properties.find((p) => p.key === "city")!),
    region: toAboutPaneProperty(record.properties.find((p) => p.key === "region")!),
    country: toAboutPaneProperty(record.properties.find((p) => p.key === "country")!),
  };

  // "Por qué este rol" hint on the Cargo row (openspec/changes/bd-playbook,
  // surface 1) — classifyPosition is a pure function over the jobTitle
  // already fetched above for the Cargo row itself, so this adds no query.
  // Deliberately reclassifies from the raw jobTitle text rather than trusting
  // the separately editable `roleGroup` property (a BD can override that one
  // by hand), so the hint always explains the CURRENT Cargo value.
  const jobTitleRoleGroupKey = classifyPosition(record.person.jobTitle);
  const jobTitleRoleGroupEntry = ROLE_GROUP_PLAYBOOK[jobTitleRoleGroupKey];
  const jobTitleRoleGroupHint = {
    roleGroupLabel: dict.roleGroups[jobTitleRoleGroupKey],
    decides: jobTitleRoleGroupEntry.decides ?? null,
    painSolved: jobTitleRoleGroupEntry.painSolved ?? null,
    note: jobTitleRoleGroupEntry.note ?? null,
    guideHref: `/playbook#${jobTitleRoleGroupKey}`,
  };

  // "Estado" derivation "why" hint (contact-record.html:77) — composed
  // server-side from `record.statusReason` via `dict.contactRecordServer`'s
  // function templates (never passed to the client component directly, see
  // the comment on `contactRecordServer` in dictionaries/es.ts).
  const statusReasonText = record.statusReason
    ? describeStatusReason(
        dict.contactRecordServer,
        dict.leadStatuses,
        l.emptyValue,
        l.statusNextStepReplied,
        record.statusReason,
        formatArgentinaDayMonth(record.statusReason.at),
      )
    : null;

  // Oldest connection date for the "Responsable" hint (contact-record.html:78
  // "Conexión más antigua (14 mar 2019)") — `record.connections` is already
  // ordered oldest-first (queries.ts `orderBy(asc(connectedOn))`).
  const oldestConnectedOn = record.connections[0]?.connectedOn ?? null;
  const ownerHint = oldestConnectedOn ? dict.contactRecordServer.ownerHintOldestConnection(oldestConnectedOn) : null;

  // "Correo electrónico" Hunter provenance hint (contact-record.html:79
  // "Hunter · 96 % de confianza · actualizado por Cristian Civita, 20 ago").
  const emailHistory = record.properties.find((p) => p.key === "email")?.lastEdit ?? null;
  const hunterHint =
    record.person.emailConfidence != null && emailHistory
      ? dict.contactRecordServer.hunterHint(
          record.person.emailConfidence,
          emailHistory.bdName ?? l.emptyValue,
          formatArgentinaDayMonth(emailHistory.at),
        )
      : null;

  // "Origen" row (contact-record.html:85 "LinkedIn (3 BDs) · Lista de leads
  // fi-arg-2026") — see ContactSourceEvidence (queries.ts) for the bounded
  // per-person reads behind this.
  const sourceParts: string[] = [];
  if (record.source.linkedinConnectionCount > 0) {
    sourceParts.push(`${l.sourceLinkedInPrefix} (${record.source.linkedinConnectionCount} ${l.sourceLinkedInBdSuffix})`);
  }
  if (record.source.leadSourceKey) {
    sourceParts.push(`${l.sourceLeadListPrefix} ${record.source.leadSourceKey}`);
  }
  const sourceText = sourceParts.length ? sourceParts.join(" · ") : null;

  // "Creado" row (contact-record.html:86 "6 oct 2026 · unificado por
  // migración") — the migration suffix only applies to rows the collapse/
  // fold-leads migration actually created (`migrationRunId` set).
  const createdText = `${formatArgentinaDayMonthYear(record.person.createdAt)}${
    record.person.migrationRunId ? ` · ${l.createdViaMigration}` : ""
  }`;

  // Right panel — Empresa card (contact-record.html:160-163). Bounded to
  // this Contact's single `companyKey`, or skipped entirely when there is
  // none.
  const companyKey = record.person.companyKey;
  const [companyRow, companyPostings, companyContactCount] = companyKey
    ? await Promise.all([getCompanyByKey(companyKey), getCompanyPostingsForKey(companyKey), getCompanyContactCount(companyKey)])
    : [null, null, 0];
  // postings.postings is now capped (see getCompanyPostingsForKey's
  // DETAIL_ROW_LIMIT) — the true count for a company with more open
  // postings than the cap lives in totalCount, not postings.length.
  const companyOpenItCount = companyPostings?.totalCount ?? 0;
  // `company.domain` (hubspot-import migration, drizzle/0015_company_domain.sql)
  // is the real, owner-maintained domain — prefer it. Fall back to deriving
  // one from this Contact's own verified email domain only when the
  // company has none on file (see resolveCompanyDomain).
  const companyDomain = resolveCompanyDomain(companyRow?.domain, record.person.email);
  // Bug fix (Empresa recovery, same rule as /contacts' list/board/export/
  // outreach reads — companyDisplayName.ts): `companyRow` is already fetched
  // above for this one person, so this is a free fallback, not a new query.
  // Free text wins when present; canonical `company.display_name` only
  // fills in the null case.
  const companyDisplayName = resolveCompanyDisplayName(record.person.company, companyRow?.displayName);
  const stageLabels: Record<string, string> = {
    prospect: dict.companiesPage.stageProspect,
    qualified: dict.companiesPage.stageQualified,
    proposal_sent: dict.companiesPage.stageProposalSent,
    won: dict.companiesPage.stageWon,
    lost: dict.companiesPage.stageLost,
  };
  function stageLabel(stage: string): string {
    return stageLabels[stage] ?? stage;
  }

  // Resumen tab (contact-record.html:151-157; mockup-port r06) — every stat
  // reuses data already fetched above for the Actividad tab/right panel.
  const lastActivityCandidates: RecentActivityCandidate[] = [
    ...timeline.entries.map((e) => ({
      at: e.at,
      channelLabel:
        e.type === "email_sent" ? l.channelEmail : e.type === "note" ? l.channelNote : l.timelineSystemActor,
      actorName: e.actorName,
    })),
    ...record.connections
      .filter((c) => c.lastMessageAt !== null)
      .map((c) => ({ at: c.lastMessageAt!, channelLabel: l.channelLinkedIn, actorName: c.bdName })),
  ];
  const lastActivity = mostRecentActivity(lastActivityCandidates);
  const touchpoints = {
    linkedin: record.connections.reduce((sum, c) => sum + c.messageCount, 0),
    email: timeline.countsByType.email_sent ?? 0,
    notes: timeline.countsByType.note ?? 0,
  };
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const signal =
    companyKey && companyOpenItCount > 0
      ? {
          companyName: companyDisplayName ?? l.noCompany,
          openItCount: companyOpenItCount,
          newLast7Days: companyPostings?.newLast7DaysCount ?? 0,
        }
      : null;

  // Right panel — "Historial de conversaciones" (contact-record.html:172-178;
  // admin-conversation-access mockup, admin-conversation.html:138-144) is a
  // SEPARATE card from "BDs conectados" — restored 2026-09-30 (owner
  // decision) as ONE merged card (ConversationHistoryCard.tsx), not two: the
  // viewer's OWN connection (LinkedIn message history) is for everyone, an
  // expandable full history on demand; every OTHER BD's locked content
  // (email thread(s), LinkedIn message history, or both) is admin-only,
  // combined into one row per BD since the destination route is
  // (contact, BD)-scoped regardless of channel (README decision 4) — no
  // "LinkedIn" filter pill anywhere on this page either way.
  const ownConnection = record.connections.find((c) => c.bdId === me.id) ?? null;
  const ownConnectionHistory = ownConnection ? describeConnectionHistory(ownConnection) : null;
  const ownConversationRow =
    ownConnection && ownConnectionHistory?.kind === "some"
      ? {
          bdName: ownConnection.bdName ?? l.emptyValue,
          summaryText: dict.contactRecordServer.conversationHistorySummary(
            ownConnectionHistory.count,
            ownConnectionHistory.lastMessageAt
              ? formatArgentinaDayMonth(ownConnectionHistory.lastMessageAt)
              : l.emptyValue,
          ),
        }
      : null;
  // Same summary text as the right panel card above, precomposed for the
  // Timeline's own interleaved LinkedIn entries (Timeline.tsx is a Client
  // Component — `dict.contactRecordServer`'s function templates can't cross
  // that boundary, same rule as `mergeInfo.bodyText` below) — keyed by bdId
  // since a synthesized LinkedIn timeline entry only carries `linkedinMeta.bdId`.
  // Covers every connection with history (not just the viewer's own): a
  // non-own locked entry never reads this map (see isLinkedinEntryLocked in
  // Timeline.tsx), so only the "own" lookup ever resolves in practice, but
  // keying by every bdId here costs nothing extra and keeps this map a
  // simple, total function of `record.connections`.
  const linkedinSummaryByBdId: Record<string, string> = {};
  for (const c of record.connections) {
    const history = describeConnectionHistory(c);
    if (history.kind !== "some") continue;
    linkedinSummaryByBdId[c.bdId] = dict.contactRecordServer.conversationHistorySummary(
      history.count,
      history.lastMessageAt ? formatArgentinaDayMonth(history.lastMessageAt) : l.emptyValue,
    );
  }
  // Admin-only locked summaries (ConversationHistoryCard's `summaries` prop):
  // union of BDs with a locked EMAIL thread (getLockedConversationSummaries,
  // above) and BDs with real LinkedIn message history (record.connections,
  // excluding the viewer's own) — merged by bdId into ONE row per BD rather
  // than listing the same BD twice, since either channel navigates to the
  // SAME (contact, BD)-scoped conversation page.
  const lockedConversationRowsByBd = new Map<string, { bdId: string; bdName: string; parts: string[] }>();
  if (isAdmin) {
    for (const s of lockedConversationSummaries) {
      lockedConversationRowsByBd.set(s.bdId, {
        bdId: s.bdId,
        bdName: s.bdName,
        parts: [dict.contactRecordServer.lockedConversationThreadCount(s.threadCount)],
      });
    }
    for (const c of record.connections) {
      if (c.bdId === me.id) continue;
      const history = describeConnectionHistory(c);
      if (history.kind !== "some") continue;
      const summaryText = dict.contactRecordServer.conversationHistorySummary(
        history.count,
        history.lastMessageAt ? formatArgentinaDayMonth(history.lastMessageAt) : l.emptyValue,
      );
      const existing = lockedConversationRowsByBd.get(c.bdId);
      if (existing) existing.parts.push(summaryText);
      else lockedConversationRowsByBd.set(c.bdId, { bdId: c.bdId, bdName: c.bdName ?? l.emptyValue, parts: [summaryText] });
    }
  }
  const lockedConversationRows = [...lockedConversationRowsByBd.values()]
    .map((r) => ({ bdId: r.bdId, bdName: r.bdName, summaryText: r.parts.join(" · ") }))
    .sort((a, b) => a.bdName.localeCompare(b.bdName));

  // Non-admin locked rows (bugfix 2026-09-30 — see resolveLockedConnectionCardRows's
  // own doc comment): every OTHER BD's LinkedIn connection with real message
  // history, name + count/date only, no content, no action. Only computed
  // (and only rendered) for a non-admin — an admin already gets the fuller
  // `lockedConversationRows` above, with the "Ver" action.
  const nonAdminLockedConversationRows = !isAdmin
    ? resolveLockedConnectionCardRows(record.connections, me.id)
        .map((r) => ({
          bdId: r.bdId,
          bdName: r.bdName ?? l.emptyValue,
          summaryText: linkedinSummaryByBdId[r.bdId] ?? l.emptyValue,
        }))
        .sort((a, b) => a.bdName.localeCompare(b.bdName))
    : [];

  return (
    <main>
      <div className="record">
        <AboutPane
          personId={record.person.id}
          labels={l}
          name={name}
          jobTitle={record.person.jobTitle}
          company={companyDisplayName}
          companyKey={record.person.companyKey}
          statusLabel={statusLabel}
          statusValue={record.person.status}
          statusReasonText={statusReasonText}
          emailVerified={record.person.emailStatus === "verified"}
          emailInferred={record.person.emailSource === "pattern_inferred"}
          linkedinHref={linkedinProfileHref(record.person.profileKey)}
          ownerLabel={record.ownerName}
          ownerBdId={record.person.ownerBdId}
          ownerLocked={ownerLocked}
          ownerOptions={ownerOptions}
          assigneeOptions={ownerOptions}
          meId={me.id}
          ownerHint={ownerHint}
          email={record.person.email}
          hunterHint={hunterHint}
          sourceText={sourceText}
          createdText={createdText}
          properties={properties}
          locationProperties={locationProperties}
          jobTitleRoleGroupHint={jobTitleRoleGroupHint}
          messageLabels={messageLabels}
          locale={locale}
          initialAction={openAction}
        />

        <div className="record-main">
          <RecordTabs
            tabs={[
              {
                id: "activity",
                label: l.tabActivity,
                content: (
                  <Timeline
                    personId={record.person.id}
                    personName={name}
                    labels={l}
                    entries={timeline.entries}
                    countsByType={timeline.countsByType}
                    activePill={timelineTab}
                    tasks={personTasks.map((t) => ({
                      id: t.id,
                      title: t.title,
                      description: t.description,
                      status: t.status as "open" | "done",
                      dueAt: t.dueAt,
                      createdAt: t.createdAt,
                      updatedAt: t.updatedAt,
                      assignedToBdId: t.assignedToBdId,
                      assignedToName: t.assignedToName ?? null,
                      associationLabel: companyDisplayName ? `${name} · ${companyDisplayName}` : name,
                    }))}
                    taskTotalCount={tasksForPerson.openCount + tasksForPerson.doneCount}
                    assigneeOptions={ownerOptions}
                    meId={me.id}
                    taskLabels={pickEditTaskLabels(l)}
                    isAdmin={isAdmin}
                    connections={record.connections}
                    linkedinSummaryByBdId={linkedinSummaryByBdId}
                    mergeInfo={
                      record.merge.unifiedFromCount > 1
                        ? {
                            ...record.merge,
                            at: record.person.createdAt,
                            // Timeline is a Client Component (fix/timeline-
                            // filter-no-reload) — `dict.contactRecordServer`'s
                            // function templates can't cross the server ->
                            // client boundary (same rule as
                            // ContactRecordLabels/ClientStrings elsewhere in
                            // this file), so the merge card's body text is
                            // rendered to a plain string here instead.
                            bodyText: dict.contactRecordServer.mergeCardBody(record.merge.unifiedFromCount),
                          }
                        : null
                    }
                    statusMovedByActivityId={
                      record.statusReason?.status === "replied" && record.statusReason.because.source === "activity"
                        ? record.statusReason.because.activityId
                        : null
                    }
                  />
                ),
              },
              {
                id: "overview",
                label: l.tabOverview,
                content: (
                  <Overview
                    labels={l}
                    serverStrings={dict.contactRecordServer}
                    lastActivity={
                      lastActivity
                        ? {
                            relativeLabel: formatDistanceToNow(lastActivity.at, { locale: es }),
                            channelLabel: lastActivity.channelLabel,
                            actorName: lastActivity.actorName,
                          }
                        : null
                    }
                    touchpoints={{ ...touchpoints, total: touchpointTotal(touchpoints) }}
                    openTasks={openTasks.map((t) => ({
                      id: t.id,
                      title: t.title,
                      dueAt: t.dueAt,
                      assignedToName: t.assignedToName ?? null,
                    }))}
                    signal={signal}
                  />
                ),
              },
            ]}
          />
        </div>

        <aside className="record-right">
          <div className="card assoc">
            <div className="card-header">
              <h3>{l.companyCardTitle}</h3>
              <span className="actions">
                <ChangeCompanyButton
                  personId={record.person.id}
                  // Detach must stay available for every person that HAS a
                  // companyKey, even the ~1,100 in production whose key has
                  // no matching `company` row (a pre-existing data gap:
                  // person.companyKey has no FK — see companyChange.ts).
                  // Display name prefers the company table's own
                  // displayName (companyRow), falls back to the person's
                  // own `company` text when there's no matching row, and
                  // finally the raw key so the dialog is never blank for a
                  // person that clearly has SOME company on file.
                  currentCompany={
                    companyKey
                      ? { companyKey, displayName: companyRow?.displayName ?? record.person.company ?? companyKey }
                      : null
                  }
                  labels={l}
                />
              </span>
            </div>
            <div className="card-body">
              {record.person.companyKey ? (
                <>
                  <div className="assoc-row">
                    <span className="company-logo lg" aria-hidden="true">
                      {initialsFromName(companyDisplayName ?? l.noCompany)}
                    </span>
                    <div className="grow">
                      <Link className="n" href={`/companies/${record.person.companyKey}`}>
                        {companyDisplayName ?? l.noCompany}
                      </Link>
                      <div className="s">
                        {[companyDomain, record.person.industry].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </div>
                  <div className="row wrap mt-lg">
                    {companyOpenItCount > 0 && (
                      <span className="badge badge-success no-dot">
                        {dict.contactRecordServer.hiringBadge(companyOpenItCount)}
                      </span>
                    )}
                    {companyRow?.relationshipStage && (
                      <span className="badge badge-neutral no-dot">
                        {l.stageBadgePrefix} {stageLabel(companyRow.relationshipStage)}
                      </span>
                    )}
                  </div>
                  <div className="meta mt-lg">{dict.contactRecordServer.companyContactCount(companyContactCount)}</div>
                </>
              ) : (
                <div>{l.noCompany}</div>
              )}
            </div>
          </div>

          <div className="card assoc">
            <div className="card-header">
              <h3>{l.connectedBdsTitle}</h3>
              <span className="meta">{record.connections.length}</span>
            </div>
            <div className="card-body">
              {record.connections.length ? (
                record.connections.map((c) => (
                  <div key={c.bdId} className="assoc-row">
                    <Avatar id={c.bdId} initials={initialsFromName(c.bdName ?? "—")} variant="bd" size="sm" />
                    <div className="grow">
                      <div className="n">
                        {c.bdName ?? l.emptyValue}
                        {c.bdId === record.person.ownerBdId && (
                          <span className="badge badge-brand no-dot">{l.propOwner}</span>
                        )}
                      </div>
                      <div className="s">
                        {c.connectedOn ? `${l.connectedOnPrefix} ${c.connectedOn}` : l.emptyValue}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="placeholder">{l.associationsComingSoon}</div>
              )}
            </div>
          </div>

          <ConversationHistoryCard
            personId={record.person.id}
            personName={name}
            ownRow={ownConversationRow}
            summaries={lockedConversationRows}
            lockedRows={nonAdminLockedConversationRows}
            labels={l}
          />

          <div className="card assoc">
            <div className="card-header">
              <h3>{l.tasksCardTitle}</h3>
              <span className="actions">
                <a className="btn btn-ghost btn-sm btn-icon" href="#task" aria-label={l.addTaskAction}>
                  <PlusIcon className="icon" />
                </a>
              </span>
            </div>
            <div className="card-body">
              {openTasks.length ? (
                openTasks.map((t) => (
                  <div key={t.id} className="assoc-row">
                    <CompleteTaskCheckbox
                      taskId={t.id}
                      personId={record.person.id}
                      ariaLabel={l.taskMarkDone}
                      errorLabel={l.genericError}
                    />
                    <div className="grow">
                      <TaskTitleLink
                        task={{
                          id: t.id,
                          title: t.title,
                          description: t.description,
                          dueAt: t.dueAt,
                          assignedToBdId: t.assignedToBdId,
                          status: t.status as "open" | "done" | "cancelled",
                          personId: t.personId,
                          companyKey: t.companyKey,
                          associationLabel: companyDisplayName ? `${name} · ${companyDisplayName}` : name,
                        }}
                        className="n"
                        assigneeOptions={ownerOptions}
                        meId={me.id}
                        labels={pickEditTaskLabels(l)}
                      />
                      <div className="s">
                        {t.dueAt ? `${l.taskDueBadgePrefix} ${formatTaskDueDate(t.dueAt)}` : l.emptyValue}
                        {t.assignedToName ? ` · ${t.assignedToName}` : ""}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="placeholder">{l.associationsComingSoon}</div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {autoOpenAdminBdId && (
        <AdminConversationAutoOpen
          bdId={autoOpenAdminBdId}
          personId={record.person.id}
          personName={name}
          labels={l}
        />
      )}
    </main>
  );
}
