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
  ];
  const form = createForm(document, "profile-editor", fields, "Save profile");
  form.querySelector("#profile-bio").value =
    typeof user?.bio === "string" ? user.bio : "";
  for (const key of SOCIAL_PLATFORM_ORDER) {
    const input = form.querySelector(`#profile-social-${key}`);
    const value = socials[key];
    input.value = typeof value === "string" ? value : "";
    // Native client-side pattern check mirrors the server's regex; the submit
    // handler re-checks with invalidSocialKeys so the message lands in the
    // status bar too.
    input.pattern = SOCIAL_PATTERNS[key].source;
  }
  panel.append(form);
  main.append(panel);
  return panel;
}