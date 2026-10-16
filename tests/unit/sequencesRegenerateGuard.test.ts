import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";
import { blocksEditedOverwrite, validConfirmations } from "@/lib/sequences/draftCompose";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RegenerateConfirmDialog } = require("@/app/(app)/sequences/_components/RegenerateConfirmDialog") as typeof import("@/app/(app)/sequences/_components/RegenerateConfirmDialog");

const T0 = Date.parse("2026-10-15T12:00:00Z");

// The server-side rule (draftQueries re-checks it inside the member-row lock): this is its pure decision.
test("an edited draft is overwritten only for the exact text the caller confirmed", () => {
  const at = new Date(T0);
  assert.equal(blocksEditedOverwrite("regenerate", null, at), true, "no confirmation: refused");
  assert.equal(blocksEditedOverwrite("regenerate", T0, at), false, "confirmed the text that is there");
  assert.equal(blocksEditedOverwrite("regenerate", T0 + 1000, at), false, "confirmed a later instant than stored: still that text");
  assert.equal(blocksEditedOverwrite("regenerate", T0 - 1000, at), true, "edited AFTER the BD saw it: refused again");
});

test("a malformed confirmation fails CLOSED: NaN, a string, undefined, Infinity and a negative number all block", () => {
  const at = new Date(T0);
  for (const bad of [Number.NaN, "999999999999999", undefined, Number.POSITIVE_INFINITY, -5, null, {}]) {
    assert.equal(blocksEditedOverwrite("regenerate", bad as never, at), true, String(bad));
  }
});

test("the action boundary drops every confirmation entry that is not a finite number", () => {
  assert.deepEqual(validConfirmations({ a: T0, b: Number.NaN, c: "12", d: Number.POSITIVE_INFINITY, e: null, f: undefined, g: -1 }), { a: T0, g: -1 });
  for (const junk of [null, undefined, "x", 5, [1, 2]]) assert.deepEqual(validConfirmations(junk), {}, String(junk));
});

test("an unedited draft and 'missing' mode are never blocked", () => {
  assert.equal(blocksEditedOverwrite("regenerate", null, null), false);
  assert.equal(blocksEditedOverwrite("regenerate", T0, null), false);
  assert.equal(blocksEditedOverwrite("missing", null, new Date(T0)), false);
});

const render = (ago: string, ownView = true, lang = es) =>
  renderToStaticMarkup(createElement(RegenerateConfirmDialog, { open: true, ago, ownView, labels: lang.sequences, onCancel: () => {}, onConfirm: () => {} }));

test("the confirmation says when the draft was edited and offers Cancelar / Regenerar igual", () => {
  const one = render("2 h");
  assert.ok(one.includes("Editaste este borrador hace 2 h") && one.includes("tu texto") && one.includes(es.sequences.regenConfirmCancel) && one.includes(es.sequences.regenConfirmAction));
  assert.ok(render("2 h", false).includes("el texto editado"));
  assert.ok(render("2 h", true, en).includes("You edited this draft 2 h ago"));
});
