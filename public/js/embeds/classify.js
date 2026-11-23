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

// Embeds (v5.76, Batch D): which standalone links become embeds. Pure and
// DOM-free. A paragraph that is exactly one link (bare, or one markdown
// [label](url)) is a candidate; the URL then has to pass the same scheme
// check every rendered link passes (isSafeLinkUrl: no javascript:, data:,
// "//host", control characters or backslashes) and parse as http(s) with no
// credentials. YouTube is recognised by exact host; every other kind must be
// same-origin, so an off-origin .m3u8, .mp4 or .glb stays an ordinary link.
import { isSafeLinkUrl } from "../markdown.js";

// Mirror constants.mjs (pinned equal by tests/wave576-embeds.test.mjs).
export const EMBED_URL_MAX_CHARS = 2048;
export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

const YOUTUBE_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "youtube-nocookie.com", "www.youtube-nocookie.com",
]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PATH = /^\/(?:shorts|embed|live)\/([^/]+)\/?$/;
const START_SECONDS = /^\d{1,6}$/;
const START_UNITS = /^(?:(\d{1,2})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_DAY = 86400;
const EXTENSION_KINDS = Object.freeze({
  m3u8: "hls",
  mp4: "video", webm: "video", ogv: "video",
  mp3: "audio", ogg: "audio", oga: "audio", opus: "audio", wav: "audio", flac: "audio", m4a: "audio",
  glb: "model", gltf: "model",
});
const EXTENSION = /\.([a-z0-9]{2,5})$/i;
const MARKDOWN_LINK = /^\[([^[\]\n]+)\]\(([^()\s]+)\)$/;
const BARE_LINK = /^(?:https?:\/\/|\/(?!\/))\S+$/i;

// The one link a paragraph consists of, or null. Images ("![…](…)") and
// paragraphs with any other text are never candidates.
export function standaloneLink(text) {
  const value = String(text ?? "").trim();
  if (!value || value.includes("\n") || value.length > EMBED_URL_MAX_CHARS * 2) return null;
  const markdown = MARKDOWN_LINK.exec(value);
  if (markdown) return { url: markdown[2], label: markdown[1].trim() };
  return BARE_LINK.test(value) ? { url: value, label: "" } : null;
}

// A body paragraph keeps its blank lines (parseBlocks), so it is cut into
// blank-line-separated runs; each run is then checked on its own.
export function paragraphRuns(text) {
  const runs = [];
  let current = [];
  for (const line of String(text ?? "").split("\n")) {
    if (line.trim() === "") {
      if (current.length) runs.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) runs.push(current.join("\n"));
  return runs;
}

// YouTube's t= / start= value: "90", "1m30s", "1h2m3s". Anything else, or
// more than a day, is 0 (play from the start).
export function parseStartSeconds(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  const units = value && !START_SECONDS.test(value) ? START_UNITS.exec(value) : null;
  if (value && !START_SECONDS.test(value) && !units) return 0;
  const seconds = units
    ? Number(units[1] ?? 0) * SECONDS_PER_HOUR + Number(units[2] ?? 0) * SECONDS_PER_MINUTE + Number(units[3] ?? 0)
    : Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= SECONDS_PER_DAY ? seconds : 0;
}

function youtubeId(url, host) {
  if (host === "youtu.be") return url.pathname.slice(1).replace(/\/$/, "");
  if (url.pathname === "/watch") return url.searchParams.get("v");
  return YOUTUBE_PATH.exec(url.pathname)?.[1] ?? null;
}

function youtubeVideo(url) {
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const id = youtubeId(url, host);
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { kind: "youtube", id, start: parseStartSeconds(url.searchParams.get("t") ?? url.searchParams.get("start")) };
}

function fileName(url) {
  const last = url.pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function originOf(value) {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

// { kind: "youtube", id, start } | { kind: "hls"|"video"|"audio"|"model",
// url, name } | null. origin is the forum's own (location.origin); without
// one, only YouTube can match.
export function classifyEmbed(raw, origin) {
  const value = String(raw ?? "").trim();
  if (value.length > EMBED_URL_MAX_CHARS || !isSafeLinkUrl(value)) return null;
  const ownOrigin = originOf(origin);
  let url;
  try {
    url = ownOrigin ? new URL(value, ownOrigin) : new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const video = youtubeVideo(url);
  if (video) return video;
  if (!ownOrigin || url.origin !== ownOrigin) return null;
  const kind = EXTENSION_KINDS[(EXTENSION.exec(url.pathname)?.[1] ?? "").toLowerCase()];
  return kind ? { kind, url: url.href, name: fileName(url) } : null;
}
