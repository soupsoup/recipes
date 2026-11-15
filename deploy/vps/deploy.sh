#!/usr/bin/env bash
# Publishes the newest commit on main to the VPS. The same script ships in
# every app's deploy/vps/; app.conf beside it holds what differs per app.
#
# <app>-deploy.timer runs it every minute. When main hasn't moved it exits
# after one `git fetch`. When it has:
#   - apps without a build step update in place, reinstall packages if the
#     lockfile changed, and restart;
#   - apps with build_release() build a new release beside the running one,
#     switch `.releases/current` to it and restart. A failed build leaves the
#     running release alone.
#
#   deploy.sh                    deploy if main changed
#   deploy.sh --force            redeploy even if it didn't
#   deploy.sh --rollback <sha>   go back to an older commit or release
#                                (holds until the next commit lands; stop the
#                                timer first to stay there)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH=main
KEEP=5
SERVICE=""
# shellcheck source=/dev/null
source "$HERE/app.conf"
APP="${VPS_APP_DIR:-/var/www/$NAME}"
SERVICE="${SERVICE:-$NAME}"

cd "$APP"
exec 9>"$APP/.deploy.lock"
flock -n 9 || exit 0   # a deploy is already running

restart() { sudo /usr/bin/systemctl restart "$SERVICE"; }
has_build() { declare -F build_release >/dev/null; }
deployed() { cat "$APP/.deployed-sha" 2>/dev/null || true; }

install_packages() {   # $1 = lockfile blob before the update ("" forces)
  [ -f package-lock.json ] || return 0
  if [ "$1" != "$(git rev-parse HEAD:package-lock.json)" ] || [ ! -d node_modules ]; then
    npm ci --no-audit --no-fund --loglevel=error
  fi
}

publish() {   # $1 = commit sha, already checked out
  local sha=$1 start; start=$(date +%s)
  if has_build; then
    local out=".releases/$sha"
    if [ ! -d "$out" ]; then
      mkdir -p .releases
      if ! build_release "$out" >/tmp/"$NAME"-build.log 2>&1; then
        echo "Build failed for $sha; still serving $(deployed). Log: /tmp/$NAME-build.log"
        tail -20 /tmp/"$NAME"-build.log
        rm -rf "$out"
        exit 1
      fi
    fi
    ln -sfn "$sha" .releases/current.tmp && mv -T .releases/current.tmp .releases/current
  fi
  echo "$sha" > "$APP/.deployed-sha"
  restart
  echo "Deployed $(git log -1 --format='%h %s' "$sha") in $(( $(date +%s) - start ))s"
}

if [ "${1:-}" = "--rollback" ]; then
  sha="${2:?usage: deploy.sh --rollback <sha>}"
  if has_build && [ -d ".releases/$sha" ]; then
    ln -sfn "$sha" .releases/current.tmp && mv -T .releases/current.tmp .releases/current
    echo "$sha" > "$APP/.deployed-sha"; restart; echo "Rolled back to $sha"; exit 0
  fi
  git fetch --quiet --depth 1 origin "$sha"
  old_lock=$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)
  git reset --quiet --hard FETCH_HEAD
  install_packages "$old_lock"
  publish "$(git rev-parse HEAD)"
  exit 0
fi

git fetch --quiet --depth 1 origin "$BRANCH"
new=$(git rev-parse FETCH_HEAD)
if [ "$new" = "$(deployed)" ] && [ "${1:-}" != "--force" ]; then exit 0; fi

old_lock=$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)
git reset --quiet --hard FETCH_HEAD
install_packages "$old_lock"
[ "${1:-}" = "--force" ] && has_build && rm -rf ".releases/$new"
publish "$new"

# Keep the newest $KEEP releases. `|| true`: grep exits 1 when there's
# nothing to prune, which pipefail would turn into a failed run.
if has_build; then
  { ls -1t .releases | grep -vx -e current -e "$new" || true; } | tail -n +"$KEEP" | while read -r old; do
    rm -rf ".releases/$old"
  done
fi
exit 0
