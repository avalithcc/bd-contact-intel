/**
 * The extension download: a dependency-free zip writer and the packer that turns extension/dist into
 * extension/zip/crm-linkedin-v<version>.zip. The archive is parsed back with an independent reader so a
 * mistake in the writer (CRC, sizes, offsets) shows up here and not when a BD unzips it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { crc32, createZip } from "../../extension/build/zip";
import { assertDistComplete, extensionZipName, packExtension } from "../../extension/build/pack";
import { EXTENSION_VERSION } from "../../extension/build/manifest";

interface Entry {
  name: string;
  data: Buffer;
}

/** Reads a zip through its central directory, verifying every CRC. Independent of the writer. */
function readZip(zip: Buffer): Entry[] {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "end of central directory");
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    const method = zip.readUInt16LE(offset + 10);
    const crc = zip.readUInt32LE(offset + 16);
    const compressed = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(data.length, size, `${name} size`);
    assert.equal(crc32(data), crc, `${name} crc`);
    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("a zip round-trips names and bytes, including empty and compressible files", () => {
  const big = Buffer.from("abc".repeat(5000));
  const zip = createZip([
    { name: "dir/a.txt", data: Buffer.from("hola ñandú") },
    { name: "dir/empty", data: Buffer.alloc(0) },
    { name: "dir/big.js", data: big },
  ]);
  const entries = readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ["dir/a.txt", "dir/empty", "dir/big.js"]);
  assert.equal(entries[0].data.toString("utf8"), "hola ñandú");
  assert.equal(entries[2].data.equals(big), true);
  assert.ok(zip.length < big.length, "compressible data is deflated");
});

test("the archive is byte-identical for the same input", () => {
  const files = [{ name: "x/a", data: Buffer.from("same") }];
  assert.equal(createZip(files).equals(createZip(files)), true);
});

test("the system unzip accepts the archive", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "zip-test-"));
  try {
    const file = path.join(dir, "a.zip");
    writeFileSync(file, createZip([{ name: "f/one.txt", data: Buffer.from("1") }]));
    try {
      execFileSync("unzip", ["-tq", file], { stdio: "pipe" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return t.skip("unzip is not installed");
      throw error;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeDist(root: string, overrides: { manifest?: object; omit?: string } = {}) {
  const dist = path.join(root, "dist");
  mkdirSync(path.join(dist, "icons"), { recursive: true });
  const manifest = overrides.manifest ?? {
    manifest_version: 3,
    version: EXTENSION_VERSION,
    host_permissions: ["https://crm.avalith.net/*", "https://www.linkedin.com/*"],
  };
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify(manifest),
    "background.js": "// worker",
    "content-linkedin.js": "// linkedin",
    "content-crm.js": "// crm",
    "icons/16.png": "x",
    "icons/128.png": "x",
  };
  for (const [name, body] of Object.entries(files)) {
    if (name !== overrides.omit) writeFileSync(path.join(dist, name), body);
  }
  return dist;
}

test("the file name carries the manifest version", () => {
  assert.equal(extensionZipName("1.2.3"), "crm-linkedin-v1.2.3.zip");
});

test("packing puts a single crm-linkedin folder at the top with manifest, worker and both content scripts", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pack-test-"));
  try {
    const out = path.join(root, "zip");
    const file = packExtension({ distDir: fakeDist(root), outDir: out });
    assert.equal(path.basename(file), `crm-linkedin-v${EXTENSION_VERSION}.zip`);
    const entries = readZip(readFileSync(file));
    const names = entries.map((e) => e.name);
    assert.ok(names.every((n) => n.startsWith("crm-linkedin/")), "one top-level folder");
    for (const required of ["manifest.json", "background.js", "content-linkedin.js", "content-crm.js", "icons/16.png"]) {
      assert.ok(names.includes(`crm-linkedin/${required}`), required);
    }
    const manifest = JSON.parse(entries.find((e) => e.name === "crm-linkedin/manifest.json")!.data.toString());
    assert.equal(manifest.version, EXTENSION_VERSION);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("packing replaces older archives so only the current version is served", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pack-test-"));
  try {
    const out = path.join(root, "zip");
    mkdirSync(out);
    writeFileSync(path.join(out, "crm-linkedin-v0.0.1.zip"), "old");
    packExtension({ distDir: fakeDist(root), outDir: out });
    assert.deepEqual(readdirSync(out), [`crm-linkedin-v${EXTENSION_VERSION}.zip`]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing or inconsistent build fails loudly instead of shipping a broken download", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pack-test-"));
  try {
    assert.throws(() => packExtension({ distDir: path.join(root, "nope"), outDir: path.join(root, "zip") }), /extension:build/);
    for (const missing of ["manifest.json", "background.js", "content-linkedin.js", "content-crm.js"]) {
      const dist = fakeDist(path.join(root, missing), { omit: missing });
      assert.throws(() => assertDistComplete(dist), new RegExp(missing.replace(".", "\\.")), missing);
    }
    const stale = fakeDist(path.join(root, "stale"), { manifest: { version: "0.0.1", host_permissions: [] } });
    assert.throws(() => assertDistComplete(stale), /version/);
    const dev = fakeDist(path.join(root, "dev"), {
      manifest: { version: EXTENSION_VERSION, host_permissions: ["http://localhost:3000/*"] },
    });
    assert.throws(() => assertDistComplete(dev), /localhost/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
