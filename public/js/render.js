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

// 5.0 wave 3 (the post thread slice): the card machinery re-expresses on the
// vendored framework — frontload/dom's el() replaces the local createElement
// twin node for node (user text rides textContent, classes ride class names,
// nothing parses markup — the same CSP law, now enforced by construction).
// The one behavior change the wave plans: a card’s Report button leaves the
// shared report dialog for the /posts/:id/report task page — a real link,
// addressable, reloadable (the report dialog itself now serves the profile
// flow until its wave retires it too). Markdown parsing, attachment URLs,
// the edit-form swap cycle and every aria contract ride verbatim.
import { el } from "./vendor/frontload/dom.mjs";
import { attachmentUrl } from "./attachments.js";
import { createIcon } from "./icons.js";
import { parseBlocks, parseInline } from "./markdown.js";
import { createTextarea } from "./forms.js";
import { COMPOSER_MAX_CHARS } from "./composer-limits.js";
import { collapseWhitespace } from "./quotes.js";
import { renderPollBlock } from "./polls.js";


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
  const strip = el("div", { class: "post-attachments" });
  const total = attachments.length;
  for (const [index, attachment] of attachments.entries()) {
    const image = el("img", { class: "post-attachment" });
    image.src = attachmentUrl(attachment);
    image.alt = "";
    image.loading = "lazy";
    const expand = el("button", { class: "attachment-expand" });
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
      const pending = el("p", { class: "attachment-pending icon-inline" });
      pending.append(createIcon(document, "image"), document.createTextNode("image awaiting review"));
      strip.append(pending);
    }
  }
  article.append(strip);
};

// Body rendering (plan v2.3): quote is a display-only text convention.
// Consecutive body lines whose TRIMMED form starts with "> " become one
// <blockquote> of text-only children; the surrounding text stays pre-wrap
// .post-body paragraphs, so a leading quote block renders
// blockquote-then-text. All content is attached through textContent (the
// el's text argument) — a body containing "<b>" or "<script>"
// keeps rendering as literal text, exactly as before.


// Body rendering (v2.5): markdown subset blocks — fenced code, headings,
// lists, quotes, paragraphs — with markdown-INLINE runs (bold/italics/code/
// safe links) inside every kind except code fences (raw). HTML is never
// interpreted: all text lands through textContent, so "<b>" and "<script>"
// stay literal. Images never render (the raw "![…](…)" stays text).
export const renderBodyBlocks = (post, document, article) => {
  for (const block of parseBlocks(post.body)) {
    if (block.kind === "code") {
      const pre = el("pre", { class: "post-codeblock" });
      pre.append(el("code", { text: block.text.join("\n") }));
      article.append(pre);
      continue;
    }
    if (block.kind === "heading") {
      const tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
      const heading = el(tag, { class: "post-heading" });
      renderInline(document, heading, block.text.join("\n"));
      article.append(heading);
      continue;
    }
    if (block.kind === "list") {
      const list = el("ul", { class: "md-list" });
      for (const item of block.text) {
        const entry = el("li", { class: "md-list-item" });
        renderInline(document, entry, item);
        list.append(entry);
      }
      article.append(list);
      continue;
    }
    if (block.kind === "quote") {
      const quote = el("blockquote", { class: "post-quote" });
      for (const line of block.text) {
        const quoteLine = el("p", { class: "quote-line" });
        renderInline(document, quoteLine, line);
        quote.append(quoteLine);
      }
      article.append(quote);
      continue;
    }
    const paragraph = el("p", { class: "post-body" });
    renderInline(document, paragraph, block.text.join("\n"));
    article.append(paragraph);
  }
};

// Markdown-inline runs appended INTO an existing element (link hrefs are
// scheme-checked by isSafeLinkUrl in markdown.js; anything unsafe renders
// as literal text via textContent — no exception escapes here).
function renderInline(document, target, text) {
  try {
    for (const node of parseInline(document, text)) target.append(node);
  } catch {
    target.textContent = String(text ?? "");
  }
}

