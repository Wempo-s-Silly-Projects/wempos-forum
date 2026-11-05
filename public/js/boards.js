// Category set (v3.1, Discourse-style): one list shared by the sidebar, the
// composer's category picker, and the /c/<slug> routes. The slugs are the
// STORED posts.board values — api/posts.mjs whitelists the identical set
// server-side, so a slug here can always be sent as-is.
//
// staffOnly: the Updates category — everyone reads and replies, but only
// admins and the owner may start topics there (server-enforced 403; the
// composer is simply not offered to members).
export const BOARDS = [
  {
    slug: "general",
    label: "General",
    blurb: "Everyday chatter — talk about whatever's on your mind.",
  },
  {
    slug: "game-dev",
    label: "Game development",
    blurb: "Devlogs, works in progress, and hangout builds — see what everyone is working on.",
  },
  {
    slug: "showcase",
    label: "Showcase",
    blurb: "Show off what you made — games, art, sites, anything.",
  },
  {
    slug: "help",
    label: "Bugs & Troubleshooting & Help",
    blurb: "Something broke or you're stuck? Ask here.",
  },
  {
    slug: "suggestions",
    label: "Suggestions",
    blurb: "Ideas for the forum — sorted by likes, and staff can mark them resolved or declined.",
  },
  {
    slug: "updates",
    label: "Updates",
    blurb: "Site news from the staff. Everyone can read and reply; only admins can post.",
    staffOnly: true,
  },
];

export const BOARD_BY_SLUG = Object.fromEntries(BOARDS.map((board) => [board.slug, board]));

export const boardLabel = (slug) => BOARD_BY_SLUG[slug]?.label || "General";

// The composer's category picker: every category the given session member may
// start a topic in (staff-only categories appear for staff alone).
export const composerBoardChoices = (user) => BOARDS
  .filter((board) => !board.staffOnly ||
    (user && (user.role === "owner" || user.role === "admin")))
  .map((board) => ({ value: board.slug, label: board.label }));
