#!/usr/bin/env bash
# Starts the local development stack. Idempotent: anything already running is left alone.
#   colima          Docker runtime for Supabase (not Docker Desktop, see tests/e2e/README.md)
#   supabase        local Auth on 127.0.0.1:54321 (its own Postgres on :54322 holds nothing of ours)
#   postgresql@16   system Postgres on :5432, holds bd_contact_intel_dev
set -euo pipefail
cd "$(dirname "$0")/.."

colima status >/dev/null 2>&1 || colima start
supabase status >/dev/null 2>&1 || supabase start
pg_isready -h localhost -p 5432 >/dev/null 2>&1 || brew services start postgresql@16
for _ in $(seq 1 20); do pg_isready -h localhost -p 5432 >/dev/null 2>&1 && break; sleep 1; done
pg_isready -h localhost -p 5432
echo "[dev-stack] ready. Next: npm run dev:setup (first time / idempotent), then npm run dev"
