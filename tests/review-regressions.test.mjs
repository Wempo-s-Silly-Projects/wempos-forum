import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("named Wrangler Preview uses isolated D1, rate limits, and static assets", async () => {
  const wrangler = await read("wrangler.toml");
  assert.match(wrangler, /\[\[env\.preview\.d1_databases\]\][\s\S]*?database_name = "wempo-forum-preview"/);
  assert.match(wrangler, /\[\[env\.preview\.ratelimits\]\]/);
  assert.match(wrangler, /\[env\.preview\.assets\][\s\S]*?binding = "ASSETS"/);
  assert.match(wrangler, /\[\[previews\.d1_databases\]\][\s\S]*?database_name = "wempo-forum-preview"/);
  assert.doesNotMatch(wrangler.slice(wrangler.indexOf("[env.preview.vars]")), /database_name = "wempo-forum-data"/);
});

test("clearing profile CSS preserves the NOT NULL approved_css invariant", async () => {
  const profiles = await read("api/profiles.mjs");
  assert.match(profiles, /UPDATE users SET pending_css = NULL, pending_css_version = NULL, approved_css = '', css_status = 'none'/);
  assert.doesNotMatch(profiles, /UPDATE users SET pending_css = NULL, approved_css = NULL/);
});

test("root feed cursor applies timestamp constraints only within the current pin rank", async () => {
  const posts = await read("api/posts.mjs");
  assert.match(posts, /if \(cursor && cursor\.rank === undefined\)[\s\S]*?if \(cursor && cursor\.rank === 0\)[\s\S]*?OR p\.pinned_at IS NULL/);
});

test("profile banner and flair are included in the save request", async () => {
  const app = await read("public/js/app.js");
  assert.match(app, /bannerColor: text\("bannerColor"\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(app, /bannerText: text\("bannerText"\)\.trim\(\)/);
  assert.match(app, /flair: text\("flair"\)\.trim\(\)/);
});

test("GIF marketplace upload and moderation actions reach their API routes", async () => {
  const app = await read("public/js/app.js");
  const gifs = await read("api/gifs.mjs");
  assert.match(app, /"choose-gif-upload": \(\) => document\.querySelector\("#gif-marketplace-file"\)\?\.click\(\)/);
  assert.match(app, /input\.dataset\.composerInput === "gif-marketplace"/);
  assert.match(app, /"gif-approve": async/);
  assert.match(app, /"gif-reject": async/);
  assert.match(gifs, /handleGifAdminRoutes\(request, env, url, path, method\)/);
});

test("duplicate GIF approval converges after unique-index races", async () => {
  const gifs = await read("api/gifs.mjs");
  assert.match(gifs, /catch \(error\)[\s\S]*?SELECT id FROM gifs WHERE status = 'approved'[\s\S]*?merged: true/);
});

test("CSS moderation decisions are tied to the exact reviewed submission", async () => {
  const profiles = await read("api/profiles.mjs");
  const app = await read("public/js/app.js");
  assert.match(profiles, /SELECT id, username, pending_css, pending_css_version, css_status FROM users/);
  assert.match(profiles, /version: String\(row\.pending_css_version \?\? ""\)/);
  assert.match(profiles, /pending_css = \?, pending_css_version = \?, css_status = 'pending'/);
  assert.match(profiles, /pending_css_version = \?/);
  const migration = await read("migrations/0019_css_submission_version.sql");
  assert.match(migration, /ALTER TABLE users ADD COLUMN pending_css_version TEXT/);
  assert.match(migration, /randomblob\(16\)/);
  assert.match(profiles, /approved_css = \?, pending_css = NULL, pending_css_version = NULL, css_status = 'approved'/);
  assert.match(profiles, /WHERE id = \? AND css_status = 'pending' AND pending_css = \? AND pending_css_version = \?/);
  assert.match(profiles, /changed after it was loaded/);
  assert.match(app, /approve\?version=/);
  assert.match(app, /reject\?version=/);
  assert.match(app, /console\.error\("Forum startup failed:", error\)/);
});

test("unexpected Worker failures log the full error but return generic public messages", async () => {
  const worker = await read("worker.mjs");
  assert.match(worker, /console\.error\("Forum request failed:", error\)/);
  assert.match(worker, /console\.error\("Static asset request failed:", error\)/);
  assert.match(worker, /return json\(/);
  assert.match(worker, /Something went wrong\. Please try again\./);
});

test("attachment-bearing post and reply writes stay hidden until media persistence succeeds", async () => {
  const posts = await read("api/posts.mjs");
  const constants = await read("constants.mjs");
  assert.match(posts, /THREAD_REPLY_INSERT_STAGED_SQL/);
  assert.match(posts, /await persistStagedPostAttachments\(db, replyId/);
  assert.match(posts, /await persistStagedPostAttachments\(db, postId/);
  assert.match(posts, /DELETE FROM posts WHERE id = \? AND author_id = \? AND visibility = 'hidden'/);
  assert.match(constants, /THREAD_REPLY_INSERT_STAGED_SQL = THREAD_REPLY_INSERT_SQL\.replace/);
});

test("post creation retries reuse durable idempotency keys", async () => {
  const posts = await read("api/posts.mjs");
  const app = await read("public/js/app.js");
  const api = await read("public/js/api.js");
  assert.match(posts, /existingIdempotentPost\(db, session\.user\.id, idempotencyKey\)/);
  assert.match(posts, /idempotency_key\)/);
  assert.match(app, /form\.dataset\.idempotencyKey \|\| \(form\.dataset\.idempotencyKey = crypto\.randomUUID\(\)\)/);
  assert.match(api, /headers\["Idempotency-Key"\] = idempotencyKey/);
});

test("staged replies recheck visible ancestors and only monotonically bump public threads", async () => {
  const posts = await read("api/posts.mjs");
  const constants = await read("constants.mjs");
  assert.match(posts, /target\.visibility = 'public'[\s\S]*?root\.visibility = 'public'/);
  assert.match(constants, /last_activity_at = MAX\(COALESCE\(last_activity_at, 0\), \?\)/);
  assert.match(constants, /reply\.visibility = 'public'/);
});

test("attachment hash revocation blocks dedup and deletes approved duplicates", async () => {
  const attachments = await read("api/attachments.mjs");
  const migration = await read("migrations/0022_revoked_attachment_hashes.sql");
  assert.match(attachments, /FROM revoked_attachment_hashes WHERE hash = \?/);
  assert.match(attachments, /DELETE FROM attachments WHERE hash = \? AND status = 'approved'/);
  assert.match(migration, /CREATE TABLE revoked_attachment_hashes/);
});

test("release tooling has a named, isolated Preview migration target", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.scripts["db:migrate:preview"], /wempo-forum-preview --env preview --remote/);
});
