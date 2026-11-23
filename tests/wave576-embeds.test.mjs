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

// Wave 5.76 (Batch D): embeds and media players in post bodies. A paragraph
// that is nothing but one link becomes an embed: a click-to-load YouTube
// facade (nothing third-party until the reader presses play, then only
// youtube-nocookie.com), and same-origin-only HLS/MP4/WebM video, audio with
// a locally decoded waveform, and a click-to-load 3D viewer. Pins the
// vendored libraries byte for byte with their REUSE licensing, the URL
// classifier (crafted javascript:/data:/off-origin URLs refused), the DOM
// before and after the click, the lazy same-origin loaders, and the CSP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as constants from "../constants.mjs";
import { secureResponse, securityHeaders } from "../api/core/http.mjs";
import {
  EMBED_URL_MAX_CHARS, YOUTUBE_EMBED_ORIGIN, classifyEmbed, parseStartSeconds, standaloneLink,
} from "../public/js/embeds/classify.js";
import { createEmbed } from "../public/js/embeds/embeds.js";
import { youtubeEmbedSrc } from "../public/js/embeds/youtube.js";
import {
  HLS_SRC, PLYR_CSS, PLYR_ICON_URL, PLYR_SRC, hlsConfig, plyrOptions, sameOriginFetchSetup,
} from "../public/js/embeds/media.js";
import { WAVESURFER_SRC } from "../public/js/embeds/waveform.js";
import { MODEL_VIEWER_SRC, modelViewerConfig } from "../public/js/embeds/model.js";
import { renderBodyBlocks } from "../public/js/render.js";
import { t } from "../public/js/i18n.js";
import { FakeNode, findByClass, makeFakeDocument } from "./helpers/fake-dom.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const ORIGIN = "https://forum.test";
const VIDEO_ID = "dQw4w9WgXcQ";
const tick = () => new Promise((resolve) => setImmediate(resolve));

const VENDOR = {
  "public/js/vendor/hls.light.min.mjs": ["3d82a88cf9ae0d9aaab3cbe9ff6ecbb64bb89c54a399c34ae9bf8b559baeb20f", "Apache-2.0"],
  "public/js/vendor/plyr.min.mjs": ["29142fb0ebc4f0521e6dd30612374bae57322f1dff4b0703394217f7ddfe746b", "MIT"],
  "public/js/vendor/plyr.css": ["b5b0b0d4a4042361e89378924d82120994b4f9e3193508e6c0f6d15754f80259", "MIT"],
  "public/js/vendor/plyr.svg": ["83469ecb0b22dfd7729d38cc2979d4be1f81deefe5aa4dae5a326a34b9ca7020", "MIT"],
  "public/js/vendor/wavesurfer.esm.js": ["ff2222536e300c20c2d09bfb5f025b3c019406c7858bc32549e91a6c1294a62c", "BSD-3-Clause"],
  "public/js/vendor/model-viewer.min.js": ["18b2e711035aa4705ee281530a55dc2338ff05eed3d70ae16d54105282a75ed5", "Apache-2.0 AND BSD-3-Clause AND MIT"],
};

// ---------------------------------------------------------------- identity

for (const [path, [sha, license]] of Object.entries(VENDOR)) {
  test(`${path} is the approved upstream build, byte for byte`, () => {
    assert.equal(createHash("sha256").update(readFileSync(new URL(path, ROOT))).digest("hex"), sha);
  });
  test(`REUSE.toml annotates ${path} as ${license}`, () => {
    const block = read("REUSE.toml").split("[[annotations]]").find((part) => part.includes(`"${path}"`));
    assert.ok(block, "an annotations block names " + path);
    assert.ok(block.includes(`SPDX-License-Identifier = "${license}"`), license);
    assert.match(block, /precedence = "override"/);
  });
}

test("every licence the vendored files use ships under LICENSES/", () => {
  assert.match(read("LICENSES/Apache-2.0.txt"), /Apache License\s+Version 2\.0, January 2004/);
  assert.match(read("LICENSES/BSD-3-Clause.txt"), /Redistribution and use in source and binary forms/);
  assert.match(read("LICENSES/MIT.txt"), /^MIT License/);
});

test("the Prism annotation is untouched and still covers the vendor folder", () => {
  const block = read("REUSE.toml").split("[[annotations]]").find((part) => part.includes('"public/js/vendor/**"'));
  assert.match(block, /SPDX-FileCopyrightText = "Lea Verou and PrismJS contributors"/);
});

