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

// v4.0 plan 4 Task 4: the post-detail concern — the conversation route, the
// mini reply composers and sub-reply cascades, the quote prefill, the edit
// flow (swap form, submit, history), and the attachment lightbox. Bodies
// moved verbatim out of app.js; bare renderRoute calls inside moved bodies
// re-read the boot state (state.renderRoute). The card actions common to
// several surfaces (reaction/bookmark/subscribe/suggestion status) live in
// composer.js, and the report dialog in routes/reports.js.
import { api } from "../api.js";
import { addHeading, attachmentLightbox, element, main, setMessage } from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";
import {
  closeEditForm,
  editHasUnsavedChanges,
  createPostCard,
  createSubReplyContainer,
  openEditForm,
  renderEditHistoryPanel,
} from "../render.js";
import { createComposer } from "./composer.js";
import { t, tn } from "../i18n.js";
import { prefillQuote } from "../quotes.js";
import { renderTurnstileSlots } from "../turnstile.js";
import { applyCatchUp } from "../catch-up.js";
import { createThreadGlance, summarizeThread } from "../thread-glance.js";
import { markThreadStarterReplies, threadStarterId } from "../thread-starter.js";
import { bindPostKeys, createPostKeysHint } from "../post-keys.js";
import { createShortcutSheet } from "../shortcut-sheet.js";
import {
  createFirstPostJump, createLatestReplyJump, createMyReplyJump, createNextAuthorReplyJump,
} from "../latest-reply.js";
import { addReplyFolds, createFoldAllToggle, ensureFoldAllToggle } from "../reply-fold.js";
import { createReplyFilter, refreshReplyFilter } from "../reply-filter.js";
import { selectedQuoteText } from "../quote-selection.js";
import { openLightbox } from "../lightbox.js";
import { anchorReplyCard, bindReplyHashChange, highlightReplyFromHash } from "../reply-anchor.js";
import { createSaveThreadButton } from "../thread-text.js";
import { startReadingProgress } from "../reading-progress.js";
import { createShareButton } from "../share.js";

