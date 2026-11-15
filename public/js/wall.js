
// Profile wall (v4.0, owner's ask): visitors leave short posts on a member's
// profile; the profile OWNER may pin/unpin wall posts and can do nothing else
// to them. The wall renders below the profile's posts and fetches its own
// payload (GET /api/users/:id/wall) so the profile route stays untouched.
// Everything lands through textContent/CSSOM — the CSP stays pure.
import { api } from "./api.js";
import { addSubmit, createPanel, element, main, setMessage } from "./dom.js";
import { createTextarea } from "./forms.js";
import { state } from "./state.js";

const WALL_MAX_CHARS = 280;

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0;
}

function isValidWallPost(post) {
  return Boolean(
    post &&
    typeof post === "object" &&
    validId(post.id) &&
    post.author &&
    typeof post.author === "object" &&
    typeof post.author.username === "string" &&
    post.author.username.length > 0 &&
    typeof post.body === "string" &&
    typeof post.createdAt === "string" &&
    Number.isFinite(Date.parse(post.createdAt)),
  );
}

// Builds the wall panel and fills it from the API (the caller does not
// await — the profile render never blocks on the wall fetch).
export async function renderProfileWall(profile) {
  if (!profile || !validId(profile.id)) return;

  const ownerId = Number(profile.id);

  const panel = createPanel(
    "Wall",
    "Say something nice on this member's wall. The profile owner can pin posts — nothing else.",
  );

  panel.classList.add("profile-wall");
  main.append(panel);

  const viewer = state.currentUser;
  const isOwner = Boolean(
    viewer &&
    validId(viewer.id) &&
    Number(viewer.id) === ownerId,
  );

  // Signed-in members get the wall composer; guests just read. The form's
  // dataset carries the wall owner so the submit handler posts to the right
  // wall even after rerenders.
  if (viewer) {
    const form = document.createElement("form");
    form.dataset.form = "wall-post";
    form.dataset.ownerId = String(ownerId);

    form.append(
      createTextarea(document, {
        id: `${ownerId}-wall-body`,
        name: "body",
        label: "Post to the wall",
        rows: 3,
        maxLength: WALL_MAX_CHARS,
        required: true,
        counter: true,
      }),
    );

    addSubmit(form, "Post to wall");
    panel.append(form);
  }

  let data;

  try {
    data = await api(
      "/api/users/" + encodeURIComponent(ownerId) + "/wall",
    );
  } catch {
    if (!panel.isConnected) return;

    panel.append(
      element("p", "empty-state", "The wall could not be loaded."),
    );
    return;
  }

  // The user may have navigated away while the request was pending.
  if (!panel.isConnected) return;

  if (!data || !Array.isArray(data.wall)) {
    panel.append(
      element("p", "empty-state", "The wall could not be loaded."),
    );
    return;
  }

  const list = element("div", "wall-list");
  const posts = data.wall.filter(isValidWallPost);

  if (!posts.length) {
    list.append(
      element(
        "p",
        "empty-state",
        data.wall.length
          ? "The wall could not be loaded."
          : viewer
            ? "Be the first to write on the wall!"
            : "The wall is empty.",
      ),
    );
  }

  for (const post of posts) {
    const row = element("div", "wall-post");

    if (post.pinnedAt) {
      row.classList.add("wall-post-pinned");
    }

    const header = element("div", "wall-post-header");

    const author = element(
      "a",
      "wall-post-author",
      post.author.username,
    );

    author.href = "/users/" + encodeURIComponent(post.author.username);
    author.setAttribute("data-app-link", "");
    header.append(author);

    if (
      post.author.role === "owner" ||
      post.author.role === "admin"
    ) {
      header.append(
        element(
          "span",
          "role-badge role-badge-" + post.author.role,
          post.author.role === "owner" ? "Owner" : "Admin",
        ),
      );
    }

    if (post.pinnedAt) {
      header.append(element("span", "post-pinned", "Pinned"));
    }

    const when = element("time", "wall-post-time");
    when.dateTime = post.createdAt;
    when.textContent = new Date(post.createdAt).toLocaleString();

    header.append(when);
    row.append(header);

    const body = element("p", "wall-post-body", post.body);
    row.append(body);

    // Pin control: the wall OWNER's single affordance. The dataset rides the
    // payload's pinnedAt, so a re-render refetch decides the state.
    if (isOwner) {
      const pin = element(
        "button",
        "button button-quiet",
        post.pinnedAt ? "Unpin" : "Pin",
      );

      pin.type = "button";
      pin.dataset.action = post.pinnedAt
        ? "wall-unpin"
        : "wall-pin";
      pin.dataset.wallPostId = String(post.id);

      pin.setAttribute(
        "aria-label",
        (post.pinnedAt ? "Unpin" : "Pin") + " this wall post",
      );

      row.append(pin);
    }

    list.append(row);
  }

  // Avoid inserting an outdated result if the panel was replaced during
  // rendering.
  if (panel.isConnected) {
    panel.append(list);
  }
}

// The registration seam: merged into submitForm/handleButtonAction's dispatch
// maps (the same shape the auth/feed route modules export).
export const FORM_HANDLERS = {
  "wall-post": async (form, text) => {
    const ownerId = form.dataset.ownerId;

    if (!validId(ownerId)) {
      throw new Error("Invalid wall owner.");
    }

    await api(
      "/api/users/" + encodeURIComponent(Number(ownerId)) + "/wall",
      {
        method: "POST",
        body: { body: text("body") },
      },
    );

    await state.renderRoute(state.activeRoute);
    setMessage("Posted to the wall.");
  },
};

export const ACTIONS = {
  "wall-pin": async (button) => {
    const postId = button.dataset.wallPostId;

    if (!validId(postId)) {
      throw new Error("Invalid wall post.");
    }

    await api(
      "/api/wall/" + encodeURIComponent(Number(postId)) + "/pin",
      { method: "POST" },
    );

    await state.renderRoute(state.activeRoute);
    setMessage("Pinned to the wall.");
  },

  "wall-unpin": async (button) => {
    const postId = button.dataset.wallPostId;

    if (!validId(postId)) {
      throw new Error("Invalid wall post.");
    }

    await api(
      "/api/wall/" + encodeURIComponent(Number(postId)) + "/pin",
      { method: "DELETE" },
    );

    await state.renderRoute(state.activeRoute);
    setMessage("Unpinned from the wall.");
  },
};
