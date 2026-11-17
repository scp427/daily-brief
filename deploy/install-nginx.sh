#!/usr/bin/env bash
# Publish daily_reports/ to /www/daily-brief and enable the :8180 nginx site.
# Run as root:
#
#   sudo DAILY_BRIEF_USER=<user> bash deploy/install-nginx.sh
#
# DAILY_BRIEF_USER defaults to $SUDO_USER.
set -euo pipefail

USER_NAME="${DAILY_BRIEF_USER:-${SUDO_USER:-}}"
if [ -z "$USER_NAME" ]; then
  echo "usage: sudo DAILY_BRIEF_USER=<user> bash deploy/install-nginx.sh" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SITE_DIR=/www/daily-brief

mkdir -p "$SITE_DIR"
chown "$USER_NAME:www-data" "$SITE_DIR"
chmod 755 "$SITE_DIR"
SITE_DIR="$SITE_DIR" sh "$APP_DIR/deploy/publish.sh"

install -m 644 "$APP_DIR/deploy/nginx-daily-brief.conf" /etc/nginx/sites-available/daily-brief.conf
ln -sfn /etc/nginx/sites-available/daily-brief.conf /etc/nginx/sites-enabled/daily-brief.conf
nginx -t
systemctl reload nginx

echo "--- smoke test"
curl -sI http://127.0.0.1:8180/ | head -3
