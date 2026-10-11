import test from "node:test";
import assert from "node:assert/strict";
import { createInput, createTextarea } from "./forms.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
  }

  append(...children) {
    this.children.push(...children);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

const fakeDocument = () => {
  const created = [];
  return {
    created,
    createElement(tagName) {
      const element = new FakeElement(tagName);
      created.push(element);
      return element;
    },
  };
}

test("createInput associates optional help text with its visible label and input", () => {
  const document = fakeDocument();
  const field = createInput(document, {
    id: "username",
    name: "username",
    label: "Username",
    required: true,
    minLength: 3,
    maxLength: 24,
    description: "Use 3 to 24 letters, numbers, underscores, or hyphens.",
  });
  const label = document.created.find((element) => element.tagName === "label");
  const input = document.created.find((element) => element.tagName === "input");
  const description = document.created.find((element) => element.tagName === "small");

  assert.equal(label.htmlFor, "username");
  assert.equal(input.name, "username");
  assert.equal(input.required, true);
  assert.equal(input.minLength, 3);
  assert.equal(input.maxLength, 24);
  assert.equal(input.attributes["aria-describedby"], "username-description");
  assert.equal(description.id, "username-description");
  assert.equal(description.textContent, "Use 3 to 24 letters, numbers, underscores, or hyphens.");
  assert.ok(field.children.includes(description));
});

test("createTextarea associates optional help text with its visible label and textarea", () => {
  const document = fakeDocument();
  const field = createTextarea(document, {
    id: "post-body",
    label: "What's on your mind?",
    rows: 4,
    maxLength: 2000,
    required: true,
    description: "Posts can be up to 2,000 characters.",
  });
  const label = document.created.find((element) => element.tagName === "label");
  const textarea = document.created.find((element) => element.tagName === "textarea");
  const description = document.created.find((element) => element.tagName === "small");

  assert.equal(label.htmlFor, "post-body");
  assert.equal(textarea.name, "post-body");
  assert.equal(textarea.rows, 4);
  assert.equal(textarea.maxLength, 2000);
  assert.equal(textarea.required, true);
  assert.equal(textarea.attributes["aria-describedby"], "post-body-description");
  assert.equal(description.id, "post-body-description");
  assert.equal(description.textContent, "Posts can be up to 2,000 characters.");
  assert.ok(field.children.includes(description));
});
