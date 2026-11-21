#!/bin/bash
# Copyright 2026 ItsWempo
#
# This file is part of Wempo's Forum.
#
# Wempo's Forum is free software: you can redistribute it and/or modify it
# under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the
# GNU Affero General Public License along with this program.  If not,
# see <https://www.gnu.org/licenses/>
#
# fleet-cost-line — the CANARY WRITER for the fleet-watchdog cost-activity
# canary (code-review HIGH-1 fix, 2026-11-19: the watchdog gates on lines in
# THIS exact shape, so the shape needs a committed producer). Appends one
# machine-parsable line to .team/cost.log:
#
#   - <UTC-ts> · day=<YYYY-MM-DD> · deploys=<n> · lanes=<n> · suites=<n> · seats=<n> · src=<id>
#
# Callers: the FLEET TICK (session cron, at close — the single writer by
# contract) and the lead ritual. Args: deploys lanes suites seats src.
# Append-only; the line lands even when all counts are 0. This script writes
# NOTHING else and never reads; the watchdog only reads.
set -eu
cd "$(dirname "$0")/.." || exit 1
DEPLOYS="${1:-0}"
LANES="${2:-0}"
SUITES="${3:-0}"
SEATS="${4:-0}"
SRC="${5:-manual}"
case "$DEPLOYS$LANES$SUITES$SEATS" in *[!0-9]*) echo "non-numeric count" >&2; exit 2;; esac
case "$SRC" in *[\"\'\\|$]*) echo "unsafe src id" >&2; exit 2;; esac
printf -- '- %s · day=%s · deploys=%s · lanes=%s · suites=%s · seats=%s · src=%s\n' \
  "$(date -u +%FT%TZ)" "$(date -u +%F)" "$DEPLOYS" "$LANES" "$SUITES" "$SEATS" "$SRC" >> .team/cost.log
