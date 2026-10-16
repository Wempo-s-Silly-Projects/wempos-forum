// Composer body limits, shared by forms.js (live counter wiring) and app.js
// (the composer textarea's maxLength). DOM-free at import time and at runtime —
// no document/window access anywhere — so node --test can load this module
// directly (see frontend-glue.test.mjs).

// Owner-set cap for BOTH post and reply bodies, enforced server-side in
// api/posts.mjs (requiredText, MAX_COMPOSER_BODY_CHARS) and client-side here.
// Bio (10,000) and search are separate limits and do not use this constant.
export const COMPOSER_MAX_CHARS = 1000;

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
  return groupDigits(remaining) + " chars left";
}