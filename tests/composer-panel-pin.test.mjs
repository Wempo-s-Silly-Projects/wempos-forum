// The composer panel's heading pin (reviewer round-2): createComposer builds
// its screen through the kit's panel({ title }) OBJECT contract. The wave-4
// bug — a bare-string call — compiled, kept the suite green, and silently
// dropped every composer heading (panel's shape reads { title, description };
// a string leaves title undefined and the h2 never builds). The heading
// itself is what this test pins, on the three shipped composer shapes, so
// that failure class can never ride through silently again.
import { test } from "node:test";
import assert from "node:assert/strict";

function stub(tag) {
  return {
    tag,
    children: [],
    dataset: {},
    attrs: {},
    className: "",
    textContent: "",
    type: "",
    append(...nodes) {
      for (const node of nodes) this.children.push(node);
    },
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
    removeAttribute() {},
    addEventListener() {},
    querySelector() {
      return stub("stub");
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    insertBefore() {},
    classList: { add() {}, remove() {}, toggle() {} },
  };
}

// dom.js's boot singletons (main, report/confirm dialogs, status bar) are
// queried at import, before useDocument exists — a document-shaped stub
// answers them so the composer chain loads.
globalThis.document = {
  createElement: (tag) => stub(tag),
  querySelector: () => stub("singleton"),
  querySelectorAll: () => [],
  addEventListener: () => {},
};

const { createComposer } = await import("../public/js/routes/composer.js");

// The heading hunt: panel({ title }) builds section.panel > h2 (kit.mjs).
const panelHeading = (node) => {
  for (const child of node.children) {
    if (child?.tag === "h2" && child.textContent) return child.textContent;
    if (child?.children) {
      const deep = panelHeading(child);
      if (deep) return deep;
    }
  }
  return null;
};

test("the composer panel carries its heading for the shipped shapes", () => {
  const shapes = [
    // name, buttonLabel, postID, board, expected heading
    ["post-create", "Post message", null, null, "Start a conversation"],
    ["reply", "Reply", 17, null, "Reply"],
    ["post-create", "Post message", null, "suggestions", "Share a suggestion"],
  ];
  for (const [name, buttonLabel, postID, board, expected] of shapes) {
    const composer = createComposer(name, "label", buttonLabel, postID, null, board);
    assert.equal(
      panelHeading(composer),
      expected,
      `the ${name} composer panel must build its h2 heading through panel({ title })`,
    );
  }
});
