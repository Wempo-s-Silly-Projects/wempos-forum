
// v4.0 plan 4 Task 5: the profile concern — the /users/:username route and
// the surface it paints (heading, badges, banner, role controls, socials,
// posts, the profile-editor, the avatar upload, banned strip), the profile
// submit handlers (editor, avatar, password), the custom-CSS picker actions,
// and the author's delete dialogs. Bodies moved from app.js; bare
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

function validId(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return false;
  }

  const id = Number(value);

  return Number.isSafeInteger(id) && id > 0;
}

function validCursor(value) {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function validateProfileResponse(profile) {
  if (!isRecord(profile)) {
    throw new Error("Invalid profile response.");
  }

  // An unavailable profile intentionally contains less information.
  if (profile.unavailable) return profile;

  if (
    !validId(profile.id) ||
    typeof profile.username !== "string" ||
    !Array.isArray(profile.posts)
  ) {
    throw new Error("Invalid profile response.");
  }

  if (
    profile.postsNextBefore != null &&
    !validCursor(profile.postsNextBefore)
  ) {
    throw new Error("Invalid profile pagination cursor.");
  }

  return profile;
}

function validateProfilePostsResponse(page) {
  if (
    !isRecord(page) ||
    !Array.isArray(page.posts)
  ) {
    throw new Error("Invalid profile posts response.");
  }

  if (
    page.postsNextBefore != null &&
    !validCursor(page.postsNextBefore)
  ) {
    throw new Error("Invalid profile pagination cursor.");
  }

  return page;
}

async function renderProfileRoute(route, context, version) {
  if (typeof route.username !== "string" || !route.username) {
    throw new Error("Invalid username.");
  }

  const profile = validateProfileResponse(
    await api(
      `/api/users/${encodeURIComponent(route.username)}`,
    ),
  );

  if (version !== state.renderVersion) return;

  // Blocks (v4.4): a block pair (either direction) refuses the profile —
  // render the plain unavailable strip instead of the surface.
  if (profile.unavailable) {
    addHeading(main, "Profile unavailable", 1);

    addText(
      document,
      main,
      "p",
      "This profile is not available to you.",
      "empty-state",
    );

    return;
  }

  renderProfile(profile, context.session);
}

// Profile themes (v2.5): main outlives routes, so the stylesheet node is
// tracked and removed before the next profile render.
let activeProfileStyleNode = null;

function applyProfileTheme(profile) {
  if (activeProfileStyleNode) {
    activeProfileStyleNode.remove();
    activeProfileStyleNode = null;
  }

  if (!profile.customCss || !validId(profile.id)) return;

  // A same-origin STYLESHEET link (style-src 'self' allows it — no CSP
  // change); the scoped CSS is fetched from the server, never inserted as
  // an inline <style>.
  const link = document.createElement("link");

  link.rel = "stylesheet";
  link.href =
    `/api/users/${Number(profile.id)}/profile.css`;

  document.head.append(link);
  activeProfileStyleNode = link;
}

// The node's own reset: renderRoute removes the tracked stylesheet on every
// route switch. Remove the node outright so leaving a profile stops fetching
// and re-applying its CSS.
export function clearProfileTheme() {
  if (activeProfileStyleNode) {
    activeProfileStyleNode.remove();
    activeProfileStyleNode = null;
  }
}

// Milestone badges (v2.5): display-only, computed from contribution counts.
function profileBadgeFor(totalContributions) {
  if (!Number.isFinite(totalContributions) || totalContributions < 0) {
    return null;
  }

  if (totalContributions >= 10000) return "Famous Forumer";
  if (totalContributions >= 1000) return "Mega Forumer";
  if (totalContributions >= 100) return "Big Forumer";
  if (totalContributions >= 20) return "Standard forumer";
  if (totalContributions < 20) return "New Forumer";

  return null;
}

function contributionCount(value) {
  const count = Number(value ?? 0);

  return Number.isFinite(count) && count >= 0
    ? count
    : 0;
}

function renderProfile(profile, session) {
  // Custom profile CSS (v2.5): the server scopes the CSS.
  applyProfileTheme(profile);

  // Profile accent (any hex, v3.0.2): the server normalizes the accent.
  main.classList.add("profile-section");
  main.classList.add("profile-theme-scope");

  main.style.removeProperty("--profile-accent");
  main.style.removeProperty("--banner-color");

  if (profile.profileAccent) {
    main.style.setProperty(
      "--profile-accent",
      profile.profileAccent,
    );
  }

  const heading = element("section", "profile-heading");

  if (profile.avatarUrl) {
    const image = element("img", "avatar profile-avatar");

    image.src = profile.avatarUrl;
    image.alt = `Avatar of ${profile.username}`;

    heading.append(image);
  }

  addHeading(heading, profile.username, 1)
    .classList.add("profile-name");

  // Flair, milestone badge and public role badge.
  const flairRow = element("p", "profile-flair-row");

  if (
    profile.role === "owner" ||
    profile.role === "admin"
  ) {
    flairRow.append(
      element(
        "span",
        `role-badge role-badge-${profile.role}`,
        profile.role === "owner" ? "Owner" : "Admin",
      ),
    );
  }

  if (profile.flair) {
    flairRow.append(
      element("span", "profile-flair", profile.flair),
    );
  }

  const postsCount = contributionCount(profile.postsCount);
  const repliesCount = contributionCount(profile.repliesCount);

  const badgeText = profileBadgeFor(
    postsCount + repliesCount,
  );

  if (badgeText) {
    flairRow.append(
      element("span", "profile-badge", badgeText),
    );
  }

  if (flairRow.children.length) {
    heading.append(flairRow);
  }

  // Per-user post counter.
  heading.append(
    element(
      "p",
      "profile-post-counts",
      `${postsCount} posts · ${repliesCount} replies`,
    ),
  );

  // Banner (any hex, v3.0.2).
  if (profile.bannerColor) {
    main.style.setProperty(
      "--banner-color",
      profile.bannerColor,
    );
  }

  const banner = element("div", "profile-banner");

  if (profile.bannerText) {
    banner.append(
      element(
        "span",
        "profile-banner-text",
        profile.bannerText,
      ),
    );
  }

  banner.hidden = !profile.bannerColor && !profile.bannerText;

  // Append before the heading to preserve the existing visual order.
  main.append(banner);

  // The pending-upload status comes from the session payload.
  if (
    session.user?.id === profile.id &&
    session.user.avatarStatus === "pending"
  ) {
    heading.append(
      element(
        "span",
        "avatar-pending-badge",
        "Avatar awaiting review",
      ),
    );
  }

  if (
    session.user &&
    session.user.id !== profile.id
  ) {
    // Blocks (v4.4).
    const blockButton = element(
      "button",
      "button button-quiet",
      "Block",
    );

    blockButton.type = "button";
    blockButton.dataset.action = "block-user";
    blockButton.dataset.profileId = String(profile.id);
    blockButton.dataset.username = profile.username;

    heading.append(blockButton);

    // DMs (v3.1).
    const messageButton = element(
      "button",
      "button button-secondary",
      "Message",
    );

    messageButton.type = "button";
    messageButton.dataset.action = "dm-open";
    messageButton.dataset.username = profile.username;

    heading.append(messageButton);

    // Report-a-profile (v2.5).
    const reportProfile = element(
      "button",
      "button button-quiet",
      "Report profile",
    );

    reportProfile.type = "button";
    reportProfile.dataset.action = "report-profile";
    reportProfile.dataset.profileId = String(profile.id);

    heading.append(reportProfile);
  }

  appendProfileRoleControls(profile, session, heading);

  main.append(heading);

  // Banned-profile banner (v3.1).
  if (profile.banned) {
    let banText = "This user is banned.";

    if (profile.banExpiresAt) {
      banText =
        "This user is banned — reactivates in " +
        (formatBanCountdown(profile.banExpiresAt) || "0m") +
        ".";
    }

    if (profile.banReason) {
      banText += " Reason: " + profile.banReason;
    }

    main.append(
      element("p", "profile-banned-banner", banText),
    );
  }

  addText(
    document,
    main,
    "p",
    profile.bio || "This member hasn't added a bio yet.",
    "profile-bio",
  );

  appendProfileSocials(
    profile,
    session.user?.id === profile.id,
  );

  if (session.user?.id === profile.id) {
    // Bio plus the social fields.
    renderProfileEditor(main, profile);

    // Any-hex profile color (v3.0.2).
    const accentColorInput = main.querySelector(
      ".accent-color-input",
    );

    if (accentColorInput) {
      accentColorInput.addEventListener(
        "change",
        async () => {
          const previousValue =
            accentColorInput.dataset.previousValue ??
            accentColorInput.defaultValue;

          try {
            await api("/api/me", {
              method: "PATCH",
              body: {
                profileAccent: accentColorInput.value,
              },
            });

            await state.renderRoute(state.activeRoute);
          } catch (error) {
            accentColorInput.value = previousValue;
            throw error;
          }
        },
      );

      accentColorInput.dataset.previousValue =
        accentColorInput.value;
    }

    const pictures = createPanel(
      "Profile picture",
      "Uploads are reviewed by mods before they appear publicly.",
    );

    const avatarForm = document.createElement("form");

    avatarForm.dataset.form = "avatar";

    avatarForm.append(
      createInput(document, {
        id: "profile-avatar",
        name: "avatar",
        label:
          "Profile picture (JPEG, PNG, or WebP; up to 1 MiB)",
        type: "file",
        accept: "image/jpeg,image/png,image/webp",
        required: true,
      }),
    );

    addSubmit(avatarForm, "Upload picture");
    pictures.append(avatarForm);
    main.append(pictures);
  }

  renderProfilePosts(profile, session.user);

  // Profile wall (v4.0): fetches its own payload and does not block the
  // profile render.
  renderProfileWall(profile);
}

function renderProfilePosts(profile, user) {
  addHeading(main, "Posts", 2);

  if (!profile.posts.length) {
    addText(
      document,
      main,
      "p",
      "No posts, yet!",
      "empty-state",
    );

    return;
  }

  const list = element(
    "div",
    "post-list profile-post-list",
  );

  list.dataset.profileUsername = profile.username;

  for (const post of profile.posts) {
    list.append(
      createPostCard(post, document, user),
    );
  }

  main.append(list);

  if (!profile.postsNextBefore) return;

  const older = element(
    "button",
    "button button-secondary",
    "Load older posts",
  );

  older.type = "button";
  older.dataset.action = "load-more-profile-posts";
  older.dataset.username = profile.username;
  older.dataset.before = String(profile.postsNextBefore);

  main.append(older);
}

// Spec §8: promote/demote is owner-only.
function appendProfileRoleControls(profile, session, container) {
  if (!session.user || session.user.role !== "owner") return;

  if (
    session.user.id === profile.id ||
    profile.role === "owner"
  ) {
    return;
  }

  const [formName, label] = profile.role === "member"
    ? ["admin-promote", "Promote to admin"]
    : ["admin-demote", "Demote to member"];

  const form = document.createElement("form");

  form.dataset.form = formName;
  form.dataset.userId = String(profile.id);

  const button = element(
    "button",
    "button button-secondary",
    label,
  );

  button.type = "submit";

  form.append(button);
  container.append(form);
}

async function loadMoreProfilePosts(button) {
  if (button.disabled) return;

  const username = button.dataset.username;
  const before = button.dataset.before;

  if (
    typeof username !== "string" ||
    !username ||
    !validCursor(before)
  ) {
    throw new Error("Invalid profile pagination details.");
  }

  const version = state.renderVersion;

  button.disabled = true;

  try {
    const page = validateProfilePostsResponse(
      await api(
        `/api/users/${encodeURIComponent(username)}?before=${encodeURIComponent(before)}`,
      ),
    );

    if (
      version !== state.renderVersion ||
      !button.isConnected
    ) {
      return;
    }

    const list = Array.from(
      main.querySelectorAll(".profile-post-list"),
    ).find(
      (item) =>
        item.dataset.profileUsername === username,
    );

    if (!list) {
      throw new Error(
        "The profile post list is no longer available. Reload the profile.",
      );
    }

    const fragment = document.createDocumentFragment();

    for (const post of page.posts) {
      fragment.append(
        createPostCard(
          post,
          document,
          state.currentUser,
        ),
      );
    }

    list.append(fragment);

    if (page.postsNextBefore) {
      button.dataset.before = String(page.postsNextBefore);
      button.disabled = false;
    } else {
      button.remove();
    }
  } catch (error) {
    if (
      version === state.renderVersion &&
      button.isConnected
    ) {
      button.disabled = false;
    }

    throw error;
  }
}

async function submitProfileEditorForm(form, text) {
  const socials = {};

  for (const key of SOCIAL_PLATFORM_ORDER) {
    const value = text(key).trim();

    socials[key] = value === "" ? null : value;
  }

  const invalid = invalidSocialKeys(socials);

  if (invalid.length) {
    throw new Error(
      `Enter a valid ${SOCIAL_LABELS[invalid[0]]} handle.`,
    );
  }

  // Bio and socials in one PATCH /api/me.
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

  if (
    typeof state.currentUser?.username !== "string" ||
    !state.currentUser.username
  ) {
    throw new Error(
      "Your profile could not be refreshed because your username is unavailable.",
    );
  }

  await state.renderRoute({
    name: "profile",
    username: state.currentUser.username,
  });

  setMessage("Your profile was updated.");
}

async function submitAvatarForm(values) {
  const avatar = values.get("avatar");

  if (!avatar || typeof avatar !== "object") {
    throw new Error("Choose a profile picture first.");
  }

  const upload = new FormData();

  upload.append("avatar", avatar);

  await api("/api/me/avatar", {
    method: "POST",
    body: upload,
  });

  if (
    typeof state.currentUser?.username !== "string" ||
    !state.currentUser.username
  ) {
    throw new Error(
      "Your profile picture was uploaded, but your profile could not be refreshed.",
    );
  }

  await state.renderRoute({
    name: "profile",
    username: state.currentUser.username,
  });

  setMessage("Your profile picture was updated.");
}

async function submitPasswordForm(text) {
  await api("/api/me/password", {
    method: "PATCH",
    body: {
      currentPassword: text("currentPassword"),
      newPassword: text("newPassword"),
    },
  });

  await state.renderRoute({ name: "home" });

  setMessage(
    "Your password was changed. Other signed-in sessions were revoked.",
  );
}

// Post deletion (v2.4.1): the confirm dialog's copy comes from the card's
// deleteScope. The server performs the actual deletion.
function openDeletePostDialog(button) {
  const postId = Number(button.dataset.postId);

  if (!Number.isSafeInteger(postId) || postId <= 0) {
    throw new Error("Invalid post ID.");
  }

  const isThreadRoot =
    button.dataset.deleteScope !== "reply";

  openConfirmDialog(
    isThreadRoot
      ? "Delete this thread?"
      : "Delete this reply?",
    isThreadRoot
      ? "Your post and the entire conversation under it are deleted — including other people's replies. This cannot be undone."
      : "Your reply is deleted. Its replies stay in the thread. This cannot be undone.",
    "delete",
    async () => {
      const viewedThreadId =
        state.activeRoute.name === "post" &&
        validId(state.activeRoute.id)
          ? Number(state.activeRoute.id)
          : null;

      await api(`/api/posts/${postId}`, {
        method: "DELETE",
      });

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

// Blocks (v4.4): a block hides both members from each other.
function openBlockDialog(button) {
  const userId = Number(button.dataset.profileId);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("Invalid profile ID.");
  }

  const username =
    button.dataset.username || "this member";

  openConfirmDialog(
    `Block @${username}?`,
    "You will no longer see their posts, and they can no longer see your profile or posts, reply, react, or message. You can undo it from your account settings.",
    "block",
    async () => {
      await api(`/api/users/${userId}/block`, {
        method: "POST",
      });

      confirmDialog.close();

      await state.renderRoute(state.activeRoute);

      setMessage(`Blocked @${username}.`);
    },
  );
}

// Account deletion (v2.4.1): POST /api/me/delete removes the account and
// everything it owns server-side.
function openDeleteAccountDialog() {
  openConfirmDialog(
    "Delete your account?",
    "Your account and everything it owns is permanently deleted: your posts — and every thread you started, including other people's replies inside those threads — plus your replies — and any sub-replies hanging off your replies in other members' threads go too — reactions, reports, notifications, and profile. There is no undo.",
    "delete",
    async () => {
      await api("/api/me/delete", {
        method: "POST",
      });

      setCsrfToken("");
      confirmDialog.close();

      state.router.navigate("/");

      setMessage(
        "Your account was deleted. You are signed out.",
      );
    },
  );
}

// Collapsible socials (plan v2.3): the details/summary wrapper lives in
// profile-editor.js. The owner's own profile opens by default.
function appendProfileSocials(profile, isOwnProfile) {
  const details = renderProfileSocials(
    document,
    profile,
    isOwnProfile,
  );

  if (details) {
    main.append(details);
  }
}

// Find the nearest ancestor containing the CSS input. This avoids assuming
// that the editor's input is always inside the closest div.
function findProfileCssInput(button) {
  let container = button.parentElement;

  while (container) {
    const input = container.querySelector("[data-css-input]");

    if (input) return input;

    container = container.parentElement;
  }

  return null;
}

// The registration seam: profile submits through FORM_HANDLERS.
export const FORM_HANDLERS = {
  "profile-editor": (form, text) =>
    submitProfileEditorForm(form, text),

  avatar: (form, text, values) =>
    submitAvatarForm(values),

  password: (form, text) =>
    submitPasswordForm(text),
};

export const ACTIONS = {
  "load-more-profile-posts": (button) =>
    loadMoreProfilePosts(button),

  "delete-post": (button) =>
    openDeletePostDialog(button),

  "delete-account": () =>
    openDeleteAccountDialog(),

  "block-user": (button) =>
    openBlockDialog(button),

  "save-profile-css": async (button) => {
    // Custom CSS (v2.5): POST the textarea's raw CSS to /api/me/css.
    const input = findProfileCssInput(button);

    if (!input) return;

    if (!input.value.trim()) {
      setMessage(
        "Write some CSS first, or use Remove to clear it.",
        true,
      );

      return;
    }

    await api("/api/me/css", {
      method: "POST",
      body: input.value,
    });

    setMessage("CSS saved — a mod will review it.");
  },

  "clear-profile-css": async () => {
    await api("/api/me/css", {
      method: "DELETE",
    });

    await state.renderRoute({
      name: "profile",
      username: state.currentUser.username,
    });

    setMessage("Custom CSS removed.");
  },

  "set-profile-accent": async (button) => {
    // Profile colors (any hex, v3.0.2): the swatch's data-accent is the
    // preset's hex ("" = clear). The server re-validates the hex.
    await api("/api/me", {
      method: "PATCH",
      body: {
        profileAccent: button.dataset.accent || "",
      },
    });

    await state.renderRoute(state.activeRoute);
  },
};

export { renderProfileRoute };
