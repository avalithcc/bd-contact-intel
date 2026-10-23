import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SubmitButton, SubmitButtonView, resolveSubmitState } = require("@/components/forms/SubmitButton") as typeof import("@/components/forms/SubmitButton");

test("pending: disabled, busy flags, spinner and the pending label", () => {
  assert.deepEqual(resolveSubmitState(true, false, "Fusionar", "Fusionando…"), {
    disabled: true,
    ariaBusy: "true",
    dataBusy: "true",
    showSpinner: true,
    label: "Fusionando…",
  });
});

test("idle: enabled, no busy flags, no spinner and the idle label", () => {
  assert.deepEqual(resolveSubmitState(false, false, "Fusionar", "Fusionando…"), {
    disabled: false,
    ariaBusy: undefined,
    dataBusy: undefined,
    showSpinner: false,
    label: "Fusionar",
  });
});

test("the caller's disabled survives both states", () => {
  assert.equal(resolveSubmitState(false, true, "a", "b").disabled, true);
  assert.equal(resolveSubmitState(true, true, "a", "b").disabled, true);
});

test("icon-only: pending has no label (the spinner replaces the content)", () => {
  const s = resolveSubmitState(true, false, "×", undefined);
  assert.equal(s.showSpinner, true);
  assert.equal(s.label, undefined);
});

test("idle markup is a plain submit button that keeps className, aria-label and disabled", () => {
  assert.equal(
    renderToStaticMarkup(createElement(SubmitButton, { className: "btn", pendingLabel: "Fusionando…", children: "Fusionar" })),
    '<button type="submit" class="btn">Fusionar</button>',
  );
  assert.equal(
    renderToStaticMarkup(createElement(SubmitButton, { className: "x", ariaLabel: "Eliminar vista", disabled: true, children: "×" })),
    '<button type="submit" class="x" disabled="" aria-label="Eliminar vista">×</button>',
  );
});

test("pending markup: busy flags, disabled, spinner before the pending label", () => {
  assert.equal(
    renderToStaticMarkup(createElement(SubmitButtonView, { pending: true, className: "btn", pendingLabel: "Fusionando…", children: "Fusionar" })),
    '<button type="submit" class="btn" disabled="" aria-busy="true" data-busy="true"><span class="spinner" aria-hidden="true"></span>Fusionando…</button>',
  );
});

test("pending icon-only markup: the spinner replaces the icon and the aria-label stays", () => {
  assert.equal(
    renderToStaticMarkup(createElement(SubmitButtonView, { pending: true, className: "x", ariaLabel: "Eliminar vista", children: "×" })),
    '<button type="submit" class="x" disabled="" aria-label="Eliminar vista" aria-busy="true" data-busy="true"><span class="spinner" aria-hidden="true"></span></button>',
  );
});

// Type-level cases (checked by `tsc --noEmit`, which includes tests/): a text button must keep an accessible name while pending.
void (() => {
  createElement(SubmitButton, { pendingLabel: "Fusionando…", children: "Fusionar" });
  createElement(SubmitButton, { ariaLabel: "Eliminar vista", children: "×" });
  // @ts-expect-error neither pendingLabel nor ariaLabel: the pending button would have no accessible name
  createElement(SubmitButton, { children: "Fusionar" });
});

/**
 * `useFormStatus` always reports idle off a real form, so the connection between the hook and the button is proven
 * by swapping the function on react-dom's CommonJS exports (SubmitButton reads it at call time) and rendering the
 * real SubmitButton, not the view.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reactDom = require("react-dom") as { useFormStatus: () => { pending: boolean } };

test("SubmitButton takes pending from useFormStatus: spinner, pending label, disabled and aria-busy", () => {
  const real = reactDom.useFormStatus;
  reactDom.useFormStatus = () => ({ pending: true });
  try {
    assert.equal(
      renderToStaticMarkup(createElement(SubmitButton, { className: "btn", pendingLabel: "Fusionando…", children: "Fusionar" })),
      '<button type="submit" class="btn" disabled="" aria-busy="true" data-busy="true"><span class="spinner" aria-hidden="true"></span>Fusionando…</button>',
    );
  } finally {
    reactDom.useFormStatus = real;
  }
});

test("SubmitButton forwards formAction to the button (Crear tarea must not fall through to the form's action)", () => {
  const withAction = renderToStaticMarkup(createElement(SubmitButton, { pendingLabel: "x", formAction: async () => {}, children: "Go" }));
  const without = renderToStaticMarkup(createElement(SubmitButton, { pendingLabel: "x", children: "Go" }));
  assert.match(withAction, /\bformAction=/i);
  assert.doesNotMatch(without, /\bformAction=/i);
});

/**
 * A spinner nobody can see is not feedback. The generic `.spinner` paints its top with --color-accent, and every
 * button that is not a design-system `.btn` keeps a filled background in the SAME red family (#d5252f on #d5252f
 * for `.filter-submit`), so the ring vanished on four of the converted buttons — worst on the saved-view delete
 * "×", which is icon-only and has no gerund label to fall back on. The fix is the recipe `.btn .spinner` already
 * uses: the button's own text colour. Pinned here because it is a one-rule fix that reads like dead CSS.
 */
test("a spinner inside a non-.btn button takes the button's own text colour", () => {
  const css = readFileSync(join("src", "app", "globals.css"), "utf8");
  const rule = css.match(/button:not\(\.btn\)\s+\.spinner\s*\{[^}]*\}/)?.[0];
  assert.ok(rule, "globals.css lost the non-.btn spinner rule: the ring is invisible on accent/danger fills");
  assert.match(rule, /border-color:\s*currentColor/);
  assert.match(rule, /border-right-color:\s*transparent/);
  // The pairing is deliberate: the generic ring is the thing being overridden, so it must still be accent-topped.
  assert.match(css, /\.spinner\s*\{[^}]*border-top-color:\s*var\(--color-accent\)/);
});
