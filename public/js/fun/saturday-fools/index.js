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

// Saturday Fools gag index (docs/saturday-fools.md). One import line and one
// list entry per dated gag, each tagged "saturday-fools:<date>". A gag lives
// for exactly one local Saturday and is stripped the next day: delete its
// module, BOTH of its tagged lines here, its styles.css block, its
// fools.<date>.* keys and its test. With zero gags the list is empty and the
// framework does nothing.
import gag20261128 from "./2026-11-28-yell.js"; // saturday-fools:2026-11-28

export const GAGS = Object.freeze([
  gag20261128, // saturday-fools:2026-11-28
]);
