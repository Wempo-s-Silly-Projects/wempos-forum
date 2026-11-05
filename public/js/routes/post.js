// v4.0 plan 4 Task 4: the post-detail concern — the conversation route, the
// mini reply composers and sub-reply cascades, the quote prefill, the edit
// flow (swap form, submit, history), and the attachment lightbox. Bodies
// moved verbatim out of app.js; bare renderRoute calls inside moved bodies
// re-read the boot state (state.renderRoute). The card actions common to
// several surfaces (reaction/bookmark/subscribe/suggestion status) live in
// routes/feed.js, and the report dialog in routes/reports.js.
import { api } from "../api.js";
import { addHeading, attachmentLightbox, createPanel, element, main, setMessage } from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";
import {
  closeEditForm,
  createPostCard,
  createSubReplyContainer,
  openEditForm,
  renderEditHistoryPanel,
} from "../render.js";
import { createComposer } from "./feed.js";
import { prefillQuote } from "../quotes.js";
import { renderTurnstileSlots } from "../turnstile.js";

async function renderPostRoute(route, context, version) {
  const post = await api(`/api/posts/${route.id}`);
  if (version !== state.renderVersion) return;
  addHeading(main, "Conversation", 1);
  main.append(createPostCard(post, document, context.session.user));
  addHeading(main, "Replies", 2);
  if (post.replies.length) {
    const replyList = element("div", "post-list replies-list");
    replyList.dataset.repliesFor = String(post.id);
    for (const reply of post.replies) replyList.append(createPostCard(reply, document, context.session.user));
    main.append(replyList);
  } else {
    addText(document, main, "p", "No replies yet!", "empty-state");
  }
  if (post.repliesNextBefore) {
    const olderReplies = element("button", "button button-secondary", "Load older replies");
    olderReplies.type = "button";
    olderReplies.dataset.action = "load-older-replies";
    olderReplies.dataset.postId = String(post.id);
    olderReplies.dataset.before = String(post.repliesNextBefore);
    main.append(olderReplies);
  }
  if (context.session.user && post.visibility !== "hidden" && !post.parent) {
    main.append(createComposer("reply", "Write a thoughtful reply", "Reply", post.id));
  }
}
// Author edit save (v2.4): JSON {body} to PATCH /api/posts/:id (api.js adds the
// CSRF header). The server reapplies the word filter and 1,000-char cap, stores
// the masked body, stamps edited_at, and never bumps last_activity_at — over-
// limit/filter rejections 400 into the shared error bar here, with the form
// left open so the author can fix the draft. On success the route re-render
// refetches the post, so the edited body, the (edited) marker, and the closed
// form all come back from the server — never from trusting the PATCH echo.
async function submitPostEditForm(form, text) {
  await api("/api/posts/" + form.dataset.postId, {
    method: "PATCH",
    body: { body: text("body") },
  });
  await state.renderRoute(state.activeRoute);
  setMessage("Your edit was saved.");
}
async function toggleReplyComposer(button) {
  const postId = button.dataset.postId;
  const article = main.querySelector(`article[data-post-id="${postId}"]`);
  if (!article) return;
  const existing = main.querySelector(`[data-reply-composer-for="${postId}"]`);
  if (existing) {
    existing.remove();
    return;
  }
  // Mini composer under the level-1 reply; replies go to /api/posts/:thatId
  // with Turnstile action "reply".
  const panel = createComposer("reply", "Write a reply", "Reply", postId, "reply");
  panel.dataset.replyComposerFor = postId;
  // submitReplyForm reads the FORM's dataset (the thread root it should
  // re-render after a successful reply), not the marker panel's — so the
  // thread id must ride on the form itself or the rerender would land on the
  // level-1 reply's own detail page instead of the conversation.
  if (state.activeRoute.name === "post") {
    panel.querySelector("form").dataset.threadId = String(state.activeRoute.id);
  }
  article.after(panel);
  await renderTurnstileSlots(panel);
}

async function toggleSubReplies(button) {
  // Double-click guard: one fetch per expand; a stale in-flight request never
  // builds a duplicate container (the old one is orphaned by re-render).
  if (button.dataset.loading === "1") return;
  const postId = button.dataset.postId;
  const existing = main.querySelector(`[data-sub-replies-for="${postId}"]`);
  if (existing) {
    const hidden = existing.hasAttribute("hidden");
    if (hidden) existing.removeAttribute("hidden");
    else existing.setAttribute("hidden", "");
    button.setAttribute("aria-expanded", String(hidden));
    button.textContent = hidden
      ? `Hide ${button.dataset.replyCount} replies`
      : `Show ${button.dataset.replyCount} replies`;
    return;
  }
  button.dataset.loading = "1";
  button.disabled = true;
  try {
    const page = await api("/api/posts/" + postId + "/replies");
    // Children arrive with publicLevel 2, so createPostCard renders them without
    // further reply buttons (server forbids level-2 targets). The wrapper div
    // (grouping class + cascade treatment) is render.js's createSubReplyContainer.
    const container = createSubReplyContainer(postId, page.replies, document, state.currentUser);
    const article = main.querySelector(`article[data-post-id="${postId}"]`);
    if (article) article.after(container);
    button.dataset.replyCount = String(page.replies.length);
    button.setAttribute("aria-expanded", "true");
    if (page.replies.length) button.textContent = `Hide ${page.replies.length} replies`;
  } finally {
    delete button.dataset.loading;
    button.disabled = false;
  }
}
// Edit-form swap/restore (v2.4): the DOM cycle lives in render.js
// (openEditForm/closeEditForm), testable against the mock element suite.
// A second Edit click on an already-open form is a no-op (openEditForm refuses
// a duplicate), and Cancel restores the exact original body nodes — the patch
// itself only happens through the form's submit path.
function editTargetArticle(button) {
  return main.querySelector(`article[data-post-id="${button.dataset.postId}"]`);
}

