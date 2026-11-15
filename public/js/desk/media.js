
// v4.0 plan 5 (spec step 6), task 1: the moderation desk's media review queues
// (attachments, avatars, GIFs) section builders — bodies moved verbatim out
// of ../admin.js (now dissolved).
import { addText } from "../forms.js";

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0;
}

function formatDate(value) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "string" && !value.trim())
  ) {
    return "Unknown date";
  }

  const date = new Date(value);

  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : "Unknown date";
}

function safePreviewUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  // Moderation previews are expected to use same-origin paths.
  // Reject absolute URLs, protocol-relative URLs and other schemes.
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return null;
  }

  try {
    const url = new URL(value, "https://forum.invalid");

    if (url.origin !== "https://forum.invalid") {
      return null;
    }

    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

function isValidAttachment(attachment) {
  return Boolean(
    attachment &&
    typeof attachment === "object" &&
    validId(attachment.id) &&
    typeof attachment.uploader === "string" &&
    attachment.uploader.length > 0 &&
    validId(attachment.postId) &&
    typeof attachment.createdAt === "string" ||
    (
      attachment &&
      typeof attachment === "object" &&
      validId(attachment.id) &&
      typeof attachment.uploader === "string" &&
      attachment.uploader.length > 0 &&
      validId(attachment.postId) &&
      typeof attachment.createdAt === "number"
    ),
  );
}

function isValidAvatar(avatar) {
  return Boolean(
    avatar &&
    typeof avatar === "object" &&
    validId(avatar.userId) &&
    typeof avatar.username === "string" &&
    avatar.username.length > 0 &&
    (
      typeof avatar.uploadedAt === "string" ||
      typeof avatar.uploadedAt === "number"
    ) &&
    validId(avatar.pendingVersion),
  );
}

function isValidGif(gif) {
  return Boolean(
    gif &&
    typeof gif === "object" &&
    validId(gif.id) &&
    typeof gif.uploader === "string" &&
    gif.uploader.length > 0 &&
    (
      typeof gif.createdAt === "string" ||
      typeof gif.createdAt === "number"
    ),
  );
}

function appendLoadError(list, document) {
  addText(
    document,
    list,
    "p",
    "The moderation queue could not be loaded.",
    "empty-state",
  );
}

function getValidQueueItems(items, list, document, emptyMessage) {
  if (!Array.isArray(items)) {
    appendLoadError(list, document);
    return null;
  }

  if (!items.length) {
    addText(document, list, "p", emptyMessage, "empty-state");
    return null;
  }

  const validItems = items.filter((item) => item !== null);

  return validItems;
}

// Pending image moderation queue (plan Task 6/7): oldest uploads first from
// GET /api/admin/attachments. Mirrors the avatar queue above, sized down to a
// small strip preview; the preview URL can 404 (pending bytes serve only to
// the uploader and mods), so the <img> hides itself on error.
function createAttachmentQueue(attachments, document) {
  const list = document.createElement("div");
  list.className = "attachment-queue";

  const items = getValidQueueItems(
    attachments,
    list,
    document,
    "No images are awaiting review.",
  );

  if (!items) {
    return list;
  }

  const validAttachments = items.filter(isValidAttachment);

  if (!validAttachments.length) {
    appendLoadError(list, document);
    return list;
  }

  for (const attachment of validAttachments) {
    const card = document.createElement("article");
    card.className = "attachment-card";

    addText(document, card, "h3", attachment.uploader);

    addText(
      document,
      card,
      "p",
      `Image for post #${attachment.postId} · uploaded ${formatDate(attachment.createdAt)}`,
    );

    // sizeBytes/chunkCount come from SQL aggregation over the attachment's
    // D1 chunks (display-only; size is what moderation acts on).
    const sizeBytes = Number(attachment.sizeBytes);
    const chunkCount = Number(attachment.chunkCount);

    const hasValidSize =
      Number.isFinite(sizeBytes) && sizeBytes >= 0;

    const hasValidChunkCount =
      Number.isSafeInteger(chunkCount) && chunkCount >= 0;

    const sizeLabel = hasValidSize
      ? `${Math.max(1, Math.ceil(sizeBytes / 1024))} KB`
      : "Unknown size";

    const chunkLabel = hasValidChunkCount
      ? `${chunkCount} chunk${chunkCount === 1 ? "" : "s"}`
      : "Unknown chunk count";

    const mime =
      typeof attachment.mime === "string" && attachment.mime.trim()
        ? attachment.mime
        : "Unknown type";

    addText(
      document,
      card,
      "p",
      `${mime} · ${sizeLabel} · ${chunkLabel}`,
      "muted",
    );

    const image = document.createElement("img");
    image.className = "attachment-preview";
    image.src = `/api/attachments/${Number(attachment.id)}`;
    image.alt = `Pending image from ${attachment.uploader}`;
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove());

    card.append(image);

    const actions = document.createElement("div");
    actions.className = "form-actions";

    for (const [formName, label, className] of [
      ["admin-attachment-approve", "Approve", "button button-primary"],
      ["admin-attachment-reject", "Reject", "button button-danger"],
    ]) {
      const form = document.createElement("form");
      form.dataset.form = formName;
      form.dataset.attachmentId = String(Number(attachment.id));

      const button = document.createElement("button");
      button.type = "submit";
      button.className = className;
      button.textContent = label;

      form.append(button);
      actions.append(form);
    }

    card.append(actions);
    list.append(card);
  }

  return list;
}

