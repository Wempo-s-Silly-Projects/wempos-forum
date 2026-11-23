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

// RSS 2.0 feeds and /llms.txt (v5.34.0), served ahead of the SPA assets:
//   GET /feed.xml              latest public topics, every board
//   GET /c/<board>/feed.xml    the same for one board (unknown board -> 404)
//   GET /llms.txt              a plain-text summary of the forum for AI tools
//
// Visibility law: a feed is the ANONYMOUS feed — discovery's public-root SQL
// (visibility = 'public' AND banFilterSql), roots only, FEED_PAGE_SIZE items,
// no caller-supplied limit. It ignores cookies, so one cacheable document
// serves everyone (a member's blocks apply on the site itself).
//
// Escaping: every value (title, description, author, board, URLs) goes
// through xmlText — the five XML entities plus removal of characters XML 1.0
// cannot carry — so member text can never close an element, open CDATA or
// forge an <item>. Titles and descriptions are spoiler-masked before the cut.
//
// llms.txt is static: branding (name/tagline), the boards and the public
// documents. It never reads a post or a member.
import fresh from "fresh";
import { FEED_PAGE_SIZE } from "../constants.mjs";
import { BOARD_VALUES } from "./boards.mjs";
import { readBranding } from "./branding.mjs";
import { feedSql, titleOf, xmlEscape } from "./discovery.mjs";
import { sha256Hex } from "./core/crypto.mjs";
import { securityHeaders } from "./core/http.mjs";
import { siteOrigin } from "./core/site.mjs";
import { sourceUrl } from "./core/source-url.mjs";
import { maskSpoilers, maskedExcerpt } from "./core/spoilers.mjs";

const RSS_TYPE = "application/rss+xml; charset=utf-8";
const TEXT_TYPE = "text/plain; charset=utf-8";
const FEED_CACHE = "public, max-age=60, s-maxage=300";
const DOC_CACHE = "public, max-age=300, s-maxage=3600";
const DESCRIPTION_MAX = 300;
const ETAG_HEX_LENGTH = 32;
// Characters XML 1.0 forbids outright (C0 controls but tab/LF/CR, U+FFFE/F).
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const BOARD_FEED = /^\/c\/([a-z0-9-]+)\/feed\.xml$/;

const xmlText = (value) => xmlEscape(String(value ?? "").replace(XML_FORBIDDEN, ""));

// feedPath(board) -> the feed's path ("/feed.xml" or "/c/<board>/feed.xml").
export const feedPath = (board) => (board ? "/c/" + board + "/feed.xml" : "/feed.xml");

