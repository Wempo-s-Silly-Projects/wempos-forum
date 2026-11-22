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

// Share button (v5.34.0) on a thread's root card. The device share sheet
// (navigator.share) when the browser has one; otherwise a small menu: Copy
// link, X, Bluesky, Reddit, and Mastodon on a server the member types in.
// Every target is a plain intent URL on a fixed https host carrying only the
// canonical thread URL and a spoiler-masked title — no SDK, no pixel, and
// this module sends nothing itself. The Mastodon server is remembered in
// this browser (MASTODON_STORAGE_KEY) and wiped on sign-out (clearAllShare).
//
// Visibility: only a public ROOT thread gets a button, and never for a staff
// viewer — staff can open hidden or banned-author threads that the public
// cannot, and a share link to those must not be one click away.
import { t } from "./i18n.js";
import { maskSpoilers, maskedExcerpt } from "./markdown.js";
import { postPermalink } from "./copy-link.js";

export const MASTODON_STORAGE_KEY = "forum-share-mastodon";
const TITLE_MAX = 100;
const HOST_MAX = 253;
const STATUS_MS = 2000;
const STAFF_ROLES = ["owner", "admin"];
// A bare DNS host (at least one dot, labels 1-63 chars, no leading/trailing
// hyphen) with an optional port. No scheme, path, query, fragment or "@".
const HOST_PATTERN = /^(?=.{4,253}(?::\d{1,5})?$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?$/;

const browserStorage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

// normalizeMastodonHost(raw) -> "host[:port]" lowercased, or "" when it is
// not a bare host. A leading https:// and trailing slashes are forgiven.
export function normalizeMastodonHost(raw) {
  if (typeof raw !== "string") return "";
  const host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!host || host.length > HOST_MAX) return "";
  return HOST_PATTERN.test(host) ? host : "";
}

// shareTitle(body) -> the first non-empty line, spoilers masked before the cut.
export function shareTitle(body) {
  const line = maskSpoilers(String(body ?? "")).split("\n").map((part) => part.trim()).find(Boolean) || "";
  return maskedExcerpt(line, TITLE_MAX);
}

// withParams(base, params) -> base.href with each value set through
// URL.searchParams, so every byte of the title and URL is percent-encoded.
const withParams = (base, params) => {
  const u = new URL(base.href);
  for (const [key, value] of Object.entries(params)) u.searchParams.set(key, value);
  return u.href;
};

// mastodonShareUrl(raw) -> a URL for https://<host>/share, or null. The host
// must first pass normalizeMastodonHost, then the URL parser must agree it is
// that exact host on https: anything it rewrote (a port out of range or with
// a leading zero, an IDN or escape) is refused, never "fixed"; port 0 too.
function mastodonShareUrl(raw) {
  const host = normalizeMastodonHost(raw);
  if (!host) return null;
  let u;
  try {
    u = new URL("https://" + host + "/share");
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.host !== host || u.pathname !== "/share" || u.port === "0") return null;
  return u;
}

// shareTargets(url, title, mastodonHost) -> [{ service, href }].
export function shareTargets(url, title, mastodonHost) {
  const text = title ? title + " " + url : url;
  const targets = [
    { service: "X", href: withParams(new URL("https://x.com/intent/tweet"), { text: title, url }) },
    { service: "Bluesky", href: withParams(new URL("https://bsky.app/intent/compose"), { text }) }, // i18n-ignore: brand name
    { service: "Reddit", href: withParams(new URL("https://www.reddit.com/submit"), { url, title }) }, // i18n-ignore: brand name
  ];
  const mastodon = mastodonShareUrl(mastodonHost);
  if (!mastodon) return targets;
  return [...targets, { service: "Mastodon", href: withParams(mastodon, { text }) }]; // i18n-ignore: brand name
}

// canShare(post, viewer) -> true only for a public root thread and a
// non-staff viewer.
export function canShare(post, viewer) {
  if (!post || post.visibility !== "public") return false;
  if (post.parent || Number(post.publicLevel) > 0) return false;
  return !(viewer && STAFF_ROLES.includes(viewer.role));
}

function readHost(storage) {
  try {
    return normalizeMastodonHost(storage?.getItem(MASTODON_STORAGE_KEY) ?? "");
  } catch {
    return "";
  }
}

