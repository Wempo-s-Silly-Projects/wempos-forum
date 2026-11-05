// v4.0 plan 7 follow-up: the composer concern, its own module -- the composer
// builder (attachment row, file/gif strips), the create/reply submits with
// their idempotency keys, and the composer dialogs (gallery picker, polls).
// Bodies moved verbatim from routes/feed.js; feed.js keeps the routes and the
// card actions. The FORM_HANDLERS/ACTIONS registries merge into app.js's
// dispatch maps exactly as feed.js's do.
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
import { addGifsToComposer, removeGifFromComposer, renderGifThumbs, spareComposerSlots } from "../gifs.js";
import { addTurnstileSlot, refreshTurnstile, takeTurnstileToken } from "../turnstile.js";
import { COMPOSER_MAX_CHARS } from "../composer-limits.js";

let activeGifComposerForm = null;
let activePollComposerForm = null;

// Every composer is Turnstile-gated now: root posts use action "post", every
// reply composer (the detail-route root reply and reply-to-reply mini
// composers) uses action "reply". board (v2.4.1): a category composer carries
// its board value on the form's dataset; submitNewPost reads the dataset flag
// so the payload picks the board up in the same wire format the rest of the
// body uses. boardChoices (categories v3.1): the home composer renders a
// category <select> instead — submitNewPost reads its value the same way.
function createComposer(name, label, buttonLabel, postID = null,
  turnstileAction = null, board = null, boardChoices = null) {
  const panel = createPanel(board === "suggestions"
    ? "Share a suggestion"
    : name === "post-create" ? "Start a conversation" : "Reply");
  const form = document.createElement("form");
  form.dataset.form = name;
  if (postID !== null) form.dataset.postId = String(postID);
  if (board) form.dataset.board = board;
  if (boardChoices) {
    form.append(createSelect(document, {
      id: `${name}-${postID ?? "new"}-board`, name: "board",
      label: "Category",
      options: boardChoices,
    }));
  }
  // The reply-to-reply mini composer shares the "reply" form name with the
  // detail route's root composer, so the textarea id carries the target id to
  // keep label/for pairs unique in the document.
  form.append(createTextarea(document, {
    id: `${name}-${postID ?? "new"}-body`, name: "body", label,
    rows: 4, maxLength: COMPOSER_MAX_CHARS, required: true, counter: true,
  }));
  form.append(createComposerAttachmentRow(name === "post-create"));
  addTurnstileSlot(form, turnstileAction ?? (name === "post-create" ? "post" : "reply"));
  addSubmit(form, buttonLabel);
  panel.append(form);
  return panel;
}

// Image attachments on every composer (plan Task 7): a paperclip-style button
// driving a hidden multi-file input, plus a strip of chosen files rendered by
// renderComposerFileStrip. The chosen File objects never enter the DOM — they
// ride on a plain `composerFiles` property of the form, which readForm's
// FormData knows nothing about; submit handlers fold them into the payload.
// Uploads land in the moderation-pending state, so the note mirrors the
// avatar uploader's review-first wording.
function createComposerAttachmentRow(withPollButton = false) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = COMPOSER_ACCEPT;
  input.multiple = true;
  input.hidden = true;
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  input.dataset.composerInput = "images";
  const attach = element("button", "button button-quiet", "📎 Attach images");
  attach.type = "button";
  attach.dataset.action = "composer-attach";
  // GIF picker (v2.5): the library dialog — approved community GIFs attach
  // by reference (no re-upload bytes; the marketplace's dedup covers them).
  const gifButton = element("button", "button button-quiet", "Gallery");
  gifButton.type = "button";
  gifButton.dataset.action = "open-gif-picker";
  // Polls (C3): the Poll button — root composers only. The dialog stashes a
  // { question, options } draft on the form (composerPoll) and the create
  // submit posts it to /api/posts/:id/poll once the thread exists.
  const pollBits = [];
  if (withPollButton) {
    const pollButton = element("button", "button button-quiet", "📊 Poll");
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
  row.append(attach, gifButton, ...pollBits, description, strip, gifStrip, input);
  return row;
}

