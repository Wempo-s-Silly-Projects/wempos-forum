// Pure helper tests for the frontend glue modules. All four modules are
// DOM-free at import time and in these helpers, so node --test can load
// them without a browser:
// - profile-editor.js buildSocialLinks() / invalidSocialKeys()
// - notifications.js notificationItemView()
// - banned.js formatBanCountdown()
// - attachments.js addComposerFiles() / buildComposerBody() (Node 22 ships
//   File and FormData globals, so submission payloads are checkable here too)
import test from "node:test";
import assert from "node:assert/strict";
import { buildSocialLinks, invalidSocialKeys, SOCIAL_LABELS } from "../public/js/profile-editor.js";
import { resolveTheme } from "../public/js/theme.js";
import { notificationItemView } from "../public/js/notifications.js";
import { formatBanCountdown } from "../public/js/banned.js";

test("linked platforms build profile URLs from handles", () => {
  const links = buildSocialLinks({
    youtube: "wempo", x: "wempo", reddit: "wempo", github: "wempo",
    gitlab: "wempo", instagram: "wempo", tiktok: "wempo", twitch: "wempo",
  });
  const urls = Object.fromEntries(links.map((link) => [link.key, link.url]));
  assert.equal(urls.youtube, "https://www.youtube.com/@wempo");
  assert.equal(urls.x, "https://x.com/wempo");
  assert.equal(urls.reddit, "https://www.reddit.com/user/wempo");
  assert.equal(urls.github, "https://github.com/wempo");
  assert.equal(urls.gitlab, "https://gitlab.com/wempo");
  assert.equal(urls.instagram, "https://www.instagram.com/wempo");
  assert.equal(urls.tiktok, "https://www.tiktok.com/@wempo");
  assert.equal(urls.twitch, "https://www.twitch.tv/wempo");
});

test("discord and polytoria render as plain text without URLs", () => {
  const links = buildSocialLinks({ discord: "wempo#1234", polytoria: "Wempo" });
  const byKey = Object.fromEntries(links.map((link) => [link.key, link]));
  assert.equal(byKey.discord.url, undefined);
  assert.equal(byKey.discord.text, "wempo#1234");
  assert.equal(byKey.polytoria.url, undefined);
  assert.equal(byKey.polytoria.text, "Wempo");
});

test("handles are URL-escaped with encodeURIComponent, symbol prefixes included", () => {
  const links = buildSocialLinks({ youtube: "@wempo 1" });
  assert.equal(links.length, 1);
  // "@" becomes %40 and the space becomes %20 — never placed raw in href.
  assert.equal(links[0].url, "https://www.youtube.com/@%40wempo%201");
  assert.equal(links[0].text, "@wempo 1");
  const discord = buildSocialLinks({ discord: "#tag/ged" });
  assert.equal(discord[0].url, undefined);
  assert.equal(discord[0].text, "#tag/ged");
});

test("sparse maps skip unset platforms and polytoriaUsername is a fallback", () => {
  assert.deepEqual(buildSocialLinks({}, null), []);
  const fallback = buildSocialLinks({ github: "wempo" }, "PolyUser");
  assert.equal(fallback.length, 2);
  const polytoria = fallback.find((link) => link.key === "polytoria");
  assert.equal(polytoria.text, "PolyUser");
  assert.equal(polytoria.url, undefined);
  // A socials.polytoria entry wins over the separate field.
  const explicit = buildSocialLinks(
    { polytoria: "Handle" }, "Ignored",
  );
  assert.equal(explicit[0].text, "Handle");
});

test("every platform key has a human label", () => {
  for (const key of ["youtube", "x", "reddit", "github", "discord", "gitlab",
    "instagram", "tiktok", "twitch", "polytoria"]) {
    assert.equal(typeof SOCIAL_LABELS[key], "string");
    assert.ok(SOCIAL_LABELS[key].length > 0);
  }
});

test("invalidSocialKeys mirrors the server per-platform patterns", () => {
  assert.deepEqual(invalidSocialKeys({ youtube: "ok.name-1_x" }), []);
  assert.deepEqual(invalidSocialKeys({ youtube: "@bad!" }), ["youtube"]);
  // x allows at most 15 characters.
  assert.deepEqual(invalidSocialKeys({ x: "abcdefghijklmno" }), []);
  assert.deepEqual(invalidSocialKeys({ x: "abcdefghijklmnop" }), ["x"]);
  assert.deepEqual(invalidSocialKeys({ polytoria: "Wempo_1" }), []);
  assert.deepEqual(invalidSocialKeys({ polytoria: "no spaces here" }), ["polytoria"]);
  assert.deepEqual(invalidSocialKeys({ unknownPlatform: "value" }), ["unknownPlatform"]);
});

