#!/usr/bin/env bash
# One-time move of recipes' data from Supabase into Postgres on this VPS.
# Run as root once Postgres is installed (see deploy/vps/POSTGRES.md):
#
#   SOURCE_URL='postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres' \
#     bash deploy/vps/migrate-from-supabase.sh
#
# What it does:
#   1. dumps Supabase's public schema (tables and data) to
#      /var/backups/recipes/supabase-<date>.dump, which it keeps;
#   2. recreates the local `recipes` database from that dump, skipping
#      Supabase-only pieces (grants to anon/authenticated, RLS policies);
#   3. compares row counts table by table and stops if any differ.
# It never writes to Supabase. Rerunning replaces the local copy with a fresh one.
set -euo pipefail

: "${SOURCE_URL:?Set SOURCE_URL to the Supabase session pooler connection string}"
DB=recipes
BACKUPS=/var/backups/recipes
install -d -m 750 -o postgres -g postgres "$BACKUPS"
dump="$BACKUPS/supabase-$(date +%Y%m%d-%H%M%S).dump"
psql_local() { sudo -u postgres psql -X -v ON_ERROR_STOP=1 -qAt "$@"; }

echo "1/3 Dumping Supabase (public schema only) ..."
pg_dump --format=custom --schema=public --no-owner --no-privileges --file="$dump" "$SOURCE_URL"
chown postgres:postgres "$dump"; chmod 640 "$dump"
echo "    saved $dump ($(du -h "$dump" | cut -f1))"

echo "2/3 Rebuilding the local '$DB' database ..."
systemctl stop recipes 2>/dev/null || true
psql_local -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB OWNER $DB"
# Tables come from the dump; start from an empty public schema owned by the app.
psql_local -d "$DB" -c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public AUTHORIZATION $DB"
list=$(mktemp); chmod 644 "$list"   # pg_restore runs as postgres
# Policies name Supabase roles (anon, authenticated) that don't exist here;
# the app's own role owns the tables, so it never needed them.
pg_restore --list "$dump" | grep -vE ' (POLICY|SCHEMA - public|COMMENT - SCHEMA public) ' > "$list"
sudo -u postgres pg_restore --dbname="$DB" --role="$DB" --no-owner --no-privileges \
  --exit-on-error --single-transaction --use-list="$list" "$dump"
rm -f "$list"

echo "3/3 Checking row counts ..."
tables=$(psql_local -d "$DB" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
bad=0
for t in $tables; do
  src=$(psql -X -qAt "$SOURCE_URL" -c "SELECT count(*) FROM public.\"$t\"")
  dst=$(psql_local -d "$DB" -c "SELECT count(*) FROM public.\"$t\"")
  printf '    %-24s supabase %8s   vps %8s  %s\n' "$t" "$src" "$dst" "$([ "$src" = "$dst" ] && echo ok || echo MISMATCH)"
  [ "$src" = "$dst" ] || bad=1
done
[ "$bad" = 0 ] || { echo "Row counts differ; not switching. The Supabase copy is untouched."; exit 1; }
echo "All tables match. Point DATABASE_URL at the local database and restart (see POSTGRES.md)."
