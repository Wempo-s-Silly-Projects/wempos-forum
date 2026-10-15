// Unit tests for replyAffordances (public/js/render.js) — the pure helper that
// decides which reply-related affordances a post card should render.
// publicLevel: 0 = root post, 1 = level-1 reply, 2 = level-2 reply-to-reply.
// Missing publicLevel is treated conservatively: replies are never offered
// unless the card is explicitly a level-1 row.
// DOM-free: render.js is pure ESM and safe to import under node --test.
import test from "node:test";
import assert from "node:assert/strict";
import { replyAffordances } from "../public/js/render.js";

const rootPost = { id: 1, publicLevel: 0, subReplyCount: 0 };
const level1Reply = { id: 2, parent: { id: 1 }, publicLevel: 1, subReplyCount: 0 };

test("anonymous users can never be offered a reply affordance", () => {
  assert.equal(replyAffordances(level1Reply, null).canReply, false);
});

test("signed-in root posts get no reply affordance", () => {
  assert.equal(replyAffordances(rootPost, "alice").canReply, false);
});

test("signed-in level-1 replies get a reply affordance", () => {
  assert.equal(replyAffordances(level1Reply, "alice").canReply, true);
});

test("missing publicLevel is treated conservatively (canReply false)", () => {
  const noLevel = { id: 3, parent: { id: 1 } };
  const result = replyAffordances(noLevel, "alice");
  assert.equal(result.canReply, false);
});

test("level-2 replies never get a reply affordance", () => {
  const level2Reply = { id: 4, parent: { id: 2 }, publicLevel: 2, subReplyCount: 0 };
  assert.equal(replyAffordances(level2Reply, "alice").canReply, false);
});

test("signed-in level-1 reply without parent gets no reply affordance", () => {
  const orphan = { id: 5, publicLevel: 1, subReplyCount: 0 };
  assert.equal(replyAffordances(orphan, "alice").canReply, false);
});

test("subReplyCount 0 means no expand affordance", () => {
  const result = replyAffordances(level1Reply, "alice");
  assert.equal(result.canExpand, false);
  assert.equal(result.expandCount, 0);
});

test("subReplyCount 3 means an expand affordance with the count", () => {
  const hasSubReplies = { id: 6, parent: { id: 1 }, publicLevel: 1, subReplyCount: 3 };
  const result = replyAffordances(hasSubReplies, "alice");
  assert.equal(result.canExpand, true);
  assert.equal(result.expandCount, 3);
});

test("missing subReplyCount means no expand affordance", () => {
  const result = replyAffordances({ id: 7, parent: { id: 1 }, publicLevel: 1 }, "alice");
  assert.equal(result.canExpand, false);
  assert.equal(result.expandCount, 0);
});

test("expand affordance is independent of reply affordance and session", () => {
  const hasSubReplies = { id: 8, parent: { id: 1 }, publicLevel: 1, subReplyCount: 2 };
  const anonymous = replyAffordances(hasSubReplies, null);
  assert.equal(anonymous.canExpand, true);
  assert.equal(anonymous.expandCount, 2);
  assert.equal(anonymous.canReply, false);
});