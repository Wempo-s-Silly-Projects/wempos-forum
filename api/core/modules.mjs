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

// Per-deployment modules (docs/modules.md; parity audit 2026-11-22 §3). One
// frozen registry of the features an instance can switch off as a whole.
// Each module resolves, in order:
//   1. env hard-off: MODULE_<ID>=off (id upper-cased, "-" becomes "_"), or
//      the module's legacy switch (envKill: AUTOMOD_ENABLED,
//      ANALYTICS_ENABLED, HUMAN_CHECK, SATURDAY_FOOLS) not holding its "on"
//      value;
//   2. setup: a module whose secret is missing stays off (AutoMod's key);
//   3. the owner's row in instance_modules (desk, PUT /api/admin/modules);
//   4. the registry default.
// Then dependencies: a module whose dependency resolves off is off too.
// Defaults equal today's behaviour on wempos-forum.com; every NEW
// (Discourse-parity) module ships with default "off".
import { HUMAN_CHECK_MODES } from "../../constants.mjs";
import { HttpError } from "./http.mjs";
import { humanCheckMode } from "./human-check.mjs";

export const MODULE_ON = "on";
export const MODULE_OFF = "off";
export const MODULE_ENV_PREFIX = "MODULE_";
// Why a module resolved the way it did (the desk shows it).
export const MODULE_REASONS = Object.freeze({
  ENV: "env", SETUP: "setup", STORED: "stored", DEFAULT: "default", DEP: "dep",
});

const secretSet = (value) => typeof value === "string" && value.trim() !== "";

const entry = (fields) => Object.freeze({
  deps: Object.freeze([]), paths: Object.freeze([]), readOnly: false, client: false, ...fields,
});

// paths: the API routes the module owns (an exact string, a prefix ending in
// "/", or a RegExp). A path of an off module answers 404 before any handler.
// Staff read-back of stored history (/api/admin/automod, /api/admin/analytics,
// /api/admin/site-health, the chat and DM logs) is not gated.
// client: the module also runs in the browser; when off, its id rides the
// shell's site-modules-off meta so public/js/site-modules.js skips it.
export const MODULES = Object.freeze([
  entry({
    id: "automod", labelKey: "admin.section.automod", descriptionKey: "modules.desc.automod",
    default: MODULE_ON, envKill: "AUTOMOD_ENABLED",
    envAllows: (env) => env.AUTOMOD_ENABLED === "true",
    setupDone: (env) => secretSet(env.AUTOMOD_KEY),
    paths: Object.freeze(["/api/automod", "/api/automod/"]),
  }),
  entry({
    id: "analytics", labelKey: "admin.section.visits", descriptionKey: "modules.desc.analytics",
    default: MODULE_ON, envKill: "ANALYTICS_ENABLED",
    envAllows: (env) => env.ANALYTICS_ENABLED === "true",
  }),
  entry({
    id: "web-vitals", labelKey: "admin.section.siteHealth", descriptionKey: "modules.desc.webVitals",
    default: MODULE_ON, client: true, paths: Object.freeze(["/api/vitals"]),
  }),
  // Read-only: HUMAN_CHECK stays the one source of truth (anubis|altcha|off).
  entry({
    id: "human-check", labelKey: "modules.label.humanCheck", descriptionKey: "modules.desc.humanCheck",
    default: MODULE_ON, envKill: "HUMAN_CHECK", readOnly: true,
    envAllows: (env) => humanCheckMode(env) !== HUMAN_CHECK_MODES.OFF,
  }),
  entry({
    id: "chat", labelKey: "chat.title", descriptionKey: "modules.desc.chat",
    default: MODULE_ON, client: true, paths: Object.freeze(["/api/chat", "/api/chat/", "/api/dm/"]),
  }),
  entry({
    id: "polls", labelKey: "boards.pollsLabel", descriptionKey: "modules.desc.polls",
    default: MODULE_ON, paths: Object.freeze([/^\/api\/posts\/[0-9]+\/poll$/]),
  }),
  entry({
    id: "wall", labelKey: "wall.title", descriptionKey: "modules.desc.wall",
    default: MODULE_ON, paths: Object.freeze([/^\/api\/users\/[0-9]+\/wall$/, "/api/wall/"]),
  }),
  entry({
    id: "fun", labelKey: "fun.title", descriptionKey: "modules.desc.fun", default: MODULE_ON, client: true,
  }),
  // Built by the Saturday Fools lane: on only where SATURDAY_FOOLS = "on".
  entry({
    id: "saturday-fools", labelKey: "modules.label.saturdayFools", descriptionKey: "modules.desc.saturdayFools",
    default: MODULE_ON, envKill: "SATURDAY_FOOLS", deps: Object.freeze(["fun"]),
    envAllows: (env) => env.SATURDAY_FOOLS === "on",
  }),
  entry({
    id: "link-previews", labelKey: "safety.previewLabel", descriptionKey: "modules.desc.linkPreviews",
    default: MODULE_ON, client: true, paths: Object.freeze(["/api/link-preview"]),
  }),
  entry({
    id: "embeds", labelKey: "modules.label.embeds", descriptionKey: "modules.desc.embeds",
    default: MODULE_ON, client: true,
  }),
  // The in-forum translation service (docs/translating.md, migration 0096):
  // members suggest, staff review, the owner exports. New, so default off.
  entry({
    id: "translate", labelKey: "translate.nav", descriptionKey: "translate.moduleDesc",
    default: MODULE_OFF, client: true, paths: Object.freeze(["/api/translate", "/api/translate/"]),
  }),
  // Full-text search of post bodies (D1 FTS5, migration 0097): the /search
  // page, its API under /api/search/ and the owner's index backfill. The
  // classic GET /api/search (members + threads) is not under the prefix and
  // stays on. New, so default off.
  entry({
    id: "search", labelKey: "modules.label.search", descriptionKey: "modules.desc.search",
    default: MODULE_OFF, client: true, paths: Object.freeze(["/api/search/"]),
  }),
]);