test("lite-youtube-embed is not vendored (its poster and hover preconnects contact Google before a click)", () => {
  const names = readdirSync(new URL("public/js/vendor/", ROOT));
  assert.ok(!names.some((name) => /lite-?y(ou)?t/i.test(name)));
});

// ---------------------------------------------------------------- constants

test("embed constants live in constants.mjs and the client mirrors them exactly", () => {
  assert.equal(constants.EMBED_URL_MAX_CHARS, 2048);
  assert.equal(constants.YOUTUBE_EMBED_ORIGIN, "https://www.youtube-nocookie.com");
  assert.equal(EMBED_URL_MAX_CHARS, constants.EMBED_URL_MAX_CHARS);
  assert.equal(YOUTUBE_EMBED_ORIGIN, constants.YOUTUBE_EMBED_ORIGIN);
});

const wavesurferStyleHash = () => {
  const source = read("public/js/vendor/wavesurfer.esm.js");
  const open = "<style${i?` nonce=\"${i}\"`:\"\"}>";
  const start = source.indexOf(open);
  assert.ok(start > 0, "the vendored renderer still injects its one shadow <style>");
  const raw = source.slice(start + open.length, source.indexOf("</style>", start));
  assert.doesNotMatch(raw, /[`$]/, "the style body is a static string");
  const text = raw.replace(/\\n/g, "\n");
  return "sha256-" + createHash("sha256").update(text).digest("base64");
};

test("WAVESURFER_STYLE_HASH is the CSP hash of the vendored renderer's static shadow style", () => {
  assert.equal(constants.WAVESURFER_STYLE_HASH, wavesurferStyleHash());
});

// ---------------------------------------------------------------- standalone links

test("standaloneLink: a bare URL or one markdown link alone on its paragraph, nothing else", () => {
  assert.deepEqual(standaloneLink(`  https://youtu.be/${VIDEO_ID}  `), { url: `https://youtu.be/${VIDEO_ID}`, label: "" });
  assert.deepEqual(standaloneLink("[Our talk](/media/talk.mp4)"), { url: "/media/talk.mp4", label: "Our talk" });
  assert.equal(standaloneLink(`watch https://youtu.be/${VIDEO_ID}`), null);
  assert.equal(standaloneLink(`https://youtu.be/${VIDEO_ID}\nhttps://youtu.be/${VIDEO_ID}`), null);
  assert.equal(standaloneLink("[a](/x.mp4) and [b](/y.mp4)"), null);
  assert.equal(standaloneLink("![img](/x.glb)"), null);
  assert.equal(standaloneLink(""), null);
  assert.equal(standaloneLink(null), null);
});

// ---------------------------------------------------------------- classifier

test("classifyEmbed: YouTube watch, short, shorts, embed, live and nocookie URLs give the video id", () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${VIDEO_ID}`, `https://youtube.com/watch?v=${VIDEO_ID}&list=x`,
    `https://m.youtube.com/watch?v=${VIDEO_ID}`, `https://youtu.be/${VIDEO_ID}`,
    `https://www.youtube.com/shorts/${VIDEO_ID}`, `https://www.youtube.com/embed/${VIDEO_ID}`,
    `https://www.youtube.com/live/${VIDEO_ID}`, `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
  ]) {
    const embed = classifyEmbed(url, ORIGIN);
    assert.equal(embed?.kind, "youtube", url);
    assert.equal(embed.id, VIDEO_ID, url);
    assert.equal(embed.start, 0, url);
  }
  assert.equal(classifyEmbed(`https://youtu.be/${VIDEO_ID}?t=90`, ORIGIN).start, 90);
  assert.equal(classifyEmbed(`https://www.youtube.com/watch?v=${VIDEO_ID}&t=1m30s`, ORIGIN).start, 90);
  assert.equal(classifyEmbed(`https://youtu.be/${VIDEO_ID}`, null).kind, "youtube", "no origin needed for YouTube");
});

