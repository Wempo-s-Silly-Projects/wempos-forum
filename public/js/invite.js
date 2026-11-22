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

// Invite links (v5.34.0). A member's own link is /join?ref=<username>
// (settings: "Invite a friend"). A visitor who opens it keeps the ref in
// THIS TAB only (sessionStorage, INVITE_REF_KEY) while they sign up at
// Wempo Accounts; back on the forum, signed in, the client claims it once
// (POST /api/me/invite) and forgets it whatever the answer. The server
// decides whether the claim counts (api/invites.mjs). The key is also wiped
// on sign-out (clearAllInvite).
import { t } from "./i18n.js";

export const INVITE_REF_KEY = "forum-invite-ref";
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;
const STATUS_MS = 2000;

const tabStorage = () => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

const validRef = (value) => (typeof value === "string" && USERNAME_PATTERN.test(value) ? value : "");

// inviteRefFromSearch(search) -> the ?ref= username, or "" when malformed.
export function inviteRefFromSearch(search) {
  try {
    return validRef(new URLSearchParams(search ?? "").get("ref") ?? "");
  } catch {
    return "";
  }
}

// inviteLink(origin, username) -> the member's own invite link.
export function inviteLink(origin, username) {
  return String(origin ?? "") + "/join?ref=" + encodeURIComponent(String(username ?? ""));
}

// Stores a valid ref for this tab; an invalid one never overwrites.
export function rememberInviteRef(storage = tabStorage(), ref) {
  const value = validRef(ref);
  if (!value) return;
  try {
    storage?.setItem(INVITE_REF_KEY, value);
  } catch {
    // Blocked storage: the invite just won't be credited.
  }
}

// Sign-out wipe (and the claim's own cleanup).
export function clearAllInvite(storage = tabStorage()) {
  try {
    storage?.removeItem(INVITE_REF_KEY);
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}

function readPendingRef(storage) {
  try {
    return validRef(storage?.getItem(INVITE_REF_KEY) ?? "");
  } catch {
    return "";
  }
}

// claimPendingInvite(api, storage) -> the inviter's username, or null. One
// request at most; the ref is forgotten before the answer comes back.
export async function claimPendingInvite(api, storage = tabStorage()) {
  const ref = readPendingRef(storage);
  clearAllInvite(storage);
  if (!ref) return null;
  try {
    const data = await api("/api/me/invite", { method: "POST", body: { ref } });
    return validRef(data?.inviter) || null;
  } catch {
    return null;
  }
}

const node = (document, tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

// The settings panel: heading, note, the read-only link and a Copy button.
export function createInvitePanel(document, origin, username, {
  clipboard = globalThis.navigator?.clipboard ?? null,
  schedule = setTimeout,
} = {}) {
  const link = inviteLink(origin, username);
  const panel = node(document, "section", "panel invite-panel");
  panel.append(node(document, "h2", "", t("invite.title")), node(document, "p", "muted", t("invite.body")));
  const label = node(document, "label", "invite-label", t("invite.linkLabel"));
  const field = node(document, "input", "invite-link");
  field.type = "text";
  field.id = "invite-link";
  field.value = link;
  field.setAttribute("readonly", "");
  label.setAttribute("for", field.id);
  const copy = node(document, "button", "button button-secondary invite-copy", t("invite.copy"));
  copy.type = "button";
  const status = node(document, "span", "invite-status");
  status.setAttribute("role", "status");
  copy.addEventListener("click", async (event) => {
    event?.preventDefault?.();
    let copied = false;
    try {
      if (clipboard && typeof clipboard.writeText === "function") {
        await clipboard.writeText(link);
        copied = true;
      }
    } catch {
      copied = false;
    }
    status.textContent = copied ? t("render.linkCopied") : t("render.copyLinkFailed");
    schedule(() => { status.textContent = ""; }, STATUS_MS);
  });
  panel.append(label, field, copy, status);
  return panel;
}

// The /join landing for a signed-out visitor: a heading, a line and the
// sign-up button (the Accounts handoff URL comes from the caller).
export function createJoinPage(document, signUpUrl) {
  const section = node(document, "section", "panel join-panel");
  const button = node(document, "a", "button sso-entry-button", t("join.signUp"));
  button.setAttribute("href", signUpUrl);
  section.append(node(document, "h1", "", t("join.title")), node(document, "p", "", t("join.body")), button);
  return section;
}
