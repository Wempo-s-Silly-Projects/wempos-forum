// Attachment intake helpers shared by the post and reply creation routes.
// Files arrive inside multipart/form-data bodies alongside the JSON-era text
// fields; bytes are D1 BLOBs (see migrations/0003_attachments.sql — R2 is not
// enabled on this account).
import { HttpError, createAvatarVersion, nowSeconds, readLimitedBody, readJson, sniffImageMime } from "./shared.mjs";

export const MAX_ATTACHMENT_FILES = 3;
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;
// Raw request ceiling covering all files plus multipart envelope overhead.
export const MAX_ATTACHMENT_REQUEST_BYTES = 3 * MAX_ATTACHMENT_BYTES + 512 * 1024;
const ATTACHMENT_FIELD = "images";

// Reads a post/reply creation body in either wire format, always returning the
// uniform { fields, files } shape the routes consume:
// - application/json: the pre-attachment behavior — the parsed object becomes
//   `fields`, `files` is empty.
// - multipart/form-data: buffered under the request ceiling, repeatable
//   `images` file parts validated per file (per-file size cap, then a magic-
//   byte sniff — the client's declared filename/type is never trusted), all
//   remaining text parts returned as string fields.
export async function readComposedBody(request, env) {
  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data")) {
    return { fields: await readJson(request), files: [] };
  }

  const bufferedBody = await readLimitedBody(request, MAX_ATTACHMENT_REQUEST_BYTES);
  let form;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: bufferedBody,
    }).formData();
  } catch {
    throw new HttpError(400, "The upload could not be read.");
  }

  const fields = {};
  const files = [];
  for (const entry of form.entries()) {
    const [name, value] = entry;
    if (name === ATTACHMENT_FIELD) {
      if (typeof value === "string") continue;
      if (value.size > MAX_ATTACHMENT_BYTES) {
        throw new HttpError(413, "Each image must be 1 MiB or smaller.");
      }
      const bytes = new Uint8Array(await value.arrayBuffer());
      const mime = sniffImageMime(bytes);
      if (!mime) {
        throw new HttpError(400, "Only JPEG, PNG, WebP, and GIF images can be attached.");
      }
      files.push({ mime, bytes });
    } else if (typeof value === "string") {
      fields[name] = value;
    }
  }
  return { fields, files };
}

// One INSERT per validated file, all in the terminal-before-review 'pending'
// state; the approved pair stays empty until a moderator approves. `db` is
// env.FORUM_DB; postId is the freshly inserted post/reply row id.
export async function insertAttachments(db, postId, createdBy, files) {
  const ids = [];
  const now = nowSeconds();
  for (const file of files) {
    const id = crypto.randomUUID();
    await db.prepare(
      "INSERT INTO attachments (id, post_id, created_by, created_at, status, version, " +
        "pending_mime, pending_data, pending_updated_at) " +
        "VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)",
    ).bind(id, postId, createdBy, now, createAvatarVersion(), file.mime, file.bytes, now).run();
    ids.push(id);
  }
  return ids;
}