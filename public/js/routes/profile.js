// v4.0 plan 4 Task 5: the profile concern — the /users/:username route and
// the surface it paints (heading, badges, banner, role controls, socials,
// posts, the profile-editor, the avatar upload, banned strip), the profile
// submit handlers (editor, avatar, password), the custom-CSS picker actions,
// and the author's delete dialogs. Bodies moved verbatim out of app.js; bare
// renderRoute calls inside moved bodies re-read the boot state
// (state.renderRoute). The profile wall renders via ../wall.js.
import { api, setCsrfToken } from "../api.js";
import {
  addHeading,
  addSubmit,
  confirmDialog,
  createPanel,
  element,
  main,
  openConfirmDialog,
  setMessage,
} from "../dom.js";
import { addText, createInput } from "../forms.js";
import { state } from "../state.js";
import { createPostCard } from "../render.js";
import { formatBanCountdown } from "../banned.js";
import {
  SOCIAL_LABELS,
  SOCIAL_PLATFORM_ORDER,
  invalidSocialKeys,
  renderProfileEditor,
  renderProfileSocials,
} from "../profile-editor.js";
import { renderProfileWall } from "../wall.js";

async function renderProfileRoute(route, context, version) {
  const profile = await api(`/api/users/${encodeURIComponent(route.username)}`);
  if (version !== state.renderVersion) return;
  renderProfile(profile, context.session);
}

// Profile themes (v2.5): main outlives routes, so the accent class is
// tracked and cleared before the next profile render.
// Profile theme accent + banner (any hex, v3.0.2): both apply as CSS custom
// property writes on main (removed at each route switch — see renderRoute).

let activeProfileStyleNode = null;
function applyProfileTheme(profile) {
  const themeId = Number(profile.id || 0);
  if (activeProfileStyleNode) {
    activeProfileStyleNode.remove();
    activeProfileStyleNode = null;
  }
  if (!profile.customCss) return;
  // A same-origin STYLESHEET link (style-src 'self' allows it — no CSP
  // change); the scoped css is a fetched css URL, never an inline <style>.
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/api/users/" + themeId + "/profile.css";
  document.head.append(link);
  activeProfileStyleNode = link;
}

// The node's own reset: renderRoute (app.js) clears the tracked <link> on
// every route switch — the same "null, remove later" semantics the block had
// when it lived there (applyProfileTheme removes the link on the NEXT profile
// render — the scoped css selectors are inert on non-profile pages).
export function clearProfileTheme() {
  activeProfileStyleNode = null;
}

// Milestone badges (v2.5): display-only, computed from the profile's
// contribution counts — the thresholds graduate as the member posts.
function profileBadgeFor(totalContributions) {
  if (totalContributions >= 10000) return "Famous Forumer";
  if (totalContributions >= 1000) return "Mega Forumer";
  if (totalContributions >= 100) return "Big Forumer";
  if (totalContributions >= 20) return "Standard forumer";
  if (totalContributions < 20) return "New Forumer";
  return null;
}

