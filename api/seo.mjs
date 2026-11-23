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

// Per-page head for crawlers and share previews (v5.31.0). The worker serves
// one SPA shell for every page; this module replaces the shell's static
// <title> and <meta name="description"> with the page's own, and adds the
// canonical link, Open Graph + Twitter card tags, JSON-LD data blocks and a
// noindex where a page must not be indexed.
//
// Visibility law: the head shows only what an anonymous visitor may see — a
// thread's excerpt only when canViewPost passes for a NON-staff viewer (staff
// get the public face too), a profile's name only when the member has no
// active ban. A signed-in viewer's block pair (either direction) also gets
// the generic head, so a blocked member's words never ride the tab title.
// Hidden, banned, blocked, deleted and missing all render the SAME generic,
// noindexed head: no existence oracle. A failed read degrades to that head.
//
// Escaping: every attribute value goes through attributeEscape; JSON-LD is a
// data block (never executed; CSP script-src does not apply) serialized with
// JSON.stringify and then <, > and & escaped as \u003c, \u003e, \u0026, so a
// post containing "</script>" cannot close the block.
import { readSession } from "./core/auth.mjs";
import { blockPairExists, viewerBlockFilterSql } from "./core/blocks.mjs";
import { siteOrigin } from "./core/site.mjs";
import { maskSpoilers, maskedExcerpt } from "./core/spoilers.mjs";
import { ACTIVE_BAN_SQL, canViewPost } from "./core/visibility.mjs";
import { BRANDING_DEFAULTS } from "./branding.mjs";
import { POST_ROW_SQL, publicReplyCountSql, titleOf } from "./discovery.mjs";
import { feedPath } from "./feeds.mjs";
import { findTagBySlug } from "./tags.mjs";
import { routeForPath } from "../public/js/router.js";

const DESCRIPTION_MAX = 150;
const OG_IMAGE_PATH = "/og-image.png";
const SCHEMA_CONTEXT = "https://schema.org";

const PROFILE_SQL =
  "SELECT u.id, u.username FROM users u WHERE u.username_key = ? AND NOT " + ACTIVE_BAN_SQL("u.id") + " LIMIT 1";

// The JSON-LD reply count says what the viewer's feed says (v5.32 L1): for a
// signed-in viewer, replies by a block-paired author — and sub-replies under
// a block-paired parent — drop out (2 binds per filter, before the id).
function replyCountStatement(db, viewer, id) {
  const blocks = viewerBlockFilterSql(viewer, "rc.author_id") + viewerBlockFilterSql(viewer, "rl.author_id");
  const binds = blocks ? [viewer.id, viewer.id, viewer.id, viewer.id] : [];
  return db.prepare("SELECT " + publicReplyCountSql(blocks) + " AS reply_count FROM posts p WHERE p.id = ? LIMIT 1")
    .bind(...binds, id);
}

