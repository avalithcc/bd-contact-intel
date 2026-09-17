import type { JobSource } from "./types";
import { leverSource } from "./lever";
import { greenhouseSource } from "./greenhouse";
import { ashbySource } from "./ashby";
import { smartRecruitersSource } from "./smartrecruiters";
import { recruiteeSource } from "./recruitee";
import { teamtailorSource } from "./teamtailor";

export type AtsKey =
  | "lever"
  | "greenhouse"
  | "ashby"
  | "smartrecruiters"
  | "recruitee"
  | "teamtailor"
  | "workday"
  | "oracle_hcm";

/**
 * Adapter registry keyed by `target_company.ats`. `lever`, `greenhouse`,
 * `ashby`, `smartrecruiters`, `recruitee` and `teamtailor` are implemented
 * (these are also exactly the six vendors src/lib/hiring/discovery.ts
 * probes — discovery derives its probe list from `Object.keys(JOB_SOURCES)`
 * instead of keeping its own hardcoded vendor list, specifically so the two
 * can't drift apart again the way recruitee/teamtailor did here: discovery
 * grew probes for them well before a sync adapter existed, and approving
 * one of those boards produced a `No adapter registered for ats "..."`
 * sync_run error forever, since discovery had no way to know sync
 * lacked the adapter it just approved a board for).
 *
 * `workday` and `oracle_hcm` are declared in `AtsKey` (and expected by
 * target_company.ats) but deliberately not registered yet, and discovery
 * does not probe them — sync.ts records the missing adapter as a
 * per-company sync_run error rather than failing the whole run. Add an
 * adapter file (see ./lever.ts for the shape) and register it here to make
 * discovery start probing it too — no other pipeline code changes needed.
 */
export const JOB_SOURCES: Partial<Record<AtsKey, JobSource>> = {
  lever: leverSource,
  greenhouse: greenhouseSource,
  ashby: ashbySource,
  smartrecruiters: smartRecruitersSource,
  recruitee: recruiteeSource,
  teamtailor: teamtailorSource,
};
