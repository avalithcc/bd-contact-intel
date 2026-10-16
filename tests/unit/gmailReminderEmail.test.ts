import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOwnerNoticeEmail, buildReminderEmail, greetingName } from "@/lib/gmail/reminderEmail";

const SITE = "https://bd-contact-intel.vercel.app";

test("the reminder matches the approved mockup: subject, key copy and one link to the Gmail connect page", () => {
  const e = buildReminderEmail({ name: "Joaquín Rivas" }, SITE);
  assert.equal(e.subject, "Es clave que conectes tu Gmail al CRM");
  for (const part of [
    "Hola Joaquín,",
    "no está conectado",
    "Es clave que lo conectes",
    "no entran al CRM",
    "Secuencias están pausadas",
    "Conectar mi Gmail",
    "Cualquier problema, escribile a Cristian.",
    "Recibís este aviso porque tu Gmail está sin conectar",
  ]) {
    assert.ok(e.html.includes(part), `html: ${part}`);
  }
  assert.equal(e.html.match(/href="/g)?.length, 1, "a single link");
  assert.ok(e.html.includes(`href="${SITE}/account/email"`));
  assert.ok(e.text.includes(`${SITE}/account/email`));
  assert.ok(e.text.includes("Hola Joaquín,"));
  assert.ok(!/<[a-z]/i.test(e.text), "plain text carries no markup");
});

test("greeting uses the first name only when it is a real name", () => {
  assert.equal(greetingName("Joaquín Rivas"), "Joaquín");
  assert.equal(greetingName("  María   José "), "María");
  assert.equal(greetingName("joaquin.rivas"), null, "an email local part auto-provisioned as the name");
  assert.equal(greetingName(""), null);
  assert.equal(buildReminderEmail({ name: "joaquin.rivas" }, SITE).text.startsWith("Hola,\n"), true);
});

test("names and urls are escaped in html", () => {
  const e = buildReminderEmail({ name: "<b>Eve" }, `${SITE}"x`);
  assert.ok(!e.html.includes("<b>Eve"));
  assert.ok(!e.html.includes(`${SITE}"x`));
});

test("the owner notice names the BD and says three reminders went unanswered", () => {
  const e = buildOwnerNoticeEmail({ name: "Joaquín Rivas", email: "joaquin@avalith.net" });
  assert.equal(e.subject, "Joaquín Rivas sigue sin conectar Gmail");
  assert.ok(e.text.includes("joaquin@avalith.net"));
  assert.ok(e.text.includes("3 recordatorios"));
  assert.ok(e.html.includes("Joaquín Rivas"));
  const hostile = buildOwnerNoticeEmail({ name: "<script>", email: "a@b.c" });
  assert.ok(!hostile.html.includes("<script>"));
});