test("empty and null social values are treated as clears, not errors", () => {
  assert.deepEqual(invalidSocialKeys({ youtube: "", discord: null }), []);
});

test("notificationItemView shapes a list entry", () => {
  const view = notificationItemView({
    id: 7, targetPostId: 42, replyId: 99, createdAt: "2026-10-15T00:00:00.000Z",
    read: false, postPreview: "hello there",
  });
  assert.equal(view.id, 7);
  assert.equal(view.targetPostId, 42);
  assert.equal(view.read, false);
  assert.equal(view.href, "/posts/42");
  assert.equal(view.label, "New reply on your post: hello there");
});

test("notificationItemView phrases generically without a preview", () => {
  const view = notificationItemView({ id: 8, targetPostId: 3, read: true, postPreview: "" });
  assert.equal(view.label, "New reply on your post");
  assert.equal(view.read, true);
  assert.equal(view.href, "/posts/3");
});

test("a missing preview field still produces a safe label", () => {
  const view = notificationItemView({ id: 9, targetPostId: 5, read: true });
  assert.equal(view.label, "New reply on your post");
});

test("formatBanCountdown renders days, hours, then minutes", () => {
  const now = 1000;
  const delta = 3 * 24 * 60 * 60 + 2 * 60 * 60 + 14 * 60;
  assert.equal(formatBanCountdown(now + delta, now), "3d 2h 14m");
});

test("formatBanCountdown drops leading zero units", () => {
  const now = 1000;
  assert.equal(formatBanCountdown(now + 45 * 60, now), "45m");
  assert.equal(formatBanCountdown(now + 2 * 60 * 60, now), "2h 0m");
});

test("formatBanCountdown has no time for permanent bans", () => {
  assert.equal(formatBanCountdown(null, 1000), null);
  assert.equal(formatBanCountdown(undefined, 1000), null);
});

test("formatBanCountdown clamps past expiry to zero minutes", () => {
  assert.equal(formatBanCountdown(1000 - 5, 1000), "0m");
});
// --- Task 7: composer attachment intake and submission -----------------------
// DOM-free like the helpers above: Node 22 ships File/FormData globals, so the
// submission helper can be exercised at the same payload boundary app.js posts
// through api() (which passes FormData straight to fetch and JSON otherwise).

import {
  COMPOSER_ACCEPT,
  MAX_COMPOSER_FILES,
  MAX_COMPOSER_FILE_BYTES,
  addComposerFiles,
  buildComposerBody,
} from "../public/js/attachments.js";

const makeFile = (name, size, type = "image/png") =>
  new File([new Uint8Array(size)], name, { type });

test("the composer accept list covers exactly the mime types the server sniffs", () => {
  assert.equal(COMPOSER_ACCEPT, "image/jpeg,image/png,image/webp,image/gif");
  assert.equal(MAX_COMPOSER_FILES, 3);
  assert.equal(MAX_COMPOSER_FILE_BYTES, 10 * 1024 * 1024);
});

test("two chosen files switch create-post submission to FormData with an images part per file", () => {
  const first = makeFile("first.png", 120);
  const second = makeFile("second.jpg", 80, "image/jpeg");
  const submission = buildComposerBody({
    body: "hello",
    turnstileToken: "tok-1",
    files: [first, second],
  });
  assert.equal(submission.multipart, true);
  const form = submission.body;
  assert.ok(form instanceof FormData);
  assert.deepEqual(form.getAll("images"), [first, second]);
  assert.equal(form.get("body"), "hello");
  assert.equal(form.get("cf-turnstile-response"), "tok-1");
});

test("zero chosen files keeps the pre-attachment JSON payload byte-identical", () => {
  for (const files of [[], undefined]) {
    const submission = buildComposerBody({ body: "hello", turnstileToken: "tok-1", files });
    assert.equal(submission.multipart, false);
    assert.deepEqual(submission.body, { body: "hello", "cf-turnstile-response": "tok-1" });
    // Same wire bytes the old call sites produced via JSON.stringify.
    assert.equal(
      JSON.stringify(submission.body),
      JSON.stringify({ body: "hello", "cf-turnstile-response": "tok-1" }),
    );
  }
});

test("a file over 10 MiB is refused client-side with a message, never sent", () => {
  const oversized = makeFile("big.png", MAX_COMPOSER_FILE_BYTES + 1);
  const result = addComposerFiles([], [oversized]);
  assert.equal(result.files.length, 0);
  assert.equal(result.notices.length, 1);
  assert.match(result.notices[0], /10 MiB/);
  assert.match(result.notices[0], /big\.png/);
});

