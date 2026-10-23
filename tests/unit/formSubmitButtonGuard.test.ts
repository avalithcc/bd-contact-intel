/**
 * Guard for the in-progress feedback of server-action forms. The "form is submitting" state comes from
 * useFormStatus(), which only runs in a client component, so a bare submit button inside a `<form action={...}>`
 * in a server component can never show a spinner (the Duplicados "Fusionar" button looked hung for ~2s).
 * Invariant: under src/app, every button inside a `<form action={...}>` that is not explicitly `type="button"` or
 * `type="reset"` (a typeless <button> submits too) is the SubmitButton component. The one exemption is a file
 * that uses useActionState: its forms own a pending flag, and every such form must be driven by it (checked per
 * form, so a new form added to an exempt file without one fails). That SubmitButton really works is proven in
 * submitButton.test.ts. Shape follows tests/unit/sequencesDraftLanguageGuard.test.ts, including the fixture proof.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join("src", "app");

/**
 * Submit buttons associated to a form by `form="id"` from OUTSIDE it (a Dialog footer). They are not React
 * descendants of the form, so useFormStatus structurally cannot see the form: SubmitButton cannot serve them.
 * Deliberate, listed, and it must not grow; moving the button inside the form or tracking pending in client state fixes one.
 */
const OUTSIDE_FORM_SUBMITS = new Set<string>([join("src", "app", "(app)", "contacts", "SaveViewDialog.tsx")]);

const ACTION_FORM = /<form\b[^>]*\baction=\{[\s\S]*?<\/form>/g;
/** The rest of an opening tag; `=>` inside an attribute (onClick={() => ...}) must not end it. Alternatives are disjoint on purpose (no backtracking blowup). */
const TAG = String.raw`(?:[^>=]|=(?!>)|=>)*>`;
const BUTTON = new RegExp(String.raw`<button\b${TAG}`, "g");
const NOT_SUBMIT = /\btype="(?:button|reset)"/;
/** A submit button tied to a form by form="id" (it may sit anywhere in the file, outside any form element). */
const hasFormAssociatedSubmit = (text: string) => (text.match(BUTTON) ?? []).some((b) => /\bform="/.test(b) && !NOT_SUBMIT.test(b));
const USES_ACTION_STATE = /\buseActionState\b/;
const PENDING = /\bpending\b/;

function files(root: string): string[] {
  return (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith(".tsx")).map((f) => join(root, f));
}

/** A doc comment that merely shows the markup must not count as a button. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function scan(root: string, outsideAllowed: Set<string> = OUTSIDE_FORM_SUBMITS): string[] {
  const offenders: string[] = [];
  for (const file of files(root)) {
    const text = stripComments(readFileSync(file, "utf8"));
    const ownsPending = USES_ACTION_STATE.test(text);
    const allButtons = text.match(BUTTON) ?? [];
    for (const form of text.match(ACTION_FORM) ?? []) {
      const buttons = (form.match(BUTTON) ?? []).filter((b) => !NOT_SUBMIT.test(b));
      if (!ownsPending) {
        if (buttons.length > 0) offenders.push(file);
        continue;
      }
      // Exempt file: this form must be driven by a pending flag, on the form itself or on every submit button. A form
      // with no button inside submits from a form="id" button elsewhere in the file (a Dialog footer): that one must carry it.
      const openTag = form.match(new RegExp(String.raw`^<form\b${TAG}`))?.[0] ?? "";
      const submits = buttons.length > 0 ? buttons : allButtons.filter((b) => /\bform=/.test(b) && !NOT_SUBMIT.test(b));
      if (!PENDING.test(openTag) && !(submits.length > 0 && submits.every((b) => PENDING.test(b)))) offenders.push(file);
    }
    if (!outsideAllowed.has(file) && hasFormAssociatedSubmit(text)) offenders.push(file);
  }
  return offenders;
}

test("every submit button inside a server-action form is a SubmitButton", () => {
  const offenders = scan(ROOT);
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} render a bare submit button in a <form action={...}> without pending feedback. Use ` +
      `@/components/forms/SubmitButton so the button shows a spinner and disables while the action runs.`,
  );
});

test("the guard really walks forms (the converted buttons are found)", () => {
  const using = files(ROOT).filter((f) => /<SubmitButton\b/.test(readFileSync(f, "utf8")));
  assert.ok(using.length >= 11, `expected SubmitButton in at least 11 files, found ${using.length}`);
});

test("the outside-the-form exemption still exists", () => {
  // Pinned on purpose: this is a STRUCTURAL exemption, not debt. A new form-associated submit button needs its own
  // pending state (useFormStatus cannot see a form it is not a child of), never a new line in this set.
  assert.equal(OUTSIDE_FORM_SUBMITS.size, 1, "the outside-the-form exemption must not grow");
  for (const file of OUTSIDE_FORM_SUBMITS) {
    const text = stripComments(readFileSync(file, "utf8"));
    assert.ok(hasFormAssociatedSubmit(text), `${file} is exempt but no longer has a form-associated submit button`);
  }
});

test("fixture proof: bare, typeless, dynamic-type and form-associated buttons are caught; the safe shapes are not", () => {
  // Fixtures live in os.tmpdir(), never under src/: other tests walk src/ in parallel processes.
  const root = mkdtempSync(join(tmpdir(), "form-submit-button-"));
  const write = (name: string, body: string) => {
    writeFileSync(join(root, name), body);
    return join(root, name);
  };
  const bare = write("bare.tsx", 'export const A = () => (<form action={go}><button type="submit" className="x">Go</button></form>);\n');
  const typeless = write("typeless.tsx", "export const A = () => (<form action={go}><button className=\"x\" onClick={() => f()}>Go</button></form>);\n");
  const dynamic = write("dynamic.tsx", "export const A = () => (<form action={go}><button type={kind}>Go</button></form>);\n");
  const outside = write("outside.tsx", 'export const A = () => (<button type="submit" form="f">Go</button>);\n');
  const exemptNoPending = write(
    "exempt-no-pending.tsx",
    'export const A = () => { const [s, a] = useActionState(f, null); return (<><form action={a}><button type="submit" disabled={s.pending}>Go</button></form><form action={b}><button type="submit">Go</button></form></>); };\n',
  );
  write("safe-submit-button.tsx", 'export const B = () => (<form action={go}><SubmitButton pendingLabel="Going…">Go</SubmitButton></form>);\n');
  write("safe-type-button.tsx", 'export const D = () => (<form action={go}><button type="button" onClick={() => f()}>Go</button></form>);\n');
  write("safe-get-form.tsx", 'export const E = () => (<form method="get"><button type="submit">Go</button></form>);\n');
  write(
    "safe-own-state.tsx",
    'export const C = () => { const [s, a, pending] = useActionState(f, null); return (<form action={a}><button type="submit" disabled={pending}>Go</button></form>); };\n',
  );
  try {
    assert.deepEqual(scan(root, new Set()).sort(), [bare, dynamic, exemptNoPending, outside, typeless].sort());
    assert.ok(!scan(root, new Set([outside])).includes(outside));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
