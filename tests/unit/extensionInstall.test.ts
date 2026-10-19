/**
 * Cuenta > Herramientas: how the page knows the extension is installed (a version string the extension's tiny
 * CRM-origin script writes on <html>), whether it is older than the version the CRM serves, and which browser tab the
 * install guide opens on.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, defaultBrowserTab, extensionInstallState, readInstalledVersion } from "@/lib/extension/install";

test("an installed extension is recognized by a plain version string", () => {
  assert.equal(readInstalledVersion("1.0.0"), "1.0.0");
  assert.equal(readInstalledVersion(" 1.2.3 "), "1.2.3");
  assert.equal(readInstalledVersion("2.10.4.5"), "2.10.4.5");
});

test("a missing, empty or odd marker means not installed, never a guess", () => {
  for (const value of [null, undefined, "", "   ", "latest", "1.0.0<script>", "javascript:1", "x".repeat(40)]) {
    assert.equal(readInstalledVersion(value), null, String(value));
  }
});

test("versions compare numerically, not as text", () => {
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1);
  assert.equal(compareVersions("2.0", "2.0.0"), 0);
  assert.equal(compareVersions("1.0.0.1", "1.0.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
});

test("a version that cannot be parsed is never ordered", () => {
  for (const value of ["", "latest", "1.x", "1.0.0-beta", "1..0"]) {
    assert.equal(compareVersions(value, "1.0.0"), null, value);
    assert.equal(compareVersions("1.0.0", value), null, value);
  }
});

test("the install state is not installed, current or outdated", () => {
  assert.deepEqual(extensionInstallState(null, "1.1.0"), { kind: "not-installed" });
  assert.deepEqual(extensionInstallState("", "1.1.0"), { kind: "not-installed" });
  assert.deepEqual(extensionInstallState("1.1.0", "1.1.0"), { kind: "current", version: "1.1.0" });
  assert.deepEqual(extensionInstallState("1.0.0", "1.1.0"), { kind: "outdated", version: "1.0.0" });
  assert.deepEqual(extensionInstallState("1.9.0", "1.10.0"), { kind: "outdated", version: "1.9.0" });
});

test("an installed version newer than the served one is not nagged about", () => {
  assert.deepEqual(extensionInstallState("1.2.0", "1.1.0"), { kind: "current", version: "1.2.0" });
});

test("an installed version we cannot compare shows installed, never outdated", () => {
  // The marker passed readInstalledVersion (so it is a plain dotted version), but if the served version were
  // ever unparseable the comparison must fall back to "installed" instead of guessing.
  assert.deepEqual(extensionInstallState("1.0.0", "weird"), { kind: "current", version: "1.0.0" });
});

test("the guide opens on Edge only when the user agent says Edge", () => {
  assert.equal(defaultBrowserTab("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0.0.0"), "edge");
  assert.equal(defaultBrowserTab("Mozilla/5.0 (Macintosh) Chrome/130.0 Safari/537.36"), "chrome");
  assert.equal(defaultBrowserTab(null), "chrome");
  assert.equal(defaultBrowserTab(""), "chrome");
});
