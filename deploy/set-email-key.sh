#!/usr/bin/env bash
# Store the email provider's API key on this machine so the site can send
# notifications. The key goes in /etc/planesforfriends.env, readable only by
# root — never in the repo, never in the database, never in a backup.
#
#   sudo bash deploy/set-email-key.sh brevo xkeysib-xxxxxxxx
#   sudo bash deploy/set-email-key.sh resend re_xxxxxxxx
#   sudo bash deploy/set-email-key.sh --off          (stop sending email)
#
# Then put the "from" address in the admin console under Settings. It has to be
# an address the provider has verified, or they will refuse to send it.

set -euo pipefail

ENV_FILE=/etc/planesforfriends.env

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo." >&2
  exit 1
fi

if [ "${1:-}" = "--off" ]; then
  rm -f "$ENV_FILE"
  systemctl restart planesforfriends
  echo "Email sending is off. The site is running as before."
  exit 0
fi

PROVIDER="${1:-}"
KEY="${2:-}"

if [ -z "$PROVIDER" ] || [ -z "$KEY" ]; then
  echo "Usage: sudo bash deploy/set-email-key.sh <brevo|resend> <api-key>" >&2
  echo "       sudo bash deploy/set-email-key.sh --off" >&2
  exit 1
fi

case "$PROVIDER" in
  brevo|resend|console) ;;
  *)
    echo "Unknown provider '$PROVIDER'. Use brevo or resend." >&2
    exit 1
    ;;
esac

# Written in one go with tight permissions, so the key is never briefly
# world-readable on disk.
umask 177
cat > "$ENV_FILE" <<ENV
PFF_MAIL_PROVIDER=$PROVIDER
PFF_MAIL_KEY=$KEY
ENV
chown root:root "$ENV_FILE"
chmod 600 "$ENV_FILE"

systemctl restart planesforfriends
sleep 2

if curl -fsS --max-time 10 http://127.0.0.1:3000/healthz >/dev/null; then
  echo "Saved. The site restarted and is running."
  echo
  echo "Next, in the admin console under Settings:"
  echo "  • set the address emails come from (one $PROVIDER has verified)"
  echo "Then on the Owners tab, open an owner and list who to notify."
else
  echo "Saved, but the site is not answering. Check:" >&2
  echo "  sudo journalctl -u planesforfriends -n 40" >&2
  exit 1
fi
