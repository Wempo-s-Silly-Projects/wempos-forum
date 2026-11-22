// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// v5.74.1: IPv6 bans key on the /64 prefix (ipaddr.js), so a banned member
// cannot walk out of a ban by rotating their IPv6 interface address. IPv4
// hashes stay byte-identical to the v3.1 formula, and the ban gate still
// matches legacy full-address IPv6 rows during the transition.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assertNetworkNotBanned, requestIpHash, requestIpHashCandidates } from "../api/core/auth.mjs";

const reqFor = (ip) => new Request("https://forum.test/", ip === undefined ? {} : { headers: { "CF-Connecting-IP": ip } });
const legacy = (raw) => createHash("sha256").update("wempo-forum-ip:" + raw).digest("hex");
const env = {};

test("two addresses inside one IPv6 /64 hash the same", async () => {
  assert.equal(await requestIpHash(reqFor("2001:db8:1:2::1"), env), await requestIpHash(reqFor("2001:db8:1:2:ffff:ffff:ffff:ffff"), env));
});

test("a different IPv6 /64 hashes differently", async () => {
  assert.notEqual(await requestIpHash(reqFor("2001:db8:1:2::1"), env), await requestIpHash(reqFor("2001:db8:1:3::1"), env));
});

test("equivalent IPv6 spellings hash the same", async () => {
  assert.equal(await requestIpHash(reqFor("2001:DB8:1:2:0:0:0:1"), env), await requestIpHash(reqFor("2001:db8:1:2::1"), env));
});

test("IPv4 keeps the exact v3.1 hash (existing bans keep matching)", async () => {
  assert.equal(await requestIpHash(reqFor("203.0.113.7"), env), legacy("203.0.113.7"));
});

test("an IPv4-mapped IPv6 address hashes as its IPv4 address", async () => {
  assert.equal(await requestIpHash(reqFor("::ffff:203.0.113.7"), env), legacy("203.0.113.7"));
});

test("missing or garbage headers fall back to the stable unknown key without throwing", async () => {
  assert.equal(await requestIpHash(reqFor(undefined), env), legacy("unknown"));
  assert.equal(await requestIpHash(reqFor("not-an-ip"), env), legacy("unknown"));
});

test("the peppered HMAC path also groups the /64", async () => {
  const peppered = { PASSWORD_PEPPER: "test-pepper" };
  const a = await requestIpHash(reqFor("2001:db8:9:9::a"), peppered);
  assert.equal(a, await requestIpHash(reqFor("2001:db8:9:9::b"), peppered));
  assert.notEqual(a, await requestIpHash(reqFor("2001:db8:9:9::a"), env));
});

test("IPv6 ban candidates include the legacy full-address hash; IPv4 has one", async () => {
  const v6 = await requestIpHashCandidates(reqFor("2001:db8:1:2::1"), env);
  assert.equal(v6.length, 2);
  assert.ok(v6.includes(legacy("2001:db8:1:2::1")));
  assert.deepEqual(await requestIpHashCandidates(reqFor("203.0.113.7"), env), [legacy("203.0.113.7")]);
});

test("the ban gate refuses a legacy full-address IPv6 ban row", async () => {
  const banned = legacy("2001:db8:1:2::1");
  const FORUM_DB = { prepare: (sql) => ({ bind: (...args) => ({ first: async () => {
    assert.match(sql, /ip_hash IN \(/);
    return args.includes(banned) ? { 1: 1 } : null;
  } }) }) };
  await assert.rejects(assertNetworkNotBanned(reqFor("2001:db8:1:2::1"), { FORUM_DB }), /network is banned/);
  await assert.doesNotReject(assertNetworkNotBanned(reqFor("2001:db8:7:7::1"), { FORUM_DB }));
});

test("a /64-keyed ban row refuses a rotated address in the same /64", async () => {
  const banned = await requestIpHash(reqFor("2001:db8:1:2::1"), env);
  const FORUM_DB = { prepare: () => ({ bind: (...args) => ({ first: async () => (args.includes(banned) ? { 1: 1 } : null) }) }) };
  await assert.rejects(assertNetworkNotBanned(reqFor("2001:db8:1:2:dead:beef:0:1"), { FORUM_DB }), /network is banned/);
});
