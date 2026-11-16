// v4.0 plan 4 Task 2: the auth concern — the login/register/setup panel
// builders, the first-setup screens, and the auth submit handler. Bodies moved
// verbatim out of app.js. The route registry and FORM_HANDLERS maps wire into
// app.js's renderRoute/submitForm registrations; the banned screen wiring
// stays with submitAuthForm (it renders on a failed login's 403).
import { addText, createForm, createInput } from "../forms.js";
import { api, setCsrfToken } from "../api.js";
import {
  addHeading,
  createPanel,
  element,
  main,
  setMessage,
} from "../dom.js";
import { addTurnstileSlot, refreshTurnstile, takeTurnstileToken } from "../turnstile.js";
import { renderBannedScreen } from "../banned.js";
import { state } from "../state.js";
import { renderTotpLoginStep } from "./twofa.js";

// Wempo Accounts sign-in handshake: the header's "Sign in with Wempo Accounts"
// button jumps to the Accounts worker's sign-in screen, which comes back with
// ?wt=<one-time code>; redeemAccountsSignIn posts it to the redeem route once
// and lands in the app through the same post-login flow the password form
// uses. Only the bare ORIGIN rides the return parameter — never a query
// string, so the exact-match return check on the Accounts side can never be
// widened by what this page appends.
const ACCOUNTS_ORIGIN = "https://accounts.itswempo.workers.dev";
const SSO_QUERY_KEY = "wt";
let ssoRedeemAttempted = false;

function accountsSignInUrl() {
  return ACCOUNTS_ORIGIN + "/login?return=" + encodeURIComponent(location.origin);
}

function clearSsoCode() {
  const clean = new URL(location.href);
  clean.searchParams.delete(SSO_QUERY_KEY);
  history.replaceState(null, "", clean.pathname + clean.search);
}

async function redeemAccountsSignIn(code, note) {
  // Redeem ONCE per page load: the code is single-use server-side, so a
  // re-render racing the in-flight request must not fire a second POST.
  if (ssoRedeemAttempted) return;
  ssoRedeemAttempted = true;
  note.textContent = "Signing you in with Wempo Accounts…";
  try {
    const result = await api("/api/auth/sso/redeem", { method: "POST", body: { wt: code } });
    setCsrfToken(result.csrfToken);
    state.router.navigate("/");
    setMessage("You're signed in.");
  } catch (error) {
    note.textContent = error.message;
    clearSsoCode();
  }
}

function renderAccountsSignIn(grid, joinPanel) {
  const sso = element("div", "sso-entry");
  const button = element("a", "button button-secondary sso-entry-button", "Sign in with Wempo Accounts");
  button.href = accountsSignInUrl();
  // Cross-origin jump to the Accounts worker: it must NOT ride the SPA's
  // internal navigation (which only rewrites same-origin paths).
  const note = element("p", "sso-entry-note muted", "");
  const code = new URLSearchParams(location.search).get(SSO_QUERY_KEY);
  if (code) redeemAccountsSignIn(code, note);
  sso.append(button, note);
  joinPanel.insertBefore(sso, grid);
}

function authForm(name, title, buttonLabel) {
  const section = element("section", "auth-card");
  addHeading(section, title, 2);
  const form = createForm(document, name, [
    createInput(document, {
      id: `${name}-username`,
      name: "username",
      label: "Username",
      autoComplete: "username",
      required: true,
      minLength: 3,
      maxLength: 24,
    }),
    createInput(document, {
      id: `${name}-password`,
      name: "password",
      label: "Password",
      type: "password",
      autoComplete: name === "login" ? "current-password" : "new-password",
      required: true,
      minLength: 12,
      maxLength: 128,
    }),
  ], buttonLabel);
  addTurnstileSlot(form, name === "login" ? "login" : "signup");
  section.append(form);
  return section;
}

