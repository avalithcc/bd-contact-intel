import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminRequiredError } from "@/lib/auth/adminRole";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import {
  getDuplicateCandidateDetail,
  listOpenDuplicateCandidates,
  listRecentMergeEvents,
  type DuplicateCandidateDetail,
  type DuplicateCandidateSidePerson,
} from "@/lib/identity/duplicateReviewQueries";
import { Avatar } from "@/components/Avatar";
import { initialsFromName } from "@/components/initials";
import { es } from "@/lib/i18n/dictionaries/es";
import { formatDateTime } from "@/lib/i18n/format";
import { db } from "@/db";
import { buildMergePanel } from "@/lib/sequences/mergePanel";
import { planSequenceMergeFor } from "@/lib/sequences/mergeQueries";
import { parseRescanParams } from "@/lib/identity/duplicateRescan";
import { readLastRescanRun } from "@/lib/identity/duplicateRescanRun";
import { MergeSequencePanel } from "./MergeSequencePanel";
import { RescanPanel } from "./RescanPanel";
import { mergeDuplicateCandidateAction, markNotDuplicateAction, unmergeDuplicateAction } from "./actions";

export const dynamic = "force-dynamic";
// The manual re-scan runs from this page (one scan of every live person plus the write).
export const maxDuration = 300;

// Spanish-only regardless of `locale`, same rationale as /admin/migration
// (design D10, R11 — the `en` half only exists to satisfy `Dictionary`).
const dict = es.duplicates;

function isActionErrorReason(v: string | undefined): v is keyof typeof dict.actionErrors {
  return !!v && v in dict.actionErrors;
}

