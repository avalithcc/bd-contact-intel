import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  checkAttachmentMeta,
  checkAttachmentSet,
  formatAttachmentSize,
  sanitizeDisplayFilename,
  storageSafeName,
} from "@/lib/email/attachments/policy";
import { matchesMagic } from "@/lib/email/attachments/magic";

const MB = 1024 * 1024;

test("limits are the owner's: 5 files, 6 MB each, 10 MB total", () => {
  assert.equal(MAX_ATTACHMENTS, 5);
  assert.equal(MAX_ATTACHMENT_BYTES, 6 * MB);
  assert.equal(MAX_TOTAL_ATTACHMENT_BYTES, 10 * MB);
});

test("every allowlisted extension passes with its usual declared type", () => {
  const cases: [string, string][] = [
    ["a.pdf", "application/pdf"],
    ["a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["a.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["a.doc", "application/msword"],
    ["a.xls", "application/vnd.ms-excel"],
    ["a.ppt", "application/vnd.ms-powerpoint"],
    ["a.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.JPEG", "image/jpeg"],
    ["a.txt", "text/plain"],
    ["a.csv", "text/csv"],
    ["a.csv", "application/vnd.ms-excel"],
  ];
  for (const [filename, contentType] of cases) {
    const r = checkAttachmentMeta({ filename, contentType, size: 100 });
    assert.equal(r.ok, true, filename);
  }
});

test("an empty declared type is accepted (the browser could not tell); the extension decides", () => {
  assert.equal(checkAttachmentMeta({ filename: "a.pdf", contentType: "", size: 1 }).ok, true);
});

test("blocked: executables, archives, html, svg, no extension, double-extension tricks", () => {
  for (const filename of ["a.exe", "a.bat", "a.js", "a.zip", "a.html", "a.svg", "a.jar", "a.ps1", "noext", "a.pdf.exe", "a.", ".pdf"]) {
    const r = checkAttachmentMeta({ filename, contentType: "application/octet-stream", size: 10 });
    assert.deepEqual(r, { ok: false, reason: "type_not_allowed" }, filename);
  }
});

test("a declared type that contradicts the extension is refused", () => {
  assert.deepEqual(checkAttachmentMeta({ filename: "a.pdf", contentType: "text/html", size: 10 }), { ok: false, reason: "type_not_allowed" });
  assert.deepEqual(checkAttachmentMeta({ filename: "a.png", contentType: "application/x-msdownload", size: 10 }), { ok: false, reason: "type_not_allowed" });
});

test("size: empty and over 6 MB are refused; exactly 6 MB passes", () => {
  assert.deepEqual(checkAttachmentMeta({ filename: "a.pdf", contentType: "application/pdf", size: 0 }), { ok: false, reason: "empty" });
  assert.deepEqual(checkAttachmentMeta({ filename: "a.pdf", contentType: "application/pdf", size: 6 * MB + 1 }), { ok: false, reason: "too_large" });
  assert.equal(checkAttachmentMeta({ filename: "a.pdf", contentType: "application/pdf", size: 6 * MB }).ok, true);
});

test("set: at most 5 files and 10 MB in total", () => {
  assert.equal(checkAttachmentSet([{ size: 5 * MB }, { size: 5 * MB }]), null);
  assert.equal(checkAttachmentSet([{ size: 5 * MB }, { size: 5 * MB + 1 }]), "total_too_large");
  assert.equal(checkAttachmentSet(Array.from({ length: 6 }, () => ({ size: 1 }))), "too_many");
  assert.equal(checkAttachmentSet(Array.from({ length: 5 }, () => ({ size: 1 }))), null);
  assert.equal(checkAttachmentSet([]), null);
});

test("display filename drops path parts and control characters but keeps accents", () => {
  assert.equal(sanitizeDisplayFilename("../../etc/pásswd.pdf"), "pásswd.pdf");
  assert.equal(sanitizeDisplayFilename("C:\\x\\Propuesta final.pdf"), "Propuesta final.pdf");
  assert.equal(sanitizeDisplayFilename('a\r\nb"c.pdf'), "a b_c.pdf");
  assert.equal(sanitizeDisplayFilename("   "), "archivo");
});

test("display filename is capped at 120 chars keeping the extension", () => {
  const out = sanitizeDisplayFilename(`${"x".repeat(300)}.pdf`);
  assert.equal(out.length, 120);
  assert.ok(out.endsWith(".pdf"));
});

test("storage-safe name is ASCII-only, keeps the extension, never empty", () => {
  assert.equal(storageSafeName("Propuesta ñandú (v2).pdf"), "Propuesta_nandu__v2_.pdf");
  assert.equal(storageSafeName("日本語.pdf"), "file.pdf");
  assert.equal(storageSafeName("???"), "file");
  assert.match(storageSafeName("a b.PDF"), /^[A-Za-z0-9._-]+$/);
});

test("size label uses a decimal comma and one decimal", () => {
  assert.equal(formatAttachmentSize(2_726_297), "2,6 MB");
  assert.equal(formatAttachmentSize(100 * 1024), "0,1 MB");
  assert.equal(formatAttachmentSize(0), "0 MB");
});

test("magic bytes: pdf, png, jpg, zip-based office, ole, text", () => {
  const b = (...n: number[]) => Uint8Array.from(n);
  assert.equal(matchesMagic("pdf", Buffer.from("%PDF-1.7\n...")), true);
  assert.equal(matchesMagic("pdf", Buffer.from("MZ\x90\x00")), false);
  assert.equal(matchesMagic("png", b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1)), true);
  assert.equal(matchesMagic("png", b(0xff, 0xd8, 0xff)), false);
  assert.equal(matchesMagic("jpg", b(0xff, 0xd8, 0xff, 0xe0)), true);
  assert.equal(matchesMagic("zip", b(0x50, 0x4b, 0x03, 0x04, 0)), true);
  assert.equal(matchesMagic("zip", b(0x4d, 0x5a)), false);
  assert.equal(matchesMagic("ole", b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)), true);
  assert.equal(matchesMagic("text", Buffer.from("hola, mundo\n")), true);
  assert.equal(matchesMagic("text", Buffer.from([0x4d, 0x5a, 0x00, 0x00])), false);
  assert.equal(matchesMagic("pdf", new Uint8Array(0)), false);
});
