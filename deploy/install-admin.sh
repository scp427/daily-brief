#!/usr/bin/env bash
# Render deploy/daily-brief-admin.service.in for the deploy user, install the
# unit, and verify the loopback endpoint. Run as root:
#
#   sudo DAILY_BRIEF_USER=<user> bash deploy/install-admin.sh
#
# DAILY_BRIEF_USER defaults to $SUDO_USER, so running it through sudo needs no
# extra flag. The unit's User/WorkingDirectory/PATH come from that account.
set -euo pipefail

USER_NAME="${DAILY_BRIEF_USER:-${SUDO_USER:-}}"
if [ -z "$USER_NAME" ]; then
  echo "usage: sudo DAILY_BRIEF_USER=<user> bash deploy/install-admin.sh" >&2
  exit 1
fi

HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
if [ -z "$HOME_DIR" ]; then
  echo "unknown user: $USER_NAME" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT=daily-brief-admin.service
RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT

sed -e "s|@USER@|$USER_NAME|g" \
    -e "s|@HOME@|$HOME_DIR|g" \
    -e "s|@APP@|$APP_DIR|g" \
    "$APP_DIR/deploy/$UNIT.in" > "$RENDERED"

install -m 644 "$RENDERED" "/etc/systemd/system/$UNIT"
systemctl daemon-reload
systemctl enable --now "$UNIT"
systemctl restart "$UNIT"

sleep 2
systemctl --no-pager --lines=5 status "$UNIT" | head -8 || true
curl -fsS -m 5 http://127.0.0.1:8183/api/health
echo
TOKEN_FILE="$HOME_DIR/.daily-brief-admin-token"
if [ -f "$TOKEN_FILE" ]; then
  echo "token file: $TOKEN_FILE"
else
  echo "token file not created yet: $TOKEN_FILE (the service writes it on first start)"
fi
