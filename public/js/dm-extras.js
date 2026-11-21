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

// DM extras (v4.7): the group-DM and DM-image pieces of the chat widget,
// kept out of chat-widget.js so that file stays focused. Builders return
// nodes (createElement/textContent only) and every request rides the one
// api() wrapper. Images render lazily from the members-only
// /api/dm/images/:id route; a message whose whole body is `[img:<uuid>]` is
// an image (only the upload routes can write that shape).
import { api } from "./api.js";
import { t, tn } from "./i18n.js";
import { readEffectsPref, writeEffectsPref } from "./dm-effects.js";
import { buildGroupRename } from "./group-rename.js";

const IMAGE_TOKEN = /^\[img:([0-9a-f-]{36})\]$/;
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const GROUP_TITLE_MAX_NAMES = 3;

const el = (tagName, className, text) => {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const safeStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const conversationBase = (conversation) => (conversation?.kind === "group"
  ? `/api/dm/groups/${encodeURIComponent(conversation.id)}`
  : `/api/dm/threads/${encodeURIComponent(conversation.id)}`);

export const imageIdOf = (body) => {
  const match = typeof body === "string" ? body.trim().match(IMAGE_TOKEN) : null;
  return match ? match[1] : null;
};

// A group's label: its name, else the first few member names (the viewer
// left out when known).
export const groupTitle = (group, viewerId) => {
  if (typeof group?.name === "string" && group.name.trim()) return group.name.trim();
  const names = (Array.isArray(group?.members) ? group.members : [])
    .filter((member) => Number(member.id) !== Number(viewerId))
    .map((member) => member.username);
  const shown = names.slice(0, GROUP_TITLE_MAX_NAMES).join(", ");
  return names.length > GROUP_TITLE_MAX_NAMES ? `${shown}, +${names.length - GROUP_TITLE_MAX_NAMES}` : shown;
};

// Fills a message body node with the lazy image; a failed load (removed,
// revoked, blocked) falls back to one quiet line.
export const fillImageBody = (node, imageId, authorName) => {
  node.classList.add("chat-dm-image-body");
  const img = el("img", "chat-dm-image");
  img.src = "/api/dm/images/" + encodeURIComponent(imageId);
  img.alt = t("dm.imageFrom", { name: authorName || "" });
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", () => {
    node.classList.remove("chat-dm-image-body");
    node.replaceChildren(el("span", "chat-dm-image-missing", t("dm.imageUnavailable")));
  }, { once: true });
  node.append(img);
  return node;
};

// The image button: a hidden file input behind a real button; a pick hands
// the File to onFile and resets the input so the same file can go again.
export const buildImageButton = (onFile) => {
  const wrap = el("span", "chat-widget-image-wrap");
  const input = el("input", "chat-widget-image-input");
  input.type = "file";
  input.accept = IMAGE_ACCEPT;
  input.hidden = true;
  const button = el("button", "chat-widget-image-button");
  button.type = "button";
  button.setAttribute("aria-label", t("dm.sendImage"));
  button.title = t("dm.sendImage");
  button.append(el("span", "", "🖼"));
  button.firstChild.setAttribute("aria-hidden", "true");
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (file) onFile(file);
  });
  wrap.append(input, button);
  return wrap;
};

export const uploadDmImage = (conversation, file) => {
  const form = new FormData();
  form.append("image", file);
  return api(`${conversationBase(conversation)}/images`, { method: "POST", body: form });
};

