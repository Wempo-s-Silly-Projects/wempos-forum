// v4.0 plan 4 Task 3: the feed concern — home/search/mine/category/bookmarks
// routes, the feed tabs, the composer family (builder, attachment row, file+
// gif strips, idempotency keys, create/reply submits), the composer dialogs
// (gallery picker, polls), and the feed's pagination. Bodies moved verbatim
// out of app.js; the renderRoute and bare renderRoute calls inside moved
// bodies re-read the boot state through the bag (state.renderRoute). The
// header chrome (renderAccountNavigation) stays in app.js per the spec's boot
// description; toggleReplyComposer keeps importing createComposer from here.
import { addText, createForm, createInput, createSelect, createTextarea } from "../forms.js";
import { api } from "../api.js";
import {
  addHeading,
  addSubmit,
  createPanel,
  element,
  main,
  setMessage,
} from "../dom.js";
import { state } from "../state.js";
import { renderHomeAccess } from "./auth.js";
import {
  COMPOSER_ACCEPT,
  MAX_COMPOSER_FILES,
  addComposerFiles,
  buildComposerBody,
} from "../attachments.js";
import { appendPostList } from "../render.js";
import { BOARDS, BOARD_BY_SLUG, composerBoardChoices } from "../boards.js";
import { addGifsToComposer, removeGifFromComposer, renderGifThumbs, spareComposerSlots } from "../gifs.js";
import { addTurnstileSlot, refreshTurnstile, takeTurnstileToken } from "../turnstile.js";
import { COMPOSER_MAX_CHARS } from "../composer-limits.js";
import { homepageInterests, homepageIntro } from "../home-intro.js";

let activeGifComposerForm = null;
let activePollComposerForm = null;
// Suggestions board (v2.4.1): the /suggestions route reuses the feed UI, so
// its composer tags root posts with board=suggestions (form dataset flag read
// by submitNewPost) and its empty state speaks the board's copy.
const SUGGESTIONS_BOARD = "suggestions";
const SUGGESTIONS_EMPTY_TEXT = "No suggestions yet — be the first!";

// Every composer is Turnstile-gated now: root posts use action "post", every
// reply composer (the detail-route root reply and reply-to-reply mini
// composers) uses action "reply". board (v2.4.1): a category composer carries
// its board value on the form's dataset; submitNewPost reads the dataset flag
// so the payload picks the board up in the same wire format the rest of the
// body uses. boardChoices (categories v3.1): the home composer renders a
// category <select> instead — submitNewPost reads its value the same way.
function createComposer(name, label, buttonLabel, postID = null,
  turnstileAction = null, board = null, boardChoices = null) {
  const panel = createPanel(board === "suggestions"
    ? "Share a suggestion"
    : name === "post-create" ? "Start a conversation" : "Reply");
  const form = document.createElement("form");
  form.dataset.form = name;
  if (postID !== null) form.dataset.postId = String(postID);
  if (board) form.dataset.board = board;
  if (boardChoices) {
    form.append(createSelect(document, {
      id: `${name}-${postID ?? "new"}-board`, name: "board",
      label: "Category",
      options: boardChoices,
    }));
  }
  // The reply-to-reply mini composer shares the "reply" form name with the
  // detail route's root composer, so the textarea id carries the target id to
  // keep label/for pairs unique in the document.
  form.append(createTextarea(document, {
    id: `${name}-${postID ?? "new"}-body`, name: "body", label,
    rows: 4, maxLength: COMPOSER_MAX_CHARS, required: true, counter: true,
  }));
  form.append(createComposerAttachmentRow(name === "post-create"));
  addTurnstileSlot(form, turnstileAction ?? (name === "post-create" ? "post" : "reply"));
  addSubmit(form, buttonLabel);
  panel.append(form);
  return panel;
}

