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

import { t } from "./i18n.js";
// Composer body limits, shared by forms.js (live counter wiring) and app.js
// (the composer textarea's maxLength). DOM-free at import time and at runtime —
// no document/window access anywhere — so node --test can load this module
// directly (see frontend-glue.test.mjs).

// Owner-set cap for BOTH post and reply bodies, enforced server-side in
// api/posts.mjs (requiredText, MAX_COMPOSER_BODY_CHARS) and client-side here.
// Bio (10,000) and search are separate limits and do not use this constant.
export const COMPOSER_MAX_CHARS = 4750;

// Digit grouping keeps "1,000" legible; a plain replace is locale-independent
// so node and browser produce byte-identical labels.
const groupDigits = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// Label for the composer's live counter: remaining characters for a body whose
// current value is `value` (null/undefined count as empty). Over-limit values
// count as nothing left — the textarea's maxLength attribute truncates first,
// so a negative remaining count can never occur in real use, but the clamp
// keeps the label sensible if one ever reaches this function.
export function charsLeftLabel(maxChars, value) {
  const remaining = Math.max(0, Number(maxChars) - String(value ?? "").length);
  return t("limits.charsLeft", { remaining: groupDigits(remaining) });
}