// The New-group strip: a native <details> holding the usernames list and the
// optional name. onCreated receives the new group's id.
export const buildNewGroupForm = (onCreated, onError) => {
  const details = el("details", "chat-widget-new-group");
  details.append(el("summary", "chat-widget-new-group-summary", t("dm.newGroup")));
  const form = el("form", "chat-widget-new-group-form");
  const members = el("input", "chat-widget-new-group-members");
  members.type = "text";
  members.required = true;
  members.autocomplete = "off";
  members.placeholder = t("dm.groupMembers");
  members.setAttribute("aria-label", t("dm.groupMembers"));
  const name = el("input", "chat-widget-new-group-name");
  name.type = "text";
  name.maxLength = 60;
  name.placeholder = t("dm.groupName");
  name.setAttribute("aria-label", t("dm.groupName"));
  const submit = el("button", "button button-primary chat-widget-new-group-send", t("dm.createGroup"));
  submit.type = "submit";
  form.append(members, name, submit);
  let inFlight = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const usernames = members.value.split(",").map((value) => value.trim().replace(/^@/, "")).filter(Boolean);
    if (inFlight || usernames.length === 0) return;
    inFlight = true;
    submit.disabled = true;
    try {
      const data = await api("/api/dm/groups", { method: "POST", body: { usernames, name: name.value } });
      members.value = "";
      name.value = "";
      details.open = false;
      await onCreated(data.id);
    } catch (error) {
      onError(error?.message || t("dm.groupFailed"));
    } finally {
      inFlight = false;
      submit.disabled = false;
    }
  });
  details.append(form);
  return details;
};

// The group strip above the messages: member count + names, the creator's
// add/remove controls, and Leave for everyone. onChange re-reads the group;
// onLeft returns to the list.
export const buildGroupManage = (group, { viewerId, onChange, onLeft, onError }) => {
  const base = conversationBase({ kind: "group", id: group.id });
  const strip = el("details", "chat-widget-group-manage");
  const members = Array.isArray(group.members) ? group.members : [];
  strip.append(el("summary", "chat-widget-group-count", tn("dm.membersCount", members.length)));
  const list = el("ul", "chat-widget-group-members");
  const run = async (action) => {
    try {
      await action();
    } catch (error) {
      onError(error?.message || t("dm.manageFailed"));
    }
  };
  for (const member of members) {
    const item = el("li", "chat-widget-group-member", member.username);
    if (group.canManage && Number(member.id) !== Number(viewerId)) {
      const remove = el("button", "chat-widget-group-remove", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", t("dm.removeMember", { name: member.username }));
      remove.addEventListener("click", () => run(async () => {
        await api(`${base}/members/${encodeURIComponent(member.id)}`, { method: "DELETE" });
        await onChange();
      }));
      item.append(remove);
    }
    list.append(item);
  }
  strip.append(list);
  if (group.canManage) {
    // v4.31: the creator renames (PATCH; "" clears back to the member names).
    strip.append(buildGroupRename(document, group, {
      onSave: (name) => run(async () => {
        await api(base, { method: "PATCH", body: { name } });
        await onChange();
      }),
    }));
    const add = el("form", "chat-widget-group-add");
    const input = el("input", "chat-widget-group-add-input");
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = t("dm.addMemberPlaceholder");
    input.setAttribute("aria-label", t("dm.addMember"));
    const submit = el("button", "button chat-widget-group-add-send", t("dm.addMember"));
    submit.type = "submit";
    add.append(input, submit);
    add.addEventListener("submit", (event) => {
      event.preventDefault();
      const username = input.value.trim().replace(/^@/, "");
      if (!username) return;
      run(async () => {
        await api(`${base}/members`, { method: "POST", body: { username } });
        input.value = "";
        await onChange();
      });
    });
    strip.append(add);
  }
  const leave = el("button", "button chat-widget-group-leave", t("dm.leaveGroup"));
  leave.type = "button";
  leave.addEventListener("click", () => {
    if (!window.confirm(t("dm.leaveConfirm"))) return;
    run(async () => {
      await api(`${base}/leave`, { method: "POST" });
      await onLeft();
    });
  });
  strip.append(leave);
  return strip;
};

// The opt-in Message effects switch (off by default, this device only).
export const effectsEnabled = () => readEffectsPref(safeStorage());

export const buildEffectsToggle = (onToggle) => {
  const label = el("label", "chat-widget-effects");
  label.title = t("dm.effectsHint");
  const box = el("input", "chat-widget-effects-box");
  box.type = "checkbox";
  box.checked = effectsEnabled();
  box.addEventListener("change", () => {
    writeEffectsPref(safeStorage(), box.checked);
    onToggle(box.checked);
  });
  label.append(box, el("span", "", t("dm.effects")));
  return label;
};
