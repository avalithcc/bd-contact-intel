import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import { getHiringCompanyKeys } from "@/lib/hiring/queries";
import { listSavedViews } from "@/lib/contacts/savedViews";
import {
  getContactBoardColumns,
  getContactCountForFilters,
  getContactListPage,
  type ContactListRow,
} from "@/lib/contacts/listQueries";
import {
  SYSTEM_VIEWS,
  resolveActiveView,
  type ActiveViewSavedInput,
} from "@/lib/contacts/views";
import { serializeContactFilters } from "@/lib/contacts/viewFilters";
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
      return row.ownerName ?? l.ownerNone;
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

  const [savedViewRows, hiringKeys, ownerOptions] = await Promise.all([
    listSavedViews(me.id),
    getHiringCompanyKeys(),
    listOwnerOptions(),
  ]);
  const bulkLabels = pickBulkActionsLabels(dict);
  const bulkMessage = bulkResultMessage(sp.bulkResult, l);
  const savedViewsForResolve: ActiveViewSavedInput[] = savedViewRows.map((v) => ({
    id: v.id,
    name: v.name,
    filters: v.filters,
  }));

  const activeView = resolveActiveView(sp.view, savedViewsForResolve);

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
  const isBoard = sp.layout === "board";

  const [listPage, systemViewCounts, boardColumns] = await Promise.all([
    isBoard ? null : getContactListPage(activeView.filters, me.id, sp.q, page, PAGE_SIZE, hiringKeys),
    Promise.all(SYSTEM_VIEWS.map((v) => getContactCountForFilters(v.filters, me.id, hiringKeys))),
    isBoard ? getContactBoardColumns(activeView.filters, me.id, sp.q, hiringKeys) : null,
  ]);

  const { rows, total, totalPages, page: currentPage } = listPage ?? {
    rows: [] as ContactListRow[],
    total: 0,
    totalPages: 1,
    page: 1,
  };

  const from = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(currentPage * PAGE_SIZE, total);

  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    params.set("view", activeView.viewKey);
    if (sp.q) params.set("q", sp.q);
    params.set("page", String(targetPage));
    return `/contacts?${params.toString()}`;
  }

  function layoutHref(target: "table" | "board"): string {
    const params = new URLSearchParams();
    params.set("view", activeView.viewKey);
    if (sp.q) params.set("q", sp.q);
    if (target === "board") params.set("layout", "board");
    return `/contacts?${params.toString()}`;
  }

  const currentFiltersQuery = serializeContactFilters(activeView.filters).toString();

  return (
    <main>
      <div className={styles.header}>
        <h1 className={styles.title}>{l.pageTitle}</h1>
        <p className={styles.subtitle}>{l.subtitle}</p>
      </div>

      <div className={styles.toolbarRow}>
        <div className={styles.layoutToggle} role="group" aria-label={l.layoutTable + " / " + l.layoutBoard}>
          <Link href={layoutHref("table")} className={isBoard ? styles.layoutToggleLink : styles.layoutToggleActive}>
            {l.layoutTable}
          </Link>
          <Link href={layoutHref("board")} className={isBoard ? styles.layoutToggleActive : styles.layoutToggleLink}>
            {l.layoutBoard}
          </Link>
        </div>
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

      {bulkMessage && <p className={styles.resultBanner}>{bulkMessage}</p>}
      {sp.bulkLimited === "1" && <p className={styles.resultBanner}>{l.bulkLimitedNotice}</p>}

      {isBoard ? (
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
                      <Link href={`/contacts/${row.id}`} className={styles.name}>
                        {[row.firstName, row.lastName].filter(Boolean).join(" ") || l.ownerNone}
                      </Link>
                      {row.jobTitle && <span className={styles.jobTitle}>{row.jobTitle}</span>}
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
