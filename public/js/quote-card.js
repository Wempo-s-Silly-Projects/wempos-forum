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

// Batch O: "Make it a Quote" card. Loaded lazily by quote-card-action.js the
// first time a reader presses Quote card. Draws a 1200x630 PNG on a canvas,
// entirely in the browser (no server call): the author's avatar on the left
// fading into the background, the quote large on the right (canvas-txt wraps
// it and the font shrinks until it fits; bidi-js picks the base direction so
// Arabic, Hebrew and Persian run right-to-left), then "— name", "@handle"
// and the site wordmark. Spoilers are masked and quoted lines dropped before
// anything is drawn. Only a same-origin /api/avatars/ image may touch the
// canvas (a cross-origin image would taint it and block the export); any
// other avatar, or none, gets a drawn monogram instead.
import { layoutText, drawTextLayout } from "./vendor/canvas-txt.js";
import bidiFactory from "./vendor/bidi.js";
import { maskSpoilers } from "./markdown.js";
import { t } from "./i18n.js";

// Mirrors of root constants.mjs (tests/quote-card.test.mjs pins them equal).
export const QUOTE_CARD_WIDTH = 1200;
export const QUOTE_CARD_HEIGHT = 630;
export const QUOTE_CARD_MAX_CHARS = 500;
export const QUOTE_CARD_FONT_MAX = 64;
export const QUOTE_CARD_FONT_MIN = 24;

const FONT_STEP = 2;
const LINE_HEIGHT_RATIO = 1.3;
const AVATAR_PATH = "/api/avatars/";
const ELLIPSIS = "…";
const REVOKE_DELAY_MS = 1000;
const PNG = "image/png";
// System fonts only (no web font download); the emoji faces come last so
// emoji render in colour from the system.
export const QUOTE_CARD_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Arabic", ' + // i18n-ignore
  '"Noto Sans Hebrew", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"'; // i18n-ignore

export const QUOTE_CARD_LAYOUT = Object.freeze({
  avatarWidth: 480, fadeStart: 250,
  textX: 540, textY: 70, textWidth: 600, textHeight: 370,
  nameY: 462, nameHeight: 52, nameSize: 34,
  handleY: 516, handleHeight: 36, handleSize: 26,
  markY: 574, markHeight: 30, markSize: 22,
  monogramSize: 220, accentBar: 6, accentGap: 26,
});

export const QUOTE_CARD_THEMES = Object.freeze({
  dark: Object.freeze({ background: "#101218", backgroundRgb: "16, 18, 24", text: "#f4f5f7", muted: "#a3abb8", accent: "#8ab4ff" }),
  light: Object.freeze({ background: "#f7f7f5", backgroundRgb: "247, 247, 245", text: "#16181d", muted: "#545b68", accent: "#2f5bd3" }),
});

// ---------------------------------------------------------------- text

