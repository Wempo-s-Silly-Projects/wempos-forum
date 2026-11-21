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

// Wave 5.6 F1 (owner: "when u delete it checks for post after its already
// deleted"): drives the real delete-post action and the real router through a
// fake DOM + a fake history stack, capturing every api() request. After the
// DELETE resolves nothing may ask for the deleted id again — not the
// re-render, and not the browser's Back button — and no "Post not found."
// error may follow the success line.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument } from "./helpers/fake-dom.mjs";

const ORIGIN = "https://wempos-forum.com";
const shellNodes = new Map();
const shellNode = (selector) => {
  if (!shellNodes.has(selector)) {
    const node = new FakeNode("div");
    node.showModal = () => { node.open = true; };
    node.close = () => { node.open = false; };
    node.querySelector = shellNode;
    shellNodes.set(selector, node);
  }
  return shellNodes.get(selector);
};
globalThis.document = {
  ...makeFakeDocument(),
  querySelector: shellNode,
  querySelectorAll: () => [],
  documentElement: new FakeNode("html"),
  addEventListener() {},
};

// A browser-shaped session history: pushState drops the forward entries,
// replaceState overwrites the current one, back() fires popstate.
const nav = { entries: ["/"], index: 0, popListeners: [] };
const setLocation = (path) => {
  const [pathname, search = ""] = path.split("?");
  globalThis.location.pathname = pathname;
  globalThis.location.search = search ? "?" + search : "";
};
globalThis.location = { pathname: "/", search: "", origin: ORIGIN, hostname: "wempos-forum.com" };
globalThis.history = {
  pushState(_state, _title, path) {
    nav.entries = [...nav.entries.slice(0, nav.index + 1), path];
    nav.index += 1;
    setLocation(path);
  },
  replaceState(_state, _title, path) {
    nav.entries = nav.entries.map((entry, at) => (at === nav.index ? path : entry));
    setLocation(path);
  },
  back() {
    if (nav.index === 0) return;
    nav.index -= 1;
    setLocation(nav.entries[nav.index]);
    for (const listener of nav.popListeners) listener();
  },
};
globalThis.window = {
  location: globalThis.location,
  addEventListener: (type, listener) => { if (type === "popstate") nav.popListeners.push(listener); },
};

const requests = [];
const deleted = new Set();
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (path, init = {}) => {
  const method = (init.method ?? "GET").toUpperCase();
  requests.push({ method, path });
  const id = Number(String(path).match(/^\/api\/posts\/(\d+)$/)?.[1] ?? 0);
  if (method === "DELETE" && id) {
    deleted.add(id);
    return json(200, { deleted: true });
  }
  if (id && deleted.has(id)) return json(404, { error: "Post not found." });
  return json(200, { replies: [] });
};

const { startRouter } = await import("../public/js/router.js");
const { state } = await import("../public/js/state.js");
const { api } = await import("../public/js/api.js");
const { getConfirmHandler, statusMessage, errorMessage } = await import("../public/js/dom.js");
const { ACTIONS } = await import("../public/js/routes/profile.js");

// The route renderer stands in for app.js's renderRoute: it fetches exactly
// what the real post/search/feed renderers fetch first, and a throw becomes
// the error bar (the boot's onRoute catch and handleClick's catch both do
// setMessage(error.message, true)).
const flashes = [];
state.renderRoute = async (route) => {
  state.activeRoute = route;
  statusMessage.textContent = "";
  errorMessage.textContent = "";
  if (route.name === "post") await api(`/api/posts/${route.id}`);
  else if (route.name === "search") await api(`/api/search?q=${encodeURIComponent(route.query)}`);
  else await api("/api/posts");
};
const flashOnError = (route) => state.renderRoute(route).catch((error) => {
  flashes.push(error.message);
  errorMessage.textContent = error.message;
});
state.router = startRouter(flashOnError);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  await settle();
  requests.length = 0;
  flashes.length = 0;
  deleted.clear();
});

const openAt = async (path) => {
  state.router.navigate(path);
  await settle();
};

const confirmDelete = async (postId, scope) => {
  const button = new FakeNode("button");
  button.dataset.postId = String(postId);
  button.dataset.deleteScope = scope;
  ACTIONS["delete-post"](button);
  await getConfirmHandler()();
  await settle();
};

const requestsAfterDelete = (postId) => {
  const at = requests.findIndex((row) => row.method === "DELETE" && row.path === `/api/posts/${postId}`);
  assert.ok(at >= 0, "the DELETE was sent");
  return requests.slice(at + 1).filter((row) => row.path === `/api/posts/${postId}` || row.path.startsWith(`/api/posts/${postId}/`));
};

test("deleting the viewed thread root: home, success line, and Back never refetches the gone id", async () => {
  await openAt("/c/general");
  await openAt("/posts/41");
  await confirmDelete(41, "thread");
  assert.equal(location.pathname, "/");
  assert.notEqual(statusMessage.textContent, "", "the success line shows");
  history.back();
  await settle();
  assert.deepEqual(requestsAfterDelete(41), [], "nothing asks for the deleted thread again");
  assert.deepEqual(flashes, [], "no error follows the success line");
  assert.equal(location.pathname, "/c/general", "Back skips the dead thread entry");
});

test("deleting a level-1 or level-2 reply on a thread page re-renders the thread only", async () => {
  await openAt("/posts/50");
  for (const replyId of [51, 52]) {
    await confirmDelete(replyId, "reply");
    assert.deepEqual(requestsAfterDelete(replyId), []);
    assert.equal(location.pathname, "/posts/50");
    assert.notEqual(statusMessage.textContent, "");
    assert.equal(errorMessage.textContent, "");
  }
  assert.deepEqual(flashes, []);
});

test("deleting a root from the feed, a profile list or search results never refetches it", async () => {
  for (const [path, id] of [["/", 60], ["/users/wempo", 61], ["/?q=games", 62]]) {
    await openAt(path);
    await confirmDelete(id, "thread");
    history.back();
    await settle();
    assert.deepEqual(requestsAfterDelete(id), [], path);
    assert.equal(errorMessage.textContent, "", path);
  }
  assert.deepEqual(flashes, []);
});

test("a gone post's address renders the 404 view instead of flashing the error bar", () => {
  const source = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
  const body = source.match(/async function renderRoute\(route\) \{([\s\S]*?)\n\}/)[1];
  assert.match(body, /stopReadAloud\(\);/, "speech stops before any re-render (delete with Read aloud playing)");
  assert.match(body, /error\?\.status [!=]== 404/, "a 404 on the post route is caught");
  assert.match(body, /renderNotFoundRoute\(\)/, "and painted as the not-found view");
});
