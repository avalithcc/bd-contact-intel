/**
 * The request handling of /api/sequences/run, as a plain function over injected effects (the route is a three-line
 * shell that supplies the real runner). Kept apart from the route so the two things that must not regress are tested
 * with fakes: the auth gate, and the log.
 *
 * It deliberately imports neither the runner nor its ports: tests/unit/sequencesInert.test.ts names the route file as
 * the single place under src/app allowed to reach them.
 *
 * THE LOG IS PART OF THE CONTRACT. The runner only SIGNALS two things in its summary: `capped` (more steps were due than
 * one run looks at, so permanently held members may be crowding out newer sendable ones) and `lost` (claims lost to
 * another run or a changed row, which is benign once and a bug if it keeps climbing). Nothing else reads them, so a
 * handler that returned only `{ released }` would turn both back into silent failure. The whole summary is logged, at
 * warn level when either signal is present so it is findable without reading every run.
 */
import { isValidBearer } from "@/lib/cronAuth";
import type { RunSummary } from "./runSequenceRelease";

export type RunLog = (level: "info" | "warn" | "error", entry: Record<string, unknown>) => void;

export interface RunDeps {
  secret: string | undefined;
  run: () => Promise<RunSummary>;
  log: RunLog;
}

export async function handleRunRequest(request: Request, deps: RunDeps): Promise<Response> {
  if (!isValidBearer(request.headers.get("authorization"), deps.secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let summary: RunSummary;
  try {
    summary = await deps.run();
  } catch (error) {
    // The message goes to the server log only: it can carry connection details a caller must never see.
    deps.log("error", { event: "sequence_release_failed", error: error instanceof Error ? error.message : String(error) });
    return Response.json({ error: "Run failed" }, { status: 500 });
  }
  deps.log(summary.capped || summary.lost ? "warn" : "info", { event: "sequence_release_run", ...summary });
  return Response.json(summary, { status: 200 });
}
