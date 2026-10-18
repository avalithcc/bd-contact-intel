/**
 * Builds the extension into extension/dist (Chrome Web Store variant) or extension/dist-dev (`--dev`: also
 * allows http://localhost:3000). Bundles with esbuild, copies the icons, writes the manifest and generates the
 * card stylesheet from the CRM's own CSS. Run with `npm run extension:build` / `npm run extension:build:dev`.
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractCardCss } from "./extractCardCss";
import { buildManifest, DEV_CRM_ORIGIN, STORE_CRM_ORIGIN } from "./manifest";

const dev = process.argv.includes("--dev");
const extensionRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(extensionRoot, "..");
const outDir = path.join(extensionRoot, dev ? "dist-dev" : "dist");

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, "icons"), { recursive: true });

  const cardCss = extractCardCss(
    readFileSync(path.join(repoRoot, "src/app/globals.css"), "utf8"),
    readFileSync(path.join(repoRoot, "src/app/design-system.css"), "utf8"),
  );

  await build({
    entryPoints: {
      background: path.join(extensionRoot, "src/background/worker.ts"),
      "content-linkedin": path.join(extensionRoot, "src/content/linkedin.ts"),
      "content-crm": path.join(extensionRoot, "src/content/crmMarker.ts"),
    },
    outdir: outDir,
    bundle: true,
    format: "iife",
    target: "chrome110",
    // Readable output on purpose: the store reviewer and the owner can read what ships.
    minify: false,
    legalComments: "none",
    define: {
      __CRM_ORIGIN__: JSON.stringify(dev ? DEV_CRM_ORIGIN : STORE_CRM_ORIGIN),
      __CARD_CSS__: JSON.stringify(cardCss),
    },
  });

  for (const size of [16, 32, 48, 128]) {
    copyFileSync(path.join(extensionRoot, `icons/${size}.png`), path.join(outDir, `icons/${size}.png`));
  }
  writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(buildManifest({ dev }), null, 2)}\n`);
  console.log(`Extension built in ${path.relative(repoRoot, outDir)} (${dev ? "development" : "store"} variant)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