// Image attachments on every composer (plan Task 7): a paperclip-style button
// driving a hidden multi-file input, plus a strip of chosen files rendered by
// renderComposerFileStrip. The chosen File objects never enter the DOM — they
// ride on a plain `composerFiles` property of the form, which readForm's
// FormData knows nothing about; submit handlers fold them into the payload.
// Uploads land in the moderation-pending state, so the note mirrors the
// avatar uploader's review-first wording.
function createComposerAttachmentRow(withPollButton = false) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = COMPOSER_ACCEPT;
  input.multiple = true;
  input.hidden = true;
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  input.dataset.composerInput = "images";
  const attach = element("button", "button button-quiet", "📎 Attach images");
  attach.type = "button";
  attach.dataset.action = "composer-attach";
  // GIF picker (v2.5): the library dialog — approved community GIFs attach
  // by reference (no re-upload bytes; the marketplace's dedup covers them).
  const gifButton = element("button", "button button-quiet", "Gallery");
  gifButton.type = "button";
  gifButton.dataset.action = "open-gif-picker";
  // Polls (C3): the Poll button — root composers only. The dialog stashes a
  // { question, options } draft on the form (composerPoll) and the create
  // submit posts it to /api/posts/:id/poll once the thread exists.
  const pollBits = [];
  if (withPollButton) {
    const pollButton = element("button", "button button-quiet", "📊 Poll");
    pollButton.type = "button";
    pollButton.dataset.action = "open-poll-dialog";
    pollBits.push(pollButton);
  }
  const gifStrip = element("div", "composer-files");
  gifStrip.dataset.composerStrip = "gifs";
  gifStrip.hidden = true;
  const description = element("span", "form-note");
  description.textContent =
    `Images are reviewed before they show publicly. Up to ${MAX_COMPOSER_FILES}, ` +
    "10 MiB or less each (JPEG, PNG, WebP, or GIF).";
  const strip = element("div", "composer-files");
  strip.dataset.composerStrip = "images";
  strip.hidden = true;
  const row = element("div", "composer-attach-row");
  row.append(attach, gifButton, ...pollBits, description, strip, gifStrip, input);
  return row;
}

function renderComposerFileStrip(form) {
  const strip = form.querySelector('[data-composer-strip]');
  if (!strip) return;
  const files = form.composerFiles ?? [];
  strip.replaceChildren();
  strip.hidden = files.length === 0;
  renderComposerGifStrip(form);
  for (const [index, file] of files.entries()) {
    const chip = element("span", "composer-file", file.name);
    const remove = element("button", "button button-quiet composer-file-remove", "Remove");
    remove.type = "button";
    remove.dataset.action = "remove-composer-file";
    remove.dataset.fileIndex = String(index);
    chip.append(remove);
    strip.append(chip);
  }
}

function renderComposerGifStrip(form) {
  const gifStrip = form.querySelector('[data-composer-strip="gifs"]');
  if (!gifStrip) return;
  const gifs = form.composerGifs ?? [];
  gifStrip.replaceChildren(...renderGifThumbs(document, form).children);
  gifStrip.hidden = gifs.length === 0;
}

function handleComposerFileSelection(input) {
  const form = input.closest("form");
  if (!form) return;
  const { files, notices } = addComposerFiles(form.composerFiles ?? [], input.files);
  form.composerFiles = files;
  renderComposerFileStrip(form);
  if (notices.length) setMessage(notices.join(" "), true);
  // Reset so re-picking the same file fires another change event.
  input.value = "";
}
function renderIntroduction() {
  const intro = element("section", "personal-intro");
  addHeading(intro, "Wempo's Forum: Have fun and meet new people!", 1);
  addText(document, intro, "p", homepageIntro, "personal-intro-copy");
  const interests = element("ul", "personal-tags");
  for (const interest of homepageInterests) interests.append(element("li", "", interest));
  intro.append(interests);
  const doodle = element("span", "intro-doodle", ":3");
  doodle.setAttribute("aria-hidden", "true");
  intro.append(doodle);
  main.append(intro);
}

