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
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

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
import { formatBanCountdown } from "../banned.js";
import {
  SOCIAL_LABELS,
  SOCIAL_PLATFORM_ORDER,
  invalidSocialKeys,
  normalizeSocialHandle,
  renderProfileEditor,
  renderProfileSocials,
} from "../profile-editor.js";
import { renderProfileWall } from "../wall.js";
import { createFollowButton, loadFollowState } from "../follows.js";
import { createPrivateNoteBox, loadPrivateNote } from "../private-note.js";
import { openChatThread } from "../chat-widget.js";
import { currentLocale, t, tn } from "../i18n.js";
import {
  createPinnedThread,
  createPronouns,
  createRecentThreads,
  createStatusForm,
  createStatusLine,
  formatJoinedDate,
} from "../profile-extras.js";
import { badgeKeyFor, createNextBadge } from "../badge-progress.js";

async function renderProfileRoute(route, context, version) {
  const profile = await api(`/api/users/${encodeURIComponent(route.username)}`);
  if (version !== state.renderVersion) return;
  // Blocks (v4.4): a block pair (either direction) refuses the profile —
  // render the plain unavailable strip instead of the surface.
  if (profile.unavailable) {
    addHeading(main, t("profile.unavailableTitle"), 1);
    addText(document, main, "p", t("profile.unavailableBody"), "empty-state");
    return;
  }
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

// The node's own reset: renderRoute (app.js) removes the tracked <link> on
// every route switch. (The selectors are inert on non-profile pages, but the
// stylesheet keeps loading — remove the node outright so leaving a profile
// stops fetching and re-applying its css, and a stale node can never
// re-attach.)
export function clearProfileTheme() {
  if (activeProfileStyleNode) {
    activeProfileStyleNode.remove();
    activeProfileStyleNode = null;
  }
}

// Milestone badges (v2.5): display-only, computed from the profile's
// contribution counts — the thresholds graduate as the member posts.
// Wave 5.7: the thresholds live in badge-progress.js (shared with the
// own-profile "Next badge" line).
const profileBadgeFor = (totalContributions) => t(badgeKeyFor(totalContributions));

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
    image.alt = t("profile.avatarOf", { name: profile.username });
    heading.append(image);
  }
  const nameHeading = addHeading(heading, profile.username, 1);
  nameHeading.classList.add("profile-name");
  // Pronouns (v5.23.0 F2): opt-in, next to the name; nothing when unset.
  const pronouns = createPronouns(document, profile.pronouns);
  if (pronouns) nameHeading.append(pronouns);
  // Flair (v2.5): a short filtered label under the name; next to it the
  // milestone badge (v2.5, display-only, computed from the counter). The
  // role badge (v3.1) leads the row for staff — Owner or Admin, from the
  // server-mapped public role; members carry "member" and get nothing.
  const flairRow = element("p", "profile-flair-row");
  if (profile.role === "owner" || profile.role === "admin") {
    flairRow.append(element("span",
      "role-badge role-badge-" + profile.role,
      profile.role === "owner" ? t("profile.roleOwner") : t("profile.roleAdmin")));
  }
  if (profile.flair) flairRow.append(element("span", "profile-flair", profile.flair));
  const totalContributions = Number(profile.postsCount || 0) + Number(profile.repliesCount || 0);
  const badgeText = profileBadgeFor(totalContributions);
  if (badgeText) flairRow.append(element("span", "profile-badge", badgeText));
  if (flairRow.children.length) heading.append(flairRow);
  // Custom status (v5.38.0 F2): the server already dropped expired, banned
  // and block-paired statuses; nothing paints when the payload has none.
  const statusLine = createStatusLine(document, profile.status);
  if (statusLine) heading.append(statusLine);
  // Next badge (wave 5.7 F1): the member's own profile only.
  if (session.user?.id === profile.id) heading.append(createNextBadge(document, totalContributions));
  // Per-user post counter (v2.5): threads started + replies written, in the
  // profile heading (muted; display-only).
  heading.append(element("p", "profile-post-counts",
    [tn("counts.posts", Number(profile.postsCount || 0)), tn("counts.replies", Number(profile.repliesCount || 0))]
      .join(t("counts.separator"))));
  // Member since (wave 2026-11-21-13 F1): the join date in the reader's own
  // locale; omitted when the payload carries none.
  const joined = formatJoinedDate(profile.joinedAt, currentLocale());
  if (joined) heading.append(element("p", "profile-joined", t("profile.joined", { date: joined })));
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
    heading.append(element("span", "avatar-pending-badge", t("profile.avatarAwaitingReview")));
  }
  if (session.user && session.user.id !== profile.id) {
    // Day-2 widget wave: the Chat button boots the DM widget on this profile.
    // The numeric id is the primary seat (the backend's open-or-return keys
    // on { userId }); the username rides as a fallback seat.
    const chatButton = element("button", "button button-quiet", t("profile.chat"));
    chatButton.type = "button";
    chatButton.dataset.action = "chat-user";
    chatButton.dataset.profileId = String(profile.id);
    chatButton.dataset.username = profile.username;
    heading.append(chatButton);
    // Blocks (v4.4): the Block toggle lives beside the report control. Once a
    // pair exists this profile becomes unavailable (both directions), so the
    // Unblock controls live in the account settings' blocked-members list.
    const blockButton = element("button", "button button-quiet", t("common.block"));
    blockButton.type = "button";
    blockButton.dataset.action = "block-user";
    blockButton.dataset.profileId = String(profile.id);
    blockButton.dataset.username = profile.username;
    heading.append(blockButton);
    // Follow (v5.39.0): signed-in members only, never your own profile; the
    // caller's own state loads from the server before the button enables.
    const followButton = createFollowButton(document, { username: profile.username, following: false });
    heading.append(followButton);
    loadFollowState(followButton);
    // Report-a-profile (v2.5): the bio/flair/banner/css surface is
    // reportable like post content — same desk, same resolve flow.
    const reportProfile = element("button", "button button-quiet", t("profile.reportProfile"));
    reportProfile.type = "button";
    reportProfile.dataset.action = "report-profile";
    reportProfile.dataset.profileId = String(profile.id);
    heading.append(reportProfile);
  }
  appendProfileRoleControls(profile, session, heading);
  main.append(heading);
  // Pinned thread (v5.38.0 F1) on top, right under the heading.
  const pinned = createPinnedThread(document, profile.pinnedThread, currentLocale(),
    { own: session.user?.id === profile.id });
  if (pinned) main.append(pinned);
  // Banned-profile banner (v3.1): the server flags actively banned members
  // on the public payload (expiry included; the reason rides only for staff,
  // like member search). Everyone sees the banner — banning already hides the
  // member's posts, so the profile explains why the page reads empty.
  if (profile.banned) {
    let banText = t("profile.banned");
    if (profile.banExpiresAt) {
      banText = t("profile.bannedUntil", { time: formatBanCountdown(profile.banExpiresAt) ?? "" });
    }
    if (profile.banReason) banText += " " + t("profile.banReason", { reason: profile.banReason });
    main.append(element("p", "profile-banned-banner", banText));
  }
  addText(document, main, "p", profile.bio || t("profile.noBio"), "profile-bio");
  appendProfileSocials(profile, session.user?.id === profile.id);
  if (session.user && session.user.id !== profile.id) {
    // Private note (v5.47.0): the viewer's own note about this member —
    // only the viewer ever reads it; it loads before the editor enables.
    const noteBox = createPrivateNoteBox(document, { username: profile.username });
    main.append(noteBox);
    loadPrivateNote(noteBox);
  }
  if (session.user?.id === profile.id) {
    // Bio (10,000 chars) plus the ten social fields; submission re-fetches the
    // profile instead of trusting the asymmetric PATCH echo.
    renderProfileEditor(main, profile);
    // Custom status (v5.38.0 F2): its own panel and its own route.
    const statusPanel = createPanel(t("status.label"));
    statusPanel.append(createStatusForm(document, profile.status));
    main.append(statusPanel);
    // Any-hex profile color (v3.0.2): the picker's native color input PATCHes
    // on change (profile-editor.js stays DOM-pure; the glue lives here).
    const accentColorInput = main.querySelector(".accent-color-input");
    if (accentColorInput) {
      accentColorInput.addEventListener("change", async () => {
        await api("/api/me", { method: "PATCH", body: { profileAccent: accentColorInput.value } });
        await state.renderRoute(state.activeRoute);
      });
    }
    const pictures = createPanel(t("profile.pictureTitle"),
      t("profile.pictureNote"));
    const avatarForm = document.createElement("form");
    avatarForm.dataset.form = "avatar";
    avatarForm.append(createInput(document, {
      id: "profile-avatar", name: "avatar", label: t("profile.pictureLabel"),
      type: "file", accept: "image/jpeg,image/png,image/webp", required: true,
    }));
    addSubmit(avatarForm, t("profile.uploadPicture"));
    pictures.append(avatarForm);
    main.append(pictures);
  }
  // Recent threads (wave 2026-11-21-13 F2) sit above the wall; both fetch
  // their own payloads and never block the profile render. The threads panel
  // is appended synchronously so the order holds whichever fetch lands first.
  renderRecentThreads(profile);
  // Profile wall (v4.0): it fetches its own payload and never blocks the
  // profile render on the wall fetch.
  renderProfileWall(profile);
}

