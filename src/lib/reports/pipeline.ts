/**
 * "Pipeline de empresas" (owner-reporting decision 7): a CURRENT snapshot of
 * `company.relationship_stage`, ignoring the page's period filter — the
 * one flagged exception (decisions intro). Stage order/labels reuse
 * src/lib/companies/listMappers.ts's stageLabelOf/stageBadgeClass (the
 * `/companies` list's own vocabulary), never redefined here.
 */

export const PIPELINE_STAGE_ORDER = ["prospect", "qualified", "proposal_sent", "won", "lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGE_ORDER)[number];

export interface PipelineStageCount {
  stage: string | null;
  count: number;
}

export interface PipelineRow {
  stage: PipelineStage | "unknown";
  count: number;
  pct: number;
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

export function buildPipelineRows(rows: readonly PipelineStageCount[]): PipelineRow[] {
  const countByStage = new Map<string, number>();
  let unknownCount = 0;
  for (const row of rows) {
    if ((PIPELINE_STAGE_ORDER as readonly string[]).includes(row.stage ?? "")) {
      countByStage.set(row.stage!, (countByStage.get(row.stage!) ?? 0) + row.count);
    } else {
      unknownCount += row.count;
    }
  }
  const total = [...countByStage.values()].reduce((a, b) => a + b, 0) + unknownCount;

  const result: PipelineRow[] = PIPELINE_STAGE_ORDER.map((stage) => {
    const count = countByStage.get(stage) ?? 0;
    return { stage, count, pct: pct(count, total) };
  });
  if (unknownCount > 0) result.push({ stage: "unknown", count: unknownCount, pct: pct(unknownCount, total) });
  return result;
}
