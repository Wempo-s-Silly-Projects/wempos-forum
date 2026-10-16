import { attachmentUrl } from "./attachments.js";
import { createTextarea } from "./forms.js";
import { COMPOSER_MAX_CHARS } from "./composer-limits.js";
import { collapseWhitespace } from "./quotes.js";

const createElement = (document, tagName, className, text) => {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

// Pure, DOM-free. publicLevel: 0 = root post, 1 = level-1 reply, 2 = level-2
// reply-to-reply. A missing publicLevel is treated conservatively: replying is
// only offered when a card is explicitly a level-1 row, so stale or
// un-upgraded payloads can never surface a button for a level-2 target
// (server-side forbidden). subReplyCount is only supplied for level-1 rows.
export const replyAffordances = (post, currentUser = null) => {
  const canReply = Boolean(currentUser) && Boolean(post.parent) && post.publicLevel === 1;
  const expandCount = post.subReplyCount > 0 ? post.subReplyCount : 0;
  return { canReply, canExpand: expandCount > 0, expandCount };
};

// Attachment rows Task 5 serializes onto every post/reply:
// { id, status, mime, version, awaiting }. Approved rows serve publicly under
// a versioned URL — safe for a lazy <img> with an empty alt. Pending rows
// (awaiting: true) are only ever present in payloads the viewer authored or
// can moderate (the backend omits them for everyone else), so the pending URL
// resolves for exactly the viewers who receive one: the author and mods see
// the actual image inline, followed by the "awaiting review" chip; other
// users get the row — and this code path — never. Post payloads without
// attachments (or with an empty array) render nothing extra at all. Each image
// is wrapped in a chrome-free .attachment-expand button (micro-batch): the
// strip only CSS-caps the rendering, the stored bytes are full-size, so the
// button's data-action opens #attachment-lightbox (app.js) with the same URL
// uncapped.
const renderAttachments = (post, document, article) => {
  const attachments = Array.isArray(post.attachments) ? post.attachments : [];
  if (!attachments.length) return;
  const strip = createElement(document, "div", "post-attachments");
  const total = attachments.length;
  for (const [index, attachment] of attachments.entries()) {
    const image = createElement(document, "img", "post-attachment");
    image.src = attachmentUrl(attachment);
    image.alt = "";
    image.loading = "lazy";
    const expand = createElement(document, "button", "attachment-expand");
    expand.type = "button";
    expand.dataset.action = "expand-attachment";
    // Position-aware labels: identical labels on every image of a multi-image
    // post tell a screen-reader user nothing about which was activated.
    expand.setAttribute(
      "aria-label",
      total > 1 ? `View full image ${index + 1} of ${total}` : "View full image",
    );
    expand.append(image);
    strip.append(expand);
    if (attachment.awaiting) {
      strip.append(
        createElement(document, "p", "attachment-pending", "🖼️ image awaiting review"),
      );
    }
  }
  article.append(strip);
};

// Body rendering (plan v2.3): quote is a display-only text convention.
// Consecutive body lines whose TRIMMED form starts with "> " become one
// <blockquote> of text-only children; the surrounding text stays pre-wrap
// .post-body paragraphs, so a leading quote block renders
// blockquote-then-text. All content is attached through textContent (the
// createElement text argument) — a body containing "<b>" or "<script>"
// keeps rendering as literal text, exactly as before.
const bodyLineBlocks = (body) => {
  const lines = String(body ?? "").split("\n");
  const blocks = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const isQuote = trimmed.startsWith("> ");
    const last = blocks[blocks.length - 1];
    const content = isQuote ? trimmed.slice(2) : line;
    if (last && last.quote === isQuote) last.text.push(content);
    else blocks.push({ quote: isQuote, text: [content] });
  }
  return blocks;
};

const renderBodyBlocks = (post, document, article) => {
  for (const block of bodyLineBlocks(post.body)) {
    if (block.quote) {
      const quote = createElement(document, "blockquote", "post-quote");
      for (const line of block.text) {
        quote.append(createElement(document, "p", "quote-line", line));
      }
      article.append(quote);
    } else {
      article.append(createElement(document, "p", "post-body", block.text.join("\n")));
    }
  }
};

