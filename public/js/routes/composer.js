
// v4.0 plan 7 follow-up: the composer's own module -- the composer
// builder (attachment row, file/gif strips), the create/reply submits with
// their idempotency keys, and the composer dialogs (gallery picker, polls).
// Bodies moved from routes/feed.js; feed.js keeps the routes and card actions.
// FORM_HANDLERS/ACTIONS merge into app.js's dispatch maps as feed.js's do.

import { api } from "../api.js";
import { addSubmit, createPanel, element, setMessage } from "../dom.js";
import { state } from "../state.js";
import { createSelect, createTextarea } from "../forms.js";
import {
  COMPOSER_ACCEPT,
  MAX_COMPOSER_FILES,
  addComposerFiles,
  buildComposerBody,
} from "../attachments.js";
import {
  addGifsToComposer,
  removeGifFromComposer,
  renderGifThumbs,
  spareComposerSlots,
} from "../gifs.js";
import {
  addTurnstileSlot,
  refreshTurnstile,
  takeTurnstileToken,
} from "../turnstile.js";
import { COMPOSER_MAX_CHARS } from "../composer-limits.js";

let activeGifComposerForm = null;
let activePollComposerForm = null;

// Every composer is Turnstile-gated now: root posts use action "post", every
// reply composer uses action "reply". Board values are carried by the form
// dataset or the home composer's category select.
function createComposer(
  name,
  label,
  buttonLabel,
  postID = null,
  turnstileAction = null,
  board = null,
  boardChoices = null,
) {
  const panel = createPanel(
    board === "suggestions"
      ? "Share a suggestion"
      : name === "post-create"
        ? "Start a conversation"
        : "Reply",
  );

  const form = document.createElement("form");
  form.dataset.form = name;

  if (postID !== null) {
    form.dataset.postId = String(postID);
  }

  if (board) {
    form.dataset.board = board;
  }

  if (boardChoices) {
    form.append(
      createSelect(document, {
        id: `${name}-${postID ?? "new"}-board`,
        name: "board",
        label: "Category",
        options: boardChoices,
      }),
    );
  }

  // The reply-to-reply mini composer shares the "reply" form name with the
  // detail-route root composer, so the textarea ID includes its target ID.
  form.append(
    createTextarea(document, {
      id: `${name}-${postID ?? "new"}-body`,
      name: "body",
      label,
      rows: 4,
      maxLength: COMPOSER_MAX_CHARS,
      required: true,
      counter: true,
    }),
  );

  form.append(createComposerAttachmentRow(name === "post-create"));

  addTurnstileSlot(
    form,
    turnstileAction ?? (name === "post-create" ? "post" : "reply"),
  );

  addSubmit(form, buttonLabel);
  panel.append(form);

  return panel;
}

// Image attachments on every composer: a hidden multi-file input and a
// visible strip of chosen files. File objects stay on the form, not in DOM
// attributes or FormData. Submission folds them into the API payload.
function createComposerAttachmentRow(withPollButton = false) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = COMPOSER_ACCEPT;
  input.multiple = true;
  input.hidden = true;
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  input.dataset.composerInput = "images";

  const attach = element(
    "button",
    "button button-quiet",
    "📎 Attach images",
  );
  attach.type = "button";
  attach.dataset.action = "composer-attach";

  const gifButton = element(
    "button",
    "button button-quiet",
    "Gallery",
  );
  gifButton.type = "button";
  gifButton.dataset.action = "open-gif-picker";

  const pollBits = [];

  if (withPollButton) {
    const pollButton = element(
      "button",
      "button button-quiet",
      "📊 Poll",
    );
    pollButton.type = "button";
    pollButton.dataset.action = "open-poll-dialog";
    pollBits.push(pollButton);
  }

  const gifStrip = element("div", "composer-files");
  gifStrip.dataset.composerStrip = "gifs";
  gifStrip.hidden = true;

  const description = element("span", "form-note");
  description.textContent =
    `Images are reviewed before they show publicly. Up to ${MAX_COMPOSER_FILES}, ` +
    "10 MiB or less each (JPEG, PNG, WebP, or GIF).";

  const strip = element("div", "composer-files");
  strip.dataset.composerStrip = "images";
  strip.hidden = true;

  const row = element("div", "composer-attach-row");
  row.append(
    attach,
    gifButton,
    ...pollBits,
    description,
    strip,
    gifStrip,
    input,
  );

  return row;
}

