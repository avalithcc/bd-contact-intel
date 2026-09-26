import Link from "next/link";
import { getCurrentBd } from "@/lib/queries";
import { getDictionary } from "@/lib/i18n/server";
import { getHiringCompanyKeys } from "@/lib/hiring/queries";
import { listSavedViews } from "@/lib/contacts/savedViews";
import {
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
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface ContactsPageProps {
  searchParams: Promise<{ view?: string; q?: string; page?: string; columns?: string }>;
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

  const [savedViewRows, hiringKeys] = await Promise.all([
    listSavedViews(me.id),
    getHiringCompanyKeys(),
  ]);
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

  const [{ rows, total, totalPages, page: currentPage }, systemViewCounts] = await Promise.all([
    getContactListPage(activeView.filters, me.id, sp.q, page, PAGE_SIZE, hiringKeys),
    Promise.all(
      SYSTEM_VIEWS.map((v) => getContactCountForFilters(v.filters, me.id, hiringKeys)),
    ),
  ]);

  const from = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(currentPage * PAGE_SIZE, total);

  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    params.set("view", activeView.viewKey);
    if (sp.q) params.set("q", sp.q);
    params.set("page", String(targetPage));
    return `/contacts?${params.toString()}`;
  }

  const currentFiltersQuery = serializeContactFilters(activeView.filters).toString();

  return (
    <main>
      <div className={styles.header}>
        <h1 className={styles.title}>{l.pageTitle}</h1>
        <p className={styles.subtitle}>{l.subtitle}</p>
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

      {rows.length === 0 ? (
        <p className={styles.empty}>{l.noResults}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{l.colName}</th>
                {visibleColumns.map((key) => (
                  <th key={key}>{columnLabel(key, l)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
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
      )}
    </main>
  );
}
