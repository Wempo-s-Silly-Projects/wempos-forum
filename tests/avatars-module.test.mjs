// Copyright 2026 YourLocalGoober
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

// v4.0 plan 3, Task 2: the avatar topic module — upload intake, serving, and
// the moderation queue. Three sources feed it (handleAvatarReadRoute moves
// out of (then-)shared.mjs; handleAvatarUploadRoute + the avatar byte limits move
// out of profiles.mjs; the queue + resolve + moderation triple moves out of
// moderation.mjs), per the spec's sentence that avatars own their whole
// lifecycle. This pin holds the module's export surface steady.
import test from "node:test";
import assert from "node:assert/strict";
import * as avatars from "../api/avatars.mjs";

test("avatars.mjs exports the avatar lifecycle surface", () => {
  for (const name of [
    "handleAvatarReadRoute",
    "handleAvatarUploadRoute",
    "handleAvatarQueueRoute",
    "resolveAvatarPending",
    "handleAvatarModerationRoute",
  ]) {
    assert.equal(typeof avatars[name], "function", `avatars.mjs must export ${name}`);
  }
  assert.equal(avatars.MAX_AVATAR_BYTES, 1024 * 1024);
  assert.equal(avatars.MAX_AVATAR_REQUEST_BYTES, 1024 * 1024 + 64 * 1024);
});
