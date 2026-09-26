import Link from "next/link";
import type { getDictionary } from "@/lib/i18n/server";
import type { ContactBoardColumn, ContactListRow } from "@/lib/contacts/listQueries";
import { BOARD_COLUMNS, boardDropAction } from "@/lib/contacts/board";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { BoardDnD } from "./BoardDnD";

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
  const moveConfirmLabels = {
    titlePrefix: l.boardMoveConfirmTitlePrefix,
    body: l.boardMoveConfirmBody,
    confirm: l.boardMoveConfirmConfirm,
    cancel: l.cancel,
  };

  return (
    <BoardDnD labels={moveConfirmLabels}>
      <p className="meta mb-lg">{l.boardDropHint}</p>
      <div className="board">
        {columns.map((col) => {
          const targets = BOARD_COLUMNS.filter((s) => s !== col.status && boardDropAction(s));
          return (
            <section
              key={col.status}
              className="board-col"
              aria-label={dict.leadStatuses[col.status]}
              data-board-status={col.status}
            >
              <div className="col-header">
                <span className={`badge badge-${col.status}`}>{dict.leadStatuses[col.status]}</span>
                <span className="n">{col.total}</span>
              </div>

              {col.rows.length === 0 && <p className="meta small">{l.boardColumnEmpty}</p>}

              {col.rows.map((row) => (
                <div key={row.id} className="board-card" draggable data-person-id={row.id}>
                  <Link href={`/contacts/${row.id}`} className="title">
                    {cardTitle(row)}
                  </Link>
                  {cardSub(row) && <div className="sub">{cardSub(row)}</div>}
                  <div className="foot">
                    {row.ownerName ? (
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
                      <span className="meta">{l.ownerNone}</span>
                    )}
                    {targets.length > 0 && (
                      <details className="dropdown">
                        <summary className="meta" aria-label={l.boardMoveToLabel}>
                          {l.boardMoveToLabel}
                        </summary>
                        <div className="menu">
                          {targets.map((status) => (
                            <Link
                              key={status}
                              href={`/contacts/${row.id}?openAction=${boardDropAction(status)}`}
                              className="menu-item"
                              data-board-move-label={dict.leadStatuses[status]}
                            >
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
                <Link href={tableHref} className="col-more">
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