test("classifyEmbed: look-alike hosts and malformed ids are not YouTube", () => {
  for (const url of [
    `https://youtube.com.evil.example/watch?v=${VIDEO_ID}`, `https://evil.example/watch?v=${VIDEO_ID}`,
    `https://notyoutube.com/watch?v=${VIDEO_ID}`, "https://youtu.be/short", `https://youtu.be/${VIDEO_ID}x`,
    `https://www.youtube.com/watch?v=${VIDEO_ID.slice(0, 10)}"`, "https://www.youtube.com/watch?v=<script>aaaa",
    `https://user:pw@youtu.be/${VIDEO_ID}`, `ftp://youtu.be/${VIDEO_ID}`,
  ]) assert.equal(classifyEmbed(url, ORIGIN), null, url);
});

test("parseStartSeconds: plain seconds and h/m/s forms, anything else is 0", () => {
  assert.equal(parseStartSeconds("42"), 42);
  assert.equal(parseStartSeconds("1h2m3s"), 3723);
  assert.equal(parseStartSeconds("2m"), 120);
  assert.equal(parseStartSeconds("-5"), 0);
  assert.equal(parseStartSeconds("1e9"), 0);
  assert.equal(parseStartSeconds("abc"), 0);
  assert.equal(parseStartSeconds(null), 0);
  assert.equal(parseStartSeconds("99999999"), 0, "beyond a day is refused");
});

test("classifyEmbed: same-origin media by extension (relative or absolute)", () => {
  assert.deepEqual(classifyEmbed("/media/live.m3u8", ORIGIN), { kind: "hls", url: ORIGIN + "/media/live.m3u8", name: "live.m3u8" });
  assert.equal(classifyEmbed(ORIGIN + "/a/clip.MP4", ORIGIN).kind, "video");
  assert.equal(classifyEmbed("/a/clip.webm?x=1", ORIGIN).kind, "video");
  for (const ext of ["mp3", "ogg", "oga", "opus", "wav", "flac", "m4a"]) assert.equal(classifyEmbed(`/a/song.${ext}`, ORIGIN).kind, "audio", ext);
  assert.equal(classifyEmbed("/a/teapot.glb", ORIGIN).kind, "model");
  assert.equal(classifyEmbed("/a/teapot.gltf", ORIGIN).kind, "model");
  assert.equal(classifyEmbed("/a/My%20Song.mp3", ORIGIN).name, "My Song.mp3");
  assert.equal(classifyEmbed("/a/page.html", ORIGIN), null);
  assert.equal(classifyEmbed("/a/teapot.glb", null), null, "no origin, no same-origin media");
});

test("classifyEmbed: crafted URLs are refused (javascript:, data:, off-origin m3u8/glb/mp4, tricks)", () => {
  for (const url of [
    "javascript:alert(1)//.m3u8", "JaVaScRiPt:alert(1)//x.mp4", "data:video/mp4;base64,AAAA",
    "data:application/vnd.apple.mpegurl,#EXTM3U", "vbscript:x.glb", "//evil.example/live.m3u8",
    "https://evil.example/live.m3u8", "https://evil.example/teapot.glb", "https://evil.example/clip.mp4",
    "https://forum.test.evil.example/a.mp4", "http://forum.test/a.mp4", "https://forum.test:8443/a.mp4",
    "/a\\b.mp4", "/a\n.mp4", "https://user:pw@forum.test/a.mp4", "/" + "a".repeat(EMBED_URL_MAX_CHARS) + ".mp4",
    "blob:https://forum.test/uuid", "  ",
  ]) assert.equal(classifyEmbed(url, ORIGIN), null, url);
});

// ---------------------------------------------------------------- DOM helpers

const walkNodes = (node) => [node, ...Array.from(node.children ?? []).flatMap(walkNodes)];
const urlAttributes = (root) => walkNodes(root).flatMap((node) =>
  ["src", "href", "poster", "srcset", "data"].filter((name) => node.attributes?.[name] !== undefined)
    .map((name) => ({ tag: node.tagName, name, value: node.attributes[name] })));
const fakeLoader = (modules = {}) => {
  const calls = [];
  const sheets = [];
  return {
    calls, sheets,
    import(path) { calls.push(path); return path in modules ? Promise.resolve(modules[path]) : Promise.reject(new Error(path)); },
    stylesheet(href) { sheets.push(href); },
  };
};
const embedFor = (text, options = {}) => createEmbed(makeFakeDocument(options.documentExtra), text,
  { origin: ORIGIN, reducedMotion: false, loader: fakeLoader(), ...options });

// ---------------------------------------------------------------- YouTube facade

