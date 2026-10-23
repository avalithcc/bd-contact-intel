/**
 * Guard 2 of 2 for the Sequence draft language (guard 1 is the assertion in sequencesDraftInput.test.ts). The live
 * generator (runGenerateOutreachMessage) writes SPANISH unless it is told "en", and that language is market-keyed (us -> en, latam -> es). So under src/lib/sequences and the
 * sequence actions, the generator may be reached only through buildSequenceDraftInput, and only a file on the
 * allowlist below may call it. Shape follows tests/unit/argentinaDayBoundariesUsage.test.ts, including the fixture
 * proof that an offender is actually caught.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOTS = [join("src", "lib", "sequences"), join("src", "app", "(app)", "sequences")];

/** Files allowed to call the generator. Each must ALSO import buildSequenceDraftInput (checked below). */
const ALLOWED_GENERATOR_CALLERS = new Set<string>([join("src", "lib", "sequences", "draftQueries.ts")]);
/** The only file allowed to build prompt input or the prompt itself: it derives the language from the recipient market. */
const INPUT_BUILDER_FILE = join("src", "lib", "sequences", "draftInput.ts");

const CALLS_GENERATOR = /\brunGenerateOutreachMessage\b/;
const USES_BUILDER = /import\s*\{[^}]*\bbuildSequenceDraftInput\b[^}]*\}\s*from\s*["']@\/lib\/sequences\/draftInput["']/;
/**
 * `buildOutreachEmailPrompt` is listed on purpose even though nothing defines it any more: it was a second, never-called
 * email-prompt builder (`src/lib/outreach/emailPrompt.ts`, deleted 2026-10-23) that still carried the register and the
 * call length the owner had already replaced in the live prompt. Keeping the name here costs one alternative and catches
 * the resurrection: this is a word-boundary match on the SOURCE TEXT under the guarded roots, so sequence code that
 * references the name fails the test whether or not anything defines it. Do not "clean it up" because the symbol
 * resolves to nothing — that is exactly the state the guard is for.
 */
const BYPASSES_BUILDER = /\b(buildPersonMessageInput|buildOutreachMessagePrompt|buildOutreachEmailPrompt)\b/;

function files(root: string): string[] {
  try {
    return (readdirSync(root, { recursive: true }) as string[])
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .map((f) => join(root, f));
  } catch {
    return [];
  }
}

/** A doc comment that merely names the generator must not count as a call. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function scan(roots: string[], allowedCallers: Set<string>, builderFile: string): string[] {
  const offenders: string[] = [];
  for (const file of roots.flatMap(files)) {
    const text = stripComments(readFileSync(file, "utf8"));
    const callsGenerator = CALLS_GENERATOR.test(text);
    if (callsGenerator && (!allowedCallers.has(file) || !USES_BUILDER.test(text))) offenders.push(file);
    else if (file !== builderFile && BYPASSES_BUILDER.test(text)) offenders.push(file);
  }
  return offenders;
}

test("sequence code reaches the generator only through buildSequenceDraftInput", () => {
  const offenders = scan(ROOTS, ALLOWED_GENERATOR_CALLERS, INPUT_BUILDER_FILE);
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} call the live generator or build prompt input outside draftInput.ts. The live path writes ` +
      `Spanish unless language is "en"; go through buildSequenceDraftInput so the language is pinned in one place.`,
  );
});

test("the allowlisted caller really exists and really imports the builder", () => {
  for (const file of ALLOWED_GENERATOR_CALLERS) {
    const text = readFileSync(file, "utf8");
    assert.match(text, CALLS_GENERATOR, `${file} is on the allowlist but no longer calls the generator`);
    assert.match(text, USES_BUILDER, `${file} calls the generator without importing buildSequenceDraftInput`);
  }
});

test("fixture proof: an unlisted generator caller and a prompt-builder bypass are both caught", () => {
  // Fixtures live in os.tmpdir(), never under src/: other tests walk src/ in parallel processes.
  const root = mkdtempSync(join(tmpdir(), "sequence-draft-language-"));
  const caller = join(root, "caller.ts");
  const bypass = join(root, "bypass.ts");
  writeFileSync(
    caller,
    'import { runGenerateOutreachMessage } from "@/lib/outreach/generateMessage";\nexport const go = () => runGenerateOutreachMessage;\n',
  );
  writeFileSync(
    bypass,
    'import { buildPersonMessageInput } from "@/lib/outreach/personMessageInput";\nexport const x = buildPersonMessageInput;\n',
  );
  try {
    assert.deepEqual(scan([root], new Set(), INPUT_BUILDER_FILE).sort(), [bypass, caller].sort());
    // Allowlisted but not importing the builder is still an offender.
    assert.deepEqual(scan([root], new Set([caller]), INPUT_BUILDER_FILE).includes(caller), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
