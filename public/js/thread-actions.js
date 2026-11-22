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
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// Thread page declutter (v5.55, ORGANIZE #1; map in docs/ia-map.md): the root
// card keeps Like, Dislike, Share and one "More" button; every other control
// moves, unchanged, into More's groups (Reading, Following, Sharing, This
// post) and a nested Staff menu. Controls keep their data-action, so the
// page's one click handler still reaches them. Page view only: nothing is
// stored or fetched here. Menus are disclosure buttons (aria-expanded +
// aria-controls); Escape closes the innermost open one and returns focus.
import { t } from "./i18n.js";

export const PRIMARY_ACTION_LIMIT = 4;
export const MORE_GROUPS = Object.freeze(["reading", "following", "sharing", "post"]);

const GROUP_LABEL_KEYS = Object.freeze({
  reading: "threadActions.reading",
  following: "threadActions.following",
  sharing: "threadActions.sharing",
  post: "threadActions.thisPost",
});
const CHIP_CLASSES = Object.freeze(["view-count", "reply-count"]);
const READING_CLASSES = Object.freeze(["read-aloud", "reveal-spoilers", "save-thread-text"]);
const FOLLOWING_CLASSES = Object.freeze(["subscribe-toggle", "thread-mute-toggle", "bookmark-toggle"]);
const STAFF_ACTIONS = Object.freeze(new Set([
  "thread-pin", "thread-unpin", "thread-lock", "thread-unlock", "staff-pick", "staff-unpick", "suggestion-status",
]));

// Paired toggles: after Pin the same slot reads Unpin (L5 focus follows it).
const PAIRED_ACTIONS = Object.freeze({
  "thread-pin": "thread-unpin", "thread-unpin": "thread-pin",
  "thread-lock": "thread-unlock", "thread-unlock": "thread-lock",
  "staff-pick": "staff-unpick", "staff-unpick": "staff-pick",
});
const LINK_BASE = "https://wempos-forum.invalid";

const hasClass = (node, names) => String(node.className ?? "").split(/\s+/).some((name) => names.includes(name));

// "chip" | "primary" | a MORE_GROUPS name | "staff"
function slotOf(node) {
  if (hasClass(node, CHIP_CLASSES)) return "chip";
  const action = node.dataset?.action;
  if (action === "reaction") return "primary";
  if (STAFF_ACTIONS.has(action)) return "staff";
  if (hasClass(node, READING_CLASSES)) return "reading";
  if (hasClass(node, FOLLOWING_CLASSES)) return "following";
  if (hasClass(node, ["copy-link-wrap"]) || node.tagName === "A") return "sharing";
  return "post";
}

const actionRowOf = (card) => Array.from(card?.children ?? []).find((node) => hasClass(node, ["post-actions"])) ?? null;

function setOpen(toggle, panel, open) {
  toggle.setAttribute("aria-expanded", String(open));
  panel.hidden = !open;
}

// A disclosure: a real button that shows/hides the panel it controls.
export function createDisclosure(document, { kind, id, label, content = [] }) {
  const wrap = document.createElement("div");
  wrap.className = `thread-${kind}`;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = `button button-quiet thread-${kind}-toggle`;
  toggle.textContent = label;
  toggle.setAttribute("aria-controls", id);
  const panel = document.createElement("div");
  panel.className = `thread-${kind}-panel`;
  panel.id = id;
  panel.append(...content);
  setOpen(toggle, panel, false);
  toggle.addEventListener("click", () => setOpen(toggle, panel, toggle.getAttribute("aria-expanded") !== "true"));
  wrap.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || toggle.getAttribute("aria-expanded") !== "true") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(toggle, panel, false);
    toggle.focus();
  });
  wrap.append(toggle, panel);
  return wrap;
}

function createGroup(document, postId, name, items) {
  const group = document.createElement("div");
  group.className = "thread-more-group";
  group.dataset.group = name;
  group.setAttribute("role", "group");
  const heading = document.createElement("span");
  heading.className = "thread-more-group-label";
  heading.id = `thread-more-${postId}-${name}`;
  heading.textContent = t(GROUP_LABEL_KEYS[name]);
  group.setAttribute("aria-labelledby", heading.id);
  group.append(heading, ...items);
  return group;
}

// Tags and the TL;DR join the card's header area, just above the action row.
export function placeInThreadHeader(card, node) {
  if (!node) return;
  const row = actionRowOf(card);
  if (row) card.insertBefore(node, row);
  else card.append(node);
}

const linkPath = (node) => {
  try {
    return new URL(node.getAttribute?.("href") || node.href || "", LINK_BASE).pathname;
  } catch {
    return "";
  }
};

