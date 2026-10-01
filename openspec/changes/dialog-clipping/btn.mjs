// Usage: node btn.mjs <label>  -> shots/<label>-buttons.png + effective colours and WCAG contrast per variant.
// Element opacity is blended over the white panel behind the buttons, so the "before" numbers
// reflect what the eye sees (computed `color` alone ignores `opacity`).
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const label = process.argv[2] ?? "run";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 160 } });
await page.goto(`${pathToFileURL(path.resolve("harness.html")).href}?btn=1`);
const rows = await page.evaluate(() => {
  const parse = (c) => c.match(/[\d.]+/g).map(Number);
  const lin = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const WHITE = [255, 255, 255];
  const mix = (c, a, under) => c.slice(0, 3).map((v, i) => v * a + under[i] * (1 - a));
  const out = [];
  for (const state of ["enabled", "disabled"]) {
    document.querySelectorAll(`#${state} .btn`).forEach((el) => {
      const cs = getComputedStyle(el);
      const op = Number(cs.opacity);
      const bgRaw = parse(cs.backgroundColor);
      const bgA = bgRaw.length === 4 ? bgRaw[3] : 1;
      const bgOpaque = mix(bgRaw, bgA, WHITE);
      const bg = mix(bgOpaque, op, WHITE);
      const fg = mix(mix(parse(cs.color), 1, bgOpaque), op, WHITE);
      const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      out.push({
        state,
        variant: el.className.split(" ")[1],
        opacity: op,
        bg: bg.map(Math.round).join(","),
        fg: fg.map(Math.round).join(","),
        ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2),
      });
    });
  }
  return out;
});
rows.forEach((r) => console.log(JSON.stringify({ label, ...r })));
await page.screenshot({ path: `shots/${label}-buttons.png` });
await browser.close();
