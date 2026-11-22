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

// Batch I item 3: deterministic fallback avatars. A member with no uploaded
// avatar gets a minidenticons (MIT, vendored verbatim) 5x5 symmetric glyph
// derived from the username alone: no network, no stored image, the same
// picture on every device. It rides as a data: URL on a plain <img> (img-src
// allows data:), so no SVG markup is ever parsed into the page.
import { minidenticon } from "./vendor/minidenticons.js";

const IDENTICON_SATURATION = 55;
const IDENTICON_LIGHTNESS = 45;
const SVG_DATA_PREFIX = "data:image/svg+xml;charset=utf-8,";

export function identiconSvg(username) {
  return minidenticon(String(username ?? ""), IDENTICON_SATURATION, IDENTICON_LIGHTNESS);
}

export function identiconDataUrl(username) {
  return SVG_DATA_PREFIX + encodeURIComponent(identiconSvg(username));
}

// The uploaded avatar when there is one, otherwise the identicon.
export function avatarSource(avatarUrl, username) {
  return typeof avatarUrl === "string" && avatarUrl ? avatarUrl : identiconDataUrl(username);
}
