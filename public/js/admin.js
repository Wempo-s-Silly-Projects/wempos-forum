import { createForm, createInput, addText } from "./forms.js";

export const createReportQueue = (reports, document, currentUser = null) => {
  const list = document.createElement("div");
  list.className = "report-list";
  if (!reports.length) {
    addText(document, list, "p", "The report queue is clear.", "empty-state");
    return list;
  }
  for (const report of reports) {
    const card = document.createElement("article");
    card.className = "report-card";
    card.dataset.reportId = String(report.id);
    addText(document, card, "h2", `Report #${report.id}`);
    addText(document, card, "p", `Reported by ${report.reporter.username}: ${report.reason}`);
    const postLink = document.createElement("a");
    postLink.href = `/posts/${report.post.id}`;
    postLink.textContent = `Post by ${report.post.author.username}: ${report.post.body}`;
    card.append(postLink);
    const actions = document.createElement("div");
    actions.className = "form-actions";
    for (const [action, label] of [["dismiss", "Dismiss"], ["hide_post", "Hide post"]]) {
      const form = document.createElement("form");
      form.dataset.form = "admin-resolve";
      form.dataset.reportId = String(report.id);
      form.dataset.action = action;
      const button = document.createElement("button");
      button.type = "submit";
      button.className = action === "hide_post" ? "button button-danger" : "button button-secondary";
      button.textContent = label;
      form.append(button);
      actions.append(form);
    }
    const banForm = createForm(document, "admin-ban", [
      createInput(document, {
        id: `ban-reason-${report.id}`,
        name: "reason",
        label: `Reason to ban ${report.post.author.username}`,
        required: true,
        maxLength: 500,
      }),
    ], "Ban author");
    banForm.dataset.userId = String(report.post.author.id);
    actions.append(banForm);
    // Role changes are strictly admin-only (the report queue itself is open to
    // moderators); target start roles are not known from the payload, so both
    // forms are offered and the server reports a stale-role 409 if the target
    // is already in that role.
    if (currentUser && currentUser.role === "admin") {
      const promoteForm = createForm(document, "admin-promote", [
        createInput(document, {
          id: `promote-reason-${report.id}`,
          name: "reason",
          label: `Reason to promote ${report.post.author.username} (optional)`,
          maxLength: 500,
        }),
      ], "Promote to moderator");
      promoteForm.dataset.userId = String(report.post.author.id);
      const demoteForm = createForm(document, "admin-demote", [
        createInput(document, {
          id: `demote-reason-${report.id}`,
          name: "reason",
          label: `Reason to demote ${report.post.author.username} (optional)`,
          maxLength: 500,
        }),
      ], "Demote to member");
      demoteForm.dataset.userId = String(report.post.author.id);
      actions.append(promoteForm, demoteForm);
    }
    card.append(actions);
    list.append(card);
  }
  return list;
}

export function createActiveBanList(bans, document) {
  const list = document.createElement("div");
  list.className = "ban-list";
  if (!bans.length) {
    addText(document, list, "p", "There are no active bans.", "empty-state");
    return list;
  }
  for (const ban of bans) {
    const card = document.createElement("article");
    card.className = "ban-card";
    addText(document, card, "h3", ban.user.username);
    addText(document, card, "p", `Reason: ${ban.reason}`);
    if (ban.expiresAt) {
      addText(document, card, "p", `Expires: ${new Date(ban.expiresAt).toLocaleString()}`);
    }
    const form = createForm(document, "admin-unban", [
      createInput(document, {
        id: `unban-reason-${ban.id}`,
        name: "reason",
        label: `Reason to unban ${ban.user.username}`,
        required: true,
        maxLength: 500,
      }),
    ], "Unban user");
    form.dataset.userId = String(ban.user.id);
    card.append(form);
    list.append(card);
  }
  return list;
}

// Pending image moderation queue (plan Task 6/7): oldest uploads first from
// GET /api/admin/attachments. Mirrors the avatar queue above, sized down to a
// small strip preview; the preview URL can 404 (pending bytes serve only to
// the uploader and moderators), so the <img> hides itself on error.
export function createAttachmentQueue(attachments, document) {
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
export function createAvatarQueue(avatars, document) {
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
