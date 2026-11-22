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

// Batch F: a password-strength meter on new-password fields, estimated by
// the vendored zxcvbn-ts (MIT; dictionaries: common + English). Advisory
// only — it adds no rule beyond the existing minimum — and it runs entirely
// in the page: the password is never sent, logged, or stored. The ~1.8 MB of
// bundles load lazily (same-origin classic scripts, CSP 'self') the first
// time someone types into a watched field.
import { t } from "./i18n.js";

export const ZXCVBN_SCRIPTS = Object.freeze([
  "/js/vendor/zxcvbn-ts/core.js",
  "/js/vendor/zxcvbn-ts/language-common.js",
  "/js/vendor/zxcvbn-ts/language-en.js",
]);

const TYPING_PAUSE_MS = 200;
const factories = new WeakMap();
let loading = null;

function factoryFor(globals) {
  let factory = factories.get(globals);
  if (!factory) {
    const common = globals["language-common"];
    const english = globals["language-en"];
    factory = new globals.core.ZxcvbnFactory({
      translations: english.translations,
      graphs: common.adjacencyGraphs,
      dictionary: { ...common.dictionary, ...english.dictionary },
    });
    factories.set(globals, factory);
  }
  return factory;
}

// 0 (too guessable) … 4 (very unguessable); empty is 0.
export function scorePassword(globals, password) {
  if (!password) return 0;
  return factoryFor(globals).check(password).score;
}

// Injects the three bundles in order, once per page.
function loadZxcvbn(document) {
  if (!loading) {
    loading = ZXCVBN_SCRIPTS.reduce((previous, src) => previous.then(() => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(src));
      document.head.append(script);
    })), Promise.resolve()).then(() => globalThis.zxcvbnts);
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export function attachStrengthMeter(document, input) {
  const wrapper = document.createElement("div");
  wrapper.className = "strength-meter";
  const meter = document.createElement("meter");
  meter.min = 0;
  meter.max = 4;
  meter.low = 2;
  meter.high = 3;
  meter.optimum = 4;
  meter.value = 0;
  meter.setAttribute("aria-label", t("security.strengthLabel"));
  const verdict = document.createElement("span");
  verdict.className = "strength-verdict";
  verdict.setAttribute("aria-live", "polite");
  wrapper.append(meter, verdict);
  (input.closest("label") ?? input).after(wrapper);
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const password = input.value;
      if (!password) {
        meter.value = 0;
        verdict.textContent = "";
        return;
      }
      try {
        const score = scorePassword(await loadZxcvbn(document), password);
        if (input.value !== password) return;
        meter.value = score;
        verdict.textContent = t("security.strength" + score);
      } catch {
        verdict.textContent = "";
      }
    }, TYPING_PAUSE_MS);
  });
  return wrapper;
}
