// Usage: node shots.mjs  -> shots/states-closed.png and shots/states-admin-open.png
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
await page.goto(pathToFileURL(path.resolve("harness.html")).href);
await page.screenshot({ path: "shots/states-closed.png", fullPage: true });
await page.locator("details summary").first().click();
await page.screenshot({ path: "shots/states-admin-open.png", fullPage: true });
console.log("scrollWidth@1024", await page.evaluate(() => document.documentElement.scrollWidth));
await browser.close();
