import { attachmentUrl } from "./attachments.js";
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
  for (const attachment of attachments) {
    const image = createElement(document, "img", "post-attachment");
    image.src = attachmentUrl(attachment);
    image.alt = "";
    image.loading = "lazy";
    const expand = createElement(document, "button", "attachment-expand");
    expand.type = "button";
    expand.dataset.action = "expand-attachment";
    expand.setAttribute("aria-label", "View full image");
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

export function appendPostList(container, posts, document, currentUser = null) {
  if (!posts.length) {
    container.append(createElement(document, "p", "empty-state", "No posts to show yet. Start the conversation."));
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
