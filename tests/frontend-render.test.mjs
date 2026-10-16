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
import {
  replyAffordances,
  createPostCard,
  createSubReplyContainer,
} from "../public/js/render.js";
import { renderProfileSocials } from "../public/js/profile-editor.js";

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

// --- Task 3 (v2.3): thread presentation rendering ------------------------------
// (a) reply-count chip, (b) latestReplies preview rows, (c) cascade wrapper,
// (d) "> " line blockquotes, (e) collapsible profile socials.

const previewReply = (overrides = {}) => ({
  id: 22,
  authorUsername: "bob",
  avatarUrl: "/api/avatars/7",
  snippet: "hey\nthere",
  createdAt: "2026-10-15T01:00:00.000Z",
  subReplyCount: 0,
  ...overrides,
});

test("(a) a feed post with replies renders a 💬 reply-count chip next to the reactions", () => {
  const card = createPostCard({ ...basePost, replyCount: 3 }, mockDocument(), null);
  const chip = selectByClass(card, "reply-count");
  assert.ok(chip, "renders a .reply-count element");
  assert.equal(chip.tagName, "SPAN");
  assert.equal(chip.textContent, "💬 3");
});

test("(a) replyCount 0 or missing renders no reply-count chip", () => {
  for (const replyCount of [0, undefined]) {
    const card = createPostCard({ ...basePost, replyCount }, mockDocument(), null);
    assert.equal(selectByClass(card, "reply-count"), undefined, `replyCount ${replyCount}`);
  }
});

test("(b) latestReplies render as preview rows linking to the thread", () => {
  const replies = [
    previewReply(),
    previewReply({ id: 23, authorUsername: "cara", avatarUrl: "/api/avatars/8", snippet: "second", createdAt: "2026-10-15T01:30:00.000Z" }),
  ];
  const card = createPostCard({ ...basePost, latestReplies: replies }, mockDocument(), null);
  const container = selectByClass(card, "preview-replies");
  assert.ok(container, "renders a .preview-replies container");
  assert.ok(selectByClass(card, "preview-caption"), "a small Replies caption is present");
  const rows = container.children.filter((child) => child.className === "preview-reply");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    // App-link: an anchor to the post detail route the row navigates to.
    assert.equal(row.tagName, "A");
    assert.equal(row.href, "/posts/10");
    assert.ok(selectByClass(row, "preview-author"), "each row shows the author name");
    assert.ok(selectByClass(row, "preview-snippet"), "each row shows the snippet");
    const when = selectByClass(row, "preview-time");
    assert.ok(when, "each row shows a time");
    assert.equal(when.tagName, "TIME");
  }
});

test("(b) snippet newline whitespace is collapsed to one line for display", () => {
  const card = createPostCard({ ...basePost, latestReplies: [previewReply()] }, mockDocument(), null);
  const snippet = selectByClass(selectByClass(card, "preview-replies"), "preview-snippet");
  assert.equal(snippet.textContent, "hey there");
});

test("(b) a preview avatar renders when avatarUrl is supplied and is omitted otherwise", () => {
  const card = createPostCard(
    { ...basePost, latestReplies: [previewReply(), previewReply({ id: 24, avatarUrl: undefined })] },
    mockDocument(),
    null,
  );
  const rows = selectAllByTag(selectByClass(card, "preview-replies"), "a");
  const withAvatar = selectAllByTag(rows[0], "img");
  assert.equal(withAvatar.length, 1);
  assert.equal(withAvatar[0].src, "/api/avatars/7");
  assert.equal(withAvatar[0].alt, "");
  assert.equal(selectAllByTag(rows[1], "img").length, 0);
});

test("(b) more than 3 previews still render at most 3 rows", () => {
  const replies = [1, 2, 3, 4].map((id) => previewReply({ id }));
  const card = createPostCard({ ...basePost, latestReplies: replies }, mockDocument(), null);
  const rows = selectByClass(card, "preview-replies").children.filter(
    (child) => child.className === "preview-reply",
  );
  assert.equal(rows.length, 3);
});

test("(b) absent or empty latestReplies render no preview container", () => {
  for (const latestReplies of [undefined, []]) {
    const card = createPostCard({ ...basePost, latestReplies }, mockDocument(), null);
    assert.equal(selectByClass(card, "preview-replies"), undefined, String(latestReplies));
  }
});

test("(c) sub-reply cards render inside the cascade wrapper on the detail page", () => {
  const subReply = { ...basePost, id: 31, parent: { id: 2 }, publicLevel: 2 };
  const container = createSubReplyContainer(2, [subReply], mockDocument(), null);
  assert.equal(container.tagName, "DIV");
  // Wrapper class rides beside the existing grouping class app.js anchors on.
  assert.ok(container.className.includes("sub-replies"), "keeps the existing grouping class");
  assert.ok(container.className.includes("cascade-replies"), "adds the cascade wrapper class");
  assert.equal(container.dataset.subRepliesFor, "2");
  assert.ok(selectByClass(container, "post-card"), "the sub-reply card renders inside the wrapper");
});