async function renderRecentThreads(profile) {
  const panel = createPanel(t("profile.threadsTitle"));
  panel.classList.add("profile-threads");
  main.append(panel);
  const version = state.renderVersion;
  let data;
  try {
    data = await api(`/api/users/${encodeURIComponent(profile.id)}/threads`);
  } catch {
    if (version === state.renderVersion) panel.append(element("p", "empty-state", t("profile.threadsLoadFailed")));
    return;
  }
  if (version !== state.renderVersion) return;
  panel.append(createRecentThreads(document, Array.isArray(data?.threads) ? data.threads : [], currentLocale(),
    { own: state.currentUser?.id === profile.id, pinnedId: profile.pinnedThread?.id ?? null }));
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
    ? ["admin-promote", t("profile.promote")]
    : ["admin-demote", t("profile.demote")];
  const form = document.createElement("form");
  form.dataset.form = formName;
  form.dataset.userId = String(profile.id);
  const button = element("button", "button button-secondary", label);
  button.type = "submit";
  form.append(button);
  container.append(form);
}

async function submitProfileEditorForm(form, text) {
  const socials = {};
  for (const key of SOCIAL_PLATFORM_ORDER) {
    const value = normalizeSocialHandle(key, text(key).trim());
    socials[key] = value === "" ? null : value;
  }
  const invalid = invalidSocialKeys(socials);
  if (invalid.length) {
    throw new Error(t("profile.invalidHandle", { platform: SOCIAL_LABELS[invalid[0]] }));
  }
  // Pronouns (v5.23.0 F2) have their own route; only a changed value is sent
  // ("" clears). It runs first so an invalid value stops the whole save.
  const pronouns = text("pronouns").trim();
  if (pronouns !== (form.dataset.pronouns || "")) {
    await api("/api/me/pronouns", { method: "PUT", body: { pronouns } });
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
  setMessage(t("profile.updated"));
}

async function submitAvatarForm(values) {
  const upload = new FormData();
  upload.append("avatar", values.get("avatar"));
  await api("/api/me/avatar", { method: "POST", body: upload });
  await state.renderRoute({ name: "profile", username: state.currentUser.username });
  setMessage(t("profile.pictureUpdated"));
}

async function submitPasswordForm(text) {
  await api("/api/me/password", {
    method: "PATCH",
    body: { currentPassword: text("currentPassword"), newPassword: text("newPassword") },
  });
  await state.renderRoute({ name: "home" });
  setMessage(t("profile.passwordChanged"));
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
    isThreadRoot ? t("profile.deleteThreadTitle") : t("profile.deleteReplyTitle"),
    isThreadRoot
      ? t("profile.deleteThreadBody")
      : t("profile.deleteReplyBody"),
    "delete",
    async () => {
      const viewedThreadId = state.activeRoute.name === "post" ? state.activeRoute.id : null;
      await api("/api/posts/" + postId, { method: "DELETE" });
      confirmDialog.close();
      if (viewedThreadId === postId) {
        // Replace, not push (wave 5.6 F1): Back must not reopen the gone post.
        state.router.navigate("/", { replace: true });
      } else {
        await state.renderRoute(state.activeRoute);
      }
      setMessage(t("profile.postDeleted"));
    },
  );
}

