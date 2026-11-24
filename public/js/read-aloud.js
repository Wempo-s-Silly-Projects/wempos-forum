// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// Read aloud (wave 2026-11-21-7 F3): a "Listen" toggle on post cards that
// reads the post out with the browser's speech engine. Privacy: only voices
// the browser reports as on-device (localService) are ever used, so the text
// never leaves the device; with no such voice the status says so and nothing
// is spoken. Spoilers and quoted text are skipped; nothing is stored.
import { currentLocale, t } from "./i18n.js";
import { createIcon } from "./icons.js";
import { maskSpoilers } from "./markdown.js";

export const MAX_SPOKEN_CHARS = 1200;
export const VOICE_WAIT_MS = 1000;
const SPOILER_MASK_PATTERN = /▒+/g;

let activeStop = null;
// Each Listen click (and every stop) bumps the ticket; a click whose voice
// wait finishes after a newer ticket was issued speaks nothing, so two
// clicks while voices load never queue both posts (wave 12).
let speakTicket = 0;
let activeUtterance = null;

// Plain words to speak: spoilers removed, "> " quote lines skipped, code
// fences, heading/list markers and inline emphasis marks dropped.
export function speakableText(body) {
  const lines = maskSpoilers(body).replace(SPOILER_MASK_PATTERN, " ").split("\n");
  const kept = lines
    .filter((line) => !line.trim().startsWith(">") && !line.trim().startsWith("```"))
    .map((line) => line.replace(/^\s*(#{1,6}\s+|[-*]\s+)/, "").replace(/[*_`~#>]+/g, ""));
  return kept.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_SPOKEN_CHARS);
}

// On-device voices only: exact language, then the base language, then the
// default local voice, then any local voice; null when none is on-device.
export function pickLocalVoice(voices, lang) {
  const local = Array.from(voices ?? []).filter((voice) => voice && voice.localService === true);
  if (!local.length) return null;
  const wanted = String(lang ?? "").toLowerCase();
  const base = wanted.split("-")[0];
  const langOf = (voice) => String(voice.lang ?? "").toLowerCase();
  return local.find((voice) => langOf(voice) === wanted)
    ?? local.find((voice) => langOf(voice).split("-")[0] === base)
    ?? local.find((voice) => voice.default)
    ?? local[0];
}

// Voices can arrive after first paint; wait once for voiceschanged.
function loadVoices(synth, waitMs) {
  const now = Array.from(synth.getVoices?.() ?? []);
  if (now.length || waitMs <= 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener?.("voiceschanged", done);
      resolve(Array.from(synth.getVoices?.() ?? []));
    };
    synth.addEventListener?.("voiceschanged", done);
    setTimeout(done, waitMs);
  });
}

export function stopReadAloud(synth = globalThis.speechSynthesis) {
  speakTicket += 1;
  activeStop?.();
  activeStop = null;
  activeUtterance = null;
  try {
    synth?.cancel?.();
  } catch {
    // A missing or broken engine has nothing to stop.
  }
}

// Inside the per-post More menu (post-more.js) the toggle is a
// menuitemcheckbox, whose state is aria-checked; elsewhere it is aria-pressed.
const stateAttribute = (button) =>
  (button.getAttribute("role") === "menuitemcheckbox" ? "aria-checked" : "aria-pressed");
const isPressed = (button) => button.getAttribute(stateAttribute(button)) === "true";

function setPressed(button, pressed) {
  button.setAttribute(stateAttribute(button), String(pressed));
  button.setAttribute("aria-label", pressed ? t("render.stopReading") : t("render.readAloud"));
  button.setAttribute("title", pressed ? t("render.stopReading") : t("render.readAloud"));
}

// Returns a wrapper (toggle + persistent polite status), or null where the
// browser has no speech engine.
export function createReadAloud(document, getText, {
  synth = globalThis.speechSynthesis ?? null,
  Utterance = globalThis.SpeechSynthesisUtterance ?? null,
  lang = currentLocale(),
  voiceWaitMs = VOICE_WAIT_MS,
} = {}) {
  if (!synth || typeof synth.speak !== "function" || typeof Utterance !== "function") return null;
  const wrap = document.createElement("span");
  wrap.className = "read-aloud";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-quiet icon-button read-aloud-button";
  button.append(createIcon(document, "volume"));
  setPressed(button, false);
  const status = document.createElement("span");
  status.className = "read-aloud-status";
  status.setAttribute("role", "status");
  wrap.append(button, status);

  const reset = () => setPressed(button, false);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    if (isPressed(button)) {
      stopReadAloud(synth);
      return;
    }
    stopReadAloud(synth);
    const ticket = speakTicket;
    status.textContent = "";
    const voice = pickLocalVoice(await loadVoices(synth, voiceWaitMs), lang);
    if (ticket !== speakTicket) return;
    const text = speakableText(getText());
    if (!voice || !text) {
      status.textContent = voice ? "" : t("render.noLocalVoice");
      return;
    }
    const utterance = new Utterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    // A late end event from a cancelled utterance must not reset the new one.
    utterance.onend = () => {
      if (activeUtterance !== utterance) return;
      activeUtterance = null;
      activeStop = null;
      reset();
    };
    utterance.onerror = utterance.onend;
    try {
      synth.cancel?.();
    } catch {
      // Nothing queued to drop.
    }
    activeUtterance = utterance;
    activeStop = reset;
    setPressed(button, true);
    synth.speak(utterance);
  });
  return wrap;
}
