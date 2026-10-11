import test from "node:test";
import assert from "node:assert/strict";
import {
  createAdminView,
  createHomeView,
  createPostView,
  createProfileView,
  createSetupView,
} from "./views.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.classList = { add: () => {} };
    this.dataset = {};
    this._textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }
}

function fakeDocument() {
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

function findForm(document, name) {
  return document.created.find((element) => element.tagName === "form" &&
    element.dataset.form === name);
}

function postFixture(overrides = {}) {
  return {
    id: 42,
    parentId: null,
    body: "A forum post",
    visibility: "visible",
    createdAt: "2026-01-01T12:00:00.000Z",
    author: { id: 3, username: "wempo", avatarUrl: null },
    likeCount: 2,
    dislikeCount: 0,
    viewerReaction: null,
    replies: [],
    ...overrides,
  };
}

test("guest home offers login and registration after setup is complete", () => {
  const document = fakeDocument();
  const home = createHomeView(document, {
    session: { user: null },
    setupRequired: false,
    route: { name: "home" },
    feed: { posts: [], nextBefore: null },
  });

  assert.ok(findForm(document, "login"));
  assert.ok(findForm(document, "register"));
  assert.match(home.textContent, /Recent conversations/);
});

test("guest home exposes first-admin setup while setup is required", () => {
  const document = fakeDocument();
  createHomeView(document, {
    session: { user: null },
    setupRequired: true,
    route: { name: "home" },
    feed: { posts: [], nextBefore: null },
  });

  assert.ok(findForm(document, "setup"));
  assert.equal(findForm(document, "register"), undefined);
});

test("signed-in home provides the post composer", () => {
  const document = fakeDocument();
  createHomeView(document, {
    session: { user: { id: 1, username: "member", role: "member" } },
    setupRequired: false,
    route: { name: "home" },
    feed: { posts: [], nextBefore: null },
  });

  assert.ok(findForm(document, "post-create"));
});

test("search home renders matching people and posts", () => {
  const document = fakeDocument();
  const home = createHomeView(document, {
    session: { user: null },
    setupRequired: false,
    route: { name: "search", query: "cats" },
    search: {
      users: [{ id: 8, username: "catfan", bio: "Likes cats", avatarUrl: null }],
      posts: [postFixture({ id: 43, body: "Cats are neat" })],
    },
  });

  assert.match(home.textContent, /Results for “cats”/);
  assert.match(home.textContent, /catfan/);
  assert.match(home.textContent, /Likes cats/);
  assert.match(home.textContent, /Cats are neat/);
});

test("post detail renders its replies and a reply form for a member", () => {
  const document = fakeDocument();
  const post = postFixture({
    replies: [postFixture({ id: 44, parentId: 42, body: "A reply" })],
  });
  const view = createPostView(document, post, { user: { id: 9, role: "member" } });

  assert.match(view.textContent, /A forum post/);
  assert.match(view.textContent, /A reply/);
  assert.ok(findForm(document, "reply"));
});

test("an own profile exposes bio and avatar edit forms", () => {
  const document = fakeDocument();
  createProfileView(document, {
    id: 4,
    username: "member",
    bio: "Hello there",
    avatarUrl: null,
    posts: [],
  }, { user: { id: 4, username: "member", role: "member" } });

  assert.ok(findForm(document, "bio"));
  assert.ok(findForm(document, "avatar"));
});

test("profile bio and report reason remain inert text", () => {
  const document = fakeDocument();
  const hostile = "<img src=x onerror=alert(1)>";
  const profile = createProfileView(document, {
    id: 4,
    username: "member",
    bio: hostile,
    avatarUrl: null,
    posts: [],
  }, { user: null });
  const reportView = createAdminView(document, {
    reports: [{
      id: 5,
      reason: hostile,
      reporter: { id: 2, username: "reporter" },
      post: {
        id: 42,
        body: "Reported post",
        visibility: "visible",
        author: { id: 3, username: "author" },
      },
    }],
    bans: [],
  });

  assert.ok(profile.textContent.includes(hostile));
  assert.ok(reportView.textContent.includes(hostile));
  assert.ok(document.created.every(({ tagName }) => tagName !== "img"));
});

test("admin view renders report resolution and ban actions with empty ban state", () => {
  const document = fakeDocument();
  const admin = createAdminView(document, {
    reports: [{
      id: 5,
      reason: "Spam",
      reporter: { id: 2, username: "reporter" },
      post: {
        id: 42,
        body: "Reported post",
        visibility: "visible",
        author: { id: 3, username: "author" },
      },
    }],
    bans: [],
  });

  assert.ok(findForm(document, "admin-resolve"));
  assert.ok(findForm(document, "admin-ban"));
  assert.match(admin.textContent, /There are no active bans/);
});

test("setup route provides first-administrator credentials", () => {
  const document = fakeDocument();
  const setup = createSetupView(document, true);

  assert.ok(findForm(document, "setup"));
  assert.match(setup.textContent, /first administrator account/i);
});

test("feed pagination appears only when a full page has an older cursor", () => {
  const document = fakeDocument();
  const feed = {
    posts: Array.from({ length: 20 }, (_value, index) => postFixture({ id: index + 1 })),
    nextBefore: 1,
  };
  const home = createHomeView(document, {
    session: { user: null },
    setupRequired: false,
    route: { name: "home" },
    feed,
  });

  assert.ok(document.created.some((element) => element.dataset.action === "load-more"));
  assert.match(home.textContent, /Load older posts/);
});