// Blocks (v4.4): the confirm dialog spells out the pairing — a block hides
// BOTH members from each other (this profile becomes unavailable on success,
// so the route re-render lands on the unavailable strip).
function openBlockDialog(button) {
  const userId = Number(button.dataset.profileId);
  const username = button.dataset.username || t("profile.thisMember");
  openConfirmDialog(
    t("profile.blockTitle", { name: username }),
    t("profile.blockBody"),
    "block",
    async () => {
      await api(`/api/users/${userId}/block`, { method: "POST" });
      confirmDialog.close();
      await state.renderRoute(state.activeRoute);
      setMessage(t("profile.blocked", { name: username }));
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
    t("profile.deleteAccountTitle"),
    t("profile.deleteAccountBody"),
    "delete",
    async () => {
      await api("/api/me/delete", { method: "POST" });
      setCsrfToken("");
      confirmDialog.close();
      state.router.navigate("/");
      setMessage(t("profile.accountDeleted"));
    },
  );
}

// Day-2 widget wave: Chat on a member's profile opens (or returns) the DM
// thread with them. The numeric id is the primary seat for open-or-return
// ({ userId }); the payload's username is only the fallback seat when no id
// is present. The button only mounts for signed-in viewers of another
// member's profile, so the widget's boot-probe law holds untouched; failures
// throw and paint the message bar (handleClick's single catch).
async function openProfileChat(button) {
  const profileId = Number(button.dataset.profileId);
  const username = button.dataset.username || "";
  const body = Number.isInteger(profileId) && profileId > 0 ? { userId: profileId } : { username };
  const thread = await api("/api/dm/threads", { method: "POST", body });
  const threadId = thread?.id;
  if (threadId == null) throw new Error(t("profile.chatFailed"));
  await openChatThread(threadId);
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
  // v5.38.0 F2: the custom status; "today" ends at the browser's midnight.
  "profile-status": async (form, text) => {
    await api("/api/me/status", {
      method: "PUT",
      body: {
        text: text("statusText").trim(),
        emoji: text("statusEmoji").trim(),
        expiry: text("statusExpiry"),
        tzOffset: new Date().getTimezoneOffset(),
      },
    });
    await state.renderRoute(state.activeRoute);
  },
};

export const ACTIONS = {
  "delete-post": (button) => openDeletePostDialog(button),
  "delete-account": () => openDeleteAccountDialog(),
  "block-user": (button) => openBlockDialog(button),
  "chat-user": (button) => openProfileChat(button),
  // v5.38.0 F1/F2: pin/unpin a thread on your profile; clear your status.
  "profile-pin": async (button) => {
    await api("/api/me/profile-pin", { method: "PUT", body: { postId: Number(button.dataset.postId) } });
    await state.renderRoute(state.activeRoute);
  },
  "profile-unpin": async () => {
    await api("/api/me/profile-pin", { method: "DELETE" });
    await state.renderRoute(state.activeRoute);
  },
  "profile-status-clear": async () => {
    await api("/api/me/status", { method: "DELETE" });
    await state.renderRoute(state.activeRoute);
  },
    "save-profile-css": async (button) => {
      // Custom CSS (v2.5): POST the textarea's raw css to /api/me/css; it
      // lands pending for a mod. The note is review-first wording.
      const form = button.closest("div");
      const input = form?.querySelector("[data-css-input]");
      if (!input) return;
      if (!input.value.trim()) {
        setMessage(t("profile.cssEmpty"), true);
        return;
      }
      await api("/api/me/css", { method: "POST", body: input.value });
      setMessage(t("profile.cssSaved"));
    },
    "clear-profile-css": async () => {
      await api("/api/me/css", { method: "DELETE" });
      await state.renderRoute({ name: "profile", username: state.currentUser.username });
      setMessage(t("profile.cssRemoved"));
    },
    "set-profile-accent": async (button) => {
      // Profile colors (any hex, v3.0.2): the swatch's data-accent is the
      // preset's hex ("" = clear). The server re-validates the hex; success
      // re-renders the route.
      await api("/api/me", { method: "PATCH", body: { profileAccent: button.dataset.accent || "" } });
      await state.renderRoute(state.activeRoute);
    },
};

export { renderProfileRoute };
