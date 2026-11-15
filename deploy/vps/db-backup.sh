#!/usr/bin/env bash
# Nightly dump of the local recipes database, run by recipes-db-backup.timer
# as the postgres user. Keeps 14 days in /var/backups/recipes.
# Restore: sudo -u postgres pg_restore --clean --if-exists -d recipes <file>
set -euo pipefail
dir=/var/backups/recipes
out="$dir/recipes-$(date +%Y%m%d-%H%M).dump"
pg_dump --format=custom --file="$out.tmp" recipes
mv "$out.tmp" "$out"
chmod 640 "$out"
find "$dir" -name 'recipes-*.dump' -mtime +14 -delete
echo "Backed up $(du -h "$out" | cut -f1) to $out"