// Latest-replies preview rows on feed cards (plan v2.3): up to three compact,
// app-link rows (author + single-line snippet + time) into the thread. The
// payload's snippets are raw text (newlines included), displayed only through
// collapseWhitespace + textContent. Rows render only when the feed decorated
// the card with previews — data-driven, so payloads without latestReplies
// (detail route, older profile pages) look exactly like before.
const renderLatestReplies = (post, document, article) => {
  const latest = Array.isArray(post.latestReplies) ? post.latestReplies.slice(0, 3) : [];
  if (!latest.length) return;
  const container = el("div", { class: "preview-replies" });
  container.append(el("span", { class: "preview-caption", text: "Replies" }));
  for (const reply of latest) {
    const row = el("a", { class: "preview-reply" });
    row.href = `/posts/${post.id}`;
    if (reply.avatarUrl) {
      const avatar = el("img", { class: "avatar preview-avatar" });
      avatar.src = reply.avatarUrl;
      avatar.alt = "";
      row.append(avatar);
    }
    row.append(el("span", { class: "preview-author", text: reply.authorUsername ?? "" }));
    row.append(el("span", { class: "preview-snippet", text: collapseWhitespace(reply.snippet) }));
    const when = el("time", { class: "preview-time" });
    when.dateTime = reply.createdAt;
    when.textContent = new Date(reply.createdAt).toLocaleString();
    row.append(when);
    container.append(row);
  }
  article.append(container);
};

