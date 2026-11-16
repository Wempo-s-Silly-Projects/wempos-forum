// v4.0 plan 5 (spec step 6), task 1: the moderation desk's chat + DM logs section
// builders — bodies moved verbatim out of ../admin.js (now dissolved).
import { addText } from "../forms.js";

// DM log (v3.1): the desk's full 1:1 stream — newest first, both participants
// named per message ("A ↔ B"), banned authors marked. Same review-and-delete
// posture as the chat log (the owner's call: DMs get the same scrutiny as
// posts). DM ids share the data-dm-message-id namespace with the panel.
function createDmLog(messages, document) {
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
function createChatLog(messages, document) {
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


export {
  createChatLog,
  createDmLog,
};