const QUOTED_LINE = /^\s*>/;
const MARKS = /\*\*|__|~~|`/g;
const GIF_TOKENS = /\[gif:[0-9a-f-]{36}\]/g;

const graphemes = (text) => (typeof Intl !== "undefined" && "Segmenter" in Intl // i18n-ignore
  ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment)
  : Array.from(text));

function capGraphemes(text, max) {
  const parts = graphemes(text);
  if (parts.length <= max) return text;
  return parts.slice(0, max - 1).join("").trimEnd() + ELLIPSIS;
}

// The words that go on the card: spoilers masked, the author's own lines
// only (quoted "> " lines are someone else's words), markdown marks and GIF
// tokens dropped, spacing collapsed, capped at QUOTE_CARD_MAX_CHARS.
export function quoteCardText(body) {
  const masked = maskSpoilers(String(body ?? "")).replace(GIF_TOKENS, "");
  const all = masked.split(/\r?\n/);
  const own = all.filter((line) => !QUOTED_LINE.test(line));
  const lines = (own.join("").trim() ? own : all)
    .map((line) => line.replace(MARKS, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return capGraphemes(lines.join("\n"), QUOTE_CARD_MAX_CHARS);
}

let bidi = null;
const defaultBidi = () => (bidi ??= bidiFactory());

// The base direction by the Unicode bidi algorithm (first strong character):
// "rtl" for Arabic/Hebrew/Persian text, "ltr" otherwise (emoji/digits only too).
export function textDirection(text, bidiImpl = defaultBidi()) {
  const level = bidiImpl.getEmbeddingLevels(String(text ?? "")).paragraphs?.[0]?.level ?? 0;
  return level % 2 === 1 ? "rtl" : "ltr";
}

const fitConfig = (box, size, overflow) => ({
  width: box.width, height: box.height, font: QUOTE_CARD_FONT, fontSize: size, fontWeight: "600",
  lineHeight: Math.round(size * LINE_HEIGHT_RATIO), direction: box.direction,
  align: box.direction === "rtl" ? "right" : "left", vAlign: "middle", overflow, cache: false,
});

// The largest size (FONT_MAX down to FONT_MIN in FONT_STEP px) whose wrapped
// layout fits the box; past the minimum the text is clipped with an ellipsis.
export function fitQuoteText(ctx, text, box) {
  for (let size = QUOTE_CARD_FONT_MAX; size >= QUOTE_CARD_FONT_MIN; size -= FONT_STEP) {
    const layout = layoutText(ctx, text, fitConfig(box, size, "visible"));
    if (layout.height <= box.height) return { fontSize: size, layout, clipped: false };
  }
  const layout = layoutText(ctx, text, fitConfig(box, QUOTE_CARD_FONT_MIN, "ellipsis"));
  return { fontSize: QUOTE_CARD_FONT_MIN, layout, clipped: true };
}

// ---------------------------------------------------------------- avatar

export function isDrawableAvatar(url, origin) {
  if (typeof url !== "string" || url === "" || typeof origin !== "string") return false;
  try {
    const base = new URL(origin);
    const parsed = new URL(url, base);
    return parsed.origin === base.origin && parsed.pathname.startsWith(AVATAR_PATH);
  } catch {
    return false;
  }
}

export function loadAvatarImage(document, url) {
  return new Promise((resolve, reject) => {
    const image = document.createElement("img");
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("avatar unavailable")), { once: true }); // i18n-ignore
    image.src = url;
  });
}

async function avatarImage(url, origin, loadImage) {
  if (!isDrawableAvatar(url, origin)) return null;
  try {
    return await loadImage(new URL(url, origin).href);
  } catch {
    return null;
  }
}

function drawCover(ctx, image) {
  const { avatarWidth } = QUOTE_CARD_LAYOUT;
  const width = Number(image.naturalWidth || image.width) || avatarWidth;
  const height = Number(image.naturalHeight || image.height) || QUOTE_CARD_HEIGHT;
  const scale = Math.max(avatarWidth / width, QUOTE_CARD_HEIGHT / height);
  const cropWidth = avatarWidth / scale;
  const cropHeight = QUOTE_CARD_HEIGHT / scale;
  ctx.drawImage(image, (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight,
    0, 0, avatarWidth, QUOTE_CARD_HEIGHT);
}

const hueOf = (name) => Array.from(String(name)).reduce((sum, char) => (sum * 31 + char.codePointAt(0)) % 360, 7);

// The fallback avatar: a colour panel (hue from the username) with the
// name's first letter.
function drawMonogram(ctx, username) {
  const { avatarWidth, monogramSize } = QUOTE_CARD_LAYOUT;
  ctx.fillStyle = `hsl(${hueOf(username)}, 42%, 38%)`;
  ctx.fillRect(0, 0, avatarWidth, QUOTE_CARD_HEIGHT);
  ctx.font = `700 ${monogramSize}px ${QUOTE_CARD_FONT}`; // i18n-ignore
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "ltr";
  ctx.fillStyle = "#ffffff";
  ctx.fillText((graphemes(String(username))[0] ?? "?").toUpperCase(), avatarWidth / 2, QUOTE_CARD_HEIGHT / 2);
}

function drawFade(ctx, palette) {
  const { avatarWidth, fadeStart } = QUOTE_CARD_LAYOUT;
  const gradient = ctx.createLinearGradient(fadeStart, 0, avatarWidth, 0);
  gradient.addColorStop(0, `rgba(${palette.backgroundRgb}, 0)`);
  gradient.addColorStop(1, `rgba(${palette.backgroundRgb}, 1)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(fadeStart, 0, avatarWidth - fadeStart, QUOTE_CARD_HEIGHT);
}

