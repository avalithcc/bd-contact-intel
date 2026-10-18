/** Messages from the content script to the service worker, and the worker's answers. */

/** The four basics read from the profile the BD is adding. Empty string = unreadable. */
export interface ProfileBasics {
  name: string;
  title: string;
  company: string;
  location: string;
}

export type WorkerRequest =
  | { type: "lookup"; profileUrl: string; force?: boolean }
  | { type: "open-view"; personId: string }
  | { type: "open-add"; profileUrl: string; basics: ProfileBasics }
  | { type: "open-login" };

export interface FoundPerson {
  kind: "found";
  personId: string;
  name: string;
  jobTitle: string | null;
  company: string | null;
  ownerName: string | null;
  lastActivity: { label: string; date: string } | null;
}

export type LookupResult =
  | FoundPerson
  | { kind: "not_found" }
  | { kind: "signed_out" }
  | { kind: "invalid" }
  | { kind: "error" };
