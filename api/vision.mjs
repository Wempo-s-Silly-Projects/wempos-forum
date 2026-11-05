// Google Cloud Vision middleman (v3.1): an optional, secret-gated first-pass
// content screen sitting between every image intake (attachments, gallery,
// avatars) and the human moderation queues. The GOOGLE_VISION_API_KEY secret
// is the enable gate (absent key = the subsystem is off, permanently, and
// nothing is scheduled at all); the KILL SWITCH is a site_settings toggle
// ('vision_kill_switch' = '1') flipped from the admin desk, effective on the
// very next upload with no deploy. The check runs in ctx.waitUntil — the
// upload response never waits on Google.
//
// Behavior: SAFE_SEARCH_DETECTION verdicts land in vision_verdicts and show
// on the moderation desks. When adult or violence comes back LIKELY or
// VERY_LIKELY, auto-mod REMOVES the pending upload (it was invisible to the
// public already; only the uploader loses it), records a moderation_actions
// row, and notifies the member — who can appeal. An approved appeal allowlists
// the content hash so a re-upload is never auto-removed again. Vision errors
// are fail-open: the item stays in the human queue exactly as before.
//
// OCR (v3.1, owner's ask): the same annotate call also requests
// TEXT_DETECTION, and any text embedded in the image is judged like typed
// text (api/textmod.mjs's evaluateExtractedText — the word filter always,
// the moderation classifier when configured). A trip on the embedded text
// removes the image through the exact same path as a SafeSearch trip.
import {
  assertNotBanned,
  blobToUint8Array,
  json,
  nowSeconds,
  readJson,
  requiremod,
} from "./shared.mjs";
import { evaluateExtractedText } from "./textmod.mjs";

const VISION_ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate";
// Vision latency headroom inside waitUntil: hard timeout, fail-open below.
export const VISION_TIMEOUT_MS = 10_000;
// SafeSearch likelihood order for threshold comparisons. Anything the response
// carries outside this map (or UNKNOWN) scores -1 and can never trip auto-mod.
const LIKELIHOOD_ORDER = {
  VERY_UNLIKELY: 0,
  UNLIKELY: 1,
  POSSIBLE: 2,
  LIKELY: 3,
  VERY_LIKELY: 4,
};
// Auto-mod policy (v3.1, owner's call): adult and violence at LIKELY or worse
// remove the pending upload. Racy/spoof/medical are display-only — racy covers
// swimwear-tier content and spoof/medical false-positive far too easily for
// automated removal. Change the score to 4 to require VERY_LIKELY.
export const AUTO_MOD_THRESHOLDS = { adult: 3, violence: 3 };
const AUTO_MOD_CATEGORIES = ["adult", "violence"];

// The enable gate: the API key configures the subsystem at all. Neither the
// key nor its absence ever lives in wrangler.toml or the repo.
export function isVisionConfigured(env) {
  return Boolean(env && env.GOOGLE_VISION_API_KEY);
}

// The panel kill switch (v3.1): site_settings key 'vision_kill_switch',
// '1' = tripped. Checked inside the background task — never on the upload's
// hot path — so flipping it takes effect on the next upload with no deploy.
export async function isVisionKilled(db) {
  const row = await db.prepare(
    "SELECT value FROM site_settings WHERE key = 'vision_kill_switch' LIMIT 1",
  ).first();
  return Boolean(row && row.value === "1");
}

export async function isVisionEnabled(db, env) {
  return isVisionConfigured(env) && !(await isVisionKilled(db));
}

export function likelihoodScore(value) {
  return typeof value === "string" ? (LIKELIHOOD_ORDER[value] ?? -1) : -1;
}

export function tripsAutoMod(verdicts) {
  if (!verdicts) return false;
  return AUTO_MOD_CATEGORIES.some(
    (category) => likelihoodScore(verdicts[category]) >= AUTO_MOD_THRESHOLDS[category],
  );
}

