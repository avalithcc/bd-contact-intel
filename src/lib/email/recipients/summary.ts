/**
 * How a sent or scheduled email lists its recipients on a card (redactar-email.html section 4): up to two names, then
 * "+N" for the rest, whose tooltip carries everyone with their emails. Pure.
 */
export interface RecipientLine {
  /** The names shown. */
  shown: string[];
  /** How many more there are ("+N"); 0 when everyone is shown. */
  more: number;
  /** Everyone, with emails when known, for the "+N" tooltip. */
  full: string;
}

export function summarizeRecipients(people: readonly { name: string; email?: string }[], maxNames = 2): RecipientLine {
  const label = (p: { name: string; email?: string }) => (p.name && p.email ? `${p.name} <${p.email}>` : p.name || p.email || "");
  const named = people.map((p) => ({ ...p, name: p.name || p.email || "" })).filter((p) => p.name);
  return {
    shown: named.slice(0, maxNames).map((p) => p.name),
    more: Math.max(0, named.length - maxNames),
    full: named.map(label).join(", "),
  };
}
