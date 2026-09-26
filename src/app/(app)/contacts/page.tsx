import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { relativeTime } from "@/lib/i18n/format";
import { getHiringCompanyKeys } from "@/lib/hiring/queries";
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
import {
  createSavedViewAction,
  deleteSavedViewAction,
  updateViewColumnsAction,
} from "./viewActions";
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
    status?: string;
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
) {
  const l = dict.contactList;
  switch (key) {
    case "company":
      return row.company ?? l.ownerNone;
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
      return <span className={styles.statusBadge}>{statusLabel}</span>;
    }
    case "email": {
      const badge = emailBadge(row, dict);
      return (
        <>
          {badge && <span className={styles.emailBadge}>{badge}</span>}
          {row.email ?? (badge ? null : l.emailNone)}
        </>
      );
    }
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
  const me = await getCurrentBd();
  const dict = await getDictionary();
  const l = dict.contactList;
  const page = Math.max(1, Number(sp.page) || 1);

  const [savedViewRows, hiringKeys, ownerOptions, filterOptions] = await Promise.all([
    listSavedViews(me.id),
    getHiringCompanyKeys(),
    listOwnerOptions(),
    getContactFilterOptions(),
  ]);
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
    status: sp.status,
  });

  // Column picker (task 13.1): a `?columns=` query override wins (used by
  // system views, which have no DB row to persist onto); otherwise a saved
  // view's persisted `columns` (design D7); otherwise the default set.
  const queryColumns = sp.columns ? sp.columns.split(",") : undefined;
  const persistedColumns = activeView.isSaved
    ? savedViewRows.find((v) => v.id === activeView.savedViewId)?.columns
    : undefined;
  const visibleColumns = resolveVisibleColumns(queryColumns ?? persistedColumns);

  // Table/board toggle (task 14.1; design.md "Routes": "`?layout=board`
  // all live in the query string"). Board mode groups by derived status
  // instead of paginating a single list, so it fetches
  // `getContactBoardColumns` instead of `getContactListPage`.
  const isBoard = !isOutreachView && sp.layout === "board";

  const locale = await getLocale();
  const relTime = (d: Date) => relativeTime(d, locale);
  const messageLabels = pickGenerateMessageLabels(dict);
  const outreachFilters = parseOutreachViewFilters(sp);

  const [listPage, systemViewCounts, boardColumns, outreachPage] = await Promise.all([
    isOutreachView || isBoard
      ? null
      : getContactListPage(effectiveFilters, me.id, sp.q, page, PAGE_SIZE, hiringKeys),
    Promise.all(SYSTEM_VIEWS.map((v) => getContactCountForFilters(v.filters, me.id, hiringKeys))),
    isBoard ? getContactBoardColumns(effectiveFilters, me.id, sp.q, hiringKeys) : null,
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
    if (sp.status !== undefined) params.set("status", sp.status);
    return params;
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

  return (
    <main>
      <div className={styles.header}>
        <h1 className={styles.title}>{l.pageTitle}</h1>
        <p className={styles.subtitle}>{l.subtitle}</p>
      </div>

      <div className={styles.toolbarRow}>
        {!isOutreachView && (
          <div className={styles.layoutToggle} role="group" aria-label={l.layoutTable + " / " + l.layoutBoard}>
            <Link href={layoutHref("table")} className={isBoard ? styles.layoutToggleLink : styles.layoutToggleActive}>
              {l.layoutTable}
            </Link>
            <Link href={layoutHref("board")} className={isBoard ? styles.layoutToggleActive : styles.layoutToggleLink}>
              {l.layoutBoard}
            </Link>
          </div>
        )}
        <Link href="/contacts/import" className="btn btn-secondary btn-sm">
          {dict.contactsImport.pageTitle}
        </Link>
      </div>

      <nav className={styles.viewTabs} aria-label={l.savedViewsGroupLabel}>
        {SYSTEM_VIEWS.map((v, i) => (
          <Link
            key={v.key}
            href={`/contacts?view=${v.key}`}
            className={activeView.viewKey === v.key ? styles.viewTabActive : styles.viewTab}
            aria-current={activeView.viewKey === v.key ? "page" : undefined}
          >
            {l.views[v.key]}
            <span className={styles.viewCount}>{systemViewCounts[i]}</span>
          </Link>
        ))}
        {/* Task 15a-2 (owner decision 2026-09-26): same ranking as
            /outreach, reused verbatim — see src/lib/contacts/outreachView.ts.
            No count badge (unlike the SYSTEM_VIEWS tabs above): computing it
            would mean running the hiring-index crossover on every /contacts
            load regardless of active view, not just when this tab is open. */}
        <Link
          href="/contacts?view=outreach"
          className={isOutreachView ? styles.viewTabActive : styles.viewTab}
          aria-current={isOutreachView ? "page" : undefined}
        >
          {dict.nav.outreach}
        </Link>
        {savedViewRows.map((v) => (
          <span key={v.id} className={styles.savedTab}>
            <Link
              href={`/contacts?view=saved:${v.id}`}
              className={activeView.savedViewId === v.id ? styles.viewTabActive : styles.viewTab}
              aria-current={activeView.savedViewId === v.id ? "page" : undefined}
            >
              {v.name}
            </Link>
            <form action={deleteSavedViewAction}>
              <input type="hidden" name="id" value={v.id} />
              <button type="submit" className={styles.deleteView} aria-label={l.deleteView}>
                ×
              </button>
            </form>
          </span>
        ))}
      </nav>

      {!isOutreachView && (
        <form action={createSavedViewAction} className={styles.saveViewForm}>
          <input type="hidden" name="filtersQuery" value={currentFiltersQuery} />
          <label htmlFor="save-view-name" className="sr-only">
            {l.saveViewNameLabel}
          </label>
          <input id="save-view-name" type="text" name="name" placeholder={l.saveViewNameLabel} required />
          <button type="submit" className="btn btn-secondary btn-sm">
            {l.saveView}
          </button>
        </form>
      )}

      {!isOutreachView && (
        <details className={styles.columnPicker}>
          <summary className="btn btn-secondary btn-sm">{l.columnsPickerLabel}</summary>
          <form action={updateViewColumnsAction} className={styles.columnPickerMenu}>
            <input type="hidden" name="view" value={activeView.viewKey} />
            <span className={styles.columnPickerHelp}>{l.columnsPickerHelp}</span>
            <label className={styles.columnCheck}>
              <input type="checkbox" checked disabled /> {l.colName}
            </label>
            {ALL_CONTACT_COLUMNS.map((key) => (
              <label key={key} className={styles.columnCheck}>
                <input
                  type="checkbox"
                  name="columns"
                  value={key}
                  defaultChecked={visibleColumns.includes(key)}
                />{" "}
                {columnLabel(key, l)}
              </label>
            ))}
            <button type="submit" className="btn btn-primary btn-sm">
              {l.columnsApply}
            </button>
          </form>
        </details>
      )}

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
        <details className={styles.columnPicker}>
          <summary className="btn btn-secondary btn-sm">{l.filtersPanelLabel}</summary>
          <form method="get" action="/contacts" className={styles.columnPickerMenu}>
            <input type="hidden" name="view" value={activeView.viewKey} />
            {sp.q && <input type="hidden" name="q" value={sp.q} />}
            {sp.layout && <input type="hidden" name="layout" value={sp.layout} />}
            {sp.columns && <input type="hidden" name="columns" value={sp.columns} />}

            <label className={styles.columnCheck}>
              {l.filterOwnerLabel}
              <select name="owner" defaultValue={sp.owner ?? ""}>
                <option value="">{l.filterOwnerAny}</option>
                <option value="me">{l.filterOwnerMe}</option>
                <option value="unassigned">{l.filterOwnerUnassigned}</option>
                {ownerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.columnCheck}>
              {l.filterIndustryLabel}
              <select name="industryGroup" defaultValue={sp.industryGroup ?? ""}>
                <option value="">{l.filterIndustryAny}</option>
                {filterOptions.industryGroups.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.columnCheck}>
              {l.filterSeniorityLabel}
              <select name="seniority" defaultValue={sp.seniority ?? ""}>
                <option value="">{l.filterSeniorityAny}</option>
                {filterOptions.seniorities.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.columnCheck}>
              {l.filterEmailStatusLabel}
              <select name="emailStatus" defaultValue={sp.emailStatus ?? ""}>
                <option value="">{l.filterEmailStatusAny}</option>
                <option value="verified">{l.emailVerified}</option>
                <option value="probable">{l.emailProbable}</option>
                <option value="none">{l.emailNone}</option>
              </select>
            </label>

            <label className={styles.columnCheck}>
              {l.filterStatusLabel}
              <select name="status" defaultValue={sp.status ?? ""}>
                <option value="">{l.filterStatusAny}</option>
                {PERSON_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {dict.leadStatuses[s]}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit" className="btn btn-primary btn-sm">
              {l.filtersApply}
            </button>
            <Link href={`/contacts?view=${activeView.viewKey}`} className="btn btn-secondary btn-sm">
              {l.filtersClear}
            </Link>
          </form>
        </details>
      )}

      {bulkMessage && <p className={styles.resultBanner}>{bulkMessage}</p>}
      {sp.bulkLimited === "1" && <p className={styles.resultBanner}>{l.bulkLimitedNotice}</p>}

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
          <div className={styles.tableWrap}>
            <table className={styles.table}>
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
                      <Link href={`/contacts/${r.personId ?? r.id}`} className={styles.name}>
                        {[r.firstName, r.lastName].filter(Boolean).join(" ") || l.ownerNone}
                      </Link>
                    </td>
                    <td>{r.position ?? "—"}</td>
                    <td>
                      {r.company ?? "—"}
                      {r.isStartup && (
                        <span className="badge startup" title={r.startupReason ?? undefined}>
                          {dict.outreach.startupBadge}
                        </span>
                      )}
                      {r.offshoreHeavy && (
                        <span className="badge offshore">
                          {dict.common.offshoreBadge(r.offshoreItCount, r.latamItCount)}
                        </span>
                      )}
                    </td>
                    <td>{r.roleGroup ? dict.roleGroups[r.roleGroup] : "—"}</td>
                    <td>{r.openItCount}</td>
                    <td>{r.lastMessageAt ? relTime(new Date(r.lastMessageAt)) : dict.common.never}</td>
                    <td>
                      <div className="reason-chips">
                        {r.reasons.map((reason) => (
                          <span
                            key={reason}
                            className={
                              r.relationshipTier === "dormant"
                                ? "badge dormant"
                                : r.isLeadership
                                  ? "badge green"
                                  : "badge"
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
                        <span className="secondary-btn disabled" title={dict.outreach.unifiedRecordPending}>
                          {messageLabels.generateMessage}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.footer}>
              <span>{l.showingRange((currentPage - 1) * PAGE_SIZE + 1, Math.min(currentPage * PAGE_SIZE, outreachPage.total), outreachPage.total)}</span>
              <div className={styles.pager}>
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
          <p className={styles.empty}>{l.noResults}</p>
        )
      ) : isBoard ? (
        <Board columns={boardColumns ?? []} dict={dict} tableHref={layoutHref("table")} />
      ) : rows.length === 0 ? (
        <p className={styles.empty}>{l.noResults}</p>
      ) : (
        <BulkActionsBar
          labels={bulkLabels}
          ownerOptions={ownerOptions}
          view={activeView.viewKey}
          q={sp.q}
          page={currentPage}
          columns={visibleColumns}
        >
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.colCheck}>
                    <input type="checkbox" id="select-all-contacts" aria-label={l.bulkSelectAllLabel} />
                  </th>
                  <th>{l.colName}</th>
                  {visibleColumns.map((key) => (
                    <th key={key}>{columnLabel(key, l)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className={styles.colCheck}>
                      <input type="checkbox" name="personId" value={row.id} aria-label={row.firstName ?? row.id} />
                    </td>
                    <td>
                      <div className={styles.cellPerson}>
                        <Avatar
                          id={row.id}
                          initials={initialsFromName(
                            [row.firstName, row.lastName].filter(Boolean).join(" ") || row.id,
                          )}
                        />
                        <div>
                          <Link href={`/contacts/${row.id}`} className={styles.name}>
                            {[row.firstName, row.lastName].filter(Boolean).join(" ") || l.ownerNone}
                          </Link>
                          {row.jobTitle && <span className={styles.jobTitle}>{row.jobTitle}</span>}
                        </div>
                      </div>
                    </td>
                    {visibleColumns.map((key) => (
                      <td key={key}>{columnCell(key, row, dict)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.footer}>
              <span>{l.showingRange(from, to, total)}</span>
              <div className={styles.pager}>
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
