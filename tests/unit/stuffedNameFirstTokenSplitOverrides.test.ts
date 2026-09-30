/**
 * Unit tests for src/lib/identity/stuffedNameFirstTokenSplitOverrides.ts.
 * Pure, no DB.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findFirstTokenSplitManualOverride,
  resolveManualOverrideFill,
} from "@/lib/identity/stuffedNameFirstTokenSplitOverrides";

test("findFirstTokenSplitManualOverride returns null for a person id with no override", () => {
  assert.equal(findFirstTokenSplitManualOverride("not-a-real-id"), null);
});

test("finds the Kimberly West-Philips override by person id", () => {
  const override = findFirstTokenSplitManualOverride("124682bb-c7d0-4fa1-a794-a575ff0641c0");
  assert.ok(override);
  assert.equal(override!.firstName, "Kimberly");
  assert.equal(override!.lastName, "West-Philips");
});

test("resolveManualOverrideFill: Kimberly West-Philips, SHRM-CP -> Kimberly / West-Philips", () => {
  const override = findFirstTokenSplitManualOverride("124682bb-c7d0-4fa1-a794-a575ff0641c0")!;
  const fill = resolveManualOverrideFill(
    { personId: "124682bb-c7d0-4fa1-a794-a575ff0641c0", firstName: "Kimberly West-Philips, SHRM-CP", originalLastName: null },
    override,
  );
  assert.deepEqual(fill, {
    personId: "124682bb-c7d0-4fa1-a794-a575ff0641c0",
    originalFirstName: "Kimberly West-Philips, SHRM-CP",
    originalLastName: null,
    firstName: "Kimberly",
    lastName: "West-Philips",
    rule: "manual_override",
  });
});

test("resolveManualOverrideFill: Sandra (Garay) Vallejos -> Sandra / Garay Vallejos", () => {
  const override = findFirstTokenSplitManualOverride("7bfca812-5206-41a7-8c6e-b415d21be307")!;
  const fill = resolveManualOverrideFill(
    { personId: "7bfca812-5206-41a7-8c6e-b415d21be307", firstName: "Sandra (Garay) Vallejos", originalLastName: null },
    override,
  );
  assert.deepEqual(fill, {
    personId: "7bfca812-5206-41a7-8c6e-b415d21be307",
    originalFirstName: "Sandra (Garay) Vallejos",
    originalLastName: null,
    firstName: "Sandra",
    lastName: "Garay Vallejos",
    rule: "manual_override",
  });
});

test("resolveManualOverrideFill: 'Contacto de 2º grado2º V' -> first_name NULL / last_name Ciotta", () => {
  const override = findFirstTokenSplitManualOverride("8027060c-9793-42a6-8f34-bc1e34a54d5d")!;
  const fill = resolveManualOverrideFill(
    { personId: "8027060c-9793-42a6-8f34-bc1e34a54d5d", firstName: "Contacto de 2º grado2º V", originalLastName: null },
    override,
  );
  assert.deepEqual(fill, {
    personId: "8027060c-9793-42a6-8f34-bc1e34a54d5d",
    originalFirstName: "Contacto de 2º grado2º V",
    originalLastName: null,
    firstName: null,
    lastName: "Ciotta",
    rule: "manual_override",
  });
});

test("resolveManualOverrideFill: 'Smart Gen' -> first_name NULL, last_name UNCHANGED (kept from the current row), createCompany set", () => {
  const override = findFirstTokenSplitManualOverride("add5bf2d-6671-4a87-8254-bb3953699afb")!;
  const fill = resolveManualOverrideFill(
    { personId: "add5bf2d-6671-4a87-8254-bb3953699afb", firstName: "Smart Gen", originalLastName: "" },
    override,
  );
  assert.deepEqual(fill, {
    personId: "add5bf2d-6671-4a87-8254-bb3953699afb",
    originalFirstName: "Smart Gen",
    originalLastName: "",
    firstName: null,
    lastName: "", // unchanged — the override never specifies lastName
    rule: "manual_override",
    createCompany: { displayName: "Smart Gen" },
  });
});

test("resolveManualOverrideFill never mutates its inputs", () => {
  const override = findFirstTokenSplitManualOverride("124682bb-c7d0-4fa1-a794-a575ff0641c0")!;
  const candidate = { personId: "124682bb-c7d0-4fa1-a794-a575ff0641c0", firstName: "Kimberly West-Philips, SHRM-CP", originalLastName: null };
  const before = JSON.parse(JSON.stringify(candidate));
  resolveManualOverrideFill(candidate, override);
  assert.deepEqual(candidate, before);
});

test("resolveManualOverrideFill called twice with the same input returns the same result", () => {
  const override = findFirstTokenSplitManualOverride("124682bb-c7d0-4fa1-a794-a575ff0641c0")!;
  const candidate = { personId: "124682bb-c7d0-4fa1-a794-a575ff0641c0", firstName: "Kimberly West-Philips, SHRM-CP", originalLastName: null };
  const first = resolveManualOverrideFill(candidate, override);
  const second = resolveManualOverrideFill(candidate, override);
  assert.deepEqual(first, second);
});
