import { Fragment } from "react";
import { getDictionary } from "@/lib/i18n/server";
import { ROLE_GROUPS, type RoleGroupKey } from "@/lib/roleGroups";
import { NOT_WORTH_PRIORITIZING, PRIORITY_BADGE_CLASS, ROLE_GROUP_PLAYBOOK } from "@/lib/roleGroupPlaybook";
import { InfoIcon, ChevronDownIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

/**
 * "Guía de roles" — BD playbook (openspec/changes/bd-playbook, mockups/
 * bd-playbook.html). Static reference manual: which role group to contact
 * per company, what they decide, what pain Avalith solves, and a priority
 * tier. Content lives in src/lib/roleGroupPlaybook.ts (developer-edited,
 * not DB-backed — see that change's README "what building it would
 * touch"). No DB read here: every field is static copy keyed by
 * `RoleGroupKey` (src/lib/roleGroups.ts) — zero extra round trips.
 *
 * Self-contained on purpose (owner decision 2026-09-30, sidebar placement):
 * if the sidebar's reference/setup group (`sidenav-footer`) doesn't grow
 * with more entries later, this whole route moves under /account ("Mi
 * perfil") instead — moving it is just relocating this folder and updating
 * the one Sidebar link (src/app/contacts/Sidebar.tsx).
 *
 * Deviation from the mockup: bd-playbook.html's "Dónde aparece además"
 * section (two static preview snippets of the in-context hints) is not
 * reproduced here — this change builds those two hints for real, on the
 * contact record's Cargo row and the Contactos role-group filter, so a
 * static duplicate on this page would show stale copy next to the live
 * feature. See openspec/changes/mockup-port/bd-playbook-checklist.md.
 */
export default async function PlaybookPage() {
  const dict = await getDictionary();
  const l = dict.bdPlaybook;

  function groupLinks(keys: RoleGroupKey[]) {
    return keys.map((key, i) => (
      <Fragment key={key}>
        {i > 0 && ", "}
        <a href={`#${key}`}>{dict.roleGroups[key]}</a>
      </Fragment>
    ));
  }

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>
            {l.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{l.subtitle}</p>
        </div>
      </div>

      <div className="row wrap mb-lg" style={{ gap: "var(--space-sm)" }} aria-label={l.priorityReferenceAriaLabel}>
        <span className="meta">{l.priorityLabel}</span>
        <span className="badge badge-success">{l.priorityAlta}</span>
        <span className="badge badge-warn">{l.priorityMedia}</span>
        <span className="badge badge-neutral">{l.priorityBaja}</span>
        <span className="badge badge-danger">{l.priorityNoPriorizar}</span>
        <span className="badge badge-outline no-dot">{l.priorityRevisar}</span>
      </div>

      <div className="alert alert-neutral mb-lg">
        <InfoIcon className="icon" />
        <div>
          <div className="title">{l.notWorthTitle}</div>
          <strong>{l.notWorthNoPriorizarLabel}</strong> {groupLinks(NOT_WORTH_PRIORITIZING.noPriorizar.keys)}
          {" — "}
          {NOT_WORTH_PRIORITIZING.noPriorizar.note}
          <br />
          <strong>{l.notWorthLowLabel}</strong> {groupLinks(NOT_WORTH_PRIORITIZING.baja.keys)}.
          <br />
          <strong>{l.notWorthReviewLabel}</strong> {groupLinks(NOT_WORTH_PRIORITIZING.revisar.keys)}
          {" — "}
          {NOT_WORTH_PRIORITIZING.revisar.note}
        </div>
      </div>

      <div className="stack">
        {ROLE_GROUPS.map(({ key }) => {
          const entry = ROLE_GROUP_PLAYBOOK[key];
          return (
            <details key={key} id={key} className="card" open={entry.priority === "alta"}>
              <summary className="card-header">
                <h3>{dict.roleGroups[key]}</h3>
                <span className="meta">{entry.subtitle}</span>
                <span className={PRIORITY_BADGE_CLASS[entry.priority]}>{entry.priorityLabel}</span>
                <ChevronDownIcon className="icon chev" />
              </summary>
              <div className="card-body">
                {entry.decides ? (
                  <dl className="props">
                    <div className="prop">
                      <dt>{l.fieldDecides}</dt>
                      <dd>{entry.decides}</dd>
                    </div>
                    <div className="prop">
                      <dt>{l.fieldPain}</dt>
                      <dd>{entry.painSolved}</dd>
                    </div>
                    <div className="prop">
                      <dt>{l.fieldWrongPerson}</dt>
                      <dd>{entry.wrongPerson}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="meta">{entry.note}</p>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </main>
  );
}
