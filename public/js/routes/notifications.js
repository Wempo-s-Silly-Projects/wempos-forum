
// v4.0 plan 4 Task 7: the notifications concern — the /notifications route
// (guest gate + renderNotificationsPage for members) and its actions (mark
// one read on open, mark all read). Bodies moved from app.js.

import { api } from "../api.js";
import {
  addHeading,
  element,
  main,
  setMessage,
} from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";
import {
  renderNotificationsPage,
  updateBell,
} from "../notifications.js";

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

function notificationIdFromButton(button) {
  const id = button.dataset.notificationId;

  if (!validId(id)) {
    throw new Error("Invalid notification ID.");
  }

  return Number(id);
}

function postIdFromButton(button) {
  const id = button.dataset.postId;

  if (!validId(id)) {
    throw new Error("Invalid post ID.");
  }

  return Number(id);
}

function validateNotificationsResponse(data) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !Array.isArray(data.notifications)
  ) {
    throw new Error("Invalid notifications response.");
  }

  return data;
}

async function renderNotificationsRoute(context, version) {
  if (!context.session.user) {
    addHeading(main, "Notifications", 1);

    addText(
      document,
      main,
      "p",
      "Sign in to see your notifications.",
      "muted",
    );

    const signIn = element(
      "a",
      "button button-secondary",
      "Sign in",
    );

    signIn.href = "/#join";
    signIn.setAttribute("data-app-link", "");

    main.append(signIn);
    return;
  }

  const data = validateNotificationsResponse(
    await api("/api/me/notifications"),
  );

  if (version !== state.renderVersion) return;

  renderNotificationsPage(main, data.notifications);
}

async function openNotification(button) {
  if (button.disabled) return;

  const notificationId = notificationIdFromButton(button);
  const hasPostTarget = Boolean(button.dataset.postId);

  // Validate the destination before marking the notification read.
  const postId = hasPostTarget
    ? postIdFromButton(button)
    : null;

  button.disabled = true;

  try {
    // Mark-first is idempotent server-side; navigation then re-renders the
    // bell with a fresh unread count from GET /api/session. Label-only rows
    // (appeal outcomes, chat pings — no post target) just mark read.
    await api(
      `/api/me/notifications/${notificationId}/read`,
      { method: "POST" },
    );

    if (postId !== null) {
      state.router.navigate(`/posts/${postId}`);
    } else {
      await state.renderRoute({ name: "notifications" });
    }
  } catch (error) {
    if (button.isConnected) {
      button.disabled = false;
    }

    throw error;
  }
}

async function markAllNotificationsRead(button) {
  if (button?.disabled) return;

  if (button) {
    button.disabled = true;
  }

  try {
    await api(
      "/api/me/notifications/read-all",
      { method: "POST" },
    );

    // The rerender refetches the list (and the session's unread count);
    // the local update keeps the header honest even if route rendering
    // takes a moment.
    updateBell(0);

    await state.renderRoute({ name: "notifications" });

    setMessage("All notifications were marked read.");
  } catch (error) {
    if (button?.isConnected) {
      button.disabled = false;
    }

    throw error;
  }
}

export const ACTIONS = {
  "open-notification": (button) =>
    openNotification(button),

  "mark-notifications-read": (button) =>
    markAllNotificationsRead(button),
};

export { renderNotificationsRoute };
