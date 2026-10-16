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
  assert.equal(MAX_COMPOSER_FILE_BYTES, 1024 * 1024);
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

test("a file over 1 MiB is refused client-side with a message, never sent", () => {
  const oversized = makeFile("big.png", MAX_COMPOSER_FILE_BYTES + 1);
  const result = addComposerFiles([], [oversized]);
  assert.equal(result.files.length, 0);
  assert.equal(result.notices.length, 1);
  assert.match(result.notices[0], /1 MiB/);
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
  assert.equal(result.notices.filter((notice) => /1 MiB/.test(notice)).length, 1);
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