// Latest-replies preview rows on feed cards (plan v2.3): up to three compact,
// app-link rows (author + single-line snippet + time) into the thread. The
// payload's snippets are raw text (newlines included), displayed only through
// collapseWhitespace + textContent. Rows render only when the feed decorated
// the card with previews — data-driven, so payloads without latestReplies
// (detail route, older profile pages) look exactly like before.
const renderLatestReplies = (post, document, article) => {
  const latest = Array.isArray(post.latestReplies) ? post.latestReplies.slice(0, 3) : [];
  if (!latest.length) return;
  const container = createElement(document, "div", "preview-replies");
  container.append(createElement(document, "span", "preview-caption", "Replies"));
  for (const reply of latest) {
    const row = createElement(document, "a", "preview-reply");
    row.href = `/posts/${post.id}`;
    if (reply.avatarUrl) {
      const avatar = createElement(document, "img", "avatar preview-avatar");
      avatar.src = reply.avatarUrl;
      avatar.alt = "";
      row.append(avatar);
    }
    row.append(createElement(document, "span", "preview-author", reply.authorUsername ?? ""));
    row.append(createElement(document, "span", "preview-snippet", collapseWhitespace(reply.snippet)));
    const when = createElement(document, "time", "preview-time");
    when.dateTime = reply.createdAt;
    when.textContent = new Date(reply.createdAt).toLocaleString();
    row.append(when);
    container.append(row);
  }
  article.append(container);
};