test("YouTube: before the click nothing third-party is referenced, loaded or painted", () => {
  const loader = fakeLoader();
  const host = embedFor(`[Launch talk](https://youtu.be/${VIDEO_ID})`, { loader });
  assert.equal(host.className, "post-body", "the host is an edit-swappable body block");
  assert.equal(host.dataset.embed, "youtube");
  const nodes = walkNodes(host);
  assert.ok(!nodes.some((node) => node.tagName === "IFRAME"), "no iframe yet");
  assert.ok(!nodes.some((node) => node.style?.backgroundImage), "no ytimg poster");
  const urls = urlAttributes(host);
  assert.deepEqual(urls.filter((entry) => entry.name !== "href" || entry.tag !== "A"), [], "only a plain link carries a URL");
  assert.deepEqual(loader.calls, [], "no script loaded");
  const button = findByClass(host, "embed-youtube-play");
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("aria-label"), t("embed.youtubePlay", { title: "Launch talk" }));
  assert.equal(findByClass(host, "embed-youtube-title").textContent, "Launch talk");
  assert.equal(findByClass(host, "embed-youtube-notice").textContent, t("embed.youtubeNotice"));
  const en = JSON.parse(read("public/locales/en.json"));
  // The notice names the nocookie host: one word, stripped of punctuation and a
  // leading "www.", equals the embed origin's host exactly.
  const nocookieHost = new URL(constants.YOUTUBE_EMBED_ORIGIN).hostname.replace(/^www\./, "");
  const words = en["embed.youtubeNotice"].split(/\s+/).map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/^www\./, ""));
  assert.ok(words.some((word) => word === nocookieHost), "notice names the nocookie host");
  assert.match(en["embed.youtubePlay"], /\{title\}/);
  const original = findByClass(host, "embed-original");
  assert.equal(original.getAttribute("href"), `https://www.youtube.com/watch?v=${VIDEO_ID}`);
  assert.equal(original.getAttribute("rel"), "noopener noreferrer");
});

test("YouTube: the click swaps in exactly one youtube-nocookie iframe", () => {
  const host = embedFor(`https://www.youtube.com/watch?v=${VIDEO_ID}&t=90`);
  const button = findByClass(host, "embed-youtube-play");
  button.dispatch("click");
  const frames = walkNodes(host).filter((node) => node.tagName === "IFRAME");
  assert.equal(frames.length, 1);
  const src = frames[0].getAttribute("src");
  assert.equal(src, `${YOUTUBE_EMBED_ORIGIN}/embed/${VIDEO_ID}?autoplay=1&start=90`);
  assert.equal(new URL(src).origin, "https://www.youtube-nocookie.com");
  assert.equal(frames[0].getAttribute("referrerpolicy"), "strict-origin-when-cross-origin");
  assert.ok(frames[0].hasAttribute("allowfullscreen"));
  assert.ok(frames[0].getAttribute("title"));
  assert.ok(!findByClass(host, "embed-youtube-play"), "the facade button is gone");
  button.dispatch("click");
  assert.equal(walkNodes(host).filter((node) => node.tagName === "IFRAME").length, 1, "a second click adds nothing");
});

test("YouTube: prefers-reduced-motion means no autoplay even after the click", () => {
  assert.equal(youtubeEmbedSrc({ id: VIDEO_ID, start: 0 }, { reducedMotion: true }), `${YOUTUBE_EMBED_ORIGIN}/embed/${VIDEO_ID}`);
  const host = embedFor(`https://youtu.be/${VIDEO_ID}`, { reducedMotion: true });
  findByClass(host, "embed-youtube-play").dispatch("click");
  const frame = walkNodes(host).find((node) => node.tagName === "IFRAME");
  assert.doesNotMatch(frame.getAttribute("src"), /autoplay/);
});

test("YouTube: a crafted label renders as text, never markup", () => {
  const host = embedFor(`[<img src=x onerror=alert(1)>](https://youtu.be/${VIDEO_ID})`);
  assert.ok(!walkNodes(host).some((node) => node.tagName === "IMG"));
  assert.match(findByClass(host, "embed-youtube-title").textContent, /<img src=x onerror=alert\(1\)>/);
});

// ---------------------------------------------------------------- video / HLS