// Sign-out wipe: the remembered Mastodon server goes, other keys stay.
export function clearAllShare(storage = browserStorage()) {
  try {
    storage?.removeItem(MASTODON_STORAGE_KEY);
  } catch {
    // Blocked storage: nothing was stored to wipe.
  }
}

const node = (document, tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

// intentLink(document, target) -> an <a>, or null when the href does not
// parse as https. The href written is the parser's own serialization.
function intentLink(document, target) {
  let u;
  try {
    u = new URL(target.href);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const link = node(document, "a", "share-link", t("share.on", { service: target.service }));
  link.href = u.href;
  link.setAttribute("href", u.href); // same value; keeps the attribute explicit for non-reflecting DOMs
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer"); // i18n-ignore: link relation tokens
  return link;
}

function copyItem(document, url, clipboard, schedule) {
  const item = node(document, "button", "button button-quiet share-copy", t("render.copyLink"));
  item.type = "button";
  const status = node(document, "span", "share-status");
  status.setAttribute("role", "status");
  item.addEventListener("click", async (event) => {
    event.preventDefault();
    let copied = false;
    try {
      if (clipboard && typeof clipboard.writeText === "function") {
        await clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }
    status.textContent = copied ? t("render.linkCopied") : t("render.copyLinkFailed");
    schedule(() => { status.textContent = ""; }, STATUS_MS);
  });
  return [item, status];
}

function mastodonForm(document, storage, onSaved) {
  const form = node(document, "form", "share-mastodon");
  const label = node(document, "label", "share-mastodon-label", t("share.mastodonInstance"));
  const input = node(document, "input", "share-mastodon-input");
  input.type = "text";
  input.id = "share-mastodon-host";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("inputmode", "url");
  input.setAttribute("maxlength", String(HOST_MAX));
  input.value = readHost(storage);
  label.setAttribute("for", input.id);
  const save = node(document, "button", "button button-secondary", t("share.mastodonSave"));
  save.type = "submit";
  const error = node(document, "p", "share-mastodon-error");
  error.setAttribute("role", "status");
  form.append(label, input, save, error);
  form.addEventListener("submit", (event) => {
    event?.preventDefault?.();
    const host = mastodonShareUrl(input.value) ? normalizeMastodonHost(input.value) : "";
    if (!host) {
      error.textContent = t("share.mastodonInvalid");
      return;
    }
    error.textContent = "";
    input.value = host;
    try {
      storage?.setItem(MASTODON_STORAGE_KEY, host);
    } catch {
      // Blocked storage: the link still works for this page view.
    }
    onSaved(host);
  });
  return form;
}

function fillMenu(document, menu, url, title, host, deps) {
  const links = node(document, "div", "share-links");
  const items = shareTargets(url, title, host).map((target) => intentLink(document, target)).filter(Boolean);
  links.append(...items);
  const form = mastodonForm(document, deps.storage, (saved) => fillMenu(document, menu, url, title, saved, deps));
  menu.replaceChildren(...copyItem(document, url, deps.clipboard, deps.schedule), links, form);
}

// createShareButton(document, post, viewer, deps) -> a wrapper with the
// Share button and its (closed) fallback menu, or null when the thread may
// not be shared.
export function createShareButton(document, post, viewer, {
  origin = globalThis.location?.origin ?? "",
  navigator = globalThis.navigator ?? {},
  storage = browserStorage(),
  clipboard = globalThis.navigator?.clipboard ?? null,
  schedule = setTimeout,
} = {}) {
  if (!canShare(post, viewer)) return null;
  const url = postPermalink(origin, post.id);
  if (!url) return null;
  const title = shareTitle(post.body);
  const wrap = node(document, "div", "share-wrap");
  const button = node(document, "button", "button button-secondary share-button", t("share.button"));
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  const menu = node(document, "div", "share-menu");
  menu.id = "share-menu-" + post.id;
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", t("share.menuLabel"));
  menu.hidden = true;
  button.setAttribute("aria-controls", menu.id);
  fillMenu(document, menu, url, title, readHost(storage), { storage, clipboard, schedule });
  button.addEventListener("click", async (event) => {
    event?.preventDefault?.();
    if (navigator && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // The member closed the sheet: nothing to do. Any other failure
        // falls through to the menu so sharing still works.
        if (error?.name === "AbortError") return;
      }
    }
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
  });
  wrap.append(button, menu);
  return wrap;
}
