/**
 * Unit tests for src/lib/identity/ingestWrite.ts — the write-cutover wiring
 * (task 4B.3/4B.4; design.md D11/D14; contact-identity spec "Live ingestion
 * resolves identity at write time"). Everything here is pure/fake-level: no
 * database. The concurrency test (4B.4) simulates two "concurrent" chunks
 * sequentially against a shared fake person store that enforces the same
 * `profile_key` uniqueness + `ON CONFLICT DO NOTHING` semantics
 * applyIdentityWrites relies on — a real-DB concurrency test isn't possible
 * in this unit-test environment; see tasks.md 4B.4 for the owner/staging
 * verification note.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contactRowsToIdentityRows,
  leadRowsToIdentityRows,
  runIdentityCutoverChunk,
  type InsertedContactRow,
  type InsertedLeadRow,
} from "@/lib/identity/ingestWrite";
import {
  buildIdentityWriteRows,
  buildPrefetchKeys,
  planIdentityWrites,
  repointIdentityWriteRows,
  type ExistingPersonCandidate,
  type IdentityWritePlan,
  type PrefetchedIdentityIndex,
} from "@/lib/identity/resolve";

function contactRow(overrides: Partial<InsertedContactRow> = {}): InsertedContactRow {
  return {
    id: "contact-1",
    bdId: "bd-1",
    profileKey: "https://www.linkedin.com/in/jane-doe/",
    firstName: "Jane",
    lastName: "Doe",
    company: "Acme",
    companyKey: null,
    position: "CTO",
    industry: null,
    connectedOn: "2024-01-01",
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    ...overrides,
  };
}

function leadRow(overrides: Partial<InsertedLeadRow> = {}): InsertedLeadRow {
  return {
    id: "lead-1",
    ownerBdId: "bd-1",
    firstName: "John",
    lastName: "Smith",
    companyDisplay: "Beta Inc",
    companyRaw: "Beta Inc.",
    companyKey: null,
    jobTitle: "VP",
    industryGroup: "Tech",
    industryRaw: null,
    email: null,
    emailStatus: "none",
    emailConfidence: null,
    emailSource: null,
    ...overrides,
  };
}

test("contactRowsToIdentityRows: normalizes profileKey and maps legacy fields", () => {
  const [row] = contactRowsToIdentityRows([contactRow()]);
  assert.equal(row.legacyTable, "contact");
  assert.equal(row.legacyId, "contact-1");
  assert.equal(row.bdId, "bd-1");
  assert.equal(row.profileKey, "linkedin.com/in/jane-doe");
  assert.equal(row.jobTitle, "CTO");
});

test("leadRowsToIdentityRows: drops leads with no resolved owner", () => {
  const rows = leadRowsToIdentityRows([leadRow(), leadRow({ id: "lead-2", ownerBdId: null })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].legacyTable, "lead");
  assert.equal(rows[0].legacyId, "lead-1");
  assert.equal(rows[0].bdId, "bd-1");
  assert.equal(rows[0].company, "Beta Inc");
  assert.equal(rows[0].industry, "Tech");
});

test("runIdentityCutoverChunk: kill switch off runs only legacyWrite — no lock, no identity calls", async () => {
  const calls: string[] = [];
  const result = await runIdentityCutoverChunk(false, {
    withLock: async (fn) => {
      calls.push("lock");
      await fn();
    },
    legacyWrite: async () => {
      calls.push("legacyWrite");
      return [{ id: "x" }];
    },
    toIdentityRows: () => {
      calls.push("toIdentityRows");
      return [];
    },
    prefetch: async () => {
      calls.push("prefetch");
      return [];
    },
    apply: async () => {
      calls.push("apply");
    },
  });
  assert.deepEqual(calls, ["legacyWrite"]);
  assert.deepEqual(result, [{ id: "x" }]);
});

test("runIdentityCutoverChunk: dual write enabled takes the lock BEFORE prefetch/apply", async () => {
  const calls: string[] = [];
  await runIdentityCutoverChunk(true, {
    withLock: async (fn) => {
      calls.push("lock:start");
      await fn();
      calls.push("lock:end");
    },
    legacyWrite: async () => {
      calls.push("legacyWrite");
      return [{ id: "x" }];
    },
    toIdentityRows: () => {
      calls.push("toIdentityRows");
      return [
        {
          legacyTable: "contact",
          legacyId: "x",
          bdId: "bd-1",
          profileKey: null,
          connectedOn: null,
          firstName: "Jane",
          lastName: "Doe",
          company: "Acme",
          companyKey: null,
          jobTitle: null,
          industry: null,
          email: null,
          emailStatus: "none",
          emailConfidence: null,
          emailSource: null,
        },
      ];
    },
    prefetch: async () => {
      calls.push("prefetch");
      return [];
    },
    apply: async () => {
      calls.push("apply");
    },
  });
  assert.deepEqual(calls, ["lock:start", "legacyWrite", "toIdentityRows", "prefetch", "apply", "lock:end"]);
});

test("runIdentityCutoverChunk: no identity rows for the chunk skips prefetch/apply", async () => {
  const calls: string[] = [];
  await runIdentityCutoverChunk(true, {
    withLock: async (fn) => {
      await fn();
    },
    legacyWrite: async () => [],
    toIdentityRows: () => {
      calls.push("toIdentityRows");
      return [];
    },
    prefetch: async () => {
      calls.push("prefetch");
      return [];
    },
    apply: async () => {
      calls.push("apply");
    },
  });
  assert.deepEqual(calls, ["toIdentityRows"]);
});

test("runIdentityCutoverChunk: a failure in apply propagates out (so the caller's db.transaction rolls back the legacy write too)", async () => {
  await assert.rejects(
    () =>
      runIdentityCutoverChunk(true, {
        withLock: async (fn) => {
          await fn();
        },
        legacyWrite: async () => [{ id: "x" }],
        toIdentityRows: () => [
          {
            legacyTable: "contact",
            legacyId: "x",
            bdId: "bd-1",
            profileKey: null,
            connectedOn: null,
            firstName: "Jane",
            lastName: "Doe",
            company: "Acme",
            companyKey: null,
            jobTitle: null,
            industry: null,
            email: null,
            emailStatus: "none",
            emailConfidence: null,
            emailSource: null,
          },
        ],
        prefetch: async () => [],
        apply: async () => {
          throw new Error("boom: unique violation on duplicate_candidate");
        },
      }),
    /boom/,
  );
});

// --- 4B.4: two concurrent uploads of the same new profile key --------------

/**
 * Minimal fake person store standing in for the `person` table: enforces
 * `profile_key` uniqueness the same way applyIdentityWrites's
 * `onConflictDoNothing({ target: person.profileKey })` does, and lets two
 * sequential "chunks" race for the same key.
 */
