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

// Wave 5.70: WCAG 1.4.3 (AA) contrast pin. Parses the light (:root) and dark
// (:root[data-theme="dark"]) token blocks in public/styles.css and checks every
// text token against every token used as a text background: --paper (cards)
// and --paper-shadow (.post-hidden cards, the .spoiler-revealed fallback).
// Dark-block tokens it does not set resolve to the light values, as the
// cascade does. High-contrast themes have their own pins and are not read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const AA_NORMAL_TEXT = 4.5;
const TEXT_TOKENS = ["--muted", "--ink", "--link", "--error-ink"];
const BACKGROUND_TOKENS = ["--paper", "--paper-shadow"];

function themeBlock(selector) {
  const escaped = selector.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const match = CSS.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(match, `theme block ${selector} not found in styles.css`);
  const tokens = {};
  for (const [, name, value] of match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

function relativeLuminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `expected a 6-digit hex colour, got ${hex}`);
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = themeBlock(":root");
const themes = {
  light,
  dark: { ...light, ...themeBlock(':root[data-theme="dark"]') },
};

for (const [themeName, tokens] of Object.entries(themes)) {
  for (const text of TEXT_TOKENS) {
    for (const background of BACKGROUND_TOKENS) {
      test(`${themeName}: ${text} on ${background} meets WCAG AA (>= ${AA_NORMAL_TEXT}:1)`, () => {
        assert.ok(tokens[text], `${text} missing from ${themeName} theme`);
        assert.ok(tokens[background], `${background} missing from ${themeName} theme`);
        const ratio = contrastRatio(tokens[text], tokens[background]);
        assert.ok(
          ratio >= AA_NORMAL_TEXT,
          `${themeName} ${text} ${tokens[text]} on ${background} ${tokens[background]} = ${ratio.toFixed(2)}:1`,
        );
      });
    }
  }
}

test(".spoiler-revealed falls back to --paper-shadow and .post-hidden paints it", () => {
  assert.match(CSS, /\.spoiler-revealed\s*\{[^}]*background:\s*var\(--spoiler-revealed-bg,\s*var\(--paper-shadow\)\)/);
  assert.match(CSS, /\.post-hidden\s*\{[^}]*background:\s*var\(--paper-shadow\)/);
});

// Wave 5.73.0 (B2): code-highlight tokens on the code-block background
// (--field) in both themes; the OS-dark block repeats the manual dark values;
// the prefers-contrast: more block lifts every token to at least AAA (7:1).
const CODE_TOKENS = ["--code-keyword", "--code-string", "--code-comment", "--code-number"];
const AAA_NORMAL_TEXT = 7;
for (const [themeName, tokens] of Object.entries(themes)) {
  for (const code of CODE_TOKENS) {
    test(`${themeName}: ${code} on --field meets WCAG AA (>= ${AA_NORMAL_TEXT}:1)`, () => {
      assert.ok(tokens[code], `${code} missing from ${themeName} theme`);
      const ratio = contrastRatio(tokens[code], tokens["--field"]);
      assert.ok(ratio >= AA_NORMAL_TEXT, `${themeName} ${code} ${tokens[code]} on --field = ${ratio.toFixed(2)}:1`);
    });
  }
}

function declarationsIn(text, selector) {
  const escaped = selector.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} not found`);
  return Object.fromEntries([...match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

test("OS-dark block repeats the manual dark code tokens", () => {
  const osDark = CSS.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\):not\(\[data-theme="dark"\]\) \{([^}]*)\}/);
  assert.ok(osDark, "OS-dark token block");
  const values = Object.fromEntries([...osDark[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
  for (const code of CODE_TOKENS) assert.equal(values[code], themes.dark[code], code);
});

test("prefers-contrast: more lifts every code token to AAA in both themes", () => {
  const start = CSS.indexOf("@media (prefers-contrast: more) {");
  assert.ok(start >= 0, "prefers-contrast: more block");
  const region = CSS.slice(start, CSS.indexOf("\n}\n", start));
  const more = {
    light: { ...themes.light, ...declarationsIn(region, ":root") },
    dark: { ...themes.dark, ...declarationsIn(region, ':root[data-theme="dark"]') },
  };
  for (const [themeName, tokens] of Object.entries(more)) {
    for (const code of CODE_TOKENS) {
      assert.ok(tokens[code], `${code} missing from the ${themeName} prefers-contrast block`);
      const ratio = contrastRatio(tokens[code], tokens["--field"]);
      assert.ok(ratio >= AAA_NORMAL_TEXT, `${themeName} ${code} ${tokens[code]} = ${ratio.toFixed(2)}:1`);
    }
  }
});
