const TURNSTILE_SITEKEY = "0x4AAAAAAFXrK9dxFMt6fp46";
const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";

const widgets = new Map();
let loadPromise = null;

export async function ensureTurnstile(timeoutMs = 15_000) {
  if (!loadPromise) {
    loadPromise = (async () => {
      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.append(script);
      const deadline = Date.now() + timeoutMs;
      while (!window.turnstile) {
        if (Date.now() > deadline) {
          throw new Error("The human-verification widget failed to load. Refresh the page and try again.");
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return window.turnstile;
    })();
    const attempt = loadPromise;
    attempt.catch(() => {
      if (loadPromise === attempt) loadPromise = null;
    });
  }
  return loadPromise;
}

export function addTurnstileSlot(form, action) {
  const slot = document.createElement("div");
  slot.className = "turnstile-slot";
  slot.dataset.turnstileAction = action;
  slot.dataset.verificationPending = "true";
  const submitButton = form.querySelector('button[type="submit"]');
  form.insertBefore(slot, submitButton);
  widgets.set(form, { widgetId: null, token: "" });
}

export async function renderTurnstileSlots(root) {
  const pending = root.querySelectorAll(".turnstile-slot[data-verification-pending]");
  for (const slot of pending) {
    delete slot.dataset.verificationPending;
    const form = slot.closest("form");
    const state = widgets.get(form);
    if (!state) continue;
    try {
      const turnstile = await ensureTurnstile();
      if (slot.isConnected && !state.widgetId) {
        state.widgetId = turnstile.render(slot, {
          sitekey: TURNSTILE_SITEKEY,
          action: slot.dataset.turnstileAction,
          callback: (token) => {
            delete slot.dataset.turnstileError;
            state.token = token;
          },
          "error-callback": (code) => {
            slot.dataset.turnstileError = code || "unknown";
            state.token = "";
          },
          "expired-callback": () => {
            delete slot.dataset.turnstileError;
            state.token = "";
          },
        });
      }
    } catch (error) {
      slot.replaceChildren();
      state.widgetId = null;
      addTextToSlot(slot, error.message);
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
  if (turnstile) {
    for (const state of widgets.values()) {
      if (state.widgetId !== null) {
        try { turnstile.remove(state.widgetId); } catch { /* widget already gone */ }
      }
    }
  }
  widgets.clear();
}

export function takeTurnstileToken(form) {
  const state = widgets.get(form);
  if (!state || !state.token) {
    throw new Error("Please complete the human-verification step first.");
  }
  const token = state.token;
  state.token = "";
  return token;
}

export function refreshTurnstile(form) {
  const state = widgets.get(form);
  if (!state) return;
  state.token = "";
  if (state.widgetId !== null) {
    try { window.turnstile?.reset(state.widgetId); } catch { /* not rendered */ }
  }
}