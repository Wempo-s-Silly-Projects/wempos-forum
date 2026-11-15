
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
import {
  addTurnstileSlot,
  refreshTurnstile,
  takeTurnstileToken,
} from "../turnstile.js";
import { renderBannedScreen } from "../banned.js";
import { state } from "../state.js";
import { renderTotpLoginStep } from "./twofa.js";

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
      autoComplete:
        name === "login"
          ? "current-password"
          : "new-password",
      required: true,
      minLength: 12,
      maxLength: 128,
    }),
  ], buttonLabel);

  addTurnstileSlot(
    form,
    name === "login" ? "login" : "signup",
  );

  section.append(form);

  return section;
}

function setupForm() {
  const panel = createPanel(
    "Set up Wempo's Forum:3",
    "The first owner account requires a setup secret configured out of band.",
  );

  panel.append(
    createForm(document, "setup", [
      createInput(document, {
        id: "setup-username",
        name: "username",
        label: "Owner username",
        autoComplete: "username",
        required: true,
        minLength: 3,
        maxLength: 24,
      }),

      createInput(document, {
        id: "setup-password",
        name: "password",
        label: "Password",
        type: "password",
        autoComplete: "new-password",
        required: true,
        minLength: 12,
        maxLength: 128,
      }),

      createInput(document, {
        id: "setup-key",
        name: "setupKey",
        label: "Setup secret",
        type: "password",
        autoComplete: "off",
        required: true,
        minLength: 32,
        maxLength: 4096,
        description:
          "Provided by the site owner through Wrangler. Never EVER share it!",
      }),
    ], "Create owner"),
  );

  return panel;
}

function renderJoinPanel() {
  const panel = createPanel(
    "Join the conversation!",
    "Accounts use a username and password. There is no email collection or email-based recovery.",
  );

  panel.id = "join";

  const grid = element("div", "auth-grid");

  grid.append(
    authForm("login", "Welcome back", "Sign in"),
    authForm("register", "New around here?", "Create account"),
  );

  panel.append(grid);
  main.append(panel);
}

function renderSetupLocked() {
  const panel = createPanel(
    "First-time setup is locked",
    "The site owner must configure valid SETUP_SECRET and PASSWORD_PEPPER values in Wrangler before the first owner account can be created.",
  );

  main.append(panel);
}

function renderHomeAccess(session, setupRequired, setupConfigured) {
  if (setupRequired) {
    if (setupConfigured) {
      main.append(setupForm());
    } else {
      renderSetupLocked();
    }

    return;
  }

  if (!session?.user) {
    renderJoinPanel();
  }
}

function renderSetupRoute(context) {
  if (context?.setupRequired) {
    if (context.setupConfigured) {
      main.append(setupForm());
    } else {
      renderSetupLocked();
    }

    return;
  }

  addText(
    document,
    main,
    "p",
    "First-time setup has already been completed.",
    "empty-state",
  );
}

function isRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value),
  );
}

function validateAuthResponse(result) {
  if (!isRecord(result)) {
    throw new Error("The authentication server returned an invalid response.");
  }

  if (
    typeof result.csrfToken !== "string" ||
    result.csrfToken.length === 0
  ) {
    throw new Error("The authentication response did not contain a valid CSRF token.");
  }

  return result;
}

function validateTotpChallenge(result) {
  if (
    result.totpRequired !== true ||
    (
      typeof result.challenge !== "string" &&
      !isRecord(result.challenge)
    )
  ) {
    throw new Error("The authentication server returned an invalid two-factor challenge.");
  }

  if (
    typeof result.challenge === "string" &&
    result.challenge.length === 0
  ) {
    throw new Error("The authentication server returned an empty two-factor challenge.");
  }

  return result.challenge;
}

function isValidCredentials(username, password) {
  return (
    typeof username === "string" &&
    username.trim().length >= 3 &&
    username.length <= 24 &&
    typeof password === "string" &&
    password.length >= 12 &&
    password.length <= 128
  );
}

async function submitAuthForm(type, form, text) {
  if (form.dataset.submitting === "true") {
    return;
  }

  const endpoint =
    type === "login"
      ? "/api/auth/login"
      : type === "register"
        ? "/api/auth/register"
        : type === "setup"
          ? "/api/setup"
          : null;

  if (!endpoint) {
    throw new Error("Invalid authentication operation.");
  }

  const username = text("username").trim();
  const password = text("password");

  if (!isValidCredentials(username, password)) {
    throw new Error(
      "Enter a valid username and password.",
    );
  }

  const credentials = {
    username,
    password,
  };

  if (type === "setup") {
    const setupKey = text("setupKey");

    if (
      typeof setupKey !== "string" ||
      setupKey.length < 32 ||
      setupKey.length > 4096
    ) {
      throw new Error("Enter a valid setup secret.");
    }

    credentials.setupKey = setupKey;
  } else {
    const turnstileToken = takeTurnstileToken(form);

    if (
      typeof turnstileToken !== "string" ||
      turnstileToken.length === 0
    ) {
      throw new Error("Complete the security check before continuing.");
    }

    credentials["cf-turnstile-response"] = turnstileToken;
    refreshTurnstile(form);
  }

  form.dataset.submitting = "true";

  try {
    let result;

    try {
      result = await api(endpoint, {
        method: "POST",
        body: credentials,
      });
    } catch (error) {
      // Banned accounts get a dedicated screen (spec §13): api.js copies the
      // 403 body's banned/reason/expiresAt onto the error object. Credentials
      // were verified server-side before this payload exists, so showing it
      // is safe.
      if (type === "login" && error?.banned === true) {
        main.replaceChildren();

        renderBannedScreen(main, {
          reason: error.reason,
          expiresAt: error.expiresAt,
          username,
          password,
        });

        setMessage();
        return;
      }

      throw error;
    }

    if (!isRecord(result)) {
      throw new Error("The authentication server returned an invalid response.");
    }

    // Two-factor sign-in (v4.0.1): the password passed but a code is owed —
    // the join panel swaps to the code step (renderTotpLoginStep in
    // routes/twofa.js); POST /api/auth/totp mints the session.
    if (result.totpRequired === true) {
      const challenge = validateTotpChallenge(result);

      renderTotpLoginStep(challenge);

      setMessage(
        "Enter the code from your authenticator app to finish signing in.",
      );

      return;
    }

    const validResult = validateAuthResponse(result);

    setCsrfToken(validResult.csrfToken);

    state.router.navigate("/");

    setMessage(
      type === "setup"
        ? "Owner account created!"
        : "You're signed in.",
    );
  } finally {
    delete form.dataset.submitting;
  }
}

// The registration seam: FORM_HANDLERS merges into submitForm's dispatch map;
// renderSetupRoute takes the setup entry of renderRoute's renderer table and
// renderHomeAccess stays the home route's access gate (called from app.js's
// renderHome until the feed task moves it).
export const FORM_HANDLERS = {
  login: (form, text) =>
    submitAuthForm("login", form, text),

  register: (form, text) =>
    submitAuthForm("register", form, text),

  setup: (form, text) =>
    submitAuthForm("setup", form, text),
};

export { renderHomeAccess, renderSetupRoute };
