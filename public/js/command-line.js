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

// Terminal sessions in code blocks: a ```console (or ```shell-session /
// ```terminal) fence whose lines start with "$ " is drawn as a command line.
// The vendored Prism command-line plugin
// (public/js/vendor/prism-command-line.min.js, Prism 1.30.0, MIT) paints the
// "$" prompt beside each command and keeps the other lines as plain output,
// so the prompt is never selected or copied with the command. The plugin
// HTML-encodes every output line itself; this module only decides which
// lines are commands. Fences with real ANSI escapes stay with ansi_up
// (rich-blocks.js); a session without any "$ " line, or one over the
// highlight size cap, stays a plain block. No dependency on code-highlight.js
// (which imports needsCommandLine from here), so the cap is mirrored and
// pinned equal by tests/wave-l2-libs.test.mjs.

export const COMMAND_LINE_FENCES = Object.freeze(["console", "shell-session", "terminal"]);
export const COMMAND_PROMPT = "$";
export const COMMAND_LINE_LANGUAGE = "language-bash";
export const COMMAND_LINE_MAX_CHARS = 20000;
const COMMAND_PREFIX = COMMAND_PROMPT + " ";

const isCommand = (line) => line === COMMAND_PROMPT || line.startsWith(COMMAND_PREFIX);

// [2, 3, 5] → "2-3,5" (the plugin's data-output syntax, 1-based lines).
export function lineRanges(numbers) {
  const ranges = [];
  for (const number of numbers) {
    const last = ranges.at(-1);
    if (last && number === last[1] + 1) ranges[ranges.length - 1] = [last[0], number];
    else ranges.push([number, number]);
  }
  return ranges.map(([from, to]) => (from === to ? String(from) : from + "-" + to)).join(",");
}

// { code, output } for a terminal fence, or null when the block is not one.
// code: the session with each command's "$ " removed (the plugin draws it);
// output: data-output for the plugin ("" when every line is a command).
export function commandLinePlan(info, text) {
  const name = String(info ?? "").trim().toLowerCase();
  const source = String(text ?? "");
  if (!COMMAND_LINE_FENCES.includes(name) || source.length > COMMAND_LINE_MAX_CHARS) return null;
  const lines = source.split("\n");
  if (!lines.some(isCommand)) return null;
  const output = [];
  const code = lines.map((line, index) => {
    if (isCommand(line)) return line.slice(COMMAND_PREFIX.length);
    output.push(index + 1);
    return line;
  });
  return { code: code.join("\n"), output: lineRanges(output) };
}

// True when a highlightable <code> sits in a command-line <pre>.
export const needsCommandLine = (codes) =>
  Array.from(codes ?? []).some((code) => /(?:^|\s)command-line(?:\s|$)/.test(String(code?.parentNode?.className ?? "")));
