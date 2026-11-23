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

// Profile editor (bio up to 10,000 characters + the social inputs) and the
// pure social-link map shared by the profile page renderer in app.js. The
// client-side patterns below are pinned copies of api/shared.mjs
// SOCIAL_PLATFORMS — the server re-validates everything; these only steer the
// editor. All DOM building is textContent-based (no innerHTML).
import { createForm, createInput, createTextarea } from "./forms.js";
import { t, tn } from "./i18n.js";

export const SOCIAL_LABELS = {
  youtube: "YouTube",
  x: "X",
  reddit: "Reddit", // i18n-ignore
  github: "GitHub",
  discord: "Discord", // i18n-ignore
  gitlab: "GitLab",
  instagram: "Instagram", // i18n-ignore
  tiktok: "TikTok",
  twitch: "Twitch", // i18n-ignore
  // v5.65.0: brand names stay untranslated.
  facebook: "Facebook", // i18n-ignore
  tumblr: "Tumblr", // i18n-ignore
  substack: "Substack", // i18n-ignore
  soundcloud: "SoundCloud", // i18n-ignore
  spotify: "Spotify", // i18n-ignore
  linktree: "Linktree", // i18n-ignore
  beacons: "Beacons", // i18n-ignore
  cameo: "Cameo", // i18n-ignore
  shopify: "Shopify", // i18n-ignore
  kickstarter: "Kickstarter", // i18n-ignore
  indiegogo: "Indiegogo", // i18n-ignore
  patreon: "Patreon", // i18n-ignore
  kofi: "Ko-fi", // i18n-ignore
  buymeacoffee: "Buy Me a Coffee", // i18n-ignore
  paypal: "PayPal", // i18n-ignore
  cashapp: "Cash App", // i18n-ignore
  venmo: "Venmo", // i18n-ignore
  polytoria: "Polytoria", // i18n-ignore
};

// Payment-link networks (v5.65.0): links only — the forum never processes or
// relays payments. They sit together in the editor; the note follows them.
export const PAYMENT_SOCIAL_KEYS = ["patreon", "kofi", "buymeacoffee", "paypal", "cashapp", "venmo"];

// Field order for the editor; spec §10 (Polytoria last).
export const SOCIAL_PLATFORM_ORDER = [
  "youtube", "x", "reddit", "github", "discord", "gitlab",
  "instagram", "tiktok", "twitch",
  "facebook", "tumblr", "substack", "soundcloud", "spotify", "linktree",
  "beacons", "cameo", "shopify", "kickstarter", "indiegogo",
  ...PAYMENT_SOCIAL_KEYS,
  "polytoria",
];

// Mirrors api/shared.mjs SOCIAL_PLATFORMS.regex exactly.
export const SOCIAL_PATTERNS = {
  youtube: /^[A-Za-z0-9._-]{1,60}$/,
  x: /^[A-Za-z0-9_]{1,15}$/,
  reddit: /^[A-Za-z0-9_-]{3,20}$/,
  github: /^[A-Za-z0-9-]{1,39}$/,
  discord: /^[A-Za-z0-9._#-]{2,64}$/,
  gitlab: /^[A-Za-z0-9_.]{1,30}$/,
  instagram: /^[A-Za-z0-9_.]{1,30}$/,
  tiktok: /^[A-Za-z0-9_.]{1,24}$/,
  twitch: /^[A-Za-z0-9_]{1,25}$/,
  facebook: /^[A-Za-z0-9.]{5,50}$/,
  tumblr: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,30}[A-Za-z0-9])?$/,
  indiegogo: /^[a-z0-9-]{1,80}$/,
  shopify: /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/,
  substack: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  kickstarter: /^[A-Za-z0-9_-]{1,40}$/,
  cameo: /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,40}$/,
  linktree: /^(?!\.{1,2}$)[A-Za-z0-9_.]{1,30}$/,
  beacons: /^(?!\.{1,2}$)[A-Za-z0-9_.]{1,30}$/,
  soundcloud: /^[a-z0-9_-]{3,25}$/,
  spotify: /^[A-Za-z0-9]{22}$/,
  patreon: /^[A-Za-z0-9_-]{1,64}$/,
  kofi: /^[A-Za-z0-9_]{1,40}$/,
  buymeacoffee: /^[A-Za-z0-9_]{1,50}$/,
  paypal: /^[A-Za-z0-9]{1,20}$/,
  cashapp: /^[A-Za-z][A-Za-z0-9_-]{0,19}$/,
  venmo: /^[A-Za-z0-9_-]{5,30}$/,
  polytoria: /^[A-Za-z0-9_]{1,24}$/,
};

