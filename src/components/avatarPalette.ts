/**
 * Deterministic avatar palette selection (tasks.md mockup-parity 2.1).
 * Maps a stable id (contact id, BD id) to one of the 6 palette classes
 * defined in globals.css / mockups/styles.css (`--avatar-1`..`--avatar-6`,
 * consumed via the `.a1`..`.a6` classes) so a given person's avatar color
 * never changes between renders or across the app.
 *
 * Not cryptographic — a simple, fast string hash is enough since the only
 * requirement is "same id -> same class" and "different ids spread across
 * the 6 buckets", not uniform statistical distribution.
 */
const PALETTE_SIZE = 6;

export type AvatarPaletteClass = "a1" | "a2" | "a3" | "a4" | "a5" | "a6";

export function avatarPaletteClass(id: string): AvatarPaletteClass {
  if (!id) {
    throw new TypeError("avatarPaletteClass requires a non-empty stable id");
  }

  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }

  const bucket = Math.abs(hash) % PALETTE_SIZE;
  return `a${bucket + 1}` as AvatarPaletteClass;
}
