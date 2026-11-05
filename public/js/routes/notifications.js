// v4.0 plan 4 Task 7: the notifications concern — the /notifications route
// (guest gate + renderNotificationsPage for members) and its actions (mark
// one read on open, mark all read). Bodies moved verbatim out of app.js.
import { api } from "../api.js";
import { addHeading, element, main, setMessage } from "../dom.js";
import { addText } from "../forms.js";
import { state } from "../state.js";
import { renderNotificationsPage, updateBell } from "../notifications.js";

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
  await state.renderRoute({ name: "notifications" });
  setMessage("All notifications were marked read.");
}

export const ACTIONS = {
  "open-notification": (button) => openNotification(button),
  "mark-notifications-read": () => markAllNotificationsRead(),
};

export { renderNotificationsRoute };