test("video: same-origin MP4 gets a native <video> with no autoplay, then the Plyr skin", async () => {
  const constructed = [];
  class Plyr { constructor(element, options) { constructed.push({ element, options }); } }
  const loader = fakeLoader({ [PLYR_SRC]: { default: Plyr } });
  const host = embedFor("/media/clip.mp4", { loader });
  const video = walkNodes(host).find((node) => node.tagName === "VIDEO");
  assert.equal(video.getAttribute("src"), ORIGIN + "/media/clip.mp4");
  assert.ok(video.hasAttribute("controls"));
  assert.equal(video.getAttribute("preload"), "metadata");
  assert.ok(!video.hasAttribute("autoplay"));
  assert.ok(urlAttributes(host).every((entry) => new URL(entry.value).origin === ORIGIN), "same-origin only");
  await tick();
  assert.deepEqual(loader.sheets, [PLYR_CSS]);
  assert.equal(constructed.length, 1);
  assert.equal(constructed[0].element, video);
  assert.equal(constructed[0].options.autoplay, false);
});

test("plyrOptions: same-origin icons, no remote sprite or blank video, no storage, translated labels", () => {
  for (const kind of ["video", "hls", "audio"]) {
    const options = plyrOptions(kind);
    assert.equal(options.iconUrl, PLYR_ICON_URL);
    assert.ok(PLYR_ICON_URL.startsWith("/js/vendor/"));
    assert.equal(options.loadSprite, false);
    assert.ok(options.blankVideo.startsWith("/"), "blank video stays same-origin");
    assert.equal(options.autoplay, false);
    assert.equal(options.storage.enabled, false);
    assert.doesNotMatch(JSON.stringify(options), /cdn\.plyr\.io|https?:/);
    assert.equal(typeof options.i18n.play, "string");
  }
  assert.ok(!plyrOptions("audio").controls.includes("fullscreen"));
  assert.ok(plyrOptions("video").controls.includes("fullscreen"));
});

test("HLS: without native support, hls.js (same-origin, fetch loader, no worker) attaches", async () => {
  const instances = [];
  class Hls {
    static isSupported() { return true; }
    constructor(config) { this.config = config; this.calls = []; instances.push(this); }
    attachMedia(media) { this.calls.push(["attach", media]); }
    loadSource(url) { this.calls.push(["load", url]); }
    startLoad() { this.calls.push(["start"]); }
  }
  class FetchLoader {}
  const loader = fakeLoader({ [HLS_SRC]: { default: Hls, FetchLoader } });
  const host = embedFor("/media/live.m3u8", { loader });
  const video = walkNodes(host).find((node) => node.tagName === "VIDEO");
  assert.ok(!video.hasAttribute("src"), "no direct src for MSE playback");
  await tick();
  assert.ok(loader.calls.includes(HLS_SRC));
  const [hls] = instances;
  assert.equal(hls.config.loader, FetchLoader);
  assert.equal(hls.config.enableWorker, false);
  assert.equal(hls.config.autoStartLoad, false);
  assert.deepEqual(hls.calls.slice(0, 2), [["attach", video], ["load", ORIGIN + "/media/live.m3u8"]]);
  video.dispatch("play");
  assert.deepEqual(hls.calls.at(-1), ["start"]);
});

test("HLS: native support plays the same-origin playlist directly, hls.js never loads", () => {
  const loader = fakeLoader();
  const documentExtra = {
    createElement(tag) {
      const node = new FakeNode(tag);
      if (tag === "video") node.canPlayType = (type) => (type === "application/vnd.apple.mpegurl" ? "maybe" : "");
      return node;
    },
  };
  const host = embedFor("/media/live.m3u8", { loader, documentExtra });
  assert.equal(walkNodes(host).find((node) => node.tagName === "VIDEO").getAttribute("src"), ORIGIN + "/media/live.m3u8");
  assert.ok(!loader.calls.includes(HLS_SRC));
});

test("HLS: every playlist/segment request is checked same-origin before fetch", () => {
  const setup = sameOriginFetchSetup(ORIGIN);
  const request = setup({ url: ORIGIN + "/media/seg1.ts" }, { method: "GET" });
  assert.equal(request.url, ORIGIN + "/media/seg1.ts");
  assert.equal(setup({ url: "seg2.ts" }, {}).url, ORIGIN + "/seg2.ts");
  assert.throws(() => setup({ url: "https://evil.example/seg.ts" }, {}));
  assert.throws(() => setup({ url: "data:video/mp2t;base64,AA" }, {}));
  const config = hlsConfig(ORIGIN, class {});
  assert.equal(typeof config.fetchSetup, "function");
  assert.equal(config.enableWorker, false);
});