const BY_ID = new Map(MODULES.map((module) => [module.id, module]));

export const moduleById = (id) => BY_ID.get(id) ?? null;
export const moduleEnvName = (id) => MODULE_ENV_PREFIX + id.toUpperCase().replace(/-/g, "_");

// The modules that depend (directly or through another) on `id`.
export function dependentsOf(id) {
  const found = new Set();
  const walk = (target) => {
    for (const module of MODULES) {
      if (module.deps.includes(target) && !found.has(module.id)) {
        found.add(module.id);
        walk(module.id);
      }
    }
  };
  walk(id);
  return [...found];
}

function envHardOff(module, env) {
  if (String(env[moduleEnvName(module.id)] ?? "").trim().toLowerCase() === MODULE_OFF) return true;
  return typeof module.envAllows === "function" && !module.envAllows(env);
}

// Own state, before dependencies: { enabled, reason, stored }.
function ownState(module, env, rows) {
  const stored = rows.has(module.id) ? rows.get(module.id) : null;
  if (envHardOff(module, env)) return { enabled: false, reason: MODULE_REASONS.ENV, stored };
  if (typeof module.setupDone === "function" && !module.setupDone(env)) {
    return { enabled: false, reason: MODULE_REASONS.SETUP, stored };
  }
  if (stored !== null && !module.readOnly) return { enabled: stored, reason: MODULE_REASONS.STORED, stored };
  return { enabled: module.default === MODULE_ON, reason: MODULE_REASONS.DEFAULT, stored };
}

// resolveModules(env, rows: Map<id, boolean>) -> Map<id, { enabled, reason, stored }>
export function resolveModules(env, rows = new Map()) {
  const safeEnv = env || {};
  const resolved = new Map();
  const resolve = (module) => {
    if (resolved.has(module.id)) return resolved.get(module.id);
    const own = ownState(module, safeEnv, rows);
    const depOff = own.enabled && module.deps.some((dep) => !resolve(BY_ID.get(dep)).enabled);
    const state = depOff ? { ...own, enabled: false, reason: MODULE_REASONS.DEP } : own;
    resolved.set(module.id, state);
    return state;
  };
  for (const module of MODULES) resolve(module);
  return resolved;
}

// The owner's rows from D1. A failed read (or a database still without
// migration 0095) logs and falls back to the registry defaults: today's
// behaviour.
export async function readModuleRows(env) {
  const rows = new Map();
  if (!env?.FORUM_DB) return rows;
  try {
    const { results } = await env.FORUM_DB.prepare("SELECT id, enabled FROM instance_modules").all();
    for (const row of results || []) {
      if (BY_ID.has(row.id)) rows.set(row.id, Number(row.enabled) === 1);
    }
  } catch (error) {
    console.error("Could not read instance modules; using the defaults:", error);
  }
  return rows;
}

// Per-request cache: one D1 read per request, however many gates ask.
const requestCache = new WeakMap();

export function moduleStates(env, request = null) {
  const key = request && typeof request === "object" ? request : null;
  if (key && requestCache.has(key)) return requestCache.get(key);
  const pending = readModuleRows(env).then((rows) => resolveModules(env, rows));
  if (key) requestCache.set(key, pending);
  return pending;
}

// After a desk write: the same request reads the new state.
export function forgetModuleStates(request) {
  if (request && typeof request === "object") requestCache.delete(request);
}

export async function isModuleOn(env, id, request = null) {
  if (!BY_ID.has(id)) throw new Error("Unknown module: " + id);
  return (await moduleStates(env, request)).get(id).enabled;
}

// moduleGate(env, id, request): the same 404 AutoMod answers when it is off.
export async function moduleGate(env, id, request = null) {
  if (!(await isModuleOn(env, id, request))) throw new HttpError(404, "Not found.");
}

const pathMatches = (pattern, path) => {
  if (pattern instanceof RegExp) return pattern.test(path);
  return pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern;
};

export const moduleForPath = (path) =>
  MODULES.find((module) => module.paths.some((pattern) => pathMatches(pattern, path)))?.id ?? null;

// The router's one gate: a path an off module owns answers 404.
export async function gateModulePath(request, env, path) {
  const id = moduleForPath(path);
  if (id) await moduleGate(env, id, request);
}

export async function onModuleIds(env, request = null) {
  const states = await moduleStates(env, request);
  return MODULES.filter((module) => states.get(module.id).enabled).map((module) => module.id);
}

// Browser-side modules that are off (the shell's site-modules-off meta).
export async function offClientModuleIds(env, request = null) {
  const states = await moduleStates(env, request);
  return MODULES.filter((module) => module.client && !states.get(module.id).enabled).map((module) => module.id);
}
