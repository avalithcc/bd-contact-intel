/**
 * `redirect()`/`notFound()` work by THROWING a special Next.js error. A
 * server action or route handler that wraps a call to `getCurrentBd()` (or
 * anything else that can redirect/notFound) in a generic
 * `try { ... } catch (err) { return { ok: false, ... } }` silently swallows
 * that throw — the caller gets a generic error instead of the intended
 * redirect (fails closed, but breaks the intended behaviour). Known examples
 * fixed alongside this test: src/app/actions.ts, src/app/(app)/contacts/
 * actions.ts (`actionFailure`), src/app/(app)/companies/actions.ts,
 * src/app/api/gmail/oauth/callback/route.ts, src/app/api/signals/manual/
 * route.ts.
 *
 * The fix is `unstable_rethrow(err)` (from "next/navigation") as the first
 * statement in the catch — it rethrows Next's internal control-flow errors
 * (redirect, notFound, forbidden, unauthorized) and does nothing for
 * ordinary errors. A catch that already rethrows unconditionally (ends with
 * a top-level `throw err;`) needs no change.
 *
 * This test statically scans every "use server" file and every route.ts
 * handler under src/app for a catch block that does none of:
 *   1. calls `unstable_rethrow(<param>)` as its first statement,
 *   2. calls a helper from KNOWN_SAFE_HELPERS (which itself calls
 *      unstable_rethrow) as its first statement, or
 *   3. unconditionally rethrows `<param>` as the catch's last top-level
 *      statement.
 * Comments are stripped before scanning — a previous version of a scan test
 * like this one broke on text inside comments.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { join, sep } from "node:path";

const SRC_APP = join("src", "app");

// Helpers known to call unstable_rethrow(err) as their own first statement,
// so a catch that routes through one of these does not need its own direct
// call. Keep this list explicit and in sync with the codebase — do not
// pattern-match "any function call" here.
const KNOWN_SAFE_HELPERS = ["actionFailure"];

/** Strips `//` and `/* *‍/` comments, leaving string/template literal
 * contents (including any braces inside them) untouched so brace-depth
 * counting downstream stays correct. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          out += src[i];
          i++;
          break;
        }
        out += src[i];
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function isInScopeFile(filePath: string, strippedContent: string): boolean {
  if (filePath.endsWith(`${sep}route.ts`) || filePath === "route.ts") return true;
  return /["']use server["']/.test(strippedContent);
}

/** From `openBraceIndex` (the index of a `{`), returns the block's content
 * (exclusive of the outer braces) by counting brace depth forward. */
function extractBraceBlock(src: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(openBraceIndex + 1, i);
    }
  }
  throw new Error(`Unbalanced braces starting at index ${openBraceIndex}`);
}

/** Splits a block into its top-level (depth-0) `;`-terminated chunks. A
 * nested `{ ... }` (if/else, object literal, template `${}`) never produces
 * a split on its own — only a `;` seen while depth is back to 0 does. */
function splitTopLevelChunks(block: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of block) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === ";" && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) chunks.push(trimmed);
      current = "";
    } else {
      current += ch;
    }
  }
  const trimmedTail = current.trim();
  if (trimmedTail) chunks.push(trimmedTail);
  return chunks;
}

interface CatchViolation {
  file: string;
  snippet: string;
  reason: string;
}

function findCatchBlocks(strippedContent: string): { param: string | null; block: string }[] {
  const results: { param: string | null; block: string }[] = [];
  const catchRe = /\bcatch\s*(\(([^)]*)\))?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = catchRe.exec(strippedContent))) {
    const param = match[2]?.trim() || null;
    const openBraceIndex = match.index + match[0].length - 1;
    const block = extractBraceBlock(strippedContent, openBraceIndex);
    results.push({ param, block });
  }
  return results;
}

