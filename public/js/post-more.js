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

// Per-post "More" (⋯) menu (v5.95, owner plan items 1 and 6): feed cards and
// replies keep Like, Reply and Quote in sight; copy link, read aloud, quote
// card, bookmark, subscribe, mute, report, edit and delete move, unchanged,
// into one WAI-ARIA menu button. Controls keep their data-action, so the
// page's one click handler still reaches them. The thread page's root card
// keeps its grouped More (thread-actions.js) instead. Page view only: nothing
// is stored or fetched here.
import { t } from "./i18n.js";
import { vendorIcon } from "./icons.js";

export const MOVED_ACTION_LABEL = "threadActions.more";
const MOVED_CLASSES = Object.freeze(["copy-link-wrap", "read-aloud", "quote-card-action", "bookmark-toggle",
  "subscribe-toggle", "thread-mute-toggle"]);
const MOVED_ACTIONS = Object.freeze(new Set(["report", "edit-post", "delete-post"]));
// Toggles become menuitemcheckbox; inside role=menu their state is
// aria-checked alone (v5.96.0: aria-pressed is not valid on menu items).
const CHECKBOX_CLASSES = Object.freeze(["bookmark-toggle", "subscribe-toggle", "thread-mute-toggle", "read-aloud"]);
// Worded controls get an icon so every row of the menu reads the same way.
const ADDED_ICONS = Object.freeze({ "quote-card-action": "message-square-quote", "thread-mute-toggle": "bell-off" });

let menuSerial = 0;
let openMenu = null;

const classesOf = (node) => String(node?.className ?? "").split(/\s+/);
const hasClass = (node, names) => classesOf(node).some((name) => names.includes(name));
const isMoved = (node) => hasClass(node, MOVED_CLASSES) || MOVED_ACTIONS.has(node.dataset?.action);
const buttonOf = (node) => (node.tagName === "BUTTON" ? node : node.querySelector("button"));
const actionRowOf = (card) => Array.from(card?.children ?? []).find((node) => hasClass(node, ["post-actions"])) ?? null;
const menuItems = (menu) => Array.from(menu.querySelectorAll("button"))
  .filter((node) => String(node.getAttribute("role") ?? "").startsWith("menuitem") && !node.disabled);

function itemFrom(event) {
  let node = event.target;
  while (node && node.getAttribute) {
    if (String(node.getAttribute("role") ?? "").startsWith("menuitem")) return node;
    node = node.parentNode;
  }
  return null;
}

// One menu row: the control itself (or its wrapper with role="none"); a
// wrapper's live status leaves the menu so it is still announced once the
// menu closes.
function addItem(document, wrap, menu, node) {
  const button = buttonOf(node);
  if (!button) return;
  if (node !== button) {
    node.setAttribute("role", "none");
    for (const status of Array.from(node.children).filter((child) => child.getAttribute("role") === "status")) {
      wrap.append(status);
    }
  }
  const checkbox = hasClass(node, CHECKBOX_CLASSES);
  button.setAttribute("role", checkbox ? "menuitemcheckbox" : "menuitem");
  if (checkbox) {
    button.setAttribute("aria-checked", String(button.getAttribute("aria-pressed") === "true"));
    button.removeAttribute("aria-pressed");
  }
  button.tabIndex = -1;
  const added = Object.entries(ADDED_ICONS).find(([name]) => hasClass(node, [name]));
  if (added) button.replaceChildren(vendorIcon(document, added[1]), document.createTextNode(button.textContent));
  menu.append(node);
}

function createMenuButton(document) {
  menuSerial += 1;
  const id = "post-more-" + menuSerial;
  const wrap = document.createElement("div");
  wrap.className = "post-more";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "button button-quiet icon-button post-more-toggle";
  toggle.id = id + "-toggle";
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", id);
  toggle.setAttribute("aria-label", t(MOVED_ACTION_LABEL));
  toggle.title = t(MOVED_ACTION_LABEL);
  toggle.append(vendorIcon(document, "ellipsis"));
  const menu = document.createElement("div");
  menu.className = "post-more-menu";
  menu.id = id;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-labelledby", toggle.id);
  menu.hidden = true;
  wrap.append(toggle, menu);
  wireMenu(document, wrap, toggle, menu);
  return { wrap, menu };
}

function wireMenu(document, wrap, toggle, menu) {
  const isOpen = () => toggle.getAttribute("aria-expanded") === "true";
  const onOutside = (event) => {
    if (!wrap.contains(event.target)) controller.close(false);
  };
  const controller = {
    open(index) {
      if (openMenu && openMenu !== controller) openMenu.close(false);
      openMenu = controller;
      menu.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      document.addEventListener?.("click", onOutside);
      const list = menuItems(menu);
      list.at(index)?.focus();
    },
    close(returnFocus) {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      document.removeEventListener?.("click", onOutside);
      if (openMenu === controller) openMenu = null;
      if (returnFocus) toggle.focus();
    },
  };
  toggle.addEventListener("keydown", (event) => {
    const index = { Enter: 0, " ": 0, ArrowDown: 0, ArrowUp: -1 }[event.key];
    if (index !== undefined) {
      event.preventDefault();
      controller.open(index);
    } else if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      controller.close(true);
    }
  });
  // detail 0 = the click a key press synthesizes after keydown already opened.
  toggle.addEventListener("click", (event) => {
    if (isOpen() && event.detail === 0) return;
    if (isOpen()) controller.close(false);
    else controller.open(0);
  });
  menu.addEventListener("keydown", (event) => roveOrClose(event, menu, controller));
  // Choosing an item closes the menu first; the page's click handler then
  // runs the action, and any dialog it opens hands focus back to More.
  menu.addEventListener("click", (event) => {
    if (itemFrom(event)) controller.close(true);
  });
  wrap.addEventListener("focusout", (event) => {
    if (isOpen() && event.relatedTarget && !wrap.contains(event.relatedTarget)) controller.close(false);
  });
}

function roveOrClose(event, menu, controller) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    controller.close(true);
    return;
  }
  if (event.key === "Tab") {
    controller.close(false);
    return;
  }
  const list = menuItems(menu);
  const index = list.indexOf(itemFrom(event));
  const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }[event.key];
  if (next === undefined || !list.length) return;
  event.preventDefault();
  list[(next + list.length) % list.length].focus();
}

// organizePostActions(document, card) moves the card's secondary controls
// into a ⋯ menu at the end of its action row. Returns the menu wrapper, or
// null when the card has nothing to move.
export function organizePostActions(document, card) {
  const row = actionRowOf(card);
  if (!row) return null;
  const moved = Array.from(row.children).filter(isMoved);
  if (!moved.length) return null;
  const { wrap, menu } = createMenuButton(document);
  for (const node of moved) addItem(document, wrap, menu, node);
  row.append(wrap);
  return wrap;
}
