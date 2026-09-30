import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ClientStrings } from "@/lib/i18n/clientStrings";

// TopBar's header search is a client component — only plain strings may
// cross the server -> client boundary (same convention as navLabels.ts).
// Narrower than `NavLabels`: TopBar's search box needs exactly these four
// strings, not the whole `nav` slice, so a future formatter added to `nav`
// can never accidentally become reachable from here.
export type TopBarSearchLabels = ClientStrings<Dictionary["topBarSearch"]>;

export function pickTopBarSearchLabels(dict: Dictionary): TopBarSearchLabels {
  return { ...dict.topBarSearch };
}