function renderComposerFileStrip(form) {
  const strip = form.querySelector('[data-composer-strip]');
  if (!strip) return;
  const files = form.composerFiles ?? [];
  strip.replaceChildren();
  strip.hidden = files.length === 0;
  renderComposerGifStrip(form);
  for (const [index, file] of files.entries()) {
    const chip = element("span", "composer-file", file.name);
    const remove = element("button", "button button-quiet composer-file-remove", "Remove");
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
  gifStrip.replaceChildren(...renderGifThumbs(document, form).children);
  gifStrip.hidden = gifs.length === 0;
}

function handleComposerFileSelection(input) {
  const form = input.closest("form");
  if (!form) return;
  const { files, notices } = addComposerFiles(form.composerFiles ?? [], input.files);
  form.composerFiles = files;
  renderComposerFileStrip(form);
  if (notices.length) setMessage(notices.join(" "), true);
  // Reset so re-picking the same file fires another change event.
  input.value = "";
}

function composerSubmissionSignature({ body, files = [], gifs = [], board = null, targetId = null }) {
  return JSON.stringify({
    body,
    board: board || null,
    targetId,
    files: files.map((file) => [file.name, file.size, file.type, file.lastModified]),
    gifs: gifs.map((gif) => String(gif?.id ?? gif?.gifId ?? gif)),
  });
}

function composerIdempotencyKey(form, signature) {
  // Keep a key only while the draft is unchanged. Ambiguous/network failures
  // retry with the same key; editing the draft starts a distinct submission.
  if (!form.dataset.idempotencyKey || form.dataset.idempotencySignature !== signature) {
    form.dataset.idempotencyKey = crypto.randomUUID();
    form.dataset.idempotencySignature = signature;
  }
  return form.dataset.idempotencyKey;
}

function clearComposerKeyForChangedSubmission(form, error) {
  if (error.status === 410 ||
      (error.status === 409 && /Idempotency-Key was already used for a different submission/i.test(error.message))) {
    delete form.dataset.idempotencyKey;
    delete form.dataset.idempotencySignature;
  }
  throw error;
}

async function submitNewPost(form, text) {
  const body = text("body");
  const files = form.composerFiles ?? [];
  const gifs = form.composerGifs ?? [];
  // Categories (v3.1): a dataset board (category composers lock the choice);
  // otherwise the home composer's board <select> — text("board") is "" when
  // the form carries no select at all, so the wire payload stays unchanged.
  const board = form.dataset.board ?? (text("board") || null);
  const signature = composerSubmissionSignature({ body, files, gifs, board });
  const idempotencyKey = composerIdempotencyKey(form, signature);
  // buildComposerBody picks the wire format: FormData (repeatable "images"
  // parts) when files were chosen, otherwise the exact pre-attachment JSON
  // payload. api() passes FormData straight through without a Content-Type.
  // The Suggestions composer's form dataset carries board=suggestions, riding
  // the body in whichever format wins; the home composer has no dataset flag,
  // keeping its payload exactly as before.
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
    post = await api("/api/posts", { method: "POST", body: submission.body, idempotencyKey });
  } catch (error) {
    clearComposerKeyForChangedSubmission(form, error);
  }
  delete form.dataset.idempotencyKey;
  delete form.dataset.idempotencySignature;
  // Polls (C3): a stashed poll attaches to the fresh thread BEFORE the
  // navigation; a failed attach never loses the (already live) post.
  let pollNote = "";
  if (form.composerPoll) {
    try {
      await api("/api/posts/" + post.id + "/poll", {
        method: "POST",
        body: form.composerPoll,
      });
    } catch (error) {
      pollNote = " (the poll could not be attached)";
    }
  }
  state.router.navigate("/posts/" + post.id);
  setMessage("Your post is live!" + pollNote);
}

async function submitReplyForm(form, text) {
  const postId = Number(form.dataset.postId);
  const threadId = form.dataset.threadId ?? postId;
  const body = text("body");
  const files = form.composerFiles ?? [];
  const gifs = form.composerGifs ?? [];
  const signature = composerSubmissionSignature({ body, files, gifs, targetId: postId });
  const idempotencyKey = composerIdempotencyKey(form, signature);
  // Same dual wire format as posts; replies are Turnstile-gated server-side
  // with action "reply".
  const submission = buildComposerBody({
    body,
    turnstileToken: takeTurnstileToken(form),
    files,
    gifs,
  });
  refreshTurnstile(form);
  try {
    await api("/api/posts/" + postId + "/replies", {
      method: "POST",
      body: submission.body,
      idempotencyKey,
    });
  } catch (error) {
    clearComposerKeyForChangedSubmission(form, error);
  }
  delete form.dataset.idempotencyKey;
  delete form.dataset.idempotencySignature;
  // Reply-to-reply composers remember the thread root (declared above) so the
  // rerender lands back on the conversation, not on the level-1 reply's page.
  await state.renderRoute({ name: "post", id: Number(threadId) });
  setMessage("Your reply was added!");
}