// Mirrors api/pronouns.mjs PRONOUNS_PATTERN (advisory; the server re-checks).
// The pattern attribute anchors itself, and its v-flag mode wants / and -
// escaped inside a class.
export const PRONOUNS_PATTERN_SOURCE = "[A-Za-z][A-Za-z \\/\\-]{0,23}";

// Linked platforms build their profile URL here; Discord and Polytoria stay
// plain text. Every dynamic segment passes through encodeURIComponent, so
// symbol-prefixed (or otherwise unusual) handles can never produce a broken or
// attacker-shaped href.
const SOCIAL_LINK_BASES = {
  youtube: (handle) => `https://www.youtube.com/@${encodeURIComponent(handle)}`,
  x: (handle) => `https://x.com/${encodeURIComponent(handle)}`,
  reddit: (handle) => `https://www.reddit.com/user/${encodeURIComponent(handle)}`,
  github: (handle) => `https://github.com/${encodeURIComponent(handle)}`,
  gitlab: (handle) => `https://gitlab.com/${encodeURIComponent(handle)}`,
  instagram: (handle) => `https://www.instagram.com/${encodeURIComponent(handle)}`,
  tiktok: (handle) => `https://www.tiktok.com/@${encodeURIComponent(handle)}`,
  twitch: (handle) => `https://www.twitch.tv/${encodeURIComponent(handle)}`,
  polytoria: (handle) => `https://polytoria.com/u/${encodeURIComponent(handle)}`,
  // v5.65.0. Subdomain templates (tumblr, shopify, substack) only ever see a
  // handle the DNS-label regex passed; encodeURIComponent still turns any
  // "/", "?", "#" or "@" into %XX, so the host cannot be steered.
  facebook: (handle) => `https://www.facebook.com/${encodeURIComponent(handle)}`,
  tumblr: (handle) => `https://${encodeURIComponent(handle)}.tumblr.com`,
  indiegogo: (handle) => `https://www.indiegogo.com/projects/${encodeURIComponent(handle)}`,
  shopify: (handle) => `https://${encodeURIComponent(handle)}.myshopify.com`,
  buymeacoffee: (handle) => `https://buymeacoffee.com/${encodeURIComponent(handle)}`,
  substack: (handle) => `https://${encodeURIComponent(handle)}.substack.com`,
  kickstarter: (handle) => `https://www.kickstarter.com/profile/${encodeURIComponent(handle)}`,
  cameo: (handle) => `https://www.cameo.com/${encodeURIComponent(handle)}`,
  paypal: (handle) => `https://www.paypal.me/${encodeURIComponent(handle)}`,
  kofi: (handle) => `https://ko-fi.com/${encodeURIComponent(handle)}`,
  patreon: (handle) => `https://www.patreon.com/${encodeURIComponent(handle)}`,
  cashapp: (handle) => `https://cash.app/$${encodeURIComponent(handle)}`,
  venmo: (handle) => `https://venmo.com/u/${encodeURIComponent(handle)}`,
  linktree: (handle) => `https://linktr.ee/${encodeURIComponent(handle)}`,
  beacons: (handle) => `https://beacons.ai/${encodeURIComponent(handle)}`,
  soundcloud: (handle) => `https://soundcloud.com/${encodeURIComponent(handle)}`,
  spotify: (handle) => `https://open.spotify.com/artist/${encodeURIComponent(handle)}`,
};

// Mirrors api/core/shapers.mjs normalizeSocialHandle: a pasted cashtag drops
// exactly one leading "$" before validation.
export const normalizeSocialHandle = (key, value) =>
  key === "cashapp" && typeof value === "string" && value.startsWith("$") ? value.slice(1) : value;

// The editor's `pattern` attribute for a platform (v5.66.0). Browsers compile
// it with the `v` flag, where a literal "-" inside a class must be escaped —
// unescaped, the whole pattern is invalid and silently ignored (14 platforms
// lost the hint). Every literal dash in these classes sits right before "]".
// Cash App also accepts a pasted "$" (stripped before the save).
export const socialInputPattern = (key) => {
  const source = SOCIAL_PATTERNS[key].source.replace(/-\]/g, "\\-]");
  return key === "cashapp" ? "\\$?" + source.slice(1, -1) : source;
};

