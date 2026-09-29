/**
 * Pure temporary-password generator for scripts/reset-bd-password.ts. No DB,
 * no Supabase — just character selection, injected via `randomInt` so tests
 * never depend on real randomness (see tests/unit/tempPassword.test.ts).
 *
 * Alphabet deliberately excludes visually ambiguous characters (0/O, 1/l/I)
 * so a BD copying the printed password by hand or over a call never
 * mistypes it. Every generated password is guaranteed to contain at least
 * one uppercase letter, one lowercase letter, one digit and one symbol, and
 * is always at least TEMP_PASSWORD_MIN_LENGTH characters — comfortably above
 * the app's own new-password minimum (see src/lib/auth/passwordPolicy.ts,
 * MIN_NEW_PASSWORD_LENGTH). Note this generator is only used for the
 * TEMPORARY password an owner sets via scripts/reset-bd-password.ts; the BD
 * signs in with it as their *current* password and immediately picks a new
 * one at /account/password, so this length only needs to satisfy Supabase's
 * own minimum, not MIN_NEW_PASSWORD_LENGTH.
 */
import { randomInt as nodeRandomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+";

export const TEMP_PASSWORD_ALPHABET = UPPER + LOWER + DIGITS + SYMBOLS;
export const TEMP_PASSWORD_MIN_LENGTH = 16;
const DEFAULT_LENGTH = 20;

const REQUIRED_CLASSES = [UPPER, LOWER, DIGITS, SYMBOLS] as const;

export type RandomIntSource = (max: number) => number;

export interface TempPasswordOptions {
  /** Total password length. Must be >= TEMP_PASSWORD_MIN_LENGTH. */
  length?: number;
  /**
   * Returns a uniformly random integer in [0, max). Defaults to
   * `node:crypto`'s `randomInt`. Inject a fake in tests for deterministic
   * output.
   */
  randomInt?: RandomIntSource;
}

function pick(alphabet: string, randomInt: RandomIntSource): string {
  return alphabet[randomInt(alphabet.length)]!;
}

/** Fisher-Yates shuffle, driven entirely by the injected random source. */
function shuffle(chars: string[], randomInt: RandomIntSource): void {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }
}

export function generateTempPassword(options: TempPasswordOptions = {}): string {
  const length = options.length ?? DEFAULT_LENGTH;
  if (length < TEMP_PASSWORD_MIN_LENGTH) {
    throw new Error(
      `Temporary password length must be at least ${TEMP_PASSWORD_MIN_LENGTH}, got ${length}.`,
    );
  }
  const randomInt = options.randomInt ?? nodeRandomInt;

  const chars = REQUIRED_CLASSES.map((alphabet) => pick(alphabet, randomInt));
  for (let i = chars.length; i < length; i++) {
    chars.push(pick(TEMP_PASSWORD_ALPHABET, randomInt));
  }
  shuffle(chars, randomInt);
  return chars.join("");
}
