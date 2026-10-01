// Usage (from this directory): node check.mjs <label>
// Prints Save-button visibility per viewport/variant and writes shots/<label>-<variant>-<height>.png
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const label = process.argv[2] ?? "run";
const file = pathToFileURL(path.resolve("harness.html")).href;
const browser = await chromium.launch();
for (const h of [900, 620, 500]) {
  for (const v of ["call", "thread"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: h } });
    await page.goto(`${file}?v=${v}`);
    const save = page.locator("#save");
    const box = await save.boundingBox();
    const inView = !!box && box.y >= 0 && box.y + box.height <= h;
    let clickable = false;
    try {
      await save.click({ timeout: 1500, trial: true });
      clickable = true;
    } catch {}
    const dialog = await page.locator(".dialog").boundingBox();
    const extra = await page.evaluate(() => ({
      docScroll: document.documentElement.scrollHeight > innerHeight,
      hdrTop: Math.round(document.querySelector(".dialog-header").getBoundingClientRect().top),
      bodyScrolls: (() => {
        const b = document.querySelector(".dialog-body");
        return b.scrollHeight > b.clientHeight;
      })(),
    }));
    console.log(
      JSON.stringify({
        label,
        v,
        h,
        saveBottom: box && Math.round(box.y + box.height),
        inView,
        clickable,
        dialogBottom: dialog && Math.round(dialog.y + dialog.height),
        ...extra,
      }),
    );
    await page.screenshot({ path: `shots/${label}-${v}-${h}.png` });
    await page.close();
  }
}
await browser.close();
