/**
 * A TRIPWIRE, not a proof. It reads every .ts/.tsx file under src/ and fails when a line calls `revalidatePath(` with an
 * argument that mentions `/contacts/` in any quoting style (template, string concatenation, single or double quotes), in
 * any file except the helper that owns the literal. That catches the forms that exist today and the obvious variants.
 *
 * It does NOT catch: a path built into a variable on an earlier line, an aliased import of revalidatePath, a call split
 * across lines, or code outside src/ and outside .ts/.tsx. The invariant (one way to revalidate a Contact record, so the
 * company page is refreshed too) is kept by review; this only makes the common regression loud.
 *
 * The second test stands in for a `server-only` import on the helper, which was not taken because it costs a production
 * dependency and test stubs for a misuse nobody has committed. The risk it covers: a client component importing the
 * helper would bundle the database client, the lookup would fail inside the best-effort swallow, and the page would
 * silently never refresh. So the invariant is worth asserting, just not worth a dependency.
 *
 * That client check matches any import specifier ending in `/revalidateContactSurfaces` (alias, relative, dynamic
 * `import("...")`, side-effect). KNOWN HOLE: it cannot see transitive imports, a client file importing a module that
 * itself imports the helper; a source scan cannot follow the graph.
 *
 * The last test guards the line ORDER inside changeContactCompanyAction. It asserts order, not behaviour: the previous
 * company key cannot be derived once the write has moved the person, so it must be read before the write, and the old
 * company page must be revalidated only after the write succeeded. If that action ever grows a seam for injected
 * dependencies, a behavioural test should replace this one.
 *
 * Comments are NOT stripped on purpose, so a commented-out raw call is reported too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OWNER = join("src", "lib", "contacts", "revalidateContactSurfaces.ts");
// A `/contacts/` segment (a record path), not the exact list path "/contacts" nor the import wizard, which has no
// company page. The exemption is the exact literal
// route only: anything dynamic after it (`import${id}`, `import/${id}`, `import-x`) is flagged. A new static sub-route under
// /contacts must be added to the lookahead on purpose (the export route is deliberately NOT exempt).
const RAW_CONTACT_REVALIDATION = /revalidatePath\([^)\n]*\/contacts\/(?!import["'`)])/;

function filesWithRawContactRevalidation(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => join(root, f))
    .filter((f) => f !== OWNER)
    .filter((f) => RAW_CONTACT_REVALIDATION.test(readFileSync(f, "utf8")));
}

test("the matcher recognises the raw call shapes it exists to forbid", () => {
  assert.ok(RAW_CONTACT_REVALIDATION.test("revalidatePath(`/contacts/${personId}`);"));
  assert.ok(RAW_CONTACT_REVALIDATION.test("if (x) revalidatePath(`/contacts/${other.id}`)"));
  assert.ok(RAW_CONTACT_REVALIDATION.test('revalidatePath("/contacts/" + id);'));
  assert.ok(RAW_CONTACT_REVALIDATION.test("revalidatePath('/contacts/' + id);"));
  assert.ok(RAW_CONTACT_REVALIDATION.test("revalidatePath(`/contacts/import${id}`);"), "only the exact static route is exempt");
  assert.ok(RAW_CONTACT_REVALIDATION.test("revalidatePath(`/contacts/import/${id}`);"));
  assert.ok(RAW_CONTACT_REVALIDATION.test('revalidatePath("/contacts/import-x");'));
  assert.ok(RAW_CONTACT_REVALIDATION.test('revalidatePath("/contacts/export");'), "the export route is deliberately not exempt");
  assert.ok(!RAW_CONTACT_REVALIDATION.test('revalidatePath("/contacts/import");'), "the import wizard is not a record");
  assert.ok(!RAW_CONTACT_REVALIDATION.test('revalidatePath("/contacts");'), "the list path is a legitimate exact path");
  assert.ok(!RAW_CONTACT_REVALIDATION.test("revalidatePath(`/contact/${contactId}`);"), "the legacy route is a different path");
});

test("no file under src/ revalidates a Contact record path except the helper", () => {
  assert.ok(RAW_CONTACT_REVALIDATION.test(readFileSync(OWNER, "utf8")), "the helper must own the literal, or this scan is vacuous");
  assert.deepEqual(
    filesWithRawContactRevalidation("src"),
    [],
    "route Contact revalidation through revalidateContactSurfaces(personId, ...effects) so the company page is refreshed too",
  );
});

const CLIENT_DIRECTIVE = /^\s*["']use client["']/m;
const HELPER_IMPORT = /["'`][^"'`\n]*\/revalidateContactSurfaces["'`]/;

function clientFilesImportingHelper(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => join(root, f))
    .filter((f) => {
      const src = readFileSync(f, "utf8");
      return CLIENT_DIRECTIVE.test(src) && HELPER_IMPORT.test(src);
    });
}

test("no \"use client\" file under src/ imports revalidateContactSurfaces", () => {
  assert.ok(CLIENT_DIRECTIVE.test('"use client";\nimport x from "y";'), "the directive matcher must recognise a client file");
  for (const form of [
    'import { revalidateContactSurfaces } from "@/lib/contacts/revalidateContactSurfaces";',
    'import { revalidateContactSurfaces } from "../../lib/contacts/revalidateContactSurfaces";',
    'import "@/lib/contacts/revalidateContactSurfaces";',
    'const m = await import("@/lib/contacts/revalidateContactSurfaces");',
  ]) assert.ok(HELPER_IMPORT.test(form), form);
  assert.ok(!HELPER_IMPORT.test('import { x } from "@/lib/contacts/revalidateLists";'));
  assert.deepEqual(clientFilesImportingHelper("src"), [], "the helper reaches the database; keep it on the server");
});

test("changeContactCompanyAction reads the previous company before the write and revalidates it only after", () => {
  const src = readFileSync(join("src", "app", "(app)", "contacts", "actions.ts"), "utf8");
  const start = src.indexOf("export async function changeContactCompanyAction");
  assert.ok(start >= 0, "the action must exist");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  const read = body.indexOf("getCanonicalCompanyKeyForPerson(");
  const write = body.indexOf("await changeContactCompany(");
  const revalidatePrevious = body.indexOf("revalidatePath(`/companies/${previousCompanyKey}`)");
  assert.ok(read >= 0 && write >= 0 && revalidatePrevious >= 0, "all three steps must be present");
  assert.ok(read < write, "the previous key must be read BEFORE the write");
  assert.ok(write < revalidatePrevious, "the previous company is revalidated AFTER the write");
  assert.ok(!body.slice(write, revalidatePrevious).includes("catch"), "the previous-company revalidation belongs to the success path, not a catch");
});
