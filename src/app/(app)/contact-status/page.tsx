import { Fragment } from "react";
import { getDictionary } from "@/lib/i18n/server";
import { statusBadgeClass } from "@/lib/contacts/statusBadge";
import { stageBadgeClass, stageLabelOf } from "@/lib/companies/listMappers";
import {
  ACTIVITY_STAGE_ROWS,
  PIPELINE_STAGE_ORDER,
  PIPELINE_STAGE_REASON,
  STATUS_STAGE_ORDER,
} from "@/lib/statusGuide/content";
import { ChevronRightIcon, InfoIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

/**
 * "Estados de contacto" — status/pipeline guide (openspec/changes/
 * contact-status-guide, mockups/contact-status.html). Sibling to /playbook:
 * a static reference explaining how `src/lib/status/deriveStatus.ts` derives
 * a contact's status and how `src/lib/reports/pipeline.ts`'s company stages
 * work, without exposing code. Content lives in `src/lib/statusGuide/
 * content.ts` (developer-edited, Spanish-only per D10 — same convention as
 * `src/lib/roleGroupPlaybook.ts`) plus `dict.contactStatusGuide` for this
 * page's own narrative copy; the four contact-status badges and the five
 * company-stage badges reuse `statusBadgeClass`/`leadStatuses` and
 * `stageBadgeClass`/`stageLabelOf`/`companyList` respectively, so this page
 * can never show a label or color the rest of the app doesn't also show.
 * No DB read — every fact here was checked against the two files above
 * (see that change's README.md "Accuracy"), not queried live.
 */
export default async function ContactStatusGuidePage() {
  const dict = await getDictionary();
  const l = dict.contactStatusGuide;

  return (
    <main className="page">
      <div className="page-header">
        <div className="titles">
          <div className="eyebrow">{l.eyebrow}</div>
          <h1>
            {l.title}
            <span className="dot">.</span>
          </h1>
          <p className="meta">{l.lead}</p>
        </div>
      </div>

      <div className="row wrap mb-lg" style={{ gap: "var(--space-sm)" }} aria-label={l.stagesAriaLabel}>
        <span className="meta">{l.stagesIntroLabel}</span>
        {STATUS_STAGE_ORDER.map((stage, i) => (
          <Fragment key={stage}>
            {i > 0 && <ChevronRightIcon className="icon" />}
            <span className={statusBadgeClass(stage)}>{dict.leadStatuses[stage]}</span>
          </Fragment>
        ))}
        <span className="meta">{l.stagesIntroSuffix}</span>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-header">
            <h3>{l.sectionTriggersTitle}</h3>
          </div>
          <div className="card-body">
            <p className="meta mb-lg">{l.sectionTriggersIntro}</p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{l.tableActivityHeader}</th>
                    <th>{l.tableResultHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  {ACTIVITY_STAGE_ROWS.map((row) => (
                    <tr key={row.activity}>
                      <td>{row.activity}</td>
                      <td>
                        <span className={statusBadgeClass(row.stage)}>{dict.leadStatuses[row.stage]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="meta mt-lg">
              <strong>{l.noteRuleLabel}</strong> {l.noteRuleBody}
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>{l.sectionRulesTitle}</h3>
          </div>
          <div className="card-body">
            <p className="meta mb-md">
              <strong>{l.ruleNoDowngradeLabel}</strong> {l.ruleNoDowngradeBody}
            </p>
            <p className="meta mb-md">
              <strong>{l.ruleDiscardNotForeverLabel}</strong> {l.ruleDiscardNotForeverBody}
            </p>
            <p className="meta mb-0">
              {l.teamActivityPrefix} <strong>{l.teamActivityStrong}</strong>
              {l.teamActivitySuffix}
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>{l.sectionAfterMeetingTitle}</h3>
          </div>
          <div className="card-body">
            <p className="meta mb-md">
              <strong>{l.ceilingLabel}</strong> {l.ceilingBody}
            </p>
            <p className="meta mb-lg">
              <strong>{l.companyStageLabel}</strong> {l.companyStageBody}
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{l.tableCompanyStageHeader}</th>
                    <th>{l.tableWhenToMoveHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  {PIPELINE_STAGE_ORDER.map((stage) => (
                    <tr key={stage}>
                      <td>
                        <span className={stageBadgeClass(stage)}>{stageLabelOf(stage, dict.companyList)}</span>
                      </td>
                      <td>{PIPELINE_STAGE_REASON[stage]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="meta mt-lg mb-md">
              <strong>{l.manualLabel}</strong> {l.manualBody}
            </p>
            <p className="meta mb-md">{l.stageChangeLoggedNote}</p>
            <p className="meta mb-0">
              <strong>{l.whySeparateLabel}</strong> {l.whySeparateBody}
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>{l.sectionPracticeTitle}</h3>
          </div>
          <div className="card-body">
            <p className="meta mb-md">
              <strong>{l.noRecordLabel}</strong> {l.noRecordBody}
            </p>
            <p className="meta mb-0">
              {l.practicalWhyPrefix} <strong>{l.practicalWhyStrong}</strong> {l.practicalWhySuffix}
            </p>
          </div>
        </div>

        <div className="alert alert-neutral">
          <InfoIcon className="icon" />
          <div>{l.closingStatement}</div>
        </div>
      </div>
    </main>
  );
}
