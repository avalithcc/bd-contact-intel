/**
 * Turns a pure OutreachSignal (messageSignals.ts) into a display string for
 * the "Señales utilizadas" chips (mockups/contact-record.html #generate).
 * Takes localized templates from the caller (the i18n dictionaries — see
 * src/lib/i18n/dictionaries/es.ts) instead of hardcoding any language here,
 * same separation as messageSignals.ts itself (structured data, not copy).
 */
import type { OutreachSignal } from "@/lib/outreach/messageSignals";

export interface OutreachSignalLabels {
  hiring: (count: number) => string;
  leadership: string;
  repliedBefore: string;
  notesPresent: (count: number) => string;
  lastContact: (date: string) => string;
}

export function formatOutreachSignalLabel(signal: OutreachSignal, labels: OutreachSignalLabels): string {
  switch (signal.kind) {
    case "hiring":
      return labels.hiring(signal.count);
    case "leadership":
      return labels.leadership;
    case "repliedBefore":
      return labels.repliedBefore;
    case "notesPresent":
      return labels.notesPresent(signal.count);
    case "lastContact":
      return labels.lastContact(signal.date);
  }
}
