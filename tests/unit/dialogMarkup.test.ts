/**
 * Guards against the dialog markup bugs fixed across PRs #189-193
 * (2026-09-29), all three found and fixed by hand, one dialog at a time,
 * until the owner asked for an automated guard so the next new dialog
 * can't reintroduce them:
 *
 *  1. A `.composer` wrapper INSIDE a `<Dialog>` lights the whole form red
 *     on focus (`.composer:focus-within` in design-system.css) — `.composer`
 *     is the PINNED, always-visible composer look (NoteComposer.tsx), not a
 *     modal's. A `<Dialog>`'s own `.dialog`/`.dialog-body` already provide
 *     that chrome.
 *  2. A `<button>` inside a Dialog with no design-system class (no `btn`)
 *     falls back to globals.css's zero-specificity `:where(button)` legacy
 *     style — a red, filled, "primary-looking" button. Every action button
 *     (Cancelar included) must opt into a `.btn*` class explicitly.
 *  3. `<label>` wrapping its control (`<label><input/></label>`) instead of
 *     the mockup's `.field` > `label.label[htmlFor]` + sibling control
 *     makes the browser forward clicks meant for one control (e.g. a list
 *     of result buttons) to the label's own associated field.
 *
 * A static scan, so the next dialog that reintroduces any of the three
 * fails here instead of in front of the owner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app", "src/components"];
const FIXTURE_DIR = join("src", "app", "__dialog_fixture_tmp__");

// Strips both comment styles before scanning: a scan here once broke on a
// bug description quoted inside a comment (this file's own docblock above
// quotes `.composer:focus-within` and `<label><input/></label>`, which
// would otherwise read as violations).
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function listTsxFiles(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root, { recursive: true }) as string[];
  } catch {
    return [];
  }
  return entries.filter((f) => f.endsWith(".tsx")).map((f) => join(root, f));
}

/**
 * From `src[start]` (the character right after a tag name, e.g. right after
 * `<button` or `<Dialog`), returns the index of the `>` that actually closes
 * the opening tag — the first `>` at brace/quote depth 0. A naive
 * `[^>]*?>` regex stops at the first `>` at all, including the one inside
 * an arrow function's `=>` (e.g. `onClick={() => foo()}`), truncating the
 * tag before attributes that come after it.
 */
function findTagEnd(src: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    } else if (c === ">" && depth === 0) {
      return i;
    }
  }
  return -1;
}

function classNameValue(openTag: string): string | null {
  const m = openTag.match(/className\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/s);
  return m ? m[1] : null;
}

// Buttons that intentionally don't carry a `.btn*` class, with the reason
// they're exempt. Matched by a literal substring unique to their opening
// tag, so a new offending button elsewhere can't silently piggyback on one
// of these.
const BUTTON_EXCEPTIONS: { match: string; reason: string }[] = [
  {
    match: "styles.resultItem",
    reason:
      "NewTaskButton.tsx / ChangeCompanyButton.tsx's inline search-results listbox item — no design-system " +
      "component covers it; NewTaskButton.module.css's .resultItem explicitly sets background:none/border:none, " +
      "overriding the legacy `:where(button)` fallback on its own (documented in that CSS module).",
  },
];

interface DialogBlock {
  file: string;
  text: string;
}

function findDialogBlocks(file: string, src: string): DialogBlock[] {
  const blocks: DialogBlock[] = [];
  const re = /<Dialog\b[\s\S]*?<\/Dialog>/g;
  for (const m of src.matchAll(re)) {
    blocks.push({ file, text: m[0] });
  }
  return blocks;
}

function collectDialogBlocks(): DialogBlock[] {
  const blocks: DialogBlock[] = [];
  for (const root of ROOTS) {
    for (const file of listTsxFiles(root)) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (!src.includes("<Dialog")) continue;
      blocks.push(...findDialogBlocks(file, src));
    }
  }
  return blocks;
}

function composerViolations(blocks: DialogBlock[]): string[] {
  const violations: string[] = [];
  for (const { file, text } of blocks) {
    for (const m of text.matchAll(/className\s*=\s*(\{[^}]*\}|"[^"]*")/g)) {
      if (/\bcomposer\b/.test(m[1])) {
        violations.push(`${file}: <Dialog> body contains a \`.composer\` element (${m[1]})`);
      }
    }
  }
  return violations;
}

function buttonViolations(blocks: DialogBlock[]): { violations: string[]; checked: number } {
  const violations: string[] = [];
  let checked = 0;
  for (const { file, text } of blocks) {
    for (const m of text.matchAll(/<button\b/g)) {
      const tagEnd = findTagEnd(text, m.index! + "<button".length);
      if (tagEnd === -1) continue;
      const openTag = text.slice(m.index!, tagEnd + 1);
      checked++;
      const cls = classNameValue(openTag) ?? "";
      if (/\bbtn\b/.test(cls)) continue;
      const exception = BUTTON_EXCEPTIONS.find((e) => openTag.includes(e.match));
      if (exception) continue;
      const line = text.slice(0, m.index).split("\n").length;
      violations.push(`${file}:~${line} <button ${cls || "(no className)"}> — add a \`.btn*\` class`);
    }
  }
  return { violations, checked };
}

function labelViolations(blocks: DialogBlock[]): { violations: string[]; checked: number } {
  const violations: string[] = [];
  let checked = 0;
  for (const { file, text } of blocks) {
    for (const m of text.matchAll(/<label\b[\s\S]*?<\/label>/g)) {
      checked++;
      if (/<(input|select|textarea|button)\b/.test(m[0])) {
        const line = text.slice(0, m.index).split("\n").length;
        violations.push(
          `${file}:~${line} <label> wraps a control — use \`.field\` > \`label.label[htmlFor]\` + sibling control`,
        );
      }
    }
  }
  return { violations, checked };
}

