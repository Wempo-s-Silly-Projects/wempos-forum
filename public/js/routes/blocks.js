
// Blocks (v4.4): the account-settings section — the member's block pairs
// (both directions, named) with the Unblock control for the rows they own.
// The profile surface carries the Block button (routes/profile.js); once a
// pair exists the profile itself is unavailable, so this list is the only
// Unblock door for rows this member didn't create (those are closed by the
// other member alone).
import { api } from "../api.js";
import {
  confirmDialog,
  createPanel,
  element,
  openConfirmDialog,
  setMessage,
} from "../dom.js";
import { state } from "../state.js";

const renderVersions = new WeakMap();

function isRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value),
  );
}

function isValidUserId(value) {
  return (
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function getSessionUserId(session) {
  const id = session?.user?.id;

  return isValidUserId(id) ? id : null;
}

function versionCurrent(session, version) {
  const sessionUserId = getSessionUserId(session);
  const currentUserId = state.currentUser?.id;

  return (
    sessionUserId !== null &&
    isValidUserId(currentUserId) &&
    sessionUserId === currentUserId &&
    renderVersions.get(session) === version
  );
}

function validateBlocksResponse(data) {
  if (!isRecord(data) || !Array.isArray(data.blocks)) {
    throw new Error("Invalid block-list response.");
  }

  return data.blocks.filter((row) =>
    isRecord(row) &&
    isValidUserId(row.id) &&
    typeof row.username === "string" &&
    row.username.length > 0 &&
    row.username.length <= 64 &&
    typeof row.ownDirection === "boolean"
  );
}

export async function renderBlockedSettings(account, session) {
  const panel = createPanel(
    "Blocked members",
    "Blocked members cannot see your profile or posts, and cannot reply, react, message, or sign your wall — and you cannot see theirs.",
  );

  const list = element("div", "blocked-list");

  panel.append(list);
  account.append(panel);

  if (!isRecord(session) || !getSessionUserId(session)) {
    list.append(
      element("p", "empty-state", "Could not load your block list."),
    );
    return;
  }

  const version = (renderVersions.get(session) || 0) + 1;
  renderVersions.set(session, version);

  let data;

  try {
    data = await api("/api/me/blocks");
  } catch {
    if (!versionCurrent(session, version)) return;

    list.append(
      element("p", "empty-state", "Could not load your block list."),
    );

    return;
  }

  // The fetch races renders; a stale answer must not clobber the current one.
  if (!versionCurrent(session, version)) return;

  let blocks;

  try {
    blocks = validateBlocksResponse(data);
  } catch {
    list.replaceChildren(
      element("p", "empty-state", "Could not load your block list."),
    );
    return;
  }

  list.replaceChildren();

  if (blocks.length === 0) {
    list.append(
      element("p", "empty-state", "You have not blocked any members."),
    );
    return;
  }

  for (const row of blocks) {
    const item = element("div", "blocked-row");

    item.append(
      element("span", "blocked-name", `@${row.username}`),
    );

    if (row.ownDirection) {
      const button = element(
        "button",
        "button button-secondary",
        "Unblock",
      );

      button.type = "button";
      button.dataset.action = "unblock-user";
      button.dataset.userId = String(row.id);
      button.dataset.username = row.username;

      item.append(button);
    } else {
      item.append(
        element("span", "muted", "Blocked by them"),
      );
    }

    list.append(item);
  }
}

async function unblock(button) {
  const userId = Number(button.dataset.userId);
  const username = button.dataset.username || "this member";

  if (!isValidUserId(userId)) {
    setMessage("Could not unblock this member: invalid member ID.");
    return;
  }

  openConfirmDialog(
    `Unblock @${username}?`,
    "They will be able to see your profile and posts, and interact with them again (unless you take other action).",
    "unblock",
    async () => {
      await api(`/api/users/${userId}/block`, {
        method: "DELETE",
      });

      confirmDialog.close();

      setMessage(`Unblocked @${username}.`);

      await state.renderRoute(state.activeRoute);
    },
  );
}

export const ACTIONS = {
  "unblock-user": (button) => unblock(button),
};
