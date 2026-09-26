import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { companyLogoInitials } from "@/lib/contacts/companyLogo";
import { relativeTime } from "@/lib/i18n/format";
import { getHiringCompanyKeys, getHiringMatchIndex } from "@/lib/hiring/queries";
import { listSavedViews } from "@/lib/contacts/savedViews";
import {
  getContactBoardColumns,
  getContactCountForFilters,
  getContactFilterOptions,
  getContactListPage,
  type ContactListRow,
} from "@/lib/contacts/listQueries";
import {
  SYSTEM_VIEWS,
  resolveActiveView,
  type ActiveView,
  type ActiveViewSavedInput,
} from "@/lib/contacts/views";
import {
  applyAdHocContactFilterOverrides,
  PERSON_STATUSES,
  serializeContactFilters,
  type ContactFilters,
} from "@/lib/contacts/viewFilters";
import {
  ALL_CONTACT_COLUMNS,
  resolveVisibleColumns,
  type ContactColumnKey,
} from "@/lib/contacts/columns";
import { parseContactSort, type ContactSortKey } from "@/lib/contacts/sort";
import { buildActiveFilterChips } from "@/lib/contacts/filterChips";
import { splitViewTabs, type ViewTabItem } from "@/lib/contacts/viewTabs";
import { DropdownMenu } from "@/components/DropdownMenu";
import { LinkPendingDot } from "./LinkPendingDot";
import { FilterMenu } from "./FilterMenu";
import { deleteSavedViewAction } from "./viewActions";
import { ColumnPicker } from "./ColumnPicker";
import { NewContactDialog, type NewContactDialogLabels } from "./NewContactDialog";
import { SaveViewDialog } from "./SaveViewDialog";
import { buildSaveViewSummary } from "@/lib/contacts/filterChips";
import { listOwnerOptions } from "@/lib/contacts/bulkOwnerDb";
import { pickBulkActionsLabels } from "@/lib/contacts/labels";
import { BulkActionsBar } from "./BulkActionsBar";
import { Board } from "./Board";
import { getOutreachContactsPage } from "@/lib/contacts/outreachViewDb";
import {
  buildOutreachViewParams,
  parseOutreachViewFilters,
  type OutreachViewSearchParams,
} from "@/lib/contacts/outreachViewParams";
import { ROLE_GROUPS } from "@/lib/roleGroups";
import { COMPANY_CATEGORIES } from "@/lib/companyCategories";
import { MARKETS } from "@/lib/hiring/markets";
import { pickGenerateMessageLabels } from "@/lib/outreach/messageLabels";
import { GenerateMessageButton } from "../outreach/GenerateMessageButton";
import { generateOutreachMessage } from "../outreach/actions";
import { TableIcon, BoardIcon } from "@/components/icons";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface ContactsPageProps {
  searchParams: Promise<{
    view?: string;
    q?: string;
    page?: string;
    columns?: string;
    bulkResult?: string;
    bulkLimited?: string;
    layout?: string;
    // Ad-hoc filter panel (task 13.3 parity gaps), layered on top of the
    // active view's filters — see applyAdHocContactFilterOverrides.
    owner?: string;
    industryGroup?: string;
    seniority?: string;
    emailStatus?: string;
    // Multi-select status chip (mockup: "Nuevo, Contactado" as ONE chip) —
    // checkboxes sharing `name="status"` produce repeated `?status=` params
    // on a GET form submit, which Next.js parses as string[]; a single
    // value (e.g. a chip-removal link) stays a plain string.
    status?: string | string[];
    // 10-filter parity (contacts.html "Agregar filtro") — company/
    // bdConnected/lastActivityDays are new query params; market/roleGroup/
    // startupsOnly below already exist for the Outreach-view branch and are
    // reused verbatim for the general ad-hoc filter panel (mutually
    // exclusive branches, no collision).
    company?: string;
    hiring?: string;
    bdConnected?: string;
    lastActivityDays?: string;
    // "Outreach" system view filters (task 15a-2; owner decision
    // 2026-09-26): same param names/semantics as `/outreach`'s own
    // searchParams — see src/lib/contacts/outreachViewParams.ts.
    roleGroup?: string;
    companyCategory?: string;
    market?: string;
    miamiOnly?: string;
    excludeNever?: string;
    hideOffshore?: string;
    startupsOnly?: string;
    name?: string;
    sort?: string;
  }>;
}

/** Parses the `?bulkResult=` redirect param (bulkActions.ts) into the
 * Spanish banner text — kept server-side (page.tsx) since the two
 * formatters (bulkResultOwner/bulkResultTask) aren't client-safe. */
function bulkResultMessage(
  raw: string | undefined,
  l: Awaited<ReturnType<typeof getDictionary>>["contactList"],
): string | null {
  if (!raw) return null;
  const [kind, a, b] = raw.split(":");
  if (kind === "owner") return l.bulkResultOwner(Number(a) || 0, Number(b) || 0);
  if (kind === "task") return l.bulkResultTask(Number(a) || 0);
  return null;
}

