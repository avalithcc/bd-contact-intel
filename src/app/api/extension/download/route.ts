import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { hasUsableSession } from "@/lib/auth/lightSession";
import { currentExtensionRelease } from "@/lib/extension/release";

export const dynamic = "force-dynamic";

/**
 * Serves the extension zip (crm-linkedin-v<version>.zip) that `npm run build` packed from the manifest version of
 * the same commit, so the file and the "versión nueva" comparison cannot disagree. Behind the middleware session
 * gate like every non-exempt route; re-checked here. The file is traced into the function via
 * `outputFileTracingIncludes` in next.config.mjs. A missing file is a 404, never a different version.
 */
export async function GET() {
  if (!(await hasUsableSession())) return new NextResponse(null, { status: 401 });
  const { fileName } = currentExtensionRelease();
  let body: Buffer;
  try {
    body = await readFile(path.join(process.cwd(), "extension", "zip", fileName));
  } catch {
    return new NextResponse("Extension archive not found. Run `npm run extension:zip` and redeploy.", { status: 404 });
  }
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
