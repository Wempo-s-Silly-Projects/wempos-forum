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

// Batch F: the two-factor enrolment QR. The otpauth URI (which carries the
// secret) is encoded right here in the browser by the vendored
// qrcode-generator and drawn as an inline SVG built node by node — no image
// URL, no third-party QR service, so the secret never leaves the page.
import qrcode from "./vendor/qrcode-generator/qrcode.mjs";
import { t } from "./i18n.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const QUIET_ZONE = 4;

// The module matrix (true = dark) for a URI, auto-sized at error level M.
export function qrMatrix(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}

// One <path> of unit squares inside a quiet-zone-padded viewBox; it scales
// crisply with CSS. role="img" + aria-label name it for screen readers, and
// the secret stays available as copyable text beside it.
export function otpauthQrSvg(document, uri) {
  const matrix = qrMatrix(uri);
  const extent = matrix.length + QUIET_ZONE * 2;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + extent + " " + extent);
  svg.setAttribute("class", "totp-qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("security.qrLabel"));
  const background = document.createElementNS(SVG_NS, "rect");
  background.setAttribute("width", String(extent));
  background.setAttribute("height", String(extent));
  background.setAttribute("fill", "#fff");
  svg.append(background);
  let d = "";
  matrix.forEach((cells, row) => cells.forEach((dark, col) => {
    if (dark) d += "M" + (col + QUIET_ZONE) + " " + (row + QUIET_ZONE) + "h1v1h-1z";
  }));
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  svg.append(path);
  return svg;
}
