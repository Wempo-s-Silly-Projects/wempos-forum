// Pure, DOM-free helpers for the quote affordance (plan v2.3 Task 3). Safe to
// import under node --test: no document access, and the only element the
// prefill helper touches is the single textarea the caller passes in.

// Composer prefill is VALUE-only (plan Review Focus 3): the quote line is
// assigned to the textarea's .value property, so user content can never be
// parsed as HTML by the page and never enters an element's markup.

export const QUOTE_SNIPPET_LIMIT = 120;

// Collapses every run of whitespace (newlines and tabs included) to single
// spaces and trims the ends, so raw post text renders single-line. Used by
// render.js for preview snippets too — snippets arrive as raw body text.
export const collapseWhitespace = (text) =>
  String(text ?? "").replace(/\s+/g, " ").trim();

// Same truncation shape the backend's replySnippet uses (api/posts.mjs):
// over the limit → first `limit` characters plus an ellipsis.
const truncate = (text, limit) =>
  text.length > limit ? text.slice(0, limit) + "…" : text;

// One prefill line: "> @<username>: <≤120-char single-line snippet>\n".
export const quoteLine = (username, body) =>
  `> @${collapseWhitespace(username)}: ` +
  `${truncate(collapseWhitespace(body), QUOTE_SNIPPET_LIMIT)}\n`;

// Prepends the quote line to whatever the composer already holds and focuses
// the textarea. Assignment through .value only — never innerHTML, never
// markup. Returns the new value (handy for tests).
export function prefillQuote(textarea, username, body) {
  const existing = typeof textarea.value === "string" ? textarea.value : "";
  textarea.value = quoteLine(username, body) + existing;
  textarea.focus();
  return textarea.value;
}