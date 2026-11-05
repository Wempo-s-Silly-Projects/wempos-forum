import { createCheckbox, createForm, createInput, createSelect, addText } from "./forms.js";

// Auto-mod / Vision (v3.1): the SafeSearch categories, in desk reading order.
// LIKELY+ values flag red; everything else prints muted.
const VISION_CATEGORIES = ["adult", "violence", "racy", "medical", "spoof"];
const VISION_FLAG_LEVELS = ["LIKELY", "VERY_LIKELY"];

// One muted report line for a pending queue card. vision comes straight from
// the queue payloads: null = no report yet (still checking, or the subsystem
// is off/not configured); { error } = the check ran but Vision failed
// (fail-open — the item still waits for a human either way).
export function appendVisionVerdict(document, card, vision) {
  if (!vision) {
    addText(document, card, "p", "Vision: no report yet.", "vision-verdict");
    return;
  }
  if (vision.error) {
    addText(document, card, "p", "Vision: unavailable (" + vision.error + ")", "vision-verdict");
    return;
  }
  const parts = [];
  let flagged = false;
  for (const category of VISION_CATEGORIES) {
    const value = vision[category];
    if (!value) continue;
    parts.push(category + ": " + value.toLowerCase().replace("very_", "very "));
    if (VISION_FLAG_LEVELS.includes(value)) flagged = true;
  }
  addText(document, card, "p",
    parts.length ? "Vision: " + parts.join(" · ") : "Vision: no flags reported.",
    "vision-verdict" + (flagged ? " vision-verdict-flagged" : ""));
}

// The desk's Auto-mod control (v3.1): the status line plus THE kill switch —
// one click trips or clears the server-side toggle, effective on the next
// upload, no deploy. The switch is INDEPENDENT of the API key: the key gates
// configuration, the switch gates operation, and the switch state lives in
// the database — adding, rotating, or deleting the key secret can never
// silently re-enable (or reset) a tripped switch. So the toggle renders in
// EVERY state, including unconfigured, to make that durability visible.
export function createVisionSection(vision, document) {
  const section = document.createElement("div");
  section.className = "vision-section";
  if (!vision.configured) {
    addText(document, section, "p",
      "Auto-mod is not configured — set the GOOGLE_VISION_API_KEY secret to enable it.", "muted");
  }
  addText(document, section, "p",
    vision.killSwitch
      ? "The kill switch is TRIPPED — new uploads are not checked. This stays tripped even if the API key is added or changed; only this button clears it."
      : vision.configured
        ? "Auto-mod is running — every new upload gets a Google Vision check in the background."
        : "The kill switch is clear. Auto-mod starts checking once a key is configured.",
    "vision-status" + (vision.killSwitch ? " vision-status-stopped" : ""));
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = vision.killSwitch ? "button" : "button button-danger";
  toggle.dataset.action = vision.killSwitch ? "vision-resume" : "vision-kill";
  toggle.textContent = vision.killSwitch ? "Clear the kill switch (resume auto-mod)" : "Kill switch: STOP auto-mod";
  section.append(toggle);
  return section;
}

// The desk's text auto-mod control (v3.1): the OpenAI Moderation twin of the
// Vision section — status line plus THE kill switch, one click, effective on
// the next piece of member text. The same independence rule: the switch lives
// in the database, so the OPENAI_API_KEY secret can never reset it.
export function createTextModSection(textMod, document) {
  const section = document.createElement("div");
  section.className = "vision-section";
  if (!textMod.configured) {
    addText(document, section, "p",
      "Text auto-mod is not configured — set the OPENAI_API_KEY secret to enable it.", "muted");
  }
  addText(document, section, "p",
    textMod.killSwitch
      ? "The text kill switch is TRIPPED — member text is not checked. This stays tripped even if the API key is added or changed; only this button clears it."
      : textMod.configured
        ? "Text auto-mod is running — every post, reply, chat message, and DM gets an OpenAI moderation check in the background."
        : "The text kill switch is clear. Text auto-mod starts checking once a key is configured.",
    "vision-status" + (textMod.killSwitch ? " vision-status-stopped" : ""));
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = textMod.killSwitch ? "button" : "button button-danger";
  toggle.dataset.action = textMod.killSwitch ? "text-mod-resume" : "text-mod-kill";
  toggle.textContent = textMod.killSwitch
    ? "Clear the text kill switch (resume text auto-mod)"
    : "Kill switch: STOP text auto-mod";
  section.append(toggle);
  return section;
}

