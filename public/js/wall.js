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

// Builds the wall panel and fills it from the API (the caller does not
// await — the profile render never blocks on the wall fetch).
export async function renderProfileWall(profile) {
  const panel = createPanel("Wall", "Say something nice on this member's wall. The profile owner can pin posts — nothing else.");
  panel.classList.add("profile-wall");
  main.append(panel);
  const viewer = state.currentUser;
  const isOwner = Boolean(viewer && Number(viewer.id) === Number(profile.id));
  // Signed-in members get the wall composer; guests just read. The form's
  // dataset carries the wall owner so the submit handler posts to the right
  // wall even after rerenders.
  if (viewer) {
    const form = document.createElement("form");
    form.dataset.form = "wall-post";
    form.dataset.ownerId = String(profile.id);
    form.append(createTextarea(document, {
      id: `${profile.id}-wall-body`, name: "body", label: "Post to the wall",
      rows: 3, maxLength: WALL_MAX_CHARS, required: true, counter: true,
    }));
    addSubmit(form, "Post to wall");
    panel.append(form);
  }
  let data;
  try {
    data = await api("/api/users/" + encodeURIComponent(profile.id) + "/wall");
  } catch (error) {
    panel.append(element("p", "empty-state", "The wall could not be loaded."));
    return;
  }
  const list = element("div", "wall-list");
  if (!data.wall.length) {
    list.append(element("p", "empty-state", viewer ? "Be the first to write on the wall!" : "The wall is empty."));
  }
  for (const post of data.wall) {
    const row = element("div", "wall-post");
    if (post.pinnedAt) row.classList.add("wall-post-pinned");
    const header = element("div", "wall-post-header");
    const author = element("a", "wall-post-author", post.author.username);
    author.href = "/users/" + encodeURIComponent(post.author.username);
    author.setAttribute("data-app-link", "");
    header.append(author);
    if (post.author.role === "owner" || post.author.role === "admin") {
      header.append(element("span", "role-badge role-badge-" + post.author.role,
        post.author.role === "owner" ? "Owner" : "Admin"));
    }
    if (post.pinnedAt) header.append(element("span", "post-pinned", "Pinned"));
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
      const pin = element("button", "button button-quiet",
        post.pinnedAt ? "Unpin" : "Pin");
      pin.type = "button";
      pin.dataset.action = post.pinnedAt ? "wall-unpin" : "wall-pin";
      pin.dataset.wallPostId = String(post.id);
      pin.setAttribute("aria-label",
        (post.pinnedAt ? "Unpin" : "Pin") + " this wall post");
      row.append(pin);
    }
    list.append(row);
  }
  panel.append(list);
}

// The registration seam: merged into submitForm/handleButtonAction's dispatch
// maps (the same shape the auth/feed route modules export).
export const FORM_HANDLERS = {
  "wall-post": async (form, text) => {
    await api("/api/users/" + encodeURIComponent(form.dataset.ownerId) + "/wall", {
      method: "POST",
      body: { body: text("body") },
    });
    await state.renderRoute(state.activeRoute);
    setMessage("Posted to the wall.");
  },
};

export const ACTIONS = {
  "wall-pin": async (button) => {
    await api("/api/wall/" + encodeURIComponent(button.dataset.wallPostId) + "/pin", { method: "POST" });
    await state.renderRoute(state.activeRoute);
    setMessage("Pinned to the wall.");
  },
  "wall-unpin": async (button) => {
    await api("/api/wall/" + encodeURIComponent(button.dataset.wallPostId) + "/pin", { method: "DELETE" });
    await state.renderRoute(state.activeRoute);
    setMessage("Unpinned from the wall.");
  },
};
