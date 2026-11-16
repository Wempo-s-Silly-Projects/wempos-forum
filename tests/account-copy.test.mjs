// Account-name copy pins: the product vocabulary says "Wempo Account(s)"
// wherever a screen describes an account (sign-in, register, setup, settings),
// while the PRODUCT name stays "Wempo's Forum" and moderation/technical copy
// is untouched. Cheap text pins read the client sources themselves — these are
// copy changes, and a silent revert of one should fail the suite.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("sign-in/setup copy says Wempo Accounts, not 'account(s)' alone", () => {
  const auth = read("../public/js/routes/auth.js");
  assert.ok(auth.includes("Sign in with Wempo Accounts"), "the SSO front-door button label");
  assert.ok(auth.includes("Membership rides a Wempo Account:"), "the door panel's account copy");
  assert.ok(auth.includes("The first owner Wempo Account requires a setup secret"), "the setup panel copy");
  assert.ok(auth.includes("before the first owner Wempo Account can be created."), "the setup-locked copy");
  assert.ok(auth.includes("Owner Wempo Account created!"), "the setup success message");
});

test("settings + deletion copy calls it a Wempo Account", () => {
  const feed = read("../public/js/routes/feed.js");
  assert.ok(feed.includes("Delete your Wempo Account"), "the settings delete panel title");
  assert.ok(feed.includes("This permanently deletes your Wempo Account"), "the settings delete panel body");
  assert.ok(feed.includes("Delete Wempo Account"), "the settings delete button");
  const profile = read("../public/js/routes/profile.js");
  assert.ok(profile.includes("Delete your Wempo Account?"), "the confirm dialog title");
  assert.ok(profile.includes("Your Wempo Account and everything it owns is permanently deleted"), "the confirm dialog body");
  assert.ok(profile.includes("Your Wempo Account was deleted."), "the post-deletion status message");
});

test("the SSO front door rides the Accounts origin with an origin-only return", () => {
  const sso = read("../public/js/sso.js");
  assert.ok(sso.includes('const WEMPO_ACCOUNTS_ORIGIN = "https://accounts.itswempo.workers.dev";'));
  assert.ok(sso.includes("encodeURIComponent(origin || \"\")"), "the return parameter carries the exact origin only");
  assert.ok(!/\/login\?return=.*location\.(search|href)/.test(sso), "never a query string inside the return parameter");
});

test("the product name and moderation copy keep their own vocabulary", () => {
  assert.ok(read("../public/js/routes/auth.js").includes("Set up Wempo's Forum:3"), "the product name is untouched");
  assert.ok(read("../public/js/desk/bans.js").includes("Timed bans auto-reactivate the account when they expire."), "moderation copy is not renamed");
  // Shared 401 refusal copy pin (api side):
  assert.ok(read("../api/accounts.mjs").includes("That sign-in link has expired. Sign in again."));
});

test("the home door panel is the Accounts handoff — no password forms render", () => {
  const auth = read("../public/js/routes/auth.js");
  assert.ok(auth.includes("function doorPanel()"), "the door panel source exists");
  assert.ok(auth.includes('createPanel("Join the conversation!"'), "the door panel keeps the join copy's heading");
  // The Accounts button rides the app-link-safe plain anchor (cross-origin,
  // so the SPA's internal navigation can never intercept it).
  assert.ok(auth.includes('element("a", "button button-primary sso-entry-button", "Sign in with Wempo Accounts")'));
  assert.ok(auth.includes("button.href = wempoAccountsSignInUrl(location.origin)"));
  // No auth grid, no login/register forms, no Turnstile slots on auth.
  assert.ok(!auth.includes("auth-grid"), "the password form grid is gone");
  assert.ok(!auth.includes("addTurnstileSlot"), "no Turnstile slots on the door");
});
