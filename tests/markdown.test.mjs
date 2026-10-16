// Markdown subset (v2.5): parser + renderer unit tests. Every text lands via
// textContent — "<b>"/"<script>" stay literal; images stay literal; links
// must pass isSafeLinkUrl (http(s) or same-origin path) before any href.
import test from "node:test";
import assert from "node:assert/strict";
import { isSafeLinkUrl, parseBlocks, parseInline } from "../public/js/markdown.js";

function stubDocument() {
  const make = (tag, ns) => ({
    tagName: tag.toUpperCase(), namespaceURI: ns || null,
    attributes: {}, dataset: {}, children: [],
    textContent: "",
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    append(child) { this.children.push(child); },
  });
  return {
    createElement: (tag) => make(tag),
    createElementNS: (ns, tag) => make(tag, ns),
    createTextNode: (text) => {
      const node = make("#text");
      node.textContent = text;
      return node;
    },
  };
}

function textOf(node) {
  if (node.tagName === "#TEXT") return node.textContent;
  if (node.children.length === 0) return node.textContent;
  return [...node.children].map(textOf).join("");
}

test("isSafeLinkUrl: http(s) and same-origin paths pass; schemes and junk fail", () => {
  for (const good of ["https://forum.example/post", "http://example.com/a?b=c", "/posts/12", "//forum.example"]) {
    assert.equal(isSafeLinkUrl(good), true, good);
  }
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:x", "data:text/html,evil", "vbscript:x", "", "   ", "ftp://x", "mailto:a@b"]) {
    assert.equal(isSafeLinkUrl(bad), false, bad);
  }
});

test("bold, italic, and inline code build their tags with raw inner text", () => {
  const doc = stubDocument();
  const nodes = parseInline(doc, "**bold** piece of *it* and `co`de`");
  const tags = nodes.filter((node) => node.tagName !== "#TEXT").map((node) => [node.tagName, textOf(node)]);
  assert.deepEqual(tags, [["STRONG", "bold"], ["EM", "it"], ["CODE", "co"]]);
  // The lone third backtick stays text: "de`".
  // Everything else is plain text runs.
  assert.equal(nodes.filter((node) => node.tagName === "#TEXT").map((node) => node.textContent).join(""), " piece of  and de`");
});

test("links: safe hrefs anchor; unsafe schemes and images stay literal", () => {
  const doc = stubDocument();
  const safe = parseInline(doc, "see [guide](/posts/12)");
  assert.equal(safe.length, 2, "text run + anchor (nothing trails)");
  assert.equal(safe[1].tagName, "A", "the anchor ends the run");
  assert.equal(safe[1].href, "/posts/12");
  assert.equal(textOf(safe[1]), "guide");

  const hostile = parseInline(doc, "[clickme](javascript:alert(1)) stay");
  assert.equal(hostile.some((node) => node.tagName === "A"), false, "javascript: never anchors");
  assert.equal(hostile.filter((node) => node.tagName === "#TEXT").map((node) => node.textContent).join(""), "[clickme](javascript:alert(1)) stay", "literal text");

  const image = parseInline(doc, "![pic](https://evil.example/track.png)");
  assert.equal(image.some((node) => node.tagName === "A"), false, "image syntax never anchors");
  assert.equal(image.some((node) => node.tagName === "IMG"), false, "no images, ever");
  assert.equal(image.map((node) => textOf(node)).join(""), "![pic](https://evil.example/track.png)");
});

test("block shapes: heading levels, bullet lists, fenced code (raw), quotes, paragraphs", () => {
  const body = "# big\nsome text\n- one\n- two\n> quoted\nmore\n```\n<b>raw code</b>\n``` \nafter";
  const kinds = parseBlocks(body).map((block) => [block.kind, block.level ?? null]);
  assert.deepEqual(kinds, [
    ["heading", 1], ["paragraph", null], ["list", null], ["quote", null], ["paragraph", null], ["code", null], ["paragraph", null],
  ]);
  const blocks = parseBlocks(body);
  assert.deepEqual(blocks[0].text, ["big"]);
  assert.deepEqual(blocks[2].text, ["one", "two"]);
  assert.deepEqual(blocks[5].text, ["<b>raw code</b>"]);
});

test("heading depth maps 1-3 hashes; deeper hashes are not headings", () => {
  const blocks = parseBlocks("#### four\n### three\n## two\n# one");
  assert.deepEqual(blocks.map((block) => [block.kind, block.level ?? null]), [
    ["paragraph", null], ["heading", 3], ["heading", 2], ["heading", 1],
  ]);
});

test("an unclosed fence swallows the rest of the body as code", () => {
  const blocks = parseBlocks("before\n```\nnever closed");
  assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "code"]);
  assert.deepEqual(blocks[1].text, ["never closed"]);
});

test("emphasis edges: unterminated markers stay literal", () => {
  const doc = stubDocument();
  const nodes = parseInline(doc, "a ** open * and a lone `tick");
  assert.equal(nodes.some((node) => node.tagName === "STRONG"), false);
  assert.equal(nodes.some((node) => node.tagName === "EM"), false);
  assert.equal(nodes.some((node) => node.tagName === "CODE"), false);
  assert.equal(nodes.map((node) => textOf(node)).join(""), "a ** open * and a lone `tick");
});