async function renderPostRoute(route, context, version) {
  const post = await api(`/api/posts/${route.id}`);
  if (version !== state.renderVersion) return;
  addHeading(main, t("post.conversationTitle"), 1);
  const rootCard = createPostCard(post, document, context.session.user);
  // Save as text (wave 5.26 F1): only the cards shown on the page, no fetch.
  rootCard.querySelector(".post-actions")
    ?.append(createSaveThreadButton(document, { getRoot: () => main, threadId: post.id }));
  main.append(rootCard);
  // Share (v5.34): public root threads only, never for staff viewers.
  const share = createShareButton(document, post, context.session.user);
  if (share) main.append(share);
  // Thread at a glance (wave 2026-11-21): from the posts already loaded.
  if (post.replies.length) {
    main.append(createThreadGlance(document, summarizeThread(post, post.replies), main));
  }
  addHeading(main, t("post.repliesTitle"), 2);
  let replyList = null;
  if (post.replies.length) {
    // J/K post navigation (wave 2026-11-21-8 F3): hint shown only with replies.
    main.append(createPostKeysHint(document));
    // Keyboard shortcuts sheet (wave 2026-11-21-29 F2): closed by default.
    main.append(createShortcutSheet(document));
    replyList = element("div", "post-list replies-list");
    replyList.dataset.repliesFor = String(post.id);
    // Link to a reply (wave 5.25 F1): id="reply-<id>" + its own copy link.
    for (const reply of post.replies) {
      const card = createPostCard(reply, document, context.session.user);
      anchorReplyCard(document, card, post.id);
      replyList.append(card);
    }
    // Jump to the latest reply (wave 2026-11-21-9 F3): long threads only.
    const latestJump = createLatestReplyJump(document, replyList, post.replies.length);
    if (latestJump) main.append(latestJump);
    // Jump to my reply (wave 2026-11-21-15 F2): only when the viewer replied.
    const myJump = createMyReplyJump(document, replyList, post.replies, context.session.user?.id);
    if (myJump) main.append(myJump);
    // Next reply from the author (wave 2026-11-21-25 F3): starter replies only.
    const starterId = threadStarterId(post);
    const authorJump = createNextAuthorReplyJump(document, replyList, post.replies, starterId);
    if (authorJump) main.append(authorJump);
    // Fold all replies (wave 2026-11-21-22 F2): long threads only.
    const foldAll = createFoldAllToggle(document, replyList, knownReplyTotal(post));
    if (foldAll) main.append(foldAll);
    // Filter replies (wave 5.5 F2): page view only, nothing stored or sent.
    const replyFilter = createReplyFilter(document, replyList, knownReplyTotal(post));
    if (replyFilter) main.append(replyFilter);
    main.append(replyList);
    // Thread-author chip (wave 2026-11-21-7 F2): the starter's own replies.
    if (starterId) replyList.dataset.starterId = String(starterId);
    markThreadStarterReplies(document, replyList, post.replies, starterId);
    // Fold a reply (wave 2026-11-21-12 F2): page-view only, nothing stored.
    addReplyFolds(document, replyList);
  } else {
    addText(document, main, "p", t("post.noReplies"), "empty-state");
  }
  bindPostKeys(main, [rootCard, replyList]);
  // "New since your last visit" (wave 2026-11-21): local read marks only.
  applyCatchUp(document, post.id, post.replies, replyList, { accountId: state.currentUser?.id });
  if (post.repliesNextBefore) {
    const olderReplies = element("button", "button button-secondary", t("post.loadOlderReplies"));
    olderReplies.type = "button";
    olderReplies.dataset.action = "load-older-replies";
    olderReplies.dataset.postId = String(post.id);
    olderReplies.dataset.before = String(post.repliesNextBefore);
    main.append(olderReplies);
  }
  // Back to the first post (wave 2026-11-21-12 F3): long threads only.
  const firstJump = createFirstPostJump(document, rootCard, post.replies.length);
  if (firstJump) main.append(firstJump);
  if (context.session.user && post.visibility !== "hidden" && !post.parent) {
    main.append(createComposer("reply", t("post.replyPlaceholder"), t("common.reply"), post.id));
  }
  // A #reply-<id> hash lands on that reply when it is on this page; else no-op.
  highlightReplyFromHash(main, location.hash);
  bindReplyHashChange(window, () => main);
  // Reading progress bar (wave 5.26 F2): stopped by renderRoute on leave.
  startReadingProgress(document, window, main);
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
  setMessage(t("post.editSaved"));
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
  const panel = createComposer("reply", t("post.miniReplyPlaceholder"), t("common.reply"), postId, "reply");
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
      ? tn("post.hideReplies", Number(button.dataset.replyCount))
      : tn("post.showReplies", Number(button.dataset.replyCount));
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
    const starterId = Number(main.querySelector(".replies-list")?.dataset.starterId);
    markThreadStarterReplies(document, container, page.replies, starterId);
    addReplyFolds(document, container);
    button.dataset.replyCount = String(page.replies.length);
    button.setAttribute("aria-expanded", "true");
    if (page.replies.length) button.textContent = tn("post.hideReplies", page.replies.length);
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
  // Wave 24 F2: a selection inside this reply's body is quoted instead of
  // the snippet (spoilers masked either way).
  const card = button.closest("article.post-card");
  const selected = selectedQuoteText(document.getSelection?.() ?? null, card);
  prefillQuote(textarea, button.dataset.quoteUsername ?? "", selected || button.dataset.quoteSnippet || "");
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
// CSS, but the stored bytes are full-size — the lightbox swaps in the same
// versioned URL uncapped. Wave 21 moved the viewer into lightbox.js (close
// and previous/next buttons, counter, arrow keys within this post's strip,
// focus back to the last-viewed thumbnail).
function openAttachmentLightbox(button) {
  openLightbox(attachmentLightbox, button);
}
// Wave 24: the detail payload carries one page of replies; an unloaded older
// page means at least one more, so long threads gate fold-all on that bound.
const knownReplyTotal = (post) => post.replies.length + (post.repliesNextBefore ? 1 : 0);

async function loadOlderReplies(button) {
  const postId = button.dataset.postId;
  const older = await api("/api/posts/" + postId + "/replies?before=" + button.dataset.before);
  const replyList = main.querySelector('.replies-list[data-replies-for="' + postId + '"]');
  if (!replyList) throw new Error(t("post.replyListGone"));
  const fragment = document.createDocumentFragment();
  for (const reply of older.replies) {
    const card = createPostCard(reply, document, state.currentUser);
    anchorReplyCard(document, card, postId);
    fragment.append(card);
  }
  replyList.prepend(fragment);
  markThreadStarterReplies(document, replyList, older.replies, Number(replyList.dataset.starterId));
  addReplyFolds(document, replyList);
  ensureFoldAllToggle(document, replyList);
  refreshReplyFilter(replyList);
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
  // Wave 5.13: take back my vote (F2) and close/reopen voting (F1).
  "poll-unvote": async () => {
    if (state.activeRoute.name !== "post") return;
    await api("/api/posts/" + state.activeRoute.id + "/poll", { method: "DELETE" });
    await state.renderRoute(state.activeRoute);
  },
  "poll-close": async (button) => {
    if (state.activeRoute.name !== "post") return;
    await api("/api/posts/" + state.activeRoute.id + "/poll", {
      method: "PATCH",
      body: { closed: button.dataset.closed === "true" },
    });
    await state.renderRoute(state.activeRoute);
  },
  // v5.38.0 F3: set ("" clears) the poll's closing time — seconds from now.
  "poll-deadline": async (button) => {
    if (state.activeRoute.name !== "post") return;
    const select = button.closest(".poll-deadline")?.querySelector(".poll-deadline-select");
    if (!select) return;
    await api("/api/posts/" + state.activeRoute.id + "/poll", {
      method: "PATCH",
      body: { closesIn: select.value === "" ? null : Number(select.value) },
    });
    await state.renderRoute(state.activeRoute);
  },
  "edit-post": (button) => {
    const article = editTargetArticle(button);
    if (article) openEditForm(article, document);
  },
  "cancel-edit": (button) => {
    const article = editTargetArticle(button);
    if (!article) return;
    if (editHasUnsavedChanges(article) && !window.confirm(t("render.discardEditConfirm"))) return;
    closeEditForm(article);
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
