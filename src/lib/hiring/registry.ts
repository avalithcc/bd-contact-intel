import type { JobSource } from "./types";
import { leverSource } from "./lever";
import { greenhouseSource } from "./greenhouse";
import { ashbySource } from "./ashby";
import { smartRecruitersSource } from "./smartrecruiters";

export type AtsKey =
  | "lever"
  | "greenhouse"
  | "ashby"
  | "smartrecruiters"
  | "workday"
  | "oracle_hcm";

/**
 * Adapter registry keyed by `target_company.ats`. `lever`, `greenhouse`,
 * `ashby` and `smartrecruiters` are implemented; `workday` and
 * `oracle_hcm` are declared in `AtsKey` (and expected by
 * target_company.ats) but deliberately not registered yet — sync.ts
 * records that as a per-company sync_run error rather than failing the
 * whole run. Add an adapter file (see ./lever.ts for the shape) and
 * register it here — no other pipeline code changes.
 */
export const JOB_SOURCES: Partial<Record<AtsKey, JobSource>> = {
  lever: leverSource,
  greenhouse: greenhouseSource,
  ashby: ashbySource,
  smartrecruiters: smartRecruitersSource,
};