function renderHomeContent(session, data, route) {
  if (session.user && route.name === "home") {
    // My posts (v2.5): a tab pair right above the composer (owner spec — NOT
    // a top-bar item, and home only: the search route shares this builder but
    // gets no tabs, per the review). Real routes so tabs are anchors —
    // internal navigation, shareable URLs, working back button. Categories
    // (v3.1) widened the pair: Recent activity, My posts, and every category.
    main.append(renderFeedTabs("all"));
    // The home composer picks its category from a select (members post in
    // every category; the staff-only Updates category appears for staff
    // alone — the server 403s everyone else regardless).
    main.append(createComposer("post-create", "What's on your mind?", "Post message",
      null, null, null, composerBoardChoices(session.user)));
  }
  // Recent activity (v3.1): the homepage mixes every category, 10 posts at a
  // time (the server's no-board feed page size).
  addHeading(main, route.name === "search" ? "Search results" : "Recent activity", 2);
  if (route.name === "search") {
    addText(document, main, "p", `Results for “${route.query}”`, "muted");
    renderSearchResults(main, data.search);
    return;
  }
  appendPostList(main, data.feed.posts, document, session.user);
  if (!data.feed.nextBefore) return;
  const older = element("button", "button button-secondary", "Load older posts");
  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);
  main.append(older);
}
function renderAccountSettings() {
  const account = document.createElement("details");
  account.className = "panel";
  // Appearance: the square-corners pref (v2.5) - a checkbox in the account
  // settings panel; stored client-side like the theme choice.
  const corners = document.createElement("label");
  corners.className = "corner-pref";
  const cornersBox = document.createElement("input");
  cornersBox.type = "checkbox";
  try { cornersBox.checked = window.localStorage.getItem("forum-corners") === "square"; } catch {}
  cornersBox.dataset.actionPref = "corners";
  corners.append(cornersBox, document.createTextNode(" Square corners"));
  cornersBox.addEventListener("change", () => {
    const square = cornersBox.checked;
    try { window.localStorage.setItem("forum-corners", square ? "square" : "round"); } catch {}
    document.documentElement.dataset.corners = square ? "square" : "round";
  });

  const passwordPanel = createPanel("Change your password", "There is no email-based recovery; choose a password you can keep safe.");
  passwordPanel.append(createForm(document, "password", [
    createInput(document, {
      id: "current-password", name: "currentPassword", label: "Current password",
      type: "password", autoComplete: "current-password", required: true, minLength: 12, maxLength: 128,
    }),
    createInput(document, {
      id: "new-password", name: "newPassword", label: "New password",
      type: "password", autoComplete: "new-password", required: true, minLength: 12, maxLength: 128,
    }),
  ], "Update password"));
  account.append(passwordPanel);
  // Delete account control (v2.4.1 feature): lives in the signed-in account
  // settings area only (this renderer never runs for guests), confirming
  // through the shared confirm dialog whose copy spells out the blast radius —
  // including other people's replies inside the account's own threads — before
  // anything is sent. The confirm button is disabled while the request is
  // pending (see the confirm-ok handler).
  const deletePanel = createPanel("Delete your account",
    "This permanently deletes your account and everything it owns: your posts — and every thread you started, including other people's replies inside those threads — plus your replies — and any sub-replies hanging off your replies in other members' threads go too — reactions, reports, notifications, and profile. There is no undo. Are you really sure?");
  const deleteButton = element("button", "button button-danger", "Delete account");
  deleteButton.type = "button";
  deleteButton.dataset.action = "delete-account";
  deletePanel.append(deleteButton);
  account.append(deletePanel);
  main.append(account);
}

