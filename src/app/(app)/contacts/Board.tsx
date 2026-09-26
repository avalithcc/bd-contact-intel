import Link from "next/link";
import type { getDictionary } from "@/lib/i18n/server";
import type { ContactBoardColumn, ContactListRow } from "@/lib/contacts/listQueries";
import { BOARD_COLUMNS, boardDropAction } from "@/lib/contacts/board";
import { BoardDnD } from "./BoardDnD";
import styles from "./page.module.css";

type Dict = Awaited<ReturnType<typeof getDictionary>>;

interface BoardProps {
  columns: ContactBoardColumn[];
  dict: Dict;
  tableHref: string;
}

function cardTitle(row: ContactListRow): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || row.id;
}

function cardSub(row: ContactListRow): string | null {
  return [row.jobTitle, row.company].filter(Boolean).join(" · ") || null;
}

/**
 * Board view (task 14.1; mockups/contacts-board.html): one column per
 * derived status (`BOARD_COLUMNS`), each capped at `BOARD_COLUMN_LIMIT`
 * cards server-side (`getContactBoardColumns`). Every card carries a
 * native `<details>` "Mover a..." menu — links to
 * `/contacts/[id]?openAction=X`, which the record page opens directly
 * (task 10.5) — as the always-working, no-JS, keyboard-reachable way to
 * move a card. `BoardDnD` layers HTML5 drag-and-drop on top of the exact
 * same URLs as a progressive enhancement, never a replacement.
 */
export function Board({ columns, dict, tableHref }: BoardProps) {
  const l = dict.contactList;

  return (
    <BoardDnD>
      <p className={styles.boardHint}>{l.boardDropHint}</p>
      <div className={styles.board}>
        {columns.map((col) => {
          const targets = BOARD_COLUMNS.filter((s) => s !== col.status && boardDropAction(s));
          return (
            <section
              key={col.status}
              className={styles.boardCol}
              aria-label={dict.leadStatuses[col.status]}
              data-board-status={col.status}
            >
              <div className={styles.boardColHeader}>
                <span className={styles.statusBadge}>{dict.leadStatuses[col.status]}</span>
                <span>{col.total}</span>
              </div>

              {col.rows.length === 0 && <p className={styles.boardEmpty}>{l.boardColumnEmpty}</p>}

              {col.rows.map((row) => (
                <div key={row.id} className={styles.boardCard} draggable data-person-id={row.id}>
                  <Link href={`/contacts/${row.id}`} className={styles.boardCardLink}>
                    <div className={styles.name}>{cardTitle(row)}</div>
                    {cardSub(row) && <div className={styles.jobTitle}>{cardSub(row)}</div>}
                  </Link>
                  <div className={styles.boardCardFoot}>
                    <span>{row.ownerName ?? l.ownerNone}</span>
                    {targets.length > 0 && (
                      <details className={styles.boardMoveMenu}>
                        <summary aria-label={l.boardMoveToLabel}>{l.boardMoveToLabel}</summary>
                        <div className={styles.boardMoveMenuList}>
                          {targets.map((status) => (
                            <Link key={status} href={`/contacts/${row.id}?openAction=${boardDropAction(status)}`}>
                              {dict.leadStatuses[status]}
                            </Link>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              ))}

              {col.total > col.rows.length && (
                <Link href={tableHref} className={styles.boardColMore}>
                  {l.boardColumnMore(col.total)}
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </BoardDnD>
  );
}
