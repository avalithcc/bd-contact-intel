/**
 * reports-kpi-drilldown: the cohort drill-down behind "Tasa de respuesta" and
 * the funnel's Contactado/Respondió/Reunión rows. The one rule that matters is
 * that the dialog lists EXACTLY the persons the tile/row counted, so the
 * population → status mapping is pinned against the aggregates SQL itself.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildCohortDrilldownQuery, buildReportAggregatesQuery } from "@/lib/reports/queries";
import {
  COHORT_STATUSES,
  buildCohortDrilldownRows,
  cohortBase,
  cohortCount,
  cohortHasReplyColumns,
  roleGroupCell,
  cohortHasRoleColumn,
  isCohortPopulation,
  type CohortRawRow,
} from "@/lib/reports/cohortDrilldown";
import { DRILLDOWN_ROW_LIMIT, drilldownTruncation, fillTruncationNote } from "@/lib/reports/drilldownLimit";
import { cohortHeaderLines, cohortPeriodPhrase } from "@/lib/reports/cohortHeader";
import { MIN_RATE_SAMPLE, buildFunnelBreakdown } from "@/lib/reports/funnel";
import { es } from "@/lib/i18n/dictionaries/es";

const dialect = new PgDialect();
const FROM = "2026-10-01T03:00:00.000Z";
const TO = "2026-10-14T14:00:00.000Z";
const BD = "00000000-0000-0000-0000-000000000001";

const norm = (s: string) => s.replace(/\$\d+/g, "$?").replace(/\s+/g, " ");

test("COHORT_STATUSES: each population is exactly the status list the funnel counts use in rpt_funnel", () => {
  const { sql } = dialect.sqlToQuery(buildReportAggregatesQuery({ fromIso: FROM, toIso: TO, bdId: null }));
  const list = (statuses: readonly string[]) => statuses.map((s) => `'${s}'`).join(",");
  assert.ok(sql.includes(`rpt_person_scope.status in (${list(COHORT_STATUSES.contacted)})`));
  assert.ok(sql.includes(`rpt_person_scope.status in (${list(COHORT_STATUSES.replied)})`));
  assert.ok(sql.includes(`rpt_person_scope.status = '${COHORT_STATUSES.meeting[0]}'`));
  assert.deepEqual(COHORT_STATUSES.meeting, ["meeting"]);
});

test("cohort query scopes persons with the SAME predicates as rpt_person_scope (merged, period, owner)", () => {
  const agg = norm(dialect.sqlToQuery(buildReportAggregatesQuery({ fromIso: FROM, toIso: TO, bdId: BD })).sql);
  for (const population of ["new", "contacted", "replied", "meeting"] as const) {
    const q = norm(dialect.sqlToQuery(buildCohortDrilldownQuery({ fromIso: FROM, toIso: TO, bdId: BD, population })).sql);
    const scope =
      "person.merged_into_id is null and person.created_at >= $?::timestamptz and person.created_at < $?::timestamptz and ($?::uuid is null or person.owner_bd_id = $?::uuid)";
    assert.ok(agg.includes(scope), "aggregates query lost the shared scope");
    assert.ok(q.includes(scope), `${population} drill-down diverged from the cohort scope`);
  }
});

test("cohort query binds the population's statuses and the shared row cap, never the rate-sample threshold", () => {
  const { sql, params } = dialect.sqlToQuery(buildCohortDrilldownQuery({ fromIso: FROM, toIso: TO, bdId: null, population: "replied" }));
  assert.match(sql, /person\.status in \(\$\d+, \$\d+\)/);
  assert.ok(params.includes("replied") && params.includes("meeting") && !params.includes("contacted"));
  assert.equal(params[params.length - 1], DRILLDOWN_ROW_LIMIT);
  assert.ok(!params.includes(MIN_RATE_SAMPLE));
});

test("reply populations left-join reply time and Sequence so a null replied_at never drops a row; contacted skips both", () => {
  const replied = norm(dialect.sqlToQuery(buildCohortDrilldownQuery({ fromIso: FROM, toIso: TO, bdId: null, population: "meeting" })).sql);
  assert.match(replied, /left join rpt_cohort_reply/);
  assert.match(replied, /left join rpt_cohort_sequence/);
  assert.doesNotMatch(replied, /(?<!left )join rpt_cohort_(reply|sequence)/);
  assert.match(replied, /sequence_member\.replied_at is not null/);
  assert.match(replied, /activity\.type = 'reply_received'/);
  assert.match(replied, /order by rpt_cohort_reply\.pbc_reply_at desc nulls last/);
  const contacted = norm(dialect.sqlToQuery(buildCohortDrilldownQuery({ fromIso: FROM, toIso: TO, bdId: null, population: "contacted" })).sql);
  assert.doesNotMatch(contacted, /rpt_cohort_reply|sequence_member/);
});

test("the count behind each tile/row is the funnel number, independent of the rate-sample display rule", () => {
  const counts = { newTotal: 19, contactedOrMore: 7, repliedOrMore: 3, meeting: 1, discarded: 2 };
  const f = buildFunnelBreakdown(counts);
  assert.equal(f.replyRateIsRate, false); // 7 < MIN_RATE_SAMPLE: tile shows "3 / 7"
  assert.ok(counts.contactedOrMore < MIN_RATE_SAMPLE);
  assert.equal(cohortCount(counts, "contacted"), f.contactedOrMore);
  assert.equal(cohortCount(counts, "replied"), f.repliedOrMore); // still 3, not filtered out
  assert.equal(cohortCount(counts, "meeting"), f.meeting);
  assert.equal(cohortBase(counts, "contacted"), f.newTotal);
  assert.equal(cohortBase(counts, "replied"), f.contactedOrMore);
  assert.equal(cohortBase(counts, "meeting"), f.repliedOrMore);
});

test("population guards", () => {
  assert.equal(isCohortPopulation("replied"), true);
  assert.equal(isCohortPopulation("bogus"), false);
  assert.equal(isCohortPopulation(undefined), false);
  assert.equal(cohortHasReplyColumns("contacted"), false);
  assert.equal(cohortHasReplyColumns("replied"), true);
  assert.equal(cohortHasReplyColumns("meeting"), true);
});

const RAW: CohortRawRow = {
  personId: "p1",
  firstName: "Daniel",
  lastName: "Ortiz",
  companyName: "Nubix Labs",
  ownerBdName: "Cristian Civita",
  status: "replied",
  roleGroup: "c_level_tech",
  createdAt: "2026-10-02 12:00:00+00",
  replyAt: "2026-10-14 13:42:00+00",
  sequenceId: "s1",
  sequenceName: "Florida + US · octubre",
};

test("buildCohortDrilldownRows normalizes timestamps to Date and keeps a missing reply/Sequence as null", () => {
  const [a, b] = buildCohortDrilldownRows([RAW, { ...RAW, personId: "p2", firstName: null, lastName: null, replyAt: null, sequenceId: null, sequenceName: null }]);
  assert.ok(a!.createdAt instanceof Date && a!.replyAt instanceof Date);
  assert.equal(a!.replyAt!.toISOString(), "2026-10-14T13:42:00.000Z");
  assert.equal(a!.personName, "Daniel Ortiz");
  assert.equal(b!.personName, "—");
  assert.equal(b!.replyAt, null);
  assert.equal(b!.sequenceName, null);
});

test("drilldownTruncation flags only a capped list whose true total is larger", () => {
  assert.equal(drilldownTruncation(500, 612)?.total, 612);
  assert.equal(drilldownTruncation(500, 500), null);
  assert.equal(drilldownTruncation(12, 12), null);
  assert.equal(drilldownTruncation(499, 700), null); // fewer rows than the cap: not a cut, a drifted count
});

test("fillTruncationNote formats both numbers with the locale", () => {
  assert.equal(fillTruncationNote("Se muestran los primeros {shown} de {total}.", 500, 1250, "es-AR"), "Se muestran los primeros 500 de 1.250.");
});

const w = es.reports;
const FUNNEL = { newTotal: 118, contactedOrMore: 43, repliedOrMore: 12, meeting: 4, discarded: 6 };

test("cohortPeriodPhrase names the period the way the mockup does", () => {
  assert.equal(cohortPeriodPhrase("month", "2026-10-01", "2026-11-01", w), "en octubre 2026");
  assert.equal(cohortPeriodPhrase("quarter", "2026-10-01", "2027-01-01", w), "en el 4.º trimestre 2026");
  assert.equal(cohortPeriodPhrase("week", "2026-10-12", "2026-10-19", w), "del 12 al 18 oct 2026");
  assert.equal(cohortPeriodPhrase("week", "2026-09-28", "2026-10-05", w), "del 28 sep al 4 oct 2026");
  assert.equal(cohortPeriodPhrase("week", "2025-12-29", "2026-01-05", w), "del 29 dic 2025 al 4 ene 2026");
});

test("cohortHeaderLines states the population in words (mockup copy)", () => {
  const period = "en octubre 2026";
  assert.deepEqual(cohortHeaderLines("replied", FUNNEL, period, w), {
    summary: "12 de 43 contactados · creados en octubre 2026",
    note: "Estado actual de cada contacto, no la actividad del período: «creados en octubre 2026» es la cohorte, no cuándo respondieron.",
  });
  assert.equal(cohortHeaderLines("contacted", FUNNEL, period, w).summary, "43 de 118 contactos nuevos · creados en octubre 2026 · hoy en Contactado, Respondió o Reunión");
  assert.equal(cohortHeaderLines("meeting", FUNNEL, period, w).summary, "4 de 12 que respondieron · creados en octubre 2026 · hoy en Reunión");
  assert.equal(cohortHeaderLines("meeting", FUNNEL, period, w).note, "Estado actual de cada contacto, no la actividad del período.");
});

test("cohortHeaderLines keeps the true total with thousands separators", () => {
  const big = { ...FUNNEL, newTotal: 1250, contactedOrMore: 612 };
  assert.equal(cohortHeaderLines("contacted", big, "en el 4.º trimestre 2026", w).summary.startsWith("612 de 1.250 contactos nuevos"), true);
});

test("new population: whole cohort, no status predicate, same count as the Contactos nuevos tile", () => {
  const agg = norm(dialect.sqlToQuery(buildReportAggregatesQuery({ fromIso: FROM, toIso: TO, bdId: BD })).sql);
  assert.ok(agg.includes("count(*)::int as pbc_new_total"), "tile count must stay a bare count(*) over the cohort scope");
  const { sql, params } = dialect.sqlToQuery(buildCohortDrilldownQuery({ fromIso: FROM, toIso: TO, bdId: null, population: "new" }));
  assert.doesNotMatch(sql, /person\.status in/);
  assert.ok(!params.some((p) => ["contacted", "replied", "meeting", "discarded"].includes(p as string)));
  assert.equal(params[params.length - 1], DRILLDOWN_ROW_LIMIT);
  assert.doesNotMatch(norm(sql), /rpt_cohort_reply|sequence_member/);
  assert.deepEqual(COHORT_STATUSES.new, []);
  assert.equal(isCohortPopulation("new"), true);
  assert.equal(cohortHasReplyColumns("new"), false);
  const f = { newTotal: 118, contactedOrMore: 43, repliedOrMore: 12, meeting: 4, discarded: 6 };
  assert.equal(cohortCount(f, "new"), 118);
  assert.equal(cohortBase(f, "new"), 118);
});

test("cohortHeaderLines states the new-contacts population in words", () => {
  assert.deepEqual(cohortHeaderLines("new", FUNNEL, "en octubre 2026", w), {
    summary: "118 contactos nuevos · creados en octubre 2026 · en cualquier estado",
    note: "Estado actual de cada contacto, no la actividad del período.",
  });
});

test("roleGroupCell: a known group renders its label, NULL renders unclassified, no_position stays a real group", () => {
  const groups = es.roleGroups;
  assert.deepEqual(roleGroupCell("c_level_tech", groups), { kind: "group", label: groups.c_level_tech });
  assert.deepEqual(roleGroupCell("no_position", groups), { kind: "group", label: groups.no_position });
  assert.deepEqual(roleGroupCell(null, groups), { kind: "unclassified" });
  assert.deepEqual(roleGroupCell("not_a_group", groups), { kind: "unclassified" }); // never the raw key
});

test("cohort rows carry role_group (NULL stays NULL) and only the new population shows the column", () => {
  const [a, b] = buildCohortDrilldownRows([RAW, { ...RAW, personId: "p2", roleGroup: null }]);
  assert.equal(a!.roleGroup, "c_level_tech");
  assert.equal(b!.roleGroup, null);
  assert.equal(cohortHasRoleColumn("new"), true);
  for (const p of ["contacted", "replied", "meeting"] as const) assert.equal(cohortHasRoleColumn(p), false);
  const q = norm(dialect.sqlToQuery(buildCohortDrilldownQuery({ fromIso: FROM, toIso: TO, bdId: null, population: "new" })).sql);
  assert.ok(q.includes("person.role_group as pbc_role_group"));
});
