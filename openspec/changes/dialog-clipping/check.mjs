// Usage (from this directory): node check.mjs <label> [css=old] [mode=inline]
// Reports, per viewport height and body scroll position, how much of the results list is visible.
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const label = process.argv[2] ?? "run";
const extra = process.argv.slice(3).join("&");
const file = pathToFileURL(path.resolve("harness.html")).href;
const browser = await chromium.launch();
for (const h of [900, 620, 500]) {
  for (const pos of ["top", "list", "reveal"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: h } });
    await page.goto(`${file}?${extra}`);
    const m = await page.evaluate((pos) => {
      const body = document.querySelector(".dialog-body");
      const wrap = document.getElementById("wrap");
      // "list": scroll the body so the search input sits at the top of the visible area
      if (pos === "list") body.scrollTop = wrap.offsetTop - 8;
      if (pos === "reveal") document.getElementById("list").scrollIntoView({ block: "nearest" });
      const b = body.getBoundingClientRect();
      const l = document.getElementById("list").getBoundingClientRect();
      const f = document.querySelector(".dialog-footer").getBoundingClientRect();
      return {
        listTop: Math.round(l.top), listBottom: Math.round(l.bottom),
        bodyTop: Math.round(b.top), bodyBottom: Math.round(b.bottom), footerTop: Math.round(f.top),
        clippedPx: Math.max(0, Math.round(l.bottom - b.bottom)),
        overhangsFooter: l.bottom > f.top,
        bodyScrollTop: Math.round(body.scrollTop), bodyScrollH: body.scrollHeight, bodyClientH: body.clientHeight,
        maxScrollTop: body.scrollHeight - body.clientHeight,
      };
    }, pos);
    console.log(JSON.stringify({ label, h, pos, ...m }));
    await page.screenshot({ path: `shots/${label}-${pos}-${h}.png` });
    await page.close();
  }
}
await browser.close();
