/**
 * Derives the two-letter initials shown in the shell TopBar account menu
 * trigger avatar (tasks.md mockup-parity 3.2; design-system.html "Menú de
 * cuenta"). Pure so it can be unit-tested without a BD row or Supabase
 * session — see tests/unit/initials.test.ts.
 */
export function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return (words[0][0] + words[1][0]).toUpperCase();
}
