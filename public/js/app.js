import { api, setCsrfToken } from "./api.js";
import {
  createActiveBanList,
  createAppealQueue,
  createAttachmentQueue,
  createBanForm,
  createChatLog,
  createDmLog,
  createGifQueue,
  createAvatarQueue,
  createMemberSearch,
  createReportQueue,
  createTextModSection,
  createVisionSection,
  renderMemberSearchResults,
} from "./admin.js";
import { addText, createForm, createInput, createTextarea } from "./forms.js";
import { iconButton } from "./icons.js";
import { boardLabel } from "./boards.js";
import {
  appendPostList,
  closeEditForm,
  createPostCard,
  createSubReplyContainer,
  openEditForm,
  renderBodyBlocks,
  renderEditHistoryPanel,
} from "./render.js";
import { prefillQuote } from "./quotes.js";
import { isPlainLeftClick, startRouter } from "./router.js";
import {
  createNotificationBell,
  renderNotificationsPage,
  updateBell,
} from "./notifications.js";
import { formatBanCountdown } from "./banned.js";
import {
  backToDmList,
  createChatButton,
  deleteChatMessage,
  deleteDmMessage,
  initChat,
  openDmThread,
  openDmWith,
  renderChatPage,
  setChatTab,
  submitChatMessage,
  submitDmMessage,
  updateChatSession,
} from "./chat.js";
import { applyCornerPreference, initTheme } from "./theme.js";
import {
  SOCIAL_LABELS,
  SOCIAL_PLATFORM_ORDER,
  invalidSocialKeys,
  renderProfileEditor,
  renderProfileSocials,
} from "./profile-editor.js";
import {
  addTurnstileSlot,
  refreshTurnstile,
  renderTurnstileSlots,
  takeTurnstileToken,
  teardownTurnstile,
} from "./turnstile.js";
// v4.0 plan 4 Task 1: the shell singletons + panel helpers live in dom.js.
import {
  accountActions,
  addHeading,
  addSubmit,
  attachmentLightbox,
  clearConfirmHandler,
  confirmDialog,
  confirmOk,
  createPanel,
  element,
  getConfirmHandler,
  main,
  openConfirmDialog,
  reportDialog,
  reportForm,
  setMessage,
} from "./dom.js";
// v4.0 plan 4 Task 2: the auth concern (auth panels, setup screens, their
// submit handlers) lives in routes/auth.js; the route + form registries
// spread its handlers as the dispatch entries that used to live inline here.
import {
  FORM_HANDLERS as authFormHandlers,
  renderHomeAccess,
  renderSetupRoute,
} from "./routes/auth.js";

// v4.0 plan 4 Task 2: the boot state lives in state.js (route modules read
// and write the same bag). renderRoute is hoisted, so it can be published
// here at module scope before any route module runs.
import { state } from "./state.js";
state.renderRoute = renderRoute;
// v4.0 plan 4 Task 3: the feed concern (home/search/mine/category/bookmarks
// routes, feed tabs, the composer family + its dialogs, feed pagination) lives
// in routes/feed.js; registries spread its handlers as dispatch entries.
import {
  ACTIONS as feedActions,
  FORM_HANDLERS as feedFormHandlers,
  createComposer,
  handleComposerFileSelection,
  renderBookmarksRoute,
  renderCategoryRoute,
  renderHomeRoute,
  renderMineRoute,
  uploadCommunityGif,
} from "./routes/feed.js";
// v4.0 profile wall: its module owns the render + the post/pin registrations.
import {
  ACTIONS as wallActions,
  FORM_HANDLERS as wallFormHandlers,
  renderProfileWall,
} from "./wall.js";
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


