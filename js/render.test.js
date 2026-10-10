import test from "node:test";
import assert from "node:assert/strict";
import { createPostCard } from "./render.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.classList = { add() {} };
    this.dataset = {};
    this._textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }
}

test("testUserContentIsRenderedAsText", () => {
  const created = [];
  const document = {
    createElement(tagName) {
      const element = new FakeElement(tagName);
      created.push(element);
      return element;
    },
  };
  const maliciousText = "<img src=x onerror=alert(1)>";
  const card = createPostCard({
    id: 42,
    body: maliciousText,
    createdAt: "2026-01-01T12:00:00.000Z",
    author: { id: 3, username: maliciousText, avatarUrl: null },
    likeCount: 0,
    dislikeCount: 0,
    viewerReaction: null,
  }, document);

  assert.ok(created.every(({ tagName }) => tagName !== "img"));
  assert.ok(card.children.some((element) => element.textContent === maliciousText));
  assert.equal(card.textContent.includes(maliciousText), true);
});
