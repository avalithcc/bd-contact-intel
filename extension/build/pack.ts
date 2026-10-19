/**
 * Packs the store build (extension/dist) into extension/zip/crm-linkedin-v<version>.zip, the file the CRM
 * serves from Cuenta. Runs inside `npm run build` (after `extension:build`), so a Vercel deploy always ships
 * the zip of the manifest version in the same commit. Any inconsistency throws: a broken download must fail the
 * build, never reach a BD.
 *
 * Run with `npm run extension:pack` (needs `npm run extension:build` first).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EXTENSION_VERSION, extensionZipName } from "./manifest";
import { createZip, type ZipFile } from "./zip";

/** The single folder at the top of the archive: "Load unpacked" is pointed at it after unzipping. */
export const ZIP_ROOT_FOLDER = "crm-linkedin";

export { extensionZipName };

const REQUIRED_FILES = ["manifest.json", "background.js", "content-linkedin.js", "content-crm.js"] as const;

function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry}` : entry;
      return statSync(path.join(dir, entry)).isDirectory() ? listFiles(path.join(dir, entry), relative) : [relative];
    });
}

/** Throws unless `distDir` is a complete store build of the current manifest version. */
export function assertDistComplete(distDir: string): void {
  let present: string[];
  try {
    present = listFiles(distDir);
  } catch {
    throw new Error(`Extension build not found at ${distDir}. Run "npm run extension:build" first.`);
  }
  for (const required of REQUIRED_FILES) {
    if (!present.includes(required)) throw new Error(`Extension build is missing ${required} (${distDir}).`);
  }
  const manifest = JSON.parse(readFileSync(path.join(distDir, "manifest.json"), "utf8")) as {
    version?: string;
    host_permissions?: string[];
  };
  if (manifest.version !== EXTENSION_VERSION) {
    throw new Error(`Extension build has version ${manifest.version}, expected ${EXTENSION_VERSION}. Rebuild it.`);
  }
  if ((manifest.host_permissions ?? []).some((permission) => permission.includes("localhost"))) {
    throw new Error("Extension build is the development variant (localhost host permission). Never ship it.");
  }
}

/** Writes the archive into `outDir` (replacing older archives) and returns its path. */
export function packExtension({ distDir, outDir }: { distDir: string; outDir: string }): string {
  assertDistComplete(distDir);
  const files: ZipFile[] = listFiles(distDir).map((relative) => ({
    name: `${ZIP_ROOT_FOLDER}/${relative}`,
    data: readFileSync(path.join(distDir, relative)),
  }));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, extensionZipName(EXTENSION_VERSION));
  writeFileSync(target, createZip(files));
  return target;
}

if (require.main === module) {
  const extensionRoot = path.resolve(__dirname, "..");
  try {
    const target = packExtension({ distDir: path.join(extensionRoot, "dist"), outDir: path.join(extensionRoot, "zip") });
    console.log(`Extension packed: ${path.relative(path.resolve(extensionRoot, ".."), target)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
