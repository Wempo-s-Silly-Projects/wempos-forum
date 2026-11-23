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

// Saturday Fools 2026-11-28 (April Fools version): "Yell Saturday". The
// submit buttons of the new-post and reply composers READ "Yell!" for the
// day. Purely visual and static (no motion, so reduced motion sees the same
// thing): the button's text, type, form and handlers are untouched (CSS
// ::after paints the word; styles.css block "saturday-fools:2026-11-28"),
// and its accessible name stays the real label (preserveAccessibleName).
// Stripped on Sunday 2026-11-29 with its styles, fools.20261128.* keys and
// tests/saturday-fools-2026-11-28.test.mjs (docs/saturday-fools.md).
import { t } from "../../i18n.js";
import {
  clearCssVar, cssString, preserveAccessibleName, restoreAccessibleNames, setCssVar,
} from "./helpers.js";

export const YELL_ROOT_CLASS = "fools-2026-11-28";
export const YELL_LABEL_VAR = "--fools-2026-11-28-yell";
const COMPOSER_FORMS = 'form[data-form="post-create"],form[data-form="reply"]';
const SUBMIT = 'button[type="submit"]';

// The composer submit buttons under `root` get their accessible name pinned.
function pinLabels(root) {
  for (const form of root?.querySelectorAll?.(COMPOSER_FORMS) ?? []) {
    for (const button of form.querySelectorAll(SUBMIT)) preserveAccessibleName(button);
  }
}

function yell(doc) {
  const html = doc.documentElement;
  html.classList.add(YELL_ROOT_CLASS);
  setCssVar(html, YELL_LABEL_VAR, cssString(t("fools.20261128.yell")));
  pinLabels(doc);
  return () => {
    html.classList.remove(YELL_ROOT_CLASS);
    clearCssVar(html, YELL_LABEL_VAR);
    restoreAccessibleNames(doc);
  };
}

export default Object.freeze({
  id: "2026-11-28-yell",
  date: "2026-11-28",
  name: "fools.20261128.name",
  motion: false,
  apply: (doc) => yell(doc),
  // After each route render: buttons painted since apply get pinned too.
  enhance: (root) => pinLabels(root),
});
