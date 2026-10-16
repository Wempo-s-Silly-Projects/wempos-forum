// Unit tests for replyAffordances and the post-card attachment strip in
// public/js/render.js. replyAffordances is a pure helper; it decides which
// reply-related affordances a post card should render.
// publicLevel: 0 = root post, 1 = level-1 reply, 2 = level-2 reply-to-reply.
// Missing publicLevel is treated conservatively: replies are never offered
// unless the card is explicitly a level-1 row.
// DOM-free at import: render.js is pure ESM and safe to import under node --test.
// The attachment rendering tests use a tiny in-file mock DOM ("JSOM") because
// createPostCard builds real element trees; see MockElement below.
import test from "node:test";
import assert from "node:assert/strict";
import { replyAffordances, createPostCard } from "../public/js/render.js";

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
// --- Task 7: attachment rendering on post/reply cards -----------------------
// Minimal mock DOM ("JSOM"): elements are plain records exposing exactly the
// surface render.js uses (append, classList, dataset, setAttribute, plus
// writable src/alt/loading/dateTime/href properties). Assertions walk the
// produced tree directly, so no real browser or jsdom is needed.

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = "";
    this.textContent = "";
    this.dataset = {};
    this.attributes = {};
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node instanceof MockElement) this.children.push(node);
    }
  }
  get classList() {
    const self = this;
    const classes = new Set(this.className.split(" ").filter(Boolean));
    return {
      add(...names) {
        for (const name of names) classes.add(name);
        self.className = [...classes].join(" ");
      },
    };
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
}

const mockDocument = () => ({
  createElement: (tagName) => new MockElement(tagName),
});

function* walk(node) {
  yield node;
  for (const child of node.children) yield* walk(child);
}

const selectByClass = (root, className) =>
  [...walk(root)].find((node) => node.className.split(" ").includes(className));
const selectAllByTag = (root, tagName) =>
  [...walk(root)].filter((node) => node.tagName === tagName.toUpperCase());

const basePost = {
  id: 10,
  publicLevel: 0,
  author: { username: "alice" },
  createdAt: "2026-10-15T00:00:00.000Z",
  body: "Look at this",
};

test("a post with an approved attachment renders a lazy, empty-alt image", () => {
  const post = {
    ...basePost,
    attachments: [{ id: "a1", status: "approved", mime: "image/png", version: "ver-1", awaiting: false }],
  };
  const card = createPostCard(post, mockDocument(), null);
  const strip = selectByClass(card, "post-attachments");
  assert.ok(strip, "renders a .post-attachments container under the body text");
  const image = selectAllByTag(strip, "img")[0];
  assert.ok(image, "renders an <img> for the approved attachment");
  assert.equal(image.src, "/api/attachments/a1?v=ver-1");
  // Rendered as the loading property, which reflects to loading="lazy" in a
  // real DOM — the same convention the avatar <img> already uses.
  assert.equal(image.loading, "lazy");
  assert.equal(image.alt, "");
});

test("an awaiting attachment renders the pending image INLINE plus the awaiting chip", () => {
  const post = {
    ...basePost,
    attachments: [
      { id: "p1", status: "pending", mime: "image/png", version: "ver-2", awaiting: true },
      { id: "a1", status: "approved", mime: "image/png", version: "ver-1", awaiting: false },
    ],
  };
  const card = createPostCard(post, mockDocument(), null);
  const strip = selectByClass(card, "post-attachments");
  const pending = selectByClass(strip, "attachment-pending");
  assert.ok(pending, "still renders the .attachment-pending chip");
  assert.equal(pending.textContent, "🖼️ image awaiting review");
  // Both rows become <img>s now: pending rows reach ONLY the author and mods
  // (the backend omits them from everyone else's payload), and for those
  // viewers the pending URL resolves, so the author sees the real image with
  // the chip under it. Images keep payload order; the chip follows its image.
  const images = selectAllByTag(strip, "img");
  assert.equal(images.length, 2);
  assert.equal(images[0].src, "/api/attachments/p1?v=ver-2");
  assert.equal(images[0].loading, "lazy");
  assert.equal(images[0].alt, "");
  assert.equal(images[1].src, "/api/attachments/a1?v=ver-1");
  const stripChildren = strip.children.filter(Boolean);
  const pendingIndex = stripChildren.indexOf(pending);
  const pendingImageIndex = stripChildren.indexOf(images[0]);
  assert.ok(
    pendingImageIndex >= 0 && pendingIndex === pendingImageIndex + 1,
    "the awaiting chip sits directly under its pending image",
  );
});

test("a post without attachments renders no .post-attachments node at all", () => {
  for (const attachments of [undefined, []]) {
    const card = createPostCard({ ...basePost, attachments }, mockDocument(), null);
    assert.equal(selectByClass(card, "post-attachments"), undefined);
  }
});

test("a level-1 reply renders its attachments strip like a root post", () => {
  const reply = {
    ...basePost,
    id: 11,
    parent: { id: 10 },
    publicLevel: 1,
    subReplyCount: 0,
    attachments: [{ id: "r1", status: "approved", mime: "image/gif", version: "ver-3", awaiting: false }],
  };
  const card = createPostCard(reply, mockDocument(), null);
  const strip = selectByClass(card, "post-attachments");
  assert.ok(strip, "replies render .post-attachments too");
  const image = selectAllByTag(strip, "img")[0];
  assert.equal(image.src, "/api/attachments/r1?v=ver-3");
  assert.equal(image.loading, "lazy");
});
