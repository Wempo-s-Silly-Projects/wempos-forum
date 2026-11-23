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

// Cookie parse + serialize (L3): cookie-es replaces the hand-rolled
// split(";") reader and the string-glued Set-Cookie values. cookie-es keeps
// the FIRST of duplicate names (same as the old loop), returns a
// null-prototype map (no __proto__/constructor lookups), and refuses values
// that are not valid cookie octets when serializing.
import { parse, serialize } from "cookie-es";

// cookieValue(request, name) -> the named cookie's value, or null.
export function cookieValue(request, name) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const jar = parse(header);
  return Object.hasOwn(jar, name) ? jar[name] : null;
}

// sessionCookie(name, value, maxAge) -> one Set-Cookie value with the
// session attribute set: Path=/, HttpOnly, SameSite=Lax, Secure, Max-Age, and
// never Domain (the __Host- prefix contract). maxAge 0 clears the cookie.
export function sessionCookie(name, value, maxAge) {
  return serialize(name, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge,
    // Identity encode: tokens are base64url already, and cookie-es then
    // validates the raw value (a ";" or space throws instead of being
    // percent-encoded into a cookie the reader would not recognise).
    encode: (raw) => raw,
  });
}
