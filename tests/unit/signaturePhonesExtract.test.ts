import assert from "node:assert/strict";
import { test } from "node:test";
import { cutAtQuoteBoundary, extractSenderPhones, phoneKey } from "@/lib/signaturePhones/extract";
import { isValidPhoneFormat } from "@/lib/phone";

// Every fixture below is invented text. The "quoted" signature carries a DIFFERENT number so a leak is visible.
const SENDER = "Cel: +54 9 11 5555-0002";
const OTHER = "Cel: +54 9 11 5555-0001";
const reply = (marker: string[]) => ["Gracias, lo vemos el lunes.", "", "Ana Prueba", SENDER, "", ...marker, "", "Beto Ejemplo", OTHER].join("\n");

const MARKERS: Record<string, { lines: string[]; boundary: string }> = {
  "English wrote header": { lines: ["On Mon, Oct 5, 2026 at 10:00 AM Beto Ejemplo <beto@example.test> wrote:", "> hello"], boundary: "wrote_header" },
  "Spanish escribio header": { lines: ["El lun, 5 oct 2026 a las 10:00, Beto Ejemplo <beto@example.test> escribió:", "> hola"], boundary: "wrote_header" },
  "wrapped wrote header": { lines: ["On Mon, Oct 5, 2026 at 10:00 AM Beto Ejemplo <beto@example.test>", "wrote:"], boundary: "wrote_header" },
  "quoted line": { lines: ["> Beto wrote this", "> more"], boundary: "quoted_line" },
  "Original Message": { lines: ["-----Original Message-----", "Subject: hi"], boundary: "dashed_original" },
  "Mensaje original": { lines: ["-----Mensaje original-----", "Asunto: hola"], boundary: "dashed_original" },
  "Outlook rule": { lines: ["________________________________", "algo"], boundary: "outlook_rule" },
  "From header block": { lines: ["From: Beto Ejemplo <beto@example.test>", "Sent: Monday, October 5, 2026 10:00 AM", "To: Ana", "Subject: hi"], boundary: "header_block" },
  "De header block": { lines: ["De: Beto Ejemplo <beto@example.test>", "Enviado el: lunes, 5 de octubre de 2026 10:00", "Para: Ana", "Asunto: hola"], boundary: "header_block" },
};

for (const [name, { lines, boundary }] of Object.entries(MARKERS)) {
  test(`quote boundary: ${name} keeps only the sender's text`, () => {
    const cut = cutAtQuoteBoundary(reply(lines));
    assert.equal(cut.boundary, boundary);
    assert.ok(cut.text.includes("5555-0002"));
    assert.ok(!cut.text.includes("5555-0001"));
    const result = extractSenderPhones(reply(lines));
    assert.deepEqual(result.phones.map((p) => phoneKey(p.value)), [phoneKey("+54 9 11 5555-0002")]);
  });
}

test("the earliest marker wins even when a later header also exists", () => {
  const body = ["Ok", SENDER, "> quoted", OTHER, "On Mon, Oct 5, 2026, Beto <b@example.test> wrote:", "x"].join("\n");
  assert.ok(!cutAtQuoteBoundary(body).text.includes("0001"));
});

test("a Gmail forward marker is a boundary", () => {
  const body = ["FYI", SENDER, "---------- Forwarded message ---------", OTHER].join("\n");
  assert.equal(cutAtQuoteBoundary(body).boundary, "forwarded");
});

test("a lone 'From:' line without header siblings is not a boundary", () => {
  const body = ["Hola", "From: Buenos Aires", SENDER].join("\n");
  const cut = cutAtQuoteBoundary(body);
  assert.equal(cut.boundary, null);
  assert.ok(cut.text.includes("5555-0002"));
});

test("no boundary: whole body is kept and reported as null", () => {
  const result = extractSenderPhones(["Hola", "Ana", SENDER].join("\n"));
  assert.equal(result.boundary, null);
  assert.equal(result.phones.length, 1);
});

