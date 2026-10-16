// Markdown rendering (v2.5): a small, deliberate subset — bold, italics,
// inline code, fenced code blocks, headings, bullet lists, blockquotes (the
// pre-existing "> " convention), and LINKS. HTML is never interpreted (every
// character lands via textContent — "<b>" renders literally, a restriction
// the owner asked for), external images/embeds are never rendered ("![…](…)"
// stays literal text), and link URLs must pass a scheme check before they
// ever reach an href. No dependencies: the parser is plain string walking.
const SAFE_PREFIXES = ["http://", "https://", "/"];

// A link target is safe only when it starts with a known-safe scheme or is a
// same-origin absolute path. "javascript:", "data:", "vbscript:", malformed
// URLs and any other scheme are refused by the caller (literal text instead).
export function isSafeLinkUrl(raw) {
  const value = String(raw ?? "").trim();
  if (value === "") return false;
  const lower = value.toLowerCase();
  for (const prefix of SAFE_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

// Inline scan of ONE text run: `code`, **bold**, *italic*, [text](url).
// Markers are CONSUMED or REFUSED:
// - consumed → the pre-marker text run emits, then the element; start walks
//   past the close.
// - refused (unterminated marker, refused image, unsafe/malformed link) →
//   NO run emits; start stays, and the scan walks past the marker so its
//   span rides the final text run exactly once.
export function parseInline(document, text) {
  const value = String(text ?? "");
  const nodes = [];
  let start = 0;
  let index = 0;
  while (index < value.length) {
    const codeOpen = value.indexOf("`", index);
    const boldOpen = value.indexOf("**", index);
    const linkOpen = value.indexOf("[", index);
    const emOpen = nextItalicOpen(value, index);
    const next = pickFirst([codeOpen, boldOpen, emOpen, linkOpen]);
    if (next === -1 || next >= value.length) break;
    const emitPre = () => {
      if (next > start) nodes.push(makeText(document, value.slice(start, next)));
    };

    if (next === codeOpen) {
      const close = value.indexOf("`", next + 1);
      if (close === -1 || close === next + 1) {
        emitPre();
        start = next;
        index = next + 1;
        continue;
      }
      emitPre();
      nodes.push(makeInline(document, "code", value.slice(next + 1, close)));
      start = index = close + 1;
      continue;
    }
    if (next === boldOpen) {
      const close = value.indexOf("**", next + 2);
      if (close === -1 || close === next + 2) {
        emitPre();
        start = next;
        index = next + 2;
        continue;
      }
      emitPre();
      nodes.push(makeInline(document, "strong", value.slice(next + 2, close)));
      start = index = close + 2;
      continue;
    }
    if (next === emOpen) {
      const close = value.indexOf("*", next + 1);
      const emBody = close === -1 ? "" : value.slice(next + 1, close);
      if (close === -1 || emBody.length === 0 || emBody.startsWith("*") || emBody.endsWith("*")) {
        emitPre();
        start = next;
        index = next + 1;
        continue;
      }
      emitPre();
      nodes.push(makeInline(document, "em", emBody));
      start = index = close + 1;
      continue;
    }
    // linkOpen: [text](url) — images ("![") are always refused.
    const isImage = next > 0 && value[next - 1] === "!";
    const closeBracket = value.indexOf("]", next + 1);
    const parenOpen = closeBracket === -1 ? -1 : value.indexOf("(", closeBracket + 1);
    const parenClose = value.indexOf(")", closeBracket === -1 ? -1 : closeBracket + 1);
    const wellFormed = closeBracket !== -1 && parenOpen === closeBracket + 1 && parenClose !== -1;
    const label = wellFormed ? value.slice(next + 1, closeBracket) : null;
    const url = wellFormed ? value.slice(parenOpen + 1, parenClose) : null;
    if (isImage || !wellFormed || label === "" || !isSafeLinkUrl(url)) {
      // Refused: no pre-text run; the bracket and URL stay literal.
      index = next + 1;
      continue;
    }
    emitPre();
    const anchor = document.createElement("a");
    anchor.textContent = label;
    anchor.href = url.trim();
    if (url.startsWith("/")) {
      anchor.setAttribute("rel", "internal");
    } else {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
    nodes.push(anchor);
    start = index = parenClose + 1;
  }
  if (start < value.length) nodes.push(makeText(document, value.slice(start)));
  return nodes;
}

// An italic opener is a "*" not doubled and not followed by whitespace.
function nextItalicOpen(value, from) {
  let at = value.indexOf("*", from);
  while (at !== -1) {
    if (value[at + 1] !== undefined && value[at + 1] !== " " && value.slice(at, at + 2) !== "**") {
      return at;
    }
    at = value.indexOf("*", at + 1);
  }
  return -1;
}

function pickFirst(indices) {
  let best = -1;
  for (const at of indices) {
    if (at !== -1 && (best === -1 || at < best)) best = at;
  }
  return best;
}

function makeText(document, text) {
  return document.createTextNode(text);
}

function makeInline(document, tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

// Block shape of a body: fenced code (```…```), "# " headings (1–3 hashes —
// the post page's own h1/h2 hierarchy is not for post bodies), "- " lists,
// and quote/paragraph runs (the pre-existing convention). Blocks keep their
// RAW text (inline rendering happens at build time).
export function parseBlocks(body) {
  const lines = String(body ?? "").split("\n");
  const blocks = [];
  let fence = null;
  let list = null;
  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMark = trimmed.startsWith("```");
    if (fence !== null) {
      if (fenceMark) {
        blocks.push(fence);
        fence = null;
      } else {
        fence.text.push(line);
      }
      continue;
    }
    if (fenceMark) {
      flushList(blocks, () => list);
      list = null;
      fence = { kind: "code", text: [] };
      continue;
    }
    const heading = /^#{1,3} /.exec(trimmed);
    if (heading) {
      flushList(blocks, () => list);
      list = null;
      // Level = the HASH count (the match includes the separating space).
      blocks.push({ kind: "heading", text: [trimmed.slice(heading[0].length)], level: heading[0].length - 1 });
      continue;
    }
    if (trimmed.startsWith("- ")) {
      if (!list) list = { kind: "list", text: [] };
      list.text.push(trimmed.slice(2));
      continue;
    }
    flushList(blocks, () => list);
    list = null;
    const isQuote = trimmed.startsWith("> ");
    const content = isQuote ? trimmed.slice(2) : line;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === (isQuote ? "quote" : "paragraph")) {
      last.text.push(content);
    } else {
      blocks.push({ kind: isQuote ? "quote" : "paragraph", text: [content] });
    }
  }
  flushList(blocks, () => list);
  if (fence) blocks.push(fence);
  return blocks;
}

function flushList(blocks, getList) {
  const list = getList();
  if (list && list.text.length) blocks.push(list);
}