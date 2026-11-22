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

import { attachmentUrl } from "./attachments.js";
import { createIcon } from "./icons.js";
import { maskSpoilers, parseBlocks, parseInline } from "./markdown.js";
import { createTextarea } from "./forms.js";
import { COMPOSER_MAX_CHARS } from "./composer-limits.js";
import { collapseWhitespace } from "./quotes.js";
import { renderPollBlock } from "./polls.js";
import { isBotUsername } from "./bots.js";
import { t, tn, currentLocale } from "./i18n.js";
import { createCopyLinkButton } from "./copy-link.js";
import { createCopyCodeButton } from "./copy-code.js";
import { createReadAloud } from "./read-aloud.js";
import { createRevealSpoilersButton, hasSpoilers } from "./reveal-spoilers.js";
import { isQotdBody } from "./traditions.js";
import { createFoldedBody, isLongPost } from "./long-post.js";
import { appendWordDiff, diffWords } from "./word-diff.js";

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
      total > 1 ? t("render.viewFullImageOf", { index: index + 1, total }) : t("render.viewFullImage"),
    );
    expand.append(image);
    strip.append(expand);
    if (attachment.awaiting) {
      const pending = createElement(document, "p", "attachment-pending icon-inline");
      pending.append(createIcon(document, "image"), document.createTextNode(t("render.imageAwaitingReview")));
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
// createElement text argument) — a body containing "<b>" or "<script>"
// keeps rendering as literal text, exactly as before.


// Body rendering (v2.5): markdown subset blocks — fenced code, headings,
// lists, quotes, paragraphs — with markdown-INLINE runs (bold/italics/code/
// safe links) inside every kind except code fences (raw). HTML is never
// interpreted: all text lands through textContent, so "<b>" and "<script>"
// stay literal. Images never render (the raw "![…](…)" stays text).
export const renderBodyBlocks = (post, document, article) => {
  for (const block of parseBlocks(post.body)) {
    if (block.kind === "code") {
      const pre = createElement(document, "pre", "post-codeblock");
      const code = document.createElement("code");
      code.textContent = block.text.join("\n");
      pre.append(createCopyCodeButton(document, () => code.textContent), code);
      article.append(pre);
      continue;
    }
    if (block.kind === "heading") {
      const tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
      const heading = createElement(document, tag, "post-heading");
      renderInline(document, heading, block.text.join("\n"));
      article.append(heading);
      continue;
    }
    if (block.kind === "list") {
      const list = createElement(document, "ul", "md-list");
      for (const item of block.text) {
        const entry = createElement(document, "li", "md-list-item");
        renderInline(document, entry, item);
        list.append(entry);
      }
      article.append(list);
      continue;
    }
    if (block.kind === "quote") {
      const quote = createElement(document, "blockquote", "post-quote");
      for (const line of block.text) {
        const quoteLine = createElement(document, "p", "quote-line");
        renderInline(document, quoteLine, line);
        quote.append(quoteLine);
      }
      article.append(quote);
      continue;
    }
    const paragraph = createElement(document, "p", "post-body");
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
  const container = createElement(document, "div", "preview-replies");
  container.append(createElement(document, "span", "preview-caption", t("render.repliesCaption")));
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
    row.append(createElement(document, "span", "preview-snippet", collapseWhitespace(maskSpoilers(reply.snippet))));
    const when = createElement(document, "time", "preview-time");
    when.dateTime = reply.createdAt;
    when.textContent = new Date(reply.createdAt).toLocaleString(currentLocale());
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
  // the rendered body blocks (all kinds) are lossy and must not be
  // re-parsed back into a draft.
  article.postBody = String(post.body ?? "");
  if (post.visibility === "hidden") article.classList.add("post-hidden");

  const header = createElement(document, "header", "post-header");
  const author = createElement(document, "div", "post-author");
  if (post.author) {
    // Name color on cards (any hex, v3.0.2): the server normalized the
    // accent to a #rrggbb hex, so it rides as a CSS custom property WRITE
    // (CSSOM assignment — CSP-pure, no class string, no inline style text).
    if (post.author.profileAccent) {
      article.style.setProperty("--profile-accent", post.author.profileAccent);
    }
    if (post.author.avatarUrl) {
      const avatar = createElement(document, "img", "avatar");
      avatar.src = post.author.avatarUrl;
      avatar.alt = t("render.avatarOf", { name: post.author.username });
      author.append(avatar);
    }
    const profileLink = createElement(document, "a", "author-name", post.author.username);
    profileLink.href = `/users/${encodeURIComponent(post.author.username)}`;
    author.append(profileLink);
    // Role badge (v3.1): staff are chipped next to the name — Owner or Admin,
    // from the server-mapped public role. Members carry null and get nothing.
    if (post.author.role === "owner" || post.author.role === "admin") {
      author.append(createElement(document, "span",
        "role-badge role-badge-" + post.author.role,
        post.author.role === "owner" ? t("render.roleOwner") : t("render.roleAdmin")));
    }
    // Bot badge: trusted agent accounts (bots.js) are chipped "Bot".
    if (isBotUsername(post.author.username)) {
      author.append(createElement(document, "span", "role-badge role-badge-bot", t("render.roleBot")));
    }
    // New-member chip (v5.35): the server's boolean (account younger than 7
    // days) — the join time itself never reaches the client.
    if (post.author.isNew === true) {
      const newChip = createElement(document, "span", "role-badge role-badge-new", t("render.newMember"));
      newChip.setAttribute("title", t("render.newMemberTitle"));
      author.append(newChip);
    }
    // Flair on cards (v3.0.1): the profile flair chip shown next to the name.
    if (post.author.flair) author.append(createElement(document, "span", "post-flair", post.author.flair));
    // "You" chip (wave 2026-11-21-11 F2): the signed-in member's own posts
    // and replies are chipped so they can spot their part of a thread.
    // Client-only, from ids the card already has.
    if (currentUser && Number(currentUser.id) === Number(post.author.id)) {
      const youChip = createElement(document, "span", "role-badge role-badge-you", t("render.you"));
      youChip.setAttribute("title", t("render.youTitle"));
      author.append(youChip);
    }
  } else {
    author.append(createElement(document, "span", "author-name", t("render.removedAccount")));
  }
  const time = createElement(document, "time", "post-time");
  // lastActivityAt (bump activity, spec §4) is exposed machine-readably; the
  // visible label intentionally stays the creation time.
  time.dateTime = post.lastActivityAt ?? post.createdAt;
  time.textContent = new Date(post.createdAt).toLocaleString(currentLocale());
  // Save as text (wave 5.26 F1) reads the creation time from here.
  time.dataset.createdAt = String(post.createdAt ?? "");
  header.append(author, time);
  // (edited) marker (v2.4): data-driven off editedAt, which every serialized
  // post carries (null until the author's first edit). A muted token-styled
  // token next to the creation time; never a link or tooltip markup.
  if (post.editedAt) {
    header.append(createElement(document, "span", "post-edited", t("render.edited")));
    // Edit history (v2.4.1): a small toggle that fetches and expands the
    // post's past versions. Everyone gets it — the point is that edits can't
    // quietly rewrite context (trouserpants' anti-abuse ask).
    const historyToggle = createElement(document, "button", "post-edited-history", t("render.history"));
    historyToggle.type = "button";
    historyToggle.dataset.action = "edit-history";
    historyToggle.dataset.postId = String(post.id);
    header.append(historyToggle);
  }
  // Pinning (C5): the chip rides the payload's pinnedAt (null until pinned).
  // Root cards only — a reply row never carries its own pin.
  if (post.pinnedAt && !post.parent) {
    const chip = createElement(document, "span", "post-pinned icon-inline");
    chip.append(createIcon(document, "pin"));
    chip.append(createElement(document, "span", "visually-hidden", t("render.pinned")));
    header.append(chip);
  }
  // Suggestion status (v3.1): resolved/declined chip on suggestions-board
  // roots — data-driven off the payload, so every other category and every
  // reply renders nothing.
  if (post.board === "suggestions" && !post.parent && post.suggestionStatus) {
    header.append(createElement(document, "span",
      "suggestion-badge suggestion-badge-" + post.suggestionStatus,
      post.suggestionStatus === "resolved" ? t("render.resolved") : t("render.declined")));
  }
  // QOTD chip (wave 2026-11-21-14 F1): root threads that open with "QOTD"
  // carry the community's Question of the Day tag. Client-only, from the body.
  if (!post.parent && isQotdBody(post.body)) {
    const qotdChip = createElement(document, "span", "role-badge qotd-chip", "QOTD"); // i18n-ignore
    qotdChip.setAttribute("title", t("traditions.qotdTitle"));
    header.append(qotdChip);
  }
  article.append(header);

  // Wave 32: long bodies fold on feed cards only (the feed decorates its
  // cards with latestReplies; the thread page never does).
  if (Array.isArray(post.latestReplies) && isLongPost(post.body)) {
    article.append(createFoldedBody(document, post.id, (target) => renderBodyBlocks(post, document, target)));
  } else {
    renderBodyBlocks(post, document, article);
  }
  if (post.parent) {
    const parentLink = createElement(document, "a", "parent-context", t("render.inReplyTo", { body: maskSpoilers(post.parent.body) }));
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

  const actions = createElement(document, "div", "post-actions");
  for (const [value, label, count] of [
    ["like", t("render.like"), post.likeCount ?? 0],
    ["dislike", t("render.dislike"), post.dislikeCount ?? 0],
  ]) {
    const button = createElement(document, "button", "button button-quiet reaction-button icon-inline");
    button.type = "button";
    button.dataset.action = "reaction";
    button.dataset.postId = String(post.id);
    button.dataset.value = value;
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
  const views = createElement(document, "span", "view-count icon-inline");
  views.append(createIcon(document, "eye"));
  const viewsHidden = createElement(document, "span", "visually-hidden", t("render.views"));
  views.append(viewsHidden, document.createTextNode(String(Number(post.viewCount || 0))));
  actions.append(views);
  // Bookmarks (C4): signed-in members get a save toggle on every card; the
  // state is data-driven off the payload's viewerBookmarked (guest payloads
  // never carry it, so guests never see the toggle).
  if (currentUser) {
    const bookmarkButton = createElement(document, "button", "button button-quiet icon-button bookmark-toggle");
    bookmarkButton.type = "button";
    bookmarkButton.dataset.action = "toggle-bookmark";
    bookmarkButton.dataset.postId = String(post.id);
    bookmarkButton.setAttribute("aria-pressed", String(Boolean(post.viewerBookmarked)));
    const bookmarkLabel = post.viewerBookmarked ? t("render.unsavePost") : t("render.savePost");
    bookmarkButton.setAttribute("aria-label", bookmarkLabel);
    bookmarkButton.setAttribute("title", bookmarkLabel);
    bookmarkButton.replaceChildren(createIcon(document, post.viewerBookmarked ? "bookmarks" : "bookmark"));
    actions.append(bookmarkButton);
  }
  // Reply-count chip (plan v2.3): only threads carrying comments get one;
  // replyCount 0 (or an un-decorated payload) renders no chip at all.
  // Number() on undefined yields NaN, so the guard handles both shapes.
  if (Number(post.replyCount) > 0) {
    const chat = createElement(document, "span", "reply-count icon-inline");
    chat.append(createIcon(document, "chat"));
    // The bare number alone is meaningless to a screen reader: "replies" is
    // supplied via a visually-hidden word, per the modern-web accessibility
    // guidance (icon-only controls keep an accessible name).
    const hiddenLabel = createElement(document, "span", "visually-hidden", t("render.replies"));
    chat.append(hiddenLabel, document.createTextNode(String(post.replyCount)));
    actions.append(chat);
  }
  const threadLink = createElement(document, "a", "button button-quiet icon-button");
  threadLink.href = `/posts/${post.id}`;
  const openLabel = t("render.openPost");
  threadLink.setAttribute("aria-label", openLabel);
  threadLink.setAttribute("title", openLabel);
  threadLink.append(createIcon(document, "open"));
  actions.append(threadLink);
  // Copy link (wave 2026-11-21-4): one click puts the card's link on the
  // clipboard; client-only.
  actions.append(createCopyLinkButton(document, post.id));
  // Show spoilers (wave 2026-11-21-17 F2): only on cards that have some.
  if (hasSpoilers(post.body)) actions.append(createRevealSpoilersButton(document, article));
  // Read aloud (wave 2026-11-21-7 F3): on-device voices only, per click.
  const readAloud = createReadAloud(document, () => article.postBody);
  if (readAloud) actions.append(readAloud);
  if (currentUser && post.visibility !== "hidden") {
    const report = createElement(document, "button", "button button-quiet icon-button");
    report.type = "button";
    report.dataset.action = "report";
    report.dataset.postId = String(post.id);
    const reportLabel = t("render.reportPost");
    report.setAttribute("aria-label", reportLabel);
    report.setAttribute("title", reportLabel);
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
    const editButton = createElement(document, "button", "button button-quiet icon-button");
    editButton.type = "button";
    editButton.dataset.action = "edit-post";
    editButton.dataset.postId = String(post.id);
    editButton.setAttribute("aria-label", t("render.editPost"));
    editButton.setAttribute("title", t("common.edit"));
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
    const deleteButton = createElement(document, "button", "button button-quiet icon-button");
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete-post";
    deleteButton.dataset.postId = String(post.id);
    deleteButton.dataset.deleteScope = post.parent ? "reply" : "thread";
    const deleteLabel = post.parent ? t("render.deleteReply") : t("render.deleteThread");
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
    const subscribeButton = createElement(document, "button", "button button-quiet icon-button subscribe-toggle");
    subscribeButton.type = "button";
    subscribeButton.dataset.action = "toggle-subscribe";
    subscribeButton.dataset.postId = String(post.id);
    subscribeButton.dataset.subscribed = post.subscribed ? "1" : "0";
    subscribeButton.setAttribute("aria-pressed", String(Boolean(post.subscribed)));
    const subscribeLabel = post.subscribed
      ? t("render.unsubscribe")
      : t("render.subscribe");
    subscribeButton.setAttribute("aria-label", subscribeLabel);
    subscribeButton.setAttribute("title", subscribeLabel);
    subscribeButton.append(createIcon(document, post.subscribed ? "bell-check" : "bell"));
    actions.append(subscribeButton);
  }
  // Mute a thread (v5.46.0): only the thread detail payload carries
  // viewerMuted (members, roots), so feed cards, replies and guests never
  // show it. A worded toggle — muting is a quieter, rarer act than subscribing.
  if (currentUser && post.viewerMuted !== undefined && !post.parent) {
    const muted = Boolean(post.viewerMuted);
    const muteButton = createElement(document, "button", "button button-quiet thread-mute-toggle",
      muted ? t("render.unmuteThread") : t("render.muteThread"));
    muteButton.type = "button";
    muteButton.dataset.action = "toggle-thread-mute";
    muteButton.dataset.postId = String(post.id);
    muteButton.dataset.muted = muted ? "1" : "0";
    muteButton.setAttribute("aria-pressed", String(muted));
    actions.append(muteButton);
  }
  // Reply affordance: same strict rule as replyAffordances — signed-in users
  // on explicitly level-1 rows only (publicLevel 2 and undefined publicLevel
  // never show it; replying to level-2 targets is server-forbidden).
  if (replyAffordances(post, currentUser).canReply) {
    const replyButton = createElement(document, "button", "button button-quiet", t("common.reply"));
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
    const quoteButton = createElement(document, "button", "button button-quiet", t("render.quote"));
    quoteButton.type = "button";
    quoteButton.dataset.action = "quote";
    quoteButton.title = t("render.quoteTitle");
    quoteButton.dataset.postId = String(post.id);
    quoteButton.dataset.quoteUsername = post.author.username;
    // Wave 17: masked first — the 120-char quote cut can split a spoiler.
    quoteButton.dataset.quoteSnippet = collapseWhitespace(maskSpoilers(post.body));
    if (!currentUser) quoteButton.disabled = true;
    actions.append(quoteButton);
  }
  if (post.subReplyCount > 0) {
    const expandButton = createElement(
      document,
      "button",
      "button button-quiet",
      tn("render.showReplies", post.subReplyCount),
    );
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
    const pinButton = createElement(document, "button", "button button-quiet",
      isPinned ? t("render.unpin") : t("render.pin"));
    pinButton.type = "button";
    pinButton.dataset.action = isPinned ? "thread-unpin" : "thread-pin";
    pinButton.dataset.postId = String(post.id);
    actions.append(pinButton);
    // Staff pick of the week (v5.35): public Showcase roots only (the server
    // refuses anything else); the payload's staffPick picks the label.
    if (post.board === "showcase" && post.visibility === "public") {
      const picked = post.staffPick === true;
      const pickButton = createElement(document, "button", "button button-quiet",
        picked ? t("staffPick.unpick") : t("staffPick.pick"));
      pickButton.type = "button";
      pickButton.dataset.action = picked ? "staff-unpick" : "staff-pick";
      pickButton.dataset.postId = String(post.id);
      actions.append(pickButton);
    }
    // Suggestion status controls (v3.1): staff resolve/decline/reopen
    // suggestion roots in place; the server gates the same roles and
    // suggestions-board roots only. A decided suggestion offers Reopen; an
    // open one offers the decision pair.
    if (post.board === "suggestions") {
      const choices = post.suggestionStatus
        ? [["open", t("render.reopen")]]
        : [["resolved", t("render.resolve")], ["declined", t("render.decline")]];
      for (const [status, statusLabel] of choices) {
        const statusButton = createElement(document, "button",
          "button button-quiet", statusLabel);
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
  emptyText = t("render.noPosts")) {
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
    container.append(createElement(document, "p", "empty-state", t("render.noReplies")));
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
    id: `post-edit-${post.id}-body`, name: "body", label: t("render.editPostLabel"),
    rows: 4, maxLength: COMPOSER_MAX_CHARS, required: true, counter: true, submitShortcut: true, formatHelp: true,
    value: post.body,
  }));
  const actions = createElement(document, "div", "post-actions form-actions");
  const save = createElement(document, "button", "button button-primary", t("common.save"));
  save.type = "submit";
  const cancel = createElement(document, "button", "button button-quiet", t("common.cancel"));
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
  node.className === "md-list" || node.className === "post-body-fold";

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

// Wave 30: true when an open edit form's text differs from the post's raw
// body — Cancel then asks before throwing the change away.
const normalizeLineBreaks = (text) => String(text ?? "").replace(/\r\n?/g, "\n");

export const editHasUnsavedChanges = (article) => {
  if (!article || typeof article.postBody !== "string") return false;
  const form = [...article.children].find(
    (node) => node.dataset && node.dataset.form === "post-edit",
  );
  const textarea = form?.querySelector("textarea");
  // Wave 31: a textarea reports CR/CRLF as LF, so compare normalized text —
  // a body stored with CRLF is not "changed" until the member types.
  return Boolean(textarea) && normalizeLineBreaks(textarea.value) !== normalizeLineBreaks(article.postBody);
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
// Word diff (v5.50.0): with the card's current body, a "Current version" row
// leads; every row then marks its words inserted/deleted against the version
// before it (the oldest stays plain). Both sides are masked BEFORE the diff,
// so a spoiler never surfaces on either side; past the diff's word bound the
// row falls back to the plain full version.
function editDiffBody(document, older, newer) {
  const runs = diffWords(maskSpoilers(older), maskSpoilers(newer));
  if (!runs) return null;
  return appendWordDiff(document, createElement(document, "p", "edit-history-body"), runs);
}

export function renderEditHistoryPanel(document, edits, currentBody) {
  const panel = createElement(document, "div", "edit-history-panel");
  const title = createElement(document, "p", "edit-history-title", t("render.earlierVersions"));
  panel.append(title);
  if (!Array.isArray(edits) || edits.length === 0) {
    panel.append(createElement(document, "p", "edit-history-empty", t("render.noEarlierVersions")));
    return panel;
  }
  const versions = typeof currentBody === "string" ? [{ current: true, body: currentBody }, ...edits] : edits;
  versions.forEach((edit, index) => {
    const entry = createElement(document, "div", "edit-history-entry");
    let time;
    if (edit.current) {
      time = createElement(document, "p", "edit-history-time", t("render.currentVersion"));
    } else {
      time = createElement(document, "time", "edit-history-time");
      time.dateTime = edit.editedAt;
      time.textContent = new Date(edit.editedAt).toLocaleString(currentLocale());
    }
    const older = versions[index + 1];
    const diffed = older ? editDiffBody(document, String(older.body ?? ""), String(edit.body ?? "")) : null;
    // Earlier versions show as plain text, so their spoilers stay masked.
    const body = diffed ?? createElement(document, "p", "edit-history-body", maskSpoilers(edit.body));
    entry.append(time, body);
    panel.append(entry);
  });
  return panel;
}