// Pulls the SafeSearch annotation out of an images:annotate response. Only the
// five canonical likelihood strings survive; anything else (missing category,
// UNKNOWN, junk) becomes null so no malformed Google payload can ever score.
export function parseSafeSearch(responseJson) {
  const annotation =
    responseJson &&
    Array.isArray(responseJson.responses) &&
    responseJson.responses[0] &&
    responseJson.responses[0].safeSearchAnnotation;
  if (!annotation) return null;
  const verdicts = {};
  for (const category of ["adult", "medical", "spoof", "violence", "racy"]) {
    verdicts[category] =
      typeof annotation[category] === "string" && annotation[category] in LIKELIHOOD_ORDER
        ? annotation[category]
        : null;
  }
  return verdicts;
}

// OCR (v3.1, owner's ask): the same annotate call requests TEXT_DETECTION,
// and the embedded text (fullTextAnnotation.text, the aggregate block)
// rides back with the SafeSearch verdicts — a slur baked into a PNG gets
// judged like a typed one (api/textmod.mjs's evaluateExtractedText). Missing
// or non-string text is "" (most images carry no words).
export function parseEmbeddedText(responseJson) {
  const annotation =
    responseJson &&
    Array.isArray(responseJson.responses) &&
    responseJson.responses[0] &&
    responseJson.responses[0].fullTextAnnotation;
  return annotation && typeof annotation.text === "string" ? annotation.text : "";
}

