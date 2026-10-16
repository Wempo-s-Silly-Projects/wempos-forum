// Inline SVG icon kit (v2.4.1): single-stroke geometric icons drawn via
// createElementNS — CSP-safe (no library, no innerHTML) and token-colored
// through `currentColor`. Every icon is decorative inside an accessible
// button: the BUTTON carries the aria-label, the SVG gets aria-hidden.
// Glue tests inject a createElementNS-recording document stub.
const SVG_NS = "http://www.w3.org/2000/svg";

const ICON_PATHS = {
  // door + arrow: log out
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0"],
  // Subscriptions (C1): the bell with a checkmark — the subscribed state.
  "bell-check": ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0", "M9.5 7.5l2 2 3.5-3.5"],
  person: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  magnifier: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.35-4.35"],
  archive: ["M21 8v13H3V8", "M1 3h22v5H1z", "M10 12h4"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  sun: ["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z", "M12 1v2", "M12 21v2", "M4.22 4.22l1.42 1.42", "M18.36 18.36l1.42 1.42", "M1 12h2", "M21 12h2", "M4.22 19.78l1.42-1.42", "M18.36 5.64l1.42-1.42"],
  moon: ["M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"],
  chat: ["M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5z"],
  image: ["M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M3 15l5-5 6 6", "M12.5 14.5l3.5-3.5 5 5", "M9 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"],
  eye: ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  lightbulb: ["M9 18h6", "M10 22h4", "M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z"],
  // Pinning (C5): the pushpin — pinned threads.
  pin: ["M12 17v5", "M9 10.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6.5l2.5 2.5H6.5z", "M6.5 13h11"],
  // Polls (C3): a bar chart — the composer's Poll button.
  poll: ["M5 20V11", "M12 20V4", "M19 20v-5", "M2 20h20"],
  // Bookmarks (C4): the ribbon — save/unsave a post.
  bookmark: ["M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"],
  trophy: ["M8 21h8", "M12 17v4", "M17 4h3v1a4 4 0 0 1-4 4V8a4 4 0 0 0-3-4h-4a4 4 0 0 0-3 4v1a4 4 0 0 1-4-4V4h3", "M7 4h10v4a5 5 0 0 1-10 0z"],
  // Saved list (C4): the bookmark with a line set — list of saves.
  bookmarks: ["M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z", "M9 7h6"],
};

const ICON_ARIA = {
  logout: "Log out",
  bell: "Notifications",
  person: "Profile",
  magnifier: "Search",
  archive: "Archive",
  shield: "Moderation",
  lightbulb: "Suggestions",
  bookmarks: "Saved posts",
  trophy: "Leaderboard",
};

export const ICON_NAMES = Object.keys(ICON_PATHS);

// A 24×24 stroke icon; stroke uses currentColor so CSS tokens (ink) apply in
// every theme. `name` must not be interpolated from user input — callers pass
// ICON_NAMES keys only.
export function createIcon(document, name) {
  const paths = ICON_PATHS[name];
  if (!paths) throw new Error("No such icon: " + name);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of paths) {
    const shape = document.createElementNS(SVG_NS, "path");
    shape.setAttribute("d", d);
    svg.append(shape);
  }
  return svg;
}

// An icon-only button inheriting the quiet-button look. The actionable label
// lives in aria-label (from ICON_ARIA or the caller), never as visible text.
export function iconButton(document, name, { className, ariaLabel, dataset, tagName } = {}) {
  const element = document.createElement(tagName || "button");
  if (tagName === "a") element.href = dataset?.href || "#";
  element.type = tagName === "a" ? undefined : "button";
  element.className = className || "icon-button";
  const label = ariaLabel || ICON_ARIA[name];
  if (label) {
    element.setAttribute("aria-label", label);
    // Native hover tooltip: the button's name, per the owner's ask.
    element.title = label;
  }
  if (dataset) {
    for (const [key, value] of Object.entries(dataset)) {
      if (key !== "href") element.dataset[key] = value;
    }
  }
  element.append(createIcon(document, name));
  return element;
}