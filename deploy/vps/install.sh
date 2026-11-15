#!/usr/bin/env bash
# One-time setup for this app on the VPS. Run as root after the repo is
# cloned to /var/www/<name> (see the runbook). Safe to run again: it only
# adds what's missing and refreshes the service and nginx files.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/app.conf"
APP=/var/www/$NAME

id "$NAME" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/var/lib/$NAME" --shell /usr/sbin/nologin "$NAME"
chown -R "$NAME:$NAME" "$APP"

# The deploy job may restart its own service and nothing else.
echo "$NAME ALL=(root) NOPASSWD: /usr/bin/systemctl restart $NAME" > "/etc/sudoers.d/$NAME"
chmod 440 "/etc/sudoers.d/$NAME"
visudo -cf "/etc/sudoers.d/$NAME" >/dev/null

# Secrets: created from the example once, never overwritten.
if [ ! -f "/etc/$NAME.env" ]; then
  install -m 640 -o root -g "$NAME" "$HERE/$NAME.env.example" "/etc/$NAME.env"
  echo "Created /etc/$NAME.env. Fill it in before the first deploy."
fi

cp "$HERE/$NAME.service" "$HERE/$NAME-deploy.service" "$HERE/$NAME-deploy.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$NAME" >/dev/null 2>&1

# Copied once: certbot later adds HTTPS to this file, and a re-run must keep it.
[ -f "/etc/nginx/sites-available/$NAME" ] || cp "$HERE/nginx.conf" "/etc/nginx/sites-available/$NAME"
if [ ! -e "/etc/nginx/sites-enabled/$NAME" ]; then
  ln -s "/etc/nginx/sites-available/$NAME" "/etc/nginx/sites-enabled/$NAME"
fi
nginx -t && systemctl reload nginx
echo "$NAME installed. Next: fill /etc/$NAME.env, then"
echo "  systemctl start $NAME-deploy && systemctl enable --now $NAME-deploy.timer"
