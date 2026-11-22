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

// WebMCP: exposes the forum's public READ actions to in-browser AI agents via
// navigator.modelContext.registerTool. The API is experimental — browsers
// without it get a silent no-op (no DOM, no requests, no console output).
// Self-mounts on import; every tool reads through the shared api() wrapper
// (fetch only). One AbortController unregisters all tools on pagehide.
import { api } from "./api.js";
import { BOARDS } from "./boards.js";
import { i18nReady } from "./i18n.js";
import { maskedExcerpt } from "./markdown.js";
import { safeInternalPath } from "./safe-path.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const EXCERPT_CHARS = 280;
const MAX_QUERY_CHARS = 100;

const clampLimit = (value) => {
  const number = Number.isInteger(value) ? value : DEFAULT_LIMIT;
  return Math.min(Math.max(number, 1), MAX_LIMIT);
};

const textResult = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
});

const summarizePost = (post) => {
  const body = String(post?.body ?? "");
  return {
    id: post?.id,
    url: new URL(`/posts/${post?.id}`, location.origin).href,
    board: post?.board,
    author: post?.author?.username ?? null,
    createdAt: post?.createdAt,
    replyCount: post?.replyCount ?? 0,
    excerpt: maskedExcerpt(body, EXCERPT_CHARS),
  };
};

const summarizePosts = (posts, limit) =>
  (Array.isArray(posts) ? posts : []).slice(0, clampLimit(limit)).map(summarizePost);

const goTo = (path) => {
  // Agent-supplied ids feed these paths; only an internal path navigates.
  const internal = safeInternalPath(path);
  if (!internal) return textResult("Refused: not a forum path."); // i18n-ignore
  const url = new URL(internal, location.origin).href;
  location.assign(url);
  return textResult(`Navigating to ${url}`); // i18n-ignore
};

const limitSchema = {
  type: "integer",
  minimum: 1,
  maximum: MAX_LIMIT,
  description: `Maximum number of posts to return (default ${DEFAULT_LIMIT}).`, // i18n-ignore
};

const TOOLS = [
  {
    name: "search_posts",
    description: "Search Wempo's Forum posts by text. Returns matching posts with id, URL, board, author, date, reply count, and a body excerpt.", // i18n-ignore
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: MAX_QUERY_CHARS, description: "Text to search for." }, // i18n-ignore
        limit: limitSchema,
      },
      required: ["query"],
    },
    async execute({ query, limit } = {}) {
      const term = typeof query === "string" ? query.trim() : "";
      if (!term || term.length > MAX_QUERY_CHARS) {
        return textResult(`query must be 1-${MAX_QUERY_CHARS} characters.`); // i18n-ignore
      }
      const result = await api(`/api/search?q=${encodeURIComponent(term)}`);
      return textResult(summarizePosts(result?.posts, limit));
    },
  },
  {
    name: "recent_posts",
    description: "List the most recently active posts across all boards of Wempo's Forum.", // i18n-ignore
    inputSchema: { type: "object", properties: { limit: limitSchema } },
    async execute({ limit } = {}) {
      const feed = await api("/api/posts");
      return textResult(summarizePosts(feed?.posts, limit));
    },
  },
  {
    name: "open_post",
    description: "Open a forum post (thread) by its numeric id in the current page. Returns the post URL.", // i18n-ignore
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer", minimum: 1, description: "The post id." } }, // i18n-ignore
      required: ["id"],
    },
    async execute({ id } = {}) {
      const postId = Number(id);
      if (!Number.isInteger(postId) || postId < 1) return textResult("id must be a positive integer."); // i18n-ignore
      return goTo(`/posts/${postId}`);
    },
  },
  {
    name: "open_board",
    description: "Open a forum board (category) in the current page. Returns the board URL.", // i18n-ignore
    inputSchema: {
      type: "object",
      properties: {
        board: {
          type: "string",
          enum: BOARDS.map((board) => board.slug),
          description: "Board slug: " + BOARDS.map((board) => `${board.slug} (${board.label})`).join(", ") + ".", // i18n-ignore
        },
      },
      required: ["board"],
    },
    async execute({ board } = {}) {
      if (!BOARDS.some((entry) => entry.slug === board)) return textResult("Unknown board slug."); // i18n-ignore
      return goTo(`/c/${board}`);
    },
  },
];

const mountWebMcp = async () => {
  const modelContext = globalThis.navigator?.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== "function") return;
  await i18nReady();
  const controller = new AbortController();
  for (const tool of TOOLS) {
    try {
      modelContext.registerTool(tool, { signal: controller.signal });
    } catch {
      // Experimental API: a shape mismatch in one browser build must never
      // break the page; the remaining tools still try to register.
    }
  }
  globalThis.addEventListener?.("pagehide", () => controller.abort(), { once: true });
};

await mountWebMcp();
