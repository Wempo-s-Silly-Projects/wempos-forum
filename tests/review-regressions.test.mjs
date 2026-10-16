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
  assert.match(profiles, /version: String\(row\.pending_css_version \?\? ""\)/);
  assert.match(profiles, /pending_css = \?, pending_css_version = \?, css_status = 'pending'/);
  assert.match(profiles, /pending_css_version = \?/);
  const migration = await read("migrations/0019_css_submission_version.sql");
  assert.match(migration, /ALTER TABLE users ADD COLUMN pending_css_version TEXT/);
  assert.match(migration, /randomblob\(16\)/);
  assert.match(profiles, /approved_css = \\?, pending_css = NULL, pending_css_version = NULL, css_status = 'approved'/);
  assert.match(profiles, /WHERE id = \\? AND css_status = 'pending' AND pending_css = \\? AND pending_css_version = \\?/);
  assert.match(profiles, /changed after it was loaded/);
  assert.match(app, /approve\?version=/);
  assert.match(app, /reject\?version=/);
  assert.match(app, /console\.error\("Forum startup failed:", error\)/);
});