function renderHome(session, setupRequired, setupConfigured, data, route) {
  renderIntroduction();
  renderHomeAccess(session, setupRequired, setupConfigured);
  renderHomeContent(session, data, route);
  if (session.user) renderAccountSettings();
}
function renderSearchResults(container, results) {
  // Deep reply results (v2.5): a Replies section under the Posts one.
  if (Array.isArray(results.replies)) {
    addHeading(container, "Replies", 2);
    if (!results.replies.length) {
      addText(document, container, "p", "It's pretty empty here....", "There is no replies that match!", "empty-state");
    } else {
      const replyList = element("div", "reply-search-results");
      for (const reply of results.replies) {
        const miniCard = element("article", "reply-search-card");
        miniCard.append(element("a", "reply-search-thread",
          "in a conversation by " + (reply.parent ? "…" : "someone")));
        const bodyBlock = element("p", "reply-search-body");
        bodyBlock.textContent = reply.body;
        const link = element("a", "button button-quiet", "Open thread");
        link.href = "/posts/" + reply.threadId;
        link.setAttribute("data-app-link", "");
        miniCard.append(bodyBlock, link);
        replyList.append(miniCard);
      }
      container.append(replyList);
    }
  }
  const people = createPanel("People");
  if (results.users.length) {
    const list = element("ul", "result-list");
    for (const user of results.users) {
      const item = element("li");
      const link = element("a", "", user.username);
      link.href = `/users/${encodeURIComponent(user.username)}`;
      item.append(link);
      if (user.bio) addText(document, item, "p", user.bio, "muted");
      list.append(item);
    }
    people.append(list);
  } else {
    addText(document, people, "p", "It's pretty empty here", "There are no users that match!", "empty-state");
  }
  container.append(people);
  addHeading(container, "Posts", 2);
  appendPostList(container, results.posts, document, state.currentUser);
}
async function renderHomeRoute(route, context, version) {
  const data = route.name === "search"
    ? { search: await api(`/api/search?q=${encodeURIComponent(route.query)}&in=replies`) }
    : { feed: await api("/api/posts") };
  if (version !== state.renderVersion) return;
  renderHome(context.session, context.setupRequired, context.setupConfigured, data, route);
}

// Suggestions board route (v2.4.1): the existing feed UI, pointed at
// /api/posts?board=suggestions — same post cards, same decorators, same
// pagination pattern, with the board's composer flag and empty-state copy.
// The general feed route is untouched; the server treats a missing board as
// 'general', so Home never changes shape.
// My posts (v2.5): the tab pair above the composer — anchors styled as tabs;
// the active tab is aria-selected (the owner's "right above the start a
// conversation box" placement, not a top-bar item).
function renderFeedTabs(active) {
  const tabs = element("div", "feed-tabs");
  // Categories (v3.1, tab style): the tab pair above the composer is the
  // category navigation — Recent activity (every category mixed, 10 at a
  // time), My posts, then each category as its own route. `active` is the
  // category slug on category pages ("all" home, "mine" on /mine); a slug
  // match highlights that category's tab.
  const spec = [
    ["/", "Recent activity", active === "all"],
    ["/mine", "My posts", active === "mine"],
    ...BOARDS.map((board) => ["/c/" + board.slug, board.label, active === board.slug]),
  ];
  for (const [href, label, isActive] of spec) {
    const tab = element("a", "feed-tab", label);
    tab.href = href;
    tab.setAttribute("data-app-link", "");
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tabs.append(tab);
  }
  return tabs;
}
async function renderMineRoute(context, version) {
  if (!context.session.user) {
    // A hand-typed /mine URL while signed out: a sign-in prompt, not an error.
    addHeading(main, "My posts", 2);
    addText(document, main, "p", "Sign in to see your posts.", "muted");
    const signIn = element("a", "button button-secondary", "Sign in");
    signIn.href = "/#join";
    signIn.setAttribute("data-app-link", "");
    main.append(signIn);
    return;
  }
  const data = { feed: await api("/api/posts?mine=1") };
  if (version !== state.renderVersion) return;
  main.append(renderFeedTabs("mine"));
  main.append(createComposer("post-create", "What's on your mind?", "Post message"));
  addHeading(main, "My posts", 2);
  appendPostList(main, data.feed.posts, document, context.session.user);
  if (!data.feed.nextBefore || data.feed.posts.length !== 20) return;
  const older = element("button", "button button-secondary", "Load older posts");
  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);
  older.dataset.mine = "1";
  main.append(older);
}
// Category routes (v3.1, tab style): /c/<slug> (plus the /suggestions alias).
// One renderer for every category — the tab pair with this category active, a
// composer locked to the category (signed-in only, and staff-only on
// Updates), and the board's feed. Suggestions keeps its score sort
// server-side and carries the resolved/declined chips + staff status
// controls through the post payloads.
async function renderCategoryRoute(route, context, version) {
  const board = BOARD_BY_SLUG[route.board];
  // api() returns the parsed body UNWRAPPED ({posts, nextBefore}), so the
  // route wraps it in the exact { feed: ... } shape renderHomeRoute builds —
  // the feed routes stay structurally identical, and the shared
  // data.feed.* reads below are correct.
  const data = { feed: await api("/api/posts?board=" + encodeURIComponent(board.slug)) };
  if (version !== state.renderVersion) return;
  main.append(renderFeedTabs(board.slug));
  const user = context.session.user;
  const isStaff = Boolean(user && (user.role === "owner" || user.role === "admin"));
  if (user && (!board.staffOnly || isStaff)) {
    main.append(createComposer(
      "post-create",
      board.staffOnly ? "Post a site update" : `Start a thread in ${board.label}`,
      board.staffOnly ? "Post update" : "Post message",
      null, null, board.slug,
    ));
  }
  addHeading(main, board.label, 2);
  addText(document, main, "p", board.blurb, "muted");
  appendPostList(main, data.feed.posts, document, user,
    board.slug === SUGGESTIONS_BOARD
      ? SUGGESTIONS_EMPTY_TEXT
      : `Nothing in ${board.label} yet — start the conversation!`);
  if (!data.feed.nextBefore) return;
  const older = element("button", "button button-secondary", "Load older posts");
  older.type = "button";
  older.dataset.action = "load-more";
  older.dataset.before = String(data.feed.nextBefore);
  older.dataset.board = board.slug;
  main.append(older);
}

