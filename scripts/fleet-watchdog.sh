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
# Fleet watchdog — OS-level fleet tick that survives session close.
# Owner-approved 2026-11-19 ("set everything up" after lead offered the
# LaunchAgent). Read-only toward prod; appends .team/tick.log and writes
# .team/ALERT-<ts>.md + a macOS notification on failure. Never deploys,
# never writes D1, never pushes.
set -u
cd /Users/itswempo/wempos-forum || exit 1
STATE_DIR=".team"
LOG_FILE="$STATE_DIR/tick.log"
NOW="$(date -u +%FT%TZ)"

FORUM_VERSION="$(curl -s --max-time 20 https://wempos-forum.com/api/version)"
ACCOUNTS_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://accounts.wempos-forum.com/)"
# Anubis (Nov 22): the whole Anubis program runs on this Mac (Colima container
# on 127.0.0.1:8923) behind the com.wempo.anubis-tunnel LaunchAgent. Read-only
# probes: any HTTP status = alive (000 = down); the tunnel agent must be running.
# When either is down the Worker falls back to ALTCHA, so this is a warning,
# not an outage — but it means the whole-site gate is off.
ANUBIS_LOCAL="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8923/.within.website/x/cmd/anubis/api/check)"
ANUBIS_TUNNEL="$(launchctl print "gui/$(id -u)/com.wempo.anubis-tunnel" 2>/dev/null | awk '/^\tstate = /{print $3; exit}')"

alert=""
if [ "${ANUBIS_LOCAL:-000}" = "000" ]; then
  alert="${alert:+$alert; }Anubis container not answering on 127.0.0.1:8923 (site falls back to ALTCHA)"
fi
if [ "$ANUBIS_TUNNEL" != "running" ]; then
  alert="${alert:+$alert; }Anubis tunnel agent not running (state=${ANUBIS_TUNNEL:-missing})"
fi
if ! printf '%s' "$FORUM_VERSION" | grep -q '"commit"'; then
  alert="${alert:+$alert; }Forum version probe failed: ${FORUM_VERSION:-<empty>}"
fi
if [ "$ACCOUNTS_STATUS" != "200" ]; then
  alert="${alert:+$alert; }Accounts probe failed: HTTP ${ACCOUNTS_STATUS:-<none>}"
fi

printf '%s WATCHDOG forum=%s accounts=%s' "$NOW" "$FORUM_VERSION" "$ACCOUNTS_STATUS" >> "$LOG_FILE"
if [ -n "$alert" ]; then
  printf ' ALERT=%s\n' "$alert" >> "$LOG_FILE"
  # Re-seed state so a one-off stamp change does not loop-alert forever.
  ALERT_FILE="$STATE_DIR/ALERT-$(date -u +%Y%m%dT%H%M%SZ).md"
  printf '# Fleet watchdog alert %s\n\n%s\n\n- forum: %s\n- accounts: HTTP %s\n' "$NOW" "$alert" "$FORUM_VERSION" "$ACCOUNTS_STATUS" > "$ALERT_FILE"
  # ecc-security LOW rider (2026-11-19): the alert text may carry raw probe
  # bodies — quote/backslash characters never ride the AppleScript string.
  # shellcheck disable=SC1003  # '"\\' is the tr delete-set (quote + backslash), not an escaped quote
  SAFE_ALERT="$(printf '%s' "$alert" | tr -d '"\\')"
  osascript -e "display notification \"Fleet watchdog: $SAFE_ALERT\" with title \"Wempo's Forum fleet\"" >/dev/null 2>&1 &
else
  printf ' OK\n' >> "$LOG_FILE"
fi

# Cost-activity canary (cost-monitor rider, 2026-11-19): token spend is NOT
# CLI-observable — the owner alone reads the true number against the $1000
# ceiling from claude.ai. This guard correlates observable fleet motion
# (.team/cost.log lines in the machine-parsable shape that scripts/
# fleet-cost-line.sh writes — that script is the repo's CANARY WRITER; the
# FLEET TICK and the lead ritual are its callers) and flags a spike so the
# owner knows to go look; it never halts, never blocks, never writes
# cost.log. A spike fires when any of deploys/lanes/suites/seats exceeds
# max(prev 3) * 2 + 1 — the +1 floor stops the idle->first-activity 0->1
# crossing from crying wolf.
COST_LOG="$STATE_DIR/cost.log"
TODAY="$(date -u +%F)"
if [ -f "$COST_LOG" ]; then
  # Only conforming lines (day= <date> + numeric metrics) count; the prose
  # history is inert and the line shape is pinned by scripts/fleet-cost-line.sh.
  TODAY_LINES()(
    grep 'day=' "$COST_LOG" | grep "day=$TODAY" | grep -E "deploys=[0-9]+.*lanes=[0-9]+.*suites=[0-9]+"
  )
  LINES_TODAY="$(TODAY_LINES | wc -l | tr -d ' ')"
  if [ "$LINES_TODAY" -ge 4 ]; then
    spike_alert=""
    for METRIC in deploys lanes suites seats; do
      EXPR="s/^\(.*[[:space:]]\)\{0,1\}${METRIC}=\([0-9]*\).*/\2/p"
      C="$(TODAY_LINES | tail -1 | sed -n "$EXPR")"
      [ -n "$C" ] || continue
      P_MAX=0
      # newline-preserving loop over the previous 3 lines (a for-loop word-
      # splits and a tr-collapse makes sed's greedy .* read only the LAST
      # prev line — the code-review fix)
      PREV_LINES="$(TODAY_LINES | tail -n 4 | head -n 3)"
      while IFS= read -r PREV_LINE; do
        [ -n "$PREV_LINE" ] || continue
        P="$(printf '%s\n' "$PREV_LINE" | sed -n "$EXPR")"
        [ -n "$P" ] && [ "$P" -gt "$P_MAX" ] && P_MAX="$P"
      done <<EOF
$PREV_LINES
EOF
      THRESHOLD=$(( P_MAX * 2 + 1 ))
      if [ "$C" -ge "$THRESHOLD" ] && [ "$C" -gt 1 ]; then
        spike_alert="COST-ACTIVITY-SPIKE: $METRIC=$C vs last-3 max=$P_MAX"
        break
      fi
    done
    if [ -n "$spike_alert" ]; then
      SPIKE_ALERT_FILE="$STATE_DIR/ALERT-$(date -u +%Y%m%dT%H%M%SZ)-cost.md"
      # shellcheck disable=SC2016  # "$1000" is literal prose (the budget ceiling), not an expansion
      printf '# Fleet watchdog cost-activity spike %s\n\n%s\n\n(a canary, not a dollar meter: token spend is not CLI-observable — the owner reads the true number on claude.ai against the $1000 ceiling)\n' "$NOW" "$spike_alert" > "$SPIKE_ALERT_FILE"
      osascript -e "display notification \"Fleet watchdog: $spike_alert\" with title \"Wempo's Forum fleet\"" >/dev/null 2>&1 &
    fi
  fi
fi
exit 0
