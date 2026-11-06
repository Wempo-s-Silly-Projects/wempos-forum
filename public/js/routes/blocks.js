// Blocks (v4.4): the account-settings section — the member's block pairs
// (both directions, named) with the Unblock control for the rows they own.
// The profile surface carries the Block button (routes/profile.js); once a
// pair exists the profile itself is unavailable, so this list is the only
// Unblock door for rows this member didn't create (those are closed by the
// other member alone).
import { api } from "../api.js";
import { createPanel, element, openConfirmDialog, setMessage } from "../dom.js";
import { state } from "../state.js";

export async function renderBlockedSettings(account, session) {
  const panel = createPanel("Blocked members",
    "Blocked members cannot see your profile or posts, and cannot reply, react, message, or sign your wall — and you cannot see theirs.");
  const list = element("div", "blocked-list");
  panel.append(list);
  account.append(panel);
  let data;
  try {
    data = await api("/api/me/blocks");
  } catch {
    list.append(element("p", "empty-state", "Could not load your block list."));
    return;
  }
  if (!versionCurrent(session)) return;
  list.replaceChildren();
  if (!data.blocks.length) {
    list.append(element("p", "empty-state", "You have not blocked any members."));
    return;
  }
  for (const row of data.blocks) {
    const item = element("div", "blocked-row");
    item.append(element("span", "blocked-name", "@" + row.username));
    if (row.ownDirection) {
      const button = element("button", "button button-secondary", "Unblock");
      button.type = "button";
      button.dataset.action = "unblock-user";
      button.dataset.userId = String(row.id);
      button.dataset.username = row.username;
      item.append(button);
    } else {
      item.append(element("span", "muted", "Blocked by them"));
    }
    list.append(item);
  }
}

// The fetch races renders; a stale answer must not clobber the current one.
function versionCurrent(session) {
  return Boolean(session && state.currentUser &&
    session.user.id === state.currentUser.id);
}

async function unblock(button) {
  const userId = Number(button.dataset.userId);
  const username = button.dataset.username || "this member";
  openConfirmDialog(
    `Unblock @${username}?`,
    "They will be able to see your profile and posts, and interact with them again (unless you take other action).",
    async () => {
      await api(`/api/users/${userId}/block`, { method: "DELETE" });
      setMessage(`Unblocked @${username}.`);
      await state.renderRoute(state.activeRoute);
    },
  );
}

export const ACTIONS = {
  "unblock-user": (button) => unblock(button),
};
