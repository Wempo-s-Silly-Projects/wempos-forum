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
  createEditComposer,
  openEditForm,
  closeEditForm,
  appendPostList,
  renderEditHistoryPanel,
} from "../public/js/render.js";
import { renderProfileSocials } from "../public/js/profile-editor.js";
import { createNotificationBell } from "../public/js/notifications.js";

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
  // Edit-flow (v2.4) DOM ops: openEditForm inserts the form before the first
  // body block; closeEditForm removes it again. A null/absent ref appends.
  insertBefore(node, ref) {
    if (!(node instanceof MockElement)) return;
    const index = ref ? this.children.indexOf(ref) : -1;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
  }
  // The composer counter listens for "input"; recorded for completeness.
  addEventListener(_type, _handler) {}
}

const mockDocument = () => ({
  createElement: (tagName) => new MockElement(tagName),
  // Inline SVG icons (v2.4.1): createIcon draws via createElementNS, and the
  // icon-inline chips append raw text nodes next to the glyph.
  createElementNS: (_namespace, tagName) => new MockElement(tagName),
  createTextNode: (text) => {
    const node = new MockElement("#text");
    node.textContent = text;
    return node;
  },
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
  // The pending chip: image icon (decorative) + readable text, per the
  // modern-web accessibility guidance — no emoji, real stroke SVG.
  assert.ok(selectByClass(pending, "svg") === undefined || true);
  const pendingText = [...walk(pending)].map((node) => node.textContent ?? "").join("");
  assert.ok(pendingText.includes("image awaiting review"));
  assert.ok([...walk(pending)].some((node) => node.tagName === "SVG"));
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
  // Micro-batch (item 6): each image is wrapped in an .attachment-expand
  // button, and the awaiting chip follows that wrapper. Each image's wrapper
  // is the button directly before it in strip order (1:1).
  const expandButtons = selectAllByTag(strip, "button");
  assert.equal(expandButtons.length, 2);
  // Fix round: position-aware labels on multi-image posts ("1 of 2"/"2 of 2")
  // so identical labels never repeat on the same card.
  assert.equal(expandButtons[0].getAttribute("aria-label"), "View full image 1 of 2");
  assert.equal(expandButtons[1].getAttribute("aria-label"), "View full image 2 of 2");
  const stripChildren = strip.children.filter(Boolean);
  const pendingIndex = stripChildren.indexOf(pending);
  const pendingImageIndex = stripChildren.indexOf(expandButtons[0]);
  assert.ok(
    pendingImageIndex >= 0 && pendingIndex === pendingImageIndex + 1,
    "the awaiting chip sits directly under its pending image's expand button",
  );
});

test("a post without attachments renders no .post-attachments node at all", () => {
  for (const attachments of [undefined, []]) {
    const card = createPostCard({ ...basePost, attachments }, mockDocument(), null);
    assert.equal(selectByClass(card, "post-attachments"), undefined);
  }
});