// The appeals queue (v3.1): one card per appeal. Pending appeals carry the
// decision pair; decided ones show their outcome. Context differs by kind —
// auto-mod appeals show the machine reason and verdicts, ban appeals show
// the ban reason — so the desk can judge the appeal, not just read it.
export function createAppealQueue(appeals, document) {
  const list = document.createElement("div");
  list.className = "appeal-list";
  if (!appeals.length) {
    addText(document, list, "p", "There are no appeals.", "empty-state");
    return list;
  }
  for (const appeal of appeals) {
    const card = document.createElement("article");
    card.className = "appeal-card";
    addText(document, card, "h3", `Appeal #${appeal.id} — ${appeal.username}`);
    addText(document, card, "p",
      appeal.kind === "ban" ? "Ban appeal" : "Auto-mod appeal",
      "muted");
    if (appeal.kind === "auto_image") {
      addText(document, card, "p", "Removed by: " + (appeal.actionReason || "auto-mod"));
      if (appeal.verdicts) {
        addText(document, card, "p",
          "Vision verdicts: " + Object.entries(appeal.verdicts)
            .filter(([, value]) => value)
            .map(([category, value]) => category + ": " + value)
            .join(" · "),
          "vision-verdict");
      }
    } else if (appeal.kind === "auto_text") {
      // Text verdicts: { flagged, categories: { name: score } } — only what
      // OpenAI flagged rides in the payload.
      addText(document, card, "p",
        appeal.entityKind === "post"
          ? "Hidden by: " + (appeal.actionReason || "auto-mod")
          : "Removed by: " + (appeal.actionReason || "auto-mod"));
      if (appeal.verdicts && appeal.verdicts.categories) {
        addText(document, card, "p",
          "Moderation scores: " + Object.entries(appeal.verdicts.categories)
            .map(([category, score]) => category + " " + Number(score).toFixed(2))
            .join(" · "),
          "vision-verdict");
      }
    } else {
      addText(document, card, "p", "Ban reason: " + (appeal.banReason || "No reason was provided."));
    }
    addText(document, card, "p", '"' + appeal.body + '"', "appeal-body");
    addText(document, card, "p",
      appeal.status === "pending"
        ? "Waiting for review — filed " + new Date(appeal.createdAt).toLocaleString()
        : appeal.status === "approved"
          ? "Approved " + (appeal.decidedAt ? new Date(appeal.decidedAt).toLocaleString() : "")
          : "Denied " + (appeal.decidedAt ? new Date(appeal.decidedAt).toLocaleString() : ""),
      "muted");
    if (appeal.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "form-actions";
      for (const [decision, label, className] of [
        ["approve", "Approve appeal", "button button-primary"],
        ["deny", "Deny appeal", "button button-danger"],
      ]) {
        const form = document.createElement("form");
        form.dataset.form = "admin-appeal";
        form.dataset.appealId = String(appeal.id);
        form.dataset.decision = decision;
        const button = document.createElement("button");
        button.type = "submit";
        button.className = className;
        button.textContent = label;
        form.append(button);
        actions.append(form);
      }
      card.append(actions);
    }
    list.append(card);
  }
  return list;
}

