// Text auto-mod (v3.1, owner's ask: "moderate the forum while mods are
// asleep"): a text classifier scores every fresh piece of member text —
// posts, replies, edits, chat messages, DMs — in the background, and
// quarantines what trips. The subsystem mirrors Vision's architecture exactly:
// secret-gated (no OPENAI_API_KEY = off, nothing scheduled), a separate
// site_settings kill switch ('text_mod_kill_switch' = '1') flipped from the
// desk with no redeploy, fail-open on any classifier error (the content
// simply stays up), and every action is a moderation_actions row (kind
// 'auto_text') so members appeal from the same Appeals page.
//
// ENGINE NOTE (owner's call, Nov 2026): the engine is the OpenAI Moderation
// API (omni-moderation-latest). The subsystem was first sketched on Google
// Perspective, which sunsets entirely on 2026-12-31 with no migration path,
// so the scoring call moved to the free, purpose-built moderation endpoint:
// every category is returned and enabled by default on every call, and
// OpenAI calibrates the `flagged` verdict server-side — no threshold bars for
// us to maintain and drift out of tune. Only this module's scoring call knows
// the engine; a future swap touches fetchModerationVerdict alone. OpenAI has
// no profanity category — the word filter already masks profanity on the way
// into the DB, so the bases stay covered.
//
// The ACTION is deliberately gentle: posts/replies are AUTO-HIDDEN, never
// deleted — a false positive costs a morning review in the hidden-posts
// desk, not lost content, and an approved appeal unhides in one click. Chat
// and DM messages have no hidden state to occupy, so those trip to a delete
// (the same permanence as any chat deletion). Auto-mod never bans and never
// touches accounts; bans stay a human decision.
import { assertNotBanned, requireStaff } from "./core/auth.mjs";
import { nowSeconds } from "./core/crypto.mjs";
import { json, readJson } from "./core/http.mjs";
import {
  containsFilteredWord,
  normalizeUsernameForFilter,
} from "./filter.mjs";

// The Moderation API is free, purpose-built, and category-calibrated
// server-side. The key lives ONLY in the OPENAI_API_KEY secret (wrangler
// secret put in production, .dev.vars locally) and rides the Authorization
// Bearer HEADER — never a URL parameter, same rule as the Google keys.
const MODERATION_URL = "https://api.openai.com/v1/moderations";
const MODERATION_MODEL = "omni-moderation-latest";
// Latency headroom inside waitUntil: hard timeout, fail-open below.
export const TEXT_MOD_TIMEOUT_MS = 8_000;
// omni-moderation accepts ~32k characters of input, but member text is
// capped tiny by the write paths (posts ≤1,000 chars, chat 500, DMs 1,000);
// this slice only defends against API-shape regressions like the OCR path
// (images can carry lots of text).
const TEXT_MOD_MAX_CHARS = 20000;

// The enable gate: the API key configures the subsystem at all.
export function isTextModConfigured(env) {
  return Boolean(env && env.OPENAI_API_KEY);
}

// The desk kill switch (v3.1): separate from the Vision switch so one
// subsystem can be stopped without the other — checked inside the background
// task, so flipping it takes effect on the very next piece of text.
export async function isTextModKilled(db) {
  const row = await db.prepare(
    "SELECT value FROM site_settings WHERE key = 'text_mod_kill_switch' LIMIT 1",
  ).first();
  return Boolean(row && row.value === "1");
}

export async function isTextModEnabled(db, env) {
  return isTextModConfigured(env) && !(await isTextModKilled(db));
}