test("no `.composer` element inside a Dialog", () => {
  const violations = composerViolations(collectDialogBlocks());
  assert.deepEqual(violations, [], `\n${violations.join("\n")}`);
});

test("every <button> inside a Dialog carries a `.btn*` class", () => {
  const { violations } = buttonViolations(collectDialogBlocks());
  assert.deepEqual(violations, [], `\n${violations.join("\n")}`);
});

test("no <label> inside a Dialog wraps its control", () => {
  const { violations } = labelViolations(collectDialogBlocks());
  assert.deepEqual(violations, [], `\n${violations.join("\n")}`);
});

test("the scan finds a plausible number of Dialog blocks, buttons and labels (guards against a silently broken regex)", () => {
  const blocks = collectDialogBlocks();
  assert.ok(blocks.length >= 10, `expected several <Dialog> blocks across the app, found ${blocks.length}`);
  const files = new Set(blocks.map((b) => b.file));
  assert.ok(files.size >= 5, `expected several distinct files rendering <Dialog>, found ${files.size}`);
  const { checked: buttonsChecked } = buttonViolations(blocks);
  assert.ok(buttonsChecked >= 20, `expected several buttons inside Dialogs, found ${buttonsChecked}`);
  const { checked: labelsChecked } = labelViolations(blocks);
  assert.ok(labelsChecked >= 15, `expected several labels inside Dialogs, found ${labelsChecked}`);
});

// --- Fixture proofs: each rule must fail on a violating fixture and pass
// on the (already-clean) current tree, proven above. Fixtures are written
// under src/app/__dialog_fixture_tmp__/ and always removed in `finally`,
// even on assertion failure.

function withFixture(fileName: string, content: string, run: () => void) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, fileName);
  writeFileSync(path, content, "utf8");
  try {
    run();
  } finally {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
}

test("fixture proof: a `.composer` inside a Dialog is caught", () => {
  withFixture(
    "Composer.fixture.tsx",
    `
    import { Dialog } from "@/components/Dialog";
    export function Bad() {
      return (
        <Dialog open onClose={() => {}} title="x">
          <div className="composer">
            <textarea />
          </div>
        </Dialog>
      );
    }
    `,
    () => {
      const src = stripComments(readFileSync(join(FIXTURE_DIR, "Composer.fixture.tsx"), "utf8"));
      const blocks = findDialogBlocks("fixture", src);
      const violations = composerViolations(blocks);
      assert.ok(violations.length > 0, "expected the fixture's `.composer` to be flagged");
    },
  );
});

test("fixture proof: an unclassed <button> inside a Dialog is caught", () => {
  withFixture(
    "Button.fixture.tsx",
    `
    import { Dialog } from "@/components/Dialog";
    export function Bad() {
      return (
        <Dialog
          open
          onClose={() => {}}
          title="x"
          footer={
            <>
              <button type="button" onClick={() => {}}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => save()}>Guardar</button>
            </>
          }
        >
          <p>ok</p>
        </Dialog>
      );
    }
    `,
    () => {
      const src = stripComments(readFileSync(join(FIXTURE_DIR, "Button.fixture.tsx"), "utf8"));
      const blocks = findDialogBlocks("fixture", src);
      const { violations, checked } = buttonViolations(blocks);
      assert.equal(checked, 2, "expected both buttons to be scanned");
      assert.equal(violations.length, 1, `expected exactly the unclassed Cancelar button flagged, got:\n${violations.join("\n")}`);
    },
  );
});

test("fixture proof: a known exception (styles.resultItem) is not flagged", () => {
  withFixture(
    "ButtonException.fixture.tsx",
    `
    import { Dialog } from "@/components/Dialog";
    export function Ok() {
      return (
        <Dialog open onClose={() => {}} title="x">
          <button type="button" className={styles.resultItem} onClick={() => pick()}>Acme Corp</button>
        </Dialog>
      );
    }
    `,
    () => {
      const src = stripComments(readFileSync(join(FIXTURE_DIR, "ButtonException.fixture.tsx"), "utf8"));
      const blocks = findDialogBlocks("fixture", src);
      const { violations, checked } = buttonViolations(blocks);
      assert.equal(checked, 1);
      assert.deepEqual(violations, []);
    },
  );
});

test("fixture proof: a <label> wrapping its control inside a Dialog is caught", () => {
  withFixture(
    "Label.fixture.tsx",
    `
    import { Dialog } from "@/components/Dialog";
    export function Bad() {
      return (
        <Dialog open onClose={() => {}} title="x">
          <label className="field">
            <span>Nombre</span>
            <input className="input" />
          </label>
          <div className="field">
            <label className="label" htmlFor="ok">Bien</label>
            <input id="ok" className="input" />
          </div>
        </Dialog>
      );
    }
    `,
    () => {
      const src = stripComments(readFileSync(join(FIXTURE_DIR, "Label.fixture.tsx"), "utf8"));
      const blocks = findDialogBlocks("fixture", src);
      const { violations, checked } = labelViolations(blocks);
      assert.equal(checked, 2, "expected both labels to be scanned");
      assert.equal(violations.length, 1, `expected exactly the wrapping label flagged, got:\n${violations.join("\n")}`);
    },
  );
});
