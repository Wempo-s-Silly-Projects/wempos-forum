// Rules page (v2.5): owner-editable site copy — GET /api/rules (public) and
// POST /api/admin/rules (admin-only; the desk has the editor). The rules'
// markdown renders via the same safe subset as post bodies; HTML stays
// literal and images/embeds never render (the markdown renderer's rules).
import { HttpError, json, nowSeconds, rateLimit, requireModerator, readLimitedBody } from "./shared.mjs";

const RULES_KEY = "rules";
export const RULES_MAX_BYTES = 20 * 1024;

export async function handleRulesRoutes(request, env, url, path, method) {
  if (path !== "/api/rules") return null;
  if (method === "GET") {
    const row = await env.FORUM_DB.prepare(
      "SELECT value, updated_at FROM site_settings WHERE key = ? LIMIT 1",
    ).bind(RULES_KEY).first();
    return json({
      rules: row ? row.value : "",
      updatedAt: row ? new Date(Number(row.updated_at) * 1000).toISOString() : null,
    });
  }
  if (method === "POST") {
    const session = await requireModerator(request, env);
    await rateLimit(request, env, "write");
    const raw = await readLimitedBody(request, RULES_MAX_BYTES + 1024);
    const text = new TextDecoder().decode(raw);
    // api() JSON-encodes the body (the CSS route's same convention): decode
    // the string payload.
    let rulesText = text.trim();
    const looksJson = (request.headers.get("Content-Type") || "").includes("application/json") ||
      (rulesText.startsWith("\"") && rulesText.endsWith("\"") && rulesText.length > 1);
    if (looksJson) {
      try {
        const parsed = JSON.parse(rulesText);
        rulesText = typeof parsed === "string" ? parsed : String(parsed?.rules ?? rulesText);
      } catch {
        /* a merely-quoted css-like value stays */
      }
    }
    rulesText = rulesText.trim();
    if (rulesText.length > RULES_MAX_BYTES) {
      throw new HttpError(413, "The rules must be 20 KiB or smaller.");
    }
    await env.FORUM_DB.batch([
      env.FORUM_DB.prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ).bind(RULES_KEY, rulesText, nowSeconds()),
    ]);
    return json({ saved: true, rules: rulesText });
  }
  return null;
}