test("the 4th chosen file is blocked client-side with a clear message", () => {
  const current = [
    makeFile("a.png", 10), makeFile("b.png", 10), makeFile("c.png", 10),
  ];
  const result = addComposerFiles(current, [makeFile("four.png", 10)]);
  assert.equal(result.files.length, 3);
  assert.equal(result.files.every((f) => f !== undefined), true);
  assert.equal(result.notices.length, 1);
  assert.match(result.notices[0], /3/);
});

test("a mixed selection keeps the acceptable files and reports the rest", () => {
  // Starting from 1 chosen file there is room for 2 more, so the first two
  // acceptable picks land and only the leftovers draw cap notices; the
  // oversized file is refused before it can eat a slot.
  const result = addComposerFiles(
    [makeFile("a.png", 10)],
    [makeFile("big.png", MAX_COMPOSER_FILE_BYTES + 1), makeFile("good.png", 10),
      makeFile("good-too.png", 10), makeFile("blocked.png", 10), makeFile("blocked-too.png", 10)],
  );
  assert.deepEqual(result.files.map((f) => f.name), ["a.png", "good.png", "good-too.png"]);
  assert.equal(result.notices.length, 3);
  // One over-cap notice per file the cap refused, never a silent truncation.
  assert.equal(result.notices.filter((notice) => /3 images/.test(notice)).length, 2);
  assert.equal(result.notices.filter((notice) => /10 MiB/.test(notice)).length, 1);
});

// --- Task 8: theme resolution ------------------------------------------------
// resolveTheme is pure and DOM-free: a manually stored "dark"/"light" choice
// always wins; anything else (null, empty, garbage) defers to the OS setting.

test("a stored manual choice beats the OS preference, both directions", () => {
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
});

test("a null preference follows the OS setting", () => {
  assert.equal(resolveTheme(null, true), "dark");
  assert.equal(resolveTheme(null, false), "light");
});

test("garbage and empty preferences are ignored in favor of the OS setting", () => {
  assert.equal(resolveTheme("bogus", true), "dark");
  assert.equal(resolveTheme("", false), "light");
});

// --- Task 3 (v2.3): quote prefill utilities (public/js/quotes.js) -------------
// DOM-free like the helpers above; prefillQuote only touches the textarea the
// caller passes, and the quote text reaches the composer through the .value
// property — never HTML — so user content cannot be parsed as markup.

import {
  QUOTE_SNIPPET_LIMIT,
  collapseWhitespace,
  quoteLine,
  prefillQuote,
} from "../public/js/quotes.js";

const mockTextarea = () => {
  const area = { value: "", focus: undefined };
  area.focus = () => { area.focused = true; };
  area.focused = false;
  return area;
};

test("the quote snippet limit is pinned at 120 characters", () => {
  assert.equal(QUOTE_SNIPPET_LIMIT, 120);
});

test("collapseWhitespace single-lines raw post text including newlines", () => {
  assert.equal(collapseWhitespace("hey\nthere\tmany   spaces\n"), "hey there many spaces");
  assert.equal(collapseWhitespace("\n\n  \n"), "");
  assert.equal(collapseWhitespace(undefined), "");
});

test("a quote click prefills an empty composer with '> @user: snippet\\n' and focuses it", () => {
  const textarea = mockTextarea();
  prefillQuote(textarea, "bob", "Look at this");
  assert.equal(textarea.value, "> @bob: Look at this\n");
  assert.equal(textarea.focused, true, "the composer textarea is focused");
});

test("the quote line is prepended BEFORE any existing composer value", () => {
  const textarea = mockTextarea();
  textarea.value = "my draft";
  prefillQuote(textarea, "bob", "hi");
  assert.equal(textarea.value, "> @bob: hi\nmy draft");
});

test("the quote snippet truncates at the 120-char variant with an ellipsis", () => {
  const line = quoteLine("bob", "y".repeat(300));
  assert.ok(line.startsWith("> @bob: " + "y".repeat(120) + "…\n"));
  // Same truncation shape the backend snippets use (>limit → slice + "…").
  const snippet = line.slice(8, line.length - 1);
  assert.equal(snippet.length, 121);
});

test("quotable text is always single-line even with embedded newlines", () => {
  const line = quoteLine("bob", "line one\nline two\n\tline three");
  assert.equal(line, "> @bob: line one line two line three\n");
});

test("quote prefill inserts as a VALUE only, never HTML-parsed user content", () => {
  const hostile = '<img src=x onerror="alert(1)">\n<script>boom</script>';
  const textarea = mockTextarea();
  prefillQuote(textarea, "<u>evil</u>", hostile);
  // The value string is the literal text byte-for-byte; nothing was parsed,
  // re-encoded, or wrapped in markup by the prefill path.
  assert.equal(
    textarea.value,
    "> @<u>evil</u>: <img src=x onerror=\"alert(1)\"> <script>boom</script>\n",
  );
  assert.equal(typeof textarea.value, "string");
});

