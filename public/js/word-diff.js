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

// Word diff for the edit history panel (v5.50.0). Client only, page view
// only: no storage, no network, and the stored edits never change.
//
// diffWords(a, b) is pure: a word-level LCS over tokens (a word plus the
// whitespace after it), compared by the word alone, returning merged runs
// [{ type: "equal" | "insert" | "delete", text }]. equal + insert rebuilds b
// exactly; equal + delete rebuilds a's words. The common prefix and suffix
// are trimmed first, so a small edit in a long body costs linear time; the
// LCS table is O(n·m), so either side over DIFF_MAX_WORDS words returns null
// and the caller shows the plain full version instead.
//
// appendWordDiff builds the runs as text nodes and <ins>/<del> elements
// through createElement + textContent only.

export const DIFF_MAX_WORDS = 2000;

// Leading whitespace rides as its own token so b rebuilds exactly.
function tokenize(text, limit) {
  const tokens = [];
  const pattern = /\s+|\S+\s*/g;
  let match;
  let words = 0;
  while ((match = pattern.exec(text)) !== null) {
    const token = match[0];
    if (/\S/.test(token)) words += 1;
    if (words > limit) return null;
    tokens.push(token);
  }
  return tokens;
}

const keyOf = (token) => token.trim();

// Only b's last token can lack trailing whitespace; a deleted word after it
// gets a separating space so it never glues on (equal + insert stays b).
function pushRun(runs, type, text) {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && last.type === type) {
    last.text += text;
    return;
  }
  const glued = type === "delete" && last && !/\s$/.test(last.text);
  runs.push({ type, text: glued ? " " + text : text });
}

// LCS over the middle slices; suffix table, then one forward walk.
function diffMiddle(runs, a, b) {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = keyOf(a[i]) === keyOf(b[j])
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (keyOf(a[i]) === keyOf(b[j])) {
      pushRun(runs, "equal", b[j]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      pushRun(runs, "delete", a[i]);
      i += 1;
    } else {
      pushRun(runs, "insert", b[j]);
      j += 1;
    }
  }
  for (; i < n; i += 1) pushRun(runs, "delete", a[i]);
  for (; j < m; j += 1) pushRun(runs, "insert", b[j]);
}

export function diffWords(before, after) {
  const a = tokenize(String(before ?? ""), DIFF_MAX_WORDS);
  const b = a && tokenize(String(after ?? ""), DIFF_MAX_WORDS);
  if (!a || !b) return null;
  let start = 0;
  while (start < a.length && start < b.length && keyOf(a[start]) === keyOf(b[start])) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && keyOf(a[endA - 1]) === keyOf(b[endB - 1])) {
    endA -= 1;
    endB -= 1;
  }
  const runs = [];
  pushRun(runs, "equal", b.slice(0, start).join(""));
  diffMiddle(runs, a.slice(start, endA), b.slice(start, endB));
  pushRun(runs, "equal", b.slice(endB).join(""));
  return runs;
}

const RUN_TAGS = { insert: ["ins", "edit-diff-ins"], delete: ["del", "edit-diff-del"] };

export function appendWordDiff(document, parent, runs) {
  for (const run of runs) {
    const mark = RUN_TAGS[run.type];
    if (!mark) {
      parent.append(document.createTextNode(run.text));
      continue;
    }
    const node = document.createElement(mark[0]);
    node.className = mark[1];
    node.textContent = run.text;
    parent.append(node);
  }
  return parent;
}