function emailBadge(row: ContactListRow, dict: Awaited<ReturnType<typeof getDictionary>>) {
  if (row.emailStatus === "verified") return dict.contactList.emailVerified;
  if (row.emailStatus === "probable") return dict.contactList.emailProbable;
  return null;
}

function columnLabel(
  key: ContactColumnKey,
  l: Awaited<ReturnType<typeof getDictionary>>["contactList"],
): string {
  switch (key) {
    case "company":
      return l.colCompany;
    case "owner":
      return l.colOwner;
    case "status":
      return l.colStatus;
    case "email":
      return l.colEmail;
    case "bdConnections":
      return l.colBdConnections;
    case "lastActivity":
      return l.colLastActivity;
    case "roleGroup":
      return l.colRoleGroup;
    case "industry":
      return l.colIndustry;
    case "country":
      return l.colCountry;
    case "source":
      return l.colSource;
    case "created":
      return l.colCreated;
    case "seniority":
      return l.colSeniority;
  }
}

function columnCell(
  key: ContactColumnKey,
  row: ContactListRow,
  dict: Awaited<ReturnType<typeof getDictionary>>,
  relTime: (d: Date) => string,
  hiringCompanyKeys: Set<string>,
) {
  const l = dict.contactList;
  switch (key) {
    case "company":
      return row.company ? (
        <>
          <span className="company-logo" aria-hidden="true">
            {companyLogoInitials(row.company)}
          </span>{" "}
          <span className="soft">{row.company}</span>
          {row.companyKey && hiringCompanyKeys.has(row.companyKey) && (
            <span className="badge badge-success no-dot">{l.hiringBadge}</span>
          )}
        </>
      ) : (
        l.ownerNone
      );
    case "owner":
      return row.ownerName ? (
        <span className="owner-chip">
          <Avatar
            id={row.ownerBdId ?? row.ownerName}
            initials={initialsFromName(row.ownerName)}
            variant="bd"
            size="sm"
          />
          {row.ownerName}
        </span>
      ) : (
        l.ownerNone
      );
    case "status": {
      const statusLabel = dict.leadStatuses[row.status as keyof typeof dict.leadStatuses] ?? row.status;
      const knownStatus = PERSON_STATUSES.includes(row.status as (typeof PERSON_STATUSES)[number]);
      return <span className={knownStatus ? `badge badge-${row.status}` : "badge"}>{statusLabel}</span>;
    }
    case "email": {
      if (row.emailStatus === "verified") {
        return (
          <>
            <span className="badge badge-verified">{l.emailVerified}</span> <span className="meta">{row.email}</span>
          </>
        );
      }
      if (row.emailStatus === "probable") {
        return (
          <>
            <span className="badge badge-probable">{l.emailProbable}</span> <span className="meta">{row.email}</span>
          </>
        );
      }
      return row.email ? row.email : <span className="badge badge-none">{l.emailNone}</span>;
    }
    case "bdConnections":
      return row.bdConnections.avatars.length ? (
        <span className="avatar-stack" title={row.bdConnections.title}>
          {row.bdConnections.avatars.map((a) => (
            <Avatar key={a.bdId} id={a.bdId} initials={a.initials} variant="bd" size="sm" />
          ))}
        </span>
      ) : (
        l.ownerNone
      );
    case "lastActivity":
      return row.lastActivity ? `${row.lastActivity.label} · ${relTime(row.lastActivity.createdAt)}` : "—";
    case "roleGroup":
      return row.roleGroup ?? l.ownerNone;
    case "industry":
      return row.industry ?? l.ownerNone;
    case "country":
      return row.country ?? l.ownerNone;
    case "source":
      return row.sourceKey ?? l.ownerNone;
    case "created":
      return row.createdAt.toLocaleDateString();
    case "seniority":
      return row.seniority ?? l.ownerNone;
  }
}

/**
 * `/contacts` list (task 12.2-12.4; design.md "Routes": "New list. `?view=`,
 * filters and `?layout=board` all live in the query string"; contact-list
 * spec). System views (src/lib/contacts/views.ts) plus a BD's own saved
 * views (src/lib/contacts/savedViews.ts) render as tabs. Column picker
 * (task 13.1; src/lib/contacts/columns.ts) lets a BD choose visible
 * columns beyond Name — persisted onto `saved_view.columns` for a saved
 * view, or via a `?columns=` query override for a system view (no DB row
 * to persist onto). Bulk-action bar/board toggle remain Phase 13/14 scope.
 */
