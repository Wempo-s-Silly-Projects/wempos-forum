// v4.0 plan 5 (spec step 6), task 1: the moderation desk's media review queues (attachments, avatars, GIFs) section
// builders — bodies moved verbatim out of ../admin.js (now dissolved).
import { addText } from "../forms.js";

// Pending image moderation queue (plan Task 6/7): oldest uploads first from
// GET /api/admin/attachments. Mirrors the avatar queue above, sized down to a
// small strip preview; the preview URL can 404 (pending bytes serve only to
// the uploader and mods), so the <img> hides itself on error.
function createAttachmentQueue(attachments, document) {
  const list = document.createElement("div");
  list.className = "attachment-queue";
  if (!attachments.length) {
    addText(document, list, "p", "No images are awaiting review.", "empty-state");
    return list;
  }
  for (const attachment of attachments) {
    const card = document.createElement("article");
    card.className = "attachment-card";
    addText(document, card, "h3", attachment.uploader);
    addText(document, card, "p",
      `Image for post #${attachment.postId} · uploaded ${new Date(attachment.createdAt).toLocaleString()}`);
    addText(document, card, "p",
      // sizeBytes/chunkCount come from SQL aggregation over the attachment's
      // D1 chunks (display-only; size is what moderation acts on).
      `${attachment.mime} · ${Math.max(1, Math.ceil(attachment.sizeBytes / 1024))} KB · ${attachment.chunkCount} chunk${attachment.chunkCount === 1 ? "" : "s"}`, "muted");
    const image = document.createElement("img");
    image.className = "attachment-preview";
    image.src = `/api/attachments/${attachment.id}`;
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
      form.dataset.attachmentId = attachment.id;
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
  if (!avatars.length) {
    addText(document, list, "p", "No avatars are awaiting review.", "empty-state");
    return list;
  }
  for (const avatar of avatars) {
    const card = document.createElement("article");
    card.className = "avatar-card";
    addText(document, card, "h3", avatar.username);
    addText(document, card, "p", `Uploaded ${new Date(avatar.uploadedAt).toLocaleString()}`);
    const image = document.createElement("img");
    image.className = "avatar avatar-preview";
    image.src = avatar.avatarUrl;
    image.alt = `Pending avatar of ${avatar.username}`;
    image.addEventListener("error", () => image.remove());
    card.append(image);
    const actions = document.createElement("div");
    actions.className = "form-actions";
    for (const [formName, label, className] of [
      ["admin-avatar-approve", "Approve", "button button-primary"],
      ["admin-avatar-reject", "Reject", "button button-danger"],
    ]) {
      const form = document.createElement("form");
      form.dataset.form = formName;
      form.dataset.userId = String(avatar.userId);
      // The reviewed version rides every decision; the server matches it on
      // approve so a replacement upload can't inherit a stale review.
      form.dataset.pendingVersion = String(avatar.pendingVersion || "");
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
  if (!gifs.length) {
    addText(document, list, "p", "No GIFs are awaiting review.", "empty-state");
    return list;
  }
  for (const gif of gifs) {
    const card = document.createElement("article");
    card.className = "attachment-card gif-review-card";
    addText(document, card, "p", `${gif.uploader} · uploaded ${new Date(gif.createdAt).toLocaleString()}`);
    const image = document.createElement("img");
    image.src = gif.previewUrl;
    image.alt = "GIF submitted for moderation";
    image.loading = "lazy";
    image.addEventListener("error", () => { image.hidden = true; });
    const actions = document.createElement("div");
    actions.className = "form-actions";
    for (const [decision, label] of [["approve", "Approve GIF"], ["reject", "Reject GIF"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = decision === "approve" ? "button" : "button button-danger";
      button.dataset.action = decision === "approve" ? "gif-approve" : "gif-reject";
      button.dataset.gifId = String(gif.id);
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
