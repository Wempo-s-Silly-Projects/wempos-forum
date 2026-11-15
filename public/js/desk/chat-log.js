
// v4.0 plan 5 (spec step 6), task 1: the moderation desk's chat + DM logs
// section — builders moved out of ../admin.js (now dissolved).
import { addText } from "../forms.js";

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0;
}

function formatDate(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return "Unknown date";
  }

  if (typeof value === "string" && !value.trim()) {
    return "Unknown date";
  }

  const date = new Date(value);

  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : "Unknown date";
}

function isValidAuthor(author) {
  return Boolean(
    author &&
    typeof author === "object" &&
    typeof author.username === "string" &&
    author.username.length > 0,
  );
}

function isValidDmMessage(message) {
  return Boolean(
    message &&
    typeof message === "object" &&
    validId(message.id) &&
    isValidAuthor(message.author) &&
    typeof message.body === "string" &&
    (
      typeof message.createdAt === "string" ||
      typeof message.createdAt === "number"
    ) &&
    Number.isFinite(new Date(message.createdAt).getTime()),
  );
}

function isValidChatMessage(message) {
  return Boolean(
    message &&
    typeof message === "object" &&
    validId(message.id) &&
    isValidAuthor(message.author) &&
    typeof message.body === "string" &&
    (
      typeof message.createdAt === "string" ||
      typeof message.createdAt === "number"
    ) &&
    Number.isFinite(new Date(message.createdAt).getTime()),
  );
}

function appendLoadError(list, document) {
  addText(
    document,
    list,
    "p",
    "Messages could not be loaded.",
    "empty-state",
  );
}

// DM log (v3.1): the desk's full 1:1 stream — newest first, both participants
// named per message ("A ↔ B"), banned authors marked. Same review-and-delete
// posture as the chat log (the owner's call: DMs get the same scrutiny as
// posts). DM ids share the data-dm-message-id namespace with the panel.
function createDmLog(messages, document) {
  const list = document.createElement("div");
  list.className = "chat-log";

  if (!Array.isArray(messages)) {
    appendLoadError(list, document);
    return list;
  }

  if (!messages.length) {
    addText(document, list, "p", "There are no DMs yet.", "empty-state");
    return list;
  }

  const validMessages = messages.filter(isValidDmMessage);

  if (!validMessages.length) {
    appendLoadError(list, document);
    return list;
  }

  for (const message of validMessages) {
    const row = document.createElement("article");
    row.className = "chat-log-row";
    row.dataset.dmMessageId = String(message.id);

    const head = document.createElement("p");
    head.className = "chat-log-head";

    const participants = Array.isArray(message.between)
      ? message.between
          .slice(0, 2)
          .map((name) => typeof name === "string" ? name : "?")
      : [];

    const firstParticipant = participants[0] ?? "?";
    const secondParticipant = participants[1] ?? "?";

    addText(
      document,
      head,
      "span",
      firstParticipant + " ↔ " + secondParticipant,
      "chat-log-pair",
    );

    const when = document.createElement("time");
    when.dateTime = new Date(message.createdAt).toISOString();
    when.textContent =
      formatDate(message.createdAt) + " — by " + message.author.username;

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
    remove.setAttribute(
      "aria-label",
      `Delete DM message ${message.id}`,
    );

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
function createChatLog(messages, document) {
  const list = document.createElement("div");
  list.className = "chat-log";

  if (!Array.isArray(messages)) {
    appendLoadError(list, document);
    return list;
  }

  if (!messages.length) {
    addText(
      document,
      list,
      "p",
      "The chat has no messages yet.",
      "empty-state",
    );
    return list;
  }

  const validMessages = messages.filter(isValidChatMessage);

  if (!validMessages.length) {
    appendLoadError(list, document);
    return list;
  }

  for (const message of validMessages) {
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

    if (
      message.author.role === "owner" ||
      message.author.role === "admin"
    ) {
      addText(
        document,
        head,
        "span",
        message.author.role === "owner" ? "Owner" : "Admin",
        "role-badge role-badge-" + message.author.role,
      );
    }

    if (message.authorBanned) {
      addText(
        document,
        head,
        "span",
        "Banned author — hidden from chat",
        "chat-log-banned",
      );
    }

    const when = document.createElement("time");
    when.dateTime = new Date(message.createdAt).toISOString();
    when.textContent = formatDate(message.createdAt);

    head.append(when);
    row.append(head);

    addText(document, row, "p", message.body, "chat-log-body");

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-danger";
    remove.dataset.action = "chat-delete";
    remove.dataset.chatMessageId = String(message.id);
    remove.textContent = "Delete message";
    remove.setAttribute(
      "aria-label",
      `Delete chat message ${message.id}`,
    );

    row.append(remove);
    list.append(row);
  }

  return list;
}

export {
  createChatLog,
  createDmLog,
};