// The muted note under the payment-link group (v5.65.0).
export const createPaymentNote = (document) => {
  const note = document.createElement("p");
  note.className = "muted form-note social-payment-note";
  note.textContent = t("profileEditor.paymentNote");
  return note;
};

// Pure, DOM-free. Returns [{ key, label, text, url? }] for every platform with
// a non-empty handle, in SOCIAL_PLATFORM_ORDER order. socials.polytoria wins
// over the separate polytoriaUsername field; both exist on the payload.
export const buildSocialLinks = (socials = {}, polytoriaUsername = null) => {
  const handles = { ...socials };
  if (typeof polytoriaUsername === "string" && polytoriaUsername &&
    !(typeof handles.polytoria === "string" && handles.polytoria)) {
    handles.polytoria = polytoriaUsername;
  }
  const links = [];
  for (const key of SOCIAL_PLATFORM_ORDER) {
    const handle = handles[key];
    if (typeof handle !== "string" || !handle) continue;
    const base = SOCIAL_LINK_BASES[key];
    links.push({
      key,
      label: SOCIAL_LABELS[key],
      text: handle,
      // v5.65.0: a handle that fails its pattern never becomes an href
      // (plain text instead) — the server already refuses such writes.
      url: base && (!SOCIAL_PATTERNS[key] || SOCIAL_PATTERNS[key].test(handle)) ? base(handle) : undefined,
    });
  }
  return links;
};

// Pure, DOM-free. Keys that would fail the server's PATCH /api/me validation.
// null / undefined / "" mean "clear this field" and mirror the server's rule
// that clearing is always allowed. Unknown platform keys are invalid (server →
// 400).
export const invalidSocialKeys = (socials = {}) => {
  const invalid = [];
  for (const [key, value] of Object.entries(socials)) {
    const pattern = SOCIAL_PATTERNS[key];
    if (!pattern) {
      invalid.push(key);
      continue;
    }
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string" || !pattern.test(value)) invalid.push(key);
  }
  return invalid;
};

// Collapsible public socials (plan v2.3, luuuuuu): the profile's link list
// renders inside <details class="socials-details"> whose summary carries the
// link count; the existing list markup lives inside. Single rule, documented:
// details.open = isOwnProfile — the owner's own profile renders the section
// OPEN, every other visitor gets it CLOSED. Returns null when the profile has
// no links at all (callers render nothing, as before). textContent-only
// building, no innerHTML.
export function renderProfileSocials(document, profile, isOwnProfile = false) {
  const links = buildSocialLinks(profile?.socials, profile?.polytoriaUsername);
  if (!links.length) return null;
  const container = document.createElement("details");
  container.className = "socials-details";
  container.open = isOwnProfile;
  const summary = document.createElement("summary");
  summary.className = "socials-summary";
  summary.textContent = tn("profileEditor.links", links.length);
  container.append(summary);
  const list = document.createElement("ul");
  list.className = "profile-socials";
  for (const link of links) {
    const item = document.createElement("li");
    item.className = "profile-social";
    const label = document.createElement("span");
    label.className = "social-label";
    label.textContent = `${link.label}: `;
    item.append(label);
    if (link.url) {
      const anchor = document.createElement("a");
      anchor.className = "social-handle";
      anchor.textContent = link.text;
      anchor.href = link.url;
      anchor.rel = "me nofollow noopener ugc"; // i18n-ignore
      item.append(anchor);
    } else {
      const handle = document.createElement("span");
      handle.className = "social-handle";
      handle.textContent = link.text;
      item.append(handle);
    }
    list.append(item);
  }
  container.append(list);
  return container;
}