test("CUIT in a footer is rejected, dashed or bare or labelled", () => {
  const body = ["Razón social SA", "CUIT 30-71234567-8", "CUIL: 20123456789", "Cel: 20-12345678-9"].join("\n");
  const result = extractSenderPhones(body);
  assert.deepEqual(result.phones, []);
  assert.equal(result.rejected.cuit, 3);
});

test("a number inside a URL is rejected", () => {
  const result = extractSenderPhones("Mirá https://example.test/catalogo/1155550123 y www.example.test/x/1155550124");
  assert.deepEqual(result.phones, []);
  assert.equal(result.rejected.url, 2);
});

test("a number inside an email address is rejected", () => {
  const result = extractSenderPhones("Cel: ana.1155550123@example.test");
  assert.deepEqual(result.phones, []);
  assert.equal(result.rejected.email, 1);
});

test("an extension is dropped and flagged", () => {
  const a = extractSenderPhones("Tel: 011 4123-4567 int. 245");
  assert.equal(a.phones[0]?.value, "011 4123-4567");
  assert.equal(a.phones[0]?.extensionDropped, true);
  const b = extractSenderPhones("Teléfono: 011 4123-4567 ext 12");
  assert.equal(b.phones[0]?.value, "011 4123-4567");
});

test("dots become spaces so the stored value passes phone.ts", () => {
  const p = extractSenderPhones("Cel: 11.5555.0002").phones[0]!;
  assert.equal(p.value, "11 5555 0002");
  assert.ok(isValidPhoneFormat(p.value));
});

test("labels decide the column kind", () => {
  assert.equal(extractSenderPhones("Móvil: 11 5555 0002").phones[0]?.kind, "mobile");
  assert.equal(extractSenderPhones("WhatsApp 11 5555 0002").phones[0]?.kind, "mobile");
  assert.equal(extractSenderPhones("Tel: 4123 4567").phones[0]?.kind, "generic");
  assert.equal(extractSenderPhones("Tel fijo: 4123 4567").phones[0]?.kind, "landline");
  assert.equal(extractSenderPhones("Landline 4123 4567").phones[0]?.kind, "landline");
  assert.equal(extractSenderPhones("Ana\n+54 11 4123 4567").phones[0]?.kind, "generic");
  // The kind comes from the label, never from the shape of the number.
  assert.equal(extractSenderPhones("Tel: +54 9 11 5555 0002").phones[0]?.kind, "generic");
});

test("an international number is accepted without a label", () => {
  assert.equal(extractSenderPhones("Ana\n+54 9 11 5555-0002").phones.length, 1);
});

test("non-phones: dates, times, postal codes, references, fax, unlabeled, short", () => {
  const body = [
    "Fecha 05/10/2026 y 2026-10-05",
    "Reunión 10:30 hs",
    "CP 1425 / C.P.: 1425",
    "Factura Nº 00012345678",
    "Pedido: 4412 5566",
    "Fax: 011 4123-9999",
    "11 5555 0003",
    "Tel: 123",
  ].join("\n");
  const r = extractSenderPhones(body);
  assert.deepEqual(r.phones, []);
  assert.ok((r.rejected.date ?? 0) >= 2);
  assert.ok((r.rejected.postal ?? 0) >= 2);
  assert.equal(r.rejected.reference, 2);
  assert.equal(r.rejected.fax, 1);
  assert.equal(r.rejected.unlabeled, 1);
  assert.ok((r.rejected.too_short ?? 0) >= 1);
});

test("the same number in two formats is deduplicated within a message", () => {
  const r = extractSenderPhones("Cel: 11 5555-0002\nWhatsApp: 11-5555-0002");
  assert.equal(r.phones.length, 1);
});

test("empty body yields nothing", () => {
  assert.deepEqual(extractSenderPhones("").phones, []);
});
