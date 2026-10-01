// Usage: node btn.mjs <label>  -> shots/<label>.png + effective colours and WCAG contrast per variant.
// Element opacity is blended over the white panel behind the controls, so "before" numbers reflect
// what the eye sees (computed `color` alone ignores `opacity`). Contrast is label vs its own background;
// when the control has no background the panel (white) is used.
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const label = process.argv[2] ?? "run";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 220 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.resolve("harness.html")).href);
const rows = await page.evaluate(() => {
  const parse = (c) => c.match(/[\d.]+/g).map(Number);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const WHITE = [255, 255, 255];
  const mix = (c, a, under) => c.slice(0, 3).map((v, i) => v * a + under[i] * (1 - a));
  const out = [];
  for (const state of ["enabled", "disabled"]) {
    document.querySelectorAll(`#${state} [data-v]`).forEach((wrap) => {
      const el = wrap.querySelector("button, input, span.secondary-btn, span.rowlink");
      const icon = wrap.querySelector(".qa-icon");
      const cs = getComputedStyle(el);
      const op = Number(cs.opacity);
      const bgRaw = parse(cs.backgroundColor);
      const bgA = bgRaw.length === 4 ? bgRaw[3] : 1;
      const bgOpaque = mix(bgRaw, bgA, WHITE);
      const bg = mix(bgOpaque, op, WHITE);
      const fg = mix(mix(parse(cs.color), 1, bgOpaque), op, WHITE);
      const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      out.push({
        state, variant: wrap.dataset.v, opacity: op,
        bg: bg.map(Math.round).join(","), fg: fg.map(Math.round).join(","),
        border: cs.borderTopColor + " " + cs.borderTopWidth, cursor: cs.cursor,
        icon: icon ? (() => { const i = getComputedStyle(icon); return `${i.backgroundColor} | ${i.color} | ${i.borderTopColor}`; })() : undefined,
        ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2),
      });
    });
  }
  return out;
});
rows.forEach((r) => console.log(JSON.stringify({ label, ...r })));
await page.screenshot({ path: `shots/${label}.png` });
// Hover pass on the disabled row: move the real mouse over each control and read what it computes.
// `reach` = the control itself is the hit target (so cursor and title tooltip can show).
const names = await page.$$eval("#disabled [data-v]", (els) => els.map((e) => e.dataset.v));
for (const name of names) {
  const wrap = page.locator(`#disabled [data-v="${name}"]`);
  const box = await wrap.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const r = await wrap.evaluate((w) => {
    const el = w.querySelector("button, input, span.secondary-btn, span.rowlink");
    const cs = getComputedStyle(el);
    const ic = w.querySelector(".qa-icon");
    const hit = document.elementFromPoint(...(() => { const b = w.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })());
    return { hoverBg: cs.backgroundColor, hoverColor: cs.color, hoverBorder: cs.borderTopColor,
      hoverIcon: ic ? `${getComputedStyle(ic).backgroundColor} | ${getComputedStyle(ic).color}` : undefined,
      reach: el === hit || el.contains(hit) };
  });
  console.log(JSON.stringify({ label, hover: name, ...r }));
}
await page.mouse.move(0, 0);
await page.screenshot({ path: `shots/${label}.png` });
const hv = page.locator('#disabled [data-v="qa"]');
const hb = await hv.boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.screenshot({ path: `shots/${label}-qa-hover.png`, clip: { x: hb.x - 20, y: hb.y - 20, width: hb.width + 40, height: hb.height + 40 } });
await browser.close();