// Owner profile editor: bio textarea (10,000-char limit, spec §11) plus the
// social inputs prefilled from the profile payload. Submission is handled
// by app.js's data-form="profile-editor" handler, which re-fetches the profile
// after PATCH /api/me (the PATCH response echo is asymmetric).
export function renderProfileEditor(main, user) {
  const document = main.ownerDocument;
  const panel = document.createElement("section");
  panel.className = "panel profile-editor-panel";
  const heading = document.createElement("h2");
  heading.textContent = t("profileEditor.title");
  panel.append(heading);
  const socials = user && user.socials && typeof user.socials === "object"
    ? user.socials
    : {};
  const fields = [
    createTextarea(document, {
      id: "profile-bio", name: "bio", label: t("profileEditor.bio"), rows: 4, maxLength: 10000,
      description: t("profileEditor.bioHelp"),
    }),
    ...SOCIAL_PLATFORM_ORDER.flatMap((key) => {
      const input = createInput(document, {
        id: `profile-social-${key}`, name: key, label: SOCIAL_LABELS[key],
        maxLength: 120,
        description: key === "polytoria"
          ? t("profileEditor.polytoriaHelp")
          : SOCIAL_PATTERNS[key] ? t("profileEditor.handleHelp", { platform: SOCIAL_LABELS[key] }) : "",
      });
      return key === PAYMENT_SOCIAL_KEYS.at(-1) ? [input, createPaymentNote(document)] : [input];
    }),
    createInput(document, {
      id: "profile-banner-color", name: "bannerColor", label: t("profileEditor.bannerColor"),
      maxLength: 7, description: t("profileEditor.bannerColorHelp"),
    }),
    createInput(document, {
      id: "profile-banner-text", name: "bannerText", label: t("profileEditor.bannerText"),
      maxLength: 80, description: t("profileEditor.bannerTextHelp"),
    }),
    createInput(document, {
      id: "profile-flair", name: "flair", label: t("profileEditor.flair"),
      maxLength: 32, description: t("profileEditor.flairHelp"),
    }),
    // Pronouns (v5.23.0 F2): optional, empty by default; the server re-checks.
    createInput(document, {
      id: "profile-pronouns", name: "pronouns", label: t("profileEditor.pronouns"),
      maxLength: 24, description: t("profileEditor.pronounsHelp"),
    }),
  ];
  const form = createForm(document, "profile-editor", fields, t("profileEditor.save"));
  form.querySelector("#profile-bio").value =
    typeof user?.bio === "string" ? user.bio : "";
  for (const key of SOCIAL_PLATFORM_ORDER) {
    const input = form.querySelector(`#profile-social-${key}`);
    const value = socials[key];
    input.value = typeof value === "string" ? value : "";
    input.pattern = socialInputPattern(key);
  }
  form.querySelector("#profile-banner-color").value = user?.bannerColor || "";
  form.querySelector("#profile-banner-text").value = user?.bannerText || "";
  form.querySelector("#profile-flair").value = user?.flair || "";
  const pronounsInput = form.querySelector("#profile-pronouns");
  pronounsInput.value = typeof user?.pronouns === "string" ? user.pronouns : "";
  pronounsInput.pattern = PRONOUNS_PATTERN_SOURCE;
  form.dataset.pronouns = pronounsInput.value;
  panel.append(form);
  if (user) {
    const cssPanel = renderProfileCssEditor(document, user);
    if (cssPanel) panel.append(cssPanel);
    panel.append(renderProfileAccentPicker(document, user.profileAccent || ""));
    panel.append(renderProfileHeaderPicker(document, user.profileHeader || ""));
  }
  main.append(panel);
  return panel;
}

// Batch I: the header decoration select (plain, tint from my picture, or a
// static pattern). The route owns the change handler (PUT
// /api/me/profile-header); values mirror constants.mjs PROFILE_HEADER_STYLES.
const PROFILE_HEADER_CHOICES = [
  { value: "", labelKey: "profile2.headerNone" },
  { value: "tint", labelKey: "profile2.headerTint" },
  { value: "dots", labelKey: "profile2.headerDots" },
  { value: "stripes", labelKey: "profile2.headerStripes" },
  { value: "grid", labelKey: "profile2.headerGrid" },
];

export function renderProfileHeaderPicker(document, current = "") {
  const field = document.createElement("div");
  field.className = "profile2-header-picker";
  const label = document.createElement("label");
  label.htmlFor = "profile2-header-style";
  label.textContent = t("profile2.headerLabel");
  const select = document.createElement("select");
  select.id = "profile2-header-style";
  for (const choice of PROFILE_HEADER_CHOICES) {
    const option = document.createElement("option");
    option.value = choice.value;
    option.textContent = t(choice.labelKey);
    option.selected = choice.value === current;
    select.append(option);
  }
  field.append(label, select);
  return field;
}

