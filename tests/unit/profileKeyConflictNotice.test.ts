import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileKeyConflictNotice } from "@/app/(app)/contacts/[id]/ProfileKeyConflictNotice";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";

// tsx compiles JSX with the classic runtime; components/icons.tsx has no React import (Next uses the automatic one).
(globalThis as { React?: unknown }).React = React;
const OWNER = { id: "22222222-2222-2222-2222-222222222222", name: "Marcus Reinhold" };

for (const [lang, dict] of [["es", es], ["en", en]] as const) {
  const labels = dict.contactRecord;
  const render = (isAdmin: boolean) => renderToStaticMarkup(createElement(ProfileKeyConflictNotice, { labels, owner: OWNER, isAdmin }));

  test(`${lang}: admin sees the owner link and the Duplicados link`, () => {
    const html = render(true);
    assert.ok(html.includes(`href="/contacts/${OWNER.id}"`));
    assert.ok(html.includes('href="/admin/duplicates"'));
  });

  test(`${lang}: non-admin sees the owner link, no Duplicados link, and is told to ask an admin`, () => {
    const html = render(false);
    assert.ok(html.includes(`href="/contacts/${OWNER.id}"`));
    assert.ok(!html.includes("/admin/duplicates"));
    const escaped = (s: string) => s.replace(/'/g, "&#x27;");
    assert.ok(html.includes(escaped(labels.errorProfileKeyTakenAskAdmin)));
    assert.ok(!html.includes(escaped(labels.errorProfileKeyTakenRest)));
  });

  test(`${lang}: the text sits in one inner div after the icon, with a br before the merge advice`, () => {
    const html = render(true);
    assert.ok(html.startsWith("<svg"));
    assert.equal(html.split("<div>").length - 1, 1);
    assert.ok(html.includes("<br/>"));
  });

  test(`${lang}: a holder already merged away links to the survivor and suggests no merge`, () => {
    const survivor = { id: "33333333-3333-3333-3333-333333333333", name: "Survivor Person" };
    for (const isAdmin of [true, false]) {
      const html = renderToStaticMarkup(
        createElement(ProfileKeyConflictNotice, { labels, owner: { ...OWNER, mergedInto: survivor }, isAdmin }),
      );
      assert.ok(html.includes(`href="/contacts/${survivor.id}"`));
      assert.ok(!html.includes(OWNER.id));
      assert.ok(!html.includes("/admin/duplicates"));
      assert.ok(!html.includes(labels.errorProfileKeyTakenNoAuto));
    }
  });

  test(`${lang}: both variants keep the no-auto-merge clause`, () => {
    for (const isAdmin of [true, false]) {
      assert.ok(render(isAdmin).includes(labels.errorProfileKeyTakenNoAuto));
    }
  });
}
