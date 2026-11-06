// Filter store (v4.3): the word-filter list lives in D1 (site_settings key
// "filtered_words") and is edited from the admin desk — a full-list editor and
// a bulk-add box. The FILTERED_WORDS secret keeps serving as the fallback
// until the first desk save writes the D1 row, after which the D1 value (even
// an emptied one) is the single source of truth.
//
// applyWordFilter stays synchronous and pure (api/filter.mjs), so the list is
// primed once per isolate with a short TTL cache: worker.mjs awaits
// ensureFilterWords(env) at the top of every API request, and the topic
// modules read the effective value through filterWords(env) where they used
// to read env.FILTERED_WORDS. A failed or missing site_settings read (older
// database, pre-migration) silently keeps the secret as the source.
import { requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { HttpError, json, rateLimit, readLimitedBody } from "./core/http.mjs";
import { splitFilterEntries } from "./filter.mjs";

const FILTER_KEY = "filtered_words";
// The desk-stored list gets a generous ceiling (the owner's imported list is
// large; 256 KiB covers ~100k words) — far above the read-body limit.
export const FILTER_MAX_BYTES = 256 * 1024;
const CACHE_TTL_MS = 30_000;

// Isolate-level cache: { loaded, raw, at }. The three states matter: before
// any successful read the secret wins; after a read (row present, even an
// empty one) the D1 value wins.
const cache = { loaded: false, raw: "", at: 0 };

export async function ensureFilterWords(env) {
  if (cache.loaded && Date.now() - cache.at < CACHE_TTL_MS) return;
  try {
    const row = await env.FORUM_DB.prepare(
      "SELECT value, updated_at FROM site_settings WHERE key = ? LIMIT 1",
    ).bind(FILTER_KEY).first();
    if (row) {
      cache.raw = String(row.value ?? "");
      cache.loaded = true;
      cache.at = Date.now();
    }
  } catch {
    /* no site_settings yet: keep the secret as the source */
  }
}

// The effective list: the desk's D1 row once it exists, otherwise the secret.
export function filterWords(env) {
  return cache.loaded ? cache.raw : (env.FILTERED_WORDS ?? "");
}

export function filterWordsSource(env) {
  return cache.loaded ? "database" : (env.FILTERED_WORDS ? "secret" : "none");
}

async function saveFilterWords(env, raw) {
  await env.FORUM_DB.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(FILTER_KEY, raw, nowSeconds()).run();
  cache.raw = raw;
  cache.loaded = true;
  cache.at = Date.now();
}

function filterUpdatedAt(row) {
  return row && Number.isFinite(Number(row.updated_at))
    ? new Date(Number(row.updated_at) * 1000).toISOString()
    : null;
}

export async function handleFilterAdminRoutes(request, env, url, path, method) {
  if (path !== "/api/admin/filter" && path !== "/api/admin/filter/entries") return null;

  if (method === "GET" && path === "/api/admin/filter") {
    const session = await requireStaff(request, env);
    await rateLimit(request, env, "read");
    const row = await env.FORUM_DB.prepare(
      "SELECT value, updated_at FROM site_settings WHERE key = ? LIMIT 1",
    ).bind(FILTER_KEY).first();
    return json({
      // The editor prefills with the CURRENT effective list — the D1 row when
      // it exists, otherwise the secret — so a first save migrates in place.
      words: filterWords(env),
      source: filterWordsSource(env),
      totalEntries: splitFilterEntries(filterWords(env)).filter((entry) => entry.trim()).length,
      updatedAt: row ? filterUpdatedAt(row) : null,
    });
  }

  if (method === "POST" && path === "/api/admin/filter/entries") {
    // Bulk add: paste lines (or comma-separated batches); every new entry
    // appends to the stored list. Reuses the filter's own entry-splitting so
    // a parsed line that is really one regex pattern (commas inside a char
    // class) stays whole, exactly like the filter will read it.
    const session = await requireStaff(request, env);
    await rateLimit(request, env, "write");
    const body = await readJsonBody(request, 512 * 1024);
    const incoming = splitFilterEntries(String(body.entries ?? ""))
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!incoming.length) throw new HttpError(400, "Paste at least one entry to add.");
    const current = filterWords(env);
    const existing = new Set(
      splitFilterEntries(current).map((entry) => entry.trim().toLowerCase()).filter(Boolean),
    );
    const additions = [];
    for (const entry of incoming) {
      const key = entry.toLowerCase();
      if (existing.has(key)) continue;
      existing.add(key);
      additions.push(entry);
    }
    if (additions.length) {
      const base = current.trimEnd();
      const joined = additions.join("\n");
      const next = base ? base + "\n" + joined : joined;
      if (next.length > FILTER_MAX_BYTES) {
        throw new HttpError(413, "The filter list is full (256 KiB cap). Remove entries first.");
      }
      await saveFilterWords(env, next);
    }
    return json({
      added: additions.length,
      skipped: incoming.length - additions.length,
      totalEntries: splitFilterWordsCount(filterWords(env)),
    });
  }

  if (method === "PUT" && path === "/api/admin/filter") {
    // Full-list replace: the editor's textarea is the new truth.
    const session = await requireStaff(request, env);
    await rateLimit(request, env, "write");
    const body = await readJsonBody(request, FILTER_MAX_BYTES * 2);
    const words = typeof body.words === "string" ? body.words : "";
    // Normalizing once (line ends, trailing whitespace) keeps round-trips
    // stable: the desk re-prefills with exactly what the filter will read.
    // Saving an EMPTY list is allowed and deliberate — it turns the filter off
    // (the D1 row, once present, overrides the secret even when empty).
    const clean = words.replace(/\r\n?/g, "\n").trimEnd();
    if (clean.length > FILTER_MAX_BYTES) {
      throw new HttpError(413, "The filter list must be 256 KiB or smaller.");
    }
    await saveFilterWords(env, clean);
    return json({
      saved: true,
      totalEntries: splitFilterWordsCount(filterWords(env)),
    });
  }

  return null;
}

// Body decoding shared by the two write routes: JSON object payloads carry the
// fields; a bare string body is treated as { words } / { entries } directly.
async function readJsonBody(request, maximum) {
  const raw = new TextDecoder().decode(await readLimitedBody(request, maximum));
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { words: raw, entries: raw };
  } catch {
    return { words: raw, entries: raw };
  }
}

function splitFilterWordsCount(raw) {
  return splitFilterEntries(raw).filter((entry) => entry.trim()).length;
}
