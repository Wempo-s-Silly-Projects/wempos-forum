
// v4.0 plan 4 Task 2: the boot state app.js's monolith used to hold in its
// closure scope, as a mutable property bag. Route modules need the same live
// values the monolith shared freely (who is signed in, which route is active,
// the monotonically increasing render version, the router, and renderRoute
// itself so submit handlers can re-render the active route) — a `let` cannot
// be re-exported, so the values ride as properties. app.js writes through the
// same bag; state.js is a leaf module, so no import cycle appears.
export const state = {
  router: null,
  currentUser: null,

  // The property stays writable so the router can replace the active route.
  // Freeze only the initial default object against accidental mutation.
  activeRoute: Object.freeze({ name: "home" }),

  // Incremented whenever a new route render starts; asynchronous work can
  // compare its captured version to avoid updating a newer page.
  renderVersion: 0,

  renderRoute: null,
};
