
const TURNSTILE_SITEKEY = "0x4AAAAAAFXrK9dxFMt6fp46";
const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";

const widgets = new Map();
let loadPromise = null;

const LOAD_ERROR =
  "The human-verification widget failed to load. Refresh the page and try again.";

export async function ensureTurnstile(timeoutMs = 15_000) {
  if (window.turnstile) {
    return window.turnstile;
  }

  if (!loadPromise) {
    const timeout = Number.isFinite(timeoutMs) && timeoutMs >= 0
      ? timeoutMs
      : 15_000;

    const attempt = new Promise((resolve, reject) => {
      const script = document.createElement("script");

      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;

      let settled = false;
      let timer = null;

      const finish = (error = null) => {
        if (settled) return;
        settled = true;

        if (timer !== null) {
          clearTimeout(timer);
        }

        script.onload = null;
        script.onerror = null;

        if (error) {
          script.remove();
          reject(error);
          return;
        }

        resolve(window.turnstile);
      };

      script.onload = () => {
        if (window.turnstile) {
          finish();
        } else {
          finish(new Error(LOAD_ERROR));
        }
      };

      script.onerror = () => {
        finish(new Error(LOAD_ERROR));
      };

      timer = setTimeout(() => {
        finish(new Error(LOAD_ERROR));
      }, timeout);

      document.head.append(script);
    });

    loadPromise = attempt;

    attempt.catch(() => {
      if (loadPromise === attempt) {
        loadPromise = null;
      }
    });
  }

  return loadPromise;
}

export function addTurnstileSlot(form, action) {
  if (
    !form ||
    typeof form.querySelector !== "function" ||
    typeof form.insertBefore !== "function"
  ) {
    throw new TypeError("addTurnstileSlot requires a form element.");
  }

  const document = form.ownerDocument;

  const slot = document.createElement("div");
  slot.className = "turnstile-slot";
  slot.dataset.turnstileAction = action;
  slot.dataset.verificationPending = "true";

  const submitButton = form.querySelector('button[type="submit"]');

  form.insertBefore(slot, submitButton);

  widgets.set(form, {
    widgetId: null,
    token: "",
    rendering: false,
    generation: 0,
  });
}

// Turnstile follows the site theme (v2.4.1): a manual choice wins, then the
// widget falls back to the native "auto" (OS preference) like the CSS does.
function resolvedTurnstileTheme() {
  const manual = document.documentElement.dataset.theme;

  if (manual === "dark") return "dark";
  if (manual === "light") return "light";

  return "auto";
}

export async function renderTurnstileSlots(root) {
  const pending = root.querySelectorAll(
    ".turnstile-slot[data-verification-pending]",
  );

  for (const slot of pending) {
    const form = slot.closest("form");
    const state = widgets.get(form);

    if (!state) continue;
    if (state.widgetId !== null || state.rendering) continue;

    const generation = state.generation;

    state.rendering = true;
    delete slot.dataset.verificationPending;

    try {
      const turnstile = await ensureTurnstile();

      // The form may have been removed, torn down or rethemed while the
      // shared script-loading promise was pending.
      if (
        widgets.get(form) !== state ||
        state.generation !== generation ||
        !slot.isConnected
      ) {
        continue;
      }

      state.widgetId = turnstile.render(slot, {
        sitekey: TURNSTILE_SITEKEY,
        theme: resolvedTurnstileTheme(),
        action: slot.dataset.turnstileAction,

        callback: (token) => {
          if (
            widgets.get(form) !== state ||
            state.generation !== generation ||
            !slot.isConnected
          ) {
            return;
          }

          delete slot.dataset.turnstileError;
          state.token = token;
        },

        "error-callback": (code) => {
          if (
            widgets.get(form) !== state ||
            state.generation !== generation ||
            !slot.isConnected
          ) {
            return;
          }

          slot.dataset.turnstileError = code || "unknown";
          state.token = "";
        },

        "expired-callback": () => {
          if (
            widgets.get(form) !== state ||
            state.generation !== generation ||
            !slot.isConnected
          ) {
            return;
          }

          delete slot.dataset.turnstileError;
          state.token = "";
        },
      });
    } catch (error) {
      if (
        widgets.get(form) === state &&
        state.generation === generation &&
        slot.isConnected
      ) {
        slot.replaceChildren();
        state.widgetId = null;
        state.token = "";

        addTextToSlot(
          slot,
          error instanceof Error ? error.message : LOAD_ERROR,
        );
      }
    } finally {
      // An obsolete render must not change the state of a newer render.
      if (
        widgets.get(form) === state &&
        state.generation === generation
      ) {
        state.rendering = false;
      }
    }
  }
}

function addTextToSlot(slot, message) {
  const note = document.createElement("small");
  note.className = "form-note";
  note.textContent = message;
  slot.append(note);
}

export function teardownTurnstile() {
  const turnstile = window.turnstile;

  for (const state of widgets.values()) {
    // Invalidate any pending render or callbacks before removing the widget.
    state.generation += 1;
    state.rendering = false;
    state.token = "";

    if (turnstile && state.widgetId !== null) {
      try {
        turnstile.remove(state.widgetId);
      } catch {
        // Widget may already have been removed.
      }
    }

    state.widgetId = null;
  }

  widgets.clear();
}

export function takeTurnstileToken(form) {
  const state = widgets.get(form);

  if (!state || !state.token) {
    throw new Error(
      "Please complete the human-verification step first.",
    );
  }

  const token = state.token;
  state.token = "";

  return token;
}

// Called by the theme toggle: re-renders every live widget so its color
// scheme matches the new theme (Turnstile cannot retheme in place). Resets
// the token too — the old widget is gone, so its token is unusable.
export function rethemeTurnstile() {
  const turnstile = window.turnstile;

  for (const [form, state] of widgets) {
    // Invalidate callbacks and any render currently waiting on the loader.
    state.generation += 1;
    state.rendering = false;
    state.token = "";

    if (turnstile && state.widgetId !== null) {
      try {
        turnstile.remove(state.widgetId);
      } catch {
        // Widget may already have been removed.
      }
    }

    state.widgetId = null;

    const slot = form.querySelector(".turnstile-slot");

    if (slot && slot.isConnected) {
      slot.replaceChildren();
      delete slot.dataset.turnstileError;
      slot.dataset.verificationPending = "true";
    }
  }

  renderTurnstileSlots(document).catch(() => {
    // Best-effort: a failed re-render surfaces through the normal error path.
  });
}

export function refreshTurnstile(form) {
  const state = widgets.get(form);

  if (!state) return;

  state.token = "";

  if (state.widgetId !== null) {
    try {
      window.turnstile?.reset(state.widgetId);
    } catch {
      // Widget may no longer be rendered.
    }
  }
}
