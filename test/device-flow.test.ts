// Copyright (c) The Malloy Foundation
// SPDX-License-Identifier: MIT
//
// Integration test for the device authorization grant (RFC 8628) against a real
// Postgres. These behaviours cannot be checked any other way: every one of them
// is a property of a row transition, and the interesting ones — consume-once,
// slow_down, the client binding — are exactly where a typecheck tells you
// nothing.
//
// Run via `npm run test:hosted` (scripts/hosted-test.sh stands up Postgres and
// points DATABASE_URL at it).

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, users, oauthClients, oauthDeviceCodes, type User } from "@/db";
import {
  DEVICE_GRANT_TYPE,
  DEVICE_POLL_INTERVAL_SEC,
  decideByUserCode,
  findPendingByUserCode,
  issueDeviceCode,
  normalizeUserCode,
  pollDeviceCode,
} from "@/lib/oauth/device-codes";

let user: User;
let clientId: string;

before(async () => {
  // Unique per run: the hosted harness gives each file a fresh schema, but a test
  // that cannot be re-run against a warm database is needlessly annoying to debug.
  const [u] = await db
    .insert(users)
    .values({ email: `device-${randomUUID()}@test.local` })
    .returning();
  user = u;
  const [c] = await db
    .insert(oauthClients)
    .values({
      name: "malloyyo CLI",
      redirectUris: ["http://localhost/unused-by-device-flow"],
      tokenEndpointAuthMethod: "none",
      grantTypes: [DEVICE_GRANT_TYPE, "refresh_token"],
      responseTypes: ["code"],
      scope: "mcp",
    })
    .returning();
  clientId = c.id;
});

const issue = () => issueDeviceCode({ clientId, scope: "mcp", resource: null });

test("the user code is shaped for a human to read off one screen and type into another", async () => {
  const { userCode } = await issue();
  assert.match(userCode, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  // No vowels means it can never produce a word; no 0/O/1/I means it can't be
  // mistyped into a different valid code.
  assert.ok(!/[AEIOU01]/.test(userCode), `${userCode} contains an ambiguous character`);
});

test("a user code is found however the human types it", async () => {
  const { userCode } = await issue();
  for (const variant of [userCode, userCode.toLowerCase(), userCode.replace("-", ""), ` ${userCode} `]) {
    const row = await findPendingByUserCode(variant);
    assert.ok(row, `expected ${JSON.stringify(variant)} to resolve`);
  }
});

test("neither code is stored in the clear", async () => {
  const { deviceCode, userCode } = await issue();
  const rows = await db.select().from(oauthDeviceCodes);
  const raw = JSON.stringify(rows);
  assert.ok(!raw.includes(deviceCode), "device_code was stored in the clear");
  assert.ok(!raw.includes(normalizeUserCode(userCode)), "user_code was stored in the clear");
});

test("polling before approval is pending, not an error", async () => {
  const { deviceCode } = await issue();
  assert.equal((await pollDeviceCode(deviceCode, clientId)).status, "pending");
});

test("approval binds the user, and the next poll issues exactly once", async () => {
  const { deviceCode, userCode } = await issue();
  assert.deepEqual(await decideByUserCode(userCode, user.id, true), { ok: true });

  const first = await pollDeviceCode(deviceCode, clientId);
  assert.equal(first.status, "approved");
  if (first.status === "approved") {
    assert.equal(first.row.userId, user.id, "the approving user must be bound to the grant");
    assert.equal(first.row.scope, "mcp");
  }

  // Consume-once. A replayed device_code must not mint a second token pair.
  const second = await pollDeviceCode(deviceCode, clientId);
  assert.equal(second.status, "not_found", "a consumed device_code was accepted twice");
});

test("two simultaneous polls cannot both be approved", async () => {
  const { deviceCode, userCode } = await issue();
  await decideByUserCode(userCode, user.id, true);
  // The conditional UPDATE is the lock; race it to prove that.
  const results = await Promise.all([
    pollDeviceCode(deviceCode, clientId),
    pollDeviceCode(deviceCode, clientId),
  ]);
  const approved = results.filter((r) => r.status === "approved");
  assert.equal(approved.length, 1, `expected exactly one approval, got ${results.map((r) => r.status).join("+")}`);
});

test("polling faster than the advertised interval earns slow_down", async () => {
  const { deviceCode } = await issue();
  assert.equal((await pollDeviceCode(deviceCode, clientId)).status, "pending");
  // Immediately again: well inside the interval the server advertised.
  assert.equal((await pollDeviceCode(deviceCode, clientId)).status, "slow_down");
  assert.ok(DEVICE_POLL_INTERVAL_SEC >= 5, "the advertised interval should not be aggressive");
});

test("a denial is reported as denial, not as pending", async () => {
  const { deviceCode, userCode } = await issue();
  await decideByUserCode(userCode, user.id, false);
  assert.equal((await pollDeviceCode(deviceCode, clientId)).status, "denied");
});

test("a decided code cannot be decided again", async () => {
  const { userCode } = await issue();
  await decideByUserCode(userCode, user.id, true);
  // Approving twice would let a second person re-bind a live grant to themselves.
  assert.deepEqual(await decideByUserCode(userCode, user.id, true), { ok: false, reason: "not_found" });
});

test("an expired code is expired, and is never approvable", async () => {
  const { deviceCode, userCode } = await issue();
  await db
    .update(oauthDeviceCodes)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(oauthDeviceCodes.clientId, clientId));
  assert.equal((await pollDeviceCode(deviceCode, clientId)).status, "expired");
  assert.deepEqual(await decideByUserCode(userCode, user.id, true), { ok: false, reason: "not_found" });
  // Put it back so later tests are unaffected by the clock surgery above.
  await db
    .update(oauthDeviceCodes)
    .set({ expiresAt: new Date(Date.now() + 600_000) })
    .where(eq(oauthDeviceCodes.clientId, clientId));
});

test("a device_code is bound to the client that requested it", async () => {
  const { deviceCode, userCode } = await issue();
  await decideByUserCode(userCode, user.id, true);
  const [other] = await db
    .insert(oauthClients)
    .values({
      name: "someone else",
      redirectUris: ["http://localhost/x"],
      tokenEndpointAuthMethod: "none",
      grantTypes: [DEVICE_GRANT_TYPE],
      responseTypes: ["code"],
      scope: "mcp",
    })
    .returning();
  // Another registered client must not be able to redeem this grant.
  assert.equal((await pollDeviceCode(deviceCode, other.id)).status, "not_found");
  // And the rightful client still can — the rejection above consumed nothing.
  assert.equal((await pollDeviceCode(deviceCode, clientId)).status, "approved");
});

test("an unknown device_code is rejected", async () => {
  assert.equal((await pollDeviceCode("not-a-real-device-code", clientId)).status, "not_found");
});