// ---------------------------------------------------------------- card

// One single-line label (name, handle, wordmark) inside the text column.
function drawLabel(ctx, text, { y, height, size, fill, weight, align }) {
  const { textX, textWidth } = QUOTE_CARD_LAYOUT;
  const layout = layoutText(ctx, text, {
    width: textWidth, height, font: QUOTE_CARD_FONT, fontSize: size, fontWeight: weight,
    direction: textDirection(text), align, vAlign: "middle", maxLines: 1, overflow: "ellipsis", cache: false,
  });
  drawTextLayout(ctx, layout, { x: textX, y, style: { fill } });
}

function drawQuote(ctx, text, direction, palette) {
  const { textX, textY, textWidth, textHeight, accentBar, accentGap } = QUOTE_CARD_LAYOUT;
  ctx.fillStyle = palette.accent;
  ctx.fillRect(direction === "rtl" ? textX + textWidth + accentGap - accentBar : textX - accentGap,
    textY, accentBar, textHeight);
  const fit = fitQuoteText(ctx, text, { width: textWidth, height: textHeight, direction });
  drawTextLayout(ctx, fit.layout, { x: textX, y: textY, style: { fill: palette.text } });
  return fit;
}

export async function renderQuoteCard({ canvas, item, theme = "dark", origin = "", loadImage }) {
  const palette = QUOTE_CARD_THEMES[theme] ?? QUOTE_CARD_THEMES.dark;
  const L = QUOTE_CARD_LAYOUT;
  canvas.width = QUOTE_CARD_WIDTH;
  canvas.height = QUOTE_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, QUOTE_CARD_WIDTH, QUOTE_CARD_HEIGHT);
  const image = await avatarImage(item.avatarUrl, origin, loadImage ?? ((url) => loadAvatarImage(globalThis.document, url)));
  if (image) drawCover(ctx, image); else drawMonogram(ctx, item.username);
  drawFade(ctx, palette);
  const text = quoteCardText(item.body);
  const direction = textDirection(text);
  const fit = drawQuote(ctx, text, direction, palette);
  const align = direction === "rtl" ? "right" : "left";
  drawLabel(ctx, `— ${item.displayName || item.username}`,
    { y: L.nameY, height: L.nameHeight, size: L.nameSize, fill: palette.text, weight: "700", align });
  drawLabel(ctx, `@${item.username}`,
    { y: L.handleY, height: L.handleHeight, size: L.handleSize, fill: palette.muted, weight: "400", align });
  drawLabel(ctx, t("app.siteName"),
    { y: L.markY, height: L.markHeight, size: L.markSize, fill: palette.muted, weight: "600", align: direction === "rtl" ? "left" : "right" });
  return { text, direction, fontSize: fit.fontSize, clipped: fit.clipped, avatar: image ? "image" : "fallback" };
}

// ---------------------------------------------------------------- dialog

export const quoteCardFileName = (item) => `quote-${String(item?.username ?? "").replace(/[^\w-]/g, "_")}.png`;

const canCopyImage = (nav, ClipboardItemCtor) =>
  typeof nav?.clipboard?.write === "function" && typeof ClipboardItemCtor === "function";

let dialogCount = 0;

function button(document, className, label) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = `button ${className}`;
  node.textContent = label;
  return node;
}

