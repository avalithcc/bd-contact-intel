/**
 * Unit tests for src/lib/contacts/createContactFlow.ts — the pure,
 * port-injected orchestration for "Nuevo contacto". Fresh-review fix: two
 * concurrent creates for the same email/profileKey/company+name used to
 * both prefetch "no match" and both insert a duplicate person, because the
 * prefetch+match+insert sequence ran outside any lock or transaction. Every
 * other identity-writing path (src/lib/queries.ts, src/lib/leads/queries.ts,
 * src/lib/hubspot/importQueries.ts) takes `withIdentityLock` around exactly
 * this sequence — these tests pin that `runCreateContactFlow` does the
 * same, using a `calls` recorder, same style as
 * tests/unit/identityIngestWrite.test.ts pins runIdentityCutoverChunk's
 * lock ordering.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNewContactFields } from "@/lib/contacts/createContact";
import { runCreateContactFlow, type CreateContactFlowPorts, type CreateContactPrefetch } from "@/lib/contacts/createContactFlow";

const EMPTY_PREFETCH: CreateContactPrefetch = { byProfile: [], byCompany: [], byEmail: [] };

function recordingPorts(overrides: Partial<CreateContactFlowPorts> = {}): {
  calls: string[];
  ports: CreateContactFlowPorts;
} {
  const calls: string[] = [];
  const ports: CreateContactFlowPorts = {
    withLock: async (fn) => {
      calls.push("lock:start");
      const result = await fn();
      calls.push("lock:end");
      return result;
    },
    prefetch: async () => {
      calls.push("prefetch");
      return EMPTY_PREFETCH;
    },
    insertPerson: async () => {
      calls.push("insertPerson");
    },
    insertConnection: async () => {
      calls.push("insertConnection");
    },
    insertDuplicateCandidate: async () => {
      calls.push("insertDuplicateCandidate");
    },
    ...overrides,
  };
  return { calls, ports };
}

test("a brand-new contact: the lock wraps prefetch AND every insert, in order (fresh-review fix — closes the two-concurrent-creates race)", async () => {
  const { calls, ports } = recordingPorts();
  const fields = buildNewContactFields({
    firstName: "Ana",
    lastName: "Gomez",
    linkedinUrl: "",
    email: "ana@acme.com",
    company: "Acme",
  });
  const result = await runCreateContactFlow(fields, false, ports);
  assert.equal(result.action, "created");
  assert.deepEqual(calls, ["lock:start", "prefetch", "insertPerson", "insertConnection", "lock:end"]);
});

test("an exact profile_key match: still takes the lock around prefetch (per the other writers' contract), but never inserts", async () => {
  const { calls, ports } = recordingPorts({
    prefetch: async () => {
      calls.push("prefetch");
      return {
        byProfile: [
          {
            id: "person-1",
            profileKey: "linkedin.com/in/anagomez",
            firstName: "Ana",
            lastName: "Gomez",
            company: "Acme",
            companyKey: "acme",
            emailNormalized: null,
          },
        ],
        byCompany: [],
        byEmail: [],
      };
    },
  });
  const fields = buildNewContactFields({
    firstName: "Ana",
    lastName: "Gomez",
    linkedinUrl: "https://linkedin.com/in/anagomez",
    email: "",
    company: "",
  });
  const result = await runCreateContactFlow(fields, false, ports);
  assert.deepEqual(result, { action: "existing_match", existingPersonId: "person-1", existingName: "Ana Gomez" });
  assert.deepEqual(calls, ["lock:start", "prefetch", "lock:end"]);
});

test("an exact manual_create email match (contact-identity delta): existing_match, no insert — same lock-then-no-write shape", async () => {
  const { calls, ports } = recordingPorts({
    prefetch: async () => {
      calls.push("prefetch");
      return {
        byProfile: [],
        byCompany: [],
        byEmail: [
          {
            id: "person-2",
            profileKey: null,
            firstName: "Jane",
            lastName: "Doe",
            company: "Acme",
            companyKey: "acme",
            emailNormalized: "jane@acme.com",
          },
        ],
      };
    },
  });
  const fields = buildNewContactFields({
    firstName: "Someone",
    lastName: "Else",
    linkedinUrl: "",
    email: "Jane@Acme.com",
    company: "",
  });
  const result = await runCreateContactFlow(fields, false, ports);
  assert.deepEqual(result, { action: "existing_match", existingPersonId: "person-2", existingName: "Jane Doe" });
  assert.deepEqual(calls, ["lock:start", "prefetch", "lock:end"]);
});

test("a name+company review match without confirmation: needs_confirmation, no insert", async () => {
  const { calls, ports } = recordingPorts({
    prefetch: async () => {
      calls.push("prefetch");
      return {
        byProfile: [],
        byCompany: [
          {
            id: "person-3",
            profileKey: null,
            firstName: "Ana",
            lastName: "Gomez",
            company: "Acme",
            companyKey: "acme",
            emailNormalized: null,
          },
        ],
        byEmail: [],
      };
    },
  });
  const fields = buildNewContactFields({
    firstName: "Ana",
    lastName: "Gomez",
    linkedinUrl: "",
    email: "",
    company: "Acme",
  });
  const result = await runCreateContactFlow(fields, false, ports);
  assert.deepEqual(result, {
    action: "needs_confirmation",
    existingPersonId: "person-3",
    existingName: "Ana Gomez",
  });
  assert.deepEqual(calls, ["lock:start", "prefetch", "lock:end"]);
});

test("'Crear de todas formas' (confirmDuplicate=true) on a name+company match: inserts the person AND a duplicateCandidate row, still inside the lock", async () => {
  const { calls, ports } = recordingPorts({
    prefetch: async () => {
      calls.push("prefetch");
      return {
        byProfile: [],
        byCompany: [
          {
            id: "person-3",
            profileKey: null,
            firstName: "Ana",
            lastName: "Gomez",
            company: "Acme",
            companyKey: "acme",
            emailNormalized: null,
          },
        ],
        byEmail: [],
      };
    },
  });
  const fields = buildNewContactFields({
    firstName: "Ana",
    lastName: "Gomez",
    linkedinUrl: "",
    email: "",
    company: "Acme",
  });
  const result = await runCreateContactFlow(fields, true, ports);
  assert.equal(result.action, "created");
  assert.deepEqual(calls, [
    "lock:start",
    "prefetch",
    "insertPerson",
    "insertConnection",
    "insertDuplicateCandidate",
    "lock:end",
  ]);
});

test("own-company skip: blocked_own_company, no insert", async () => {
  const { calls, ports } = recordingPorts();
  const fields = buildNewContactFields({
    firstName: "Coworker",
    lastName: "Person",
    linkedinUrl: "",
    email: "coworker@avalith.net",
    company: "",
  });
  const result = await runCreateContactFlow(fields, false, ports);
  assert.equal(result.action, "blocked_own_company");
  assert.deepEqual(calls, ["lock:start", "prefetch", "lock:end"]);
});

test("blank first/last name: invalid, never even takes the lock", async () => {
  const { calls, ports } = recordingPorts();
  const fields = buildNewContactFields({ firstName: "", lastName: "", linkedinUrl: "", email: "", company: "" });
  const result = await runCreateContactFlow(fields, false, ports);
  assert.deepEqual(result, { action: "invalid" });
  assert.deepEqual(calls, []);
});
