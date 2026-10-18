/**
 * Generates extension/icons/{16,32,48,128}.png with no dependency and no external asset: the CRM's accent
 * circle with a white "a." mark, drawn from a tiny pixel glyph and anti-aliased by supersampling.
 * Run with `npx tsx extension/scripts/makeIcons.ts`; the PNGs are committed, so this only matters to change them.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";

const ACCENT = [0xd5, 0x25, 0x2f] as const; // --color-accent in src/app/globals.css
const GLYPH = [
  ".###...",
  "....#..",
  ".####..",
  "#...#..",
  ".####.#",
]; // an "a" (5 wide), a gap and the dot: 7 columns by 5 rows
const SUPERSAMPLE = 4;

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Coverage (0..1) of the white mark at a sub-pixel position. */
function markAt(size: number, x: number, y: number): boolean {
  const cell = Math.max(1, Math.floor((size * 0.5) / GLYPH[0]!.length));
  const width = GLYPH[0]!.length * cell;
  const height = GLYPH.length * cell;
  const left = (size - width) / 2;
  const top = (size - height) / 2 + cell * 0.5;
  const col = Math.floor((x - left) / cell);
  const row = Math.floor((y - top) / cell);
  return row >= 0 && row < GLYPH.length && col >= 0 && col < GLYPH[0]!.length && GLYPH[row]![col] === "#";
}

function png(size: number): Buffer {
  const rows: Buffer[] = [];
  const radius = size / 2;
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let inside = 0;
      let mark = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = px + (sx + 0.5) / SUPERSAMPLE;
          const y = py + (sy + 0.5) / SUPERSAMPLE;
          if ((x - radius) ** 2 + (y - radius) ** 2 <= radius ** 2) {
            inside++;
            if (markAt(size, x, y)) mark++;
          }
        }
      }
      const total = SUPERSAMPLE * SUPERSAMPLE;
      const whiteShare = inside ? mark / inside : 0;
      const offset = 1 + px * 4;
      for (let channel = 0; channel < 3; channel++) row[offset + channel] = Math.round(ACCENT[channel]! * (1 - whiteShare) + 255 * whiteShare);
      row[offset + 3] = Math.round((inside / total) * 255);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(path.resolve(__dirname, `../icons/${size}.png`), png(size));
}
