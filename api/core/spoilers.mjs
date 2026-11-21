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

// Server-side spoiler masking (wave 2026-11-21-17). The worker imports the
// client's own mask so every output path — MCP tools, markdown renderings,
// feed snippets, notification previews, the public archive — hides exactly
// what the post page renders hidden. Mask only at OUTPUT; stored text is
// never changed.
export { maskSpoilers, maskedExcerpt } from "../../public/js/markdown.js";
