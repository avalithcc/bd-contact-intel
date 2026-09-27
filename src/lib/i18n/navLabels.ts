import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ClientStrings } from "@/lib/i18n/clientStrings";

// App shell Sidebar/TopBar are client components ("use client") — only
// plain strings may cross the server -> client boundary (same convention as
// src/lib/leads/labels.ts and src/lib/outreach/messageLabels.ts).
export type NavLabels = ClientStrings<Dictionary["nav"]>;

export function pickNavLabels(dict: Dictionary): NavLabels {
  return { ...dict.nav };
}
