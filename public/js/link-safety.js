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

// Lookalike links (batch L item 2): an external link whose host is an IDN
// homograph — letters from scripts that should not mix in one label, a
// label made only of Cyrillic/Greek letters that look Latin, or Latin
// letters that imitate plain ASCII — opens a warning first. The warning
// shows the real (punycode) host and, from the vendored tldts public-suffix
// list, the registered domain. Honest single-script names (münchen.de,
// пример.рф, 中国.cn) pass straight through. Nothing leaves the browser.
import { t } from "./i18n.js";
import { toUnicode } from "./vendor/punycode/punycode.es6.js";

const TLDTS_SRC = "./vendor/tldts/index.esm.min.js";

const SCRIPTS = Object.freeze([
  "Latin", "Cyrillic", "Greek", "Armenian", "Georgian", "Hebrew", "Arabic", "Thai", "Lao", "Khmer", // i18n-ignore
  "Devanagari", "Bengali", "Tamil", "Telugu", "Gujarati", "Gurmukhi", "Kannada", "Malayalam", "Sinhala", // i18n-ignore
  "Ethiopic", "Cherokee", "Han", "Hiragana", "Katakana", "Hangul", "Bopomofo", "Tibetan", "Myanmar", // i18n-ignore
].map((name) => [name, new RegExp(`\\p{Script=${name}}`, "u")])); // i18n-ignore

// Script sets that legitimately share one label (CJK writing systems, with
// or without Latin); anything else mixing two scripts is suspicious.
const ALLOWED_MIXES = Object.freeze([
  ["Latin", "Han", "Hiragana", "Katakana"], // i18n-ignore
  ["Latin", "Han", "Hangul"], // i18n-ignore
  ["Latin", "Han", "Bopomofo"], // i18n-ignore
].map((set) => new Set(set)));

// Cyrillic and Greek letters that render like Latin ones: a label made only
// of these (with digits and hyphens) is a whole-script lookalike.
const LATIN_LOOKALIKES = new Set(Array.from(
  "аеорсухіјѕԁԛԝӏһүɡѵԍοαικνρτυχϲϳ",
));
// Latin letters beyond ASCII that imitate plain ASCII ones.
const LATIN_IMPOSTORS = new Set(Array.from("ɑɡıȷɩʟɪᴀᴄᴅᴇᴊᴋᴍᴏᴘᴛᴜᴠᴡᴢʀʏſƖǀꞵ"));

const LETTER = /\p{L}/u;

function scriptOf(character) {
  for (const [name, pattern] of SCRIPTS) if (pattern.test(character)) return name;
  return LETTER.test(character) ? "Other" : null; // i18n-ignore
}

function labelVerdict(label) {
  const letters = Array.from(label).filter((character) => LETTER.test(character));
  if (!letters.length) return null;
  const scripts = new Set(letters.map(scriptOf));
  if (scripts.size > 1 && !ALLOWED_MIXES.some((allowed) => [...scripts].every((name) => allowed.has(name)))) {
    return "mixed-script";
  }
  if ((scripts.has("Cyrillic") || scripts.has("Greek")) && letters.every((character) => LATIN_LOOKALIKES.has(character))) { // i18n-ignore
    return "whole-script-lookalike";
  }
  if (scripts.has("Latin") && letters.some((character) => LATIN_IMPOSTORS.has(character))) return "latin-lookalike"; // i18n-ignore
  return null;
}

// { ascii, unicode, suspicious, reasons } for one hostname (as the URL
// parser gives it: lowercase, punycode).
export function analyzeHost(host) {
  const ascii = String(host ?? "").toLowerCase();
  let unicode = ascii;
  try {
    unicode = toUnicode(ascii);
  } catch {
    return { ascii, unicode, suspicious: true, reasons: ["malformed"] };
  }
  const reasons = unicode.split(".").map(labelVerdict).filter(Boolean);
  return { ascii, unicode, suspicious: reasons.length > 0, reasons };
}

// The registered domain (eTLD+1) from the vendored tldts list, loaded only
// when a warning is actually shown.
export async function registrableDomain(host) {
  try {
    const { getDomain } = await import(TLDTS_SRC);
    return getDomain(String(host ?? "")) || "";
  } catch {
    return "";
  }
}

const defaultOpen = (href) => {
  globalThis.open?.(href, "_blank", "noopener,noreferrer");
};

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The interstitial for one link. Go back (focused first) and Escape close
// it; Continue opens the original href in a new tab without an opener.
export function createLinkWarning(document, href, analysis, { open = defaultOpen, onClose = () => {} } = {}) {
  const warning = element(document, "div", "link-warning");
  warning.setAttribute("role", "alertdialog");
  warning.setAttribute("aria-modal", "true");
  warning.setAttribute("aria-labelledby", "link-warning-title");
  const title = element(document, "h2", "link-warning-title", t("safety.linkWarningTitle"));
  title.id = "link-warning-title";
  const body = element(document, "p", "link-warning-body", t("safety.linkWarningBody"));
  const host = element(document, "p", "link-warning-host");
  host.append(element(document, "code", "link-warning-ascii", analysis.ascii));
  const domain = element(document, "p", "link-warning-domain muted");
  const close = () => {
    warning.remove();
    onClose();
  };
  const back = element(document, "button", "link-warning-back", t("safety.linkWarningBack"));
  back.type = "button";
  back.addEventListener("click", close);
  const proceed = element(document, "button", "link-warning-continue danger", t("safety.linkWarningContinue"));
  proceed.type = "button";
  proceed.addEventListener("click", () => {
    close();
    open(href);
  });
  warning.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  const actions = element(document, "div", "link-warning-actions");
  actions.append(back, proceed);
  warning.append(title, body, host, domain, actions);
  registrableDomain(analysis.ascii).then((registered) => {
    if (registered) domain.textContent = t("safety.linkWarningDomain", { domain: registered });
  });
  return warning;
}

function externalHref(anchor, currentHost) {
  const raw = anchor?.getAttribute?.("href") ?? "";
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.host === currentHost ? null : url;
  } catch {
    return null;
  }
}

// Click/auxclick handler body: true (and the default prevented) when the
// link was held back for the warning.
export function interceptSuspiciousLink(event, document, options = {}) {
  const currentHost = options.currentHost ?? globalThis.location?.host ?? "";
  const anchor = event?.target?.closest?.("a[href]");
  const url = externalHref(anchor, currentHost);
  if (!url) return false;
  const analysis = analyzeHost(url.hostname);
  if (!analysis.suspicious) return false;
  event.preventDefault();
  event.stopPropagation?.();
  const warning = createLinkWarning(document, url.href, analysis, {
    open: options.open,
    onClose: () => anchor.focus?.(),
  });
  document.body?.append(warning);
  warning.querySelector?.(".link-warning-back")?.focus?.();
  return true;
}

const guarded = new WeakSet();

// One capturing listener per document for plain and middle clicks.
export function installLinkGuard(document) {
  if (!document || typeof document.addEventListener !== "function" || guarded.has(document)) return;
  guarded.add(document);
  const handler = (event) => {
    if (event.type === "auxclick" && event.button !== 1) return;
    interceptSuspiciousLink(event, document);
  };
  document.addEventListener("click", handler, true);
  document.addEventListener("auxclick", handler, true);
}
