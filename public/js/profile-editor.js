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

// Profile editor (bio up to 10,000 characters + the ten social inputs) and the
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
  polytoria: "Polytoria", // i18n-ignore
};

// Field order for the editor; spec §10 (Polytoria last).
export const SOCIAL_PLATFORM_ORDER = [
  "youtube", "x", "reddit", "github", "discord", "gitlab",
  "instagram", "tiktok", "twitch", "polytoria",
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
      url: base ? base(handle) : undefined,
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
// ten social inputs prefilled from the profile payload. Submission is handled
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
    ...SOCIAL_PLATFORM_ORDER.map((key) => createInput(document, {
      id: `profile-social-${key}`, name: key, label: SOCIAL_LABELS[key],
      maxLength: 120,
      description: key === "polytoria"
        ? t("profileEditor.polytoriaHelp")
        : SOCIAL_PATTERNS[key] ? t("profileEditor.handleHelp", { platform: SOCIAL_LABELS[key] }) : "",
    })),
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
    input.pattern = SOCIAL_PATTERNS[key].source;
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
  }
  main.append(panel);
  return panel;
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
  // Any-hex pick: a native color input. app.js owns the change handler (this
  // module stays DOM-pure); it PATCHes the hex and re-renders the route.
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "accent-color-input";
  colorInput.value = /^#[0-9a-fA-F]{6}$/.test(String(currentAccent || "")) ? currentAccent : "#3f8a63";
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
