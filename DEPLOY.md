# Putting Planes for Friends on the internet

**Never done this before?** [GETTING-ONLINE.md](GETTING-ONLINE.md) is the click-by-click
version — this page is the reference.

## The one thing that matters

Every reservation, plane, owner and Hobbs reading lives in **one SQLite file** on disk
(`data/planesforfriends.db`). That makes the app simple to run and trivial to back up, but it
rules out any host with a throwaway filesystem — **Vercel, Netlify, Cloudflare Workers, Heroku,
AWS Lambda and Render's free tier will all quietly erase your data**, usually on the next
deploy, when nobody is looking.

What you need is unglamorous: one small always-on machine with a **persistent disk**, and HTTPS
in front of it. Traffic here is a handful of people a week, so the smallest thing on offer is
plenty.

## Free, and good enough: an always-free VM

Two cloud providers give you a small Linux machine with a real disk, free with no time limit.
Either one runs this app comfortably — it has no dependencies and sits idle most of the week.
Both require a credit card at signup for identity checks, and neither charges for these
instances. (Free tiers do change; check the current terms before you rely on one.)

| | Google Cloud `e2-micro` | Oracle Cloud Ampere A1 |
| --- | --- | --- |
| What you get | 1 VM, 1 GB RAM, 30 GB disk | up to 4 cores, 24 GB RAM, 200 GB disk |
| Regions | us-west1, us-central1, us-east1 only | most |
| Catch | public IPv4 is billed separately (~$3/month), so not truly free | idle instances can be reclaimed; A1 capacity is often unavailable at first |

Neither is quite as free as it sounds. Google no longer includes the public internet address, so
budget roughly $3/month there. Oracle still includes it, but publishes an idle-reclamation
policy: an Always Free instance is deemed idle when, over 7 days, 95th-percentile CPU is under
20%, network is under 20%, and (A1 shapes) memory is under 20% — and idle instances may be
reclaimed. A rental site for two friends meets that definition nearly always.

Mitigations, in order: upgrade the Oracle account to Pay As You Go (Always Free resources stay
free, and paid accounts are widely reported both to be exempt from reclamation and to get A1
capacity where free accounts are refused); keep backups off the machine so a rebuild is 15
minutes; or pay for a host that has no such policy. Do not run a CPU-burning "keep busy" daemon
— it works and it is a waste of a machine.

Oracle's Always Free compute is `VM.Standard.A1.Flex` (ARM, up to 4 OCPUs and 24 GB across your
instances). The older AMD `VM.Standard.E2.1.Micro` is not offered to every account or region, so
do not count on it. ARM changes nothing for this app — no native dependencies to compile, and
both Node and Caddy publish arm64 packages, which `deploy/install.sh` picks up automatically.

**Then, on the machine:**

```bash
sudo apt-get install -y git && git clone https://github.com/rohansohini/planesforfriends
sudo bash planesforfriends/deploy/install.sh rent-planes.duckdns.org
```

The repository is private as it stands, so either make it public first or download the ZIP from
GitHub and upload it to the machine — the installer runs from whatever folder it sits in and
does not need GitHub access of its own.

That script installs Node 22, creates a service user, sets up systemd so the site restarts on
reboot, schedules a nightly backup, installs Caddy for HTTPS, and prints your admin password at
the end. Re-run it any time to update; it leaves the database alone.

**A free hostname**: [DuckDNS](https://duckdns.org) gives you `whatever.duckdns.org` for
nothing — sign in with Google/GitHub, pick a name, point it at your VM's IP. Caddy gets a real
Let's Encrypt certificate for it, so the padlock is genuine. Ugly, works fine, and you can move
to a real domain later by re-running the script with the new name.

Remember to open port 80 and 443 in the cloud provider's firewall — both Google and Oracle block
everything by default, and Caddy cannot get a certificate through a closed port 80. Oracle also
needs the rule added inside the VM (`iptables`), which trips up nearly everyone.

## Also free: a computer you already own

If you have an old laptop, a Mac Mini, or a Raspberry Pi that can stay powered on, that is the
cheapest real disk there is. Same install script. To reach it from the internet without touching
your router:

```bash
# Tailscale Funnel: free, gives you https://machine.your-tailnet.ts.net
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale funnel 3000
```

That publishes a genuine HTTPS URL with no port forwarding, no static IP, and no certificate
work. Cloudflare Tunnel does the same thing if you prefer, and is free too.

The trade-off is honest: when your home internet drops or somebody unplugs the laptop, renters
see nothing. For two friends renting to their circle, that is usually acceptable. For anything
you would be embarrassed to have down, use a cloud VM.

## What free will not work

- **Vercel, Netlify, Cloudflare Pages/Workers, AWS Lambda** — no persistent disk at all.
- **Render free, Railway trial, Koyeb free, Replit free** — either no disk, or the instance
  sleeps and the filesystem resets. Render's free tier in particular looks like it works, then
  loses everything on the next deploy.

Any of these could be made to work by moving the data to a free hosted Postgres (Neon, Supabase),
but that means rewriting every query in `src/store.js` and making the whole data layer async.
Not worth it for a handful of bookings a week.

## Paid, if you would rather not manage a machine: Render with a disk (~$7/month)

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

`deploy/install.sh` does all of this for you:

```bash
git clone https://github.com/rohansohini/planesforfriends
sudo bash planesforfriends/deploy/install.sh planesforfriends.com
```

**Do not use your distribution's `nodejs` package.** Ubuntu and Debian still ship Node 18 or 20,
and this app uses Node's built-in SQLite, which arrived in 22.5 — it would fail at startup. The
script installs Node 22 from NodeSource for that reason.

The pieces it installs are in `deploy/` if you would rather do it by hand:
`planesforfriends.service` (systemd, with the app confined to its own data directory) and
`Caddyfile` (the entire HTTPS setup — Caddy gets and renews the certificate itself).

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
- [ ] **Book a test flight yourself** end to end, then look it up and log a Hobbs time. Five
      minutes, and it catches a wrong phone number before a renter does.

## Backups

`scripts/backup.js` takes a consistent snapshot while the site keeps running (SQLite's
`VACUUM INTO`), writes it with a timestamp, and prunes to the newest 30:

```bash
node scripts/backup.js                    # -> data/backups/planesforfriends-<date>.db
node scripts/backup.js /mnt/somewhere     # -> anywhere else
```

On a VPS, `deploy/install.sh` already schedules this nightly at 3:15am via
`/etc/cron.d/planesforfriends-backup`. To copy the backups off the machine as well — worth doing,
since a backup on the same disk does not survive losing the disk:

```
30 3 * * * pff rsync -a /var/lib/planesforfriends/backups/ elsewhere:/backups/planesforfriends/
```

On Render, add a Cron Job to the blueprint running the same command against the same disk.

Backups contain renters' names, phone numbers and email addresses. Keep them somewhere private,
and if you copy one to your laptop, remember it is a list of your friends' contact details.

To restore, stop the site, copy a backup over `planesforfriends.db` (delete any stale `-wal` and
`-shm` files beside it), and start it again.

## Updating the site later

Render and Fly redeploy on push. On a VPS, from your checkout:

```bash
cd ~/planesforfriends && git pull && bash deploy/update.sh
```

That backs up the database, pulls, reinstalls, restarts, reuses the hostname already in the
Caddyfile, and fails loudly if the site does not come back. Code lives in `/opt/planesforfriends`
and data in `/var/lib/planesforfriends`; the installer only ever creates and chowns the latter,
so an update cannot touch a reservation.

The database migrates itself on start — new columns are added in place, and existing data is left
alone. Take a backup before updating anyway; it costs a second.