// Bookmarks (C4): the private "Saved" page — the member's own saved list.
// Guests get a sign-in prompt (the API 401s the private list regardless).
const BOOKMARKS_EMPTY_TEXT = "Nothing saved yet. Use the Save button on a post.";
async function renderBookmarksRoute(context, version) {
  if (!context.session.user) {
    addHeading(main, "Saved posts", 2);
    addText(document, main, "p", "Sign in to see your saved posts.", "muted");
    const signIn = element("a", "button button-secondary", "Sign in");
    signIn.href = "/#join";
    signIn.setAttribute("data-app-link", "");
    main.append(signIn);
    return;
  }
  const data = await api("/api/me/bookmarks");
  if (version !== state.renderVersion) return;
  addHeading(main, "Saved posts", 2);
  // Privacy note: this list belongs to the signed-in account.
  addText(document, main, "p", "Your saved list is private to you.", "muted");
  appendPostList(main, data.bookmarks, document, context.session.user,
    BOOKMARKS_EMPTY_TEXT);
  // Pagination (fix round 1): the composite (bookmarked_at, id) cursor.
  if (!data.nextBefore || data.bookmarks.length !== 20) return;
  const older = element("button", "button button-secondary", "Load older saved posts");
  older.type = "button";
  older.dataset.action = "load-more-bookmarks";
  older.dataset.before = String(data.nextBefore);
  main.append(older);
}
function composerSubmissionSignature({ body, files = [], gifs = [], board = null, targetId = null }) {
  return JSON.stringify({
    body,
    board: board || null,
    targetId,
    files: files.map((file) => [file.name, file.size, file.type, file.lastModified]),
    gifs: gifs.map((gif) => String(gif?.id ?? gif?.gifId ?? gif)),
  });
}

function composerIdempotencyKey(form, signature) {
  // Keep a key only while the draft is unchanged. Ambiguous/network failures
  // retry with the same key; editing the draft starts a distinct submission.
  if (!form.dataset.idempotencyKey || form.dataset.idempotencySignature !== signature) {
    form.dataset.idempotencyKey = crypto.randomUUID();
    form.dataset.idempotencySignature = signature;
  }
  return form.dataset.idempotencyKey;
}

function clearComposerKeyForChangedSubmission(form, error) {
  if (error.status === 410 ||
      (error.status === 409 && /Idempotency-Key was already used for a different submission/i.test(error.message))) {
    delete form.dataset.idempotencyKey;
    delete form.dataset.idempotencySignature;
  }
  throw error;
}

