import fs from 'fs';
import path from 'path';
import { parseEnv } from 'util';

/**
 * Parse dotenv files from `root`, one entry per name in the given order; a
 * missing file is an empty object. Shared by both Playwright configs so they
 * read dotenv files the same way. Pair with mergeDotenv() (first wins).
 */
export function readDotenvFiles(root: string, names: readonly string[]): Array<Record<string, string | undefined>> {
  return names.map((name) => {
    const file = path.join(root, name);
    return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
  });
}
