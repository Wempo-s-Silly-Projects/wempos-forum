// Copyright 2026 YourLocalGoober
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

// Link-target safety (security review): isSafeLinkUrl is the single gate
// between member text and an anchor's href — every renderer link goes
// through it. The module is import-free, so the gate runs node-side.
import test from "node:test";
import assert from "node:assert/strict";
import { isSafeLinkUrl } from "../public/js/markdown.js";

test("the established shapes stay safe", () => {
  assert.equal(isSafeLinkUrl("https://example.com"), true);
  assert.equal(isSafeLinkUrl("http://example.com/a?b=1"), true);
  assert.equal(isSafeLinkUrl("/users/wempo"), true);
});

test("control characters and escapes never become hrefs", () => {
  // A tab/newline/carriage-return or backslash can slip a scheme past a
  // prefix test or trip diverging URL parsers between renderer and browser.
  assert.equal(isSafeLinkUrl("ht\ttps://example.com"), false);
  assert.equal(isSafeLinkUrl("ht\ntps://example.com"), false);
  assert.equal(isSafeLinkUrl("ht\rtps://example.com"), false);
  assert.equal(isSafeLinkUrl("\\https://example.com"), false);
  assert.equal(isSafeLinkUrl("https://example.com/a\nb"), false);
  assert.equal(isSafeLinkUrl("/users/ta\nb"), false);
});

test("the scheme refusals stay refused", () => {
  assert.equal(isSafeLinkUrl("javascript:alert(1)"), false);
  assert.equal(isSafeLinkUrl("data:text/html,hi"), false);
  assert.equal(isSafeLinkUrl("//evil.com"), false);
  assert.equal(isSafeLinkUrl(""), false);
});