async function submitNewPost(form, text) {
  const body = text("body");
  const files = form.composerFiles ?? [];
  const gifs = form.composerGifs ?? [];
  // Categories (v3.1): a dataset board (category composers lock the choice);
  // otherwise the home composer's board <select> — text("board") is "" when
  // the form carries no select at all, so the wire payload stays unchanged.
  const board = form.dataset.board ?? (text("board") || null);
  const signature = composerSubmissionSignature({ body, files, gifs, board });
  const idempotencyKey = composerIdempotencyKey(form, signature);
  // buildComposerBody picks the wire format: FormData (repeatable "images"
  // parts) when files were chosen, otherwise the exact pre-attachment JSON
  // payload. api() passes FormData straight through without a Content-Type.
  // The Suggestions composer's form dataset carries board=suggestions, riding
  // the body in whichever format wins; the home composer has no dataset flag,
  // keeping its payload exactly as before.
  const submission = buildComposerBody({
    body,
    turnstileToken: takeTurnstileToken(form),
    files,
    gifs,
    board,
  });
  refreshTurnstile(form);
  let post;
  try {
    post = await api("/api/posts", { method: "POST", body: submission.body, idempotencyKey });
  } catch (error) {
    clearComposerKeyForChangedSubmission(form, error);
  }
  delete form.dataset.idempotencyKey;
  delete form.dataset.idempotencySignature;
  // Polls (C3): a stashed poll attaches to the fresh thread BEFORE the
  // navigation; a failed attach never loses the (already live) post.
  let pollNote = "";
  if (form.composerPoll) {
    try {
      await api("/api/posts/" + post.id + "/poll", {
        method: "POST",
        body: form.composerPoll,
      });
    } catch (error) {
      pollNote = " (the poll could not be attached)";
    }
  }
  state.router.navigate("/posts/" + post.id);
  setMessage("Your post is live!" + pollNote);
}

async function submitReplyForm(form, text) {
  const postId = Number(form.dataset.postId);
  const threadId = form.dataset.threadId ?? postId;
  const body = text("body");
  const files = form.composerFiles ?? [];
  const gifs = form.composerGifs ?? [];
  const signature = composerSubmissionSignature({ body, files, gifs, targetId: postId });
  const idempotencyKey = composerIdempotencyKey(form, signature);
  // Same dual wire format as posts; replies are Turnstile-gated server-side
  // with action "reply".
  const submission = buildComposerBody({
    body,
    turnstileToken: takeTurnstileToken(form),
    files,
    gifs,
  });
  refreshTurnstile(form);
  try {
    await api("/api/posts/" + postId + "/replies", {
      method: "POST",
      body: submission.body,
      idempotencyKey,
    });
  } catch (error) {
    clearComposerKeyForChangedSubmission(form, error);
  }
  delete form.dataset.idempotencyKey;
  delete form.dataset.idempotencySignature;
  // Reply-to-reply composers remember the thread root (declared above) so the
  // rerender lands back on the conversation, not on the level-1 reply's page.
  await state.renderRoute({ name: "post", id: Number(threadId) });
  setMessage("Your reply was added!");
}
const gifPickerActiveForm = () => null;
function gifPickerDialog() {
  return document.querySelector("#gif-picker");
}
async function openGifPicker(button) {
  const form = button.closest("form");
  if (!form) return;
  const dialog = gifPickerDialog();
  if (!dialog) return;
  activeGifComposerForm = form;
  const grid = dialog.querySelector("#gif-grid");
  const data = await api("/api/gifs");
  grid.replaceChildren();
  const spare = spareComposerSlots(form);
  for (const gif of data.gifs) {
    const thumb = element("button", "gif-grid-item");
    thumb.type = "button";
    thumb.dataset.gifId = gif.id;
    thumb.setAttribute("role", "option");
    thumb.setAttribute("aria-pressed", "false");
    thumb.title = "Use this image";
    const img = element("img");
    img.src = gif.url;
    img.loading = "lazy";
    img.alt = "Library image";
    thumb.append(img);
    thumb.addEventListener("click", () => {
      const pressed = thumb.getAttribute("aria-pressed") === "true";
      const selectedCount = [...grid.children].filter((node) => node.getAttribute("aria-pressed") === "true");
      if (!pressed && selectedCount.length >= spare) {
        setMessage("That would exceed your " + MAX_COMPOSER_FILES + " attachment slots.", true);
        return;
      }
      thumb.setAttribute("aria-pressed", pressed ? "false" : "true");
    });
    grid.append(thumb);
  }
  dialog.showModal();
}
function confirmGifPicker(button) {
  const dialog = gifPickerDialog();
  if (!dialog) return;
  const form = connectedComposer(activeGifComposerForm);
  activeGifComposerForm = null;
  const grid = dialog.querySelector("#gif-grid");
  const selected = [...grid.children].filter((node) => node.getAttribute("aria-pressed") === "true").map((node) => node.dataset.gifId);
  dialog.close();
  if (!form || selected.length === 0) return;
  const { added } = addGifsToComposer(form, selected);
  if (added.length < selected.length) {
    setMessage("Only " + added.length + " image(s) fit your attachment slots.", true);
  }
  renderComposerGifStrip(form);
}
async function uploadCommunityGif(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const upload = new FormData();
    upload.append("gif", file, file.name);
    const result = await api("/api/gifs", { method: "POST", body: upload });
    const form = connectedComposer(activeGifComposerForm);
    if (result.reuse && form) {
      const { added } = addGifsToComposer(form, [result.id]);
      renderComposerGifStrip(form);
      if (added.length) {
        gifPickerDialog()?.close();
        activeGifComposerForm = null;
        setMessage("That image is already approved and has been attached.");
      } else {
        setMessage("That image is approved, but this composer has no free attachment slots.", true);
      }
    } else {
      setMessage(result.reuse
        ? "That image is already in the approved library!"
        : "Upload submitted for mod review.");
    }
  } finally {
    input.value = "";
  }
}