// The scoring call. Returns { flagged, categories, categoryScores } on
// success or { error } on anything else (transport, non-200, unparseable) —
// callers fail open. Every category comes back on every call (harassment,
// hate, violence, self-harm, sexual, … — all enabled by default, owner's
// rule); `flagged` is OpenAI's own calibrated verdict over all of them.
export async function fetchModerationVerdict(env, text, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEXT_MOD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(MODERATION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: MODERATION_MODEL,
        input: String(text).slice(0, TEXT_MOD_MAX_CHARS),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { error: "OpenAI moderation responded with HTTP " + response.status };
    }
    const data = await response.json();
    const result = data && Array.isArray(data.results) && data.results[0];
    if (!result || typeof result.flagged !== "boolean") {
      return { error: "OpenAI moderation response carried no result" };
    }
    const categoryScores = {};
    for (const [key, value] of Object.entries(result.category_scores || {})) {
      // Only a real 0..1 number survives; junk becomes nothing so no
      // malformed OpenAI payload can ever score.
      if (typeof value === "number" && value >= 0 && value <= 1) {
        categoryScores[key] = value;
      }
    }
    if (Object.keys(categoryScores).length === 0) {
      return { error: "OpenAI moderation response carried no scores" };
    }
    return {
      flagged: result.flagged,
      categories: Object.entries(result.categories || {})
        .filter(([, value]) => value === true)
        .map(([key]) => key),
      categoryScores,
    };
  } catch (error) {
    return { error: "Text auto-mod check failed: " + String(error && error.message || error).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

// The SEVERE categories (v4.2, owner: "automod too sensitive"): OpenAI's
// umbrella `flagged` verdict covered every category — mild harassment banter,
// self-harm TALK, a passing sexual mention — and hid posts over them. An
// action now requires a clearly severe category to be flagged: threats to
// people, hate threats, sexual content involving minors, graphic violence,
// and explicit self-harm instruction/intent. Mild flags simply do nothing —
// no row, no hide, no appeal noise.
const SEVERE_TEXT_CATEGORIES = new Set([
  "harassment/threatening",
  "hate/threatening",
  "self-harm/instructions",
  "self-harm/intent",
  "sexual/minors",
  "violence/graphic",
]);

export function tripsTextAutoMod(verdict) {
  if (!verdict) return false;
  return (verdict.categories || []).some((category) => SEVERE_TEXT_CATEGORIES.has(category));
}

// The desk/appeal summary: the categories OpenAI flagged, with their scores.
function scoreSummary(verdict) {
  const flagged = verdict.categories || [];
  if (flagged.length === 0) return "flagged";
  return flagged
    .map((key) => key + " " +
      Number(verdict.categoryScores[key]).toFixed(2))
    .join(", ");
}

// The stored verdicts payload (moderation_actions.verdicts, shown on the
// desk and the appeals queue): only what tripped, so the JSON reads clean.
function verdictsPayload(verdict) {
  const flagged = {};
  for (const key of verdict.categories || []) {
    flagged[key] = verdict.categoryScores[key];
  }
  return { flagged: verdict.flagged, categories: flagged };
}

// The quarantine action per surface. Posts/replies HIDE (visibility='hidden'
// — the existing hidden-posts desk picks them up; never a delete, so an
// appeal or a mod click restores the content intact). The visibility guard
// means a mod who already hid or handled the post is never crossed, and a
// staged-attachment post still waiting on its publish cannot be touched.
// Chat/DM rows have no hidden state, so they delete — the same permanence as
// any staff chat deletion (chat is ephemeral by design).
function textRemovalStatement(db, target) {
  if (target.kind === "post") {
    return db.prepare("UPDATE posts SET visibility = 'hidden' WHERE id = ? AND visibility = 'public'")
      .bind(Number(target.entityId));
  }
  if (target.kind === "chat") {
    return db.prepare("DELETE FROM chat_messages WHERE id = ?").bind(Number(target.entityId));
  }
  if (target.kind === "wall") {
    return db.prepare("DELETE FROM wall_posts WHERE id = ?").bind(Number(target.entityId));
  }
  return db.prepare("DELETE FROM dm_messages WHERE id = ?").bind(Number(target.entityId));
}

// input: { kind: 'post'|'chat'|'dm'|'wall', entityId, userId, text, postId = null }
// (postId is the thread ROOT for post notifications; replies carry their own
// id as entityId).
export async function runTextCheck(env, input, fetchImpl = fetch) {
  const db = env.FORUM_DB;
  // The desk kill switch: re-read inside the task so a flip stops the very
  // next background check with no deploy.
  if (await isTextModKilled(db)) return;
  // One live action per text entity: repeated reports or edits of the same
  // post never stack rows (the appeal resolves the one action).
  const existing = await db.prepare(
    "SELECT 1 FROM moderation_actions WHERE kind = 'auto_text' AND entity_kind = ? " +
      "AND entity_id = ? AND reversed_at IS NULL LIMIT 1",
  ).bind(input.kind, String(input.entityId)).first();
  if (existing) return;

  const verdict = await fetchModerationVerdict(env, input.text, fetchImpl);
  // Fail open: a classifier error leaves the content exactly as it was —
  // the human desks stay the only backstop. No row is recorded (unlike
  // Vision, there is no pending queue the text was waiting on).
  if (verdict.error) return;
  if (!tripsTextAutoMod(verdict)) return;

  const now = nowSeconds();
  const isPost = input.kind === "post";
  const reason = isPost
    ? "Auto-mod hid this post for review (OpenAI moderation: " + scoreSummary(verdict) + ")."
    : "Auto-mod removed this message (OpenAI moderation: " + scoreSummary(verdict) + ").";
  await db.batch([
    textRemovalStatement(db, { kind: input.kind, entityId: input.entityId }),
    // content_preview (v4.2): the exact flagged words — the appeal cards
    // (and the chat/DM staff logs) must show WHAT tripped the classifier,
    // even after the chat/DM message was deleted and the post hidden.
    db.prepare(
      "INSERT INTO moderation_actions (user_id, kind, entity_kind, entity_id, hash, reason, verdicts, content_preview, created_at) " +
        "VALUES (?, 'auto_text', ?, ?, NULL, ?, ?, ?, ?)",
    ).bind(Number(input.userId), input.kind, String(input.entityId), reason,
      JSON.stringify(verdictsPayload(verdict)), String(input.text).slice(0, 2000), now),
    db.prepare(
      "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) " +
        "VALUES (?, ?, ?, ?, ?)",
    ).bind(Number(input.userId), isPost ? Number(input.postId ?? input.entityId) : null,
      isPost ? Number(input.entityId) : null, now,
      (isPost
        ? "Auto-mod hid your post for review. If this was a mistake, appeal it from your profile's Appeals page."
        : "Auto-mod removed your message. If this was a mistake, appeal it from your profile's Appeals page."
      ).slice(0, 200)),
  ]);
}

// OCR text evaluation (v3.1, owner's ask): Vision's TEXT_DETECTION extracts
// text embedded in an image, and THIS function decides whether that text is
// removable — closing the "slur baked into a PNG" hole. Two judges, in order:
// the WORD FILTER (always on, through the same hardened normalization as
// typed text — a filtered word inside the pixels is a filtered word), then
// the moderation classifier (when configured). The word-filter half needs no
// text-mod configuration and ignores the text-mod kill switch (the word
// filter never had one); the classifier half respects it like every other
// text check. Vision's own kill switch gates the whole OCR pass upstream —
// this function only ever runs inside a Vision check. Returns
// { tripped, reason }.
export async function evaluateExtractedText(env, text, fetchImpl = fetch) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return { tripped: false };
  const normalized = normalizeUsernameForFilter(trimmed);
  if (normalized && containsFilteredWord(normalized, env.FILTERED_WORDS)) {
    return {
      tripped: true,
      reason: "Auto-mod removed this image (filtered word embedded in the image text).",
    };
  }
  if (!isTextModConfigured(env)) return { tripped: false };
  if (await isTextModKilled(env.FORUM_DB)) return { tripped: false };
  const verdict = await fetchModerationVerdict(env, trimmed, fetchImpl);
  // Fail open — a classifier error never removes an image.
  if (verdict.error) return { tripped: false };
  if (tripsTextAutoMod(verdict)) {
    return {
      tripped: true,
      reason: "Auto-mod removed this image (OpenAI moderation on embedded text: " +
        scoreSummary(verdict) + ").",
    };
  }
  return { tripped: false };
}

// Writers call this right after the content commits. No-op when the
// subsystem is unconfigured; the kill switch is re-read inside the task. The
// work rides ctx.waitUntil so the write response never waits on OpenAI.
export function scheduleTextCheck(ctx, env, input) {
  if (!isTextModConfigured(env) || !input.text || input.text.length === 0) return;
  const task = runTextCheck(env, input).catch((error) => {
    console.error("Text auto-mod background check failed:", error);
  });
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(task);
  }
  // No ctx (tests, non-Worker callers): the promise still runs best-effort.
}

