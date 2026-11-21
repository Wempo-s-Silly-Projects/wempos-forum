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

// Wave 5.6 F3 (owner: "just more odd stuff"): a successful action must not
// leave an earlier failure's line on screen, and a form the app has no
// handler for must not leave a stuck "Saving…" on the status bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNode, makeFakeDocument, countByClass } from "./helpers/fake-dom.mjs";

globalThis.document = { ...makeFakeDocument(), querySelector: () => null, querySelectorAll: () => [] };
let nextResponse = null;
globalThis.fetch = async () => nextResponse();
const json = (status, body) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const { ui } = await import("../public/js/chat-widget-state.js");
const { buildLobby } = await import("../public/js/chat-widget-lobby.js");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a successful lobby send clears the previous send's error line", async () => {
  ui.open = true;
  ui.widgetUser = { id: 7, username: "wempo", role: "member" };
  ui.lobbyEl = buildLobby();
  const form = ui.lobbyEl.querySelector("form.chat-widget-lobby-send");
  const input = ui.lobbyEl.querySelector("input.chat-widget-lobby-input");

  input.value = "first try";
  nextResponse = json(429, { error: "Slow down." });
  form.dispatch("submit", { preventDefault() {} });
  await settle();
  assert.equal(countByClass(ui.lobbyEl, "chat-widget-lobby-error"), 1, "the refusal shows");

  input.value = "second try";
  // The stored row's paint is covered elsewhere (it needs classList, which the
  // fake DOM leaves out); this send answers without a row to isolate the slot.
  nextResponse = json(200, {});
  form.dispatch("submit", { preventDefault() {} });
  await settle();
  assert.equal(input.value, "", "the send landed");
  assert.equal(countByClass(ui.lobbyEl, "chat-widget-lobby-error"), 0, "no stale error after the success");
});

test("submitForm only shows Saving… for forms it actually handles", () => {
  const source = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
  const body = source.match(/async function submitForm\(form\) \{([\s\S]*?)\n\}/)[1];
  const guard = body.indexOf("if (!handler) return;");
  const saving = body.indexOf('setMessage(t("app.saving"))');
  assert.ok(guard > 0, "a form with no handler (e.g. the chat lobby's) returns early");
  assert.ok(saving > guard, "Saving… is painted only after a handler is found");
  assert.ok(FakeNode);
});
