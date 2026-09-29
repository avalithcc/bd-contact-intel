/**
 * Unit tests for src/lib/auth/bdAuthMatch.ts — the pure resolver that turns
 * a set of candidate `bd` rows and a set of candidate `auth.users` rows
 * (both already fetched by src/lib/auth/bdAuthResolveDb.ts) into exactly one
 * matched pair, or a specific, typed failure reason. Pure, no DB — fixtures
 * built by hand here since there is no producer function to reuse (the real
 * producer is a raw SQL read, exercised only against production).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BdAuthMatchError,
  matchBdToAuthUser,
  type AuthUserRowForMatch,
  type BdRowForMatch,
} from "@/lib/auth/bdAuthMatch";

function bdRow(overrides: Partial<BdRowForMatch> = {}): BdRowForMatch {
  return {
    id: "bd-1",
    name: "Cristian Civita",
    email: "cristian@avalith.net",
    role: "admin",
    ...overrides,
  };
}

function authRow(overrides: Partial<AuthUserRowForMatch> = {}): AuthUserRowForMatch {
  return {
    id: "auth-1",
    email: "cristian@avalith.net",
    lastSignInAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    bannedUntil: null,
    deletedAt: null,
    ...overrides,
  };
}

const NOW = new Date("2026-09-29T00:00:00.000Z");

test("matches exactly one bd row to exactly one auth user row with the same email", () => {
  const match = matchBdToAuthUser([bdRow()], [authRow()]);
  assert.equal(match.bd.id, "bd-1");
  assert.equal(match.authUser.id, "auth-1");
});

test("fails with bd_not_found when no bd row matches", () => {
  assert.throws(
    () => matchBdToAuthUser([], [authRow()]),
    (err: unknown) => err instanceof BdAuthMatchError && err.reason === "bd_not_found",
  );
});

test("fails with bd_multiple_matches when more than one bd row matches", () => {
  assert.throws(
    () => matchBdToAuthUser([bdRow({ id: "bd-1" }), bdRow({ id: "bd-2" })], [authRow()]),
    (err: unknown) => err instanceof BdAuthMatchError && err.reason === "bd_multiple_matches",
  );
});

test("fails with auth_user_not_found when no auth.users row matches", () => {
  assert.throws(
    () => matchBdToAuthUser([bdRow()], []),
    (err: unknown) => err instanceof BdAuthMatchError && err.reason === "auth_user_not_found",
  );
});

test("fails with auth_user_multiple_matches when more than one auth.users row matches", () => {
  assert.throws(
    () => matchBdToAuthUser([bdRow()], [authRow({ id: "auth-1" }), authRow({ id: "auth-2" })]),
    (err: unknown) => err instanceof BdAuthMatchError && err.reason === "auth_user_multiple_matches",
  );
});

test("fails with email_mismatch when the bd row and the auth user row disagree on exact email casing", () => {
  assert.throws(
    () =>
      matchBdToAuthUser(
        [bdRow({ email: "Cristian@avalith.net" })],
        [authRow({ email: "cristian@avalith.net" })],
      ),
    (err: unknown) => err instanceof BdAuthMatchError && err.reason === "email_mismatch",
  );
});

test("fails with auth_user_deleted when the auth user row has deleted_at set", () => {
  assert.throws(
    () =>
      matchBdToAuthUser([bdRow()], [authRow({ deletedAt: new Date("2026-06-01T00:00:00.000Z") })], {
        now: NOW,
      }),
    (err: unknown) => err instanceof BdAuthMatchError && err.reason === "auth_user_deleted",
  );
});

test("fails with auth_user_banned when banned_until is in the future relative to now", () => {
  assert.throws(
    () =>
      matchBdToAuthUser([bdRow()], [authRow({ bannedUntil: new Date("2026-12-31T00:00:00.000Z") })], {
        now: NOW,
      }),
    (err: unknown) => err instanceof BdAuthMatchError && err.reason === "auth_user_banned",
  );
});

test("does not refuse when banned_until is in the past (ban already expired)", () => {
  const match = matchBdToAuthUser(
    [bdRow()],
    [authRow({ bannedUntil: new Date("2020-01-01T00:00:00.000Z") })],
    { now: NOW },
  );
  assert.equal(match.authUser.id, "auth-1");
});

test("does not refuse when banned_until and deleted_at are both null", () => {
  const match = matchBdToAuthUser([bdRow()], [authRow()], { now: NOW });
  assert.equal(match.authUser.id, "auth-1");
});

test("checks auth_user_deleted before auth_user_banned when both apply", () => {
  assert.throws(
    () =>
      matchBdToAuthUser(
        [bdRow()],
        [
          authRow({
            deletedAt: new Date("2026-06-01T00:00:00.000Z"),
            bannedUntil: new Date("2026-12-31T00:00:00.000Z"),
          }),
        ],
        { now: NOW },
      ),
    (err: unknown) => err instanceof BdAuthMatchError && err.reason === "auth_user_deleted",
  );
});