function reasonLabel(reason: string): string {
  return dict.reasonLabels[reason] ?? dict.reasonLabelFallback;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fieldRow(label: string, valueA: string, valueB: string, keepA: boolean, keepB: boolean) {
  const differs = valueA !== valueB;
  return (
    <tr key={label}>
      <th scope="legacy-row">{label}</th>
      <td className={differs ? "differs" : "match"}>
        {valueA}
        {keepA && <span className="keep">✓</span>}
      </td>
      <td className={differs ? "differs" : "match"}>
        {valueB}
        {keepB && <span className="keep">✓</span>}
      </td>
    </tr>
  );
}

function personLocation(p: DuplicateCandidateSidePerson): string {
  return [p.city, p.region, p.country].filter(Boolean).join(", ") || dict.noValue;
}

function ComparePanel({ detail, pairMeta, hasSequencePanel }: { detail: DuplicateCandidateDetail; pairMeta: string; hasSequencePanel: boolean }) {
  const survivorLabel = detail.recommendedSurvivor === "a" ? "A" : "B";
  const update = detail.preview.survivorUpdate;
  const survivor = detail.recommendedSurvivor === "a" ? detail.personA : detail.personB;

  return (
    <section className="panel">
      <div className="legacy-row between">
        <span className="legacy-badge warn">{reasonLabel(detail.reason)}</span>
        <span className="soft">{pairMeta}</span>
      </div>

      <p className="soft mt-md">{dict.recommendationNote(survivorLabel)}</p>

      <div className="table-wrap mt-md">
        <table className="duplicates-compare">
          <thead>
            <tr>
              <th></th>
              <th>
                <div className="legacy-row">
                  <Avatar id={detail.personA.id} initials={initialsFromName(detail.personA.name)} size="sm" />
                  <span>Ficha A · {detail.personA.name}</span>
                </div>
              </th>
              <th>
                <div className="legacy-row">
                  <Avatar id={detail.personB.id} initials={initialsFromName(detail.personB.name)} size="sm" />
                  <span>Ficha B · {detail.personB.name}</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {fieldRow(
              dict.fieldJobTitle,
              detail.personA.jobTitle ?? dict.noValue,
              detail.personB.jobTitle ?? dict.noValue,
              update.jobTitle === detail.personA.jobTitle,
              update.jobTitle === detail.personB.jobTitle,
            )}
            {fieldRow(
              dict.fieldEmail,
              detail.personA.email ?? dict.noValue,
              detail.personB.email ?? dict.noValue,
              update.email === detail.personA.email,
              update.email === detail.personB.email,
            )}
            {fieldRow(
              dict.fieldProfileKey,
              detail.personA.profileKey ?? dict.noValue,
              detail.personB.profileKey ?? dict.noValue,
              survivor.id === detail.personA.id && !!detail.personA.profileKey,
              survivor.id === detail.personB.id && !!detail.personB.profileKey,
            )}
            {fieldRow(dict.fieldLocation, personLocation(detail.personA), personLocation(detail.personB), false, false)}
            {fieldRow(
              dict.fieldOwner,
              detail.personA.ownerName ?? dict.noValue,
              detail.personB.ownerName ?? dict.noValue,
              update.ownerBdId !== null &&
                (detail.recommendedSurvivor === "a" ? detail.personA : detail.personB).ownerName !== null,
              false,
            )}
            {fieldRow(dict.fieldStatus, detail.personA.status, detail.personB.status, false, false)}
          </tbody>
        </table>
      </div>

      <div className="legacy-row end mt-lg">
        <form action={markNotDuplicateAction}>
          <input type="hidden" name="candidateId" value={detail.id} />
          <button type="submit" className="secondary">
            {dict.notDuplicateButton}
          </button>
        </form>
        {/* With a Sequence membership in play the merge button lives in the warning panel below. */}
        {!hasSequencePanel && (
          <form action={mergeDuplicateCandidateAction}>
            <input type="hidden" name="candidateId" value={detail.id} />
            <button type="submit">{dict.mergeButton(survivorLabel)}</button>
          </form>
        )}
      </div>
    </section>
  );
}

function UnmergeConfirmPanel({ mergeEventId, survivorName }: { mergeEventId: string; survivorName: string }) {
  return (
    <section className="panel duplicates-unmerge-confirm mt-md">
      <h3 className="m-0">{dict.unmergeConfirmTitle(survivorName)}</h3>
      <p className="soft mt-md">{dict.unmergeConfirmBody}</p>
      <ul className="soft">
        {dict.unmergeConfirmBullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
      <div className="legacy-row end mt-lg">
        <Link href="/admin/duplicates" className="secondary-btn">
          {dict.cancelButton}
        </Link>
        <form action={unmergeDuplicateAction}>
          <input type="hidden" name="mergeEventId" value={mergeEventId} />
          <button type="submit" className="danger">
            {dict.undoButton}
          </button>
        </form>
      </div>
    </section>
  );
}

export default async function DuplicatesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ candidate?: string; page?: string; actionError?: string; confirmUnmerge?: string; sendCancelled?: string } & Record<string, string | string[] | undefined>>;
}) {
  try {
    await requireAdmin();
  } catch (err) {
    // Admin screens 404 for non-admins (design.md "Routes"), same as
    // /admin/migration — existence is not meant to be discoverable.
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }

  const params = await searchParams;
  const rescanReport = parseRescanParams(params);
  const {
    candidate: candidateParam,
    page: pageParam,
    actionError,
    confirmUnmerge: confirmUnmergeParam,
    sendCancelled,
  } = params;
  const page = Math.max(1, Number(pageParam) || 1);

  const [list, history, lastRescan] = await Promise.all([listOpenDuplicateCandidates(page), listRecentMergeEvents(), readLastRescanRun(db)]);

  // "Deshacer fusión" links here with `?confirmUnmerge=<mergeEventId>` (mockup's
  // overlay, ported server-rendered/no-JS). Only whitelisted, not-yet-undone
  // events from the already-fetched history are eligible — a tampered id
  // can't reference an arbitrary merge_event row.
  const unmergeTarget =
    confirmUnmergeParam && UUID_RE.test(confirmUnmergeParam)
      ? (history.find((h) => h.mergeEventId === confirmUnmergeParam && !h.undoneAt) ?? null)
      : null;
  const selectedId = candidateParam ?? list.items[0]?.id ?? null;
  const detail = selectedId ? await getDuplicateCandidateDetail(selectedId) : null;
  // Same survivor rule as mergeDuplicateCandidateAction, so the panel describes exactly what Fusionar will do.
  const survivor = detail ? (detail.recommendedSurvivor === "a" ? detail.personA : detail.personB) : null;
  const mergedPerson = detail ? (detail.recommendedSurvivor === "a" ? detail.personB : detail.personA) : null;
  const sequencePanel =
    detail && survivor && mergedPerson
      ? buildMergePanel({
          plan: await planSequenceMergeFor(db, survivor.id, mergedPerson.id),
          survivor: { id: survivor.id, name: survivor.name },
          merged: { id: mergedPerson.id, name: mergedPerson.name },
          justCancelled: sendCancelled === "1",
        })
      : null;
  const selectedIndex = detail ? list.items.findIndex((i) => i.id === detail.id) : -1;
  const pairMeta = detail && selectedIndex >= 0 ? dict.pairMeta(list.startIndex + selectedIndex + 1, list.total) : "";

  return (
    <main>
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{dict.eyebrow}</div>
          <h1 className="m-0">
            {dict.title}
            <span className="dot">.</span>
          </h1>
          <p className="soft">{dict.subtitle(list.total)}</p>
        </div>
        <div className="actions">
          <span className="legacy-badge">{dict.adminOnlyBadge}</span>
        </div>
      </div>

      {isActionErrorReason(actionError) && (
        <section className="panel">
          <strong>{dict.actionErrors[actionError]}</strong>
        </section>
      )}

      <RescanPanel lastRun={lastRescan} report={rescanReport} />

      <div className="duplicates-split">
        <section className="panel">
          <div className="eyebrow">{dict.queueTitle}</div>
          {list.items.length === 0 && <p className="muted">{dict.emptyQueue}</p>}
          {list.items.map((item) => (
            <Link
              key={item.id}
              href={`/admin/duplicates?candidate=${item.id}`}
              className={`duplicates-queue-item${item.id === selectedId ? " active" : ""}`}
            >
              <div className="n">{item.personAName}</div>
              <div className="s">
                {item.company ?? dict.noValue} · {reasonLabel(item.reason)}
                {item.hasActivity && ` · ${dict.hasActivity}`}
              </div>
            </Link>
          ))}
          {list.pageCount > 1 && (
            <div className="legacy-row between mt-md">
              <Link
                href={`/admin/duplicates?page=${page - 1}`}
                className={page <= 1 ? "rowlink disabled" : "rowlink"}
              >
                {dict.prevPage}
              </Link>
              <span className="soft">{dict.pageOf(list.page, list.pageCount)}</span>
              <Link
                href={`/admin/duplicates?page=${page + 1}`}
                className={page >= list.pageCount ? "rowlink disabled" : "rowlink"}
              >
                {dict.nextPage}
              </Link>
            </div>
          )}
        </section>

        {detail ? (
          <div>
            <ComparePanel detail={detail} pairMeta={pairMeta} hasSequencePanel={!!sequencePanel} />
            {sequencePanel && survivor && mergedPerson && (
              <MergeSequencePanel
                panel={sequencePanel}
                candidateId={detail.id}
                title={dict.mergePanel.titleJoin(survivor.name, mergedPerson.name)}
                survivorName={survivor.name}
              />
            )}
          </div>
        ) : (
          <section className="panel">
            <p className="muted">{dict.emptyQueue}</p>
          </section>
        )}
      </div>

      <h2 className="mt-3xl">
        {dict.historyTitle}
        <span className="dot">.</span>
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{dict.historyContact}</th>
              <th>{dict.historyReason}</th>
              <th>{dict.historyBy}</th>
              <th>{dict.historyWhen}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.mergeEventId}>
                <td>
                  {h.survivorName}
                  {h.undoneAt && <span className="legacy-badge">{dict.historyUndone}</span>}
                </td>
                <td>{reasonLabel(h.reason)}</td>
                <td className="soft">{h.actorName ?? dict.migrationActor}</td>
                <td className="meta">{formatDateTime(h.createdAt, "es")}</td>
                <td>
                  {!h.undoneAt && (
                    <Link href={`/admin/duplicates?confirmUnmerge=${h.mergeEventId}`} className="secondary-btn">
                      {dict.undoButton}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unmergeTarget && (
        <UnmergeConfirmPanel mergeEventId={unmergeTarget.mergeEventId} survivorName={unmergeTarget.survivorName} />
      )}
    </main>
  );
}
