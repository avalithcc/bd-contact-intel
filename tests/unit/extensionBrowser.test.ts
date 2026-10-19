/**
 * The extension's two DOM-facing parts, run in a real browser (Playwright's Chromium, already a dev dependency
 * for the e2e suite): the profile reader against fixture HTML, and the card rendered with the real CRM-derived
 * stylesheet. Skipped, with the reason, when Chromium cannot be launched (for example on a machine without the
 * Playwright browsers); never skipped silently in CI because the browsers are installed there.
 *
 * The fixtures are SYNTHETIC (invented data, plausible shape): they prove the reader's logic and its "never
 * guess" rule, not that LinkedIn's live markup still matches the selectors.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { chromium, type Browser } from "@playwright/test";
import { extractCardCss } from "../../extension/build/extractCardCss";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const fixture = (name: string) => read(`tests/fixtures/linkedin/${name}`);

let browser: Browser | null = null;
let launchError: string | null = null;
let readerBundle = "";
let cardBundle = "";

before(async () => {
  try {
    browser = await chromium.launch();
  } catch (error) {
    launchError = error instanceof Error ? error.message.split("\n")[0]! : "chromium could not be launched";
  }
  const bundle = async (contents: string, define: Record<string, string> = {}) =>
    (await build({ stdin: { contents, resolveDir: root }, bundle: true, write: false, format: "iife", define })).outputFiles[0]!.text;
  readerBundle = await bundle(
    `import { readProfileBasics, readProfileBasicsWhenLoaded } from "./extension/src/content/profileReader"; window.__read = () => readProfileBasics(document); window.__readLoaded = (ms) => readProfileBasicsWhenLoaded(document, ms);`,
  );
  cardBundle = await bundle(
    `import { Card } from "./extension/src/content/card";
     import { buildCardView } from "./extension/src/content/viewModel";
     window.__clicks = [];
     const card = new Card({ onAction: (k) => window.__clicks.push(k), onCollapse: () => window.__clicks.push("collapse"), onExpand: () => window.__clicks.push("expand") });
     window.__render = (state, collapsed) => card.render(buildCardView(state), collapsed);
     window.__shadow = () => document.getElementById("crm-avalith-linkedin-card")?.shadowRoot ?? null;`,
    { __CARD_CSS__: JSON.stringify(extractCardCss(read("src/app/globals.css"), read("src/app/design-system.css"))) },
  );
});

after(async () => {
  await browser?.close();
});

async function readFixture(name: string) {
  return readHtml(fixture(name));
}

async function readHtml(html: string) {
  const page = await browser!.newPage();
  try {
    await page.setContent(html);
    await page.addScriptTag({ content: readerBundle });
    return await page.evaluate(() => (window as unknown as { __read(): unknown }).__read());
  } finally {
    await page.close();
  }
}

test("a full profile yields name, headline, current company and location from the open profile's top card only", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readFixture("profile-full.html"), {
    name: "Camila Herrera",
    title: "Directora de Producto",
    company: "Despegar",
    location: "Buenos Aires, Argentina",
  });
});

test("a partial profile leaves the unreadable fields empty and keeps the credential for the CRM name rule", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readFixture("profile-partial.html"), {
    name: "Ana Pérez, MBA",
    title: "Consultora independiente",
    company: "",
    location: "",
  });
});

test("markup the selectors do not know reads as empty, never guessed", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readFixture("profile-unreadable.html"), { name: "", title: "", company: "", location: "" });
});

const LUCIA = {
  name: "Lucía Fernández",
  title: "Head of Growth at Andes Labs",
  company: "Andes Labs",
  location: "Córdoba, Argentina",
};

test("the new layout reads the top card by componentkey and never the sponsored ad in the aside", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readFixture("profile-new-layout.html"), LUCIA);
});

test("the new layout with English markers reads the same", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readFixture("profile-new-layout-english.html"), LUCIA);
});

test("a single company/school button leaves the company empty", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readFixture("profile-new-layout-one-button.html"), { ...LUCIA, company: "" });
});

test("without a top card only the name is read, from the title", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readFixture("profile-new-layout-no-topcard.html"), {
    name: "Lucía Fernández",
    title: "",
    company: "",
    location: "",
  });
});

const LINK = '<a href="https://www.linkedin.com/in/ana/overlay/contact-info/">Información de contacto</a>';
const EMPTY = { name: "Ana", title: "", company: "", location: "" };

test("a contact-info ancestor walk never lands on main or a container holding the aside", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  const html = `<html><head><title>Ana | LinkedIn</title></head><body><main><div componentkey="x:nothing"><p>Ana</p>${LINK}</div><aside><h2>Ads</h2><p>Promo</p></aside></main></body></html>`;
  assert.deepEqual(await readHtml(html), EMPTY);
});

const card = (inner: string) =>
  `<html><head><title>Ana | LinkedIn</title></head><body><main><div componentkey="x:Topcard">${inner}</div></main></body></html>`;
const button = (label: string) => `<div role="button"><figure aria-hidden="true"></figure><p><span>${label}</span></p></div>`;

test("a school button is never read as the location when the profile shows none", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  const html = card(`<h2>Ana</h2><p>Consultora</p><p>UBA</p><div>${LINK}</div>${button("UBA")}`);
  assert.deepEqual(await readHtml(html), { ...EMPTY, title: "Consultora" });
});

test("a profile photo button does not count in the company/school pair", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  const html = card(`${button("Foto de perfil de Ana")}<h2>Ana</h2><p>Consultora</p><div>${LINK}</div>${button("UBA")}`);
  assert.deepEqual(await readHtml(html), { ...EMPTY, title: "Consultora" });
});

test("a parenthesised pronoun note is not the headline", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  const html = card(`<h2>Ana</h2><p>(ella)</p><p>Consultora</p><div>${LINK}</div>`);
  assert.deepEqual(await readHtml(html), { ...EMPTY, title: "Consultora" });
});

const NIMBUS = { ...LUCIA, title: "Co-Founder & CEO", company: "Nimbus Labs" };
const QUANTA = { ...LUCIA, title: "Head of Data", company: "Quanta Works" };

test("the current role of a multi-role company is read from the first Experience item", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readFixture("profile-experience-multi-role.html"), NIMBUS);
});

test("a current single-role item gives title and company without the employment type", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readFixture("profile-experience-single-role.html"), QUANTA);
});

test("English Experience markers (Present, Full-time) read the same", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readFixture("profile-experience-english.html"), QUANTA);
});

test("a past first role falls back to the top card", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readFixture("profile-experience-past-role.html"), LUCIA);
});

test("a description under a past role that mentions Present does not make it current", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  const html = fixture("profile-experience-multi-role.html")
    .replace("<p>Actualidad</p>", "<p>ene. de 2023 - actualidad (proyecto paralelo)</p>")
    .replace("ene. de 2026 - actualidad · 10 meses", "ene. de 2024 - dic. de 2025 · 2 años");
  assert.deepEqual(await readHtml(html), LUCIA);
});

async function readLoaded(html: string, insertAfterMs: number | null, waitMs: number) {
  const page = await browser!.newPage();
  try {
    await page.setContent(html);
    await page.addScriptTag({ content: readerBundle });
    if (insertAfterMs !== null) {
      const section = /<section[\s\S]*<\/section>/.exec(fixture("profile-experience-single-role.html"))![0];
      await page.evaluate(
        ([markup, delay]) => {
          setTimeout(() => {
            document.querySelector('[componentkey^="profileCardsExperienceOnly"]')!.insertAdjacentHTML("beforeend", markup);
          }, delay);
        },
        [section, insertAfterMs] as const,
      );
    }
    return await page.evaluate((ms) => (window as unknown as { __readLoaded(ms: number): Promise<unknown> }).__readLoaded(ms), waitMs);
  } finally {
    await page.close();
  }
}

test("a lazy Experience skeleton is waited for and then read", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readLoaded(fixture("profile-experience-skeleton.html"), 300, 3000), QUANTA);
});

test("a scrollIntoView that throws does not stop the wait for the section", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  const html = fixture("profile-experience-skeleton.html").replace(
    "</head>",
    "<script>Element.prototype.scrollIntoView = function () { throw new Error('boom'); };</script></head>",
  );
  assert.deepEqual(await readLoaded(html, 300, 3000), QUANTA);
});

test("when the Experience section never loads, the top card answers after the timeout", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  assert.deepEqual(await readLoaded(fixture("profile-experience-skeleton.html"), null, 400), LUCIA);
});

test("the card renders every state with the CRM's tokens and wires its buttons", async (t) => {
  if (!browser) return t.skip(launchError ?? "no browser");
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.setContent("<!doctype html><html><body><p>LinkedIn</p></body></html>");
    await page.evaluate(() => {
      // Test only: open the shadow root so it can be inspected.
      const original = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (init) {
        return original.call(this, { ...init, mode: "open" });
      };
    });
    await page.addScriptTag({ content: cardBundle });
    type H = { __render(state: unknown, collapsed: boolean): void; __shadow(): ShadowRoot | null; __clicks: string[] };
    const text = () => page.evaluate(() => (window as unknown as H).__shadow()?.textContent ?? "");
    const render = (state: unknown, collapsed = false) =>
      page.evaluate(([s, c]) => (window as unknown as H).__render(s, c as boolean), [state, collapsed] as const);

    await render({ kind: "loading" });
    assert.match(await text(), /Buscando en el CRM…/);
    assert.equal(await page.evaluate(() => (window as unknown as H).__shadow()!.querySelector(".xcard")!.getAttribute("aria-busy")), "true");

    await render({
      kind: "found",
      personId: "0b8e1f10-0000-4000-8000-000000000001",
      name: "Valentina Rojas",
      jobTitle: "VP de Ingeniería",
      company: "Mercado Libre",
      ownerName: "Ana Pereyra",
      lastActivity: { label: "Llamada", date: "2026-10-15T14:00:00.000Z" },
    });
    const found = await text();
    for (const expected of ["En el CRM", "Valentina Rojas", "VP de Ingeniería · Mercado Libre", "Ana Pereyra", "15 oct 2026 · Llamada", "Ver en el CRM"]) {
      assert.ok(found.includes(expected), `found state shows "${expected}"`);
    }
    const background = await page.evaluate(
      () => getComputedStyle((window as unknown as H).__shadow()!.querySelector(".btn-primary")!).backgroundColor,
    );
    assert.equal(background, "rgb(213, 37, 47)", "the primary button resolves --color-accent from the CRM tokens");
    await page.evaluate(() => (window as unknown as H).__shadow()!.querySelector<HTMLButtonElement>(".btn-primary")!.click());

    await render({ kind: "not_found" });
    assert.ok((await text()).includes("Agregar al CRM"));
    await page.evaluate(() => (window as unknown as H).__shadow()!.querySelector<HTMLButtonElement>(".btn-primary")!.click());

    await render({ kind: "signed_out" });
    assert.ok((await text()).includes("Inicia sesión en el CRM para ver si esta persona ya existe."));
    await render({ kind: "error" });
    assert.ok((await text()).includes("Reintentar"));
    await page.evaluate(() => (window as unknown as H).__shadow()!.querySelector<HTMLButtonElement>(".btn-secondary")!.click());

    await render({ kind: "not_found" }, true);
    const pill = await page.evaluate(() => {
      const el = (window as unknown as H).__shadow()!.querySelector(".xpill")!;
      return { label: el.getAttribute("aria-label"), expanded: el.getAttribute("aria-expanded") };
    });
    assert.deepEqual(pill, { label: "Abrir tarjeta del CRM: esta persona no está en el CRM", expanded: "false" });
    await page.evaluate(() => (window as unknown as H).__shadow()!.querySelector<HTMLButtonElement>(".xpill")!.click());

    assert.deepEqual(await page.evaluate(() => (window as unknown as H).__clicks), ["found", "not_found", "error", "expand"]);
  } finally {
    await page.close();
  }
});