function makeFakePersonStore() {
  const byProfileKey = new Map<string, ExistingPersonCandidate>();
  const connections: { personId: string; bdId: string }[] = [];

  function toCandidate(id: string, profileKey: string | null): ExistingPersonCandidate {
    return {
      id,
      profileKey,
      firstName: null,
      lastName: null,
      companyKey: null,
      jobTitle: null,
      industry: null,
      email: null,
      emailNormalized: null,
      emailStatus: "none",
      emailConfidence: null,
      emailSource: null,
    };
  }

  return {
    async prefetch(profileKeys: string[]): Promise<PrefetchedIdentityIndex> {
      return profileKeys.flatMap((k) => {
        const hit = byProfileKey.get(k);
        return hit ? [hit] : [];
      });
    },
    async apply(plan: IdentityWritePlan, newId: () => string) {
      const builtRows = buildIdentityWriteRows(plan, newId);
      const winnerByLoserId = new Map<string, string>();
      for (const p of builtRows.persons) {
        const key = p.profileKey as string;
        const existing = byProfileKey.get(key);
        if (existing) {
          // ON CONFLICT (profile_key) DO NOTHING: this insert loses the race.
          winnerByLoserId.set(p.id as string, existing.id);
          continue;
        }
        byProfileKey.set(key, toCandidate(p.id as string, key));
      }
      const rows = repointIdentityWriteRows(builtRows, winnerByLoserId);
      for (const c of rows.connections) connections.push({ personId: c.personId as string, bdId: c.bdId as string });
    },
    personCount: () => new Set([...byProfileKey.values()].map((p) => p.id)).size,
    connectionCount: () => connections.length,
  };
}

test("4B.4: two concurrent uploads of the same new profile key yield one person and two connections", async () => {
  const store = makeFakePersonStore();
  let nextId = 1;
  const newId = () => `person-${nextId++}`;

  const rowFor = (bdId: string) => ({
    legacyTable: "contact" as const,
    legacyId: `contact-${bdId}`,
    bdId,
    profileKey: "linkedin.com/in/shared-profile",
    connectedOn: null,
    firstName: "Shared",
    lastName: "Person",
    company: "Acme",
    companyKey: "acme",
    jobTitle: null,
    industry: null,
    email: null,
    emailStatus: "none" as const,
    emailConfidence: null,
    emailSource: null,
  });

  async function upload(bdId: string) {
    await runIdentityCutoverChunk(true, {
      withLock: async (fn) => fn(), // sequential stand-in for the real advisory lock
      legacyWrite: async () => [rowFor(bdId)],
      toIdentityRows: (rows) => [...rows],
      prefetch: async (rows) => store.prefetch(buildPrefetchKeys(rows).profileKeys),
      apply: async (plan) => store.apply(plan, newId),
    });
  }

  await upload("bd-A");
  await upload("bd-B");

  assert.equal(store.personCount(), 1);
  assert.equal(store.connectionCount(), 2);
});
