/**
 * Cuenta > Herramientas: how the page knows the extension is installed (a version string the extension's tiny
 * CRM-origin script writes on <html>) and where "Instalar extensión" may point (an https store URL, or nothing).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readInstalledVersion, resolveExtensionStoreUrl } from "@/lib/extension/install";

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

test("the store link must be an https URL, otherwise the install button stays disabled", () => {
  const url = "https://chromewebstore.google.com/detail/crm-avalith/abcdefghijklmnop";
  assert.equal(resolveExtensionStoreUrl(url), url);
  assert.equal(resolveExtensionStoreUrl(` ${url} `), url);
  for (const value of [undefined, "", "   ", "http://chromewebstore.google.com/x", "javascript:alert(1)", "not a url", "//evil.example/x"]) {
    assert.equal(resolveExtensionStoreUrl(value), null, String(value));
  }
});