function renderProfile(profile, session) {
  // Custom profile CSS (v2.5): the payload's css is ALREADY scoped (the
  // server's sandbox); it lands as a <style> element with a textContent and
  // the wrapper class the sandbox prefixes to. Removed on the next render (a
  // tracked module node, like the accent class).
  applyProfileTheme(profile);
  // Profile accent (any hex, v3.0.2): the server normalizes the accent to a
  // #rrggbb hex, applied as a CSS custom property WRITE (element.style is a
  // CSSOM assignment — not an inline style string — so the CSP stays pure);
  // .profile-section provides the default green when unset.
  main.classList.add("profile-section");
  main.classList.add("profile-theme-scope");
  main.style.removeProperty("--profile-accent");
  main.style.removeProperty("--banner-color");
  if (profile.profileAccent) {
    main.style.setProperty("--profile-accent", profile.profileAccent);
  }
  const heading = element("section", "profile-heading");
  if (profile.avatarUrl) {
    const image = element("img", "avatar profile-avatar");
    image.src = profile.avatarUrl;
    image.alt = `Avatar of ${profile.username}`;
    heading.append(image);
  }
  addHeading(heading, profile.username, 1).classList.add("profile-name");
  // Flair (v2.5): a short filtered label under the name; next to it the
  // milestone badge (v2.5, display-only, computed from the counter). The
  // role badge (v3.1) leads the row for staff — Owner or Admin, from the
  // server-mapped public role; members carry "member" and get nothing.
  const flairRow = element("p", "profile-flair-row");
  if (profile.role === "owner" || profile.role === "admin") {
    flairRow.append(element("span",
      "role-badge role-badge-" + profile.role,
      profile.role === "owner" ? "Owner" : "Admin"));
  }
  if (profile.flair) flairRow.append(element("span", "profile-flair", profile.flair));
  const badgeText = profileBadgeFor(Number(profile.postsCount || 0) + Number(profile.repliesCount || 0));
  if (badgeText) flairRow.append(element("span", "profile-badge", badgeText));
  if (flairRow.children.length) heading.append(flairRow);
  // Per-user post counter (v2.5): threads started + replies written, in the
  // profile heading (muted; display-only).
  heading.append(element("p", "profile-post-counts",
    `${Number(profile.postsCount || 0)} posts · ${Number(profile.repliesCount || 0)} replies`));
  // Banner (any hex, v3.0.2): the hex rides --banner-color (the CSS default
  // stays transparent for none) + the filtered banner text.
  if (profile.bannerColor) {
    main.style.setProperty("--banner-color", profile.bannerColor);
  }
  const banner = element("div", "profile-banner");
  if (profile.bannerText) banner.append(element("span", "profile-banner-text", profile.bannerText));
  banner.hidden = !profile.bannerColor && !profile.bannerText;
  // The heading is appended AFTER this block — insertBefore on a not-yet-
  // attached node throws (the owner hit exactly that on the live site);
  // appending the banner first yields the same above-the-heading order.
  main.append(banner);
  // The pending-upload status comes from the session payload (the profile
  // payload does not carry avatarStatus), so only the owner sees the badge —
  // everyone else just sees the currently approved avatar.
  if (session.user?.id === profile.id && session.user.avatarStatus === "pending") {
    heading.append(element("span", "avatar-pending-badge", "Avatar awaiting review"));
  }
  if (session.user && session.user.id !== profile.id) {
    // DMs (v3.1): the conversation starter — find-or-creates the 1:1 thread
    // and opens the chat panel on it. The word filter and desk review apply
    // to DMs exactly like the public room.
    const messageButton = element("button", "button button-secondary", "Message");
    messageButton.type = "button";
    messageButton.dataset.action = "dm-open";
    messageButton.dataset.username = profile.username;
    heading.append(messageButton);
    // Report-a-profile (v2.5): the bio/flair/banner/css surface is
    // reportable like post content — same desk, same resolve flow.
    const reportProfile = element("button", "button button-quiet", "Report profile");
    reportProfile.type = "button";
    reportProfile.dataset.action = "report-profile";
    reportProfile.dataset.profileId = String(profile.id);
    heading.append(reportProfile);
  }
  appendProfileRoleControls(profile, session, heading);
  main.append(heading);
  // Banned-profile banner (v3.1): the server flags actively banned members
  // on the public payload (expiry included; the reason rides only for staff,
  // like member search). Everyone sees the banner — banning already hides the
  // member's posts, so the profile explains why the page reads empty.
  if (profile.banned) {
    let banText = "This user is banned.";
    if (profile.banExpiresAt) {
      banText = "This user is banned — reactivates in " +
        (formatBanCountdown(profile.banExpiresAt) || "0m") + ".";
    }
    if (profile.banReason) banText += " Reason: " + profile.banReason;
    main.append(element("p", "profile-banned-banner", banText));
  }
  addText(document, main, "p", profile.bio || "This member hasn't added a bio yet.", "profile-bio");
  appendProfileSocials(profile, session.user?.id === profile.id);
  if (session.user?.id === profile.id) {
    // Bio (10,000 chars) plus the ten social fields; submission re-fetches the
    // profile instead of trusting the asymmetric PATCH echo.
    renderProfileEditor(main, profile);
    // Any-hex profile color (v3.0.2): the picker's native color input PATCHes
    // on change (profile-editor.js stays DOM-pure; the glue lives here).
    const accentColorInput = main.querySelector(".accent-color-input");
    if (accentColorInput) {
      accentColorInput.addEventListener("change", async () => {
        await api("/api/me", { method: "PATCH", body: { profileAccent: accentColorInput.value } });
        await state.renderRoute(state.activeRoute);
      });
    }
    const pictures = createPanel("Profile picture",
      "Uploads are reviewed by mods before they appear publicly.");
    const avatarForm = document.createElement("form");
    avatarForm.dataset.form = "avatar";
    avatarForm.append(createInput(document, {
      id: "profile-avatar", name: "avatar", label: "Profile picture (JPEG, PNG, or WebP; up to 1 MiB)",
      type: "file", accept: "image/jpeg,image/png,image/webp", required: true,
    }));
    addSubmit(avatarForm, "Upload picture");
    pictures.append(avatarForm);
    main.append(pictures);
  }
  renderProfilePosts(profile, session.user);
  // Profile wall (v4.0): renders below the posts; it fetches its own payload
  // and never blocks the profile render on the wall fetch.
  renderProfileWall(profile);
}

