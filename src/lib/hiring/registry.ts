import type { JobSource } from "./types";
import { leverSource } from "./lever";

export type AtsKey = "lever" | "workday" | "oracle_hcm";

/**
 * Adapter registry keyed by `target_company.ats`. Only `lever` is
 * implemented in this slice; `workday` and `oracle_hcm` are declared in
 * `AtsKey` (and expected by target_company.ats) but deliberately not
 * registered yet — sync.ts records that as a per-company sync_run error
 * rather than failing the whole run. Add an adapter file (see ./lever.ts
 * for the shape) and register it here — no other pipeline code changes.
 */
export const JOB_SOURCES: Partial<Record<AtsKey, JobSource>> = {
  lever: leverSource,
};
