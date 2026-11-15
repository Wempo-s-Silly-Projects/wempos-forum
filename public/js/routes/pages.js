
// v4.0 plan 4 Task 6: the standalone content pages — the rules page (site
// copy through the markdown subset), the all-time leaderboard, and the
// accountability archive (read route + load-older fragmenting), plus the
// site-search submit and the rules save action. Bodies moved from app.js.

import { api } from "../api.js";
import {
  addHeading,
  element,
  main,
  setMessage,
} from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";
import { renderBodyBlocks } from "../render.js";

function isRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value),
  );
}

function validCursor(value) {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function validateRulesResponse(data) {
  if (!isRecord(data)) {
    throw new Error("Invalid rules response.");
  }

  if (
    data.rules != null &&
    typeof data.rules !== "string"
  ) {
    throw new Error("Invalid rules content.");
  }

  return data;
}

function validateLeaderboardResponse(data) {
  if (
    !isRecord(data) ||
    !isRecord(data.allTime) ||
    !Array.isArray(data.allTime.leaderboard)
  ) {
    throw new Error("Invalid leaderboard response.");
  }

  return data;
}

function validateArchiveResponse(data) {
  if (
    !isRecord(data) ||
    !Array.isArray(data.archive)
  ) {
    throw new Error("Invalid archive response.");
  }

  if (
    data.nextBefore != null &&
    !validCursor(data.nextBefore)
  ) {
    throw new Error("Invalid archive pagination cursor.");
  }

  return data;
}

async function renderRulesRoute(context, version) {
  const data = validateRulesResponse(
    await api("/api/rules"),
  );

  if (version !== state.renderVersion) return;

  addHeading(main, "Forum rules", 2);

  if (!data.rules) {
    addText(
      document,
      main,
      "p",
      "The rules haven't been written yet.",
      "empty-state",
    );
    return;
  }

  renderBodyBlocks(
    { body: data.rules },
    document,
    main,
  );

  if (data.updatedAt) {
    const updatedAt = new Date(data.updatedAt);

    if (!Number.isNaN(updatedAt.getTime())) {
      addText(
        document,
        main,
        "p",
        `Last updated ${updatedAt.toLocaleString()}`,
        "muted",
      );
    }
  }
}

async function renderLeaderboardRoute(context, version) {
  const data = validateLeaderboardResponse(
    await api("/api/leaderboard"),
  );

  if (version !== state.renderVersion) return;

  addHeading(main, "Leaderboard", 2);

  const rows = data.allTime.leaderboard;

  if (!rows.length) {
    addText(
      document,
      main,
      "p",
      "Nothing yet — be the first!",
      "empty-state",
    );
    return;
  }

  const list = element("ol", "leaderboard-list");

  for (const [index, entry] of rows.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.username !== "string" ||
      !entry.username.trim()
    ) {
      continue;
    }

    const row = element("li", "leaderboard-row");

    row.append(
      element(
        "span",
        "leaderboard-rank",
        "#" + (index + 1),
      ),
    );

    const link = element(
      "a",
      "leaderboard-name",
      entry.username,
    );

    link.href =
      "/users/" + encodeURIComponent(entry.username);

    link.setAttribute("data-app-link", "");

    row.append(link);

    row.append(
      element(
        "span",
        "leaderboard-stats",
        `${entry.threads} threads · ${entry.replies} replies · ${entry.reactionsReceived} reactions received`,
      ),
    );

    row.append(
      element(
        "span",
        "leaderboard-score",
        String(entry.score),
      ),
    );

    list.append(row);
  }

  if (!list.children.length) {
    addText(
      document,
      main,
      "p",
      "Nothing yet — be the first!",
      "empty-state",
    );
    return;
  }

  main.append(list);
}

async function renderArchiveRoute(context, version) {
  // The accountability archive (v2.4.1): everyone can read what was deleted,
  // so no auth is needed — this route renders for guests too.
  const data = validateArchiveResponse(
    await api("/api/archive"),
  );

  if (version !== state.renderVersion) return;

  addHeading(main, "Archive", 2);

  if (!data.archive.length) {
    main.append(
      element(
        "p",
        "archive-empty",
        "Nothing has been deleted yet.",
      ),
    );
    return;
  }

  main.append(renderArchiveListFragment(data.archive));

  if (!data.nextBefore) return;

  const older = element(
    "button",
    "button button-secondary",
    "Load older archive",
  );

  older.type = "button";
  older.dataset.action = "load-more-archive";
  older.dataset.before = String(data.nextBefore);

  main.append(older);
}

function renderArchiveListFragment(entries) {
  const list = element("div", "archive-list");

  for (const entry of entries) {
    if (!isRecord(entry)) continue;

    const card = element("article", "archive-card");
    const header = element("p", "archive-header");

    header.append(
      element(
        "span",
        "archive-author",
        "post by " +
          (typeof entry.authorName === "string"
            ? entry.authorName
            : "unknown"),
      ),
    );

    const deletedAt = new Date(entry.deletedAt);
    const deletedLabel = Number.isNaN(deletedAt.getTime())
      ? "unknown date"
      : deletedAt.toLocaleString();

    header.append(
      element(
        "span",
        "archive-meta",
        "deleted " +
          deletedLabel +
          " · " +
          (entry.deletedBecause === "account-delete"
            ? "account deleted"
            : "post deleted") +
          " · deleted by " +
          (typeof entry.deletedByName === "string" &&
          entry.deletedByName
            ? entry.deletedByName
            : "unknown"),
      ),
    );

    card.append(header);

    const bodyBlock = element("p", "archive-body");

    bodyBlock.textContent =
      typeof entry.body === "string" ? entry.body : "";

    card.append(bodyBlock);
    list.append(card);
  }

  return list;
}

async function loadMoreArchive(button) {
  if (button.disabled) return;

  const before = button.dataset.before;

  if (!validCursor(before)) {
    setMessage("That archive pagination cursor is invalid.", true);
    return;
  }

  // The accountability archive paginates on the raw row ID
  // (newest-first). Keep the current route from receiving stale results.
  const version = state.renderVersion;

  button.disabled = true;

  try {
    const older = validateArchiveResponse(
      await api(
        "/api/archive?before=" + encodeURIComponent(before),
      ),
    );

    if (
      version !== state.renderVersion ||
      !button.isConnected
    ) {
      return;
    }

    const rendered = renderArchiveListFragment(older.archive);

    button.before(rendered);
    button.remove();

    if (!older.nextBefore) return;

    const next = element(
      "button",
      "button button-secondary",
      "Load older archive",
    );

    next.type = "button";
    next.dataset.action = "load-more-archive";
    next.dataset.before = String(older.nextBefore);

    main.append(next);
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

async function submitSiteSearch(getFieldValue) {
  const query = getFieldValue("q").trim();

  state.router.navigate(
    "/?q=" + encodeURIComponent(query),
  );
}

export const FORM_HANDLERS = {
  "site-search": (form, getFieldValue) =>
    submitSiteSearch(getFieldValue),
};

export const ACTIONS = {
  "save-forum-rules": async () => {
    const input = document.querySelector("#rules-input");

    if (!input) return;

    await api("/api/rules", {
      method: "POST",
      body: input.value,
    });

    state.router.navigate("/rules");
    setMessage("Rules saved.");
  },

  "load-more-archive": (button) =>
    loadMoreArchive(button),
};

export {
  renderRulesRoute,
  renderLeaderboardRoute,
  renderArchiveRoute,
};