function renderProfilePosts(profile, user) {
  addHeading(main, "Posts", 2);
  if (!profile.posts.length) {
    addText(document, main, "p", "No posts, yet!", "empty-state");
    return;
  }

  const list = element("div", "post-list profile-post-list");
  list.dataset.profileUsername = profile.username;
  for (const post of profile.posts) list.append(createPostCard(post, document, user));
  main.append(list);

  if (!profile.postsNextBefore) return;
  const older = element("button", "button button-secondary", "Load older posts");
  older.type = "button";
  older.dataset.action = "load-more-profile-posts";
  older.dataset.username = profile.username;
  older.dataset.before = String(profile.postsNextBefore);
  main.append(older);
}

// Spec §8: promote/demote is owner-only (v3.1 rename: mod → admin, admin →
// owner), so the owner gets the control on member profiles too. The payload's
// role selects the single correct form (members → promote, admins → demote);
// the owner's own profile and other owners get nothing (server 403s anyway).
// Handlers re-render the current route, so both the desk and this surface
// refresh after a role change.
function appendProfileRoleControls(profile, session, container) {
  if (!session.user || session.user.role !== "owner") return;
  if (session.user.id === profile.id || profile.role === "owner") return;
  const [formName, label] = profile.role === "member"
    ? ["admin-promote", "Promote to admin"]
    : ["admin-demote", "Demote to member"];
  const form = document.createElement("form");
  form.dataset.form = formName;
  form.dataset.userId = String(profile.id);
  const button = element("button", "button button-secondary", label);
  button.type = "submit";
  form.append(button);
  container.append(form);
}

async function loadMoreProfilePosts(button) {
  const username = button.dataset.username;
  const page = await api("/api/users/" + encodeURIComponent(username) + "?before=" + button.dataset.before);
  const list = main.querySelector(".profile-post-list");
  if (!list) throw new Error("The profile post list is no longer available. Reload the profile.");
  for (const post of page.posts) list.append(createPostCard(post, document, state.currentUser));
  if (page.postsNextBefore) button.dataset.before = String(page.postsNextBefore);
  else button.remove();
}

async function submitProfileEditorForm(form, text) {
  const socials = {};
  for (const key of SOCIAL_PLATFORM_ORDER) {
    const value = text(key).trim();
    socials[key] = value === "" ? null : value;
  }
  const invalid = invalidSocialKeys(socials);
  if (invalid.length) {
    throw new Error(`Enter a valid ${SOCIAL_LABELS[invalid[0]]} handle.`);
  }
  // bio + socials in one PATCH /api/me (64 KB route cap covers a 10000-char
  // bio). The PATCH echo is asymmetric, so the rerender below re-fetches the
  // profile from GET /api/users/:username rather than trusting the response.
  await api("/api/me", {
    method: "PATCH",
    body: {
      bio: text("bio"),
      socials,
      bannerColor: text("bannerColor").trim().toLowerCase(),
      bannerText: text("bannerText").trim(),
      flair: text("flair").trim(),
    },
  });
  await state.renderRoute({ name: "profile", username: state.currentUser.username });
  setMessage("Your profile was updated.");
}

async function submitAvatarForm(values) {
  const upload = new FormData();
  upload.append("avatar", values.get("avatar"));
  await api("/api/me/avatar", { method: "POST", body: upload });
  await state.renderRoute({ name: "profile", username: state.currentUser.username });
  setMessage("Your profile picture was updated.");
}

async function submitPasswordForm(text) {
  await api("/api/me/password", {
    method: "PATCH",
    body: { currentPassword: text("currentPassword"), newPassword: text("newPassword") },
  });
  await state.renderRoute({ name: "home" });
  setMessage("Your password was changed. Other signed-in sessions were revoked.");
}

