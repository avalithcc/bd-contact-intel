import { test } from "node:test";
import assert from "node:assert/strict";
import { revalidateContactSurfacesWith, type RevalidateContactSurfacesDeps } from "@/lib/contacts/revalidateContactSurfaces";
import type { ListEffect } from "@/lib/contacts/revalidateLists";

function harness(resolve: (personId: string) => Promise<string | null>) {
  const calls: string[] = [];
  const resolved: string[] = [];
  const deps: RevalidateContactSurfacesDeps = {
    revalidatePath: (p) => void calls.push(`path:${p}`),
    revalidateLists: (...e: ListEffect[]) => void calls.push(`lists:${e.join(",")}`),
    resolveCanonicalCompanyKey: async (id) => {
      resolved.push(id);
      return resolve(id);
    },
  };
  return { deps, calls, resolved };
}

test("revalidates the contact, then the lists, then the canonical company, in that order", async () => {
  const h = harness(async () => "acme");
  await revalidateContactSurfacesWith(h.deps, "p1", ["touch", "tasks"]);
  assert.deepEqual(h.calls, ["path:/contacts/p1", "lists:touch,tasks", "path:/companies/acme"]);
});

test("resolves the company once per call, however many list effects", async () => {
  const h = harness(async () => "acme");
  await revalidateContactSurfacesWith(h.deps, "p1", ["touch", "meetings", "tasks"]);
  assert.deepEqual(h.resolved, ["p1"]);
});

test("names no list when no effect is given, and skips the company when the person has none", async () => {
  const h = harness(async () => null);
  await revalidateContactSurfacesWith(h.deps, "p1", []);
  assert.deepEqual(h.calls, ["path:/contacts/p1"]);
});

test("a resolution failure is swallowed and the contact and lists were already revalidated", async () => {
  const h = harness(async () => {
    throw new Error("connection terminated");
  });
  await assert.doesNotReject(revalidateContactSurfacesWith(h.deps, "p1", ["touch"]));
  assert.deepEqual(h.calls, ["path:/contacts/p1", "lists:touch"]);
});

test("a thrown navigation error escapes untouched", async () => {
  const navigation = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
  const h = harness(async () => {
    throw navigation;
  });
  await assert.rejects(revalidateContactSurfacesWith(h.deps, "p1", ["touch"]), (err) => err === navigation);
  assert.deepEqual(h.calls, ["path:/contacts/p1", "lists:touch"]);
});