function renderAccountNavigation(user, unreadNotifications = 0) {
  accountActions.replaceChildren();
  // The mobile bar's last item mirrors the session: Profile (signed in) --
  // the static markup ships a Sign-in item for guests; the id marks it.
  const mobileSignIn = document.querySelector("#mobile-signin") ||
    document.querySelector("#mobile-profile") ||
    document.querySelector(".mobile-bar .mobile-bar-item:last-child");
  if (mobileSignIn) {
    const span = mobileSignIn.querySelector("span:last-of-type");
    mobileSignIn.id = user ? "mobile-profile" : "mobile-signin";
    mobileSignIn.href = user ? "/users/" + encodeURIComponent(user.username) : "/#join";
    mobileSignIn.setAttribute("aria-label", user ? "Profile" : "Sign in");
    mobileSignIn.title = user ? "Profile" : "Sign in";
    if (span) span.textContent = user ? "Profile" : "Sign in";
    if (user) mobileSignIn.dataset.appLink = "";
    else mobileSignIn.removeAttribute("data-app-link");
  }
  // Suggestions board link (v2.4.1): the header's site-section link, styled
  // exactly like the links around it and visible to guests and signed-in
  // members alike; internal navigation handles it like every other header
  // anchor. The brand stays Home.
  const suggestions = iconButton(document, "lightbulb", {
    tagName: "a",
    className: "button button-secondary icon-button",
    dataset: { href: "/suggestions" },
  });
  suggestions.setAttribute("data-app-link", "");
  accountActions.append(suggestions);
  // Accountability archive (v2.4.1): public to guests and members alike.
  const archiveLink = iconButton(document, "archive", {
    tagName: "a",
    className: "button button-secondary icon-button",
    dataset: { href: "/archive" },
  });
  archiveLink.setAttribute("data-app-link", "");
  accountActions.append(archiveLink);
  const leaderboardLink = iconButton(document, "trophy", {
    tagName: "a",
    className: "button button-secondary icon-button",
    dataset: { href: "/leaderboard" },
  });
  leaderboardLink.setAttribute("data-app-link", "");
  accountActions.append(leaderboardLink);
  const rulesLink = iconButton(document, "scroll", {
    tagName: "a",
    className: "button button-secondary icon-button",
    dataset: { href: "/rules" },
  });
  rulesLink.setAttribute("data-app-link", "");
  accountActions.append(rulesLink);
  // Live chat (v3.1): the panel toggle carries the online counter. Guests
  // read the stream and see the count; sending needs a session.
  accountActions.append(createChatButton(document));
  if (!user) {
    const signIn = element("a", "button button-secondary", "Sign in");
    signIn.href = "/#join";
    signIn.setAttribute("data-app-link", "");
    accountActions.append(signIn);
    return;
  }
  const profile = iconButton(document, "person", {
    tagName: "a",
    className: "button button-secondary icon-button",
    ariaLabel: "Profile — " + user.username,
    dataset: { href: "/users/" + encodeURIComponent(user.username) },
  });
  profile.setAttribute("data-app-link", "");
  accountActions.append(profile);
  // Bookmarks (C4): the private saved list — members only.
  const saved = iconButton(document, "bookmarks", {
    tagName: "a",
    className: "button button-secondary icon-button",
    ariaLabel: "Saved posts",
    dataset: { href: "/bookmarks" },
  });
  saved.setAttribute("data-app-link", "");
  accountActions.append(saved);
  // Appeals (v3.1): the member surface for auto-mod decisions and history.
  const appeals = iconButton(document, "flag", {
    tagName: "a",
    className: "button button-secondary icon-button",
    ariaLabel: "Appeals",
    dataset: { href: "/appeals" },
  });
  appeals.setAttribute("data-app-link", "");
  accountActions.append(appeals);
  accountActions.append(createNotificationBell(unreadNotifications, document));
  if (user.role === "owner" || user.role === "admin") {
    const reports = iconButton(document, "shield", {
      tagName: "a",
      className: "button button-secondary icon-button",
      dataset: { href: "/admin/reports" },
    });
    accountActions.append(reports);
  }
  const logout = iconButton(document, "logout", {
    className: "button button-quiet icon-button",
    dataset: { action: "logout" },
  });
  accountActions.append(logout);
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

// Collapsible socials (plan v2.3): the details/summary wrapper lives in
// profile-editor.js (renderProfileSocials, glue-testable); open state is a
// plain `details.open = isOwnProfile` assignment — owner's own profile OPEN,
// visitors CLOSED.
function appendProfileSocials(profile, isOwnProfile) {
  const details = renderProfileSocials(document, profile, isOwnProfile);
  if (details) main.append(details);
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
        await renderRoute(state.activeRoute);
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

function renderAdmin(reportData, banData, avatarData, attachmentData, cssData, profileReportData, gifData, rulesData, hiddenData, user, appealData, visionData, textModData, chatData, dmData) {
  addHeading(main, "Moderation desk", 1);
  addText(document, main, "p", "Review reports, hide inappropriate posts, and manage active bans.", "page-lede");
  // Auto-mod control (v3.1): the status line + THE kill switch, front and
  // center so stopping Vision never takes more than one click.
  addHeading(main, "Auto-mod (Google Vision)", 2);
  main.append(createVisionSection(visionData, document));
  // Text auto-mod control (v3.1): the OpenAI Moderation twin — its own kill
  // switch, independent of Vision's.
  addHeading(main, "Auto-mod (OpenAI text moderation)", 2);
  main.append(createTextModSection(textModData, document));
  addHeading(main, "Open reports", 2);
  main.append(createReportQueue(reportData.reports, document, user));
  addHeading(main, "Avatars awaiting review", 2);
  main.append(createAvatarQueue(avatarData.avatars, document));
  addHeading(main, "Images awaiting review", 2);
  main.append(createAttachmentQueue(attachmentData.attachments, document));
  addHeading(main, "Profile CSS awaiting review", 2);
  main.append(createCssQueue(cssData.cssSubmissions, document));
  addHeading(main, "Profile reports", 2);
  main.append(createProfileReportQueue(profileReportData.profileReports, document));
  addHeading(main, "Appeals", 2);
  main.append(createAppealQueue(appealData.appeals, document));
  // Chat log (v3.1): the full stream for staff — banned authors included —
  // with in-place deletion. Newest first.
  addHeading(main, "Chat log", 2);
  main.append(createChatLog(chatData.messages, document));
  // DM log (v3.1): 1:1 messages under the same scrutiny — both participants
  // named, deletable in place.
  addHeading(main, "DM log", 2);
  main.append(createDmLog(dmData.messages, document));
  addHeading(main, "Forum rules", 2);
  main.append(createRulesEditor(rulesData.rules, document));
  addHeading(main, "Gallery uploads awaiting review", 2);
  main.append(createGifQueue(gifData.gifs, document));
  // Hidden posts (v3.0.1, the nuke): the mod-only page — hidden rows
  // and anything by an actively banned author, bodies included.
  addHeading(main, "Hidden posts", 2);
  main.append(createHiddenPostsQueue(hiddenData.hidden, document));
  addHeading(main, "Active bans", 2);
  main.append(createActiveBanList(banData.bans, document));
  // Find a member (v3.1): username search with the unban form attached, so an
  // unban is one search + one button (Pone's ask).
  addHeading(main, "Find a member", 2);
  main.append(createMemberSearch(document));
}

async function prepareRouteContext(version) {
  const [session, setup] = await Promise.all([
    api("/api/session"),
    api("/api/setup/status"),
  ]);
  if (version !== state.renderVersion) return null;
  state.currentUser = session.user;
  setCsrfToken(session.csrfToken);
  renderAccountNavigation(session.user, session.unreadNotifications ?? 0);
  // Live chat (v3.1): mirror the session into the chat module — heartbeat
  // start/stop and the send form's availability. Cheap on repeats.
  updateChatSession(session.user);
  return {
    session,
    setupRequired: setup.required,
    setupConfigured: setup.secretConfigured && setup.passwordSecurityConfigured,
  };
}

function setRouteTitle(route) {
  const pageNames = {
    home: "Wempo's Forum",
    search: "Search",
    suggestions: "Suggestions",
    archive: "Archive",
    mine: "My posts",
    leaderboard: "Leaderboard",
    rules: "Rules",
    chat: "Chat",
    post: "Post",
    profile: "Profile",
    admin: "Moderation",
    appeals: "Appeals",
    notifications: "Notifications",
    bookmarks: "Saved posts",
    setup: "First-time setup",
    "not-found": "Not found",
  };
  document.title = route.name === "home"
    ? "Wempo's Forum"
    : route.name === "category"
      // Categories (v3.1): the title carries the category's display name.
      ? `${route.board ? boardLabel(route.board) : "Category"} · Wempo's Forum`
      : `${pageNames[route.name] || pageNames.home} · Wempo's Forum`;
}

async function renderRulesRoute(context, version) {
  const data = await api("/api/rules");
  if (version !== state.renderVersion) return;
  addHeading(main, "Forum rules", 2);
  if (!data.rules) {
    addText(document, main, "p", "The rules haven't been written yet.", "empty-state");
    return;
  }
  renderBodyBlocks({ body: data.rules }, document, main);
  if (data.updatedAt) {
    addText(document, main, "p", `Last updated ${new Date(data.updatedAt).toLocaleString()}`, "muted");
  }
}

async function renderLeaderboardRoute(context, version) {
  const data = await api("/api/leaderboard");
  if (version !== state.renderVersion) return;
  addHeading(main, "Leaderboard", 2);
  const rows = data.allTime.leaderboard;
  if (!rows.length) {
    addText(document, main, "p", "Nothing yet — be the first!", "empty-state");
    return;
  }
  const list = element("ol", "leaderboard-list");
  for (const [index, entry] of rows.entries()) {
    const row = element("li", "leaderboard-row");
    row.append(element("span", "leaderboard-rank", "#" + (index + 1)));
    const link = element("a", "leaderboard-name", entry.username);
    link.href = "/users/" + encodeURIComponent(entry.username);
    link.setAttribute("data-app-link", "");
    row.append(link, element("span", "leaderboard-stats",
      `${entry.threads} threads · ${entry.replies} replies · ${entry.reactionsReceived} reactions received`));
    row.append(element("span", "leaderboard-score", String(entry.score)));
    list.append(row);
  }
  main.append(list);
}

async function renderArchiveRoute(context, version) {
  // The accountability archive (v2.4.1): everyone can read what was deleted,
  // so no auth is needed — this route renders for guests too.
  const data = await api("/api/archive");
  if (version !== state.renderVersion) return;
  addHeading(main, "Archive", 2);
  if (!data.archive.length) {
    main.append(element("p", "archive-empty", "Nothing has been deleted yet."));
    return;
  }
  main.append(await renderArchiveListFragment(data.archive));
  if (!data.nextBefore) return;
  const older = element("button", "button button-secondary", "Load older archive");
  older.type = "button";
  older.dataset.action = "load-more-archive";
  older.dataset.before = String(data.nextBefore);
  main.append(older);
}

async function renderArchiveListFragment(entries) {
  const list = element("div", "archive-list");
  for (const entry of entries) {
    const card = element("article", "archive-card");
    const header = element("p", "archive-header");
    header.append(element("span", "archive-author", "post by " + entry.authorName));
    header.append(element("span", "archive-meta",
      "deleted " + new Date(entry.deletedAt).toLocaleString() + " · " +
      (entry.deletedBecause === "account-delete" ? "account deleted" : "post deleted") +
      " · deleted by " + (entry.deletedByName || "unknown")));
    card.append(header);
    const bodyBlock = element("p", "archive-body");
    bodyBlock.textContent = entry.body;
    card.append(bodyBlock);
    list.append(card);
  }
  return list;
}

// Live chat page (v3.1): the /chat route — the room + DMs live here as a full
// page. chat.js owns the body (tabs, streams, send forms); the cursors and
// open thread survive navigation in chat.js module state.
async function renderChatRoute(context, version) {
  addHeading(main, "Live chat", 1);
  addText(document, main, "p",
    "One public room plus your DMs. You count as online while you're signed in — tick Invisible in the header to lurk without appearing.",
    "page-lede");
  renderChatPage(main, context.session.user);
}


async function renderPostRoute(route, context, version) {
  const post = await api(`/api/posts/${route.id}`);
  if (version !== state.renderVersion) return;
  addHeading(main, "Conversation", 1);
  main.append(createPostCard(post, document, context.session.user));
  addHeading(main, "Replies", 2);
  if (post.replies.length) {
    const replyList = element("div", "post-list replies-list");
    replyList.dataset.repliesFor = String(post.id);
    for (const reply of post.replies) replyList.append(createPostCard(reply, document, context.session.user));
    main.append(replyList);
  } else {
    addText(document, main, "p", "No replies yet!", "empty-state");
  }
  if (post.repliesNextBefore) {
    const olderReplies = element("button", "button button-secondary", "Load older replies");
    olderReplies.type = "button";
    olderReplies.dataset.action = "load-older-replies";
    olderReplies.dataset.postId = String(post.id);
    olderReplies.dataset.before = String(post.repliesNextBefore);
    main.append(olderReplies);
  }
  if (context.session.user && post.visibility !== "hidden" && !post.parent) {
    main.append(createComposer("reply", "Write a thoughtful reply", "Reply", post.id));
  }
}

async function renderProfileRoute(route, context, version) {
  const profile = await api(`/api/users/${encodeURIComponent(route.username)}`);
  if (version !== state.renderVersion) return;
  renderProfile(profile, context.session);
}

function createProfileReportQueue(reports, document) {
  const container = element("div", "profile-report-queue");
  if (!reports.length) {
    addText(document, container, "p", "No profile reports.", "empty-state");
    return container;
  }
  for (const report of reports) {
    const item = element("div", "report-queue-item");
    const head = element("p", "report-queue-head",
      report.profileUsername + " (reported by " + report.reporter + ")");
    const reason = element("p", "report-queue-reason");
    reason.textContent = report.reason;
    const resolve = element("button", "button", "Resolve");
    resolve.type = "button";
    resolve.dataset.action = "resolve-profile-report";
    resolve.dataset.reportId = String(report.id);
    const visit = element("a", "button button-quiet", "View profile");
    visit.href = "/users/" + encodeURIComponent(report.profileUsername);
    visit.setAttribute("data-app-link", "");
    // Ban affordance (v3.0.2): a profile report used to be resolve-only —
    // the same admin-ban form as the post-report queue (reason + duration)
    // lets the mod act on the reported member right here. The generic
    // data-form="admin-ban" submit handler picks it up unchanged.
    item.append(head, reason, resolve, visit, createBanForm(document, report.profileUserId, report.profileUsername));
    container.append(item);
  }
  return container;
}

function createHiddenPostsQueue(items, document) {
  const container = element("div", "hidden-posts-queue");
  if (!items.length) {
    addText(document, container, "p", "Nothing hidden right now.", "empty-state");
    return container;
  }
  for (const item of items) {
    const card = element("div", "hidden-post-item");
    const head = element("p", "hidden-post-head",
      item.author.username + " — " +
      (item.banReason ? "ban: " + item.banReason : "hidden post") +
      (item.banExpiresAt ? " (until " + new Date(item.banExpiresAt).toLocaleString() + ")" : " (permanent)"));
    const body = element("p", "hidden-post-body");
    body.textContent = item.body;
    const when = element("p", "hidden-post-when", new Date(item.createdAt).toLocaleString());
    const link = element("a", "button button-quiet", item.threadId === item.id ? "Open post" : "Open thread");
    link.href = "/posts/" + item.threadId;
    link.setAttribute("data-app-link", "");
    card.append(head, body, when, link);
    container.append(card);
  }
  return container;
}

function createRulesEditor(rulesData, document) {
  const container = element("div", "rules-editor");
  const label = element("p", "accent-picker-label", "Forum rules (markdown — the subset bodies use)");
  const textarea = element("textarea", "css-editor-input");
  textarea.id = "rules-input";
  textarea.rows = 10;
  textarea.maxLength = 1000000;
  textarea.value = typeof rulesData.rules === "string" ? rulesData.rules : "";
  const save = element("button", "button", "Save rules");
  save.type = "button";
  save.dataset.action = "save-forum-rules";
  container.append(label, textarea, save);
  return container;
}

function createCssQueue(submissions, document) {
  const container = element("div", "css-queue");
  if (!submissions.length) {
    addText(document, container, "p", "No CSS waiting for review.", "empty-state");
    return container;
  }
  for (const submission of submissions) {
    const item = element("div", "css-queue-item");
    const head = element("p", "css-queue-head", submission.username + " — " + submission.bytes + " chars");
    const preview = element("pre", "css-queue-preview");
    preview.textContent = submission.css;
    const approve = element("button", "button", "Approve");
    approve.type = "button";
    approve.dataset.action = "css-approve";
    approve.dataset.userId = String(submission.userId);
    approve.dataset.version = String(submission.version || "");
    const reject = element("button", "button button-quiet", "Reject");
    reject.type = "button";
    reject.dataset.action = "css-reject";
    reject.dataset.userId = String(submission.userId);
    reject.dataset.version = String(submission.version || "");
    item.append(head, preview, approve, reject);
    container.append(item);
  }
  return container;
}

async function renderAdminRoute(context, version) {
  const [reports, bans, avatars, attachments, css, profileReports, gifs, rules, hidden, appeals, vision, textMod, chat, dms] = await Promise.all([
    api("/api/admin/reports"),
    api("/api/admin/bans"),
    api("/api/admin/avatars"),
    api("/api/admin/attachments"),
    api("/api/admin/css"),
    api("/api/admin/profile-reports"),
    api("/api/admin/gifs"),
    api("/api/rules"),
    api("/api/admin/hidden"),
    api("/api/admin/appeals"),
    api("/api/admin/vision"),
    api("/api/admin/text-mod"),
    api("/api/admin/chat"),
    api("/api/admin/dms"),
  ]);
  if (version !== state.renderVersion) return;
  renderAdmin(reports, bans, avatars, attachments, css, profileReports, gifs, rules, hidden, context.session.user, appeals, vision, textMod, chat, dms);
}


// Appeals (v3.1): the member surface for auto-mod decisions — the removals
// they can still appeal, plus their history. BAN appeals file from the ban
// screen instead (banned members have no session to get here with).
async function renderAppealsRoute(context, version) {
  addHeading(main, "Appeals", 1);
  if (!context.session.user) {
    addText(document, main, "p", "Sign in to appeal an auto-mod decision.", "muted");
    return;
  }
  const data = await api("/api/me/appeals");
  if (version !== state.renderVersion) return;
  addHeading(main, "Auto-mod decisions you can appeal", 2);
  if (!data.appealableActions.length) {
    addText(document, main, "p", "Nothing to appeal — auto-mod has not removed anything of yours.", "empty-state");
  }
  for (const action of data.appealableActions) {
    const item = element("div", "appeal-action-item");
    addText(document, item, "p",
      new Date(action.createdAt).toLocaleString() + " — " + action.reason, "muted");
    const form = createForm(document, "member-appeal", [
      createTextarea(document, {
        id: "appeal-body-" + action.id,
        name: "body",
        label: "Why was this removal wrong?",
        required: true,
        maxLength: 1000,
        rows: 3,
      }),
    ], "Appeal");
    form.dataset.actionId = String(action.id);
    item.append(form);
    main.append(item);
  }
  addHeading(main, "Your appeal history", 2);
  if (!data.appeals.length) {
    addText(document, main, "p", "You have not filed any appeals.", "empty-state");
    return;
  }
  for (const appeal of data.appeals) {
    const item = element("div", "appeal-history-item");
    addText(document, item, "p",
      (appeal.kind === "ban" ? "Ban appeal" : "Auto-mod appeal") + " — " + appeal.status +
      " — " + new Date(appeal.createdAt).toLocaleString(), "muted");
    if (appeal.reason) addText(document, item, "p", "About: " + appeal.reason, "muted");
    addText(document, item, "p", '"' + appeal.body + '"', "appeal-body");
    main.append(item);
  }
}

async function renderNotificationsRoute(context, version) {
  if (!context.session.user) {
    addHeading(main, "Notifications", 1);
    addText(document, main, "p", "Sign in to see your notifications.", "muted");
    const signIn = element("a", "button button-secondary", "Sign in");
    signIn.href = "/#join";
    main.append(signIn);
    return;
  }
  const data = await api("/api/me/notifications");
  if (version !== state.renderVersion) return;
  renderNotificationsPage(main, data.notifications);
}

function renderNotFoundRoute() {
  addHeading(main, "Page not found", 1);
  addText(document, main, "p", "That page isn't available.", "muted");
}

async function renderRoute(route) {
  const version = ++state.renderVersion;
  state.activeRoute = route;
  main.classList.toggle("home-page", route.name === "home");
  // Profile themes (v2.5): main outlives routes — a member's accent class
  // must never tint another route (the review caught exactly that).
  main.classList.remove("profile-section");
  // Profile accent + banner (any hex, v3.0.2): both ride CSS custom
  // properties on main — main outlives routes, so a member's colors must
  // never tint another route (the review caught exactly that for classes).
  main.style.removeProperty("--profile-accent");
  main.style.removeProperty("--banner-color");
  // Custom profile CSS (v2.5): the tracked <link> was removed inside
  // applyProfileTheme (which also owns the null assignment at the top of this
  // render); the scope class must be dropped here so the class never tints a
  // non-profile route (the review caught exactly that for the accent).
  main.classList.remove("profile-theme-scope");
  activeProfileStyleNode = null;
  teardownTurnstile();
  main.replaceChildren();
  setMessage();

  const context = await prepareRouteContext(version);
  if (!context) return;
  setRouteTitle(route);

  const renderers = {
    setup: () => renderSetupRoute(context),
    home: () => renderHomeRoute(route, context, version),
    search: () => renderHomeRoute(route, context, version),
    mine: () => renderMineRoute(context, version),
    leaderboard: () => renderLeaderboardRoute(context, version),
    rules: () => renderRulesRoute(context, version),
    category: () => renderCategoryRoute(route, context, version),
    chat: () => renderChatRoute(context, version),
    archive: () => renderArchiveRoute(context, version),
    post: () => renderPostRoute(route, context, version),
    profile: () => renderProfileRoute(route, context, version),
    admin: () => renderAdminRoute(context, version),
    appeals: () => renderAppealsRoute(context, version),
    notifications: () => renderNotificationsRoute(context, version),
    bookmarks: () => renderBookmarksRoute(context, version),
    "not-found": () => renderNotFoundRoute(),
  };
  const renderPage = renderers[route.name] || renderNotFoundRoute;
  await renderPage();
  await renderTurnstileSlots(main);
}

// Member search (v3.1): fetch and render into the section's results node.
async function submitMemberSearch(form, text) {
  const data = await api("/api/admin/users/search?q=" + encodeURIComponent(text("q").trim()));
  const results = form.parentElement?.querySelector("[data-member-search-results]");
  results?.replaceChildren(renderMemberSearchResults(data.members, document));
}

// Appeals (v3.1): the desk's approve/deny, the member's auto-mod appeal, and
// the session-less ban appeal from the ban screen.
async function submitAppealDecision(form) {
  await api("/api/admin/appeals/" + encodeURIComponent(form.dataset.appealId) + "/" + form.dataset.decision, { method: "POST" });
  await renderRoute(state.activeRoute);
  setMessage(form.dataset.decision === "approve" ? "Appeal approved." : "Appeal denied.");
}

async function submitMemberAppeal(form, text) {
  await api("/api/me/appeals", {
    method: "POST",
    body: { actionId: Number(form.dataset.actionId), body: text("body") },
  });
  await renderRoute(state.activeRoute);
  setMessage("Appeal filed — an admin will review it.");
}

async function submitBanAppealForm(form, text) {
  // The ban screen has no session, so there is no CSRF token — the same-origin
  // header is the guard, and the username + password (the identity proof)
  // travel in the body.
  await api("/api/appeals", {
    method: "POST",
    body: { username: text("username"), password: text("password"), body: text("body") },
  });
  setMessage("Appeal filed — an admin will review it.");
  form.replaceChildren();
  addText(document, form, "p", "Appeal received. You can close this page now.", "empty-state");
}

function readForm(form) {
  return new FormData(form);
}

async function submitSiteSearch(text) {
  state.router.navigate("/?q=" + encodeURIComponent(text("q").trim()));
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
  await renderRoute({ name: "profile", username: state.currentUser.username });
  setMessage("Your profile was updated.");
}

async function submitAvatarForm(values) {
  const upload = new FormData();
  upload.append("avatar", values.get("avatar"));
  await api("/api/me/avatar", { method: "POST", body: upload });
  await renderRoute({ name: "profile", username: state.currentUser.username });
  setMessage("Your profile picture was updated.");
}

async function submitPasswordForm(text) {
  await api("/api/me/password", {
    method: "PATCH",
    body: { currentPassword: text("currentPassword"), newPassword: text("newPassword") },
  });
  await renderRoute({ name: "home" });
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
        await renderRoute(state.activeRoute);
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

async function submitReportForm(text) {
  const targetType = reportForm.dataset.targetType || "post";
  const targetId = encodeURIComponent(reportForm.dataset.targetId || "");
  const endpoint = targetType === "profile"
    ? "/api/users/" + targetId + "/reports"
    : "/api/posts/" + targetId + "/reports";
  await api(endpoint, { method: "POST", body: { reason: text("reason") } });
  reportDialog.close();
  reportForm.reset();
  delete reportForm.dataset.targetType;
  delete reportForm.dataset.targetId;
  document.querySelector("#report-title").textContent = "Report this post";
  setMessage("Your report was sent to the mods.");
}

// Author edit save (v2.4): JSON {body} to PATCH /api/posts/:id (api.js adds the
// CSRF header). The server reapplies the word filter and 1,000-char cap, stores
// the masked body, stamps edited_at, and never bumps last_activity_at — over-
// limit/filter rejections 400 into the shared error bar here, with the form
// left open so the author can fix the draft. On success the route re-render
// refetches the post, so the edited body, the (edited) marker, and the closed
// form all come back from the server — never from trusting the PATCH echo.
async function submitPostEditForm(form, text) {
  await api("/api/posts/" + form.dataset.postId, {
    method: "PATCH",
    body: { body: text("body") },
  });
  await renderRoute(state.activeRoute);
  setMessage("Your edit was saved.");
}

async function submitReportResolution(form) {
  await api("/api/admin/reports/" + form.dataset.reportId + "/resolve", {
    method: "POST",
    body: { action: form.dataset.action },
  });
  await renderRoute({ name: "admin" });
  setMessage("The report was updated.");
}

async function submitBanForm(form, text) {
  // Timed bans (v3.0.2): the optional duration select carries hours; 0 or
  // absent = permanent. Hours become an absolute epoch-seconds expiresAt —
  // the server re-validates the window (a minute to a year out).
  const durationSelect = form.querySelector("select[name=\"duration\"]");
  const hours = Number(durationSelect && durationSelect.value) || 0;
  const body = { reason: text("reason") };
  if (hours > 0) body.expiresAt = Math.floor(Date.now() / 1000) + hours * 3600;
  // IP bans (v3.1): the opt-in checkbox rides the same request.
  if (text("ipBan") === "on") body.ipBan = true;
  await api("/api/admin/users/" + form.dataset.userId + "/bans", {
    method: "POST",
    body,
  });
  await renderRoute({ name: "admin" });
  setMessage(hours > 0
    ? "The user was banned and their sessions revoked. Their account reactivates when the ban expires."
    : "The user was banned and their sessions revoked.");
}

async function submitUnbanForm(form, text) {
  await api("/api/admin/users/" + form.dataset.userId + "/bans", {
    method: "DELETE",
    body: { reason: text("reason") },
  });
  await renderRoute({ name: "admin" });
  setMessage("The ban was lifted.");
}

async function submitForm(form) {
  const values = readForm(form);
  const type = form.dataset.form;
  const text = (name) => String(values.get(name) ?? "");
  setMessage("Saving…");

  const handlers = {
    "site-search": () => submitSiteSearch(text),
    ...authFormHandlers,
    ...feedFormHandlers,
    ...wallFormHandlers,
    "profile-editor": () => submitProfileEditorForm(form, text),
    avatar: () => submitAvatarForm(values),
    password: () => submitPasswordForm(text),
    report: () => submitReportForm(text),
    "post-edit": () => submitPostEditForm(form, text),
    "admin-resolve": () => submitReportResolution(form),
    "admin-ban": () => submitBanForm(form, text),
    "admin-unban": () => submitUnbanForm(form, text),
    "admin-promote": () => submitRoleChange(form, "promote", text),
    "admin-demote": () => submitRoleChange(form, "demote", text),
    "admin-avatar-approve": () => submitAvatarModeration(form, "approve"),
    "admin-avatar-reject": () => submitAvatarModeration(form, "reject"),
    "admin-attachment-approve": () => submitAttachmentModeration(form, "approve"),
    "admin-attachment-reject": () => submitAttachmentModeration(form, "reject"),
    "admin-member-search": () => submitMemberSearch(form, text),
    "admin-appeal": () => submitAppealDecision(form),
    "member-appeal": () => submitMemberAppeal(form, text),
    "ban-appeal": () => submitBanAppealForm(form, text),
    "chat-send": async () => {
      // submitForm's generic "Saving…" status reads wrong for a live chat;
      // clear it once the message lands (errors still surface via api()).
      await submitChatMessage(form);
      setMessage();
    },
    "dm-send": async () => {
      await submitDmMessage(form);
      setMessage();
    },
  };
  const handler = handlers[type];
  // Route-module handlers take (form, text, values); entries still owned in
  // app.js are zero-arg closures that ignore the arguments — call uniformly.
  if (handler) await handler(form, text, values);
}

function handleInternalNavigation(event) {
  if (!isPlainLeftClick(event)) return false;
  const anchor = event.target.closest("a");
  if (!anchor || anchor.origin !== location.origin || !anchor.pathname.startsWith("/") ||
      anchor.hash || anchor.hasAttribute("download")) return false;
  event.preventDefault();
  state.router.navigate(anchor.pathname + anchor.search);
  return true;
}

async function submitReaction(button) {
  // Stateful toggle: an "active" button carries the viewer's own reaction, so
  // clicking it retracts (DELETE); otherwise it sets the value (PUT).
  if (button.dataset.state === "active") {
    await api("/api/posts/" + button.dataset.postId + "/reaction", { method: "DELETE" });
  } else {
    await api("/api/posts/" + button.dataset.postId + "/reaction", {
      method: "PUT",
      body: { value: button.dataset.value },
    });
  }
  await renderRoute(state.activeRoute);
}

async function toggleReplyComposer(button) {
  const postId = button.dataset.postId;
  const article = main.querySelector(`article[data-post-id="${postId}"]`);
  if (!article) return;
  const existing = main.querySelector(`[data-reply-composer-for="${postId}"]`);
  if (existing) {
    existing.remove();
    return;
  }
  // Mini composer under the level-1 reply; replies go to /api/posts/:thatId
  // with Turnstile action "reply".
  const panel = createComposer("reply", "Write a reply", "Reply", postId, "reply");
  panel.dataset.replyComposerFor = postId;
  // submitReplyForm reads the FORM's dataset (the thread root it should
  // re-render after a successful reply), not the marker panel's — so the
  // thread id must ride on the form itself or the rerender would land on the
  // level-1 reply's own detail page instead of the conversation.
  if (state.activeRoute.name === "post") {
    panel.querySelector("form").dataset.threadId = String(state.activeRoute.id);
  }
  article.after(panel);
  await renderTurnstileSlots(panel);
}

async function toggleSubReplies(button) {
  // Double-click guard: one fetch per expand; a stale in-flight request never
  // builds a duplicate container (the old one is orphaned by re-render).
  if (button.dataset.loading === "1") return;
  const postId = button.dataset.postId;
  const existing = main.querySelector(`[data-sub-replies-for="${postId}"]`);
  if (existing) {
    const hidden = existing.hasAttribute("hidden");
    if (hidden) existing.removeAttribute("hidden");
    else existing.setAttribute("hidden", "");
    button.setAttribute("aria-expanded", String(hidden));
    button.textContent = hidden
      ? `Hide ${button.dataset.replyCount} replies`
      : `Show ${button.dataset.replyCount} replies`;
    return;
  }
  button.dataset.loading = "1";
  button.disabled = true;
  try {
    const page = await api("/api/posts/" + postId + "/replies");
    // Children arrive with publicLevel 2, so createPostCard renders them without
    // further reply buttons (server forbids level-2 targets). The wrapper div
    // (grouping class + cascade treatment) is render.js's createSubReplyContainer.
    const container = createSubReplyContainer(postId, page.replies, document, state.currentUser);
    const article = main.querySelector(`article[data-post-id="${postId}"]`);
    if (article) article.after(container);
    button.dataset.replyCount = String(page.replies.length);
    button.setAttribute("aria-expanded", "true");
    if (page.replies.length) button.textContent = `Hide ${page.replies.length} replies`;
  } finally {
    delete button.dataset.loading;
    button.disabled = false;
  }
}

async function openNotification(button) {
  // Mark-first is idempotent server-side; navigation then re-renders the bell
  // with a fresh unread count from GET /api/session.
  await api("/api/me/notifications/" + button.dataset.notificationId + "/read", {
    method: "POST",
  });
  state.router.navigate("/posts/" + button.dataset.postId);
}

async function markAllNotificationsRead() {
  await api("/api/me/notifications/read-all", { method: "POST" });
  // The rerender refetches the list (and the session's unread count); the
  // local update keeps the header honest even if the route render is slowed.
  updateBell(0);
  await renderRoute({ name: "notifications" });
  setMessage("All notifications were marked read.");
}

async function submitRoleChange(form, action, text) {
  const reason = text("reason").trim();
  await api("/api/admin/users/" + form.dataset.userId + "/" + action, {
    method: "POST",
    body: reason ? { reason } : {},
  });
  // Role-change forms live on the moderation desk and on member profiles;
  // re-rendering the current route refreshes whichever surface is showing.
  await renderRoute(state.activeRoute);
  setMessage(action === "promote"
    ? "The member was promoted to mod."
    : "The member was demoted to member.");
}

async function submitAvatarModeration(form, action) {
  await api("/api/admin/avatars/" + form.dataset.userId + "/" + action, {
    method: "POST",
  });
  await renderRoute({ name: "admin" });
  setMessage(action === "approve" ? "The avatar was approved." : "The avatar was rejected.");
}

// Attachment rows are per-post ids, not replaceable profile pairs, and an
// unknown/stale id 404s (never "already handled") — same rerender-and-report
// flow as the avatar desk above.
async function submitAttachmentModeration(form, action) {
  await api("/api/admin/attachments/" + form.dataset.attachmentId + "/" + action, {
    method: "POST",
  });
  await renderRoute({ name: "admin" });
  setMessage(action === "approve" ? "The image was approved." : "The image was rejected.");
}

// Edit-form swap/restore (v2.4): the DOM cycle lives in render.js
// (openEditForm/closeEditForm), testable against the mock element suite.
// A second Edit click on an already-open form is a no-op (openEditForm refuses
// a duplicate), and Cancel restores the exact original body nodes — the patch
// itself only happens through the form's submit path.
function editTargetArticle(button) {
  return main.querySelector(`article[data-post-id="${button.dataset.postId}"]`);
}

// GIF picker functions (v2.5): open renders the approved library into the
// dialog grid; confirm folds the selection into the composer state; cancel
// closes. Selected thumbs carry aria-pressed so keyboard/AT state is real.
function openReportDialog(target) {
  const isButton = target instanceof HTMLButtonElement;
  const targetType = isButton ? "post" : target.type;
  const targetId = isButton ? target.dataset.postId : target.id;
  if (!["post", "profile"].includes(targetType) || !targetId) {
    throw new Error("That report target is no longer available.");
  }
  reportForm.dataset.targetType = targetType;
  reportForm.dataset.targetId = String(targetId);
  document.querySelector("#report-title").textContent =
    targetType === "profile" ? "Report this profile" : "Report this post";
  reportDialog.showModal();
  reportForm.querySelector("textarea").focus();
}

// Quote button (plan v2.3): prefill the CURRENT thread's reply composer. The
// composer is resolved with the same convention toggleReplyComposer's
// submitReplyForm path relies on — the root composer's form carries the thread
// id in data-post-id (its reply target), while an open reply-to-reply mini
// composer carries it in data-thread-id — so both spellings resolve the same
// thread composer on the detail route. On routes without a composer
// (home/search/profile) a Quote click is a silent no-op. The snippet lands
// through quotes.js's prefillQuote: textarea .value property assignment only,
// never HTML.
function quoteIntoComposer(button) {
  if (state.activeRoute.name !== "post") return;
  const rootId = String(state.activeRoute.id);
  const form =
    main.querySelector(`form[data-form="reply"][data-thread-id="${rootId}"]`) ??
    main.querySelector(`form[data-form="reply"][data-post-id="${rootId}"]`);
  if (!form) return;
  const textarea = form.querySelector("textarea");
  if (!textarea) return;
  prefillQuote(textarea, button.dataset.quoteUsername ?? "", button.dataset.quoteSnippet ?? "");
  // prefillQuote assigns .value programmatically, which fires no `input`
  // event — so the composer's live character counter (wired in forms.js to the
  // input event) would keep showing the stale pre-quote count. Dispatch the
  // event it listens for so the counter reflects the post-prefill value.
  // Over-limit prefills are NOT clamped here (clamping would silently eat the
  // user's draft). Note the actual protection: native tooLong validity only
  // covers values "last changed by a user edit" (WHATWG constraint
  // validation), so a programmatically assigned value past 1000 chars sails
  // through client validity checks and the server 400 is the only gate. The
  // stale counter above is display-only and independent of that limit.
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  form.scrollIntoView({ block: "nearest" });
}

// Click-to-expand attachments (micro-batch): the strip caps render size with
// CSS, but the stored bytes are full-size — the lightbox just swaps in the
// same versioned URL uncapped (capped only by the viewport in CSS). The
// native <dialog> supplies Escape and focus handling for free; a click
// anywhere on the dialog or its backdrop closes it (wired once at load).
function openAttachmentLightbox(button) {
  const stripImage = button.querySelector("img.post-attachment");
  if (!stripImage || !attachmentLightbox) return;
  const fullImage = attachmentLightbox.querySelector("img");
  if (!fullImage) return;
  fullImage.src = stripImage.src;
  attachmentLightbox.showModal();
}

async function loadMoreArchive(button) {
  // The accountability archive paginates on the raw row id (newest-first);
  // each page appends below the previous one like the feed routes.
  const older = await api("/api/archive?before=" + button.dataset.before);
  const rendered = await renderArchiveListFragment(older.archive);
  button.before(rendered);
  button.remove();
  if (!older.nextBefore) return;
  const next = element("button", "button button-secondary", "Load older archive");
  next.type = "button";
  next.dataset.action = "load-more-archive";
  next.dataset.before = String(older.nextBefore);
  main.append(next);
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

async function loadOlderReplies(button) {
  const postId = button.dataset.postId;
  const older = await api("/api/posts/" + postId + "/replies?before=" + button.dataset.before);
  const replyList = main.querySelector('.replies-list[data-replies-for="' + postId + '"]');
  if (!replyList) throw new Error("The reply list is no longer available. Reload the conversation.");
  const fragment = document.createDocumentFragment();
  for (const reply of older.replies) fragment.append(createPostCard(reply, document, state.currentUser));
  replyList.prepend(fragment);
  if (older.nextBefore) button.dataset.before = String(older.nextBefore);
  else button.remove();
}

async function handleButtonAction(button) {
  const handlers = {
    logout: async () => {
      await api("/api/auth/logout", { method: "POST" });
      setCsrfToken("");
      state.router.navigate("/");
      setMessage("You are signed out.");
    },
    reaction: () => submitReaction(button),
    report: () => openReportDialog(button),
    "close-report": () => reportDialog.close(),
    // Feed + composer actions live in routes/feed.js.
    ...feedActions,
    // Profile wall actions (v4.0).
    ...wallActions,
    // Suggestion status (v3.1): staff flip resolved/declined/open; the
    // route re-render refetches the payload so the chip and buttons come
    // back from the server, never from the echo.
    "suggestion-status": async () => {
      await api("/api/posts/" + button.dataset.postId + "/suggestion-status", {
        method: "POST",
        body: { status: button.dataset.status },
      });
      await renderRoute(state.activeRoute);
      setMessage(button.dataset.status === "open"
        ? "Suggestion reopened."
        : "Suggestion marked " + button.dataset.status + ".");
    },
    "load-more-archive": () => loadMoreArchive(button),
    "load-more-profile-posts": () => loadMoreProfilePosts(button),
    "load-older-replies": () => loadOlderReplies(button),
    "reply-to": () => toggleReplyComposer(button),
    "expand-sub-replies": () => toggleSubReplies(button),
    quote: () => quoteIntoComposer(button),
    "open-notification": () => openNotification(button),
    "chat-tab": () => setChatTab(button.dataset.chatTab),
    "dm-open-thread": () => openDmThread(button.dataset.threadId, button.dataset.otherUsername),
    "dm-back": () => backToDmList(),
    // The profile Message button find-or-creates the thread, then lands on
    // /chat where the pending thread opens.
    "dm-open": async () => {
      await openDmWith(button.dataset.username);
      state.router.navigate("/chat");
    },
    "chat-delete": () => deleteChatMessage(button),
    "dm-delete": () => deleteDmMessage(button),
    "toggle-bookmark": async () => {
      // Bookmarks (C4): both directions are idempotent server-side; the
      // route re-render refetches the payload's fresh state.
      const bookmarked = String(button.getAttribute("aria-pressed")) === "true";
      await api("/api/posts/" + button.dataset.postId + "/bookmark", {
        method: bookmarked ? "DELETE" : "PUT",
      });
      await renderRoute(state.activeRoute);
      setMessage(bookmarked ? "Removed from your saved posts." : "Saved.");
    },
    "toggle-subscribe": async () => {
      const subscribed = button.dataset.subscribed === "1";
      await api("/api/posts/" + button.dataset.postId + "/subscribe", {
        method: subscribed ? "DELETE" : "POST",
      });
      await renderRoute(state.activeRoute);
      setMessage(subscribed ? "You unsubscribed from this thread." : "You will get notifications for replies here.");
    },
    "mark-notifications-read": () => markAllNotificationsRead(),
    // Pinned (C5): the mod desk's pin/unpin — POST to the admin route and
    // re-render; the payload's pinnedAt decides which control each card shows.
    "vision-kill": async () => {
      // Auto-mod kill switch (v3.1): one click, effective on the next upload.
      await api("/api/admin/vision-kill-switch", { method: "POST", body: { tripped: true } });
      await renderRoute(state.activeRoute);
      setMessage("Auto-mod is STOPPED — new uploads will not be checked.");
    },
    "vision-resume": async () => {
      await api("/api/admin/vision-kill-switch", { method: "POST", body: { tripped: false } });
      await renderRoute(state.activeRoute);
      setMessage("Auto-mod resumed.");
    },
    // Text auto-mod kill switch (v3.1): OpenAI Moderation's emergency stop —
    // independent of the Vision switch.
    "text-mod-kill": async () => {
      await api("/api/admin/text-mod-kill-switch", { method: "POST", body: { tripped: true } });
      await renderRoute(state.activeRoute);
      setMessage("Text auto-mod is STOPPED — member text will not be checked.");
    },
    "text-mod-resume": async () => {
      await api("/api/admin/text-mod-kill-switch", { method: "POST", body: { tripped: false } });
      await renderRoute(state.activeRoute);
      setMessage("Text auto-mod resumed.");
    },
    "thread-pin": async () => {
      await api("/api/admin/threads/" + button.dataset.postId + "/pin", { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("Thread pinned.");
    },
    "thread-unpin": async () => {
      await api("/api/admin/threads/" + button.dataset.postId + "/unpin", { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("Thread unpinned.");
    },
    // Polls (C3): the vote PUT (one changeable vote per member) and the
    // re-render refetches the payload's fresh counts.
    "poll-vote": async () => {
      if (state.activeRoute.name !== "post") return;
      const postId = state.activeRoute.id;
      await api("/api/posts/" + postId + "/poll", {
        method: "PUT",
        body: { optionId: Number(button.dataset.optionId) },
      });
      await renderRoute(state.activeRoute);
    },
    "gif-approve": async () => {
      await api("/api/admin/gifs/" + encodeURIComponent(button.dataset.gifId) + "/approve", { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("GIF approved and added to the public library.");
    },
    "gif-reject": async () => {
      await api("/api/admin/gifs/" + encodeURIComponent(button.dataset.gifId) + "/reject", { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("GIF submission rejected.");
    },
    "expand-attachment": () => openAttachmentLightbox(button),
    "edit-post": () => {
      const article = editTargetArticle(button);
      if (article) openEditForm(article, document);
    },
    "cancel-edit": () => {
      const article = editTargetArticle(button);
      if (article) closeEditForm(article);
    },
    "delete-post": () => openDeletePostDialog(button),
    "delete-account": () => openDeleteAccountDialog(),
    "save-forum-rules": async () => {
      const input = document.querySelector("#rules-input");
      if (!input) return;
      await api("/api/rules", { method: "POST", body: input.value });
      state.router.navigate("/rules");
      setMessage("Rules saved.");
    },
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
      await renderRoute({ name: "profile", username: state.currentUser.username });
      setMessage("Custom CSS removed.");
    },
    "report-profile": () => openReportDialog({ type: "profile", id: button.dataset.profileId }),
    "resolve-profile-report": async (button) => {
      await api("/api/admin/profile-reports/" + encodeURIComponent(button.dataset.reportId) + "/resolve", { method: "POST" });
      button.closest(".report-queue-item")?.remove();
      setMessage("Report resolved.");
    },
    "css-approve": async (button) => {
      const version = encodeURIComponent(button.dataset.version || "");
      await api("/api/admin/css/" + encodeURIComponent(button.dataset.userId) + "/approve?version=" + version, { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("CSS approved.");
    },
    "css-reject": async (button) => {
      const version = encodeURIComponent(button.dataset.version || "");
      await api("/api/admin/css/" + encodeURIComponent(button.dataset.userId) + "/reject?version=" + version, { method: "POST" });
      await renderRoute(state.activeRoute);
      setMessage("CSS rejected.");
    },
    "set-profile-accent": async () => {
      // Profile colors (any hex, v3.0.2): the swatch's data-accent is the
      // preset's hex ("" = clear). The server re-validates the hex; success
      // re-renders the route.
      await api("/api/me", { method: "PATCH", body: { profileAccent: button.dataset.accent || "" } });
      await renderRoute(state.activeRoute);
    },
    "edit-history": async () => {
      // Toggle: an open panel for this card closes; otherwise the past
      // versions fetch and expand under the body. History is public — no
      // auth needed beyond the same-origin GET.
      const article = editTargetArticle(button);
      if (!article) return;
      const existing = article.querySelector(":scope > .edit-history-panel");
      if (existing) {
        existing.remove();
        return;
      }
      const data = await api(`/api/posts/${encodeURIComponent(button.dataset.postId)}/edits`);
      article.append(renderEditHistoryPanel(document, data.edits));
    },
    "confirm-ok": async () => {
      if (!getConfirmHandler()) return;
      const handler = getConfirmHandler();
      // Disabled while pending: a double confirm can't fire the destructive
      // request twice while it is in flight. A REQUEST FAILURE keeps the
      // handler armed (the dialog stays open, the error bar carries the
      // message) so the user can retry the same confirm without closing the
      // dialog first; success clears it via the handler itself.
      confirmOk.disabled = true;
      try {
        await handler();
        clearConfirmHandler();
      } finally {
        confirmOk.disabled = false;
      }
    },
    "confirm-cancel": () => {
      clearConfirmHandler();
      confirmDialog.close();
    },
  };
  const handler = handlers[button.dataset.action];
  // Pass the button: handlers written as (button) => {} MUST get it — calling
  // them bare crashes with "reading 'dataset' of undefined" (the live
  // resolve-profile-report/css-desk breakage).
  if (handler) await handler(button);
}

async function handleClick(event) {
  if (handleInternalNavigation(event)) return;
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  try {
    await handleButtonAction(button);
  } catch (error) {
    setMessage(error.message, true);
  }
}
document.addEventListener("click", handleClick);
// The attachment lightbox closes on any click inside it (image included) or on
// its backdrop; Escape is native to <dialog>.
attachmentLightbox?.addEventListener("click", () => attachmentLightbox.close());
// Composer file inputs: folder/picker selections are folded into the form's
// chosen list at change time (cap + size messages surface on the status bar).
document.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.dataset.composerInput === "images") {
    handleComposerFileSelection(input);
  } else if (input.dataset.composerInput === "gif-marketplace") {
    uploadCommunityGif(input).catch((error) => setMessage(error.message, true));
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  try {
    await submitForm(form);
  } catch (error) {
    setMessage(error.message, true);
  }
});

// Theme storage may be unavailable in private/restricted contexts. That should
// never prevent the application state.router from running or leave the HTML shell
// stuck at its initial placeholder.
async function fillVersionTag() {
  const info = await api("/api/version");
  const version = typeof info?.version === "string" ? info.version.split(".") : [];
  const shortVersion = version.length > 1 ? `v${version[0]}.${version[1]}` : "";
  const commit = typeof info?.commit === "string" ? info.commit : "";
  document.querySelector("#version-tag").textContent =
    [shortVersion, commit].filter(Boolean).join(" · ");
}

try {
  let storage;
  try { storage = window.localStorage; }
  catch { storage = { getItem: () => null, setItem: () => {} }; }
  initTheme(document, storage);
  applyCornerPreference(document, storage);
  // Live chat (v3.1): the poll loop starts at boot so the header's online
  // counter is fresh even before the panel is ever opened.
  initChat();
  fillVersionTag().catch(() => {});
  state.router = startRouter((route) => {
    renderRoute(route).catch((error) => {
      setMessage(error.message, true);
      main.replaceChildren();
      addHeading(main, "Something went wrong:(", 1);
      addText(document, main, "p", error.message, "error-copy");
    });
  });
} catch (error) {
  console.error("Forum startup failed:", error);
  main.replaceChildren();
  addHeading(main, "The forum could not start:(", 1);
  addText(document, main, "p",
    "A startup error interrupted the forum! Refresh after the site is updated.",
    "error-copy");
}