// Timed bans (v3.0.2): the duration picker's hours; 0 = permanent. The form
// submit handler (submitBanForm in app.js) turns hours into an absolute
// expiresAt, which the server validates (a minute to a year out).
export const BAN_DURATION_HOURS = [
  { value: "0", label: "Permanent" },
  { value: "24", label: "1 day" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
];

// One ban form — reason + duration + the opt-in IP ban — shared by the
// post-report queue, the profile-report queue, and the member search results,
// so a reported member can be banned from any desk.
export const createBanForm = (document, userId, username) => {
  const form = createForm(document, "admin-ban", [
    createInput(document, {
      id: `ban-reason-${userId}-${Math.random().toString(36).slice(2, 8)}`,
      name: "reason",
      label: `Reason to ban ${username}`,
      required: true,
      maxLength: 500,
    }),
    createSelect(document, {
      id: `ban-duration-${userId}-${Math.random().toString(36).slice(2, 8)}`,
      name: "duration",
      label: "Ban duration",
      options: BAN_DURATION_HOURS,
      description: "Timed bans auto-reactivate the account when they expire.",
    }),
    createCheckbox(document, {
      id: `ban-ip-${userId}-${Math.random().toString(36).slice(2, 8)}`,
      name: "ipBan",
      label: "Also block this member's known networks (IP ban)",
      description: "Refuses sign-in and new accounts from every network they signed in from. Unbanning removes it. Shared connections (school/home networks) are blocked too — use with care.",
    }),
  ], "Ban member");
  form.dataset.userId = String(userId);
  return form;
};

// Find a member (v3.1, Pone's ask): staff search by username with the
// active-ban state attached. Results render into the results container the
// submit handler owns, so the desk section is self-contained.
export function createMemberSearch(document) {
  const section = document.createElement("div");
  section.className = "member-search";
  const form = createForm(document, "admin-member-search", [
    createInput(document, {
      id: "member-search-q",
      name: "q",
      label: "Find a member",
      maxLength: 24,
      description: "Search by username to find members and unban them.",
    }),
  ], "Search");
  const results = document.createElement("div");
  results.className = "member-search-results";
  results.dataset.memberSearchResults = "";
  section.append(form, results);
  return section;
}

export function renderMemberSearchResults(members, document) {
  const list = document.createElement("div");
  list.className = "member-search-result-list";
  if (!members.length) {
    addText(document, list, "p", "No members matched.", "empty-state");
    return list;
  }
  for (const member of members) {
    const row = document.createElement("article");
    row.className = "member-search-row";
    const link = document.createElement("a");
    link.href = "/users/" + encodeURIComponent(member.username);
    link.setAttribute("data-app-link", "");
    link.textContent = member.username;
    row.append(link);
    if (member.role === "owner" || member.role === "admin") {
      addText(document, row, "span",
        member.role === "owner" ? "Owner" : "Admin",
        "role-badge role-badge-" + member.role);
    }
    if (member.banned) {
      addText(document, row, "p",
        "Banned: " + (member.banReason || "no reason recorded") +
        (member.banExpiresAt
          ? " — expires " + new Date(member.banExpiresAt * 1000).toLocaleString()
          : " — permanent"),
        "member-search-ban-info");
      const unbanForm = createForm(document, "admin-unban", [
        createInput(document, {
          id: `unban-reason-search-${member.id}`,
          name: "reason",
          label: `Reason to unban ${member.username}`,
          required: true,
          maxLength: 500,
        }),
      ], "Unban member");
      unbanForm.dataset.userId = String(member.id);
      row.append(unbanForm);
    } else {
      addText(document, row, "p", "Not banned.", "muted");
    }
    list.append(row);
  }
  return list;
}

// DM log (v3.1): the desk's full 1:1 stream — newest first, both participants
// named per message ("A ↔ B"), banned authors marked. Same review-and-delete
// posture as the chat log (the owner's call: DMs get the same scrutiny as
// posts). DM ids share the data-dm-message-id namespace with the panel.
export function createDmLog(messages, document) {
  const list = document.createElement("div");
  list.className = "chat-log";
  if (!messages.length) {
    addText(document, list, "p", "There are no DMs yet.", "empty-state");
    return list;
  }
  for (const message of messages) {
    const row = document.createElement("article");
    row.className = "chat-log-row";
    row.dataset.dmMessageId = String(message.id);
    const head = document.createElement("p");
    head.className = "chat-log-head";
    addText(document, head, "span",
      (message.between?.[0] ?? "?") + " ↔ " + (message.between?.[1] ?? "?"),
      "chat-log-pair");
    const when = document.createElement("time");
    when.textContent = new Date(message.createdAt).toLocaleString() + " — by " + message.author.username;
    head.append(when);
    row.append(head);
    if (message.authorBanned) {
      addText(document, row, "p", "Banned author", "chat-log-banned");
    }
    addText(document, row, "p", message.body, "chat-log-body");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-danger";
    remove.dataset.action = "dm-delete";
    remove.dataset.chatMessageId = String(message.id);
    remove.textContent = "Delete message";
    row.append(remove);
    list.append(row);
  }
  return list;
}

// Chat log (v3.1): the desk's full stream — newest first, 100 per page,
// INCLUDING messages by actively banned members (marked; the public read
// hides them). Every row carries the same delete control the panel gives
// staff; chat deletion is permanent (chat is the hallway, posts are the
// record). Rows share the panel's data-chat-message-id so the global
// chat-delete handler removes either copy.
export function createChatLog(messages, document) {
  const list = document.createElement("div");
  list.className = "chat-log";
  if (!messages.length) {
    addText(document, list, "p", "The chat has no messages yet.", "empty-state");
    return list;
  }
  for (const message of messages) {
    const row = document.createElement("article");
    row.className = "chat-log-row";
    row.dataset.chatMessageId = String(message.id);
    const head = document.createElement("p");
    head.className = "chat-log-head";
    const link = document.createElement("a");
    link.href = "/users/" + encodeURIComponent(message.author.username);
    link.setAttribute("data-app-link", "");
    link.textContent = message.author.username;
    head.append(link);
    if (message.author.role === "owner" || message.author.role === "admin") {
      addText(document, head, "span",
        message.author.role === "owner" ? "Owner" : "Admin",
        "role-badge role-badge-" + message.author.role);
    }
    if (message.authorBanned) {
      addText(document, head, "span", "Banned author — hidden from chat", "chat-log-banned");
    }
    const when = document.createElement("time");
    when.textContent = new Date(message.createdAt).toLocaleString();
    head.append(when);
    row.append(head);
    addText(document, row, "p", message.body, "chat-log-body");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-danger";
    remove.dataset.action = "chat-delete";
    remove.dataset.chatMessageId = String(message.id);
    remove.textContent = "Delete message";
    row.append(remove);
    list.append(row);
  }
  return list;
}

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
    const banForm = createBanForm(document, report.post.author.id, report.post.author.username);
    actions.append(banForm);
    // Role changes are strictly owner-only (v3.1: the report queue itself is
    // open to admins); target start roles are not known from the payload, so
    // both forms are offered and the server reports a stale-role 409 if the
    // target is already in that role.
    if (currentUser && currentUser.role === "owner") {
      const promoteForm = createForm(document, "admin-promote", [
        createInput(document, {
          id: `promote-reason-${report.id}`,
          name: "reason",
          label: `Reason to promote ${report.post.author.username} (optional)`,
          maxLength: 500,
        }),
      ], "Promote to mod");
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
// the uploader and mods), so the <img> hides itself on error.
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
    appendVisionVerdict(document, card, attachment.vision);
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
    appendVisionVerdict(document, card, avatar.vision);
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


export function createGifQueue(gifs, document) {
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
    appendVisionVerdict(document, card, gif.vision);
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
