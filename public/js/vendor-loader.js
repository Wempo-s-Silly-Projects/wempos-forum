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

// Lazy same-origin loading for the vendored browser libraries (Batch C).
// Each script or stylesheet is requested at most once per document, built
// with createElement (never markup), and only when a rendered body needs it.
// The load promise is kept, success or failure: a failure is not retried and
// the caller keeps its plain-text fallback. A document without a head (tests,
// workers) rejects at once, which every caller treats as "stay plain".

const loads = new WeakMap();

function remember(document, key, start) {
  if (!document || typeof document !== "object") return Promise.reject(new Error("document"));
  if (!loads.has(document)) loads.set(document, new Map());
  const cache = loads.get(document);
  if (!cache.has(key)) cache.set(key, start());
  return cache.get(key);
}

function appendToHead(document, element) {
  return new Promise((resolve, reject) => {
    if (typeof document?.head?.append !== "function") {
      reject(new Error("head"));
      return;
    }
    element.addEventListener("load", () => resolve(), { once: true });
    element.addEventListener("error", () => reject(new Error("load")), { once: true });
    document.head.append(element);
  });
}

// A classic script; resolves with readGlobal() once it has run.
export function loadScriptOnce(document, src, readGlobal) {
  return remember(document, "script:" + src, () => {
    const script = document.createElement("script");
    script.setAttribute("src", src);
    return appendToHead(document, script);
  }).then(() => {
    const value = readGlobal();
    if (!value) throw new Error(src);
    return value;
  });
}

// A same-origin stylesheet (style-src 'self' allows it).
export function loadStylesheetOnce(document, href) {
  return remember(document, "style:" + href, () => {
    const link = document.createElement("link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", href);
    return appendToHead(document, link);
  });
}

// An ES module with no imports of its own (ansi_up), once per document.
export function importModuleOnce(document, src, importer = (path) => import(path)) {
  return remember(document, "module:" + src, () => {
    if (typeof document?.head?.append !== "function") return Promise.reject(new Error("head"));
    return importer(src);
  });
}
