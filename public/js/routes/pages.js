// v4.0 plan 4 Task 6: the standalone content pages — the rules page (site
// copy through the markdown subset), the all-time leaderboard, and the
// accountability archive (read route + load-older fragmenting), plus the
// site-search submit and the rules save action. Bodies moved verbatim out of
// app.js.
import { api } from "../api.js";
import { addHeading, element, main, setMessage } from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";
import { renderBodyBlocks } from "../render.js";

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

async function submitSiteSearch(text) {
  state.router.navigate("/?q=" + encodeURIComponent(text("q").trim()));
}
export const FORM_HANDLERS = {
  "site-search": (form, text) => submitSiteSearch(text),
};

export const ACTIONS = {
    "save-forum-rules": async () => {
      const input = document.querySelector("#rules-input");
      if (!input) return;
      await api("/api/rules", { method: "POST", body: input.value });
      state.router.navigate("/rules");
      setMessage("Rules saved.");
    },
    "load-more-archive": (button) => loadMoreArchive(button),
};

export { renderRulesRoute, renderLeaderboardRoute, renderArchiveRoute };
