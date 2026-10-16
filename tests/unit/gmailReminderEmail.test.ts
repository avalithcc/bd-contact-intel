import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOwnerNoticeEmail, buildReminderEmail, greetingName } from "@/lib/gmail/reminderEmail";

const SITE = "https://bd-contact-intel.vercel.app";

test("the reminder matches the approved mockup: subject, headline, copy, steps and one link target", () => {
  const e = buildReminderEmail({ name: "Joaquín Rivas" }, SITE, true);
  assert.equal(e.subject, "Es clave que conectes tu Gmail al CRM");
  for (const part of [
    "Hola Joaquín,",
    "Conectá tu Gmail al CRM",
    "Tu Gmail todavía no está conectado",
    "no entran al CRM",
    "Secuencias están pausadas",
    "Son dos minutos",
    "Elegí tu cuenta de Google",
    "Conectar mi Gmail",
    "¿Algún problema para conectarlo? Respondé a este correo y te ayudamos.",
    "Recibís este aviso porque tu Gmail está sin conectar",
    "tu respuesta llega a la administración",
    "Mientras esté desconectado, tus correos no entran al CRM",
  ]) {
    assert.ok(e.html.includes(part), `html: ${part}`);
  }
  const hrefs = [...e.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 2 && hrefs.every((h) => h === `${SITE}/account/email`), "button, VML and fallback all point to the connect page");
  assert.ok(e.text.includes(`Conectar mi Gmail: ${SITE}/account/email`));
  assert.ok(e.text.startsWith("Hola Joaquín,\n"));
  assert.ok(e.text.includes("3. Listo."));
  assert.ok(e.text.includes("Recibís este aviso porque tu Gmail está sin conectar"));
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
  for (const part of ["Un BD sigue sin conectar Gmail", "Enviamos ", "joaquin@avalith.net", "3 de 3", "Sin conectar", "Qué sigue", "sos administrador de Avalith CRM", "no recibe respuestas"]) {
    assert.ok(e.html.replace(/<\/?strong>/g, "").includes(part.replace("<strong>", "")), `html: ${part}`);
  }
  assert.ok(!e.html.includes("<a "), "no button: there is no screen to link to");
  assert.ok(e.text.includes("Estado de Gmail: sin conectar"));
  const hostile = buildOwnerNoticeEmail({ name: "<script>", email: "a@b.c" });
  assert.ok(!hostile.html.includes("<script>"));
});

test("the reply invitation and footer promise appear only when a Reply-To exists", () => {
  const yes = buildReminderEmail({ name: "Ana" }, SITE, true);
  const no = buildReminderEmail({ name: "Ana" }, SITE, false);
  for (const part of ["Respondé a este correo", "tu respuesta llega a la administración"]) {
    assert.ok(yes.html.includes(part) && yes.text.includes(part), part);
    assert.ok(!no.html.includes(part) && !no.text.includes(part), `absent: ${part}`);
  }
  assert.ok(no.html.includes("no recibe respuestas") && no.text.includes("no recibe respuestas"));
});