function renderComposerFileStrip(form) {
  const strip = form.querySelector('[data-composer-strip="images"]');
  if (!strip) return;

  const files = form.composerFiles ?? [];

  strip.replaceChildren();
  strip.hidden = files.length === 0;

  renderComposerGifStrip(form);

  for (const [index, file] of files.entries()) {
    const chip = element("span", "composer-file", file.name);

    const remove = element(
      "button",
      "button button-quiet composer-file-remove",
      "Remove",
    );

    remove.type = "button";
    remove.dataset.action = "remove-composer-file";
    remove.dataset.fileIndex = String(index);

    chip.append(remove);
    strip.append(chip);
  }
}

function renderComposerGifStrip(form) {
  const gifStrip = form.querySelector('[data-composer-strip="gifs"]');
  if (!gifStrip) return;

  const gifs = form.composerGifs ?? [];
  const rendered = renderGifThumbs(document, form);

  gifStrip.replaceChildren(...rendered.children);
  gifStrip.hidden = gifs.length === 0;
}

function handleComposerFileSelection(input) {
  const form = input.closest("form");
  if (!form) return;

  const { files, notices } = addComposerFiles(
    form.composerFiles ?? [],
    input.files,
  );

  form.composerFiles = files;

  renderComposerFileStrip(form);

  if (notices.length) {
    setMessage(notices.join(" "), true);
  }

  // Reset so re-picking the same file fires another change event.
  input.value = "";
}

function composerSubmissionSignature({
  body,
  files = [],
  gifs = [],
  board = null,
  targetId = null,
}) {
  return JSON.stringify({
    body,
    board: board || null,
    targetId,
    files: files.map((file) => [
      file.name,
      file.size,
      file.type,
      file.lastModified,
    ]),
    gifs: gifs.map((gif) => String(gif?.id ?? gif?.gifId ?? gif)),
  });
}

function composerIdempotencyKey(form, signature) {
  // Keep a key only while the draft is unchanged. Ambiguous/network failures
  // retry with the same key; editing the draft starts a distinct submission.
  if (
    !form.dataset.idempotencyKey ||
    form.dataset.idempotencySignature !== signature
  ) {
    form.dataset.idempotencyKey = crypto.randomUUID();
    form.dataset.idempotencySignature = signature;
  }

  return form.dataset.idempotencyKey;
}

function clearComposerKeyForChangedSubmission(form, error) {
  const message = String(error?.message ?? "");

  if (
    error?.status === 410 ||
    (
      error?.status === 409 &&
      /Idempotency-Key was already used for a different submission/i.test(message)
    )
  ) {
    delete form.dataset.idempotencyKey;
    delete form.dataset.idempotencySignature;
  }

  throw error;
}

function validId(value) {
  const id = Number(value);

  return Number.isSafeInteger(id) && id > 0;
}

function isRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value),
  );
}

function validateCreatedPost(post) {
  if (!isRecord(post) || !validId(post.id)) {
    throw new Error("The server returned an invalid post response.");
  }

  return Number(post.id);
}

function validateGifList(data) {
  if (!isRecord(data) || !Array.isArray(data.gifs)) {
    throw new Error("The gallery returned an invalid response.");
  }

  return data.gifs.filter((gif) =>
    isRecord(gif) &&
    (typeof gif.id === "string" || Number.isSafeInteger(gif.id)) &&
    String(gif.id).length > 0 &&
    typeof gif.url === "string" &&
    gif.url.length > 0
  );
}

// Prevent rapid repeated submits from creating duplicate requests. The lock
// is released after either success or failure, allowing legitimate retries.
async function withComposerSubmissionLock(form, submit) {
  if (form.dataset.submitting === "true") return;

  form.dataset.submitting = "true";

  try {
    return await submit();
  } finally {
    delete form.dataset.submitting;
  }
}

async function submitNewPost(form, text) {
  const body = text("body");
  const files = form.composerFiles ?? [];
  const gifs = form.composerGifs ?? [];

  // A category composer locks its board in the dataset; the home composer
  // reads the user's choice from its select.
  const board = form.dataset.board ?? (text("board") || null);

  const signature = composerSubmissionSignature({
    body,
    files,
    gifs,
    board,
  });

  const idempotencyKey = composerIdempotencyKey(form, signature);

  const submission = buildComposerBody({
    body,
    turnstileToken: takeTurnstileToken(form),
    files,
    gifs,
    board,
  });

  refreshTurnstile(form);

  let post;

  try {
    post = await api("/api/posts", {
      method: "POST",
      body: submission.body,
      idempotencyKey,
    });
  } catch (error) {
    clearComposerKeyForChangedSubmission(form, error);
  }

  const postId = validateCreatedPost(post);

  delete form.dataset.idempotencyKey;
  delete form.dataset.idempotencySignature;

  // Polls attach after the post exists. A failed poll attachment does not
  // lose the already-created post.
  let pollNote = "";

  if (form.composerPoll) {
    try {
      await api(`/api/posts/${postId}/poll`, {
        method: "POST",
        body: form.composerPoll,
      });
    } catch {
      pollNote = " (the poll could not be attached)";
    }
  }

  state.router.navigate(`/posts/${postId}`);
  setMessage("Your post is live!" + pollNote);
}