// Pending avatar moderation queue (spec §9): oldest uploads first from
// GET /api/admin/avatars. The preview URL can 404 (serving is gated), so the
// <img> hides itself on error instead of showing a broken image.
function createAvatarQueue(avatars, document) {
  const list = document.createElement("div");
  list.className = "avatar-queue";

  const items = getValidQueueItems(
    avatars,
    list,
    document,
    "No avatars are awaiting review.",
  );

  if (!items) {
    return list;
  }

  const validAvatars = items.filter(isValidAvatar);

  if (!validAvatars.length) {
    appendLoadError(list, document);
    return list;
  }

  for (const avatar of validAvatars) {
    const card = document.createElement("article");
    card.className = "avatar-card";

    addText(document, card, "h3", avatar.username);

    addText(
      document,
      card,
      "p",
      `Uploaded ${formatDate(avatar.uploadedAt)}`,
    );

    const image = document.createElement("img");
    image.className = "avatar avatar-preview";

    const previewUrl = safePreviewUrl(avatar.avatarUrl);

    if (previewUrl) {
      image.src = previewUrl;
      image.alt = `Pending avatar of ${avatar.username}`;
      image.addEventListener("error", () => image.remove());
      card.append(image);
    }

    const actions = document.createElement("div");
    actions.className = "form-actions";

    for (const [formName, label, className] of [
      ["admin-avatar-approve", "Approve", "button button-primary"],
      ["admin-avatar-reject", "Reject", "button button-danger"],
    ]) {
      const form = document.createElement("form");
      form.dataset.form = formName;
      form.dataset.userId = String(Number(avatar.userId));

      // The reviewed version rides every decision; the server matches it on
      // approve so a replacement upload can't inherit a stale review.
      form.dataset.pendingVersion = String(avatar.pendingVersion ?? "");

      const button = document.createElement("button");
      button.type = "submit";
      button.className = className;
      button.textContent = label;

      form.append(button);
      actions.append(form);
    }

    card.append(actions);
    list.append(card);
  }

  return list;
}

function createGifQueue(gifs, document) {
  const list = document.createElement("div");
  list.className = "gif-review-queue";

  const items = getValidQueueItems(
    gifs,
    list,
    document,
    "No GIFs are awaiting review.",
  );

  if (!items) {
    return list;
  }

  const validGifs = items.filter(isValidGif);

  if (!validGifs.length) {
    appendLoadError(list, document);
    return list;
  }

  for (const gif of validGifs) {
    const card = document.createElement("article");
    card.className = "attachment-card gif-review-card";

    addText(
      document,
      card,
      "p",
      `${gif.uploader} · uploaded ${formatDate(gif.createdAt)}`,
    );

    const image = document.createElement("img");
    image.loading = "lazy";
    image.alt = "GIF submitted for moderation";

    const previewUrl = safePreviewUrl(gif.previewUrl);

    if (previewUrl) {
      image.src = previewUrl;
      image.addEventListener("error", () => {
        image.hidden = true;
      });
    } else {
      image.hidden = true;
    }

    const actions = document.createElement("div");
    actions.className = "form-actions";

    for (const [decision, label] of [
      ["approve", "Approve GIF"],
      ["reject", "Reject GIF"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        decision === "approve"
          ? "button"
          : "button button-danger";

      button.dataset.action =
        decision === "approve"
          ? "gif-approve"
          : "gif-reject";

      button.dataset.gifId = String(Number(gif.id));
      button.textContent = label;

      actions.append(button);
    }

    card.append(image, actions);
    list.append(card);
  }

  return list;
}

export {
  createAttachmentQueue,
  createAvatarQueue,
  createGifQueue,
};
