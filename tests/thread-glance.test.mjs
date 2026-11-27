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

// Wave 2026-11-21 F4: thread at a glance — participants and top reply (read time dropped, trim list #2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TOP_REPLY_MIN_LIKES, summarizeThread,
} from "../public/js/thread-glance.js";

const post = (id, user, body, likeCount = 0) => ({ id, author: { username: user }, body, likeCount });

test("counts unique participants including the root author", () => {
  const root = post(1, "ann", "hello there");
  const summary = summarizeThread(root, [post(2, "bob", "hi"), post(3, "Ann", "again"), post(4, "cy", "yo")]);
  assert.equal(summary.participants, 3);
  assert.equal(summary.replyCount, 3);
});

test("no read-time estimate (trim list #2): the summary carries no readMinutes", () => {
  assert.equal("readMinutes" in summarizeThread(post(1, "a", "short"), []), false);
  const source = readFileSync(new URL("../public/js/thread-glance.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /readTime|WORDS_PER_MINUTE/);
});

test("top reply is the most-liked reply at or above the threshold; ties go to the earliest", () => {
  const root = post(1, "a", "x");
  const replies = [post(2, "b", "x", TOP_REPLY_MIN_LIKES + 1), post(3, "c", "x", TOP_REPLY_MIN_LIKES + 1), post(4, "d", "x", 1)];
  assert.equal(summarizeThread(root, replies).topReply.id, 2);
  assert.equal(summarizeThread(root, [post(5, "e", "x", TOP_REPLY_MIN_LIKES - 1)]).topReply, null);
});

test("missing authors and bodies never throw", () => {
  const summary = summarizeThread({ id: 1 }, [{ id: 2 }]);
  assert.equal(summary.participants, 0);
});

test("post.js renders the glance strip; module stays DOM-safe", () => {
  const source = readFileSync(new URL("../public/js/routes/post.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\.\/thread-glance\.js"/);
  assert.match(source, /createThreadGlance\(/);
  const module = readFileSync(new URL("../public/js/thread-glance.js", import.meta.url), "utf8");
  assert.doesNotMatch(module, /innerHTML|\bapi\(/);
});