// Post deletion (v2.4.1 feature): the confirm dialog's copy comes from the
// card's deleteScope (set by createPostCard off post.parent) so a root author
// is warned that the whole conversation — other people's replies included —
// goes with it, while a reply author is told their thread survives. The server
// (DELETE /api/posts/:id) does the actual reparent/cascade work; on success a
// thread-route deletion of the viewed post navigates home (the conversation no
// longer exists), every other surface just re-renders its route.
function openDeletePostDialog(button) {
  const postId = Number(button.dataset.postId);
  const isThreadRoot = button.dataset.deleteScope !== "reply";
  openConfirmDialog(
    isThreadRoot ? "Delete this thread?" : "Delete this reply?",
    isThreadRoot
      ? "Your post and the entire conversation under it are deleted — including other people's replies. This cannot be undone."
      : "Your reply is deleted. Its replies stay in the thread. This cannot be undone.",
    async () => {
      const viewedThreadId = state.activeRoute.name === "post" ? state.activeRoute.id : null;
      await api("/api/posts/" + postId, { method: "DELETE" });
      confirmDialog.close();
      if (viewedThreadId === postId) {
        state.router.navigate("/");
      } else {
        await state.renderRoute(state.activeRoute);
      }
      setMessage("The post was deleted.");
    },
  );
}

// Account deletion (v2.4.1 feature): POST /api/me/delete removes the account
// and everything it owns server-side. The dialog copy states the full blast
// radius — including other people's replies inside the account's own threads —
// before a single request is sent. On success the client mirrors logout
// exactly (CSRF token cleared, home as a signed-out guest); the route re-render
// refetches the session, which is now anonymous.
function openDeleteAccountDialog() {
  openConfirmDialog(
    "Delete your account?",
    "Your account and everything it owns is permanently deleted: your posts — and every thread you started, including other people's replies inside those threads — plus your replies — and any sub-replies hanging off your replies in other members' threads go too — reactions, reports, notifications, and profile. There is no undo.",
    async () => {
      await api("/api/me/delete", { method: "POST" });
      setCsrfToken("");
      confirmDialog.close();
      state.router.navigate("/");
      setMessage("Your account was deleted. You are signed out.");
    },
  );
}

// Collapsible socials (plan v2.3): the details/summary wrapper lives in
// profile-editor.js (renderProfileSocials, glue-testable); open state is a
// plain `details.open = isOwnProfile` assignment — owner's own profile OPEN,
// visitors CLOSED.
function appendProfileSocials(profile, isOwnProfile) {
  const details = renderProfileSocials(document, profile, isOwnProfile);
  if (details) main.append(details);
}
// The registration seam: profile submits through FORM_HANDLERS; the profile
// surface's actions merge into handleButtonAction's dispatch map.
export const FORM_HANDLERS = {
  "profile-editor": (form, text) => submitProfileEditorForm(form, text),
  avatar: (form, text, values) => submitAvatarForm(values),
  password: (form, text) => submitPasswordForm(text),
};

export const ACTIONS = {
  "load-more-profile-posts": (button) => loadMoreProfilePosts(button),
  "delete-post": (button) => openDeletePostDialog(button),
  "delete-account": () => openDeleteAccountDialog(),
    "save-profile-css": async (button) => {
      // Custom CSS (v2.5): POST the textarea's raw css to /api/me/css; it
      // lands pending for a mod. The note is review-first wording.
      const form = button.closest("div");
      const input = form?.querySelector("[data-css-input]");
      if (!input) return;
      if (!input.value.trim()) {
        setMessage("Write some CSS first, or use Remove to clear it.", true);
        return;
      }
      await api("/api/me/css", { method: "POST", body: input.value });
      setMessage("CSS saved — a mod will review it.");
    },
    "clear-profile-css": async () => {
      await api("/api/me/css", { method: "DELETE" });
      await state.renderRoute({ name: "profile", username: state.currentUser.username });
      setMessage("Custom CSS removed.");
    },
    "set-profile-accent": async () => {
      // Profile colors (any hex, v3.0.2): the swatch's data-accent is the
      // preset's hex ("" = clear). The server re-validates the hex; success
      // re-renders the route.
      await api("/api/me", { method: "PATCH", body: { profileAccent: button.dataset.accent || "" } });
      await state.renderRoute(state.activeRoute);
    },
};

export { renderProfileRoute };