async function submitReplyForm(form, text) {
  const postId = Number(form.dataset.postId);
  const threadId = Number(form.dataset.threadId ?? postId);

  if (!validId(postId) || !validId(threadId)) {
    throw new Error("This reply has an invalid post or thread ID.");
  }

  const body = text("body");
  const files = form.composerFiles ?? [];
  const gifs = form.composerGifs ?? [];

  const signature = composerSubmissionSignature({
    body,
    files,
    gifs,
    targetId: postId,
  });

  const idempotencyKey = composerIdempotencyKey(form, signature);

  const submission = buildComposerBody({
    body,
    turnstileToken: takeTurnstileToken(form),
    files,
    gifs,
  });

  refreshTurnstile(form);

  try {
    await api(`/api/posts/${postId}/replies`, {
      method: "POST",
      body: submission.body,
      idempotencyKey,
    });
  } catch (error) {
    clearComposerKeyForChangedSubmission(form, error);
  }

  delete form.dataset.idempotencyKey;
  delete form.dataset.idempotencySignature;

  // Reply-to-reply composers remember the root thread so the rerender returns
  // to the conversation, rather than the level-one reply's page.
  await state.renderRoute({
    name: "post",
    id: threadId,
  });

  setMessage("Your reply was added!");
}

function gifPickerDialog() {
  return document.querySelector("#gif-picker");
}

async function openGifPicker(button) {
  const form = button.closest("form");
  if (!form) return;

  const dialog = gifPickerDialog();
  if (!dialog) return;

  const grid = dialog.querySelector("#gif-grid");
  if (!grid) {
    setMessage("The gallery could not be opened.", true);
    return;
  }

  activeGifComposerForm = form;

  let data;

  try {
    data = await api("/api/gifs");
  } catch (error) {
    if (activeGifComposerForm === form) {
      activeGifComposerForm = null;
    }
    throw error;
  }

  // The composer may have disappeared while the gallery request was pending.
  if (!form.isConnected || activeGifComposerForm !== form) {
    activeGifComposerForm = null;
    return;
  }

  let gifs;

  try {
    gifs = validateGifList(data);
  } catch {
    activeGifComposerForm = null;
    setMessage("The gallery returned an invalid response.", true);
    return;
  }

  grid.replaceChildren();

  const spare = spareComposerSlots(form);

  for (const gif of gifs) {
    const thumb = element("button", "gif-grid-item");

    thumb.type = "button";
    thumb.dataset.gifId = String(gif.id);
    thumb.setAttribute("role", "option");
    thumb.setAttribute("aria-pressed", "false");
    thumb.title = "Use this image";

    const img = element("img");
    img.src = gif.url;
    img.loading = "lazy";
    img.alt = "Library image";

    thumb.append(img);

    thumb.addEventListener("click", () => {
      const pressed = thumb.getAttribute("aria-pressed") === "true";

      const selectedCount = [
        ...grid.children,
      ].filter(
        (node) => node.getAttribute("aria-pressed") === "true",
      );

      if (!pressed && selectedCount.length >= spare) {
        setMessage(
          "That would exceed your " +
          MAX_COMPOSER_FILES +
          " attachment slots.",
          true,
        );
        return;
      }

      thumb.setAttribute(
        "aria-pressed",
        pressed ? "false" : "true",
      );
    });

    grid.append(thumb);
  }

  if (!dialog.open) {
    dialog.showModal();
  }
}

function confirmGifPicker() {
  const dialog = gifPickerDialog();
  if (!dialog) return;

  const form = connectedComposer(activeGifComposerForm);
  activeGifComposerForm = null;

  const grid = dialog.querySelector("#gif-grid");

  const selected = grid
    ? [...grid.children]
        .filter((node) => node.getAttribute("aria-pressed") === "true")
        .map((node) => node.dataset.gifId)
        .filter(Boolean)
    : [];

  dialog.close();

  if (!form || selected.length === 0) return;

  const { added } = addGifsToComposer(form, selected);

  if (added.length < selected.length) {
    setMessage(
      "Only " + added.length + " image(s) fit your attachment slots.",
      true,
    );
  }

  renderComposerGifStrip(form);
}

