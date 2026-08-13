# Putting Planes for Friends on the internet

## The one thing that matters

Every reservation, plane, owner and tach reading lives in **one SQLite file** on disk
(`data/planesforfriends.db`). That makes the app simple to run and trivial to back up, but it
rules out any host with a throwaway filesystem — **Vercel, Netlify, Cloudflare Workers, Heroku,
AWS Lambda and Render's free tier will all quietly erase your data**, usually on the next
deploy, when nobody is looking.

What you need is unglamorous: one small always-on machine with a **persistent disk**, and HTTPS
in front of it. Traffic here is a handful of people a week, so the smallest thing on offer is
plenty.

## Recommended: Render with a disk (~$7/month)

Least to babysit — no operating system to patch, HTTPS handled for you, deploys on git push.

1. Push this repository to GitHub (already done if you are reading this there).
2. In Render: **New → Blueprint**, choose the repo. It reads `render.yaml` and proposes a web
   service with a 1 GB disk mounted at `/data`.
3. Before the first deploy, set the one environment variable it asks for:
   `ADMIN_PASSWORD` — pick something you will remember, or leave it unset and read the generated
   password out of the deploy logs (it prints once, in a box).
4. Deploy. You get `https://planesforfriends.onrender.com`.
5. Open `https://your-site/admin`, sign in, and in **Settings** set the problems contact name and
   number, the time zone, and the site title.
6. Add the real owners and planes under the **Owners** and **Planes** tabs. If you want the
   starting data instead, open a Render shell and run `node scripts/seed.js`.

Do not choose the free instance type. It has no disk, and it sleeps after inactivity — the first
renter of the day would wait 50 seconds for a cold start and then find an empty database.

**Custom domain**: Settings → Custom Domain in Render, then add the CNAME it gives you at your
registrar. HTTPS is issued automatically. `planesforfriends.com` costs about $12/year.

## Alternative: a $5 VPS (most control, cheapest)

DigitalOcean, Hetzner, Vultr, Lightsail — any of them. You manage OS updates yourself.

```bash
# on a fresh Ubuntu box, as root
apt update && apt install -y nodejs caddy git      # Node 22+ required
git clone https://github.com/rohansohini/planesforfriends /opt/planesforfriends
useradd -r -s /usr/sbin/nologin pff
mkdir -p /var/lib/planesforfriends && chown pff /var/lib/planesforfriends
```

`/etc/systemd/system/planesforfriends.service`:

```ini
[Unit]
Description=Planes for Friends
After=network.target

[Service]
User=pff
WorkingDirectory=/opt/planesforfriends
Environment=PORT=3000
Environment=PFF_DATA_DIR=/var/lib/planesforfriends
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

`/etc/caddy/Caddyfile` — this is the whole HTTPS setup; Caddy gets and renews the certificate
on its own:

```
planesforfriends.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
systemctl enable --now planesforfriends caddy
journalctl -u planesforfriends | grep -A6 'Admin password'   # the generated password
```

Point your domain's A record at the server's IP first, or Caddy cannot issue the certificate.

## Alternative: Fly.io with a volume

The `Dockerfile` is ready for it.

```bash
fly launch --no-deploy            # say no to a database, it does not need one
fly volumes create pff_data --size 1
fly secrets set ADMIN_PASSWORD='pick-something'
```

Add to `fly.toml`, then `fly deploy`:

```toml
[[mounts]]
  source = "pff_data"
  destination = "/data"
```

## After it is live — the short checklist

- [ ] **HTTPS works.** Non-negotiable: the admin password is sent in a request body, and the
      session cookie only sets its `Secure` flag when the site is served over HTTPS.
- [ ] **Change the admin password** at `/admin` → Settings if you used a generated one.
- [ ] **Real phone numbers** under Settings and for each owner — they are printed on every
      renter's confirmation ("Contact Soney at … if there are any problems").
- [ ] **Back up on a schedule** (below). One file is easy to save and easy to lose.
- [ ] **Book a test flight yourself** end to end, then look it up and log a tach time. Five
      minutes, and it catches a wrong phone number before a renter does.

## Backups

`scripts/backup.js` takes a consistent snapshot while the site keeps running (SQLite's
`VACUUM INTO`), writes it with a timestamp, and prunes to the newest 30:

```bash
node scripts/backup.js                    # -> data/backups/planesforfriends-<date>.db
node scripts/backup.js /mnt/somewhere     # -> anywhere else
```

Nightly on a VPS, via `crontab -e`:

```
15 3 * * * cd /opt/planesforfriends && PFF_DATA_DIR=/var/lib/planesforfriends /usr/bin/node scripts/backup.js
```

On Render, add a Cron Job to the blueprint running the same command against the same disk.

Backups contain renters' names, phone numbers and email addresses. Keep them somewhere private,
and if you copy one to your laptop, remember it is a list of your friends' contact details.

To restore, stop the site, copy a backup over `planesforfriends.db` (delete any stale `-wal` and
`-shm` files beside it), and start it again.

## Updating the site later

Render and Fly redeploy on push. On a VPS:

```bash
cd /opt/planesforfriends && git pull && systemctl restart planesforfriends
```

The database migrates itself on start — new columns are added in place, and existing data is left
alone. Take a backup before updating anyway; it costs a second.
