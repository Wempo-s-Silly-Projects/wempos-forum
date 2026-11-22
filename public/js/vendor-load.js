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

// Batch J: lazy loading for the vendored classic (UMD) scripts under
// /js/vendor/. Each script is added once per page, same-origin, built with
// createElement (so the CSP stays 'self'); the promise is kept, success or
// failure, so a missing file is fetched once and never retried.
const loads = new Map();

function appendScript(document, src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.setAttribute("src", src);
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(src)), { once: true });
    document.head.append(script);
  });
}

// Loads every src in order (a later one may read a global an earlier one
// set), then resolves with read(): the library global the caller wants.
export function loadVendorScripts(document, sources, read) {
  const key = sources.join(" ");
  if (!loads.has(key)) {
    const chain = sources.reduce((previous, src) => previous.then(() => appendScript(document, src)), Promise.resolve());
    loads.set(key, chain);
  }
  return loads.get(key).then(() => {
    const library = read();
    if (!library) throw new Error("vendor global missing: " + key); // i18n-ignore
    return library;
  });
}
