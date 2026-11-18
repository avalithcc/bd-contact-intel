import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { es } from "@/lib/i18n/dictionaries/es";

(globalThis as { React?: unknown }).React = React;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TasksPageHeader } = require("@/app/(app)/tasks/TasksPageHeader") as typeof import("@/app/(app)/tasks/TasksPageHeader");

test("the tasks header renders the mockup structure: page-header, titles, eyebrow, h1 with dot, meta", () => {
  const l = es.tasksPage;
  const html = renderToStaticMarkup(
    createElement(TasksPageHeader, { eyebrow: l.eyebrow, title: l.title, subtitle: l.subtitle, actions: createElement("a", { className: "btn" }, l.newTask) }),
  );
  assert.ok(html.startsWith('<div class="page-header"><div class="titles">'));
  assert.ok(html.includes('<div class="eyebrow">Tareas</div>'));
  assert.ok(html.includes('<h1>tareas<span class="dot">.</span></h1>'));
  assert.ok(html.includes('<p class="meta">Toda tarea pertenece a un contacto o una empresa.</p>'));
  assert.ok(html.includes('<div class="actions"><a class="btn">Nueva tarea</a></div>'));
});
