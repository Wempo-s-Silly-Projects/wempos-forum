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

// Rich fenced blocks (Batch C), each a lazy enhancement over the plain code
// block render.js already built (the plain block is always the fallback):
// - ```mermaid → an SVG diagram (vendored Mermaid, securityLevel "strict",
//   no HTML labels, no click callbacks), sanitised again with DOMPurify,
//   with svg-pan-zoom controls when it is wide;
// - ```ansi / ```console holding real escape codes → coloured text via
//   ansi_up (HTML always escaped, links dropped), then DOMPurify;
// - long ```json → a collapsible tree (json-formatter-js) behind a toggle,
//   built only on first use; the raw text stays in place and copyable;
// - math placeholders → KaTeX (math.js), then DOMPurify in place.
// Libraries load same-origin and only when a body needs them; nothing here
// needs 'unsafe-eval' or 'unsafe-inline' (inline styles move to CSSOM).
import { t } from "./i18n.js";
import { typesetMath } from "./math.js";
import {
  ANSI_PURIFY_CONFIG, SVG_PURIFY_CONFIG, loadPurify, moveInlineStyles, purifyInPlace, purifyToFragment,
} from "./sanitize.js";
import { importModuleOnce, loadScriptOnce } from "./vendor-loader.js";

// Mirrors constants.mjs (pinned equal by tests/batch-c-rendering.test.mjs).
export const MERMAID_MAX_CHARS = 20000;
export const MERMAID_PAN_MIN_WIDTH = 800;
export const JSON_TREE_MIN_LINES = 20;

export const MERMAID_SRC = "/js/vendor/mermaid.min.js";
export const SVG_PAN_ZOOM_SRC = "/js/vendor/svg-pan-zoom.min.js";
export const ANSI_UP_SRC = "/js/vendor/ansi_up.js";
export const JSON_FORMATTER_SRC = "/js/vendor/json-formatter.umd.js";

const deepFreeze = (value) => {
  for (const inner of Object.values(value)) if (inner && typeof inner === "object") deepFreeze(inner);
  return Object.freeze(value);
};

// "secure" keys can never be changed by a %%{init}%% directive in a post.
export const MERMAID_CONFIG = deepFreeze({
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  maxTextSize: MERMAID_MAX_CHARS,
  maxEdges: 500,
  secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "htmlLabels", "flowchart",
    "themeCSS", "themeVariables", "fontFamily", "dompurifyConfig", "theme", "darkMode"],
});

const PAN_ZOOM_OPTIONS = Object.freeze({
  zoomEnabled: true,
  controlIconsEnabled: false,
  mouseWheelZoomEnabled: false,
  dblClickZoomEnabled: true,
  fit: true,
  center: true,
  minZoom: 0.5,
  maxZoom: 10,
});

// Scoped to the diagram's shadow root: Mermaid's own <style> text plus a
// fit-to-width base. Applied as a constructed sheet (CSSOM, not markup).
const DIAGRAM_BASE_CSS = ":host{display:block}svg{display:block;max-width:100%;height:auto;margin:0 auto}"
  + ":host(.post-mermaid-pan) svg{width:100%;max-width:none;height:min(70vh,600px)}";

const ESC = "\u001b";
const ANSI_INFOS = new Set(["ansi", "console"]);
const SAFE_TREE_URL = /^https?:\/\/[^\s\\]+$/i;
const lower = (info) => String(info ?? "").trim().toLowerCase();

export const isMermaidFence = (info) => lower(info) === "mermaid";
export const isAnsiFence = (info, text) => ANSI_INFOS.has(lower(info)) && String(text ?? "").includes(ESC);

// A json fence worth a tree: long enough and an object or array.
export function jsonTreePlan(info, text) {
  const source = String(text ?? "");
  if (lower(info) !== "json" || source.split("\n").length < JSON_TREE_MIN_LINES) return null;
  try {
    const value = JSON.parse(source);
    return value !== null && typeof value === "object" ? { value } : null;
  } catch {
    return null;
  }
}

function createElement(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createToggle(document, className, label, onToggle) {
  const button = createElement(document, "button", ["button", "button-quiet", className].join(" "), label);
  button.type = "button";
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", async () => {
    const next = button.getAttribute("aria-pressed") !== "true";
    if ((await onToggle(next)) !== false) button.setAttribute("aria-pressed", String(next));
  });
  return button;
}