export const createPostCard = (post, document, currentUser = null) => {
  const article = el("article", { class: "post-card" });
  article.dataset.postId = String(post.id);
  // Raw body rides as a plain JS property (never markup — the same convention
  // as the composer's form.composerFiles) so the author's inline edit form can
  // prefill the exact original text, newlines and quote markers included —
  // the rendered body blocks (all kinds) are lossy and must not be
  // re-parsed back into a draft.
  article.postBody = String(post.body ?? "");
  if (post.visibility === "hidden") article.classList.add("post-hidden");

  const header = el("header", { class: "post-header" });
  const author = el("div", { class: "post-author" });
  if (post.author) {
    // Name color on cards (any hex, v3.0.2): the server normalized the
    // accent to a #rrggbb hex, so it rides as a CSS custom property WRITE
    // (CSSOM assignment — CSP-pure, no class string, no inline style text).
    if (post.author.profileAccent) {
      article.style.setProperty("--profile-accent", post.author.profileAccent);
    }
    if (post.author.avatarUrl) {
      const avatar = el("img", { class: "avatar" });
      avatar.src = post.author.avatarUrl;
      avatar.alt = `Avatar of ${post.author.username}`;
      author.append(avatar);
    }
    const profileLink = el("a", { class: "author-name", text: post.author.username });
    profileLink.href = `/users/${encodeURIComponent(post.author.username)}`;
    author.append(profileLink);
    // Role badge (v3.1): staff are chipped next to the name — Owner or Admin,
    // from the server-mapped public role. Members carry null and get nothing.
    if (post.author.role === "owner" || post.author.role === "admin") {
      author.append(el("span", { class: "role-badge role-badge-" + post.author.role, text: post.author.role === "owner" ? "Owner" : "Admin" }));
    }
    // Flair on cards (v3.0.1): the profile flair chip shown next to the name.
    if (post.author.flair) author.append(el("span", { class: "post-flair", text: post.author.flair }));
  } else {
    author.append(el("span", { class: "author-name", text: "Removed account" }));
  }
  const time = el("time", { class: "post-time" });
  // lastActivityAt (bump activity, spec §4) is exposed machine-readably; the
  // visible label intentionally stays the creation time.
  time.dateTime = post.lastActivityAt ?? post.createdAt;
  time.textContent = new Date(post.createdAt).toLocaleString();
  header.append(author, time);
  // (edited) marker (v2.4): data-driven off editedAt, which every serialized
  // post carries (null until the author's first edit). A muted token-styled
  // token next to the creation time; never a link or tooltip markup.
  if (post.editedAt) {
    header.append(el("span", { class: "post-edited", text: "(edited)" }));
    // Edit history (v2.4.1): a small toggle that fetches and expands the
    // post's past versions. Everyone gets it — the point is that edits can't
    // quietly rewrite context (trouserpants' anti-abuse ask).
    const historyToggle = el("button", { class: "post-edited-history", text: "history" });
    historyToggle.type = "button";
    historyToggle.dataset.action = "edit-history";
    historyToggle.dataset.postId = String(post.id);
    header.append(historyToggle);
  }
  // Pinning (C5): the chip rides the payload's pinnedAt (null until pinned).
  // Root cards only — a reply row never carries its own pin.
  if (post.pinnedAt && !post.parent) {
    const chip = el("span", { class: "post-pinned icon-inline" });
    chip.append(createIcon(document, "pin"));
    chip.append(el("span", { class: "visually-hidden", text: "Pinned" }));
    header.append(chip);
  }
  // Suggestion status (v3.1): resolved/declined chip on suggestions-board
  // roots — data-driven off the payload, so every other category and every
  // reply renders nothing.
  if (post.board === "suggestions" && !post.parent && post.suggestionStatus) {
    header.append(el("span", { class: "suggestion-badge suggestion-badge-" + post.suggestionStatus, text: post.suggestionStatus === "resolved" ? "Resolved" : "Declined" }));
  }
  article.append(header);

  renderBodyBlocks(post, document, article);
  if (post.parent) {
    const parentLink = el("a", { class: "parent-context", text: `In reply to: ${post.parent.body}` });
    parentLink.href = `/posts/${post.parent.id}`;
    article.append(parentLink);
  }

  renderAttachments(post, document, article);
  renderLatestReplies(post, document, article);
  // Polls (C3): the detail payload's poll renders as result bars under the
  // body — data-driven, so poll-less payloads (and every reply) look unchanged.
  if (post.poll) {
    const pollBlock = renderPollBlock(post.poll, document, currentUser);
    if (pollBlock) article.append(pollBlock);
  }

  const actions = el("div", { class: "post-actions" });
  for (const [value, label, count] of [
    ["like", "Like", post.likeCount ?? 0],
    ["dislike", "Dislike", post.dislikeCount ?? 0],
  ]) {
    const button = el("button", { class: "button button-quiet reaction-button icon-inline" });
    button.type = "button";
    button.dataset.action = "reaction";
    button.dataset.postId = String(post.id);
    button.dataset.value = value;
    const rxLabel = `${label} this post`;
    button.setAttribute("aria-label", `${label} (${count})`);
    button.setAttribute("title", `${label} (${count})`);
    button.setAttribute("aria-pressed", String(post.viewerReaction === value));
    // Stateful toggle: app.js sends DELETE when active, PUT when not.
    if (post.viewerReaction === value) button.dataset.state = "active";
    if (!currentUser) button.disabled = true;
    if (post.viewerReaction === value) button.classList.add("reaction-active");
    button.append(createIcon(document, value === "like" ? "thumbUp" : "thumbDown"));
    button.append(document.createTextNode(String(count)));
    actions.append(button);
  }
  // Reply-count chip (plan v2.3): only threads carrying comments get one;
  // replyCount 0 (or an un-decorated payload) renders no chip at all.
  // Number() on undefined yields NaN, so the guard handles both shapes.
  // View counter (v2.4.3): front and center — every card carries an eye chip
  // with the raw impression count; 0 is displayed (front-and-center was the
  // owner's whole ask, unlike the reply chip which hides at 0).
  const views = el("span", { class: "view-count icon-inline" });
  views.append(createIcon(document, "eye"));
  const viewsHidden = el("span", { class: "visually-hidden", text: "views" });
  views.append(viewsHidden, document.createTextNode(String(Number(post.viewCount || 0))));
  actions.append(views);
  // Bookmarks (C4): signed-in members get a save toggle on every card; the
  // state is data-driven off the payload's viewerBookmarked (guest payloads
  // never carry it, so guests never see the toggle).
  if (currentUser) {
    const bookmarkButton = el("button", { class: "button button-quiet icon-button bookmark-toggle" });
    bookmarkButton.type = "button";
    bookmarkButton.dataset.action = "toggle-bookmark";
    bookmarkButton.dataset.postId = String(post.id);
    bookmarkButton.setAttribute("aria-pressed", String(Boolean(post.viewerBookmarked)));
    const bookmarkLabel = post.viewerBookmarked ? "Remove from saved posts" : "Save this post";
    bookmarkButton.setAttribute("aria-label", bookmarkLabel);
    bookmarkButton.setAttribute("title", bookmarkLabel);
    bookmarkButton.replaceChildren(createIcon(document, post.viewerBookmarked ? "bookmarks" : "bookmark"));
    actions.append(bookmarkButton);
  }
  // Reply-count chip (plan v2.3): only threads carrying comments get one;
  // replyCount 0 (or an un-decorated payload) renders no chip at all.
  // Number() on undefined yields NaN, so the guard handles both shapes.
  if (Number(post.replyCount) > 0) {
    const chat = el("span", { class: "reply-count icon-inline" });
    chat.append(createIcon(document, "chat"));
    // The bare number alone is meaningless to a screen reader: "replies" is
    // supplied via a visually-hidden word, per the modern-web accessibility
    // guidance (icon-only controls keep an accessible name).
    const hiddenLabel = el("span", { class: "visually-hidden", text: "replies" });
    chat.append(hiddenLabel, document.createTextNode(String(post.replyCount)));
    actions.append(chat);
  }
  const threadLink = el("a", { class: "button button-quiet icon-button" });
  threadLink.href = `/posts/${post.id}`;
  threadLink.setAttribute("aria-label", "Open post and replies");
  threadLink.setAttribute("title", "Open post and replies");
  threadLink.append(createIcon(document, "open"));
  actions.append(threadLink);
  if (currentUser && post.visibility !== "hidden") {
    // The report flow (5.0 rethink, wave 3): a task page at its own URL —
    // /posts/:id/report — addressable, reloadable, shareable; the link keeps
    // the old button's class and name so the card reads exactly as before.
    const report = el("a", {
      class: "button button-quiet icon-button",
      href: `/posts/${post.id}/report`,
    });
    report.setAttribute("aria-label", "Report this post");
    report.setAttribute("title", "Report this post");
    report.append(createIcon(document, "flag"));
    actions.append(report);
  }
  // Edit affordance (v2.4): author-only by session identity. The renderer sees
  // the session user object (app.js passes session.user), so the id comparison
  // is exact; guests and any viewer without an id (undefined id → NaN → never
  // equal) never see the button, and mods get no edit power either —
  // mirroring the server's author-only gate. Unlike Report, a hidden own post
  // keeps its Edit button: the author may edit what they authored.
  if (currentUser && post.author && Number(currentUser.id) === Number(post.author.id)) {
    const editButton = el("button", { class: "button button-quiet icon-button" });
    editButton.type = "button";
    editButton.dataset.action = "edit-post";
    editButton.dataset.postId = String(post.id);
    editButton.setAttribute("aria-label", "Edit this post");
    editButton.setAttribute("title", "Edit");
    editButton.append(createIcon(document, "pen"));
    actions.append(editButton);
  }
  // Delete affordance (v2.4.1 feature): author-only, the exact same session
  // identity gate as the Edit button above — guests, other members, and
  // mods never see it, while a hidden own post keeps it like it keeps
  // Edit. deleteScope tells app.js's confirm dialog which copy to show and
  // which client behavior to apply after the server confirms: a root card
  // ("thread") takes the whole conversation with it, while a reply card
  // ("reply") keeps the thread (sub-replies are reparented by the server).
  if (currentUser && post.author && Number(currentUser.id) === Number(post.author.id)) {
    const deleteButton = el("button", { class: "button button-quiet icon-button" });
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete-post";
    deleteButton.dataset.postId = String(post.id);
    deleteButton.dataset.deleteScope = post.parent ? "reply" : "thread";
    const deleteLabel = post.parent ? "Delete this reply" : "Delete this thread";
    deleteButton.setAttribute("aria-label", deleteLabel);
    deleteButton.setAttribute("title", deleteLabel);
    deleteButton.append(createIcon(document, "trash"));
    actions.append(deleteButton);
  }
  // Subscribe toggle (C1): icon-only, exactly like the bookmark toggle beside
  // it — the open bell flips to bell-check when subscribed, and the wordmark
  // lives in aria-label/title. `subscribed` rides BOTH the detail payload and
  // the feed payloads (withSubscriptionFlags decorates feed root rows), so
  // feed cards show the toggle too; reply cards and un-upgraded payloads never
  // do. Guests get no toggle (the server 401s) exactly like reaction buttons.
  if (currentUser && post.subscribed !== undefined && !post.parent) {
    const subscribeButton = el("button", { class: "button button-quiet icon-button subscribe-toggle" });
    subscribeButton.type = "button";
    subscribeButton.dataset.action = "toggle-subscribe";
    subscribeButton.dataset.postId = String(post.id);
    subscribeButton.dataset.subscribed = post.subscribed ? "1" : "0";
    subscribeButton.setAttribute("aria-pressed", String(Boolean(post.subscribed)));
    const subscribeLabel = post.subscribed
      ? "Unsubscribe from this thread"
      : "Subscribe to this thread";
    subscribeButton.setAttribute("aria-label", subscribeLabel);
    subscribeButton.setAttribute("title", subscribeLabel);
    subscribeButton.append(createIcon(document, post.subscribed ? "bell-check" : "bell"));
    actions.append(subscribeButton);
  }
  // Reply affordance: same strict rule as replyAffordances — signed-in users
  // on explicitly level-1 rows only (publicLevel 2 and undefined publicLevel
  // never show it; replying to level-2 targets is server-forbidden).
  if (replyAffordances(post, currentUser).canReply) {
    const replyButton = el("button", { class: "button button-quiet", text: "Reply" });
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
    const quoteButton = el("button", { class: "button button-quiet", text: "Quote" });
    quoteButton.type = "button";
    quoteButton.dataset.action = "quote";
    quoteButton.dataset.postId = String(post.id);
    quoteButton.dataset.quoteUsername = post.author.username;
    quoteButton.dataset.quoteSnippet = collapseWhitespace(post.body);
    if (!currentUser) quoteButton.disabled = true;
    actions.append(quoteButton);
  }
  if (post.subReplyCount > 0) {
    const expandButton = el("button", {
      class: "button button-quiet",
      text: `Show ${post.subReplyCount} replies`,
    });
    expandButton.type = "button";
    expandButton.dataset.action = "expand-sub-replies";
    expandButton.dataset.postId = String(post.id);
    expandButton.setAttribute("aria-expanded", "false");
    actions.append(expandButton);
  }
  // Pinning (C5): mods and admins get the pin/unpin control on ROOT
  // cards only (the server's gate is the desk idiom; the same roles and the
  // same root-only rule the client mirrors). The payload's pinnedAt picks the
  // label: a pinned root shows Unpin, everything else shows Pin.
  if (currentUser && !post.parent &&
      (currentUser.role === "owner" || currentUser.role === "admin")) {
    const isPinned = Boolean(post.pinnedAt);
    const pinButton = el("button", { class: "button button-quiet", text: isPinned ? "Unpin" : "Pin" });
    pinButton.type = "button";
    pinButton.dataset.action = isPinned ? "thread-unpin" : "thread-pin";
    pinButton.dataset.postId = String(post.id);
    actions.append(pinButton);
    // Suggestion status controls (v3.1): staff resolve/decline/reopen
    // suggestion roots in place; the server gates the same roles and
    // suggestions-board roots only. A decided suggestion offers Reopen; an
    // open one offers the decision pair.
    if (post.board === "suggestions") {
      const choices = post.suggestionStatus
        ? [["open", "Reopen"]]
        : [["resolved", "Resolve"], ["declined", "Decline"]];
      for (const [status, statusLabel] of choices) {
        const statusButton = el("button", { class: "button button-quiet", text: statusLabel });
        statusButton.type = "button";
        statusButton.dataset.action = "suggestion-status";
        statusButton.dataset.postId = String(post.id);
        statusButton.dataset.status = status;
        actions.append(statusButton);
      }
    }
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
    container.append(el("p", { class: "empty-state", text: emptyText }));
    return;
  }
  const list = el("div", { class: "post-list" });
  for (const post of posts) list.append(createPostCard(post, document, currentUser));
  container.append(list);
}

