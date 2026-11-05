// v4.0 plan 2, Task 6: the staff suggestion-status route. Moved verbatim
// from api/posts.mjs. (SUGGESTION_SCORE_SQL — the Suggestions feed's ORDER BY
// — stays in boards.mjs per the Task-2 ledger resolution; this module needs
// only the board constants.)
import { GENERAL_BOARD_DEFAULT, SUGGESTIONS_BOARD } from "./boards.mjs";
import {
  assertNotBanned,
  HttpError,
  json,
  nowSeconds,
  postById,
  rateLimit,
  readJson,
  requiremod,
  requireMutationApplied,
} from "./shared.mjs";

// Suggestion status (v3.1): staff mark a suggestion thread resolved or
// declined, or reopen it. Suggestions-board ROOTS only — replies never carry
// a status. Reopening is idempotent (an already-open thread stays open);
// setting a status must apply (a vanished post 404s above).
export async function handleSuggestionStatusRoute(request, env, url, path, method) {
  const db = env.FORUM_DB;
  const match = path.match(/^\/api\/posts\/([0-9]+)\/suggestion-status$/);
  if (!match) return null;
  if (method !== "POST") throw new HttpError(405, "That method is not supported.");
  const session = await requiremod(request, env);
  await assertNotBanned(env, session.user.id);
  await rateLimit(request, env, "write");
  const postId = Number(match[1]);
  if (!Number.isSafeInteger(postId) || postId < 1) throw new HttpError(404, "Post not found.");
  const post = await postById(env, postId, session.user.id);
  if (!post || post.parent_id !== null) throw new HttpError(404, "Post not found.");
  if ((post.board || GENERAL_BOARD_DEFAULT) !== SUGGESTIONS_BOARD) {
    throw new HttpError(400, "Only suggestions can be marked resolved or declined.");
  }
  const body = await readJson(request);
  if (body.status === undefined) throw new HttpError(400, "Choose a suggestion status.");
  if (body.status === "open") {
    await db.prepare(
      "UPDATE posts SET suggestion_status = NULL, suggestion_decided_by = NULL, suggestion_decided_at = NULL WHERE id = ?",
    ).bind(postId).run();
    return json({ ok: true, suggestionStatus: null });
  }
  if (body.status !== "resolved" && body.status !== "declined") {
    throw new HttpError(400, "Choose resolved, declined, or open.");
  }
  const result = await db.prepare(
    "UPDATE posts SET suggestion_status = ?, suggestion_decided_by = ?, suggestion_decided_at = ? WHERE id = ?",
  ).bind(body.status, session.user.id, nowSeconds(), postId).run();
  requireMutationApplied(result);
  return json({ ok: true, suggestionStatus: body.status });
}
