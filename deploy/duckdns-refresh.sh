#!/usr/bin/env bash
# Keep the DuckDNS record fresh and correct, forever, without thinking about it.
#
#   sudo bash deploy/duckdns-refresh.sh rent-planes <your-duckdns-token>
#
# Installs a weekly job that tells DuckDNS "this name still points at this
# machine". Two things it protects against:
#
#   1. the address changing — if the machine is ever rebuilt without the same
#      reserved IP, the record follows it instead of pointing at nothing;
#   2. any inactivity rule DuckDNS may apply to names nobody ever updates.
#
# Your token is on the duckdns.org page after you sign in. It is stored root-only.

set -euo pipefail

NAME="${1:-}"
TOKEN="${2:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

if [ -z "$NAME" ] || [ -z "$TOKEN" ]; then
  echo "Usage: sudo bash deploy/duckdns-refresh.sh <name> <token>" >&2
  echo "  <name> is just the first part: for rent-planes.duckdns.org, use rent-planes" >&2
  exit 1
fi

NAME="${NAME%%.duckdns.org}"
CONF=/etc/planesforfriends-duckdns.conf
printf 'DUCKDNS_NAME=%s\nDUCKDNS_TOKEN=%s\n' "$NAME" "$TOKEN" > "$CONF"
chmod 600 "$CONF"

cat > /usr/local/bin/planesforfriends-duckdns <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
. /etc/planesforfriends-duckdns.conf
# Empty ip= tells DuckDNS to use the address this request came from.
response="$(curl -fsS --max-time 20 \
  "https://www.duckdns.org/update?domains=${DUCKDNS_NAME}&token=${DUCKDNS_TOKEN}&ip=" || echo FAILED)"
logger -t planesforfriends-duckdns "duckdns update: ${response}"
[ "$response" = "OK" ]
SCRIPT
chmod 755 /usr/local/bin/planesforfriends-duckdns

echo "==> Testing it now"
if /usr/local/bin/planesforfriends-duckdns; then
  echo "    DuckDNS accepted the update."
else
  echo "    DuckDNS refused it — check the name and token, then run this again." >&2
  exit 1
fi

# Weekly, at a quiet hour, on a day derived from the name so not everyone
# using this guide hits DuckDNS at the same minute.
DAY=$(( $(printf '%s' "$NAME" | cksum | cut -d' ' -f1) % 7 ))
printf '17 4 * * %s root /usr/local/bin/planesforfriends-duckdns >/dev/null 2>&1\n' "$DAY" \
  > /etc/cron.d/planesforfriends-duckdns

echo "==> Done. The record now refreshes itself weekly."
echo "    Check on it any time with: journalctl -t planesforfriends-duckdns"