// Quote button (plan v2.3): prefill the CURRENT thread's reply composer. The
// composer is resolved with the same convention toggleReplyComposer's
// submitReplyForm path relies on — the root composer's form carries the thread
// id in data-post-id (its reply target), while an open reply-to-reply mini
// composer carries it in data-thread-id — so both spellings resolve the same
// thread composer on the detail route. On routes without a composer
// (home/search/profile) a Quote click is a silent no-op. The snippet lands
// through quotes.js's prefillQuote: textarea .value property assignment only,
// never HTML.
function quoteIntoComposer(button) {
  if (state.activeRoute.name !== "post") return;
  const rootId = String(state.activeRoute.id);
  const form =
    main.querySelector(`form[data-form="reply"][data-thread-id="${rootId}"]`) ??
    main.querySelector(`form[data-form="reply"][data-post-id="${rootId}"]`);
  if (!form) return;
  const textarea = form.querySelector("textarea");
  if (!textarea) return;
  prefillQuote(textarea, button.dataset.quoteUsername ?? "", button.dataset.quoteSnippet ?? "");
  // prefillQuote assigns .value programmatically, which fires no `input`
  // event — so the composer's live character counter (wired in forms.js to the
  // input event) would keep showing the stale pre-quote count. Dispatch the
  // event it listens for so the counter reflects the post-prefill value.
  // Over-limit prefills are NOT clamped here (clamping would silently eat the
  // user's draft). Note the actual protection: native tooLong validity only
  // covers values "last changed by a user edit" (WHATWG constraint
  // validation), so a programmatically assigned value past 1000 chars sails
  // through client validity checks and the server 400 is the only gate. The
  // stale counter above is display-only and independent of that limit.
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  form.scrollIntoView({ block: "nearest" });
}

// Click-to-expand attachments (micro-batch): the strip caps render size with
// CSS, but the stored bytes are full-size — the lightbox just swaps in the
// same versioned URL uncapped (capped only by the viewport in CSS). The
// native <dialog> supplies Escape and focus handling for free; a click
// anywhere on the dialog or its backdrop closes it (wired once at load).
function openAttachmentLightbox(button) {
  const stripImage = button.querySelector("img.post-attachment");
  if (!stripImage || !attachmentLightbox) return;
  const fullImage = attachmentLightbox.querySelector("img");
  if (!fullImage) return;
  fullImage.src = stripImage.src;
  attachmentLightbox.showModal();
}
async function loadOlderReplies(button) {
  const postId = button.dataset.postId;
  const older = await api("/api/posts/" + postId + "/replies?before=" + button.dataset.before);
  const replyList = main.querySelector('.replies-list[data-replies-for="' + postId + '"]');
  if (!replyList) throw new Error("The reply list is no longer available. Reload the conversation.");
  const fragment = document.createDocumentFragment();
  for (const reply of older.replies) fragment.append(createPostCard(reply, document, state.currentUser));
  replyList.prepend(fragment);
  if (older.nextBefore) button.dataset.before = String(older.nextBefore);
  else button.remove();
}

// The registration seam: post-edit submits through FORM_HANDLERS; the detail
// route's own actions merge into handleButtonAction's dispatch map.
export const FORM_HANDLERS = {
  "post-edit": (form, text) => submitPostEditForm(form, text),
};

export const ACTIONS = {
  "load-older-replies": (button) => loadOlderReplies(button),
  "reply-to": (button) => toggleReplyComposer(button),
  "expand-sub-replies": (button) => toggleSubReplies(button),
  quote: (button) => quoteIntoComposer(button),
  "expand-attachment": (button) => openAttachmentLightbox(button),
  // Polls (C3, task 9): the vote PUT (one changeable vote per member) and the
  // re-render refetches the payload's fresh counts.
  "poll-vote": async (button) => {
    if (state.activeRoute.name !== "post") return;
    const postId = state.activeRoute.id;
    await api("/api/posts/" + postId + "/poll", {
      method: "PUT",
      body: { optionId: Number(button.dataset.optionId) },
    });
    await state.renderRoute(state.activeRoute);
  },
  "edit-post": (button) => {
    const article = editTargetArticle(button);
    if (article) openEditForm(article, document);
  },
  "cancel-edit": (button) => {
    const article = editTargetArticle(button);
    if (article) closeEditForm(article);
  },
  "edit-history": async (button) => {
    // Toggle: an open panel for this card closes; otherwise the past
    // versions fetch and expand under the body. History is public — no
    // auth needed beyond the same-origin GET.
    const article = editTargetArticle(button);
    if (!article) return;
    const existing = article.querySelector(":scope > .edit-history-panel");
    if (existing) {
      existing.remove();
      return;
    }
    const data = await api(`/api/posts/${encodeURIComponent(button.dataset.postId)}/edits`);
    article.append(renderEditHistoryPanel(document, data.edits));
  },
};

export { renderPostRoute };