// ---------------------------------------------------------------- audio / waveform

test("audio: same-origin audio gets Plyr plus a WaveSurfer waveform bound to the same element", async () => {
  const created = [];
  const WaveSurfer = { create(options) { created.push(options); return {}; } };
  const loader = fakeLoader({ [WAVESURFER_SRC]: { default: WaveSurfer }, [PLYR_SRC]: { default: class {} } });
  const host = embedFor("[Theme song](/media/theme.ogg)", { loader });
  const audio = walkNodes(host).find((node) => node.tagName === "AUDIO");
  assert.equal(audio.getAttribute("src"), ORIGIN + "/media/theme.ogg");
  assert.ok(!audio.hasAttribute("autoplay"));
  const wave = findByClass(host, "embed-waveform");
  assert.ok(wave, "a waveform container renders");
  await tick();
  assert.ok(loader.calls.includes(WAVESURFER_SRC));
  assert.equal(created.length, 1);
  assert.equal(created[0].container, wave);
  assert.equal(created[0].media, audio);
  assert.equal(created[0].url, ORIGIN + "/media/theme.ogg", "decoded from the file itself, same-origin");
  assert.equal(created[0].autoplay, undefined);
});

test("audio: a failed waveform load hides the strip and keeps the player", async () => {
  const host = embedFor("/media/theme.mp3", { loader: fakeLoader() });
  await tick();
  assert.equal(findByClass(host, "embed-waveform").hidden, true);
  assert.ok(walkNodes(host).some((node) => node.tagName === "AUDIO"));
});

// ---------------------------------------------------------------- 3D model

test("model: click-to-load; nothing (not even the same-origin viewer) loads before the click", async () => {
  class ModelViewerElement {}
  const loader = fakeLoader({ [MODEL_VIEWER_SRC]: { ModelViewerElement } });
  const saved = globalThis.ModelViewerElement;
  delete globalThis.ModelViewerElement;
  try {
    const host = embedFor("[Teapot](/models/teapot.glb)", { loader });
    assert.deepEqual(loader.calls, []);
    assert.ok(!walkNodes(host).some((node) => node.tagName === "MODEL-VIEWER"));
    const button = findByClass(host, "embed-model-load");
    assert.equal(button.tagName, "BUTTON");
    await button.fire("click");
    await tick();
    assert.deepEqual(loader.calls, [MODEL_VIEWER_SRC]);
    const config = globalThis.ModelViewerElement;
    for (const value of Object.values(config)) assert.ok(String(value).startsWith("/js/vendor/"), "decoders stay same-origin: " + value);
    const viewer = walkNodes(host).find((node) => node.tagName === "MODEL-VIEWER");
    assert.equal(viewer.getAttribute("src"), ORIGIN + "/models/teapot.glb");
    assert.ok(viewer.hasAttribute("camera-controls"));
    assert.ok(!viewer.hasAttribute("auto-rotate"));
    assert.ok(!viewer.hasAttribute("ar"));
    assert.equal(viewer.getAttribute("interaction-prompt"), "none");
    assert.ok(viewer.getAttribute("alt"));
  } finally {
    if (saved === undefined) delete globalThis.ModelViewerElement; else globalThis.ModelViewerElement = saved;
  }
});

test("modelViewerConfig: Draco, KTX2, Meshopt and Lottie never resolve to gstatic or jsdelivr", () => {
  const config = modelViewerConfig();
  assert.deepEqual(Object.keys(config).sort(),
    ["dracoDecoderLocation", "ktx2TranscoderLocation", "lottieLoaderLocation", "meshoptDecoderLocation"]);
  assert.doesNotMatch(JSON.stringify(config), /https?:|gstatic|jsdelivr/);
});

// ---------------------------------------------------------------- render hook + XSS

test("renderBodyBlocks: a standalone YouTube link becomes the facade; links inside text stay links", () => {
  const document = makeFakeDocument();
  const article = document.createElement("article");
  renderBodyBlocks({ body: `Look:\n\nhttps://youtu.be/${VIDEO_ID}\n\nsee [this](https://youtu.be/${VIDEO_ID}) too` }, document, article);
  const hosts = walkNodes(article).filter((node) => node.dataset?.embed);
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].dataset.embed, "youtube");
  assert.ok(!walkNodes(article).some((node) => node.tagName === "IFRAME"));
});

