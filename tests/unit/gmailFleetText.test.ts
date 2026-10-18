import assert from "node:assert/strict";
import { test } from "node:test";
import { es } from "@/lib/i18n/dictionaries/es";
import { bounceCell, failedCell, fleetAlerts, lastEmailCell, reminderCell, syncCell } from "@/lib/gmail/fleetText";
import { buildFleetRow, type FleetAccount, type FleetRaw } from "@/lib/gmail/fleetView";

const d = es.gmailFleet;
// 10:44 ART on Friday 16 Oct 2026.
const NOW = new Date("2026-10-16T13:44:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const account = (over: Partial<FleetAccount> = {}): FleetAccount => ({
  status: "connected",
  grantedScopes: "https://www.googleapis.com/auth/gmail.readonly",
  syncError: null,
  lastSyncedAt: minutesAgo(2),
  connectedAt: daysAgo(30),
  hasCursor: true,
  backfilling: false,
  ...over,
});
const row = (over: Partial<FleetRaw> = {}) =>
  buildFleetRow(
    { bdId: "1", name: "Ana Belén Soria", email: "a@x.example", role: "bd", remindersEnabled: true, createdAt: daysAgo(90), lastSeenAt: daysAgo(5), account: account(), sentReminders: [], lastEmail: null, bouncesHard: 0, bouncesSoft: 0, failedSends: 0, lastFailedError: null, ...over },
    NOW,
  );

test("healthy sync shows the date, the long 'ago' and the cursor state", () => {
  const c = syncCell(row(), d, NOW, "es");
  assert.equal(c.when, "hoy 10:42");
  assert.equal(c.ago, "hace 2 minutos");
  assert.equal(c.chip, null);
  assert.deepEqual(c.lines, [{ text: "Cursor al día" }]);
});

test("a running initial import and a missing cursor are told apart", () => {
  assert.deepEqual(syncCell(row({ account: account({ backfilling: true }) }), d, NOW, "es").lines, [{ text: "Importación inicial en curso" }]);
  assert.deepEqual(syncCell(row({ account: account({ hasCursor: false }) }), d, NOW, "es").lines, [{ text: "Sin cursor todavía" }]);
});

test("a missing read scope names the scope in mono and uses the 'last success' suffix", () => {
  const c = syncCell(row({ account: account({ grantedScopes: "x", lastSyncedAt: daysAgo(11) }) }), d, NOW, "es");
  assert.equal(c.ago, "hace 11 días · último éxito");
  assert.deepEqual(c.lines, [{ text: "Falta el permiso de lectura", mono: "gmail.readonly" }]);
});

test("an unclassified failure shows the chip, the truncated error and that reconnecting does not help", () => {
  const long = `Gmail API returned 503 ${"x".repeat(100)}`;
  const c = syncCell(row({ account: account({ syncError: long, lastSyncedAt: minutesAgo(151) }) }), d, NOW, "es");
  assert.equal(c.chip, "failing");
  assert.equal(c.ago, "hace 2 h 31 min · último éxito");
  assert.match(c.lines[0]!.text, /^Error de Gmail \(otro\): «Gmail API returned 503 x+….*»$/);
  assert.ok(c.lines[0]!.text.length < 100);
  assert.equal(c.lines[1]!.text, "Reconectar no lo arregla");
});

test("a configuration failure shows the raw error and who fixes it, with no chip in the sync column", () => {
  const c = syncCell(row({ account: account({ syncError: "Gmail OAuth is misconfigured", lastSyncedAt: minutesAgo(1000) }) }), d, NOW, "es");
  assert.equal(c.chip, null);
  assert.deepEqual(c.lines.map((l) => l.text), ["Gmail OAuth is misconfigured", "Lo corrige un administrador, no el BD"]);
});

test("stale shows only the chip; a BD with no account says so", () => {
  assert.equal(syncCell(row({ account: account({ lastSyncedAt: minutesAgo(90) }) }), d, NOW, "es").chip, "stale");
  const none = syncCell(row({ account: null }), d, NOW, "es");
  assert.equal(none.when, "Nunca");
  assert.deepEqual(none.lines, [{ text: "Sin cuenta de Gmail asociada" }]);
});

test("last email: date, ago and direction; none says so", () => {
  const c = lastEmailCell(row({ lastEmail: { at: minutesAgo(13), direction: "inbound" } }), d, NOW);
  assert.deepEqual(c, { when: "hoy 10:31", detail: "hace 13 min · recibido" });
  assert.equal(lastEmailCell(row({ lastEmail: { at: minutesAgo(46), direction: "outbound" } }), d, NOW)?.detail, "hace 46 min · enviado");
  assert.equal(lastEmailCell(row(), d, NOW), null);
});

test("bounces: total plus a soft-then-hard breakdown, a bare word for a single one, 'Sin datos' when the sync is not running", () => {
  assert.deepEqual(bounceCell(row({ bouncesHard: 1, bouncesSoft: 2 }), d), { kind: "count", total: 3, breakdown: "2 blandos · 1 duro" });
  assert.deepEqual(bounceCell(row({ bouncesSoft: 1 }), d), { kind: "count", total: 1, breakdown: "blando" });
  assert.deepEqual(bounceCell(row({ bouncesHard: 1 }), d), { kind: "count", total: 1, breakdown: "duro" });
  assert.deepEqual(bounceCell(row(), d), { kind: "count", total: 0, breakdown: null });
  assert.deepEqual(bounceCell(row({ account: null }), d), { kind: "nodata" });
  assert.deepEqual(bounceCell(row({ account: account({ grantedScopes: "x" }) }), d), { kind: "nodata" });
  assert.equal(bounceCell(row({ account: account({ grantedScopes: "x" }), bouncesHard: 2 }), d).kind, "count", "recorded bounces are real data even when the sync stopped");
});