async function uploadCommunityGif(input) {
  const file = input.files?.[0];
  if (!file) return;

  try {
    const upload = new FormData();
    upload.append("gif", file, file.name);

    const result = await api("/api/gifs", {
      method: "POST",
      body: upload,
    });

    if (!isRecord(result) || typeof result.reuse !== "boolean") {
      throw new Error("The gallery returned an invalid upload response.");
    }

    const form = connectedComposer(activeGifComposerForm);

    if (result.reuse && validId(result.id) && form) {
      const { added } = addGifsToComposer(form, [result.id]);

      renderComposerGifStrip(form);

      if (added.length) {
        gifPickerDialog()?.close();
        activeGifComposerForm = null;

        setMessage("That image is already approved and has been attached.");
      } else {
        setMessage(
          "That image is approved, but this composer has no free attachment slots.",
          true,
        );
      }
    } else if (result.reuse) {
      setMessage("That image is already in the approved library!");
    } else {
      setMessage("Upload submitted for mod review.");
    }
  } finally {
    input.value = "";
  }
}

function connectedComposer(form) {
  return form && form.isConnected ? form : null;
}

// Poll dialog: stash the calling composer, then attach a question and 2–4
// non-empty options to that draft until the post is created.
function pollDialog() {
  return document.querySelector("#poll-dialog");
}

function openPollDialog(button) {
  const form = button.closest("form");
  const dialog = pollDialog();

  if (!form || !dialog) return;

  activePollComposerForm = form;

  if (!dialog.open) {
    dialog.showModal();
  }
}

function confirmPollDialog() {
  const dialog = pollDialog();
  const form = connectedComposer(activePollComposerForm);

  if (!form || !dialog) {
    activePollComposerForm = null;

    if (dialog?.open) {
      dialog.close();
    }

    setMessage(
      "That composer is no longer on the page. Open the poll tool again.",
      true,
    );

    return;
  }

  const questionInput = dialog.querySelector("#poll-question");
  const optionInputs = [1, 2, 3, 4].map(
    (slot) => dialog.querySelector(`#poll-option-${slot}`),
  );

  if (!questionInput || optionInputs.some((input) => !input)) {
    setMessage("The poll form is incomplete. Please reopen it.", true);
    return;
  }

  const question = questionInput.value.trim();

  const options = optionInputs
    .map((input) => input.value.trim())
    .filter(Boolean);

  if (!question || options.length < 2 || options.length > 4) {
    setMessage("Give the poll a question and 2 to 4 options.", true);
    return;
  }

  form.composerPoll = {
    question,
    options,
  };

  activePollComposerForm = null;

  dialog.querySelector("form")?.reset();
  dialog.close();

  setMessage("Poll attached — it posts with your message!");
}

function attachComposerImages(button) {
  const form = button.closest("form");
  const input = form?.querySelector('[data-composer-input="images"]');

  if (input) {
    input.click();
  }
}

function removeComposerFile(button) {
  const form = button.closest("form");
  if (!form) return;

  const files = form.composerFiles ?? [];
  const index = Number(button.dataset.fileIndex);

  if (
    Number.isInteger(index) &&
    index >= 0 &&
    index < files.length
  ) {
    files.splice(index, 1);
  }

  form.composerFiles = files;

  renderComposerFileStrip(form);
}

export const FORM_HANDLERS = {
  "post-create": (form, text) =>
    withComposerSubmissionLock(
      form,
      () => submitNewPost(form, text),
    ),

  reply: (form, text) =>
    withComposerSubmissionLock(
      form,
      () => submitReplyForm(form, text),
    ),
};

// The registration seam: FORM_HANDLERS merges into submitForm's dispatch map;
// ACTIONS merges into handleButtonAction's dispatch map. Card actions remain
// in routes/feed.js.
export const ACTIONS = {
  "composer-attach": (button) => attachComposerImages(button),

  "open-gif-picker": (button) => openGifPicker(button),

  "confirm-gif-picker": () => confirmGifPicker(),

  "cancel-gif-picker": () => {
    activeGifComposerForm = null;
    gifPickerDialog()?.close();
  },

  "choose-gif-upload": () =>
    document.querySelector("#gif-marketplace-file")?.click(),

  "remove-composer-file": (button) =>
    removeComposerFile(button),

  "remove-gif": (button) => {
    const form = button.closest("form");
    if (!form) return;

    removeGifFromComposer(form, button.dataset.gifId);
    renderComposerGifStrip(form);
  },

  "open-poll-dialog": (button) =>
    openPollDialog(button),

  "confirm-poll-dialog": () =>
    confirmPollDialog(),

  "cancel-poll-dialog": () => {
    activePollComposerForm = null;
    pollDialog()?.close();
  },
};

export {
  createComposer,
  handleComposerFileSelection,
  uploadCommunityGif,
};
