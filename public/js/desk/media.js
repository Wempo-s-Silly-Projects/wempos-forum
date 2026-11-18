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

// v4.0 plan 5 (spec step 6), task 1: the moderation desk's media review queues (attachments, avatars, GIFs) section
// builders — bodies moved verbatim out of ../admin.js (now dissolved) and
// re-expressed on the vendored kit (5.0 wave 6).
import { el } from "../vendor/frontload/dom.mjs";
import { addText } from "../vendor/designer/kit.mjs";

// Pending image moderation queue (plan Task 6/7): oldest uploads first from
// GET /api/admin/attachments. Mirrors the avatar queue above, sized down to a
// small strip preview; the preview URL can 404 (pending bytes serve only to
// the uploader and mods), so the <img> hides itself on error.
function createAttachmentQueue(attachments) {
  const list = el("div", { class: "attachment-queue" });
  if (!attachments.length) {
    addText(list, "No images are awaiting review.", "empty-state");
    return list;
  }
  for (const attachment of attachments) {
    const card = el("article", { class: "attachment-card" });
    card.append(el("h3", { text: attachment.uploader }));
    addText(card,
      `Image for post #${attachment.postId} · uploaded ${new Date(attachment.createdAt).toLocaleString()}`);
    // sizeBytes/chunkCount come from SQL aggregation over the attachment's
    // D1 chunks (display-only; size is what moderation acts on).
    addText(card,
      `${attachment.mime} · ${Math.max(1, Math.ceil(attachment.sizeBytes / 1024))} KB · ${attachment.chunkCount} chunk${attachment.chunkCount === 1 ? "" : "s"}`, "muted");
    const image = el("img", {
      class: "attachment-preview",
      src: `/api/attachments/${attachment.id}`,
      alt: `Pending image from ${attachment.uploader}`,
      loading: "lazy",
    });
    image.addEventListener("error", () => image.remove());
    card.append(image);
    const actions = el("div", { class: "form-actions" });
    for (const [formName, label, className] of [
      ["admin-attachment-approve", "Approve", "button button-primary"],
      ["admin-attachment-reject", "Reject", "button button-danger"],
    ]) {
      const form = el("form", {
        dataset: { form: formName, attachmentId: attachment.id },
      });
      form.append(el("button", { type: "submit", class: className, text: label }));
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
function createAvatarQueue(avatars) {
  const list = el("div", { class: "avatar-queue" });
  if (!avatars.length) {
    addText(list, "No avatars are awaiting review.", "empty-state");
    return list;
  }
  for (const avatar of avatars) {
    const card = el("article", { class: "avatar-card" });
    card.append(el("h3", { text: avatar.username }));
    addText(card, `Uploaded ${new Date(avatar.uploadedAt).toLocaleString()}`);
    const image = el("img", {
      class: "avatar avatar-preview",
      src: avatar.avatarUrl,
      alt: `Pending avatar of ${avatar.username}`,
    });
    image.addEventListener("error", () => image.remove());
    card.append(image);
    const actions = el("div", { class: "form-actions" });
    for (const [formName, label, className] of [
      ["admin-avatar-approve", "Approve", "button button-primary"],
      ["admin-avatar-reject", "Reject", "button button-danger"],
    ]) {
      const form = el("form", {
        dataset: {
          form: formName,
          userId: String(avatar.userId),
          // The reviewed version rides every decision; the server matches it on
          // approve so a replacement upload can't inherit a stale review.
          pendingVersion: String(avatar.pendingVersion || ""),
        },
      });
      form.append(el("button", { type: "submit", class: className, text: label }));
      actions.append(form);
    }
    card.append(actions);
    list.append(card);
  }
  return list;
}


function createGifQueue(gifs) {
  const list = el("div", { class: "gif-review-queue" });
  if (!gifs.length) {
    addText(list, "No GIFs are awaiting review.", "empty-state");
    return list;
  }
  for (const gif of gifs) {
    const card = el("article", { class: "attachment-card gif-review-card" });
    addText(card, `${gif.uploader} · uploaded ${new Date(gif.createdAt).toLocaleString()}`);
    const image = el("img", {
      src: gif.previewUrl,
      alt: "GIF submitted for moderation",
      loading: "lazy",
    });
    image.addEventListener("error", () => { image.hidden = true; });
    const actions = el("div", { class: "form-actions" });
    for (const [decision, label] of [["approve", "Approve GIF"], ["reject", "Reject GIF"]]) {
      actions.append(el("button", {
        type: "button",
        class: decision === "approve" ? "button" : "button button-danger",
        dataset: { action: decision === "approve" ? "gif-approve" : "gif-reject", gifId: String(gif.id) },
        text: label,
      }));
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