function setupForm() {
  const panel = createPanel("Set up Wempo's Forum:3", "The first owner Wempo Account requires a setup secret configured out of band.");
  panel.append(createForm(document, "setup", [
    createInput(document, {
      id: "setup-username", name: "username", label: "Owner username",
      autoComplete: "username", required: true, minLength: 3, maxLength: 24,
    }),
    createInput(document, {
      id: "setup-password", name: "password", label: "Password",
      type: "password", autoComplete: "new-password", required: true, minLength: 12, maxLength: 128,
    }),
    createInput(document, {
      id: "setup-key", name: "setupKey", label: "Setup secret", type: "password",
      autoComplete: "off", required: true, minLength: 32, maxLength: 4096,
      description: "Provided by the site owner through Wrangler. Never EVER share it!",
    }),
  ], "Create owner"));
  return panel;
}

function renderJoinPanel() {
  const panel = createPanel("Join the conversation!", "Wempo Accounts use a username and password. There is no email collection or email-based recovery.");
  panel.id = "join";
  const grid = element("div", "auth-grid");
  grid.append(
    authForm("login", "Welcome back", "Sign in"),
    authForm("register", "New around here?", "Create Wempo Account"),
  );
  renderAccountsSignIn(grid, panel);
  panel.append(grid);
  main.append(panel);
}

function renderSetupLocked() {
  const panel = createPanel(
    "First-time setup is locked",
    "The site owner must configure valid SETUP_SECRET and PASSWORD_PEPPER values in Wrangler before the first owner Wempo Account can be created.",
  );
  main.append(panel);
}

function renderHomeAccess(session, setupRequired, setupConfigured) {
  if (setupRequired) {
    if (setupConfigured) main.append(setupForm());
    else renderSetupLocked();
    return;
  }
  if (!session.user) renderJoinPanel();
}

function renderSetupRoute(context) {
  if (context.setupRequired) {
    if (context.setupConfigured) main.append(setupForm());
    else renderSetupLocked();
    return;
  }
  addText(document, main, "p", "First-time setup has already been completed.", "empty-state");
}

async function submitAuthForm(type, form, text) {
  const endpoint = type === "login" ? "/api/auth/login" :
    type === "register" ? "/api/auth/register" : "/api/setup";
  const credentials = { username: text("username"), password: text("password") };
  if (type === "setup") {
    credentials.setupKey = text("setupKey");
  } else {
    credentials["cf-turnstile-response"] = takeTurnstileToken(form);
    refreshTurnstile(form);
  }
  let result;
  try {
    result = await api(endpoint, { method: "POST", body: credentials });
  } catch (error) {
    // Banned accounts get a dedicated screen (spec §13): api.js copies the 403
    // body's banned/reason/expiresAt onto the error object. Credentials were
    // verified server-side before this payload exists, so showing it is safe.
    if (error.banned === true) {
      main.replaceChildren();
      renderBannedScreen(main, { reason: error.reason, expiresAt: error.expiresAt, username: text("username"), password: text("password") });
      setMessage();
      return;
    }
    throw error;
  }
  // Two-factor sign-in (v4.0.1): the password passed but a code is owed —
  // the join panel swaps to the code step (renderTotpLoginStep in
  // routes/twofa.js); POST /api/auth/totp mints the session.
  if (result.totpRequired) {
    renderTotpLoginStep(result.challenge);
    setMessage("Enter the code from your authenticator app to finish signing in.");
    return;
  }
  setCsrfToken(result.csrfToken);
  state.router.navigate("/");
  setMessage(type === "setup" ? "Owner Wempo Account created!" : "You're signed in.");
}

// The registration seam: FORM_HANDLERS merges into submitForm's dispatch map;
// renderSetupRoute takes the setup entry of renderRoute's renderer table and
// renderHomeAccess stays the home route's access gate (called from app.js's
// renderHome until the feed task moves it).
export const FORM_HANDLERS = {
  login: (form, text) => submitAuthForm("login", form, text),
  register: (form, text) => submitAuthForm("register", form, text),
  setup: (form, text) => submitAuthForm("setup", form, text),
};

export { renderHomeAccess, renderSetupRoute };