function baseHeaders(contentType, cache) {
  const headers = securityHeaders(new Headers());
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", cache);
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

function plain(request, status, body, cache = "public, max-age=60") {
  const isHead = request.method.toUpperCase() === "HEAD";
  return new Response(isHead ? null : body, { status, headers: baseHeaders(TEXT_TYPE, cache) });
}

// A weak validator over the exact bytes: a matching If-None-Match gets a 304
// with no body, like any conditional GET. fresh (L3) does the RFC 9110
// comparison: weak match, list values, "*", and a no-cache reload never 304s.
async function cachedDocument(request, documentText, contentType, cache) {
  const etag = 'W/"' + (await sha256Hex(documentText)).slice(0, ETAG_HEX_LENGTH) + '"';
  const headers = baseHeaders(contentType, cache);
  headers.set("ETag", etag);
  const conditional = {
    "if-none-match": request.headers.get("If-None-Match") || undefined,
    "cache-control": request.headers.get("Cache-Control") || undefined,
  };
  if (fresh(conditional, { etag })) return new Response(null, { status: 304, headers });
  const isHead = request.method.toUpperCase() === "HEAD";
  return new Response(isHead ? null : documentText, { status: 200, headers });
}

const flatExcerpt = (body) => maskedExcerpt(maskSpoilers(String(body)).replace(/\s+/g, " ").trim(), DESCRIPTION_MAX);
const rfc822 = (seconds) => new Date(Number(seconds) * 1000).toUTCString();

function itemXml(row, origin) {
  const link = origin + "/posts/" + row.id;
  return "<item>" +
    "<title>" + xmlText(titleOf(row)) + "</title>" +
    "<link>" + xmlText(link) + "</link>" +
    '<guid isPermaLink="true">' + xmlText(link) + "</guid>" +
    "<pubDate>" + rfc822(row.created_at) + "</pubDate>" +
    "<dc:creator>" + xmlText(row.author_username) + "</dc:creator>" +
    "<category>" + xmlText(row.board) + "</category>" +
    "<description>" + xmlText(flatExcerpt(row.body)) + "</description>" +
    "</item>";
}

async function publicRoots(env, board) {
  const statement = env.FORUM_DB.prepare(feedSql(Boolean(board)));
  const bound = board ? statement.bind(board, FEED_PAGE_SIZE) : statement.bind(FEED_PAGE_SIZE);
  return (await bound.all()).results || [];
}

export async function buildFeed(env, origin, board) {
  const [rows, branding] = await Promise.all([publicRoots(env, board), readBranding(env)]);
  const title = board ? branding.name + " — " + board : branding.name;
  const pageUrl = board ? origin + "/c/" + board : origin + "/";
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    "<channel>" +
    "<title>" + xmlText(title) + "</title>" +
    "<link>" + xmlText(pageUrl) + "</link>" +
    "<description>" + xmlText(branding.tagline) + "</description>" +
    '<atom:link href="' + xmlText(origin + feedPath(board)) + '" rel="self" type="application/rss+xml"/>' +
    "<generator>Wempo's Forum</generator>" +
    rows.map((row) => itemXml(row, origin)).join("") +
    "</channel>\n</rss>\n";
}

export function llmsText(origin, branding, source) {
  const boards = BOARD_VALUES.map((slug) => "- [" + slug + "](" + origin + "/c/" + slug + "): RSS " +
    origin + feedPath(slug)).join("\n");
  return "# " + branding.name + "\n\n" +
    "> " + branding.tagline + "\n\n" +
    branding.name + " is a community forum: members start topics in boards, reply, react, and chat. " +
    "Everything below is public and can be read without signing in.\n\n" +
    "## Boards\n\n" + boards + "\n\n" +
    "## For AI assistants and other tools\n\n" +
    "- Home: " + origin + "/\n" +
    "- Markdown rendering: send `Accept: text/markdown` to " + origin + "/, /c/<board> or /posts/<id>\n" +
    "- OpenAPI description of the public read API: " + origin + "/openapi.json\n" +
    "- MCP endpoint (public read tools): " + origin + "/mcp\n" +
    "- How auth works: " + origin + "/auth.md\n" +
    "- Sitemap: " + origin + "/sitemap.xml\n" +
    "- RSS feed of the latest public topics: " + origin + "/feed.xml\n" +
    "- API catalog: " + origin + "/.well-known/api-catalog\n" +
    "- Crawler policy: " + origin + "/robots.txt (search and citation yes, model training no)\n" +
    (source ? "- Source code (AGPL-3.0-or-later): " + source + "\n" : "") + "\n" +
    "## Privacy\n\n" +
    "Only public posts are ever served to tools: hidden posts, posts by banned members and private " +
    "messages never are. The forum runs no ads, trackers or third-party scripts; page counts are " +
    "aggregate only, with no per-visitor records. Please quote and link to posts rather than " +
    "republishing them, and do not use members' posts to train models.\n";
}

// Answers a feed or llms.txt request, or null to fall through. GET/HEAD only.
export async function handleFeeds(request, env, path) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  const origin = siteOrigin(env, request);
  if (path === "/llms.txt") {
    return cachedDocument(request, llmsText(origin, await readBranding(env), sourceUrl(env)), TEXT_TYPE, DOC_CACHE);
  }
  const boardMatch = path.match(BOARD_FEED);
  if (path !== "/feed.xml" && !boardMatch) return null;
  const board = boardMatch ? boardMatch[1] : null;
  if (board && !BOARD_VALUES.includes(board)) return plain(request, 404, "Not found.\n");
  if (!env.FORUM_DB) return plain(request, 503, "The forum database is not configured.\n", "no-store");
  return cachedDocument(request, await buildFeed(env, origin, board), RSS_TYPE, FEED_CACHE);
}