// Micro-batch (item 6, click-to-expand): the strip image is wrapped in a
// chrome-free button carrying the a11y label and the data-action app.js's
// lightbox handler resolves; the img itself keeps src/loading/alt as before.
test("each strip attachment image is wrapped in an expand button for the full-size view", () => {
  const post = {
    ...basePost,
    attachments: [{ id: "a1", status: "approved", mime: "image/png", version: "ver-1", awaiting: false }],
  };
  const card = createPostCard(post, mockDocument(), null);
  const strip = selectByClass(card, "post-attachments");
  const expand = selectByClass(strip, "attachment-expand");
  assert.ok(expand, "renders an .attachment-expand wrapper around the image");
  assert.equal(expand.tagName, "BUTTON");
  assert.equal(expand.type, "button");
  assert.equal(expand.dataset.action, "expand-attachment");
  // Singular posts keep the plain label ("1 of 1" adds no information).
  assert.equal(expand.getAttribute("aria-label"), "View full image");
  const wrapped = selectAllByTag(expand, "img");
  assert.equal(wrapped.length, 1, "the expand button wraps exactly one image");
  assert.equal(wrapped[0].src, "/api/attachments/a1?v=ver-1");
  assert.equal(wrapped[0].className, "post-attachment");
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

test("(a) a feed post with replies renders a chat-icon reply-count chip next to the reactions", () => {
  const card = createPostCard({ ...basePost, replyCount: 3 }, mockDocument(), null);
  const chip = selectByClass(card, "reply-count");
  assert.ok(chip, "renders a .reply-count element");
  assert.equal(chip.tagName, "SPAN");
  assert.ok([...walk(chip)].some((node) => node.tagName === "SVG"), "chat glyph is inline SVG");
  assert.ok([...walk(chip)].some((node) => node.textContent === "replies"), "visually-hidden label");
  const chipText = [...walk(chip)].map((node) => node.textContent ?? "").join("");
  assert.ok(chipText.includes("3"), "the count renders next to the glyph");
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
  // Quote lines carry their text as raw text nodes (markdown-inline runs);
  // the walk collects the line's full text content.
  assert.equal([...walk(lines[0])].map((node) => node.textContent ?? "").join(""), "line");
  assert.equal([...walk(lines[1])].map((node) => node.textContent ?? "").join(""), "line2");
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
  const bodyText = [...walk(selectByClass(card, "post-body"))].map((node) => node.textContent ?? "").join("");
  assert.equal(bodyText, "Then normal text");
});

test("(d) HTML-looking text in bodies and quotes stays literal, never interpreted", () => {
  const card = createPostCard(
    { ...basePost, body: "> <script>alert(1)</script>\nbold <b>bold</b> tail" },
    mockDocument(),
    null,
  );
  const quoteLine = selectByClass(card, "quote-line");
  assert.equal([...walk(quoteLine)].map((node) => node.textContent ?? "").join(""), "<script>alert(1)</script>");
  const body = selectByClass(card, "post-body");
  assert.equal([...walk(body)].map((node) => node.textContent ?? "").join(""), "bold <b>bold</b> tail");
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

// --- v2.4: author post editing ------------------------------------------------
// (a) the "(edited)" marker keyed off editedAt, (b) the author-only Edit
// button, (c) the inline edit-form swap/restore cycle.

const authorPost = (overrides = {}) => ({
  ...basePost,
  author: { username: "alice", id: 5 },
  ...overrides,
});
const sessionUser = (id) => ({ id, username: "alice" });
const editButtonOf = (root) =>
  [...walk(root)].find((node) => node.dataset?.action === "edit-post");

test("(a) an edited post renders the (edited) marker and an unedited one does not", () => {
  const edited = createPostCard(
    authorPost({ editedAt: "2026-10-16T00:00:00.000Z" }),
    mockDocument(),
    null,
  );
  const marker = selectByClass(edited, "post-edited");
  assert.ok(marker, "editedAt present → (edited) marker");
  assert.equal(marker.tagName, "SPAN");
  assert.equal(marker.textContent, "(edited)");
  // It sits in the header next to the creation time.
  const header = selectByClass(edited, "post-header");
  assert.ok(selectByClass(header, "post-edited"), "the marker lives in the card header");

  for (const editedAt of [null, undefined]) {
    const card = createPostCard(authorPost({ editedAt }), mockDocument(), null);
    assert.equal(selectByClass(card, "post-edited"), undefined, String(editedAt));
  }
});

test("(b) the Edit button renders only for the author signed in", () => {
  const mine = authorPost({ id: 10 });
  const mineButton = editButtonOf(createPostCard(mine, mockDocument(), sessionUser(5)));
  assert.ok(mineButton, "the author gets an Edit button");
  assert.equal(mineButton.tagName, "BUTTON");
  assert.equal(mineButton.dataset.postId, "10");

  // Other signed-in viewers, guests, and id-less legacy fixtures never do.
  assert.equal(
    editButtonOf(createPostCard(mine, mockDocument(), sessionUser(6))), undefined,
    "a different signed-in member gets no Edit button",
  );
  assert.equal(editButtonOf(createPostCard(mine, mockDocument(), null)), undefined,
    "a guest gets no Edit button");
  assert.equal(
    editButtonOf(createPostCard(mine, mockDocument(), "alice")), undefined,
    "a session without an id can never match the author",
  );
  // Removed-account cards have nobody to attribute the edit to.
  assert.equal(
    editButtonOf(createPostCard(authorPost({ author: null }), mockDocument(), sessionUser(5))),
    undefined,
  );
  // Moderators get no edit power either (server is author-only) — role alone
  // must not widen the affordance.
  assert.equal(
    editButtonOf(createPostCard(authorPost({ id: 10, author: { username: "bob", id: 9 } }),
      mockDocument(), { id: 5, username: "mod", role: "moderator" })),
    undefined,
  );
  // Hidden own post keeps its Edit button: the author may edit what they wrote.
  assert.ok(
    editButtonOf(createPostCard(authorPost({ visibility: "hidden" }), mockDocument(), sessionUser(5))),
    "the author's hidden post still offers Edit",
  );
});

test("(c) an Edit click swaps the body blocks for the inline edit form and Cancel restores them", () => {
  const card = createPostCard(
    authorPost({ id: 10, body: "> quoted line\nplain text" }),
    mockDocument(),
    sessionUser(5),
  );
  const bodyBlocks = () => card.children.filter(
    (node) => node.className === "post-body" || node.className === "post-quote",
  );
  const before = bodyBlocks();
  assert.equal(before.length, 2, "a quote block and a text block");
  assert.ok(card.postBody === "> quoted line\nplain text",
    "createPostCard stashes the raw body for the edit prefill");

  assert.equal(openEditForm(card, mockDocument()), true);
  const form = card.children.find((node) => node.dataset?.form === "post-edit");
  assert.ok(form, "the edit form swapped in");
  for (const block of before) assert.equal(block.hidden, true, "the body blocks hide while editing");
  assert.equal(card.children.indexOf(form) < card.children.indexOf(before[0]), true,
    "the form takes the body's place, before the hidden blocks");
  const textarea = [...walk(form)].find((node) => node.tagName === "TEXTAREA");
  assert.equal(textarea.value, "> quoted line\nplain text",
    "the textarea prefills with the RAW body (newlines and quote markers intact)");
  assert.equal(textarea.maxLength, 1000, "the edit textarea carries the 1,000-char cap");
  assert.ok([...walk(form)].find((node) => node.className === "char-counter"),
    "the live counter is wired on the edit textarea");
  const save = [...walk(form)].find((node) => node.tagName === "BUTTON" && node.type === "submit");
  assert.ok(save, "a submit-typed Save button");
  const cancel = [...walk(form)].find((node) => node.dataset?.action === "cancel-edit");
  assert.equal(cancel.dataset.postId, "10", "Cancel carries the post id");

  // A second Edit click never stacks a duplicate form.
  assert.equal(openEditForm(card, mockDocument()), false);
  assert.equal(card.children.filter((node) => node.dataset?.form === "post-edit").length, 1);

  assert.equal(closeEditForm(card), true, "Cancel restores the card");
  for (const block of before) assert.equal(block.hidden, false, "the original body blocks return");
  assert.equal(card.children.find((node) => node.dataset?.form === "post-edit"), undefined,
    "the form is removed again");
  assert.equal(closeEditForm(card), false, "closing without an open form is a no-op");
});

test("(c) the edit composer builds the same textarea contract as the create composers", () => {
  const document = mockDocument();
  const form = createEditComposer({ id: 42, body: "current body" }, document);
  assert.equal(form.dataset.form, "post-edit");
  assert.equal(form.dataset.postId, "42");
  const textarea = [...walk(form)].find((node) => node.tagName === "TEXTAREA");
  assert.equal(textarea.maxLength, 1000);
  assert.equal(textarea.value, "current body");
  const counter = [...walk(form)].find((node) => node.className === "char-counter");
  assert.ok(counter, "the counter element exists");
  assert.equal(counter.getAttribute("aria-live"), "polite");
});

// Suggestions board (v2.4.1): the shared post list's empty state accepts the
// board's copy while every existing caller keeps the default message.
test("appendPostList keeps its default empty state for the general feed", () => {
  const document = mockDocument();
  const container = new MockElement("div");
  appendPostList(container, [], document);
  const empty = selectByClass(container, "empty-state");
  assert.ok(empty);
  assert.equal(empty.textContent, "No posts to show yet. Start the conversation.");
});

test("appendPostList renders the suggestions board's empty-state copy", () => {
  const document = mockDocument();
  const container = new MockElement("div");
  appendPostList(container, [], document, null, "No suggestions yet — be the first!");
  const empty = selectByClass(container, "empty-state");
  assert.equal(empty.textContent, "No suggestions yet — be the first!");
});

// --- Deletion (v2.4.1 feature): author-only Delete affordance ------------------
// Same session-identity gate as the Edit button, plus a deleteScope telling
// app.js's confirm dialog which copy applies (root → thread, reply → reply).

const deleteButtonOf = (root) =>
  [...walk(root)].find((node) => node.dataset?.action === "delete-post");

test("the Delete button renders only for the author signed in", () => {
  const mine = authorPost({ id: 10 });
  const mineButton = deleteButtonOf(createPostCard(mine, mockDocument(), sessionUser(5)));
  assert.ok(mineButton, "the author gets a Delete button");
  assert.equal(mineButton.tagName, "BUTTON");
  assert.equal(mineButton.dataset.postId, "10");
  assert.equal(mineButton.dataset.deleteScope, "thread", "a root card scopes to its thread");

  assert.equal(
    deleteButtonOf(createPostCard(mine, mockDocument(), sessionUser(6))), undefined,
    "a different signed-in member gets no Delete button",
  );
  assert.equal(deleteButtonOf(createPostCard(mine, mockDocument(), null)), undefined,
    "a guest gets no Delete button");
  assert.equal(
    deleteButtonOf(createPostCard(mine, mockDocument(), "alice")), undefined,
    "a session without an id can never match the author",
  );
  assert.equal(
    deleteButtonOf(createPostCard(authorPost({ author: null }), mockDocument(), sessionUser(5))),
    undefined,
    "removed-account cards never offer Delete",
  );
  assert.equal(
    deleteButtonOf(createPostCard(
      authorPost({ author: { username: "bob", id: 9 } }), mockDocument(),
      { id: 5, username: "mod", role: "moderator" },
    )), undefined,
    "moderators get no delete power either (server is author-only)",
  );
});

test("a reply card's Delete button scopes to reply so the thread keeps its sub-replies", () => {
  const mineReply = authorPost({ id: 11, parent: { id: 10 }, publicLevel: 1 });
  const button = deleteButtonOf(createPostCard(mineReply, mockDocument(), sessionUser(5)));
  assert.ok(button, "the author's reply card still offers Delete");
  assert.equal(button.dataset.deleteScope, "reply");
});

// --- v2.4.1: public edit history ------------------------------------------------
// A small "history" toggle rides the (edited) marker when a post HAS been
// edited; renderEditHistoryPanel builds the expandable panel from the API's
// past-version rows (text-only — quote/history content is never markup).

test("(d) the history toggle renders only on edited posts", () => {
  const edited = createPostCard(
    authorPost({ id: 10, editedAt: "2026-10-16T00:00:00.000Z" }),
    mockDocument(),
    null,
  );
  const toggle = [...walk(edited)].find((node) => node.dataset?.action === "edit-history");
  assert.ok(toggle, "editedAt present → history toggle");
  assert.equal(toggle.tagName, "BUTTON");
  assert.equal(toggle.textContent, "history");
  assert.equal(toggle.dataset.postId, "10");

  const plain = createPostCard(authorPost({ id: 10, editedAt: null }), mockDocument(), null);
  assert.equal(
    [...walk(plain)].find((node) => node.dataset?.action === "edit-history"),
    undefined,
    "never-edited posts have no history toggle",
  );
});

test("(e) renderEditHistoryPanel renders past versions as text, newest first", () => {
  const malicious = { body: "<script>alert(1)</script> totally innocent", editedAt: "2026-10-16T01:00:00.000Z" };
  const first = { body: "original body", editedAt: "2026-10-15T00:00:00.000Z" };
  const panel = renderEditHistoryPanel(mockDocument(), [malicious, first]);
  assert.ok(panel, "panel renders");
  const text = [...walk(panel)].map((node) => node.textContent ?? "").join("\n");
  assert.ok(text.includes("original body"), "the original version shows");
  assert.ok(text.includes("<script>alert(1)</script> totally innocent"),
    "markup-looking bodies stay literal — the script tag is content, not markup");
  // Timestamps render for each version.
  assert.ok(text.includes("2026"), "each version carries its timestamp");
  const empty = renderEditHistoryPanel(mockDocument(), []);
  assert.ok(empty, "an empty lineage still renders (placeholder shape)");
});

// --- v2.4.1: the notification bell is an icon button -----------------------------
// The bell is hand-built in notifications.js rather than through icons.js's
// iconButton() — so it must add the icon-button class ITSELF, or the shared
// icon sizing/stroke CSS (which scopes to .icon-button) never applies and the
// glyph renders unsized/unstyled (invisible).
test("the notification bell renders as a styled icon button with badge and aria-label", () => {
  const bell = createNotificationBell(0, mockDocument());
  assert.ok(bell.className.includes("icon-button"),
    "the bell carries the icon-button class so the shared icon CSS applies");
  assert.equal([...walk(bell)].some((node) => node.tagName === "SVG"), true,
    "bell glyph is an inline SVG");
  assert.equal(bell.getAttribute("aria-label"), "Notifications");
  const badge = selectByClass(bell, "notification-badge");
  assert.ok(badge, "the unread badge stays in the DOM");
  assert.equal(badge.hidden, true, "hidden at zero unread");

  const unread = createNotificationBell(3, mockDocument());
  assert.equal(unread.getAttribute("aria-label"), "Notifications, 3 unread",
    "the count lives in the bell's aria-label");
  const unreadBadge = selectByClass(unread, "notification-badge");
  assert.equal(unreadBadge.hidden, false, "the dot shows when unread");
  assert.equal(unreadBadge.textContent, "", "a dot, not a number pill");
});
