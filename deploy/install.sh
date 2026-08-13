#!/usr/bin/env bash
# One-shot setup for Planes for Friends on a fresh Ubuntu or Debian machine.
# Works on any free always-free VM (Oracle Cloud, Google Cloud e2-micro) or a
# Raspberry Pi at home.
#
#   sudo bash deploy/install.sh rent-planes.duckdns.org
#   sudo bash deploy/install.sh                 # no domain yet: HTTP on port 3000 only
#
# Safe to re-run: it updates the code and restarts, leaving the database alone.

set -euo pipefail

DOMAIN="${1:-}"
REPO="${PFF_REPO:-https://github.com/rohansohini/planesforfriends}"
APP_DIR=/opt/planesforfriends
DATA_DIR=/var/lib/planesforfriends

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

echo "==> Installing Node 22 (the built-in SQLite this app uses needs 22.5+)"
# Distro packages still ship Node 18/20, which would fail at startup.
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg git
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node --version

echo "==> Installing the app files"
# Prefer the copy this script came from — that works whether it arrived by git
# clone or as a downloaded ZIP, and needs no GitHub access at all.
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$SRC_DIR/server.js" ] && [ "$SRC_DIR" != "$APP_DIR" ]; then
  echo "    from $SRC_DIR"
  mkdir -p "$APP_DIR"
  # Skip data/ and .git — the live database lives in $DATA_DIR, and a stray copy
  # of somebody's renter list has no business sitting in the app directory.
  tar -C "$SRC_DIR" --exclude=./data --exclude=./.git -cf - . | tar -C "$APP_DIR" -xf -
elif [ -d "$APP_DIR/.git" ]; then
  echo "    updating the existing checkout"
  git -C "$APP_DIR" pull --ff-only
elif [ ! -f "$APP_DIR/server.js" ]; then
  echo "    cloning $REPO"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi

if [ ! -f "$APP_DIR/server.js" ]; then
  echo "Could not find the app files in $APP_DIR." >&2
  echo "Run this script from inside the downloaded project folder." >&2
  exit 1
fi

echo "==> Creating the service user and data directory"
id -u pff >/dev/null 2>&1 || useradd --system --shell /usr/sbin/nologin --home "$DATA_DIR" pff
mkdir -p "$DATA_DIR"
chown -R pff:pff "$DATA_DIR"

echo "==> Installing the systemd service"
install -m 644 "$APP_DIR/deploy/planesforfriends.service" /etc/systemd/system/planesforfriends.service
systemctl daemon-reload
systemctl enable --now planesforfriends
systemctl restart planesforfriends

echo "==> Scheduling a nightly backup"
cat > /etc/cron.d/planesforfriends-backup <<CRON
15 3 * * * pff cd $APP_DIR && PFF_DATA_DIR=$DATA_DIR /usr/bin/node scripts/backup.js >/dev/null 2>&1
CRON

open_web_ports() {
  # Oracle's Ubuntu images ship an iptables rule that rejects everything except
  # SSH. It is the single most common reason a new site is unreachable, so open
  # 80 and 443 here rather than leaving it as a puzzle.
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
  fi
  if command -v iptables >/dev/null 2>&1; then
    for port in 80 443; do
      iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
        iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT 2>/dev/null || true
    done
    if command -v netfilter-persistent >/dev/null 2>&1; then
      netfilter-persistent save >/dev/null 2>&1 || true
    elif [ -d /etc/iptables ]; then
      iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
    fi
  fi
}

if [ -n "$DOMAIN" ]; then
  echo "==> Opening ports 80 and 443 on the machine"
  open_web_ports
  echo "==> Setting up HTTPS for $DOMAIN with Caddy"
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
      gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy
  fi
  printf '%s {\n\treverse_proxy 127.0.0.1:3000\n\tencode gzip\n}\n' "$DOMAIN" > /etc/caddy/Caddyfile
  systemctl restart caddy
  URL="https://$DOMAIN"
else
  URL="http://$(hostname -I | awk '{print $1}'):3000"
  echo "==> No domain given, so there is no HTTPS yet. Re-run with a hostname when you have one."
fi

sleep 2
echo
echo "======================================================================"
echo " Planes for Friends is running at: $URL"
echo
if journalctl -u planesforfriends --no-pager | grep -q 'Admin password'; then
  echo " Admin password (shown once, at first start):"
  journalctl -u planesforfriends --no-pager | grep -A6 'Admin password for this new database' | tail -6
else
  echo " Admin password: unchanged from your existing database."
fi
echo
echo " Next: open $URL/admin, then set the phone numbers under Settings."
echo "======================================================================"
