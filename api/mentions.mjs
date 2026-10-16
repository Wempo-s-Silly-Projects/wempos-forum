// @mentions (C2): the body scan, user resolution, and the deduped notification
// fan-out for post + reply creation. The scan runs AFTER the word filter (the
// masked body is what gets scanned and stored — a filtered token cannot
// mention). Resolution is by username_key (usernames are stored lowercase), so
// "@wempo" and "@Wempo" are the same member; an unknown name is a silent
// no-op, and the author never notifies themselves. The fan-out rides
// notifications.mjs's fanOutStatements — the same dedupe-guarded INSERT +
// cap-pruning DELETE pair the subscriptions use — so a member is notified at
// most once per reply no matter how many notification paths reach them.
import { fanOutStatements } from "./notifications.mjs";

// The brief's exact token pattern: an "@" preceded by the string start or a
// non-word character, then a word-only handle. An address-shaped "hi@example"
// is therefore NOT a mention (the "i" before "@" is a word character).
export const MENTION_SCAN_PATTERN = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]+)/g;

// Notification fan-out cap: at most 10 members per body, first-come.
export const MAX_MENTIONS_PER_BODY = 10;

const USER_BY_NAME_SQL = "SELECT id, username FROM users WHERE username_key = ? LIMIT 1";

// Unique, case-folded mention keys in order of appearance, capped at 10.
export function scanMentions(body) {
  const text = typeof body === "string" ? body : "";
  const names = [];
  const seen = new Set();
  MENTION_SCAN_PATTERN.lastIndex = 0;
  let match;
  while ((match = MENTION_SCAN_PATTERN.exec(text)) !== null) {
    const key = match[1].toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(key);
      if (names.length >= MAX_MENTIONS_PER_BODY) break;
    }
  }
  return names;
}

// Builds the READY statements for one body's mentions ([] when nobody is
// notified): the scan, the per-name resolution, and the exclusions (the actor,
// any ids the caller already notified — the ordinary reply target — and the
// subscription fan-out's recipients via the INSERT's own NOT EXISTS guard).
export async function mentionFanOutStatements(db, body, {
  actorId, targetPostId, replyId, now, excludeIds = [], actorUsername,
}) {
  const names = scanMentions(body);
  if (names.length === 0) return [];
  const excluded = new Set(
    [actorId, ...excludeIds]
      .filter((id) => id !== null && id !== undefined)
      .map(Number),
  );
  const recipients = new Set();
  for (const key of names) {
    let user = null;
    try {
      user = await db.prepare(USER_BY_NAME_SQL).bind(key).first();
    } catch {
      // Resolution failing is a silent no-op — never a write failure.
      return [];
    }
    if (!user) continue; // Unknown name: silent no-op.
    const id = Number(user.id);
    if (excluded.has(id) || recipients.has(id)) continue;
    recipients.add(id);
  }
  // Statement assembly: the shared notify idiom (insert + prune per recipient),
  // self-labelled so a mention never renders as a plain "New reply" row.
  return fanOutStatements(db, [...recipients], {
    targetPostId, replyId, now,
    label: "You were mentioned by " + String(actorUsername ?? "a member"),
  });
}