const gifPickerActiveForm = () => null;
function gifPickerDialog() {
  return document.querySelector("#gif-picker");
}
async function openGifPicker(button) {
  const form = button.closest("form");
  if (!form) return;
  const dialog = gifPickerDialog();
  if (!dialog) return;
  activeGifComposerForm = form;
  const grid = dialog.querySelector("#gif-grid");
  const data = await api("/api/gifs");
  grid.replaceChildren();
  const spare = spareComposerSlots(form);
  for (const gif of data.gifs) {
    const thumb = element("button", "gif-grid-item");
    thumb.type = "button";
    thumb.dataset.gifId = gif.id;
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
      const selectedCount = [...grid.children].filter((node) => node.getAttribute("aria-pressed") === "true");
      if (!pressed && selectedCount.length >= spare) {
        setMessage("That would exceed your " + MAX_COMPOSER_FILES + " attachment slots.", true);
        return;
      }
      thumb.setAttribute("aria-pressed", pressed ? "false" : "true");
    });
    grid.append(thumb);
  }
  dialog.showModal();
}
function confirmGifPicker(button) {
  const dialog = gifPickerDialog();
  if (!dialog) return;
  const form = connectedComposer(activeGifComposerForm);
  activeGifComposerForm = null;
  const grid = dialog.querySelector("#gif-grid");
  const selected = [...grid.children].filter((node) => node.getAttribute("aria-pressed") === "true").map((node) => node.dataset.gifId);
  dialog.close();
  if (!form || selected.length === 0) return;
  const { added } = addGifsToComposer(form, selected);
  if (added.length < selected.length) {
    setMessage("Only " + added.length + " image(s) fit your attachment slots.", true);
  }
  renderComposerGifStrip(form);
}
async function uploadCommunityGif(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const upload = new FormData();
    upload.append("gif", file, file.name);
    const result = await api("/api/gifs", { method: "POST", body: upload });
    const form = connectedComposer(activeGifComposerForm);
    if (result.reuse && form) {
      const { added } = addGifsToComposer(form, [result.id]);
      renderComposerGifStrip(form);
      if (added.length) {
        gifPickerDialog()?.close();
        activeGifComposerForm = null;
        setMessage("That image is already approved and has been attached.");
      } else {
        setMessage("That image is approved, but this composer has no free attachment slots.", true);
      }
    } else {
      setMessage(result.reuse
        ? "That image is already in the approved library!"
        : "Upload submitted for mod review.");
    }
  } finally {
    input.value = "";
  }
}

function connectedComposer(form) {
  return form && form.isConnected ? form : null;
}

// Poll dialog (C3): open stashes the calling composer; confirm reads the
// question + up to 4 options (blank slots skipped) and rides the draft on the
// form as composerPoll until the post's create submit lands the poll.
const pollDialog = () => document.querySelector("#poll-dialog");

function openPollDialog(button) {
  const form = button.closest("form");
  const dialog = pollDialog();
  if (!form || !dialog) return;
  activePollComposerForm = form;
  dialog.showModal();
}

function confirmPollDialog() {
  const dialog = pollDialog();
  const form = connectedComposer(activePollComposerForm);
  if (!form || !dialog) {
    activePollComposerForm = null;
    if (dialog) dialog.close();
    setMessage("That composer is no longer on the page. Open the poll tool again.", true);
    return;
  }
  const question = dialog.querySelector("#poll-question").value.trim();
  const options = [1, 2, 3, 4]
    .map((slot) => dialog.querySelector("#poll-option-" + slot)?.value.trim() ?? "")
    .filter(Boolean);
  if (!question || options.length < 2 || options.length > 4) {
    setMessage("Give the poll a question and 2 to 4 options.", true);
    return;
  }
  form.composerPoll = { question, options };
  activePollComposerForm = null;
  dialog.querySelector("form").reset();
  dialog.close();
  setMessage("Poll attached — it posts with your message!");
}

function attachComposerImages(button) {
  // The paperclip button lives inside the composer's form, so `.closest("form")`
  // always resolves the right composer even with several on one page.
  const form = button.closest("form");
  const input = form?.querySelector('[data-composer-input]');
  if (input) input.click();
}

function removeComposerFile(button) {
  const form = button.closest("form");
  if (!form) return;
  const files = form.composerFiles ?? [];
  const index = Number(button.dataset.fileIndex);
  if (Number.isInteger(index) && index >= 0 && index < files.length) {
    files.splice(index, 1);
  }
  form.composerFiles = files;
  renderComposerFileStrip(form);
}

export const FORM_HANDLERS = {
  "post-create": (form, text) => submitNewPost(form, text),
  reply: (form, text) => submitReplyForm(form, text),
};

// The registration seam: FORM_HANDLERS merges into submitForm's dispatch map;
// ACTIONS merges into handleButtonAction's dispatch map (only the composer
// family's entries; the card actions stay in routes/feed.js).
export const ACTIONS = {
  "composer-attach": (button) => attachComposerImages(button),
  "open-gif-picker": (button) => openGifPicker(button),
  "confirm-gif-picker": (button) => confirmGifPicker(button),
  "cancel-gif-picker": () => { activeGifComposerForm = null; gifPickerDialog()?.close(); },
  "choose-gif-upload": () => document.querySelector("#gif-marketplace-file")?.click(),
  "remove-composer-file": (button) => removeComposerFile(button),
  "remove-gif": (button) => {
    const form = button.closest("form");
    if (!form) return;
    removeGifFromComposer(form, button.dataset.gifId);
    renderComposerGifStrip(form);
  },
  "open-poll-dialog": (button) => openPollDialog(button),
  "confirm-poll-dialog": () => confirmPollDialog(),
  "cancel-poll-dialog": () => { activePollComposerForm = null; pollDialog()?.close(); },
};

export {
  createComposer,
  handleComposerFileSelection,
  uploadCommunityGif,
};