export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const sp = await searchParams;
  // Normalizes the multi-select status chip's repeated `?status=` params
  // (parsed as string[] by Next.js) down to the same comma-joined shape
  // every other ad-hoc filter/href-building helper below expects.
  const statusQuery = Array.isArray(sp.status) ? sp.status.join(",") : sp.status;
  const me = await getCurrentBd();
  const dict = await getDictionary();
  const l = dict.contactList;
  const page = Math.max(1, Number(sp.page) || 1);

  const [savedViewRows, hiringKeys, ownerOptions, filterOptions, hiringMatchIndex] = await Promise.all([
    listSavedViews(me.id),
    getHiringCompanyKeys(),
    listOwnerOptions(),
    getContactFilterOptions(),
    // "Empresa" column's inline "Contratando" badge (mockup) — ONE call for
    // the whole page, never per-row, same function the market/startup
    // ad-hoc filters already reuse (listQueries.ts), so the badge and
    // those filters can never disagree on which companies count as hiring.
    getHiringMatchIndex(),
  ]);
  const hiringCompanyKeysForBadge = new Set(hiringMatchIndex.keys());
  const bulkLabels = pickBulkActionsLabels(dict);
  const bulkMessage = bulkResultMessage(sp.bulkResult, l);
  const savedViewsForResolve: ActiveViewSavedInput[] = savedViewRows.map((v) => ({
    id: v.id,
    name: v.name,
    filters: v.filters,
  }));

  // "Outreach" system view (task 15a-2; owner decision 2026-09-26): the
  // candidate set is a hiring-index crossover, not a plain `ContactFilters`
  // WHERE clause (see src/lib/contacts/outreachViewParams.ts), so it's
  // resolved as its own branch rather than added to SYSTEM_VIEWS/
  // resolveActiveView — an empty `filters` here is never actually read for
  // this branch (effectiveFilters/getContactListPage are skipped below).
  const isOutreachView = sp.view === "outreach";
  const activeView: ActiveView = isOutreachView
    ? { viewKey: "outreach", filters: {}, isSaved: false, savedViewId: null, savedViewName: null }
    : resolveActiveView(sp.view, savedViewsForResolve);

  // Ad-hoc filter panel (task 13.3 parity gaps: industryGroup, seniority,
  // owner-by-specific-BD/unassigned, granular emailStatus — task 13.1's
  // deferred "Agregar filtro" scope). Layers on top of the active view's
  // filters field-by-field; an explicit empty selection clears the
  // inherited value instead of being ignored.
  const effectiveFilters: ContactFilters = applyAdHocContactFilterOverrides(activeView.filters, {
    owner: sp.owner,
    industryGroup: sp.industryGroup,
    seniority: sp.seniority,
    emailStatus: sp.emailStatus,
    status: statusQuery,
    company: sp.company,
    hiring: sp.hiring,
    market: sp.market,
    roleGroup: sp.roleGroup,
    startupsOnly: sp.startupsOnly,
    bdConnected: sp.bdConnected,
    lastActivityDays: sp.lastActivityDays,
  });

  // Column picker (task 13.1): a `?columns=` query override wins (used by
  // system views, which have no DB row to persist onto); otherwise a saved
  // view's persisted `columns` (design D7); otherwise the default set.
  const queryColumns = sp.columns ? sp.columns.split(",") : undefined;
  const persistedColumns = activeView.isSaved
    ? savedViewRows.find((v) => v.id === activeView.savedViewId)?.columns
    : undefined;
  const visibleColumns = resolveVisibleColumns(queryColumns ?? persistedColumns);
  const columnLabelsByKey = Object.fromEntries(
    ALL_CONTACT_COLUMNS.map((key) => [key, columnLabel(key, l)]),
  ) as Record<ContactColumnKey, string>;
  const newContactLabels: NewContactDialogLabels = {
    triggerLabel: l.newContactTrigger,
    title: l.newContactTitle,
    firstNameLabel: l.newContactFirstName,
    lastNameLabel: l.newContactLastName,
    linkedinLabel: l.newContactLinkedin,
    linkedinHelp: l.newContactLinkedinHelp,
    emailLabel: l.newContactEmail,
    companyLabel: l.newContactCompany,
    cancelLabel: l.newContactCancel,
    createLabel: l.newContactCreate,
    createAnywayLabel: l.newContactCreateAnyway,
    openExistingLabel: l.newContactOpenExisting,
    duplicateWarningPrefix: l.newContactDuplicateWarningPrefix,
    duplicateWarningBody: l.newContactDuplicateWarningBody,
    existingMatchTitle: l.newContactExistingMatchTitle,
    existingMatchBody: l.newContactExistingMatchBody,
    blockedOwnCompany: l.newContactBlockedOwnCompany,
    invalidRequiresName: l.newContactInvalidRequiresName,
  };

  // Table/board toggle (task 14.1; design.md "Routes": "`?layout=board`
  // all live in the query string"). Board mode groups by derived status
  // instead of paginating a single list, so it fetches
  // `getContactBoardColumns` instead of `getContactListPage`.
  const isBoard = !isOutreachView && sp.layout === "board";
  const sort = parseContactSort(sp.sort);

  const locale = await getLocale();
  const relTime = (d: Date) => relativeTime(d, locale);
  const messageLabels = pickGenerateMessageLabels(dict);
  const outreachFilters = parseOutreachViewFilters(sp);

  const [listPage, systemViewCounts, boardColumns, outreachPage] = await Promise.all([
    isOutreachView || isBoard
      ? null
      : getContactListPage(effectiveFilters, me.id, sp.q, page, PAGE_SIZE, dict, sort, hiringKeys),
    Promise.all(SYSTEM_VIEWS.map((v) => getContactCountForFilters(v.filters, me.id, hiringKeys))),
    isBoard ? getContactBoardColumns(effectiveFilters, me.id, sp.q, dict, hiringKeys) : null,
    isOutreachView
      ? getOutreachContactsPage(me.id, outreachFilters, page, PAGE_SIZE, relTime, dict)
      : null,
  ]);

  const { rows, total, totalPages, page: currentPage } = listPage ?? {
    rows: [] as ContactListRow[],
    total: 0,
    totalPages: 1,
    page: 1,
  };

  const from = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(currentPage * PAGE_SIZE, total);

  function outreachPageHref(targetPage: number): string {
    return `/contacts?${buildOutreachViewParams(sp as OutreachViewSearchParams, targetPage).toString()}`;
  }

  // Ad-hoc filter query params (task 13.3) ride along on every link the
  // page generates (pagination, layout toggle) so they never silently
  // reset when a BD navigates within the same view.
  function withAdHocFilterParams(params: URLSearchParams): URLSearchParams {
    if (sp.owner !== undefined) params.set("owner", sp.owner);
    if (sp.industryGroup !== undefined) params.set("industryGroup", sp.industryGroup);
    if (sp.seniority !== undefined) params.set("seniority", sp.seniority);
    if (sp.emailStatus !== undefined) params.set("emailStatus", sp.emailStatus);
    if (statusQuery !== undefined) params.set("status", statusQuery);
    if (sp.company !== undefined) params.set("company", sp.company);
    if (sp.hiring !== undefined) params.set("hiring", sp.hiring);
    if (sp.market !== undefined) params.set("market", sp.market);
    if (sp.roleGroup !== undefined) params.set("roleGroup", sp.roleGroup);
    if (sp.startupsOnly !== undefined) params.set("startupsOnly", sp.startupsOnly);
    if (sp.bdConnected !== undefined) params.set("bdConnected", sp.bdConnected);
    if (sp.lastActivityDays !== undefined) params.set("lastActivityDays", sp.lastActivityDays);
    if (sp.sort !== undefined) params.set("sort", sp.sort);
    return params;
  }

  // FilterMenu.tsx builds its own per-field "remove" hrefs from
  // `filterMenuBaseParams` below (same params this function already
  // builds), so a chip's × always clears exactly one field while keeping
  // every other filter/sort/layout/page-size param untouched.
  const filterMenuBaseParams = (() => {
    const params = withAdHocFilterParams(new URLSearchParams());
    params.set("view", activeView.viewKey);
    if (sp.q) params.set("q", sp.q);
    if (sp.layout) params.set("layout", sp.layout);
    if (sp.columns) params.set("columns", sp.columns);
    return params.toString();
  })();

  function clearAllFiltersHref(): string {
    const params = new URLSearchParams();
    params.set("view", activeView.viewKey);
    if (sp.q) params.set("q", sp.q);
    if (sp.sort) params.set("sort", sp.sort);
    if (sp.columns) params.set("columns", sp.columns);
    return `/contacts?${params.toString()}`;
  }

  const bdNameById = new Map(ownerOptions.map((o) => [o.id, o.name]));
  const activeFilterChips = isOutreachView
    ? []
    : buildActiveFilterChips(effectiveFilters, {
        ownerLabel: (value) =>
          value === "me" ? l.filterOwnerMe : value === "unassigned" ? l.filterOwnerUnassigned : (bdNameById.get(value) ?? value),
        statusLabel: (status) => dict.leadStatuses[status],
        emailStatusLabel: (status) =>
          status === "verified" ? l.emailVerified : status === "probable" ? l.emailProbable : l.emailNone,
        marketLabel: (market) => dict.markets[market],
        roleGroupLabel: (key) => dict.roleGroups[key as keyof typeof dict.roleGroups] ?? key,
        bdName: (bdId) => bdNameById.get(bdId) ?? bdId,
      });

  // Sortable headers (mockup: "Nombre" and "Última actividad ↓", the
  // latter sorted by default). A plain link toggle, same "no client JS
  // needed" convention as pagination/layout — no asc/desc affordance since
  // the static mockup shows none either.
  function sortHref(target: ContactSortKey): string {
    const params = withAdHocFilterParams(new URLSearchParams());
    params.set("view", activeView.viewKey);
    if (sp.q) params.set("q", sp.q);
    params.set("sort", target);
    return `/contacts?${params.toString()}`;
  }

  // Toolbar-level "Exportar" (contacts.html:95, whole filtered view — not
  // just the bulk selection BulkActionsBar.tsx's own "Exportar" covers).
  // Serializes the ALREADY-RESOLVED `effectiveFilters` straight through, so
  // `/contacts/export` never has to re-resolve `?view=` itself — see that
  // route's doc comment.
  function toolbarExportHref(): string {
    const params = serializeContactFilters(effectiveFilters);
    if (sp.q) params.set("q", sp.q);
    params.set("sort", sort);
    if (visibleColumns.length) params.set("columns", visibleColumns.join(","));
    return `/contacts/export?${params.toString()}`;
  }

  function pageHref(targetPage: number): string {
    const params = withAdHocFilterParams(new URLSearchParams());
    params.set("view", activeView.viewKey);
    if (sp.q) params.set("q", sp.q);
    params.set("page", String(targetPage));
    return `/contacts?${params.toString()}`;
  }

  function layoutHref(target: "table" | "board"): string {
    const params = withAdHocFilterParams(new URLSearchParams());
    params.set("view", activeView.viewKey);
    if (sp.q) params.set("q", sp.q);
    if (target === "board") params.set("layout", "board");
    return `/contacts?${params.toString()}`;
  }

  const currentFiltersQuery = serializeContactFilters(effectiveFilters).toString();
  const saveViewSummaryChips = buildSaveViewSummary(activeFilterChips, visibleColumns.length, l.saveViewColumnsLabel);

  // View-tabs overflow fix (owner-chosen option A, feedback round 18): split
  // every view into pinned tabs (always visible, no horizontal scroll down
  // to ~1024px) vs. a "Más vistas" dropdown — see viewTabs.ts for the pure
  // split and PINNED_VIEW_TAB_KEYS for the owner-chosen set.
  const viewTabItems: ViewTabItem[] = [
    ...SYSTEM_VIEWS.map((v, i) => ({
      key: v.key,
      label: l.views[v.key],
      href: `/contacts?view=${v.key}`,
      active: activeView.viewKey === v.key,
      count: systemViewCounts[i],
    })),
    {
      key: "outreach",
      label: dict.nav.outreach,
      href: "/contacts?view=outreach",
      active: isOutreachView,
    },
    ...savedViewRows.map((v) => ({
      key: `saved:${v.id}`,
      label: v.name,
      href: `/contacts?view=saved:${v.id}`,
      active: activeView.savedViewId === v.id,
    })),
  ];
  const { pinned: pinnedViewTabs, overflow: overflowViewTabs, activeOverflowItem } = splitViewTabs(viewTabItems);
  const savedViewIdByKey = new Map(savedViewRows.map((v) => [`saved:${v.id}`, v.id]));

  function renderViewTab(item: ViewTabItem, inMenu = false) {
    const baseClassName = inMenu ? "menu-item" : "view-tab";
    const savedId = savedViewIdByKey.get(item.key);
    if (savedId) {
      return (
        <span key={item.key} className={`${baseClassName}${item.active ? " active" : ""}`}>
          <Link href={item.href} aria-current={item.active ? "page" : undefined}>
            {item.label}
          </Link>
          <form action={deleteSavedViewAction} className="inline-block">
            <input type="hidden" name="id" value={savedId} />
            <button type="submit" className={styles.deleteView} aria-label={l.deleteView}>
              ×
            </button>
          </form>
        </span>
      );
    }
    return (
      <Link
        key={item.key}
        href={item.href}
        className={`${baseClassName}${item.active ? " active" : ""}`}
        aria-current={item.active ? "page" : undefined}
      >
        {item.label}
        {item.count !== undefined && <span className="count">{item.count}</span>}
        {!inMenu && <LinkPendingDot />}
      </Link>
    );
  }

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.pageTitle}</div>
          <h1>
            {l.pageTitle.toLowerCase()}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{l.subtitle}</p>
        </div>
        <div className="actions">
          {!isOutreachView && (
            <div className="segmented" role="group" aria-label={l.layoutTable + " / " + l.layoutBoard}>
              <Link href={layoutHref("table")} className={isBoard ? "" : "on"} aria-current={isBoard ? undefined : "page"}>
                <TableIcon className="icon" />
                {l.layoutTable}
                <LinkPendingDot />
              </Link>
              <Link href={layoutHref("board")} className={isBoard ? "on" : ""} aria-current={isBoard ? "page" : undefined}>
                <BoardIcon className="icon" />
                {l.layoutBoard}
                <LinkPendingDot />
              </Link>
            </div>
          )}
          <Link href="/contacts/import" className="btn btn-secondary">
            {dict.contactsImport.pageTitle}
          </Link>
          <NewContactDialog labels={newContactLabels} />
        </div>
      </div>

      <nav className="view-tabs" aria-label={l.savedViewsGroupLabel}>
        {pinnedViewTabs.map((item) => renderViewTab(item))}
        {activeOverflowItem && renderViewTab(activeOverflowItem)}
        <DropdownMenu
          trigger={<>{l.moreViews} ▾</>}
          triggerClassName="view-tab"
          ariaLabel={l.moreViews}
          align="left"
        >
          {overflowViewTabs.map((item) => renderViewTab(item, true))}
        </DropdownMenu>
        <SaveViewDialog
          labels={{
            triggerLabel: l.saveView,
            title: l.saveViewDialogTitle,
            nameLabel: l.saveViewNameLabel,
            includesLabel: l.saveViewIncludesLabel,
            helpText: l.saveViewHelp,
            cancelLabel: l.newContactCancel,
            saveLabel: l.saveView,
          }}
          filtersQuery={currentFiltersQuery}
          summaryChips={saveViewSummaryChips}
        />
      </nav>

      {isOutreachView ? (
        <section className="panel">
          <div className="eyebrow">{dict.common.filterEyebrow}</div>
          <form method="get" action="/contacts" className="filter-toolbar">
            <input type="hidden" name="view" value="outreach" />
            <div className="filter-field">
              <label htmlFor="roleGroup">{dict.common.roleGroupLabel}</label>
              <select id="roleGroup" name="roleGroup" defaultValue={sp.roleGroup ?? ""}>
                <option value="">{dict.common.allGroups}</option>
                {ROLE_GROUPS.map((g) => (
                  <option key={g.key} value={g.key}>
                    {dict.roleGroups[g.key]}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label htmlFor="name">{dict.outreach.nameFilterLabel}</label>
              <input
                id="name"
                name="name"
                type="text"
                defaultValue={sp.name ?? ""}
                placeholder={dict.outreach.nameFilterPlaceholder}
              />
            </div>
            <div className="filter-field">
              <label htmlFor="companyCategory">{dict.home.companyCategoryLabel}</label>
              <select id="companyCategory" name="companyCategory" defaultValue={sp.companyCategory ?? ""}>
                <option value="">{dict.home.allCategories}</option>
                {COMPANY_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {dict.companyCategories[c.key]}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label htmlFor="market">{dict.common.marketLabel}</label>
              <select id="market" name="market" defaultValue={sp.market ?? ""}>
                <option value="">{dict.common.allMarkets}</option>
                {MARKETS.map((m) => (
                  <option key={m} value={m}>
                    {dict.markets[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-checkbox-group" role="group">
              {sp.market === "us" && (
                <div className="filter-checkbox">
                  <label htmlFor="miamiOnly" className="checkbox-label">
                    <input id="miamiOnly" name="miamiOnly" type="checkbox" defaultChecked={sp.miamiOnly === "on"} />
                    {dict.common.miamiOnlyLabel}
                  </label>
                </div>
              )}
              <div className="filter-checkbox">
                <label htmlFor="excludeNever" className="checkbox-label">
                  <input id="excludeNever" name="excludeNever" type="checkbox" defaultChecked={sp.excludeNever === "on"} />
                  {dict.outreach.excludeNeverMessaged}
                </label>
              </div>
              <div className="filter-checkbox">
                <label htmlFor="hideOffshore" className="checkbox-label">
                  <input id="hideOffshore" name="hideOffshore" type="checkbox" defaultChecked={sp.hideOffshore === "on"} />
                  {dict.common.hideOffshoreLabel}
                </label>
              </div>
              <div className="filter-checkbox">
                <label htmlFor="startupsOnly" className="checkbox-label">
                  <input id="startupsOnly" name="startupsOnly" type="checkbox" defaultChecked={sp.startupsOnly === "on"} />
                  {dict.outreach.startupsOnlyLabel}
                </label>
              </div>
            </div>
            <button type="submit" className="filter-submit">
              {dict.common.filter}
            </button>
          </form>
        </section>
      ) : (
        <div className="toolbar">
          <FilterMenu
            baseParamsQuery={filterMenuBaseParams}
            chips={activeFilterChips}
            ownerSelectOptions={[
              { value: "me", label: l.filterOwnerMe },
              { value: "unassigned", label: l.filterOwnerUnassigned },
              ...ownerOptions.map((o) => ({ value: o.id, label: o.name })),
            ]}
            bdConnectedOptions={ownerOptions.map((o) => ({ value: o.id, label: o.name }))}
            statusOptions={PERSON_STATUSES.map((s) => ({ value: s, label: dict.leadStatuses[s] }))}
            emailStatusOptions={[
              { value: "verified", label: l.emailVerified },
              { value: "probable", label: l.emailProbable },
              { value: "none", label: l.emailNone },
            ]}
            marketOptions={MARKETS.map((m) => ({ value: m, label: dict.markets[m] }))}
            roleGroupOptions={ROLE_GROUPS.map((g) => ({ value: g.key, label: dict.roleGroups[g.key] }))}
            lastActivityOptions={[
              { value: "7", label: l.filterLastActivity7d },
              { value: "30", label: l.filterLastActivity30d },
              { value: "90", label: l.filterLastActivity90d },
            ]}
            industryGroupOptions={filterOptions.industryGroups.map((v) => ({ value: v, label: v }))}
            seniorityOptions={filterOptions.seniorities.map((v) => ({ value: v, label: v }))}
            labels={{
              addFilterLabel: l.filtersPanelLabel,
              removeFilterLabel: l.filterRemoveLabel,
              applyLabel: l.filtersApply,
              cancelLabel: l.newContactCancel,
              anyLabel: l.filterOwnerAny,
            }}
          />
          {activeFilterChips.length > 0 && (
            <Link href={clearAllFiltersHref()} className="btn btn-ghost btn-sm">
              {l.filtersClearAll}
            </Link>
          )}
          {!isBoard && (
            <>
              <span className="spacer" />
              <span className="meta">
                {l.sortedByPrefix} <strong className="soft">{sort === "name" ? l.colName : l.colLastActivity}</strong>
              </span>
              <ColumnPicker
                viewKey={activeView.viewKey}
                allColumns={ALL_CONTACT_COLUMNS}
                visibleColumns={visibleColumns}
                columnLabels={columnLabelsByKey}
                labels={{
                  pickerLabel: l.columnsPickerLabel,
                  helpText: l.columnsPickerHelp,
                  nameLabel: l.colName,
                  applyLabel: l.columnsApply,
                  resetLabel: l.columnsReset,
                  moveUpLabel: l.columnsMoveUp,
                  moveDownLabel: l.columnsMoveDown,
                }}
              />
              <Link href={toolbarExportHref()} className="btn btn-secondary btn-sm">
                {l.bulkExport}
              </Link>
            </>
          )}
        </div>
      )}

      {bulkMessage && (
        <div className="alert alert-info mb-lg">
          <p>{bulkMessage}</p>
        </div>
      )}
      {sp.bulkLimited === "1" && (
        <div className="alert alert-warn mb-lg">
          <p>{l.bulkLimitedNotice}</p>
        </div>
      )}

      {isOutreachView ? (
        outreachPage && !outreachPage.hiringCompanyCount ? (
          // Same two-tier empty state as /outreach (parity gap closed): no
          // hiring companies synced at all is a different, more actionable
          // message than "synced, but none of your contacts match".
          <p className="muted">
            {dict.outreach.noHiringCompaniesPrefix}
            <Link href="/hiring">{dict.outreach.noHiringCompaniesLinkText}</Link>
            {dict.outreach.noHiringCompaniesSuffix}
          </p>
        ) : outreachPage && outreachPage.hiringCompanyCount > 0 && !outreachPage.rows.length ? (
          <p className="muted">
            {dict.outreach.noMatchingContacts(
              outreachPage.hiringCompanyCount,
              Boolean(sp.roleGroup),
              sp.excludeNever === "on",
              Boolean(sp.companyCategory),
              sp.startupsOnly === "on",
            )}
          </p>
        ) : outreachPage && outreachPage.rows.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{dict.outreach.tableName}</th>
                  <th>{dict.outreach.tablePosition}</th>
                  <th>{dict.outreach.tableCompany}</th>
                  <th>{dict.outreach.tableRoleGroup}</th>
                  <th>{dict.outreach.tableOpenRoles}</th>
                  <th>{dict.outreach.tableLastContact}</th>
                  <th>{dict.outreach.tableWhy}</th>
                  <th>{dict.outreach.tableMessage}</th>
                </tr>
              </thead>
              <tbody>
                {outreachPage.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/contacts/${r.personId ?? r.id}`} className="name">
                        {[r.firstName, r.lastName].filter(Boolean).join(" ") || l.ownerNone}
                      </Link>
                    </td>
                    <td>{r.position ?? "—"}</td>
                    <td className="nowrap">
                      {r.company ?? "—"}
                      {r.isStartup && (
                        <span className="badge badge-brand" title={r.startupReason ?? undefined}>
                          {dict.outreach.startupBadge}
                        </span>
                      )}
                      {r.offshoreHeavy && (
                        <span className="badge badge-offshore">
                          {dict.common.offshoreBadge(r.offshoreItCount, r.latamItCount)}
                        </span>
                      )}
                    </td>
                    <td>{r.roleGroup ? dict.roleGroups[r.roleGroup] : "—"}</td>
                    <td>{r.openItCount}</td>
                    <td className="nowrap meta">{r.lastMessageAt ? relTime(new Date(r.lastMessageAt)) : dict.common.never}</td>
                    <td>
                      <div className="reason-chips">
                        {r.reasons.map((reason) => (
                          <span
                            key={reason}
                            className={
                              r.relationshipTier === "dormant"
                                ? "badge badge-neutral no-dot"
                                : r.isLeadership
                                  ? "badge badge-success no-dot"
                                  : "badge no-dot"
                            }
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {r.hasOwnContact ? (
                        <GenerateMessageButton
                          boundAction={generateOutreachMessage.bind(null, r.id, locale)}
                          labels={messageLabels}
                        />
                      ) : (
                        <span className="btn btn-secondary is-disabled" title={dict.outreach.unifiedRecordPending}>
                          {messageLabels.generateMessage}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="table-footer">
              <span>{l.showingRange((currentPage - 1) * PAGE_SIZE + 1, Math.min(currentPage * PAGE_SIZE, outreachPage.total), outreachPage.total)}</span>
              <div className="row">
                {outreachPage.page > 1 && (
                  <Link href={outreachPageHref(outreachPage.page - 1)} className="btn btn-secondary btn-sm">
                    {l.prevPage}
                  </Link>
                )}
                <span>{l.pageOf(outreachPage.page, outreachPage.totalPages)}</span>
                {outreachPage.page < outreachPage.totalPages && (
                  <Link href={outreachPageHref(outreachPage.page + 1)} className="btn btn-secondary btn-sm">
                    {l.nextPage}
                  </Link>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty">
            <p>{l.noResults}</p>
          </div>
        )
      ) : isBoard ? (
        <>
          {/* mockups/contacts-board.html:76 — "Las personas de la propia
              empresa nunca se muestran". Not board-specific enforcement: the
              identity resolver skips own-company matches at ingest time
              (src/lib/identity/matcher.ts skip_own_company), so no person
              row for an Avalith teammate ever exists to filter out, in
              either the table or the board. This note just surfaces that
              existing, already-universal invariant in the one place the
              mockup calls it out. */}
          <p className="meta mb-lg">{l.boardOwnCompanyNote}</p>
          <Board columns={boardColumns ?? []} dict={dict} tableHref={layoutHref("table")} />
        </>
      ) : rows.length === 0 ? (
        <div className="empty">
          <p>{l.noResults}</p>
        </div>
      ) : (
        <BulkActionsBar
          labels={bulkLabels}
          ownerOptions={ownerOptions}
          view={activeView.viewKey}
          q={sp.q}
          page={currentPage}
          columns={visibleColumns}
          locale={locale}
          messageLabels={messageLabels}
          total={total}
          filtersQuery={currentFiltersQuery}
          sort={sort}
          wholeViewExportHref={toolbarExportHref()}
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="col-check">
                    <input type="checkbox" id="select-all-contacts" aria-label={l.bulkSelectAllLabel} />
                  </th>
                  <th className={sort === "name" ? "sorted" : undefined}>
                    <Link href={sortHref("name")} >
                      {l.colName}
                      {sort === "name" && <span className="sort">↓</span>}
                    </Link>
                  </th>
                  {visibleColumns.map((key) =>
                    key === "lastActivity" ? (
                      <th key={key} className={sort === "lastActivity" ? "sorted" : undefined}>
                        <Link href={sortHref("lastActivity")} >
                          {columnLabel(key, l)}
                          {sort === "lastActivity" && <span className="sort">↓</span>}
                        </Link>
                      </th>
                    ) : (
                      <th key={key}>{columnLabel(key, l)}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="col-check">
                      <input type="checkbox" name="personId" value={row.id} aria-label={row.firstName ?? row.id} />
                    </td>
                    <td>
                      <div className="cell-person">
                        <Avatar
                          id={row.id}
                          initials={initialsFromName(
                            [row.firstName, row.lastName].filter(Boolean).join(" ") || row.id,
                          )}
                        />
                        <div>
                          <Link href={`/contacts/${row.id}`} className="name">
                            {[row.firstName, row.lastName].filter(Boolean).join(" ") || l.ownerNone}
                          </Link>
                          {row.jobTitle && <div className="sub">{row.jobTitle}</div>}
                        </div>
                      </div>
                    </td>
                    {visibleColumns.map((key) => (
                      <td key={key} className={key === "created" ? "nowrap meta" : undefined}>
                        {columnCell(key, row, dict, relTime, hiringCompanyKeysForBadge)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="table-footer">
              <span>{l.showingRange(from, to, total)}</span>
              <div className="row">
                {currentPage > 1 && (
                  <Link href={pageHref(currentPage - 1)} className="btn btn-secondary btn-sm">
                    {l.prevPage}
                  </Link>
                )}
                <span>{l.pageOf(currentPage, totalPages)}</span>
                {currentPage < totalPages && (
                  <Link href={pageHref(currentPage + 1)} className="btn btn-secondary btn-sm">
                    {l.nextPage}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </BulkActionsBar>
      )}
    </main>
  );
}
