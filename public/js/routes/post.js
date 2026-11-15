
// v4.0 plan 4 Task 4: the post-detail concern — the conversation route, the
// mini reply composers and sub-reply cascades, the quote prefill, the edit
// flow (swap form, submit, history), and the attachment lightbox. Bodies
// moved from app.js; bare renderRoute calls inside moved bodies re-read the
// boot state (state.renderRoute). The card actions common to several
// surfaces (reaction/bookmark/subscribe/suggestion status) live in
// composer.js, and the report dialog in routes/reports.js.

import { api } from "../api.js";
import {
  addHeading,
  attachmentLightbox,
  closeEditForm as unusedCloseEditForm,
  createPanel,
  element,
  main,
  setMessage,
} from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";
import {
  closeEditForm,
  createPostCard,
  createSubReplyContainer,
  openEditForm,
  renderEditHistoryPanel,
} from "../render.js";
import { createComposer } from "./composer.js";
import { prefillQuote } from "../quotes.js";
import { renderTurnstileSlots } from "../turnstile.js";

function validId(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return false;
  }

  const id = Number(value);

  return Number.isSafeInteger(id) && id > 0;
}

function validCursor(value) {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function findPostArticle(postId) {
  return Array.from(
    main.querySelectorAll("article[data-post-id]"),
  ).find(
    (article) => article.dataset.postId === String(postId),
  ) ?? null;
}

function validatePostResponse(post) {
  if (
    !post ||
    typeof post !== "object" ||
    Array.isArray(post) ||
    !validId(post.id) ||
    !Array.isArray(post.replies)
  ) {
    throw new Error("Invalid conversation response.");
  }

  if (
    post.repliesNextBefore != null &&
    !validCursor(post.repliesNextBefore)
  ) {
    throw new Error("Invalid reply pagination cursor.");
  }

  return post;
}

function validateRepliesResponse(page) {
  if (
    !page ||
    typeof page !== "object" ||
    Array.isArray(page) ||
    !Array.isArray(page.replies)
  ) {
    throw new Error("Invalid replies response.");
  }

  if (
    page.nextBefore != null &&
    !validCursor(page.nextBefore)
  ) {
    throw new Error("Invalid reply pagination cursor.");
  }

  return page;
}

async function renderPostRoute(route, context, version) {
  if (!validId(route.id)) {
    throw new Error("Invalid post ID.");
  }

  const post = validatePostResponse(
    await api(`/api/posts/${Number(route.id)}`),
  );

  if (version !== state.renderVersion) return;

  addHeading(main, "Conversation", 1);

  main.append(
    createPostCard(
      post,
      document,
      context.session.user,
    ),
  );

  addHeading(main, "Replies", 2);

  if (post.replies.length) {
    const replyList = element(
      "div",
      "post-list replies-list",
    );

    replyList.dataset.repliesFor = String(post.id);

    for (const reply of post.replies) {
      replyList.append(
        createPostCard(
          reply,
          document,
          context.session.user,
        ),
      );
    }

    main.append(replyList);
  } else {
    addText(
      document,
      main,
      "p",
      "No replies yet!",
      "empty-state",
    );
  }

  if (post.repliesNextBefore) {
    const olderReplies = element(
      "button",
      "button button-secondary",
      "Load older replies",
    );

    olderReplies.type = "button";
    olderReplies.dataset.action = "load-older-replies";
    olderReplies.dataset.postId = String(post.id);
    olderReplies.dataset.before = String(post.repliesNextBefore);

    main.append(olderReplies);
  }

  if (
    context.session.user &&
    post.visibility !== "hidden" &&
    !post.parent
  ) {
    main.append(
      createComposer(
        "reply",
        "Write a thoughtful reply",
        "Reply",
        post.id,
      ),
    );
  }
}

// Author edit save (v2.4): JSON {body} to PATCH /api/posts/:id (api.js adds
// the CSRF header). The server reapplies the word filter and 1,000-char cap,
// stores the masked body, stamps edited_at, and never bumps last_activity_at.
// On success the route re-render refetches the post, so the edited body, the
// edited marker, and the closed form all come back from the server.
async function submitPostEditForm(form, getFieldValue) {
  const postId = form.dataset.postId;

  if (!validId(postId)) {
    throw new Error("Invalid post ID.");
  }

  await api(`/api/posts/${Number(postId)}`, {
    method: "PATCH",
    body: {
      body: getFieldValue("body"),
    },
  });

  await state.renderRoute(state.activeRoute);

  setMessage("Your edit was saved.");
}

async function toggleReplyComposer(button) {
  const postId = button.dataset.postId;

  if (!validId(postId)) return;

  const article = findPostArticle(postId);

  if (!article) return;

  const existing = Array.from(
    main.querySelectorAll("[data-reply-composer-for]"),
  ).find(
    (panel) => panel.dataset.replyComposerFor === String(postId),
  );

  if (existing) {
    existing.remove();
    return;
  }

  // Mini composer under the level-1 reply; replies go to
  // /api/posts/:thatId with Turnstile action "reply".
  const panel = createComposer(
    "reply",
    "Write a reply",
    "Reply",
    postId,
    "reply",
  );

  panel.dataset.replyComposerFor = String(postId);

  // submitReplyForm reads the FORM's dataset (the thread root it should
  // re-render after a successful reply), not the marker panel's.
  const form = panel.querySelector("form");

  if (!form) {
    throw new Error("The reply composer could not be created.");
  }

  if (
    state.activeRoute.name === "post" &&
    validId(state.activeRoute.id)
  ) {
    form.dataset.threadId = String(state.activeRoute.id);
  }

  article.after(panel);

  await renderTurnstileSlots(panel);
}

async function toggleSubReplies(button) {
  // Double-click guard: one fetch per expand.
  if (button.dataset.loading === "1") return;

  const postId = button.dataset.postId;

  if (!validId(postId)) return;

  const existing = Array.from(
    main.querySelectorAll("[data-sub-replies-for]"),
  ).find(
    (container) => container.dataset.subRepliesFor === String(postId),
  );

  if (existing) {
    const hidden = existing.hasAttribute("hidden");

    if (hidden) {
      existing.removeAttribute("hidden");
    } else {
      existing.setAttribute("hidden", "");
    }

    button.setAttribute("aria-expanded", String(hidden));

    button.textContent = hidden
      ? `Hide ${button.dataset.replyCount} replies`
      : `Show ${button.dataset.replyCount} replies`;

    return;
  }

  const version = state.renderVersion;

  button.dataset.loading = "1";
  button.disabled = true;

  try {
    const page = validateRepliesResponse(
      await api(`/api/posts/${Number(postId)}/replies`),
    );

    if (
      version !== state.renderVersion ||
      !button.isConnected
    ) {
      return;
    }

    // Children arrive with publicLevel 2, so createPostCard renders them
    // without further reply buttons (server forbids level-2 targets).
    const container = createSubReplyContainer(
      postId,
      page.replies,
      document,
      state.currentUser,
    );

    const article = findPostArticle(postId);

    if (!article) return;

    // Avoid adding a second container if another interaction created one
    // while the request was in flight.
    const alreadyExists = Array.from(
      main.querySelectorAll("[data-sub-replies-for]"),
    ).some(
      (item) => item.dataset.subRepliesFor === String(postId),
    );

    if (alreadyExists) return;

    article.after(container);

    button.dataset.replyCount = String(page.replies.length);
    button.setAttribute("aria-expanded", "true");

    if (page.replies.length) {
      button.textContent =
        `Hide ${page.replies.length} replies`;
    }
  } finally {
    if (button.isConnected) {
      delete button.dataset.loading;
      button.disabled = false;
    }
  }
}

// Edit-form swap/restore (v2.4): the DOM cycle lives in render.js.
function editTargetArticle(button) {
  const postId = button.dataset.postId;

  if (!validId(postId)) return null;

  return findPostArticle(postId);
}

// Quote button (plan v2.3): prefill the CURRENT thread's reply composer.
// The snippet lands through quotes.js's prefillQuote: textarea .value
// assignment only, never HTML.
function quoteIntoComposer(button) {
  if (
    state.activeRoute.name !== "post" ||
    !validId(state.activeRoute.id)
  ) {
    return;
  }

  const rootId = String(state.activeRoute.id);

  const forms = Array.from(
    main.querySelectorAll('form[data-form="reply"]'),
  );

  const form =
    forms.find(
      (item) => item.dataset.threadId === rootId,
    ) ??
    forms.find(
      (item) => item.dataset.postId === rootId,
    );

  if (!form) return;

  const textarea = form.querySelector("textarea");

  if (!textarea) return;

  prefillQuote(
    textarea,
    button.dataset.quoteUsername ?? "",
    button.dataset.quoteSnippet ?? "",
  );

  // Programmatic .value assignment fires no input event. Dispatch the event
  // used by the composer's live character counter.
  textarea.dispatchEvent(
    new Event("input", { bubbles: true }),
  );

  form.scrollIntoView({ block: "nearest" });
}

// Click-to-expand attachments. The native <dialog> supplies Escape and
// focus handling; the dialog's close behaviour is wired once at load.
function openAttachmentLightbox(button) {
  const stripImage = button.querySelector("img.post-attachment");

  if (!stripImage || !attachmentLightbox) return;

  const fullImage = attachmentLightbox.querySelector("img");

  if (!fullImage) return;

  fullImage.src = stripImage.src;
  attachmentLightbox.showModal();
}

async function loadOlderReplies(button) {
  if (button.disabled) return;

  const postId = button.dataset.postId;
  const before = button.dataset.before;

  if (!validId(postId) || !validCursor(before)) {
    throw new Error("Invalid reply pagination details.");
  }

  const version = state.renderVersion;

  button.disabled = true;

  try {
    const older = validateRepliesResponse(
      await api(
        `/api/posts/${Number(postId)}/replies?before=${encodeURIComponent(before)}`,
      ),
    );

    if (
      version !== state.renderVersion ||
      !button.isConnected
    ) {
      return;
    }

    const replyList = Array.from(
      main.querySelectorAll(".replies-list[data-replies-for]"),
    ).find(
      (list) => list.dataset.repliesFor === String(postId),
    );

    if (!replyList) {
      throw new Error(
        "The reply list is no longer available. Reload the conversation.",
      );
    }

    const fragment = document.createDocumentFragment();

    for (const reply of older.replies) {
      fragment.append(
        createPostCard(
          reply,
          document,
          state.currentUser,
        ),
      );
    }

    replyList.prepend(fragment);

    if (older.nextBefore) {
      button.dataset.before = String(older.nextBefore);
      button.disabled = false;
    } else {
      button.remove();
    }
  } catch (error) {
    if (
      version === state.renderVersion &&
      button.isConnected
    ) {
      button.disabled = false;
    }

    throw error;
  }
}

// The registration seam: post-edit submits through FORM_HANDLERS; the detail
// route's own actions merge into handleButtonAction's dispatch map.
export const FORM_HANDLERS = {
  "post-edit": (form, getFieldValue) =>
    submitPostEditForm(form, getFieldValue),
};

export const ACTIONS = {
  "load-older-replies": (button) =>
    loadOlderReplies(button),

  "reply-to": (button) =>
    toggleReplyComposer(button),

  "expand-sub-replies": (button) =>
    toggleSubReplies(button),

  quote: (button) =>
    quoteIntoComposer(button),

  "expand-attachment": (button) =>
    openAttachmentLightbox(button),

  // Polls (C3, task 9): the vote PUT (one changeable vote per member);
  // the re-render refetches the payload's fresh counts.
  "poll-vote": async (button) => {
    if (
      state.activeRoute.name !== "post" ||
      !validId(state.activeRoute.id)
    ) {
      return;
    }

    const optionId = Number(button.dataset.optionId);

    if (!Number.isSafeInteger(optionId) || optionId <= 0) {
      throw new Error("Invalid poll option.");
    }

    if (button.disabled) return;

    button.disabled = true;

    try {
      await api(
        `/api/posts/${Number(state.activeRoute.id)}/poll`,
        {
          method: "PUT",
          body: { optionId },
        },
      );

      await state.renderRoute(state.activeRoute);
    } catch (error) {
      if (button.isConnected) {
        button.disabled = false;
      }

      throw error;
    }
  },

  "edit-post": (button) => {
    const article = editTargetArticle(button);

    if (article) {
      openEditForm(article, document);
    }
  },

  "cancel-edit": (button) => {
    const article = editTargetArticle(button);

    if (article) {
      closeEditForm(article);
    }
  },

  "edit-history": async (button) => {
    // Toggle: an open panel for this card closes; otherwise the past
    // versions fetch and expand under the body. History is public.
    const article = editTargetArticle(button);

    if (!article || button.dataset.loading === "1") {
      return;
    }

    const existing = article.querySelector(
      ":scope > .edit-history-panel",
    );

    if (existing) {
      existing.remove();
      return;
    }

    const postId = button.dataset.postId;
    const version = state.renderVersion;

    button.dataset.loading = "1";
    button.disabled = true;

    try {
      const data = await api(
        `/api/posts/${Number(postId)}/edits`,
      );

      if (
        version !== state.renderVersion ||
        !button.isConnected ||
        !article.isConnected
      ) {
        return;
      }

      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        !Array.isArray(data.edits)
      ) {
        throw new Error("Invalid edit history response.");
      }

      // Another request or interaction may have opened the panel already.
      if (
        article.querySelector(":scope > .edit-history-panel")
      ) {
        return;
      }

      article.append(
        renderEditHistoryPanel(document, data.edits),
      );
    } finally {
      if (button.isConnected) {
        delete button.dataset.loading;
        button.disabled = false;
      }
    }
  },
};

export { renderPostRoute };
