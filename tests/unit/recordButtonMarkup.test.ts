/**
 * Guards against the contact/company record pencil-icon bug (fixed
 * 2026-09-30): the `.edit` inline-edit button in PropertyList.tsx /
 * CompanyAboutPane.tsx carried no `.btn*` class, so it fell back to
 * globals.css's zero-specificity `:where(button)` legacy style — a solid,
 * red, "primary-looking" fill on hover instead of the mockup's ghost icon
 * button. Every `<button>` in these two record files must opt into a
 * `.btn*` class explicitly, same rule as the Dialog markup guard
 * (tests/unit/dialogMarkup.test.ts), applied here to the record rows
 * outside any `<Dialog>`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "src/app/(app)/contacts/[id]/PropertyList.tsx",
  "src/app/(app)/companies/[key]/CompanyAboutPane.tsx",
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// From `src[start]` (right after `<button`), returns the index of the `>`
// that actually closes the opening tag — the first `>` at brace/quote
// depth 0, so an `onClick={() => foo()}` arrow's `=>` doesn't truncate the
// tag early.
function findTagEnd(src: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

function classNameValue(openTag: string): string | null {
  const m = openTag.match(/className\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/s);
  return m ? m[1] : null;
}

function buttonViolations(file: string, src: string): { violations: string[]; checked: number } {
  const violations: string[] = [];
  let checked = 0;
  for (const m of src.matchAll(/<button\b/g)) {
    const tagEnd = findTagEnd(src, m.index! + "<button".length);
    if (tagEnd === -1) continue;
    const openTag = src.slice(m.index!, tagEnd + 1);
    checked++;
    const cls = classNameValue(openTag) ?? "";
    if (/\bbtn\b/.test(cls)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    violations.push(`${file}:~${line} <button ${cls || "(no className)"}> — add a \`.btn*\` class`);
  }
  return { violations, checked };
}

test("every <button> in the contact/company record panes carries a `.btn*` class", () => {
  const violations: string[] = [];
  let totalChecked = 0;
  for (const file of FILES) {
    const src = stripComments(readFileSync(file, "utf8"));
    const { violations: fileViolations, checked } = buttonViolations(file, src);
    violations.push(...fileViolations);
    totalChecked += checked;
  }
  assert.ok(totalChecked >= 10, `expected several <button> elements across ${FILES.join(", ")}, found ${totalChecked}`);
  assert.deepEqual(violations, [], `\n${violations.join("\n")}`);
});

test("fixture proof: an unclassed <button> is caught by the scanner", () => {
  const src = `<button type="button" onClick={() => {}}>Cancelar</button>`;
  const { violations, checked } = buttonViolations("fixture.tsx", src);
  assert.equal(checked, 1);
  assert.equal(violations.length, 1, `expected the unclassed button flagged, got:\n${violations.join("\n")}`);
});