test("(c) an empty sub-reply page renders the wrapper with its empty state", () => {
  const container = createSubReplyContainer(2, [], mockDocument(), null);
  assert.ok(selectByClass(container, "empty-state"));
});

test("(d) consecutive '> ' lines render as blockquote children, text only", () => {
  const card = createPostCard({ ...basePost, body: "> line\n> line2" }, mockDocument(), null);
  const quote = selectByClass(card, "post-quote");
  assert.ok(quote, "renders a .post-quote blockquote");
  assert.equal(quote.tagName, "BLOCKQUOTE");
  const lines = quote.children;
  assert.equal(lines.length, 2);
  assert.equal(lines[0].tagName, "P");
  assert.equal(lines[0].textContent, "line");
  assert.equal(lines[1].textContent, "line2");
});

test("(d) a leading quote block renders blockquote-then-text keeping order", () => {
  const card = createPostCard(
    { ...basePost, body: "> quoted first\nThen normal text" },
    mockDocument(),
    null,
  );
  const children = card.children;
  const quoteIndex = children.indexOf(selectByClass(card, "post-quote"));
  const bodyIndex = children.indexOf(selectByClass(card, "post-body"));
  assert.ok(quoteIndex >= 0 && bodyIndex === quoteIndex + 1, "quote block sits before the text block");
  assert.equal(selectByClass(card, "post-body").textContent, "Then normal text");
});

test("(d) HTML-looking text in bodies and quotes stays literal, never interpreted", () => {
  const card = createPostCard(
    { ...basePost, body: "> <script>alert(1)</script>\nbold <b>bold</b> tail" },
    mockDocument(),
    null,
  );
  const quoteLine = selectByClass(card, "quote-line");
  assert.equal(quoteLine.textContent, "<script>alert(1)</script>");
  const body = selectByClass(card, "post-body");
  assert.equal(body.textContent, "bold <b>bold</b> tail");
});

test("(d) bodies without quote lines keep the single pre-wrap .post-body paragraph", () => {
  const card = createPostCard(basePost, mockDocument(), null);
  assert.ok(selectByClass(card, "post-body"));
  assert.equal(selectByClass(card, "post-quote"), undefined);
});

test("(e) profile socials render as details/summary with the existing links inside", () => {
  const profile = { id: 7, socials: { github: "wempo", youtube: "wempo" }, polytoriaUsername: null };
  const own = renderProfileSocials(mockDocument(), profile, true);
  assert.ok(own, "renders the socials container");
  assert.equal(own.tagName, "DETAILS");
  assert.ok(own.className.includes("socials-details"));
  assert.equal(own.open, true, "the owner's own profile renders the section OPEN");
  const summary = selectByClass(own, "socials-summary");
  assert.ok(summary, "a count summary is present");
  assert.match(summary.textContent, /2/);
  const list = selectByClass(own, "profile-socials");
  assert.equal(list.tagName, "UL");
  assert.equal(list.children.length, 2, "the existing link items render inside the details");
});

test("(e) visitors' socials render closed and linkless profiles render nothing", () => {
  const profile = { id: 7, socials: { github: "wempo" }, polytoriaUsername: null };
  assert.equal(renderProfileSocials(mockDocument(), profile, false).open, false);
  for (const socials of [{}, undefined]) {
    assert.equal(
      renderProfileSocials(mockDocument(), { id: 7, socials, polytoriaUsername: null }, true),
      null,
    );
  }
});

test("every comment card (level-1 and sub-reply) carries a quote button; root cards do not", () => {
  const signedIn = "alice";
  const level1 = createPostCard(
    { ...basePost, id: 11, parent: { id: 10 }, publicLevel: 1, author: { username: "bob" } },
    mockDocument(),
    signedIn,
  );
  const quote = [...walk(level1)].find((node) => node.dataset?.action === "quote");
  assert.ok(quote, "level-1 comment cards get a Quote button");
  assert.equal(quote.dataset.quoteUsername, "bob");
  assert.equal(quote.dataset.quoteSnippet, "Look at this");
  const subReply = createPostCard(
    { ...basePost, id: 31, parent: { id: 11 }, publicLevel: 2 },
    mockDocument(),
    signedIn,
  );
  assert.ok([...walk(subReply)].find((node) => node.dataset?.action === "quote"), "sub-reply cards too");
  const root = createPostCard({ ...basePost }, mockDocument(), signedIn);
  assert.equal([...walk(root)].find((node) => node.dataset?.action === "quote"), undefined);
});

test("anonymous users see quote buttons rendered inert (disabled), like reactions", () => {
  const card = createPostCard(
    { ...basePost, id: 11, parent: { id: 10 }, publicLevel: 1, author: { username: "bob" } },
    mockDocument(),
    null,
  );
  const quote = [...walk(card)].find((node) => node.dataset?.action === "quote");
  assert.equal(quote.getAttribute("disabled") === "true", false);
  // The mock records element properties directly; a real DOM reflects
  // button.disabled = true as the disabled attribute.
  assert.equal(quote.disabled, true);
});
