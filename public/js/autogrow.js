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

// Batch H: composer and chat textareas grow with their text. The work is
// CSS (`field-sizing: content` in styles.css, capped by max-height); this JS
// runs only in engines without field-sizing, sizing the field to its
// scrollHeight on input up to the same cap. Inline sizes go through the CSSOM
// (element.style), which the CSP allows; nothing is stored.

// Mirrors constants.mjs (pinned equal by tests/batch-h-composer-input.test.mjs).
export const COMPOSER_AUTOGROW_MAX_PX = 480;

const FIELD_SIZING_PROPERTY = "field-sizing";
const FIELD_SIZING_VALUE = "content";
const cssSupports = (property, value) => globalThis.CSS?.supports?.(property, value) === true;

export function attachAutogrow(field, { supports = cssSupports, maxPx = COMPOSER_AUTOGROW_MAX_PX } = {}) {
  if (!field || supports(FIELD_SIZING_PROPERTY, FIELD_SIZING_VALUE)) return;
  const grow = () => {
    field.style.height = "auto";
    const height = Math.min(Number(field.scrollHeight) || 0, maxPx);
    field.style.height = height + "px";
  };
  field.addEventListener("input", grow);
}
