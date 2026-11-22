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

// Wave 2026-11-21-3 F1a: stable error codes. Route modules keep throwing
// HttpError with English text (318 sites); this ONE table maps the exact text
// of member-facing messages to a stable snake_case code. The /api catch in
// worker.mjs answers through codedErrorReply, which adds `code` beside the
// unchanged `error` text — additive, so existing clients keep working. The
// client paints t("errors.<code>") and falls back to the English text.
// Ops-only messages (503 "not configured", relay) stay uncoded on purpose.
// tests/i18n-gaps.test.mjs pins every message to the api/ source verbatim.
import { HttpError, errorReply, json } from "./http.mjs";

export const ERROR_CODES = Object.freeze({
  not_found: "Not found.",
  post_not_found: "Post not found.",
  member_not_found: "Member not found.",
  thread_not_found: "Thread not found.",
  message_not_found: "Message not found.",
  attachment_not_found: "Attachment not found.",
  gif_not_found: "GIF not found.",
  picture_not_found: "Picture not found.",
  appeal_not_found: "Appeal not found.",
  method_not_supported: "That method is not supported.",
  conversation_unavailable: "That conversation is not available.",
  conversation_missing: "That conversation does not exist.",
  member_missing: "That member does not exist.",
  invalid_cursor: "That page cursor is invalid.",
  account_banned: "This account is currently banned.",
  network_banned: "This network is banned from the forum.",
  upload_too_large: "That upload is too large.",
  upload_unreadable: "The upload could not be read.",
  image_unreadable: "That image could not be read. Try re-saving it and uploading again.",
  image_too_large: "Each image must be 10 MiB or smaller.",
  images_too_large: "Images must be 10 MiB or smaller.",
  avatar_too_large: "Profile pictures must be 1 MiB or smaller.",
  image_type_upload: "Upload a JPEG, PNG, or WebP image.",
  image_type_unsupported: "Only JPEG, PNG, and WebP images are supported.",
  rate_limited: "Too many requests. Please wait a little and try again.",
  sign_in_required: "Please sign in to do that.",
  session_expired: "Your session has expired. Reload the page and sign in again.",
  csrf_stale: "Your security token is out of date. Reload the page and try again.",
  origin_unverified: "This request was blocked because its origin could not be verified.",
  bad_credentials: "The username or password is incorrect.",
  password_incorrect: "Your current password is incorrect.",
  code_incorrect: "That code is not correct.",
  code_incorrect_unchanged: "That code is not correct. Nothing has been changed.",
  code_required: "Enter the 6-digit code from your authenticator app, or a backup code.",
  verification_expired: "This verification request has expired. Sign in again.",
  username_taken: "That username is already taken.",
  username_not_allowed: "That username isn't allowed.",
  write_something: "Write something first.",
  write_message: "Write a message first.",
  replies_one_level: "Replies only go one level deep.",
  replies_closed_banned: "Replies are closed while this conversation's author is banned.",
  // v5.43: a non-staff reply inside a thread's slow-mode cooldown (429).
  slow_mode: "Slow mode is on in this thread. Wait a little before replying again.",
  // v5.51: a non-staff reply into a staff-locked thread (423 Locked).
  thread_locked: "This thread is locked. Only staff can reply.",
  poll_closed: "This poll is closed.",
  poll_choose_option: "Choose one of the poll options.",
  report_duplicate: "You already have an open report for this post.",
  report_own_post: "You cannot report your own post.",
  message_self: "You cannot message yourself.",
  block_self: "You cannot block yourself.",
  human_check_required: "Human verification is required.",
  human_check_failed: "Human verification failed. Please try again.",
  human_check_incomplete: "Human verification could not be completed. Please try again.",
  only_author_edit: "Only the author can edit this post.",
  only_author_delete: "Only the author can delete this post.",
  bio_too_long: "Your bio must be 10000 characters or fewer.",
  post_publish_failed: "Your post could not be published. Please try again.",
  post_processing: "Your post is still being processed. Retry shortly.",
  reply_conversation_changed: "The conversation changed while your reply was being published. Please try again.",
  gif_no_longer_available: "One of the selected GIFs is no longer available.",
  gif_unavailable: "One of the selected GIFs is not available.",
  wall_unavailable: "That wall is not available.",
  wall_blocked: "Wall posts are unavailable between you two.",
  pronouns_invalid: "Pronouns can use letters, spaces, / and - only, up to 24 characters.",
  pronouns_not_allowed: "Those pronouns can't be used here.",
});

const CODE_BY_MESSAGE = new Map(Object.entries(ERROR_CODES).map(([code, message]) => [message, code]));

export function errorCodeFor(message) {
  return typeof message === "string" ? CODE_BY_MESSAGE.get(message) ?? null : null;
}

// Coded HttpErrors answer { error, code } with their own status and headers;
// payload replies (the ban screen), uncoded messages and crashes go through
// the vendor classifier unchanged.
export function codedErrorReply(error, consoleLabel) {
  if (error instanceof HttpError && !error.payload) {
    const code = errorCodeFor(error.message);
    if (code) return json({ error: error.message, code }, error.status, error.headers);
  }
  return errorReply(error, consoleLabel);
}