// Cascade wrapper (plan v2.3): the container div around a level-1 parent's
// sub-replies on the detail page. app.js's toggleSubReplies keeps owning the
// expand/collapse mechanics and the fetch; this only builds the wrapper the
// cascade CSS targets, reusing the existing grouping class .sub-replies and
// adding the new .cascade-replies treatment.
export const createSubReplyContainer = (postId, replies, document, currentUser = null) => {
  const container = el("div", { class: "sub-replies cascade-replies" });
  container.dataset.subRepliesFor = String(postId);
  if (!replies.length) {
    container.append(el("p", { class: "empty-state", text: "No replies to show yet." }));
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
  const form = el("form", { class: "edit-composer" });
  form.dataset.form = "post-edit";
  form.dataset.postId = String(post.id);
  form.append(createTextarea(document, {
    id: `post-edit-${post.id}-body`, name: "body", label: "Edit post",
    rows: 4, maxLength: COMPOSER_MAX_CHARS, required: true, counter: true,
    value: post.body,
  }));
  const actions = el("div", { class: "post-actions form-actions" });
  const save = el("button", { class: "button button-primary", text: "Save" });
  save.type = "submit";
  const cancel = el("button", { class: "button button-quiet", text: "Cancel" });
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
  node.className === "post-body" || node.className === "post-quote" ||
  node.className === "post-codeblock" || node.className === "post-heading" ||
  Array.isArray(node.children) && node.className === "post-list";

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
  const panel = el("div", { class: "edit-history-panel" });
  const title = el("p", { class: "edit-history-title", text: "Earlier versions (newest first)" });
  panel.append(title);
  if (!Array.isArray(edits) || edits.length === 0) {
    panel.append(el("p", { class: "edit-history-empty", text: "No earlier versions." }));
    return panel;
  }
  for (const edit of edits) {
    const entry = el("div", { class: "edit-history-entry" });
    const time = el("time", { class: "edit-history-time" });
    time.dateTime = edit.editedAt;
    time.textContent = new Date(edit.editedAt).toLocaleString();
    const body = el("p", { class: "edit-history-body", text: String(edit.body ?? "") });
    entry.append(time, body);
    panel.append(entry);
  }
  return panel;
}