export const createPostCard = (post, document, currentUser = null) => {
  const article = createElement(document, "article", "post-card");
  article.dataset.postId = String(post.id);
  // Raw body rides as a plain JS property (never markup — the same convention
  // as the composer's form.composerFiles) so the author's inline edit form can
  // prefill the exact original text, newlines and quote markers included —
  // the rendered .post-body/.post-quote blocks are lossy and must not be
  // re-parsed back into a draft.
  article.postBody = String(post.body ?? "");
  if (post.visibility === "hidden") article.classList.add("post-hidden");

  const header = createElement(document, "header", "post-header");
  const author = createElement(document, "div", "post-author");
  if (post.author) {
    if (post.author.avatarUrl) {
      const avatar = createElement(document, "img", "avatar");
      avatar.src = post.author.avatarUrl;
      avatar.alt = `Avatar of ${post.author.username}`;
      author.append(avatar);
    }
    const profileLink = createElement(document, "a", "author-name", post.author.username);
    profileLink.href = `/users/${encodeURIComponent(post.author.username)}`;
    author.append(profileLink);
  } else {
    author.append(createElement(document, "span", "author-name", "Removed account"));
  }
  const time = createElement(document, "time", "post-time");
  // lastActivityAt (bump activity, spec §4) is exposed machine-readably; the
  // visible label intentionally stays the creation time.
  time.dateTime = post.lastActivityAt ?? post.createdAt;
  time.textContent = new Date(post.createdAt).toLocaleString();
  header.append(author, time);
  // (edited) marker (v2.4): data-driven off editedAt, which every serialized
  // post carries (null until the author's first edit). A muted token-styled
  // token next to the creation time; never a link or tooltip markup.
  if (post.editedAt) {
    header.append(createElement(document, "span", "post-edited", "(edited)"));
    // Edit history (v2.4.1): a small toggle that fetches and expands the
    // post's past versions. Everyone gets it — the point is that edits can't
    // quietly rewrite context (trouserpants' anti-abuse ask).
    const historyToggle = createElement(document, "button", "post-edited-history", "history");
    historyToggle.type = "button";
    historyToggle.dataset.action = "edit-history";
    historyToggle.dataset.postId = String(post.id);
    header.append(historyToggle);
  }
  article.append(header);

  renderBodyBlocks(post, document, article);
  if (post.parent) {
    const parentLink = createElement(document, "a", "parent-context", `In reply to: ${post.parent.body}`);
    parentLink.href = `/posts/${post.parent.id}`;
    article.append(parentLink);
  }

  renderAttachments(post, document, article);
  renderLatestReplies(post, document, article);

  const actions = createElement(document, "div", "post-actions");
  for (const [value, label, count] of [
    ["like", "Like", post.likeCount ?? 0],
    ["dislike", "Dislike", post.dislikeCount ?? 0],
  ]) {
    const button = createElement(document, "button", "button button-quiet", `${label} ${count}`);
    button.type = "button";
    button.dataset.action = "reaction";
    button.dataset.postId = String(post.id);
    button.dataset.value = value;
    button.setAttribute("aria-pressed", String(post.viewerReaction === value));
    // Stateful toggle: app.js sends DELETE when active, PUT when not.
    if (post.viewerReaction === value) button.dataset.state = "active";
    if (!currentUser) button.disabled = true;
    actions.append(button);
  }
  // Reply-count chip (plan v2.3): only threads carrying comments get one;
  // replyCount 0 (or an un-decorated payload) renders no chip at all.
  // Number() on undefined yields NaN, so the guard handles both shapes.
  if (Number(post.replyCount) > 0) {
    actions.append(createElement(document, "span", "reply-count", `💬 ${post.replyCount}`));
  }
  const threadLink = createElement(document, "a", "button button-quiet", "Open post and replies");
  threadLink.href = `/posts/${post.id}`;
  actions.append(threadLink);
  if (currentUser && post.visibility !== "hidden") {
    const report = createElement(document, "button", "button button-quiet", "Report");
    report.type = "button";
    report.dataset.action = "report";
    report.dataset.postId = String(post.id);
    actions.append(report);
  }
  // Edit affordance (v2.4): author-only by session identity. The renderer sees
  // the session user object (app.js passes session.user), so the id comparison
  // is exact; guests and any viewer without an id (undefined id → NaN → never
  // equal) never see the button, and moderators get no edit power either —
  // mirroring the server's author-only gate. Unlike Report, a hidden own post
  // keeps its Edit button: the author may edit what they authored.
  if (currentUser && post.author && Number(currentUser.id) === Number(post.author.id)) {
    const editButton = createElement(document, "button", "button button-quiet", "Edit");
    editButton.type = "button";
    editButton.dataset.action = "edit-post";
    editButton.dataset.postId = String(post.id);
    actions.append(editButton);
  }
  // Delete affordance (v2.4.1 feature): author-only, the exact same session
  // identity gate as the Edit button above — guests, other members, and
  // moderators never see it, while a hidden own post keeps it like it keeps
  // Edit. deleteScope tells app.js's confirm dialog which copy to show and
  // which client behavior to apply after the server confirms: a root card
  // ("thread") takes the whole conversation with it, while a reply card
  // ("reply") keeps the thread (sub-replies are reparented by the server).
  if (currentUser && post.author && Number(currentUser.id) === Number(post.author.id)) {
    const deleteButton = createElement(document, "button", "button button-quiet", "Delete");
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete-post";
    deleteButton.dataset.postId = String(post.id);
    deleteButton.dataset.deleteScope = post.parent ? "reply" : "thread";
    actions.append(deleteButton);
  }
  // Reply affordance: same strict rule as replyAffordances — signed-in users
  // on explicitly level-1 rows only (publicLevel 2 and undefined publicLevel
  // never show it; replying to level-2 targets is server-forbidden).
  if (replyAffordances(post, currentUser).canReply) {
    const replyButton = createElement(document, "button", "button button-quiet", "Reply");
    replyButton.type = "button";
    replyButton.dataset.action = "reply-to";
    replyButton.dataset.postId = String(post.id);
    actions.append(replyButton);
  }
  // Quote affordance (plan v2.3): comment cards — level-1 and sub-reply rows —
  // carry a Quote button. The handler in app.js prefills the CURRENT thread's
  // reply composer through a textarea .value assignment (never HTML). The
  // single-line source snippet rides on the button's dataset (dataset
  // assignment is a property write, not markup); truncation to the 120-char
  // prefill limit happens in quotes.js at prefill time. Cards by a removed
  // account have nothing to attribute the quote to and skip the button.
  if (post.author && post.parent) {
    const quoteButton = createElement(document, "button", "button button-quiet", "Quote");
    quoteButton.type = "button";
    quoteButton.dataset.action = "quote";
    quoteButton.dataset.postId = String(post.id);
    quoteButton.dataset.quoteUsername = post.author.username;
    quoteButton.dataset.quoteSnippet = collapseWhitespace(post.body);
    if (!currentUser) quoteButton.disabled = true;
    actions.append(quoteButton);
  }
  if (post.subReplyCount > 0) {
    const expandButton = createElement(
      document,
      "button",
      "button button-quiet",
      `Show ${post.subReplyCount} replies`,
    );
    expandButton.type = "button";
    expandButton.dataset.action = "expand-sub-replies";
    expandButton.dataset.postId = String(post.id);
    expandButton.setAttribute("aria-expanded", "false");
    actions.append(expandButton);
  }
  article.append(actions);
  return article;
}

// emptyText (v2.4.1): the suggestions route passes its own message ("No
// suggestions yet — be the first!"); every existing caller omits it and keeps
// the general feed's copy byte-identical.
export function appendPostList(container, posts, document, currentUser = null,
  emptyText = "No posts to show yet. Start the conversation.") {
  if (!posts.length) {
    container.append(createElement(document, "p", "empty-state", emptyText));
    return;
  }
  const list = createElement(document, "div", "post-list");
  for (const post of posts) list.append(createPostCard(post, document, currentUser));
  container.append(list);
}

