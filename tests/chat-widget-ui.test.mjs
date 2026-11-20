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

// Chat-widget UI pins: the account-copy/audit-logs static-analysis style —
// cheap source pins that read the client module (and its two seams in the
// markup/css) and fail loudly on a silent revert. The widget's client-side
// behavior rides the module's own probes, so these pins hold the load-bearing
// wiring: the inert signed-out gate, the single-flight send, the two polling
// schedules, the beacon ban, and the textContent-only render path.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const widget = read("../public/js/chat-widget.js");

test("the chat widget mounts only after its own thread-list boot probe succeeds", () => {
  // The gate: the single GET /api/dm/threads probe decides everything; a
  // failure returns before any DOM lands, keeping the module inert.
  assert.ok(widget.includes("threads = await loadThreads();"), "the boot probe");
  assert.ok(widget.includes("    return;\n  }\n  launcher ="), "the early return keeps the launcher unmounted");
  // It self-mounts on import (no app.js wiring — the index.html tag loads it).
  assert.ok(widget.includes("await boot();"), "the module self-mounts at import");
  // No direct fetch — the shared api() wrapper is the only door.
  assert.ok(!widget.includes("fetch("), "every call rides api()");
});

test("the send path is single-flight (the 11-12 double-send defect stays dead)", () => {
  assert.ok(widget.includes("if (sendInFlight || !activeThread || !composerEl) return;"), "the in-flight gate");
  assert.ok(widget.includes("sendButton.disabled = true;"), "the disabled button arm");
  assert.ok(widget.includes("sendInFlight = false;"), "the flag resets in finally");
  assert.ok(widget.includes("sendButton.disabled = false;"), "the button re-enables in finally");
  // Enter submits without shift and is gated by the same handler entry.
  assert.ok(widget.includes('event.key === "Enter" && !event.shiftKey'), "Enter submits");
  assert.ok(widget.includes("sendMessage();"), "keydown routes into the same gated send");
});

test("the polling and visible-tab schedule is the brief's exact shape", () => {
  assert.ok(widget.includes("const PANEL_POLL_MS = 5_000;"), "open-panel refresh every 5s");
  assert.ok(widget.includes("const UNREAD_POLL_MS = 30_000;"), "closed unread refresh every 30s");
  assert.ok(widget.includes("if (document.hidden || open) return;"), "the idle tick sleeps when open or hidden");
  assert.ok(widget.includes("if (document.hidden) return;"), "the panel tick sleeps in a hidden tab");
  assert.ok(widget.includes('"POST"'), "the read/ack/send calls are POSTs");
  // The widget must NOT carry the presence beacon (who-online.js owns it).
  assert.ok(!widget.includes("/api/presence"), "no beacon double-send rides the widget");
});

test("the panel toggles, marks read, and pages older without innerHTML", () => {
  assert.ok(widget.includes('openPanel') && widget.includes('closePanel'), "the toggle pair exists");
  assert.ok(widget.includes("/read`, { method: \"POST\" })"), "opening a thread acks unread");
  assert.ok(widget.includes("?after="), "the Load-older door pages older messages");
  assert.ok(widget.includes("[...(conversation.messages || [])].reverse()"), "the display flips a copy (immutability)");
  // No innerHTML anywhere — user content reaches the DOM via textContent only.
  assert.ok(!widget.includes("innerHTML"), "the CSP-clean render path");
  assert.ok(widget.includes("textContent"), "copy rides textContent");
});

test("the widget's seams ride the shell markup and the stylesheet banner", () => {
  const shell = read("../public/index.html");
  assert.ok(shell.includes('<script type="module" src="/js/chat-widget.js"></script>'), "the module tag");
  const css = read("../public/styles.css");
  assert.ok(css.includes(".chat-widget-launcher"), "the launcher family");
  assert.ok(css.includes('.chat-widget-panel'), "the panel family");
  assert.ok(css.includes("width: min(360px, calc(100vw - 16px));"), "the mobile clamp width");
  assert.ok(css.includes("height: min(560px, calc(100vh - 96px));"), "the mobile clamp height");
  assert.ok(css.includes("prefers-reduced-motion"), "the reduced-motion respect");
});