test("failed sends: count with the last error code, zero, or no data without an account", () => {
  assert.deepEqual(failedCell(row({ failedSends: 2, lastFailedError: "gmail_send_failed" }), d), { kind: "failed", count: 2, code: "gmail_send_failed" });
  assert.deepEqual(failedCell(row(), d), { kind: "zero" });
  assert.deepEqual(failedCell(row({ account: null }), d), { kind: "nodata" });
  assert.deepEqual(failedCell(row({ account: account({ grantedScopes: "x" }) }), d), { kind: "zero" });
});

test("reminder cell: notes for BDs that get none", () => {
  assert.deepEqual(reminderCell(row({ role: "admin" }), d, NOW), { kind: "note", text: "No aplica · administrador" });
  assert.deepEqual(reminderCell(row(), d, NOW), { kind: "note", text: "No hace falta · Gmail sano" });
  assert.deepEqual(reminderCell(row({ account: account({ syncError: "Gmail API returned 503", lastSyncedAt: minutesAgo(151) }) }), d, NOW), { kind: "note", text: "No hace falta · la autorización está bien" });
  assert.deepEqual(reminderCell(row({ account: account({ syncError: "Gmail OAuth is misconfigured", lastSyncedAt: minutesAgo(900) }) }), d, NOW), { kind: "note", text: "No corresponde: reconectar no ayuda" });
});

test("reminder cell: the series with the last sent day and the next one (mockup screen 2)", () => {
  const r = row({
    account: account({ grantedScopes: "x" }),
    lastSeenAt: new Date("2026-10-07T15:00:00Z"),
    sentReminders: [new Date("2026-10-16T12:00:00Z")],
  });
  assert.deepEqual(reminderCell(r, d, NOW), { kind: "series", count: "1 de 3", word: "enviado", lines: ["Último: 16 oct", "Próximo: 21 oct (3 días hábiles)"] });
});

test("reminder cell: nothing sent yet for a BD that never connected (mockup screen 3)", () => {
  const r = row({ account: null, createdAt: new Date("2026-10-15T15:00:00Z"), lastSeenAt: null });
  assert.deepEqual(reminderCell(r, d, NOW), { kind: "series", count: "0 de 3", word: "enviados", lines: ["Alta el 15 oct", "Primero: 19 oct (2 días hábiles)"] });
});

test("reminder cell: due and complete series", () => {
  const due = reminderCell(row({ account: null, lastSeenAt: daysAgo(10) }), d, NOW);
  assert.equal(due.kind === "series" && due.lines.at(-1), "Primero: en la próxima corrida");
  const sent = [daysAgo(8), daysAgo(5), daysAgo(2)];
  const done = reminderCell(row({ account: null, lastSeenAt: daysAgo(12), sentReminders: sent }), d, NOW);
  assert.equal(done.kind === "series" && done.lines.at(-1), "Serie completa");
});

test("alerts: one danger per BD that must reconnect, one warn per sync failure, none for config or never", () => {
  const rows = [
    row({ bdId: "a", name: "Ana", account: account({ grantedScopes: "x", lastSyncedAt: daysAgo(11) }), lastSeenAt: new Date("2026-10-07T15:00:00Z"), sentReminders: [new Date("2026-10-16T12:00:00Z")] }),
    row({ bdId: "t", name: "Tomás", account: account({ syncError: "Gmail API returned 503", lastSyncedAt: minutesAgo(151) }) }),
    row({ bdId: "s", name: "Sara", account: account({ lastSyncedAt: minutesAgo(90) }) }),
    row({ bdId: "g", name: "Gonzalo", account: account({ syncError: "Gmail OAuth is misconfigured", lastSyncedAt: minutesAgo(900) }) }),
    row({ bdId: "p", name: "Paula", account: null }),
    row({ bdId: "ok", name: "Ok" }),
  ];
  const alerts = fleetAlerts(rows, d, NOW, "es");
  assert.deepEqual(alerts.map((a) => [a.tone, a.title]), [
    ["danger", "Ana · Reconectar"],
    ["warn", "Tomás · Falla al sincronizar"],
    ["warn", "Sara · Sin éxito reciente"],
  ]);
  assert.equal(alerts[0]!.body, "Su Gmail no sincroniza desde hace 11 días. Se le enviaron 1 de 3 recordatorios. Al tercero el sistema ya avisa al dueño por correo.");
});

test("alert for an admin who must reconnect leaves out the reminder sentences", () => {
  const alerts = fleetAlerts([row({ role: "admin", account: account({ grantedScopes: "x", lastSyncedAt: daysAgo(11) }) })], d, NOW, "es");
  assert.equal(alerts[0]!.body, "Su Gmail no sincroniza desde hace 11 días.");
});
