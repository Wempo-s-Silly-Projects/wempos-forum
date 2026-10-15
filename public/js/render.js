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

  const body = createElement(document, "p", "post-body", post.body);
  article.append(body);
  if (post.parent) {
    const parentLink = createElement(document, "a", "parent-context", `In reply to: ${post.parent.body}`);
    parentLink.href = `/posts/${post.parent.id}`;
    article.append(parentLink);
  }

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
