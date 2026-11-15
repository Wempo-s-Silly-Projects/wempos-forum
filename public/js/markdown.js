
// Markdown rendering (v2.5): a small, deliberate subset — bold, italics,
// inline code, fenced code blocks, headings, bullet lists, blockquotes (the
// pre-existing "> " convention), and LINKS. HTML is never interpreted (every
// character lands via textContent — "<b>" renders literally, a restriction
// the owner asked for), external images/embeds are never rendered ("![…](…)"
// stays literal text), and link URLs must pass a scheme check before they
// ever reach an href. No dependencies: the parser is plain string walking.
//
// Supported inline syntax is intentionally non-recursive: formatting inside
// another formatting element is treated as text.
//
// Supported links: [label](https://example.com) and [label](/relative/path).
// Nested brackets and parentheses in link syntax are not supported.

const MENTION_PATTERN = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]+)/g;

// A link target is safe only when it starts with a known-safe scheme or is a
// same-origin absolute path. "javascript:", "data:", "vbscript:", malformed
// URLs and any other scheme are refused (literal text instead).
export function isSafeLinkUrl(raw) {
  const value = String(raw ?? "").trim();

  if (
    value === "" ||
    /[\t\n\r\\\x00-\x1f\x7f]/.test(value) ||
    value.startsWith("//")
  ) {
    return false;
  }

  // Same-origin absolute paths.
  if (value.startsWith("/")) return true;

  // Absolute HTTP(S) URLs must be valid and have a hostname.
  try {
    const parsed = new URL(value);

    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

// The next mention token at or after `from`; -1 when there is none.
function nextMentionOpen(value, from) {
  MENTION_PATTERN.lastIndex = from;

  const match = MENTION_PATTERN.exec(value);

  if (!match) return -1;

  return match.index + match[0].length - match[1].length - 1;
}

// The handle that starts at an "@" position (after the "@").
function mentionHandleAt(value, at) {
  const match = /^@([a-zA-Z0-9_]+)/.exec(value.slice(at));
  return match ? match[1] : null;
}

// An italic opener is a "*" that is not doubled and is not followed
// by whitespace.
function nextItalicOpen(value, from) {
  let at = value.indexOf("*", from);

  while (at !== -1) {
    if (
      value[at + 1] !== undefined &&
      value[at + 1] !== " " &&
      value.slice(at, at + 2) !== "**"
    ) {
      return at;
    }

    at = value.indexOf("*", at + 1);
  }

  return -1;
}

function pickFirst(indices) {
  let best = -1;

  for (const at of indices) {
    if (at !== -1 && (best === -1 || at < best)) {
      best = at;
    }
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

export function parseInline(document, text) {
  const value = String(text ?? "");
  const nodes = [];

  let start = 0;
  let index = 0;

  while (index < value.length) {
    const codeOpen = value.indexOf("`", index);
    const boldOpen = value.indexOf("**", index);
    const strikeOpen = value.indexOf("~~", index);
    const linkOpen = value.indexOf("[", index);
    const emOpen = nextItalicOpen(value, index);
    const mentionOpen = nextMentionOpen(value, index);

    const next = pickFirst([
      codeOpen,
      boldOpen,
      strikeOpen,
      emOpen,
      linkOpen,
      mentionOpen,
    ]);

    if (next === -1 || next >= value.length) break;

    const emitPre = () => {
      if (next > start) {
        nodes.push(makeText(document, value.slice(start, next)));
      }
    };

    // Inline code.
    if (next === codeOpen) {
      const close = value.indexOf("`", next + 1);

      if (close === -1 || close === next + 1) {
        emitPre();
        start = next;
        index = next + 1;
        continue;
      }

      emitPre();

      nodes.push(
        makeInline(document, "code", value.slice(next + 1, close)),
      );

      start = index = close + 1;
      continue;
    }

    // Bold.
    if (next === boldOpen) {
      const close = value.indexOf("**", next + 2);

      if (close === -1 || close === next + 2) {
        emitPre();
        start = next;
        index = next + 2;
        continue;
      }

      emitPre();

      nodes.push(
        makeInline(document, "strong", value.slice(next + 2, close)),
      );

      start = index = close + 2;
      continue;
    }

    // Strikethrough.
    if (next === strikeOpen) {
      const close = value.indexOf("~~", next + 2);

      if (close === -1 || close === next + 2) {
        emitPre();
        start = next;
        index = next + 2;
        continue;
      }

      emitPre();

      nodes.push(
        makeInline(document, "del", value.slice(next + 2, close)),
      );

      start = index = close + 2;
      continue;
    }

    // Italics.
    if (next === emOpen) {
      const close = value.indexOf("*", next + 1);
      const emBody = close === -1
        ? ""
        : value.slice(next + 1, close);

      if (
        close === -1 ||
        emBody.length === 0 ||
        emBody.startsWith("*") ||
        emBody.endsWith("*")
      ) {
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

    // Mention token: "@handle" becomes a same-origin profile link.
    const handle = mentionHandleAt(value, next);

    if (handle) {
      emitPre();

      const anchor = document.createElement("a");
      anchor.textContent = "@" + handle;
      anchor.href = "/users/" + handle;
      anchor.setAttribute("class", "mention");

      nodes.push(anchor);

      start = index = next + 1 + handle.length;
      continue;
    }

    // Link: [text](url).
    // Images ("![") are always refused.
    const isImage = next > 0 && value[next - 1] === "!";

    const closeBracket = value.indexOf("]", next + 1);
    const parenOpen = closeBracket === -1
      ? -1
      : value.indexOf("(", closeBracket + 1);

    const parenClose = value.indexOf(
      ")",
      closeBracket === -1 ? -1 : closeBracket + 1,
    );

    const wellFormed =
      closeBracket !== -1 &&
      parenOpen === closeBracket + 1 &&
      parenClose !== -1;

    const label = wellFormed
      ? value.slice(next + 1, closeBracket)
      : null;

    const url = wellFormed
      ? value.slice(parenOpen + 1, parenClose)
      : null;

    if (
      isImage ||
      !wellFormed ||
      label === "" ||
      !isSafeLinkUrl(url)
    ) {
      // Refused constructs remain literal text.
      // Preserve the original text by leaving `start` unchanged.
      if (wellFormed) {
        index = parenClose + 1;
      } else {
        index = next + 1;
      }

      continue;
    }

    emitPre();

    const anchor = document.createElement("a");
    anchor.textContent = label;
    anchor.href = url.trim();

    if (url.trim().startsWith("/")) {
      // Internal links use the SPA router.
      anchor.setAttribute("rel", "internal");
    } else {
      // External links open separately without granting access to the opener.
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }

    nodes.push(anchor);

    start = index = parenClose + 1;
  }

  if (start < value.length) {
    nodes.push(makeText(document, value.slice(start)));
  }

  return nodes;
}

// Block shape of a body:
// - Fenced code blocks: ```…```
// - Headings: "# " through "###### "
// - Bullet lists: "- "
// - Blockquotes: "> "
// - Paragraphs
//
// Blank lines separate blocks. Code blocks retain raw text, and inline
// rendering happens separately when the blocks are rendered.
export function parseBlocks(body) {
  const lines = String(body ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");

  const blocks = [];

  let fence = null;
  let list = null;
  let previousLineWasBlank = true;

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMark = trimmed.startsWith("```");

    // Inside a fenced code block, preserve all lines literally.
    if (fence !== null) {
      if (fenceMark) {
        blocks.push(fence);
        fence = null;
      } else {
        fence.text.push(line);
      }

      continue;
    }

    // A blank line ends the current list and separates paragraph/quote runs.
    if (trimmed === "") {
      flushList(blocks, list);
      list = null;
      previousLineWasBlank = true;
      continue;
    }

    // Start a fenced code block.
    if (fenceMark) {
      flushList(blocks, list);
      list = null;

      fence = {
        kind: "code",
        text: [],
      };

      previousLineWasBlank = false;
      continue;
    }

    // Headings: levels 1 through 6.
    const heading = /^#{1,6} /.exec(trimmed);

    if (heading) {
      flushList(blocks, list);
      list = null;

      blocks.push({
        kind: "heading",
        text: [trimmed.slice(heading[0].length)],
        level: heading[0].length - 1,
      });

      previousLineWasBlank = false;
      continue;
    }

    // Unordered bullet lists.
    if (trimmed.startsWith("- ")) {
      if (!list) {
        list = {
          kind: "list",
          text: [],
        };
      }

      list.text.push(trimmed.slice(2));
      previousLineWasBlank = false;
      continue;
    }

    // Any non-list block ends the current list.
    flushList(blocks, list);
    list = null;

    // Blockquotes use the pre-existing "> " convention.
    const isQuote = trimmed.startsWith("> ");
    const content = isQuote ? trimmed.slice(2) : line;
    const kind = isQuote ? "quote" : "paragraph";

    const last = blocks[blocks.length - 1];

    // Consecutive lines of the same block type are grouped together,
    // but blank lines always start a new block.
    if (
      !previousLineWasBlank &&
      last &&
      last.kind === kind
    ) {
      last.text.push(content);
    } else {
      blocks.push({
        kind,
        text: [content],
      });
    }

    previousLineWasBlank = false;
  }

  flushList(blocks, list);

  // An unfinished fence is still rendered as a code block.
  if (fence) {
    blocks.push(fence);
  }

  return blocks;
}

function flushList(blocks, list) {
  if (list && list.text.length) {
    blocks.push(list);
  }
}
