/**
 * The extension's lookup endpoint. The privacy property that matters most: a request without a usable session
 * never reaches a lookup and never carries person data. The rest pins the answer shapes the extension relies on.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { runLinkedinLookup, type LinkedinLookupPorts, type LinkedinPersonCard } from "@/lib/extension/linkedinLookup";
import { isUsableSessionUser } from "@/lib/auth/lightSession";
import { isSessionExemptPath } from "@/lib/auth/sessionExemptRoutes";

const CARD: LinkedinPersonCard = {
  personId: "0b8e1f10-0000-4000-8000-000000000001",
  name: "Valentina Rojas",
  jobTitle: "VP de Ingeniería",
  company: "Mercado Libre",
  ownerName: "Ana Pereyra",
  lastActivity: { label: "Llamada", date: "2026-10-15T14:00:00.000Z" },
};

function ports(overrides: Partial<LinkedinLookupPorts> = {}): LinkedinLookupPorts & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    hasSession: async () => true,
    findLivePersonId: async (key) => {
      calls.push(`find:${key}`);
      return CARD.personId;
    },
    loadCard: async (id) => {
      calls.push(`load:${id}`);
      return CARD;
    },
    ...overrides,
  };
}

test("without a session nothing is looked up and no person data is returned", async () => {
  const p = ports({ hasSession: async () => false });
  const res = await runLinkedinLookup("https://www.linkedin.com/in/valentina-rojas/", p);
  assert.equal(res.status, 401);
  assert.deepEqual(res.body, { state: "signed_out" });
  assert.deepEqual(p.calls, []);
  assert.equal(JSON.stringify(res.body).includes("Valentina"), false);
});

test("a known profile returns the card and relative paths only", async () => {
  const p = ports();
  const res = await runLinkedinLookup("https://www.linkedin.com/in/valentina-rojas/?utm=x", p);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    state: "found",
    personId: CARD.personId,
    name: "Valentina Rojas",
    jobTitle: "VP de Ingeniería",
    company: "Mercado Libre",
    ownerName: "Ana Pereyra",
    lastActivity: { label: "Llamada", date: "2026-10-15T14:00:00.000Z" },
    viewUrl: `/contacts/${CARD.personId}`,
  });
  assert.deepEqual(p.calls, [`find:${p.calls[0]!.slice(5)}`, `load:${CARD.personId}`]);
});

test("a found person without activity omits lastActivity", async () => {
  const res = await runLinkedinLookup(
    "https://www.linkedin.com/in/valentina-rojas/",
    ports({ loadCard: async () => ({ ...CARD, lastActivity: null }) }),
  );
  assert.equal(res.body.state, "found");
  assert.equal("lastActivity" in res.body, false);
});

test("an unknown profile returns the add path with the normalized link", async () => {
  const res = await runLinkedinLookup("https://www.linkedin.com/in/camila-herrera-12ab/", ports({ findLivePersonId: async () => null }));
  assert.deepEqual(res.body, {
    state: "not_found",
    addUrl: "/contacts?new=1&linkedin=" + encodeURIComponent("https://linkedin.com/in/camila-herrera-12ab"),
  });
});

test("a person that vanished between the two reads counts as not found", async () => {
  const res = await runLinkedinLookup("https://www.linkedin.com/in/valentina-rojas/", ports({ loadCard: async () => null }));
  assert.equal(res.body.state, "not_found");
});

test("anything that is not a personal profile is invalid and never looked up", async () => {
  for (const url of [null, "", "https://www.linkedin.com/company/avalith/", "https://evil.example/in/x/"]) {
    const p = ports();
    const res = await runLinkedinLookup(url, p);
    assert.deepEqual(res.body, { state: "invalid" }, String(url));
    assert.deepEqual(p.calls, []);
  }
});

test("the session rule matches the middleware: work domain and confirmed email", () => {
  assert.equal(isUsableSessionUser({ email: "ana@avalith.net", email_confirmed_at: "2026-01-01T00:00:00Z" }), true);
  assert.equal(isUsableSessionUser({ email: "ana@avalith.net", email_confirmed_at: null }), false);
  assert.equal(isUsableSessionUser({ email: "ana@gmail.com", email_confirmed_at: "2026-01-01T00:00:00Z" }), false);
  assert.equal(isUsableSessionUser(null), false);
});

test("the lookup route stays behind the middleware session gate", () => {
  assert.equal(isSessionExemptPath("/api/extension/linkedin-lookup"), false);
});
