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

// Profile editor (bio up to 10,000 characters + the ten social inputs) and the
// pure social-link map shared by the profile page renderer in routes/profile.js.
// The client-side patterns below are pinned copies of api/shared.mjs
// SOCIAL_PLATFORMS — the server re-validates everything; these only steer the
// editor. All DOM building is textContent-based (no innerHTML).
// 5.0 wave 5: the editor rides the vendored framework — the kit's
// createForm/createInput (the verbatim twins of the old forms.js calls) build
// the labeled fields, el() builds the rest. createTextarea has no kit twin,
// so the frozen forms.js still supplies it.
import { el } from "./vendor/frontload/dom.mjs";
import { createForm, createInput } from "./vendor/designer/kit.mjs";
import { createTextarea } from "./forms.js";

export const SOCIAL_LABELS = {
  youtube: "YouTube",
  x: "X",
  reddit: "Reddit",
  github: "GitHub",
  discord: "Discord",
  gitlab: "GitLab",
  instagram: "Instagram",
  tiktok: "TikTok",
  twitch: "Twitch",
  polytoria: "Polytoria",
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
  const container = el("details", { class: "socials-details" });
  container.open = isOwnProfile;
  container.append(el("summary", { class: "socials-summary",
    text: links.length === 1 ? "1 link" : `${links.length} links` }));
  const list = el("ul", { class: "profile-socials" });
  for (const link of links) {
    const item = el("li", { class: "profile-social" });
    item.append(el("span", { class: "social-label", text: `${link.label}: ` }));
    item.append(link.url
      ? el("a", { class: "social-handle", text: link.text, href: link.url })
      : el("span", { class: "social-handle", text: link.text }));
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
  const editorPanel = el("section", { class: "panel profile-editor-panel" });
  editorPanel.append(el("h2", { text: "Edit your profile" }));
  const socials = user && user.socials && typeof user.socials === "object"
    ? user.socials
    : {};
  const fields = [
    createTextarea(document, {
      id: "profile-bio", name: "bio", label: "Bio", rows: 4, maxLength: 10000,
      description: "Up to 10000 characters. Shown on your profile.",
    }),
    ...SOCIAL_PLATFORM_ORDER.map((key) => createInput(document, {
      id: `profile-social-${key}`, name: key, label: SOCIAL_LABELS[key],
      maxLength: 120,
      description: key === "polytoria"
        ? "Your Polytoria username."
        : SOCIAL_PATTERNS[key] ? `Just the ${SOCIAL_LABELS[key]} handle, not the whole URL.` : "",
    })),
    createInput(document, {
      id: "profile-banner-color", name: "bannerColor", label: "Banner color",
      maxLength: 7, description: "Any hex like #4d8fc4, or blank to clear.",
    }),
    createInput(document, {
      id: "profile-banner-text", name: "bannerText", label: "Banner text",
      maxLength: 80, description: "Optional text displayed in your profile banner.",
    }),
    createInput(document, {
      id: "profile-flair", name: "flair", label: "Profile flair",
      maxLength: 32, description: "A short label shown below your name.",
    }),
  ];
  const form = createForm(document, "profile-editor", fields, "Save profile");
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
  editorPanel.append(form);
  if (user) {
    const cssPanel = renderProfileCssEditor(document, user);
    if (cssPanel) editorPanel.append(cssPanel);
    editorPanel.append(renderProfileAccentPicker(document, user.profileAccent || ""));
  }
  main.append(editorPanel);
  return editorPanel;
}

// Profile colors (any hex, v3.0.2): the presets are display-only quick
// picks — dataset.accent carries the HEX (the server re-validates and
// stores lowercase hex; "" clears). The current accent arrives from the
// server already normalized to hex, so pressed-state compares hex-to-hex.
// The color input (wired by app.js) offers any #rrggbb beyond the presets.
export const PROFILE_ACCENT_PRESETS = [
  { key: "", label: "Default", hex: "" },
  { key: "forest", label: "Forest", hex: "#3f8a63" },
  { key: "coral", label: "Coral", hex: "#d05f4c" },
  { key: "gold", label: "Gold", hex: "#d9a627" },
  { key: "sky", label: "Sky", hex: "#4d8fc4" },
  { key: "violet", label: "Violet", hex: "#8b6cc4" },
  { key: "rose", label: "Rose", hex: "#c95f86" },
  { key: "teal", label: "Teal", hex: "#3d9aa0" },
];

export function renderProfileAccentPicker(document, currentAccent = "") {
  const field = el("div", { class: "accent-picker" });
  field.append(el("p", { class: "accent-picker-label", text: "Profile color" }));
  const current = String(currentAccent || "").toLowerCase();
  for (const preset of PROFILE_ACCENT_PRESETS) {
    const swatch = el("button", {
      // The preset's own modifier rides the class name; the factory family
      // sets the rest through the structural props below.
      class: "accent-swatch" + (preset.key ? " accent-" + preset.key : " accent-default"),
      dataset: { accent: preset.hex, action: "set-profile-accent" },
    });
    swatch.type = "button";
    swatch.setAttribute("aria-label", "Profile color: " + preset.label);
    swatch.setAttribute("title", preset.label);
    swatch.setAttribute("aria-pressed", preset.hex.toLowerCase() === current ? "true" : "false");
    field.append(swatch);
  }
  // Any-hex pick: a native color input. app.js owns the change handler (this
  // module stays DOM-pure); it PATCHes the hex and re-renders the route.
  const colorInput = el("input", { type: "color", class: "accent-color-input" });
  colorInput.value = /^#[0-9a-fA-F]{6}$/.test(String(currentAccent || "")) ? currentAccent : "#3f8a63";
  colorInput.setAttribute("aria-label", "Custom profile color");
  colorInput.setAttribute("title", "Custom color — any hex");
  field.append(colorInput);
  return field;
}

// Custom profile CSS (v2.5): a textarea + save/clear; the app-level actions
// (save-profile-css / clear-profile-css) do the POST/DELETE to /api/me/css,
// mirroring the avatar desk's review-first note.
export function renderProfileCssEditor(document, user) {
  const cssPanel = el("div", { class: "css-editor" });
  const textarea = el("textarea", {
    // The kit's labeled-field law: the label wraps for the input's id.
    maxLength: 20000,
    class: "css-editor-input",
    dataset: { cssInput: "true" },
  });
  textarea.id = "profile-css-input";
  textarea.rows = 6;
  textarea.placeholder = "body { font-family: serif; } — every rule is scoped to your profile.";
  textarea.value = typeof user.customCssRaw === "string" ? user.customCssRaw : "";
  cssPanel.append(el("label", { class: "css-editor-label" }, "Custom profile CSS (moderated)"));
  cssPanel.append(textarea);
  cssPanel.append(el("p", { class: "form-note",
    text: "CSS saves as PENDING: a mod approves it before it goes live. Scoped to your profile container by the server." }));
  const save = el("button", {
    class: "button", type: "button",
    dataset: { action: "save-profile-css" }, text: "Save CSS for review",
  });
  const clear = el("button", {
    class: "button button-quiet", type: "button",
    dataset: { action: "clear-profile-css" }, text: "Remove my CSS",
  });
  cssPanel.append(save, clear);
  return cssPanel;
}