function connectedComposer(form) {
  return form && form.isConnected ? form : null;
}

// Poll dialog (C3): open stashes the calling composer; confirm reads the
// question + up to 4 options (blank slots skipped) and rides the draft on the
// form as composerPoll until the post's create submit lands the poll.
const pollDialog = () => document.querySelector("#poll-dialog");

function openPollDialog(button) {
  const form = button.closest("form");
  const dialog = pollDialog();
  if (!form || !dialog) return;
  activePollComposerForm = form;
  dialog.showModal();
}

function confirmPollDialog() {
  const dialog = pollDialog();
  const form = connectedComposer(activePollComposerForm);
  if (!form || !dialog) {
    activePollComposerForm = null;
    if (dialog) dialog.close();
    setMessage("That composer is no longer on the page. Open the poll tool again.", true);
    return;
  }
  const question = dialog.querySelector("#poll-question").value.trim();
  const options = [1, 2, 3, 4]
    .map((slot) => dialog.querySelector("#poll-option-" + slot)?.value.trim() ?? "")
    .filter(Boolean);
  if (!question || options.length < 2 || options.length > 4) {
    setMessage("Give the poll a question and 2 to 4 options.", true);
    return;
  }
  form.composerPoll = { question, options };
  activePollComposerForm = null;
  dialog.querySelector("form").reset();
  dialog.close();
  setMessage("Poll attached — it posts with your message!");
}

function attachComposerImages(button) {
  // The paperclip button lives inside the composer's form, so `.closest("form")`
  // always resolves the right composer even with several on one page.
  const form = button.closest("form");
  const input = form?.querySelector('[data-composer-input]');
  if (input) input.click();
}

function removeComposerFile(button) {
  const form = button.closest("form");
  if (!form) return;
  const files = form.composerFiles ?? [];
  const index = Number(button.dataset.fileIndex);
  if (Number.isInteger(index) && index >= 0 && index < files.length) {
    files.splice(index, 1);
  }
  form.composerFiles = files;
  renderComposerFileStrip(form);
}
async function loadMorePosts(button) {
  // Board-aware (v2.4.1): the suggestions route's button carries dataset.board
  // and adds the board param; the home button keeps the original URL shape.
  // The emitted cursor is board-native (score_id for suggestions), so pages
  // keep walking the same keyset they started on.
  const board = button.dataset.board;
  const mine = button.dataset.mine;
  const older = await api("/api/posts?before=" + button.dataset.before +
    (board ? "&board=" + board : "") + (mine ? "&mine=" + mine : ""));
  appendPostList(main, older.posts, document, state.currentUser,
    board === SUGGESTIONS_BOARD ? SUGGESTIONS_EMPTY_TEXT : undefined);
  button.remove();
  if (older.posts.length !== 20 || !older.nextBefore) return;
  const next = element("button", "button button-secondary",
    board === SUGGESTIONS_BOARD ? "Load older suggestions" : "Load older posts");
  next.type = "button";
  next.dataset.action = "load-more";
  next.dataset.before = String(older.nextBefore);
  if (board) next.dataset.board = board;
  if (mine) next.dataset.mine = mine;
  main.append(next);
}

