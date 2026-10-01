// Confirms the conversation wrapper is itself the scroll container (ConversationDialog
// sets scrollTop = scrollHeight on it) and that only one scrollbar exists.
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 500 } });
await page.goto(`${pathToFileURL(path.resolve("harness.html")).href}?v=thread`);
console.log(
  await page.evaluate(() => {
    const t = document.getElementById("thread");
    t.scrollTop = t.scrollHeight;
    const b = document.querySelector(".dialog-body");
    return {
      innerScrollable: t.scrollHeight > t.clientHeight,
      innerAtBottom: Math.abs(t.scrollTop + t.clientHeight - t.scrollHeight) < 2,
      outerScrollable: b.scrollHeight > b.clientHeight,
    };
  }),
);
await browser.close();