test("renderBodyBlocks: an off-origin media link renders as an ordinary link", () => {
  const document = makeFakeDocument();
  const article = document.createElement("article");
  renderBodyBlocks({ body: "[clip](https://evil.example/clip.m3u8)" }, document, article);
  assert.ok(!walkNodes(article).some((node) => node.dataset?.embed));
  assert.ok(walkNodes(article).some((node) => node.tagName === "A"));
});

test("embeds source: no innerHTML, no HTML strings, no eval, no direct third-party script", () => {
  const dir = new URL("public/js/embeds/", ROOT);
  const files = readdirSync(dir).filter((name) => name.endsWith(".js"));
  assert.ok(files.length >= 5);
  for (const name of files) {
    const source = readFileSync(new URL(name, dir), "utf8");
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, name);
    assert.doesNotMatch(source, /i\.ytimg\.com|img\.youtube\.com|cdn\.plyr\.io|gstatic|jsdelivr|unpkg/, name);
  }
});

// ---------------------------------------------------------------- CSP

const htmlCsp = () => secureResponse(new Response("x")).headers.get("Content-Security-Policy");
const directive = (csp, name) => (csp.match(new RegExp(`(?:^|; )${name} ([^;]+)`)) ?? [])[1]?.split(/\s+/) ?? null;

test("CSP: frame-src adds youtube-nocookie.com and nothing else", () => {
  assert.deepEqual(directive(htmlCsp(), "frame-src"), ["https://challenges.cloudflare.com", "https://www.youtube-nocookie.com"]);
});

test("CSP: img-src gains no YouTube thumbnail host; blob: only for locally decoded model textures", () => {
  const csp = htmlCsp();
  assert.deepEqual(directive(csp, "img-src"), ["'self'", "data:", "blob:"]);
  assert.doesNotMatch(csp, /ytimg|www\.youtube\.com|cdn\.plyr\.io|gstatic|jsdelivr/);
});

test("CSP: media-src is same-origin plus blob: (MSE for hls.js), connect-src adds only blob:", () => {
  const csp = htmlCsp();
  assert.deepEqual(directive(csp, "media-src"), ["'self'", "blob:"]);
  assert.deepEqual(directive(csp, "connect-src"), ["'self'", "https://challenges.cloudflare.com", "blob:"]);
});

test("CSP: style-src is 'self' plus exactly the WaveSurfer shadow-style hash; script-src unchanged", () => {
  const csp = htmlCsp();
  assert.deepEqual(directive(csp, "style-src"), ["'self'", `'${wavesurferStyleHash()}'`]);
  assert.deepEqual(directive(csp, "script-src"),
    ["'self'", "https://challenges.cloudflare.com", "https://cdnjs.cloudflare.com/polyfill/"]);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|worker-src|\s\*[\s;]/);
});

test("CSP: non-HTML responses keep the vendor policy (no embed origins on JSON)", () => {
  const csp = securityHeaders(new Headers()).get("Content-Security-Policy");
  assert.doesNotMatch(csp, /youtube|blob:|sha256/);
});

// ---------------------------------------------------------------- styles + locales

test("styles: embed rules exist and paint no remote image", () => {
  const css = read("public/styles.css");
  for (const selector of [".embed-youtube", ".embed-youtube-play", ".embed-media", ".embed-waveform", ".embed-model"]) {
    assert.ok(css.includes(selector), selector);
  }
  assert.doesNotMatch(css, /url\(\s*["']?https?:/);
});

test("locales: the embed.* keys form one contiguous block in every table", () => {
  const dir = new URL("public/locales/", ROOT);
  const enKeys = Object.keys(JSON.parse(read("public/locales/en.json"))).filter((key) => key.startsWith("embed."));
  assert.ok(enKeys.length >= 10);
  for (const name of readdirSync(dir)) {
    const keys = Object.keys(JSON.parse(readFileSync(new URL(name, dir), "utf8")));
    const first = keys.findIndex((key) => key.startsWith("embed."));
    assert.deepEqual(keys.slice(first, first + enKeys.length), enKeys, name);
    assert.equal(keys.filter((key) => key.startsWith("embed.")).length, enKeys.length, name);
  }
});

test("render.js wires the embeds folder with one call", () => {
  assert.ok(existsSync(new URL("public/js/embeds/embeds.js", ROOT)));
  assert.equal((read("public/js/render.js").match(/embedParagraph\(/g) ?? []).length, 1);
});