// Chunked base64 (String.fromCharCode on >32k args blows the stack).
export function base64Bytes(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

function verdictSummary(verdicts) {
  return AUTO_MOD_CATEGORIES
    .filter((category) => likelihoodScore(verdicts[category]) >= 3)
    .map((category) => category + ": " + verdicts[category])
    .join(", ");
}

// The annotate call itself. Returns { verdicts, ocrText } on success or
// { error } on anything else (transport, non-200, unparseable) — callers fail
// open. One request carries both features (SafeSearch + TEXT_DETECTION), so
// OCR adds no second Google call per image.
export async function fetchVisionVerdict(env, bytes, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    // x-goog-api-key header, never ?key= in the URL — request URLs can end up
    // in logs; the header does not.
    const response = await fetchImpl(VISION_ANNOTATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GOOGLE_VISION_API_KEY,
      },
      body: JSON.stringify({
        requests: [
          {
            features: [
              { type: "SAFE_SEARCH_DETECTION" },
              { type: "TEXT_DETECTION" },
            ],
            image: { content: base64Bytes(bytes) },
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { error: "Vision responded with HTTP " + response.status };
    }
    const responseJson = await response.json();
    const verdicts = parseSafeSearch(responseJson);
    if (!verdicts) {
      return { error: "Vision response carried no SafeSearch annotation" };
    }
    return { verdicts, ocrText: parseEmbeddedText(responseJson) };
  } catch (error) {
    return { error: "Vision check failed: " + String(error && error.message || error).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function storeVerdictRow(db, { kind, entityId, version, verdicts, error }) {
  const now = nowSeconds();
  return db.prepare(
    "INSERT INTO vision_verdicts (kind, entity_id, version, adult, medical, spoof, violence, racy, error, checked_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(kind, entity_id) DO UPDATE SET version = excluded.version, adult = excluded.adult, " +
      "medical = excluded.medical, spoof = excluded.spoof, violence = excluded.violence, racy = excluded.racy, " +
      "error = excluded.error, checked_at = excluded.checked_at",
  ).bind(kind, String(entityId), version || null,
    verdicts ? verdicts.adult : null, verdicts ? verdicts.medical : null,
    verdicts ? verdicts.spoof : null, verdicts ? verdicts.violence : null,
    verdicts ? verdicts.racy : null, error || null, now);
}

// The auto-mod removal itself — the exact statements the human desks use, so
// cleanup semantics (chunk cascades, pending-only guards) match by construction.
function autoModRemovalStatements(db, { kind, entityId }) {
  if (kind === "attachment") {
    return db.prepare("DELETE FROM attachments WHERE id = ? AND status = 'pending'").bind(String(entityId));
  }
  if (kind === "gif") {
    return db.prepare("DELETE FROM gifs WHERE id = ? AND status = 'pending'").bind(String(entityId));
  }
  // Avatar: clear the pending mirror exactly like a mod rejection — an
  // already-approved avatar returns to serving, a first upload goes blank.
  return db.prepare(
    "UPDATE users SET pending_avatar_mime = NULL, pending_avatar_data = NULL, " +
      "pending_avatar_updated_at = NULL, pending_avatar_version = NULL, " +
      "avatar_status = CASE WHEN avatar_mime IS NOT NULL THEN 'approved' ELSE NULL END " +
      "WHERE id = ? AND avatar_status = 'pending'",
  ).bind(Number(entityId));
}

function notifyStatement(db, userId, label) {
  return db.prepare(
    "INSERT INTO notifications (user_id, target_post_id, reply_id, created_at, label) " +
      "VALUES (?, NULL, NULL, ?, ?)",
  ).bind(userId, nowSeconds(), label.slice(0, 200));
}

export async function runVisionCheck(env, input, fetchImpl = fetch) {
  const db = env.FORUM_DB;
  const { kind, entityId, bytes, userId } = input;
  // Panel kill switch: re-read inside the task so a desk flip stops the very
  // next background check with no deploy and no latency cost to uploads.
  if (await isVisionKilled(db)) return;
  const result = await fetchVisionVerdict(env, bytes, fetchImpl);

  if (result.error) {
    // Fail open: record the outage on the verdict row, take no action. The
    // item sits in the human queue exactly as it would have without Vision.
    await db.batch([
      storeVerdictRow(db, { kind, entityId, version: input.version, verdicts: null, error: result.error }),
    ]);
    return;
  }

  const verdicts = result.verdicts;
  const hash = input.hash || null;

  // An approved appeal allowlisted this exact content: never auto-remove
  // again, but still store the fresh verdict for the desks.
  const overridden = hash
    ? await db.prepare("SELECT 1 FROM auto_mod_overrides WHERE hash = ? LIMIT 1").bind(hash).first()
    : null;

  // OCR: embedded text goes through the same judges as typed text. A trip
  // removes through the identical path as a SafeSearch trip — one action row,
  // one notification, one appeal. When BOTH trip, the SafeSearch reason
  // wins (the stronger, category-specific verdict).
  const ocr = result.ocrText
    ? await evaluateExtractedText(env, result.ocrText, fetchImpl)
    : { tripped: false };
  if ((tripsAutoMod(verdicts) || ocr.tripped) && !overridden) {
    const reason = tripsAutoMod(verdicts)
      ? "Auto-mod removed this image (Google Vision: " + verdictSummary(verdicts) + ")."
      : ocr.reason;
    await db.batch([
      storeVerdictRow(db, { kind, entityId, version: input.version, verdicts, error: null }),
      autoModRemovalStatements(db, { kind, entityId }),
      db.prepare(
        "INSERT INTO moderation_actions (user_id, kind, entity_kind, entity_id, hash, reason, verdicts, created_at) " +
          "VALUES (?, 'auto_image', ?, ?, ?, ?, ?, ?)",
      ).bind(userId, kind, String(entityId), hash, reason,
        JSON.stringify(verdicts), nowSeconds()),
      notifyStatement(db, userId,
        "Auto-mod removed one of your images. If this was a mistake, appeal it from your profile's Appeals page."),
    ]);
    return;
  }

  await db.batch([
    storeVerdictRow(db, { kind, entityId, version: input.version, verdicts, error: null }),
  ]);
}

// Intakes call this right after the pending row commits. No-op when the
// subsystem is unconfigured (no API key); the kill-switch toggle is checked
// inside the task. The work rides ctx.waitUntil so the upload response
// returns without waiting on Google. Everything inside fails open and never
// throws back into the request path.
export function scheduleVisionCheck(ctx, env, input) {
  if (!isVisionConfigured(env) || !input.bytes || input.bytes.length === 0) return;
  const task = runVisionCheck(env, input).catch((error) => {
    console.error("Vision background check failed:", error);
  });
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(task);
  }
  // No ctx (tests, non-Worker callers): the promise still runs best-effort.
}

// ---------------------------------------------------------------------------
// Report-triggered re-check (v3.1, owner's ask): a filed report re-runs
// SafeSearch over EVERY image on the reported target — including content the
// intake check already passed, because a report is a fresh human signal and
// Vision's verdicts drift. Post reports sweep all of that post's attachments
// (pending AND approved, library-GIF reference rows included); profile reports
// sweep both avatar sets. The policy is intake's exactly: LIKELY+ adult or
// violence removes, appeal-allowlisted hashes never re-flag, the kill switch
// stops the whole task, Vision errors fail open, and every removal is a
// moderation_actions row — so the member can appeal from the same Appeals
// page and an approval allowlists the hash against future re-checks.

// Chunk concatenation, shared shape of attachment_chunks/gif_chunks assembly.
function concatBlobRows(result) {
  const chunks = ((result && result.results) || []).map((row) => blobToUint8Array(row.data));
  if (chunks.length === 0) return null;
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

// Byte resolution for one attachment row, mirroring the serving path exactly:
// the row's own chunk set first (kind follows moderation status), then the
// canonical by hash — a deduplicated upload or a library-GIF reference row
// stores no bytes of its own. Kept local because attachments.mjs and gifs.mjs
// import this module (no circular import for two SELECT builders).
async function recheckAttachmentBytes(db, row) {
  const own = await concatBlobRows(await db.prepare(
    "SELECT data FROM attachment_chunks WHERE attachment_id = ? AND kind = ? ORDER BY seq",
  ).bind(row.id, row.status).all());
  if (own) return own;
  if (!row.hash) return null;
  const canonical = await db.prepare(
    "SELECT a.id FROM attachments a WHERE a.hash = ? AND a.status = 'approved' " +
      "AND EXISTS (SELECT 1 FROM attachment_chunks c WHERE c.attachment_id = a.id AND c.kind = 'approved') " +
      "ORDER BY a.created_at ASC LIMIT 1",
  ).bind(row.hash).first();
  if (canonical) {
    const bytes = await concatBlobRows(await db.prepare(
      "SELECT data FROM attachment_chunks WHERE attachment_id = ? AND kind = 'approved' ORDER BY seq",
    ).bind(canonical.id).all());
    if (bytes) return bytes;
  }
  const gif = await db.prepare(
    "SELECT id FROM gifs WHERE hash = ? AND status = 'approved' LIMIT 1",
  ).bind(row.hash).first();
  if (gif) {
    return concatBlobRows(await db.prepare(
      "SELECT data FROM gif_chunks WHERE gif_id = ? ORDER BY seq",
    ).bind(gif.id).all());
  }
  return null;
}

// Avatar bytes live in single BLOB columns, not chunks. column is from a
// fixed two-entry whitelist below, never caller input.
async function recheckAvatarBytes(db, userId, column) {
  const row = await db.prepare(
    "SELECT " + column + " AS data FROM users WHERE id = ? LIMIT 1",
  ).bind(userId).first();
  return row && row.data ? blobToUint8Array(row.data) : null;
}

// Removal for a report re-check trip. Unlike intake (which can only remove a
// pending upload), the re-check may take down LIVE content — that is its job —
// but always through the same guarded, idempotent statements the desks use.
function recheckRemovalStatement(db, target) {
  if (target.kind === "attachment") {
    // The status guard keeps a desk decision made mid-check from being
    // crossed (an already-rejected row deletes zero rows, harmlessly).
    return db.prepare("DELETE FROM attachments WHERE id = ? AND status = ?")
      .bind(target.entityId, target.status);
  }
  if (target.mirror === "pending") {
    // Intake's exact mirror clear: the previously approved avatar (if any)
    // returns to serving.
    return db.prepare(
      "UPDATE users SET pending_avatar_mime = NULL, pending_avatar_data = NULL, " +
        "pending_avatar_updated_at = NULL, pending_avatar_version = NULL, " +
        "avatar_status = CASE WHEN avatar_mime IS NOT NULL THEN 'approved' ELSE NULL END " +
        "WHERE id = ? AND avatar_status = 'pending'",
    ).bind(Number(target.entityId));
  }
  // The live approved avatar blanks, exactly like a mod removal would.
  return db.prepare(
    "UPDATE users SET avatar_mime = NULL, avatar_data = NULL, " +
      "avatar_updated_at = NULL, avatar_version = NULL " +
      "WHERE id = ? AND avatar_mime IS NOT NULL",
  ).bind(Number(target.entityId));
}

export async function runReportVisionRecheck(env, input, fetchImpl = fetch) {
  const db = env.FORUM_DB;
  // The panel kill switch gates the re-check too — one click stops intake
  // checks AND report sweeps, effective on the next filed report.
  if (await isVisionKilled(db)) return;

  const targets = [];
  if (Number.isSafeInteger(input.postId) && input.postId > 0) {
    // Every image on the reported post: direct uploads and library-GIF
    // reference rows alike, pending AND approved ("scan everything").
    const rows = (await db.prepare(
      "SELECT id, status, hash, version, created_by FROM attachments " +
        "WHERE post_id = ? AND status IN ('pending', 'approved') ORDER BY created_at",
    ).bind(input.postId).all()).results || [];
    for (const row of rows) {
      targets.push({
        kind: "attachment",
        entityId: row.id,
        status: row.status,
        hash: row.hash || null,
        version: row.version || null,
        userId: Number(row.created_by),
        load: () => recheckAttachmentBytes(db, row),
      });
    }
  }
  if (Number.isSafeInteger(input.userId) && input.userId > 0) {
    // Profile reports sweep both avatar sets: the approved one is serving
    // publicly, the pending mirror is waiting on the desk.
    const user = await db.prepare(
      "SELECT id, avatar_mime, avatar_version, pending_avatar_mime, pending_avatar_version " +
        "FROM users WHERE id = ? LIMIT 1",
    ).bind(input.userId).first();
    if (user) {
      const mirrors = [
        user.avatar_mime
          ? { mirror: "approved", column: "avatar_data", version: user.avatar_version }
          : null,
        user.pending_avatar_mime
          ? { mirror: "pending", column: "pending_avatar_data", version: user.pending_avatar_version }
          : null,
      ];
      for (const mirror of mirrors) {
        if (!mirror) continue;
        targets.push({
          kind: "avatar",
          entityId: String(user.id),
          mirror: mirror.mirror,
          hash: null, // avatars are hashless, like their intake checks
          version: mirror.version || null,
          userId: Number(user.id),
          load: () => recheckAvatarBytes(db, Number(user.id), mirror.column),
        });
      }
    }
  }

  // Dedup twins (same content hash) share one Vision call per task — and one
  // embedded-text evaluation, since identical bytes extract identical text.
  const verdictCache = new Map();
  for (const target of targets) {
    const bytes = await target.load();
    if (!bytes || bytes.length === 0) continue;
    let cached = target.hash ? verdictCache.get(target.hash) : undefined;
    if (cached === undefined) {
      const result = await fetchVisionVerdict(env, bytes, fetchImpl);
      if (result.error) {
        // Fail open: the outage lands on the verdict row, nothing is removed.
        await db.batch([
          storeVerdictRow(db, {
            kind: target.kind, entityId: target.entityId, version: target.version,
            verdicts: null, error: result.error,
          }),
        ]);
        cached = null;
      } else {
        cached = {
          verdicts: result.verdicts,
          ocr: result.ocrText
            ? await evaluateExtractedText(env, result.ocrText, fetchImpl)
            : { tripped: false },
        };
      }
      if (target.hash) verdictCache.set(target.hash, cached);
    }
    if (!cached) continue;
    const verdicts = cached.verdicts;

    const overridden = target.hash
      ? await db.prepare("SELECT 1 FROM auto_mod_overrides WHERE hash = ? LIMIT 1")
          .bind(target.hash).first()
      : null;
    if ((tripsAutoMod(verdicts) || cached.ocr.tripped) && !overridden) {
      const reason = tripsAutoMod(verdicts)
        ? "Auto-mod removed this image after a member report (Google Vision: " +
          verdictSummary(verdicts) + ")."
        : cached.ocr.reason;
      await db.batch([
        storeVerdictRow(db, {
          kind: target.kind, entityId: target.entityId, version: target.version,
          verdicts, error: null,
        }),
        recheckRemovalStatement(db, target),
        db.prepare(
          "INSERT INTO moderation_actions (user_id, kind, entity_kind, entity_id, hash, reason, verdicts, created_at) " +
            "VALUES (?, 'auto_image', ?, ?, ?, ?, ?, ?)",
        ).bind(target.userId, target.kind, target.entityId, target.hash, reason,
          JSON.stringify(verdicts), nowSeconds()),
        notifyStatement(db, target.userId,
          "Auto-mod removed one of your images after a report. If this was a mistake, appeal it from your profile's Appeals page."),
      ]);
      continue;
    }
    await db.batch([
      storeVerdictRow(db, {
        kind: target.kind, entityId: target.entityId, version: target.version,
        verdicts, error: null,
      }),
    ]);
  }
}

// Report routes call this right after the report row commits. No-op when the
// subsystem is unconfigured; the kill switch is re-read inside the task.
export function scheduleReportVisionRecheck(ctx, env, input) {
  if (!isVisionConfigured(env)) return;
  const task = runReportVisionRecheck(env, input).catch((error) => {
    console.error("Vision report re-check failed:", error);
  });
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(task);
  }
}

// Queue payload decorator: batched verdict lookup for the moderation desks,
// mirroring withBookmarkFlags. Returns a Map<entityId, verdictRow>.
export async function visionVerdictsByEntity(db, kind, entityIds) {
  const ids = [...new Set(entityIds.map((id) => String(id)))];
  const map = new Map();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.prepare(
    "SELECT kind, entity_id, version, adult, medical, spoof, violence, racy, error, checked_at " +
      "FROM vision_verdicts WHERE kind = ? AND entity_id IN (" + placeholders + ")",
  ).bind(kind, ...ids).all();
  for (const row of result.results || []) {
    map.set(row.entity_id, row);
  }
  return map;
}

// One row → the client shape shared by all three desks. error keeps "no
// report" and "Vision unavailable" distinguishable in the UI.
export function publicVisionVerdict(row) {
  if (!row) return null;
  if (row.error) {
    return { error: String(row.error).slice(0, 200) };
  }
  return {
    adult: row.adult || null,
    medical: row.medical || null,
    spoof: row.spoof || null,
    violence: row.violence || null,
    racy: row.racy || null,
  };
}

// Desk routes (v3.1): the status read powers the Auto-mod panel section, and
// the kill-switch POST is THE emergency stop — one click in the admin panel,
// effective on the next upload, no deploy and no wrangler.
export async function handleVisionAdminRoutes(request, env, url, path, method) {
  const db = env.FORUM_DB;
  if (path === "/api/admin/vision" && method === "GET") {
    await requiremod(request, env, false);
    return json({
      configured: isVisionConfigured(env),
      killSwitch: await isVisionKilled(db),
    });
  }
  if (path === "/api/admin/vision-kill-switch" && method === "POST") {
    const session = await requiremod(request, env);
    await assertNotBanned(env, session.user.id);
    const body = await readJson(request);
    const tripped = body.tripped === true || body.tripped === "true";
    if (tripped) {
      await db.batch([
        db.prepare(
          "INSERT INTO site_settings (key, value, updated_at) VALUES ('vision_kill_switch', '1', ?) " +
            "ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at",
        ).bind(nowSeconds()),
      ]);
    } else {
      await db.batch([
        db.prepare("DELETE FROM site_settings WHERE key = 'vision_kill_switch'"),
      ]);
    }
    return json({ configured: isVisionConfigured(env), killSwitch: tripped });
  }
  return null;
}