// --- Task (v2.4): composer body limit + live counter --------------------------
// composer-limits.js is DOM-free (pure label math + the shared cap constant);
// the counter WIRING lives in forms.js's createTextarea, exercised here with
// the same tiny mock-element style the render suite uses.

import { charsLeftLabel, COMPOSER_MAX_CHARS } from "../public/js/composer-limits.js";
import { createTextarea } from "../public/js/forms.js";

test("the composer cap is pinned at 1,000 characters", () => {
  assert.equal(COMPOSER_MAX_CHARS, 1000);
});

test("charsLeftLabel counts down from the cap, grouping 1,000 for legibility", () => {
  assert.equal(charsLeftLabel(1000, ""), "1,000 chars left");
  assert.equal(charsLeftLabel(1000, "hello"), "995 chars left");
  assert.equal(charsLeftLabel(1000, "x".repeat(1000)), "0 chars left");
});

test("charsLeftLabel clamps over-limit values to zero chars left", () => {
  assert.equal(charsLeftLabel(1000, "x".repeat(1005)), "0 chars left");
  assert.equal(charsLeftLabel(1000, "x".repeat(2000)), "0 chars left");
});

test("charsLeftLabel treats null/undefined values as empty", () => {
  assert.equal(charsLeftLabel(1000, null), "1,000 chars left");
  assert.equal(charsLeftLabel(1000, undefined), "1,000 chars left");
});

// createTextarea mock: the textarea must expose addEventListener so the glue
// test can capture the input handler and dispatch it (no real DOM needed).
const counterMockDocument = () => {
  const makeElement = (tagName) => ({
    tagName: tagName.toUpperCase(),
    children: [],
    className: "",
    textContent: "",
    dataset: {},
    attributes: {},
    maxLength: undefined,
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return name in this.attributes ? this.attributes[name] : null;
    },
    addEventListener(type, handler) {
      (this.listeners[type] ??= []).push(handler);
    },
    dispatchInput() {
      for (const handler of this.listeners.input ?? []) handler({ target: this });
    },
    append(...nodes) {
      for (const node of nodes) this.children.push(node);
    },
  });
  return { createElement: (tagName) => makeElement(tagName) };
};

function* walkTree(node) {
  yield node;
  for (const child of node.children || []) yield* walkTree(child);
}

test("a composer textarea gets maxLength 1000 and a live, polite counter", () => {
  const document = counterMockDocument();
  const wrapper = createTextarea(document, {
    id: "post-create-new-body", label: "Body", rows: 4,
    maxLength: COMPOSER_MAX_CHARS, required: true, counter: true,
  });
  const textarea = [...walkTree(wrapper)].find((node) => node.tagName === "TEXTAREA");
  const counter = [...walkTree(wrapper)].find((node) => node.className === "char-counter");

  // Client-side truncation mirrors the server cap — textarea.maxLength 1000
  // serializes as the maxLength="1000" attribute.
  assert.equal(textarea.maxLength, 1000);
  assert.ok(counter, "the counter element exists");
  assert.equal(counter.getAttribute("aria-live"), "polite");
  assert.equal(counter.dataset.charCounter, "post-create-new-body");
  // Counter is initialized visible (empty composer) and mutes via CSS class.
  assert.equal(counter.textContent, "1,000 chars left");
});

test("the counter updates on the textarea's input event", () => {
  const document = counterMockDocument();
  const wrapper = createTextarea(document, {
    id: "reply-42-body", label: "Reply", maxLength: 1000, counter: true,
  });
  const textarea = [...walkTree(wrapper)].find((node) => node.tagName === "TEXTAREA");
  const counter = [...walkTree(wrapper)].find((node) => node.className === "char-counter");

  textarea.value = "hello";
  textarea.dispatchInput();
  assert.equal(counter.textContent, "995 chars left");
  textarea.value = "x".repeat(1000);
  textarea.dispatchInput();
  assert.equal(counter.textContent, "0 chars left");
  textarea.value = "";
  textarea.dispatchInput();
  assert.equal(counter.textContent, "1,000 chars left");
});

test("a textarea without the counter option stays counter-free (bio keeps its 10k cap)", () => {
  const document = counterMockDocument();
  const wrapper = createTextarea(document, {
    id: "profile-bio", label: "Bio", maxLength: 10000,
  });
  const counters = [...walkTree(wrapper)].filter((node) => node.className === "char-counter");
  assert.equal(counters.length, 0);
  const textarea = [...walkTree(wrapper)].find((node) => node.tagName === "TEXTAREA");
  assert.equal(textarea.maxLength, 10000);
});