export function attributeEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attributeUnescape(value) {
  return String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// jsonLdBlock(data) -> one <script type="application/ld+json"> data block
// whose text holds no raw "<" (so no "</script>" or "<!--" can appear).
export function jsonLdBlock(data) {
  const text = JSON.stringify(data)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<script type="application/ld+json">${text}</script>`;
}

// ogImageUrl(env, origin) -> OG_IMAGE_URL when it is an http(s) URL, else the
// forum's own /og-image.png.
export function ogImageUrl(env, origin) {
  const raw = env && typeof env.OG_IMAGE_URL === "string" ? env.OG_IMAGE_URL.trim() : "";
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch {
      // not a URL: fall through to the default card
    }
  }
  return origin + OG_IMAGE_PATH;
}

const isoDate = (seconds) => new Date(Number(seconds) * 1000).toISOString();
const flatExcerpt = (body) => maskedExcerpt(maskSpoilers(String(body)).replace(/\s+/g, " ").trim(), DESCRIPTION_MAX);

// The viewer for the block check only: staff are treated as members so the
// head is always the public face (canViewPost's staff bypass never applies).
async function blockViewer(request, env) {
  if (!request.headers.get("Cookie")) return null;
  const session = await readSession(request, env);
  return session && session.user ? { id: session.user.id, role: "member" } : null;
}

// Perf: the viewer and the row are read together, then the reply count is
// read alongside canViewPost. The count is used only after canViewPost says
// yes, so a hidden, banned or blocked thread's count never leaves here.
async function threadHead(request, env, id, origin, site) {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const [viewer, row] = await Promise.all([
    blockViewer(request, env),
    env.FORUM_DB.prepare(POST_ROW_SQL).bind(id).first(),
  ]);
  if (!row) return null;
  const [visible, counted] = await Promise.all([
    canViewPost(env, row, viewer),
    replyCountStatement(env.FORUM_DB, viewer, id).first(),
  ]);
  if (!visible) return null;
  const url = origin + "/posts/" + row.id;
  const headline = titleOf(row);
  const description = flatExcerpt(row.body);
  const posting = {
    "@context": SCHEMA_CONTEXT,
    "@type": "DiscussionForumPosting",
    headline,
    text: description,
    url,
    author: { "@type": "Person", name: row.author_username, url: origin + "/users/" + encodeURIComponent(row.author_username) },
    datePublished: isoDate(row.created_at),
    ...(row.edited_at ? { dateModified: isoDate(row.edited_at) } : {}),
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: SCHEMA_CONTEXT + "/CommentAction",
      userInteractionCount: Number((counted && counted.reply_count) || 0),
    },
  };
  return { title: `${headline} — ${site.name}`, description, canonical: url, type: "article", ld: [posting] };
}

async function profileHead(env, viewer, username, origin, site) {
  const user = await env.FORUM_DB.prepare(PROFILE_SQL).bind(String(username).toLowerCase()).first();
  if (!user) return null;
  if (viewer && viewer.id !== Number(user.id) && (await blockPairExists(env, viewer.id, user.id))) return null;
  return {
    title: `${user.username} — ${site.name}`,
    description: `${user.username}'s profile and recent topics on ${site.name}.`,
    canonical: origin + "/users/" + encodeURIComponent(user.username),
    type: "profile",
    ld: [],
  };
}

// The record-backed pages (thread, profile); null = show the generic head.
async function recordHead(request, env, route, origin, site) {
  if (route.name !== "post" && route.name !== "profile") return undefined;
  if (!env.FORUM_DB) return null;
  try {
    return route.name === "post"
      ? await threadHead(request, env, route.id, origin, site)
      : await profileHead(env, await blockViewer(request, env), route.username, origin, site);
  } catch (error) {
    console.error("Page head lookup failed; serving the generic head:", error);
    return null;
  }
}

function siteBlocks(site, origin, image) {
  return [
    {
      "@context": SCHEMA_CONTEXT,
      "@type": "WebSite",
      name: site.name,
      url: origin + "/",
      description: site.description,
      potentialAction: {
        "@type": "SearchAction",
        target: origin + "/?q={search_term_string}",
        "query-input": "required name=search_term_string",
      },
    },
    { "@context": SCHEMA_CONTEXT, "@type": "Organization", name: site.name, url: origin + "/", logo: image },
  ];
}