// Desk routes (v3.1): the status read powers the Auto-mod panel alongside
// the Vision one, and the kill-switch POST is text auto-mod's emergency
// stop — SEPARATE from the Vision switch so one subsystem can be stopped
// without the other, and INDEPENDENT of the key: changing or deleting the
// OPENAI_API_KEY secret can never reset a tripped switch.
export async function handleTextModAdminRoutes(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/text-mod" && method === "GET") {
    await requireStaff(request, env, false);
    return json({
      configured: isTextModConfigured(env),
      killSwitch: await isTextModKilled(db),
    });
  }
  if (path === "/api/admin/text-mod-kill-switch" && method === "POST") {
    const session = await requireStaff(request, env);
    await assertNotBanned(env, session.user.id);
    const body = await readJson(request);
    const tripped = body.tripped === true || body.tripped === "true";
    if (tripped) {
      await db.batch([
        db.prepare(
          "INSERT INTO site_settings (key, value, updated_at) VALUES ('text_mod_kill_switch', '1', ?) " +
            "ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at",
        ).bind(nowSeconds()),
      ]);
    } else {
      await db.batch([
        db.prepare("DELETE FROM site_settings WHERE key = 'text_mod_kill_switch'"),
      ]);
    }
    return json({ configured: isTextModConfigured(env), killSwitch: tripped });
  }
  return null;
}