// Cascade wrapper (plan v2.3): the container div around a level-1 parent's
// sub-replies on the detail page. app.js's toggleSubReplies keeps owning the
// expand/collapse mechanics and the fetch; this only builds the wrapper the
// cascade CSS targets, reusing the existing grouping class .sub-replies and
// adding the new .cascade-replies treatment.
export const createSubReplyContainer = (postId, replies, document, currentUser = null) => {
  const container = createElement(document, "div", "sub-replies cascade-replies");
  container.dataset.subRepliesFor = String(postId);
  if (!replies.length) {
    container.append(createElement(document, "p", "empty-state", "No replies to show yet."));
    return container;
  }
  for (const reply of replies) container.append(createPostCard(reply, document, currentUser));
  return container;
};

// Inline edit composer (v2.4): the form an author's Edit click swaps into the
// card. Same textarea contract as the create composers — maxLength 1,000 with
// the shared live counter (forms.js createTextarea) — prefilled with the
// post's CURRENT body through the value option. No Turnstile slot (owner-
// approved default: the editor is session-verified and the server reuses
// create's filter/limit gates) and no attachment row: edits are text-only in
// v1, attachments stay exactly as originally posted.
export const createEditComposer = (post, document) => {
  const form = createElement(document, "form", "edit-composer");
  form.dataset.form = "post-edit";
  form.dataset.postId = String(post.id);
  form.append(createTextarea(document, {
    id: `post-edit-${post.id}-body`, name: "body", label: "Edit post",
    rows: 4, maxLength: COMPOSER_MAX_CHARS, required: true, counter: true,
    value: post.body,
  }));
  const actions = createElement(document, "div", "post-actions form-actions");
  const save = createElement(document, "button", "button button-primary", "Save");
  save.type = "submit";
  const cancel = createElement(document, "button", "button button-quiet", "Cancel");
  cancel.type = "button";
  cancel.dataset.action = "cancel-edit";
  cancel.dataset.postId = String(post.id);
  actions.append(save, cancel);
  form.append(actions);
  return form;
};

// The card blocks an open edit form replaces: the rendered body paragraphs and
// quote blockquotes. Attachments, previews, and the action row stay visible —
// edits are text-only, so everything else is untouched.
const isEditBodyBlock = (node) =>
  node.className === "post-body" || node.className === "post-quote";

// Swap (openEditForm) / restore (closeEditForm) are pure DOM-in/DOM-out so the
// mock-element render suite can pin the whole cycle. The card's raw body must
// already ride article.postBody (createPostCard sets it); without it there is
// nothing trustworthy to prefill, so the swap is refused rather than reconstructing
// a draft from lossy rendered text.
export const openEditForm = (article, document) => {
  if (!article || typeof article.postBody !== "string") return false;
  const children = [...article.children];
  if (children.some((node) => node.dataset && node.dataset.form === "post-edit")) return false;
  const blocks = children.filter(isEditBodyBlock);
  const form = createEditComposer(
    { id: Number(article.dataset.postId), body: article.postBody },
    document,
  );
  // The hidden blocks ride the form as a plain property so cancel can restore
  // the exact original nodes.
  form.editHiddenBlocks = blocks;
  for (const block of blocks) block.hidden = true;
  article.insertBefore(form, blocks[0] ?? null);
  return true;
};

export const closeEditForm = (article) => {
  if (!article) return false;
  const form = [...article.children].find(
    (node) => node.dataset && node.dataset.form === "post-edit",
  );
  if (!form) return false;
  for (const block of form.editHiddenBlocks ?? []) block.hidden = false;
  article.removeChild(form);
  return true;
};

// Edit-history panel (v2.4.1): the past versions returned by
// GET /api/posts/:id/edits, newest first, as plain text rows. Bodies are user
// content — textContent only, never markup. An empty lineage still renders a
// muted placeholder so the toggle never feels broken.
export function renderEditHistoryPanel(document, edits) {
  const panel = createElement(document, "div", "edit-history-panel");
  const title = createElement(document, "p", "edit-history-title", "Earlier versions (newest first)");
  panel.append(title);
  if (!Array.isArray(edits) || edits.length === 0) {
    panel.append(createElement(document, "p", "edit-history-empty", "No earlier versions."));
    return panel;
  }
  for (const edit of edits) {
    const entry = createElement(document, "div", "edit-history-entry");
    const time = createElement(document, "time", "edit-history-time");
    time.dateTime = edit.editedAt;
    time.textContent = new Date(edit.editedAt).toLocaleString();
    const body = createElement(document, "p", "edit-history-body", String(edit.body ?? ""));
    entry.append(time, body);
    panel.append(entry);
  }
  return panel;
}