function classifyCatch(param: string | null, block: string): { ok: boolean; reason: string } {
  if (!param) {
    return { ok: false, reason: "catch has no bound error parameter — cannot rethrow it" };
  }
  const chunks = splitTopLevelChunks(block);
  if (chunks.length === 0) {
    return { ok: false, reason: "catch body is empty" };
  }
  const first = chunks[0];
  const last = chunks[chunks.length - 1];

  const rethrowRe = new RegExp(`^unstable_rethrow\\(\\s*${param}\\s*\\)$`);
  if (rethrowRe.test(first)) return { ok: true, reason: "calls unstable_rethrow(err) first" };

  // A known-safe helper call doesn't have to be the very first statement —
  // e.g. updateContactLocationAction's catch first checks for an unrelated,
  // already-typed error and returns early, then falls through to
  // `actionFailure(err)` unconditionally. What matters is that SOME
  // unconditional top-level chunk calls it (a chunk starting with a
  // control-flow keyword like `if`/`for`/`while`/`try` is conditional, so it
  // can never match this pattern, which requires the helper call at the
  // chunk's own start).
  const helperAlt = KNOWN_SAFE_HELPERS.join("|");
  const helperRe = new RegExp(
    `^(?:return\\s+)?(?:const\\s+[\\w{},:\\s]+=\\s*)?(?:${helperAlt})\\(\\s*${param}\\b`,
  );
  if (chunks.some((chunk) => helperRe.test(chunk))) {
    return { ok: true, reason: "routes through a known-safe helper unconditionally" };
  }

  const unconditionalThrowRe = new RegExp(`(?:^|[^\\w])throw\\s+${param}\\s*$`);
  if (unconditionalThrowRe.test(last)) {
    return { ok: true, reason: "unconditionally rethrows as its last statement" };
  }

  return {
    ok: false,
    reason:
      `first statement is "${first.slice(0, 80)}", last statement is "${last.slice(0, 80)}" — ` +
      "neither calls unstable_rethrow(err)/a known-safe helper first, nor rethrows unconditionally last",
  };
}

function scan(): { violations: CatchViolation[]; totalCatchBlocks: number; scannedFiles: number } {
  const allFiles = (readdirSync(SRC_APP, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => join(SRC_APP, f));

  const violations: CatchViolation[] = [];
  let totalCatchBlocks = 0;
  let scannedFiles = 0;

  for (const file of allFiles) {
    const raw = readFileSync(file, "utf8");
    const stripped = stripComments(raw);
    if (!isInScopeFile(file, stripped)) continue;
    scannedFiles++;

    for (const { param, block } of findCatchBlocks(stripped)) {
      totalCatchBlocks++;
      const { ok, reason } = classifyCatch(param, block);
      if (!ok) {
        violations.push({
          file,
          snippet: block.trim().slice(0, 200),
          reason,
        });
      }
    }
  }

  return { violations, totalCatchBlocks, scannedFiles };
}

test("every catch in a server action / route handler rethrows Next navigation errors", () => {
  const { violations, totalCatchBlocks, scannedFiles } = scan();

  // Sanity: a badly broken regex (e.g. one that never matches `catch`)
  // must not pass silently by finding zero blocks.
  assert.ok(
    scannedFiles >= 15,
    `expected to scan at least 15 "use server"/route.ts files under src/app, found ${scannedFiles} — the file-scope regex may be broken`,
  );
  assert.ok(
    totalCatchBlocks >= 20,
    `expected at least 20 catch blocks across in-scope files, found ${totalCatchBlocks} — the catch-scanning regex may be broken`,
  );

  if (violations.length > 0) {
    const details = violations
      .map((v) => `  - ${v.file}: ${v.reason}\n    catch body: ${v.snippet}`)
      .join("\n");
    assert.fail(
      `${violations.length} catch block(s) can swallow a redirect()/notFound() thrown inside their try — ` +
        `add unstable_rethrow(err) as the first statement (or route through a KNOWN_SAFE_HELPERS helper):\n${details}`,
    );
  }
});

test("fixture proof: a swallowing catch in a fixture 'use server' file is detected", () => {
  const fixtureDir = join(SRC_APP, "__rethrow_fixture_tmp__");
  const fixturePath = join(fixtureDir, "actions.ts");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    fixturePath,
    [
      '"use server";',
      "",
      "export async function fixtureAction() {",
      "  try {",
      "    await Promise.resolve();",
      "    return { ok: true };",
      "  } catch (err) {",
      "    return { ok: false, message: String(err) };",
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  try {
    const { violations } = scan();
    const fixtureViolations = violations.filter((v) => v.file === fixturePath);
    assert.equal(
      fixtureViolations.length,
      1,
      "the fixture's swallowing catch must be reported as exactly one violation",
    );
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
