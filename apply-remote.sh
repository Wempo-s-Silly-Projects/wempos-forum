#!/bin/bash
# One-shot: apply pending D1 migrations to the REMOTE shared database.
# Usage: ~/wempos-forum/apply-remote.sh
# Self-hosted copies: D1_DATABASE=<your database_name> ./apply-remote.sh
set -euo pipefail
cd "$(dirname "$0")"
exec pnpm exec wrangler d1 migrations apply "${D1_DATABASE:-wempo-forum-data}" --remote "$@"