// Profile colors (any hex, v3.0.2): the presets are display-only quick
// picks — dataset.accent carries the HEX (the server re-validates and
// stores lowercase hex; "" clears). The current accent arrives from the
// server already normalized to hex, so pressed-state compares hex-to-hex.
// The color input (wired by app.js) offers any #rrggbb beyond the presets.
export const PROFILE_ACCENT_PRESETS = [
  { key: "", labelKey: "profileEditor.colorDefault", hex: "" },
  { key: "forest", labelKey: "profileEditor.colorForest", hex: "#3f8a63" },
  { key: "coral", labelKey: "profileEditor.colorCoral", hex: "#d05f4c" },
  { key: "gold", labelKey: "profileEditor.colorGold", hex: "#d9a627" },
  { key: "sky", labelKey: "profileEditor.colorSky", hex: "#4d8fc4" },
  { key: "violet", labelKey: "profileEditor.colorViolet", hex: "#8b6cc4" },
  { key: "rose", labelKey: "profileEditor.colorRose", hex: "#c95f86" },
  { key: "teal", labelKey: "profileEditor.colorTeal", hex: "#3d9aa0" },
];

export function renderProfileAccentPicker(document, currentAccent = "") {
  const field = document.createElement("div");
  field.className = "accent-picker";
  const label = document.createElement("p");
  label.className = "accent-picker-label";
  label.textContent = t("profileEditor.colorTitle");
  field.append(label);
  const current = String(currentAccent || "").toLowerCase();
  for (const preset of PROFILE_ACCENT_PRESETS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "accent-swatch" + (preset.key ? " accent-" + preset.key : " accent-default");
    swatch.dataset.accent = preset.hex;
    swatch.dataset.action = "set-profile-accent";
    const presetLabel = t(preset.labelKey);
    swatch.setAttribute("aria-label", t("profileEditor.colorNamed", { name: presetLabel }));
    swatch.setAttribute("title", presetLabel);
    swatch.setAttribute("aria-pressed", preset.hex.toLowerCase() === current ? "true" : "false");
    field.append(swatch);
  }
  // Any-hex pick: a hex text field that Coloris (batch I, profile-colours.js)
  // turns into a picker; typing a hex keeps working without it. The route
  // owns the change handler (this module stays DOM-pure); it PATCHes the hex
  // and re-renders the route.
  const colorInput = document.createElement("input");
  colorInput.type = "text";
  colorInput.className = "accent-color-input";
  colorInput.maxLength = 7;
  colorInput.setAttribute("pattern", "#[0-9a-fA-F]{6}");
  colorInput.setAttribute("autocomplete", "off");
  colorInput.setAttribute("spellcheck", "false");
  colorInput.value = /^#[0-9a-fA-F]{6}$/.test(String(currentAccent || "")) ? currentAccent : "";
  colorInput.setAttribute("aria-label", t("profileEditor.customColor"));
  colorInput.setAttribute("title", t("profileEditor.customColorTitle"));
  field.append(colorInput);
  return field;
}

// Custom profile CSS (v2.5): a textarea + save/clear; the app-level actions
// (save-profile-css / clear-profile-css) do the POST/DELETE to /api/me/css,
// mirroring the avatar desk's review-first note.
export function renderProfileCssEditor(document, user) {
  const panel = document.createElement("div");
  panel.className = "css-editor";
  const label = document.createElement("label");
  label.className = "css-editor-label";
  label.textContent = t("profileEditor.cssLabel");
  const textarea = document.createElement("textarea");
  textarea.id = "profile-css-input";
  textarea.className = "css-editor-input";
  textarea.dataset.cssInput = "true";
  textarea.maxLength = 20000;
  textarea.rows = 6;
  textarea.placeholder = t("profileEditor.cssPlaceholder");
  textarea.value = typeof user.customCssRaw === "string" ? user.customCssRaw : "";
  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent = t("profileEditor.cssNote");
  panel.append(label, textarea, note);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "button";
  save.dataset.action = "save-profile-css";
  save.textContent = t("profileEditor.cssSave");
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "button button-quiet";
  clear.dataset.action = "clear-profile-css";
  clear.textContent = t("profileEditor.cssRemove");
  panel.append(save, clear);
  return panel;
}
