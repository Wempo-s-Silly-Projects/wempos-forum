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

// v5.61 security review of v5.57-v5.60 (docs/security-reviews/
// 2026-11-22-v5.57-v5.60.md). L7: the v5.60 nav reuse keyed on the unread
// count it was BUILT with, but "Mark all read" edits the built bell in place
// (updateBell(0)). When the next session count equalled the build count (a
// new notification landed between read-all and the re-render), the reuse
// kept the hidden dot and the "no unread" label. The reuse now also checks
// that the bell still shows what it was built to show. Plus pins: the nav
// never offers a staff entry to a guest or member, and a role change or
// sign-out (user -> guest) always rebuilds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const accountActions = new FakeNode("nav");
const mobileBar = new FakeNode("nav");
const baseDocument = makeFakeDocument();

const bellOf = () => Array.from(accountActions.children).find((node) => node.id === "notification-bell") ?? null;
const badgeOf = () => bellOf()?.querySelector(".notification-badge") ?? null;

globalThis.document = {
  ...baseDocument,
  title: "Wempo's Forum",
  querySelector: (selector) => {
    if (selector === "#account-actions") return accountActions;
    if (selector === ".mobile-bar") return mobileBar;
    // updateBell() looks the live bell up by id; route it to the real node.
    if (selector === "#notification-bell") return bellOf();
    if (selector === "#notification-bell [data-notification-count]") return badgeOf();
    return new FakeNode("div");
  },
  querySelectorAll: () => [],
};
globalThis.location = { origin: "https://wempos-forum.com", pathname: "/notifications", search: "" };
globalThis.window = { location: globalThis.location };

const { renderAccountNavigation } = await import("../public/js/routes/account-nav.js");
const { updateBell } = await import("../public/js/notifications.js");

const MEMBER = { id: 3, username: "alice", role: "member" };
const STAFF = { id: 1, username: "boss", role: "admin" };
const hrefOf = (node) => node.getAttribute?.("href") ?? node.href;
const allHrefs = () => [accountActions, mobileBar]
  .flatMap((root) => Array.from(root.querySelectorAll("a")).map(hrefOf));

test("L7: after Mark all read edits the bell in place, an equal unread count from the session still repaints the dot", () => {
  renderAccountNavigation(MEMBER, 1);
  assert.equal(badgeOf().hidden, false, "built with one unread: dot shown");
  updateBell(0); // markAllNotificationsRead's local update
  assert.equal(badgeOf().hidden, true);
  // A new notification arrived between read-all and the re-render's session read.
  renderAccountNavigation(MEMBER, 1);
  assert.equal(badgeOf().hidden, false, "the session says one unread: the dot must show");
  assert.equal(bellOf().getAttribute("aria-label"), "bell.labelUnread");
});

test("L7: the reuse still holds when nothing touched the bell (v5.60 perf kept)", () => {
  renderAccountNavigation(MEMBER, 4);
  const first = accountActions.children[0];
  renderAccountNavigation(MEMBER, 4);
  assert.equal(accountActions.children[0], first);
});

test("nav cache: a role change or sign-out always rebuilds, and no staff entry survives it", () => {
  renderAccountNavigation(STAFF, 2);
  assert.ok(allHrefs().includes("/admin"), "staff sees the desk");
  renderAccountNavigation({ ...STAFF, role: "member" }, 2);
  assert.ok(!allHrefs().includes("/admin"), "demoted: no desk on either surface");
  renderAccountNavigation(STAFF, 2);
  renderAccountNavigation(null, 0);
  assert.ok(!allHrefs().includes("/admin"), "signed out: no desk");
  assert.equal(bellOf(), null, "signed out: no bell");
  assert.ok(!allHrefs().some((href) => String(href).startsWith("/users/")), "signed out: no profile link");
  const actions = [accountActions, mobileBar].flatMap((root) => Array.from(root.querySelectorAll("button")))
    .map((node) => node.dataset?.action).filter(Boolean);
  assert.ok(!actions.includes("logout"), "signed out: no sign-out control");
});
