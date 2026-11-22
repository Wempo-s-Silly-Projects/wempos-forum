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

// Download my data (v4.23): the account settings' "Your data" panel. The
// export is fetched only when the member presses the button (privacy law:
// network actions are explicit, never on render), through the one api()
// wrapper, then handed to the browser as a local file via a Blob URL — the
// data never goes anywhere but this member's own device.
// Batch K: the file is a ZIP built in the browser with the vendored
// client-zip: the full JSON plus readable splits (threads, replies, direct
// messages, profile) and the member's OWN uploaded images — the paths are
// built only from the export's own uploads list and the member's own avatar,
// fetched through a limiter; an image that no longer loads is left out.
// client-zip loads lazily, only when the member asks for the download.
import { t } from "./i18n.js";
import { API_BATCH_CONCURRENCY, createLimit } from "./request-retry.js";

export const EXPORT_PATH = "/api/me/export";
export const EXPORT_FILE_NAME = "wempos-forum-data.zip";
// Some browsers read the Blob URL after the click returns; a short grace
// period before revoking keeps the download from racing the cleanup.
const REVOKE_DELAY_MS = 1000;
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMAGE_EXTENSIONS = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
const FALLBACK_EXTENSION = ".img";

const jsonFile = (name, value) => ({ name, input: JSON.stringify(value ?? null, null, 2) });
const isRoot = (post) => post?.parentId === null || post?.parentId === undefined;

// The ZIP's JSON files: everything in data.json, plus easy-to-read splits.
export function exportJsonFiles(data) {
  const posts = Array.isArray(data?.posts) ? data.posts : [];
  return [
    jsonFile("data.json", data),
    jsonFile("profile.json", { profile: data?.profile ?? null, settings: data?.settings ?? null }),
    jsonFile("posts.json", posts.filter(isRoot)),
    jsonFile("replies.json", posts.filter((post) => !isRoot(post))),
    jsonFile("direct-messages.json", Array.isArray(data?.directMessages) ? data.directMessages : []),
  ];
}

// Which images to fetch: only well-formed upload ids from the member's own
// list, and their own avatar when they have one. Nothing else is requested.
export function exportImagePlan(data) {
  const plan = [];
  const uploads = Array.isArray(data?.uploads) ? data.uploads : [];
  for (const upload of uploads) {
    if (typeof upload?.id !== "string" || !UPLOAD_ID.test(upload.id)) continue;
    const extension = IMAGE_EXTENSIONS[upload.mime] ?? FALLBACK_EXTENSION;
    plan.push({ path: `/api/attachments/${upload.id}`, name: `images/uploads/${upload.id}${extension}` });
  }
  const profile = data?.profile;
  const hasAvatar = typeof profile?.avatarStatus === "string" && profile.avatarStatus !== "";
  if (Number.isSafeInteger(profile?.id) && profile.id > 0 && hasAvatar) {
    plan.push({ path: `/api/avatars/${profile.id}`, name: "images/avatar" });
  }
  return plan;
}

const withExtension = (name, blob) =>
  (/\.[a-z]+$/.test(name) ? name : name + (IMAGE_EXTENSIONS[blob?.type] ?? FALLBACK_EXTENSION));

async function fetchImages(api, plan) {
  const limit = createLimit(API_BATCH_CONCURRENCY);
  const results = await Promise.allSettled(plan.map((item) => limit(() => api(item.path, { as: "blob" }))));
  const files = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value instanceof Blob) {
      files.push({ name: withExtension(plan[index].name, result.value), input: result.value });
    }
  });
  return { files, missing: plan.length - files.length };
}

export function createDataExportPanel(doc) {
  const panel = doc.createElement("section");
  panel.className = "panel data-export-panel";
  const heading = doc.createElement("h2");
  heading.textContent = t("settings.dataTitle");
  const note = doc.createElement("p");
  note.className = "muted";
  note.textContent = t("data.zipNote");
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "button button-secondary";
  button.dataset.action = "download-my-data";
  button.textContent = t("settings.dataDownload");
  // What the anonymous speed measurements collect (public/js/vitals.js).
  const vitals = doc.createElement("p");
  vitals.className = "muted";
  vitals.textContent = t("settings.vitalsNote");
  panel.append(heading, note, button, vitals);
  return panel;
}

// Resolves { missingImages }: how many of the member's images could not be
// fetched (deleted, or no longer served) and so are not in the ZIP.
export async function downloadMyData({
  api,
  doc = document,
  urls = URL,
  schedule = (fn) => setTimeout(fn, REVOKE_DELAY_MS),
  zip,
}) {
  const makeZip = zip ?? (await import("./vendor/client-zip.js")).downloadZip;
  const data = await api(EXPORT_PATH);
  const images = await fetchImages(api, exportImagePlan(data));
  const blob = await makeZip([...exportJsonFiles(data), ...images.files]).blob();
  const href = urls.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = href;
  link.download = EXPORT_FILE_NAME;
  link.hidden = true;
  doc.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    schedule(() => urls.revokeObjectURL(href));
  }
  return { missingImages: images.missing };
}