// The registration seam: FORM_HANDLERS merges into submitForm's dispatch map;
// ACTIONS merges into handleButtonAction's dispatch map; the renderer functions
// ride renderRoute's table by name.
export const FORM_HANDLERS = {
  "post-create": (form, text) => submitNewPost(form, text),
  reply: (form, text) => submitReplyForm(form, text),
};

// Task 9: the card actions that ride every feed surface (reactions, the
// bookmark/subscribe toggles, suggestion status) moved here from app.js —
// the route re-render refetches fresh state, never trusting the echo.
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
  await state.renderRoute(state.activeRoute);
}

export const ACTIONS = {
  "load-more": (button) => loadMorePosts(button),
  reaction: (button) => submitReaction(button),
  "toggle-bookmark": async (button) => {
    // Bookmarks (C4): both directions are idempotent server-side; the
    // route re-render refetches the payload's fresh state.
    const bookmarked = String(button.getAttribute("aria-pressed")) === "true";
    await api("/api/posts/" + button.dataset.postId + "/bookmark", {
      method: bookmarked ? "DELETE" : "PUT",
    });
    await state.renderRoute(state.activeRoute);
    setMessage(bookmarked ? "Removed from your saved posts." : "Saved.");
  },
  "toggle-subscribe": async (button) => {
    const subscribed = button.dataset.subscribed === "1";
    await api("/api/posts/" + button.dataset.postId + "/subscribe", {
      method: subscribed ? "DELETE" : "POST",
    });
    await state.renderRoute(state.activeRoute);
    setMessage(subscribed ? "You unsubscribed from this thread." : "You will get notifications for replies here.");
  },
  // Suggestion status (v3.1): staff flip resolved/declined/open; the
  // route re-render refetches the payload so the chip and buttons come
  // back from the server, never from the echo.
  "suggestion-status": async (button) => {
    await api("/api/posts/" + button.dataset.postId + "/suggestion-status", {
      method: "POST",
      body: { status: button.dataset.status },
    });
    await state.renderRoute(state.activeRoute);
    setMessage(button.dataset.status === "open"
      ? "Suggestion reopened."
      : "Suggestion marked " + button.dataset.status + ".");
  },
  "load-more-bookmarks": async (button) => {
    const older = await api("/api/me/bookmarks?before=" + button.dataset.before);
    appendPostList(main, older.bookmarks, document, state.currentUser,
      BOOKMARKS_EMPTY_TEXT);
    button.remove();
    if (!older.nextBefore || older.bookmarks.length !== 20) return;
    const next = element("button", "button button-secondary", "Load older saved posts");
    next.type = "button";
    next.dataset.action = "load-more-bookmarks";
    next.dataset.before = String(older.nextBefore);
    main.append(next);
  },
  "composer-attach": (button) => attachComposerImages(button),
  "open-gif-picker": (button) => openGifPicker(button),
  "confirm-gif-picker": (button) => confirmGifPicker(button),
  "cancel-gif-picker": () => { activeGifComposerForm = null; gifPickerDialog()?.close(); },
  "choose-gif-upload": () => document.querySelector("#gif-marketplace-file")?.click(),
  "remove-composer-file": (button) => removeComposerFile(button),
  "remove-gif": (button) => {
    const form = button.closest("form");
    if (!form) return;
    removeGifFromComposer(form, button.dataset.gifId);
    renderComposerGifStrip(form);
  },
  "open-poll-dialog": (button) => openPollDialog(button),
  "confirm-poll-dialog": () => confirmPollDialog(),
  "cancel-poll-dialog": () => { activePollComposerForm = null; pollDialog()?.close(); },
};

export {
  renderHomeRoute,
  renderMineRoute,
  renderCategoryRoute,
  renderBookmarksRoute,
  createComposer,
  handleComposerFileSelection,
  uploadCommunityGif,
};
