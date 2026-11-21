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

// Wave 5.6 F4: J/K post navigation must step over replies the page is not
// showing — top-level replies the wave 5.5 reply filter set aside
// ([data-filtered-out], display:none in styles.css) and cards inside a
// collapsed sub-reply group ([hidden]) — instead of focusing an invisible
// card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeNode } from "./helpers/fake-dom.mjs";
import { bindPostKeys } from "../public/js/post-keys.js";

const card = (id) => {
  const node = new FakeNode("article");
  node.className = "post-card";
  node.dataset.postId = String(id);
  return node;
};

// main > root card + replies-list[r1, r2(filtered out), group(r2's subs),
// r3, hidden group[s1], r4]
const arrangeThread = () => {
  const main = new FakeNode("main");
  const root = card(1);
  const list = new FakeNode("div");
  list.className = "post-list replies-list";
  const [r1, r2, r3, r4] = [card(11), card(12), card(13), card(14)];
  r2.setAttribute("data-filtered-out", "");
  const filteredGroup = new FakeNode("div");
  filteredGroup.className = "sub-replies";
  filteredGroup.setAttribute("data-filtered-out", "");
  const f1 = card(121);
  filteredGroup.append(f1);
  const collapsed = new FakeNode("div");
  collapsed.className = "sub-replies";
  collapsed.setAttribute("hidden", "");
  const s1 = card(131);
  collapsed.append(s1);
  list.append(r1, r2, filteredGroup, r3, collapsed, r4);
  main.append(root, list);
  bindPostKeys(main, [root, list]);
  return { root, list, r1, r2, f1, r3, s1, r4 };
};

const press = (container, from, key) => {
  let prevented = false;
  container.dispatch("keydown", { key, target: from, preventDefault() { prevented = true; } });
  return prevented;
};
const focused = (cards) => cards.filter((node) => node.ownerFocused);

test("J skips filtered-out replies and their sub-reply group", () => {
  const { list, r1, r2, f1, r3 } = arrangeThread();
  assert.equal(press(list, r1, "j"), true);
  assert.deepEqual(focused([r2, f1, r3]), [r3]);
});

test("J skips cards inside a collapsed (hidden) sub-reply group", () => {
  const { list, r3, s1, r4 } = arrangeThread();
  press(list, r3, "j");
  assert.deepEqual(focused([s1, r4]), [r4]);
});

test("K walks back over the same hidden cards", () => {
  const { list, r1, r2, f1, r3 } = arrangeThread();
  press(list, r3, "k");
  assert.deepEqual(focused([r1, r2, f1]), [r1]);
});

test("the edge stays an edge: no visible post past the last one does nothing", () => {
  const { list, r3, s1, r4 } = arrangeThread();
  r4.setAttribute("data-filtered-out", "");
  assert.equal(press(list, r3, "j"), false, "nothing visible after r3");
  assert.deepEqual(focused([s1, r4]), []);
});
