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
import { es } from "@/lib/i18n/dictionaries/es";
import { formatDateTime } from "@/lib/i18n/format";
import { mergeDuplicateCandidateAction, markNotDuplicateAction, unmergeDuplicateAction } from "./actions";

export const dynamic = "force-dynamic";

// Spanish-only regardless of `locale`, same rationale as /admin/migration
// (design D10, R11 — the `en` half only exists to satisfy `Dictionary`).
const dict = es.duplicates;

function isActionErrorReason(v: string | undefined): v is keyof typeof dict.actionErrors {
  return !!v && v in dict.actionErrors;
}

function reasonLabel(reason: string): string {
  return dict.reasonLabels[reason] ?? reason;
}

function fieldRow(label: string, valueA: string, valueB: string, keepA: boolean, keepB: boolean) {
  const differs = valueA !== valueB;
  return (
    <tr key={label}>
      <th scope="row">{label}</th>
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

function ComparePanel({ detail, pairMeta }: { detail: DuplicateCandidateDetail; pairMeta: string }) {
  const survivorLabel = detail.recommendedSurvivor === "a" ? "A" : "B";
  const update = detail.preview.survivorUpdate;
  const survivor = detail.recommendedSurvivor === "a" ? detail.personA : detail.personB;

  return (
    <section className="panel">
      <div className="row between">
        <span className="badge warn">{reasonLabel(detail.reason)}</span>
        <span className="soft">{pairMeta}</span>
      </div>

      <p className="soft mt-md">{dict.recommendationNote(survivorLabel)}</p>

      <div className="table-wrap mt-md">
        <table className="duplicates-compare">
          <thead>
            <tr>
              <th></th>
              <th>Ficha A · {detail.personA.name}</th>
              <th>Ficha B · {detail.personB.name}</th>
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

      <div className="row end mt-lg">
        <form action={markNotDuplicateAction}>
          <input type="hidden" name="candidateId" value={detail.id} />
          <button type="submit" className="secondary">
            {dict.notDuplicateButton}
          </button>
        </form>
        <form action={mergeDuplicateCandidateAction}>
          <input type="hidden" name="candidateId" value={detail.id} />
          <button type="submit">{dict.mergeButton(survivorLabel)}</button>
        </form>
      </div>
    </section>
  );
}

export default async function DuplicatesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ candidate?: string; page?: string; actionError?: string }>;
}) {
  try {
    await requireAdmin();
  } catch (err) {
    // Admin screens 404 for non-admins (design.md "Routes"), same as
    // /admin/migration — existence is not meant to be discoverable.
    if (err instanceof AdminRequiredError) notFound();
    throw err;
  }

  const { candidate: candidateParam, page: pageParam, actionError } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [list, history] = await Promise.all([listOpenDuplicateCandidates(page), listRecentMergeEvents()]);
  const selectedId = candidateParam ?? list.items[0]?.id ?? null;
  const detail = selectedId ? await getDuplicateCandidateDetail(selectedId) : null;
  const selectedIndex = detail ? list.items.findIndex((i) => i.id === detail.id) : -1;
  const pairMeta = detail && selectedIndex >= 0 ? dict.pairMeta(list.startIndex + selectedIndex + 1, list.total) : "";

  return (
    <main>
      <div className="eyebrow">{dict.eyebrow}</div>
      <div className="row between">
        <h1 className="m-0">
          {dict.title}
          <span className="dot">.</span>
        </h1>
        <span className="badge">{dict.adminOnlyBadge}</span>
      </div>
      <p className="soft">{dict.subtitle(list.total)}</p>

      {isActionErrorReason(actionError) && (
        <section className="panel">
          <strong>{dict.actionErrors[actionError]}</strong>
        </section>
      )}

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
              </div>
            </Link>
          ))}
          {list.pageCount > 1 && (
            <div className="row between mt-md">
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
          <ComparePanel detail={detail} pairMeta={pairMeta} />
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
                  {h.undoneAt && <span className="badge">{dict.historyUndone}</span>}
                </td>
                <td>{reasonLabel(h.reason)}</td>
                <td className="soft">{h.actorName ?? dict.migrationActor}</td>
                <td className="meta">{formatDateTime(h.createdAt, "es")}</td>
                <td>
                  {!h.undoneAt && (
                    <form action={unmergeDuplicateAction}>
                      <input type="hidden" name="mergeEventId" value={h.mergeEventId} />
                      <button type="submit" className="secondary">
                        {dict.undoButton}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
