// v4.0 plan 3, Task 2: the avatar topic module — upload intake, serving, and
// the moderation queue. Three sources feed it (handleAvatarReadRoute moves
// out of shared.mjs; handleAvatarUploadRoute + the avatar byte limits move
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
