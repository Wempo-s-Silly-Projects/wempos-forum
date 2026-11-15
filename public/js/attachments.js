
// Pure, DOM-free helpers for post/reply image attachments (plan Task 7).
// Safe to import under node --test: no document access, and Node 22
// (like every browser) ships File and FormData globals.

// Matches the server contract readComposedBody enforces
// (MAX_ATTACHMENT_FILES / MAX_ATTACHMENT_BYTES in api/attachments.mjs).
// These are convenience limits only; the server still validates everything.
export const COMPOSER_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
export const MAX_COMPOSER_FILES = 3;
export const MAX_COMPOSER_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_COMPOSER_FILE_BYTES_LABEL = "10 MiB";

// Folds a picker selection into the composer's chosen list.
// Oversized and invalid choices are refused with notices.
// Never mutates currentFiles.
export function addComposerFiles(currentFiles, pickedFiles) {
  const files = [...(currentFiles ?? [])];
  const notices = [];

  if (files.length > MAX_COMPOSER_FILES) {
    notices.push(
      `The existing selection already exceeds the image limit of ${MAX_COMPOSER_FILES} files.`,
    );
    return { files, notices };
  }

  for (const picked of pickedFiles ?? []) {
    if (
      !picked ||
      typeof picked.size !== "number" ||
      !Number.isFinite(picked.size) ||
      picked.size < 0
    ) {
      notices.push("An invalid file selection was ignored.");
      continue;
    }

    if (picked.size > MAX_COMPOSER_FILE_BYTES) {
      notices.push(
        `"${picked.name ?? "Unnamed file"}" is larger than ${MAX_COMPOSER_FILE_BYTES_LABEL} and was not added.`,
      );
    } else if (files.length >= MAX_COMPOSER_FILES) {
      notices.push(
        `"${picked.name ?? "Unnamed file"}" was not added: a post can attach at most ${MAX_COMPOSER_FILES} images.`,
      );
    } else {
      files.push(picked);
    }
  }

  return { files, notices };
}

// Builds the request body a post/reply composer submits through api():
// - files present → multipart/form-data.
// - GIFs present → multipart/form-data.
// - neither present → the original JSON payload shape.
//
// api() leaves FormData bodies alone, allowing the browser to set the
// multipart Content-Type boundary automatically.
//
// Board (v2.4.1): Suggestions root posts can include their board.
// Replies never send one; the server derives their board from the thread root.
export function buildComposerBody({
  body,
  turnstileToken,
  files = [],
  gifs = [],
  board,
}) {
  const validFiles = Array.isArray(files) ? files : [];
  const validGifs = Array.isArray(gifs)
    ? gifs.filter((gifId) => typeof gifId === "string" && gifId.trim())
    : [];

  // Preserve the original JSON payload when there are no attachments.
  if (validFiles.length === 0 && validGifs.length === 0) {
    const payload = {
      body,
      "cf-turnstile-response": turnstileToken,
    };

    if (board) payload.board = board;

    return {
      multipart: false,
      body: payload,
    };
  }

  const form = new FormData();

  form.append("body", body);
  form.append("cf-turnstile-response", turnstileToken);

  if (board) form.append("board", board);

  for (const file of validFiles) {
    form.append("images", file, file.name);
  }

  for (const gifId of validGifs) {
    form.append("gifIds", gifId);
  }

  return {
    multipart: true,
    body: form,
  };
}

// Serving URL for one attachment metadata row ({ id, version }) from the
// post payloads Task 5 serializes.
//
// Approved rows are public with a year of immutable caching keyed by version.
// Pending rows are served to their author/mod under the same URL shape.
export const attachmentUrl = (attachment) =>
  `/api/attachments/${encodeURIComponent(attachment.id)}?v=${encodeURIComponent(attachment.version)}`;
