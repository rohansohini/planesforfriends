#!/usr/bin/env bash
# Update the running site to the latest code.
#
#   cd ~/planesforfriends && bash deploy/update.sh
#
# Takes a backup first, fetches the new code, reinstalls it and restarts.
# Your reservations, tach readings, settings and admin password are untouched:
# they live in /var/lib/planesforfriends, which this never writes to.

set -euo pipefail

APP_DIR=/opt/planesforfriends
DATA_DIR=/var/lib/planesforfriends
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$SRC_DIR/server.js" ]; then
  echo "Run this from inside the project folder: cd ~/planesforfriends && bash deploy/update.sh" >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this WITHOUT sudo — it asks for your password only when it needs to." >&2
  exit 1
fi

echo "==> Backing up the database first"
if [ -f "$DATA_DIR/planesforfriends.db" ]; then
  sudo -u pff env PFF_DATA_DIR="$DATA_DIR" /usr/bin/node "$APP_DIR/scripts/backup.js"
else
  echo "    no database yet — nothing to back up"
fi

echo "==> Fetching the latest code"
if [ -d "$SRC_DIR/.git" ]; then
  git -C "$SRC_DIR" pull --ff-only
else
  echo "    not a git checkout, using the files already here"
fi

# Reuse whatever hostname Caddy is already serving, so HTTPS keeps working
# without anyone having to remember it.
DOMAIN="${1:-}"
if [ -z "$DOMAIN" ] && [ -f /etc/caddy/Caddyfile ]; then
  DOMAIN="$(awk '/^[a-zA-Z0-9.-]+ *\{/ {gsub(/ *\{/, "", $1); print $1; exit}' /etc/caddy/Caddyfile)"
  [ -n "$DOMAIN" ] && echo "==> Keeping the current address: $DOMAIN"
fi

echo "==> Installing"
sudo bash "$SRC_DIR/deploy/install.sh" $DOMAIN

echo "==> Checking the site answers"
sleep 2
if curl -fsS --max-time 10 http://127.0.0.1:3000/healthz >/dev/null; then
  echo "    OK — the site is running."
  if [ -n "$DOMAIN" ]; then echo "    https://$DOMAIN"; fi
else
  echo "    The site is not answering. Look at what it says with:" >&2
  echo "      sudo systemctl status planesforfriends" >&2
  echo "      sudo journalctl -u planesforfriends -n 40" >&2
  echo "    Your data is still safe in $DATA_DIR, and tonight's backup is in $DATA_DIR/backups." >&2
  exit 1
fi
