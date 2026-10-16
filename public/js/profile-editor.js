// Profile editor (bio up to 10,000 characters + the ten social inputs) and the
// pure social-link map shared by the profile page renderer in app.js. The
// client-side patterns below are pinned copies of api/shared.mjs
// SOCIAL_PLATFORMS — the server re-validates everything; these only steer the
// editor. All DOM building is textContent-based (no innerHTML).
import { createForm, createInput, createTextarea } from "./forms.js";

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
  summary.textContent = links.length === 1 ? "1 link" : `${links.length} links`;
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
  heading.textContent = "Edit your profile";
  panel.append(heading);
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
        ? "Your Polytoria username (shown as plain text)."
        : SOCIAL_PATTERNS[key] ? `Just the ${SOCIAL_LABELS[key]} handle, not the whole URL.` : "",
    })),
    createInput(document, {
      id: "profile-banner-color", name: "bannerColor", label: "Banner color",
      maxLength: 10, description: "green, rust, gold, slate, plum, or blank to clear.",
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
  panel.append(form);
  if (user) {
    const cssPanel = renderProfileCssEditor(document, user);
    if (cssPanel) panel.append(cssPanel);
    panel.append(renderProfileAccentPicker(document, user.profileAccent || ""));
  }
  main.append(panel);
  return panel;
}

// Profile themes (v2.5): the palette mirrors api/shared.mjs's PROFILE_ACCENTS
// whitelist EXACTLY (the server is the validator; this copy is display-only).
// Colors apply via per-key CSS classes (styles.css) — no inline styles, so a
// restrictive CSP is happy; "none" is the forum default green.
export const PROFILE_ACCENT_KEYS = ["", "forest", "coral", "gold", "sky", "violet", "rose", "teal"];
export const PROFILE_ACCENT_LABELS = {
  "": "Default",
  forest: "Forest",
  coral: "Coral",
  gold: "Gold",
  sky: "Sky",
  violet: "Violet",
  rose: "Rose",
  teal: "Teal",
};

export function renderProfileAccentPicker(document, currentAccent = "") {
  const field = document.createElement("div");
  field.className = "accent-picker";
  const label = document.createElement("p");
  label.className = "accent-picker-label";
  label.textContent = "Profile color";
  field.append(label);
  for (const key of PROFILE_ACCENT_KEYS) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "accent-swatch" + (key ? " accent-" + key : " accent-default");
    swatch.dataset.accent = key;
    swatch.dataset.action = "set-profile-accent";
    swatch.setAttribute("aria-label", "Profile color: " + PROFILE_ACCENT_LABELS[key]);
    swatch.setAttribute("title", PROFILE_ACCENT_LABELS[key]);
    swatch.setAttribute("aria-pressed", key === currentAccent ? "true" : "false");
    field.append(swatch);
  }
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
  label.textContent = "Custom profile CSS (moderated)";
  const textarea = document.createElement("textarea");
  textarea.id = "profile-css-input";
  textarea.className = "css-editor-input";
  textarea.dataset.cssInput = "true";
  textarea.maxLength = 20000;
  textarea.rows = 6;
  textarea.placeholder = "body { font-family: serif; } — every rule is scoped to your profile.";
  textarea.value = typeof user.customCssRaw === "string" ? user.customCssRaw : "";
  const note = document.createElement("p");
  note.className = "form-note";
  note.textContent = "CSS saves as PENDING: a moderator approves it before it goes live. Scoped to your profile container by the server.";
  panel.append(label, textarea, note);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "button";
  save.dataset.action = "save-profile-css";
  save.textContent = "Save CSS for review";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "button button-quiet";
  clear.dataset.action = "clear-profile-css";
  clear.textContent = "Remove my CSS";
  panel.append(save, clear);
  return panel;
}
