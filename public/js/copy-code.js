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

// Copy code (wave 2026-11-21-10 F3): a quiet icon button on every fenced code
// block in a post, reply, the rules page and the compose preview; it copies
// the block's raw text exactly as written. Client-only: nothing is sent, and
// the result is announced in a polite status mounted beside the button.
import { t } from "./i18n.js";
import { createIcon } from "./icons.js";
import { COPIED_STATUS_MS } from "./copy-link.js";

const defaultClipboard = () => globalThis.navigator?.clipboard ?? null;

// Resolves true only when the clipboard took the text; any refusal (no secure
// context, permission denied, missing API) resolves false for the status.
export async function copyText(clipboard, text) {
  if (!clipboard || typeof clipboard.writeText !== "function") return false;
  try {
    await clipboard.writeText(String(text ?? ""));
    return true;
  } catch {
    return false;
  }
}

// Returns the tool row: the labelled icon button plus its polite status.
// getText is read at click time, so the copy always matches what is shown.
export function createCopyCodeButton(document, getText, {
  clipboard = defaultClipboard(),
  schedule = setTimeout,
} = {}) {
  const tools = document.createElement("span");
  tools.className = "codeblock-tools";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet icon-button copy-code";
  const label = t("render.copyCode");
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.append(createIcon(document, "copy"));
  const status = document.createElement("span");
  status.className = "copy-code-status";
  status.setAttribute("role", "status");
  tools.append(status, button);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    const copied = await copyText(clipboard, getText());
    button.dataset.copied = String(copied);
    status.textContent = copied ? t("render.codeCopied") : t("render.copyCodeFailed");
    schedule(() => {
      status.textContent = "";
    }, COPIED_STATUS_MS);
  });
  return tools;
}
