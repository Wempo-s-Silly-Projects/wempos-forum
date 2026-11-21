#!/bin/bash
# One-shot: apply pending GC D1 migrations to the REMOTE shared database.
# Usage: ~/wempos-forum/apply-remote.sh
set -euo pipefail
cd "$(dirname "$0")"
exec npx wrangler d1 migrations apply wempo-forum-data --remote "$@"
