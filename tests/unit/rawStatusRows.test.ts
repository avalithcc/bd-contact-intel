import assert from "node:assert/strict";
import { test } from "node:test";
import { mapRawActivityRow, mapRawConnectionRow } from "@/lib/status/rawStatusRows";

const BA = "America/Argentina/Buenos_Aires";

function withTz<T>(tz: string, fn: () => T): T {
const prev = process.env.TZ;
process.env.TZ = tz;
try {
  return fn();
} finally {
  if (prev === undefined) delete process.env.TZ;
  else process.env.TZ = prev;
}
}

test("parses a naive (still-timestamp) connection string as UTC under a non-UTC TZ", () => {
  const row = withTz(BA, () =>
    mapRawConnectionRow({
      bd_id: "b",
      sent_count: "1",
      received_count: "2",
      last_message_at: "2026-09-25 13:30:00.123456",
      person_id: "p",
    }),
  );
  assert.equal(row.lastMessageAt?.toISOString(), "2026-09-25T13:30:00.123Z");
});

test("parses an offset-bearing activity string exactly under a non-UTC TZ", () => {
  const row = withTz(BA, () =>
    mapRawActivityRow({ id: "a", type: "note", created_at: "2026-09-25 13:30:00+00", metadata: null, person_id: "p" }),
  );
  assert.equal(row.createdAt.toISOString(), "2026-09-25T13:30:00.000Z");
});

test("keeps naive connection and offset activity values in the same ordering frame", () => {
  const [a, c] = withTz(BA, () => [
    mapRawActivityRow({ id: "a", type: "note", created_at: "2026-09-25 13:30:00+00", metadata: null, person_id: "p" }),
    mapRawConnectionRow({ bd_id: "b", sent_count: 0, received_count: 0, last_message_at: "2026-09-25 13:29:00", person_id: "p" }),
  ] as const);
  assert.ok(c.lastMessageAt!.getTime() < a.createdAt.getTime());
});

test("passes Date and null through and does not depend on call order", () => {
  const d = new Date("2026-01-01T00:00:00Z");
  const input = { bd_id: "b", sent_count: 1, received_count: 1, last_message_at: d, person_id: "p" };
  assert.equal(mapRawConnectionRow(input).lastMessageAt, d);
  assert.equal(mapRawConnectionRow({ ...input, last_message_at: null }).lastMessageAt, null);
  assert.deepEqual(mapRawConnectionRow(input), mapRawConnectionRow(input));
});