// ---------------------------------------------------------------- JSON tree

// Tree anchors (json-formatter links http(s) string values) open like any
// external post link; anything else loses its href.
export function hardenTreeLinks(root) {
  for (const anchor of Array.from(root?.querySelectorAll?.("a") ?? [])) {
    const href = anchor.getAttribute("href") ?? "";
    if (!SAFE_TREE_URL.test(href)) {
      anchor.removeAttribute("href");
      continue;
    }
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer"); // i18n-ignore
  }
}

function defaultTreeDeps(document) {
  return {
    loadFormatter: () => loadScriptOnce(document, JSON_FORMATTER_SRC, () => globalThis.JSONFormatter),
    loadPurify: () => loadPurify(document),
  };
}

// The toggle sits in the code block's tool row; the tree is built on first
// press, then shown in place of the (still copyable) raw text.
export function createJsonTreeToggle(document, pre, code, value, deps = defaultTreeDeps(document)) {
  let tree = null;
  const build = async () => {
    const [JSONFormatter, purify] = await Promise.all([deps.loadFormatter(), deps.loadPurify()]);
    const formatter = new JSONFormatter(value, 1, {
      hoverPreviewEnabled: false, animateOpen: false, animateClose: false, theme: "",
    });
    const rendered = formatter.render();
    hardenTreeLinks(rendered);
    purifyInPlace(purify, rendered);
    const wrapper = createElement(document, "div", "json-tree");
    wrapper.append(rendered);
    pre.append(wrapper);
    return wrapper;
  };
  return createToggle(document, "json-tree-toggle", t("render.jsonTree"), async (showTree) => {
    if (showTree && !tree) {
      try {
        tree = await build();
      } catch {
        return false;
      }
    }
    if (tree) tree.hidden = !showTree;
    code.hidden = showTree;
    return true;
  });
}

// ---------------------------------------------------------------- ANSI

export function ansiToSafeHtml(AnsiUp, text) {
  const converter = new AnsiUp();
  converter.use_classes = true;
  converter.escape_html = true;
  converter.url_allowlist = {};
  return converter.ansi_to_html(String(text ?? ""));
}

async function renderAnsiBlocks(items, deps) {
  if (!items?.length) return;
  const [AnsiUp, purify] = await Promise.all([deps.loadAnsiUp(), deps.loadPurify()]);
  for (const { code, source } of items) {
    try {
      const fragment = purifyToFragment(purify, ansiToSafeHtml(AnsiUp, source), ANSI_PURIFY_CONFIG);
      moveInlineStyles(fragment);
      code.replaceChildren(fragment);
      code.className = `${code.className} ansi-rendered`.trim();
    } catch {
      // The raw text stays.
    }
  }
}

// ---------------------------------------------------------------- Mermaid

// Sanitises Mermaid's SVG string into a detached fragment, lifts the
// <style> text out (it never connects as markup), and moves inline style
// attributes to CSSOM. Null when no <svg> survives.
export function mermaidSvgParts(purify, svgMarkup) {
  const fragment = purifyToFragment(purify, svgMarkup, SVG_PURIFY_CONFIG);
  const svg = fragment?.querySelector?.("svg") ?? null;
  if (!svg) return null;
  const css = [];
  for (const style of Array.from(svg.querySelectorAll("style"))) {
    css.push(style.textContent ?? "");
    style.remove();
  }
  moveInlineStyles(svg);
  return { svg, css: css.join("\n") };
}

const initialised = new WeakSet();
let diagramCount = 0;

function initMermaid(mermaid, document) {
  if (initialised.has(mermaid)) return;
  initialised.add(mermaid);
  const dark = document?.documentElement?.dataset?.theme === "dark";
  mermaid.initialize({ ...JSON.parse(JSON.stringify(MERMAID_CONFIG)), theme: dark ? "dark" : "default" });
}

function applyDiagramStyles(root, css) {
  try {
    if (!("adoptedStyleSheets" in root) || typeof globalThis.CSSStyleSheet !== "function") return;
    const sheet = new globalThis.CSSStyleSheet();
    sheet.replaceSync(DIAGRAM_BASE_CSS + "\n" + css);
    root.adoptedStyleSheets = [sheet];
  } catch {
    // Unstyled is still legible.
  }
}

