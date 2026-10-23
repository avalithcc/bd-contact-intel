/** The reviewed flag on a sequence card (mockup marca-de-revisado.html): warn "Sin revisar" / success "Revisado", drafts only. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";
import type { DetailMember } from "@/lib/sequences/detailQueries";
import { IDLE_LOCK, SEND } from "./sendContextFixture";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MemberCard, showsReviewFlag } = require("@/app/(app)/sequences/_components/MemberCard") as typeof import("@/app/(app)/sequences/_components/MemberCard");

const NOW = new Date("2026-10-23T17:00:00Z");
const AT = new Date("2026-10-23T16:41:00Z"); // 19 minutes before NOW
const member = (state: DetailMember["state"], reviewedAt: Date | null, extra: Partial<DetailMember> = {}): DetailMember => ({
  memberId: "m1", personId: "p1", state, holdReason: null, firstName: "Nicolas", lastName: "Peralta", jobTitle: "Head of Digital", company: "Banco", companyKey: null,
  email: "n@x.com", emailVerified: true, openIt: 0, florida: false, leadership: false, lastContactAt: null, repliedAt: null, sentAt: null, reminderDueAt: null,
  discardedAt: null, discardReason: null, reminderDraft: null,
  draft: { subject: "s", body: "b", edited: false, editedAt: null, reviewedAt, approvedAt: state === "approved" ? AT : null, scheduledFor: null },
  ...extra,
});
const render = (m: DetailMember, ownView = true) => renderToStaticMarkup(createElement(MemberCard, { member: m, now: NOW, labels: es.sequences, onAction: () => {}, ownView, generation: IDLE_LOCK, send: SEND }));

test("an unreviewed draft carries the amber 'Sin revisar' badge and no reviewed part", () => {
  const html = render(member("drafted", null));
  assert.ok(html.includes('<span class="badge badge-warn">Sin revisar</span>'));
  assert.ok(!html.includes("Revisado") && !html.includes("revisado por"));
});

test("a reviewed draft carries the green 'Revisado' badge and says who, in the owner's view", () => {
  const html = render(member("drafted", AT));
  assert.ok(html.includes('<span class="badge badge-success">Revisado</span>'));
  assert.ok(!html.includes("Sin revisar"));
  assert.ok(html.includes("<strong>revisado por vos hace 19 min</strong>"), html);
});

test("an admin reading another BD's sequence is not told 'por vos'", () => {
  const html = render(member("drafted", AT), false);
  assert.ok(html.includes("<strong>revisado hace 19 min</strong>") && !html.includes("revisado por vos"), html);
});

test("the badge sits beside the state badge, in the same row", () => {
  assert.match(render(member("drafted", null)), /badge-info">Borrador listo<\/span><span class="badge badge-warn">Sin revisar<\/span>/);
});

/**
 * The negative cases above are three states; the union has nine. This one reads the CardKind union OUT OF THE SOURCE
 * instead of hardcoding it, so widening `showsReviewFlag` to any existing kind fails here, AND a tenth kind added to
 * the union arrives in this list on its own rather than slipping past a stale literal.
 */
test("of every CardKind in the union, only \"draft\" carries the flag", () => {
  const src = readFileSync(join("src", "lib", "sequences", "memberCard.ts"), "utf8");
  const union = /export type CardKind =([^;]+);/.exec(src)?.[1];
  assert.ok(union, "could not find the CardKind union in memberCard.ts");
  const kinds = [...union.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 9, `expected the whole union, parsed ${kinds.length}: ${kinds.join(",")}`);
  const flagged = kinds.filter((k) => showsReviewFlag(k as Parameters<typeof showsReviewFlag>[0]));
  assert.deepEqual(flagged, ["draft"], `only a draft may carry the review flag; got ${flagged.join(",")}`);
});

test("approved, sent and drafted-without-a-draft cards show no review flag", () => {
  for (const m of [member("approved", AT), member("sent", AT), member("drafted", null, { draft: null })]) {
    const html = render(m);
    assert.ok(!html.includes("Sin revisar") && !html.includes("Revisado") && !html.includes("revisado"), m.state);
  }
});