// v5.58 (ia-map §5.1-5.2): two entries the thread page shows twice. The
// card's Copy link goes when Share's own menu already offers one (the
// capability stays, in Share); the Open post link goes when it points at the
// page it sits on. Elsewhere (feed cards) both stay.
function isDuplicateEntry(node, { share, shareHasCopyLink, currentPath }) {
  if (hasClass(node, ["copy-link-wrap"])) return Boolean(share) && shareHasCopyLink === true;
  return node.tagName === "A" && Boolean(currentPath) && linkPath(node) === currentPath;
}

// organizeThreadActions(document, card, { postId, share, tagEditor, staffForms,
// currentPath, shareHasCopyLink }) regroups the root card's action row in
// place. `share` (the Share wrapper or null) joins the primary row;
// `tagEditor` (author/staff) sits collapsed under This post; `staffForms`
// (staff only, e.g. slow mode) join the Staff menu; `currentPath` and
// `shareHasCopyLink` drop the duplicate entries (isDuplicateEntry).
export function organizeThreadActions(document, card, {
  postId, share = null, tagEditor = null, staffForms = [], currentPath = null, shareHasCopyLink = false,
} = {}) {
  const row = actionRowOf(card);
  if (!row) return;
  const slots = { chip: [], primary: [], staff: [], reading: [], following: [], sharing: [], post: [] };
  for (const node of Array.from(row.children)) {
    if (!isDuplicateEntry(node, { share, shareHasCopyLink, currentPath })) slots[slotOf(node)].push(node);
  }
  if (tagEditor) {
    slots.post.push(createDisclosure(document, {
      kind: "tags", id: `thread-tags-${postId}`, label: t("threadActions.editTags"), content: [tagEditor],
    }));
  }
  const staffItems = [...slots.staff, ...staffForms.filter(Boolean)];
  const groups = MORE_GROUPS
    .filter((name) => slots[name].length)
    .map((name) => createGroup(document, postId, name, slots[name]));
  if (staffItems.length) {
    groups.push(createDisclosure(document, {
      kind: "staff", id: `thread-staff-${postId}`, label: t("threadActions.staff"), content: staffItems,
    }));
  }
  const primary = [...slots.primary, ...(share ? [share] : [])];
  const more = groups.length
    ? [createDisclosure(document, {
      kind: "more", id: `thread-more-${postId}`, label: t("threadActions.more"), content: groups,
    })]
    : [];
  row.replaceChildren(...primary.slice(0, 2), ...slots.chip, ...primary.slice(2), ...more);
}

// L5 (v5.57 review): an action inside More re-renders the whole route, which
// rebuilds the card with More closed and drops focus. The page's click
// handler takes a snapshot before the action and restores after it: More
// (and Staff, if the control sat there) reopens and focus returns to the
// same control, its paired toggle (Pin -> Unpin), or else the More button.
// A control outside More, or an action that did not re-render (a dialog
// opened), is left alone. Page view only: nothing stored or fetched.
export function captureMoreFocus(control) {
  const panel = control?.closest?.(".thread-more-panel");
  if (!panel?.id) return null;
  return {
    panel,
    moreId: panel.id,
    staffId: control.closest(".thread-staff-panel")?.id ?? null,
    action: control.dataset?.action ?? null,
    postId: control.dataset?.postId ?? null,
    status: control.dataset?.status ?? null,
  };
}

const toggleFor = (panel) => Array.from(panel.parentNode?.children ?? [])
  .find((node) => node.tagName === "BUTTON" && node.getAttribute("aria-controls") === panel.id) ?? null;

function reopen(panel) {
  const toggle = toggleFor(panel);
  if (toggle) setOpen(toggle, panel, true);
  return toggle;
}

function findControl(panel, snapshot) {
  const buttons = Array.from(panel.querySelectorAll("button"))
    .filter((node) => (node.dataset?.postId ?? null) === snapshot.postId);
  const same = (action) => buttons.find((node) => node.dataset?.action === action
    && (node.dataset?.status ?? null) === snapshot.status);
  return (snapshot.action && same(snapshot.action)) || (PAIRED_ACTIONS[snapshot.action] && same(PAIRED_ACTIONS[snapshot.action])) || null;
}

export function restoreMoreFocus(doc, snapshot) {
  if (!snapshot) return;
  const panel = doc?.getElementById?.(snapshot.moreId);
  // Same panel: the page did not re-render, so focus never left.
  if (!panel || panel === snapshot.panel) return;
  const moreToggle = reopen(panel);
  if (snapshot.staffId) {
    const staff = Array.from(panel.querySelectorAll("div")).find((node) => node.id === snapshot.staffId);
    if (staff) reopen(staff);
  }
  (findControl(panel, snapshot) ?? moreToggle)?.focus?.();
}