async function pageHead(request, env, url, site, origin) {
  const route = routeForPath(url.pathname, url.search);
  const generic = { title: site.title, description: site.description, canonical: origin + url.pathname, type: "website", ld: [] };
  if (route.name === "not-found") return { ...generic, title: `Not found — ${site.name}`, canonical: "", noindex: true };
  if (route.name === "category") {
    return {
      ...generic,
      title: `${route.board} — ${site.name}`,
      description: `Recent topics in the ${route.board} board on ${site.name}.`,
      canonical: origin + "/c/" + route.board,
      board: route.board,
    };
  }
  // This week (v5.35): its own title and description; the page lists only
  // what the anonymous feed already shows, so nothing record-backed rides it.
  if (route.name === "week") {
    return {
      ...generic,
      title: `This week on ${site.name}`,
      description: `The busiest threads, newest Showcase builds and the staff pick of the last 7 days on ${site.name}.`,
      canonical: origin + "/week",
    };
  }
  // Thread tags (v5.44): a known tag's label (staff-written, word-filtered,
  // public) names the page; an unknown slug gets the generic noindexed head.
  if (route.name === "tag") {
    const tag = await findTagBySlug(env.FORUM_DB, route.slug).catch(() => null);
    if (!tag) return { ...generic, canonical: "", noindex: true };
    return {
      ...generic,
      title: `${tag.label} — ${site.name}`,
      description: `Threads tagged ${tag.label} on ${site.name}.`,
      canonical: origin + "/tag/" + tag.slug,
    };
  }
  const record = await recordHead(request, env, route, origin, site);
  if (record === undefined) return generic;
  return record || { ...generic, canonical: "", noindex: true };
}

function renderHead(head, site, image) {
  const meta = (attr, key, value) => `<meta ${attr}="${key}" content="${attributeEscape(value)}">`;
  return [
    `<title>${attributeEscape(head.title)}</title>`,
    meta("name", "description", head.description),
    head.noindex ? meta("name", "robots", "noindex") : "",
    head.canonical ? `<link rel="canonical" href="${attributeEscape(head.canonical)}">` : "",
    meta("property", "og:site_name", site.name),
    meta("property", "og:title", head.title),
    meta("property", "og:description", head.description),
    head.canonical ? meta("property", "og:url", head.canonical) : "",
    meta("property", "og:type", head.type),
    meta("property", "og:image", image),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", head.title),
    meta("name", "twitter:description", head.description),
    meta("name", "twitter:image", image),
    // RSS (v5.34): the site feed everywhere, plus the board's own on /c/<board>.
    ...head.feeds.map((feed) =>
      `<link rel="alternate" type="application/rss+xml" title="${attributeEscape(feed.title)}" href="${attributeEscape(feed.href)}">`),
    ...head.ld.map(jsonLdBlock),
  ].join("");
}

const SHELL_TITLE = /<title>[\s\S]*?<\/title>/i;
const SHELL_DESCRIPTION = /<meta name="description" content="([^"]*)">/i;

// withPageHead(html, request, env, url, storedBranding) -> the shell with its
// static title + description swapped for this page's head (before </head>).
// storedBranding may be a promise of it.
export async function withPageHead(html, request, env, url, brandingOrPromise) {
  if (!html.includes("</head>")) return html;
  // The caller may hand over the branding read still in flight (perf).
  const storedBranding = await brandingOrPromise;
  const name = storedBranding.name || BRANDING_DEFAULTS.name;
  const tagline = storedBranding.tagline || BRANDING_DEFAULTS.tagline;
  const shellDescription = html.match(SHELL_DESCRIPTION);
  const site = {
    name,
    title: `${name}: ${tagline}`,
    description: shellDescription ? attributeUnescape(shellDescription[1]) : `${name}: ${tagline}`,
  };
  const origin = siteOrigin(env, request);
  const image = ogImageUrl(env, origin);
  const head = await pageHead(request, env, url, site, origin);
  const feeds = [{ title: name, href: origin + feedPath(null) },
    ...(head.board ? [{ title: `${name} — ${head.board}`, href: origin + feedPath(head.board) }] : [])];
  const tags = renderHead({ ...head, feeds, ld: [...siteBlocks(site, origin, image), ...head.ld] }, site, image);
  // Function replacement: a string one would expand $' $` $& $$ in member
  // text and splice the rest of the shell into an attribute (v5.33 M1).
  return html.replace(SHELL_TITLE, "").replace(SHELL_DESCRIPTION, "").replace("</head>", () => tags + "</head>");
}