const viewBoxWidth = (svg) => Number(String(svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/)[2]) || 0;

async function addPanZoom(document, figure, canvas, svg, deps) {
  if (viewBoxWidth(svg) < MERMAID_PAN_MIN_WIDTH) return;
  const svgPanZoom = await deps.loadPanZoom().catch(() => null);
  if (typeof svgPanZoom !== "function") return;
  canvas.className = `${canvas.className} post-mermaid-pan`;
  const instance = svgPanZoom(svg, { ...PAN_ZOOM_OPTIONS });
  const controls = createElement(document, "div", "post-mermaid-zoom");
  const zoomButton = (label, action) => {
    const button = createElement(document, "button", "button button-quiet", label);
    button.type = "button";
    button.addEventListener("click", () => action());
    return button;
  };
  controls.append(
    zoomButton(t("render.zoomIn"), () => instance.zoomIn()),
    zoomButton(t("render.zoomOut"), () => instance.zoomOut()),
    zoomButton(t("render.zoomReset"), () => instance.reset()),
  );
  figure.append(controls);
}

async function renderDiagram(document, mermaid, purify, { pre, source }, deps) {
  diagramCount += 1;
  const { svg: markup } = await mermaid.render("post-mermaid-" + diagramCount, source);
  const parts = mermaidSvgParts(purify, markup);
  if (!parts || !pre.parentNode) return;
  const figure = createElement(document, "figure", "post-mermaid");
  figure.setAttribute("role", "group");
  figure.setAttribute("aria-label", t("render.diagram"));
  const canvas = createElement(document, "div", "post-mermaid-canvas");
  const root = deps.attachShadow(canvas);
  applyDiagramStyles(root, parts.css);
  root.append(parts.svg);
  const toggle = createToggle(document, "mermaid-source-toggle", t("render.diagramSource"), (showSource) => {
    pre.hidden = !showSource;
  });
  figure.append(canvas, toggle);
  pre.parentNode.insertBefore(figure, pre);
  pre.hidden = true;
  await addPanZoom(document, figure, canvas, parts.svg, deps);
}

async function renderMermaidBlocks(document, items, deps) {
  const eligible = (items ?? []).filter(({ source }) => source.trim() !== "" && source.length <= MERMAID_MAX_CHARS);
  if (!eligible.length) return;
  const [mermaid, purify] = await Promise.all([deps.loadMermaid(), deps.loadPurify()]);
  initMermaid(mermaid, document);
  for (const item of eligible) {
    try {
      await renderDiagram(document, mermaid, purify, item, deps);
    } catch {
      // Unparseable diagram: the source block stays as it was.
    }
  }
}

// ---------------------------------------------------------------- entry

function defaultDeps(document) {
  return {
    loadKatex: undefined,
    loadMermaid: () => loadScriptOnce(document, MERMAID_SRC, () => globalThis.mermaid),
    loadPanZoom: () => loadScriptOnce(document, SVG_PAN_ZOOM_SRC, () => globalThis.svgPanZoom),
    loadAnsiUp: () => importModuleOnce(document, ANSI_UP_SRC).then((module) => module.AnsiUp),
    loadPurify: () => loadPurify(document),
    attachShadow: (host) => (typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host),
  };
}

async function renderMath(document, items, deps) {
  const options = deps.loadKatex ? { loadKatex: deps.loadKatex } : undefined;
  const rendered = await typesetMath(document, items, options);
  if (!rendered.length) return;
  const purify = await deps.loadPurify();
  for (const node of rendered) purifyInPlace(purify, node);
}

// work: { math: [{node, tex, display}], mermaid: [{pre, source}],
// ansi: [{code, source}] }. Every loader starts synchronously (before the
// first await) so the requests go out together; failures stay plain.
export function enhanceRenderedBody(document, work, deps = {}) {
  const resolved = { ...defaultDeps(document), ...deps };
  const tasks = [];
  if (work?.math?.length) tasks.push(renderMath(document, work.math, resolved));
  if (work?.mermaid?.length) tasks.push(renderMermaidBlocks(document, work.mermaid, resolved));
  if (work?.ansi?.length) tasks.push(renderAnsiBlocks(work.ansi, resolved));
  return Promise.allSettled(tasks);
}