function buildDialog(document) {
  const dialog = document.createElement("dialog");
  dialog.className = "quote-card-dialog";
  const heading = document.createElement("h2");
  heading.id = `quote-card-title-${++dialogCount}`;
  heading.textContent = t("quotecard.title");
  dialog.setAttribute("aria-labelledby", heading.id);
  const preview = document.createElement("img");
  preview.className = "quote-card-preview";
  preview.width = QUOTE_CARD_WIDTH;
  preview.height = QUOTE_CARD_HEIGHT;
  preview.style.maxWidth = "100%";
  preview.style.height = "auto";
  const status = document.createElement("p");
  status.className = "quote-card-status";
  status.setAttribute("role", "status");
  const theme = button(document, "button-quiet quote-card-theme", t("quotecard.lightTheme"));
  theme.setAttribute("aria-pressed", "false");
  const download = button(document, "button-primary quote-card-download", t("quotecard.download"));
  const copy = button(document, "quote-card-copy", t("quotecard.copy"));
  const close = button(document, "button-quiet quote-card-close", t("common.close"));
  const actions = document.createElement("div");
  actions.className = "quote-card-actions";
  actions.append(theme, download, copy, close);
  dialog.append(heading, preview, status, actions);
  return { dialog, preview, status, theme, download, copy, close };
}

const canvasBlob = (canvas) => new Promise((resolve, reject) => {
  try {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no image"))), PNG); // i18n-ignore
  } catch (error) {
    reject(error);
  }
});

function saveBlob(document, urlApi, blob, fileName) {
  const href = urlApi.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => urlApi.revokeObjectURL(href), REVOKE_DELAY_MS);
}

export function openQuoteCardDialog(document, item, {
  opener = null, origin = globalThis.location?.origin ?? "", loadImage,
  createCanvas = () => document.createElement("canvas"), navigator: nav = globalThis.navigator,
  ClipboardItem: ClipboardItemCtor = globalThis.ClipboardItem, URL: urlApi = globalThis.URL,
} = {}) {
  const canvas = createCanvas();
  const ui = buildDialog(document);
  const say = (key) => { ui.status.textContent = key ? t(key) : ""; };
  let theme = "dark";
  let avatarLoad = null;
  const onceLoad = (url) => (avatarLoad ??= (loadImage ?? ((src) => loadAvatarImage(document, src)))(url));
  const drawOnce = () => {
    say("quotecard.preparing");
    return renderQuoteCard({ canvas, item, theme, origin, loadImage: onceLoad }).then((result) => {
      ui.preview.src = canvas.toDataURL(PNG);
      ui.preview.alt = result.text;
      say("");
    }, () => say("quotecard.failed"));
  };
  let current = drawOnce();
  ui.theme.addEventListener("click", () => {
    const light = ui.theme.getAttribute("aria-pressed") !== "true";
    ui.theme.setAttribute("aria-pressed", String(light));
    theme = light ? "light" : "dark";
    current = current.then(drawOnce);
  });
  ui.download.addEventListener("click", () => {
    current.then(() => canvasBlob(canvas))
      .then((blob) => saveBlob(document, urlApi, blob, quoteCardFileName(item)))
      .catch(() => say("quotecard.failed"));
  });
  ui.copy.hidden = !canCopyImage(nav, ClipboardItemCtor);
  ui.copy.addEventListener("click", () => {
    // Built synchronously inside the click (Safari's user-activation rule),
    // carrying a promise of the PNG.
    const entry = new ClipboardItemCtor({ [PNG]: current.then(() => canvasBlob(canvas)) });
    Promise.resolve(nav.clipboard.write([entry])).then(() => say("quotecard.copied"), () => say("quotecard.copyFailed"));
  });
  ui.close.addEventListener("click", () => ui.dialog.close());
  ui.dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    ui.dialog.close();
  });
  ui.dialog.addEventListener("close", () => {
    ui.dialog.remove();
    opener?.focus?.();
  });
  document.body.append(ui.dialog);
  ui.dialog.showModal?.();
  ui.close.focus?.();
  return { dialog: ui.dialog, ready: current };
}
