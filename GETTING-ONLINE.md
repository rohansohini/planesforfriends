# Getting the site online — no experience needed

This is the click-by-click version. You will use a black text window (a "terminal") twice, and
both times you are copying and pasting a line I give you. You do not need to understand it.

## First, pick one

| | Time | Cost | Catch |
| --- | --- | --- | --- |
| **A. Free cloud machine** (Oracle) | ~45 min | $0 | Fiddly signup, and Oracle can reclaim an idle machine — see below |
| **B. Paid, easiest** (Render) | ~10 min | ~$7/month | Costs money. Nothing else; no terminal, no maintenance |
| **C. A computer you already own** | ~20 min | $0 | Down whenever that computer or your home internet is |

**If $7 a month is acceptable, do B.** It is much simpler and nothing can take it away while you
are not looking. Do A if free is a firm requirement, and read the box below first — it is the
one thing about Oracle you need to know before you build on it.

> ### Oracle can reclaim an idle machine
>
> Oracle's published policy: an Always Free instance counts as **idle** if, across a 7-day
> window, its 95th-percentile CPU use is under 20%, network use is under 20%, and — on the
> Ampere A1 shapes, which is what you will be running — memory use is under 20%. Idle instances
> **may be reclaimed**.
>
> Be clear-eyed: a plane rental site for two friends is idle by that definition almost all of
> the time. This is a real risk, not a footnote. Three ways to handle it, best first:
>
> 1. **Upgrade the Oracle account to Pay As You Go.** Always Free resources stay free after you
>    upgrade — you are only charged for anything beyond the free limits — and paid accounts are
>    widely reported not to be subject to idle reclamation. The trade-off is that your card can
>    now actually be charged if you create something outside the free limits, so create nothing
>    else.
> 2. **Keep good backups off the machine** (step 7 below). Reclamation takes the machine, not
>    your saved file. With a backup on your laptop you are back online in about 15 minutes.
> 3. **Accept it and check in occasionally.** If the site is a nice-to-have and a few days
>    offline would only be annoying, this is fine.
>
> You may see advice to run a program that burns CPU around the clock to stay above the
> threshold. It works, and it wastes a machine's worth of electricity forever to dodge a $7
> bill. I would not.
>
> One more, on Google's free VM instead: it has no reclamation policy, but Google now bills
> separately for the public internet address (roughly $3/month), so it is not actually free.

Free tiers change. Glance at your billing page after the first week whichever you choose.

---

# A. The free way, step by step

## 0. Let the machine download the code (~1 min)

Your repository is **private** right now, so a fresh cloud machine cannot fetch it — the
download would stop and ask for a password it has no way to supply. Two ways round it; the
first is much easier.

**Make the repository public.** On GitHub, open your repository → **Settings** → scroll to
**Danger Zone** → **Change repository visibility** → **Make public**.

That is safe here: there are no passwords or personal details in the code. The admin password is
created the first time the site starts and stored scrambled in the database file, and that file
is never uploaded to GitHub — neither are any renters' names or numbers. All of that lives only
on your own machine. What becomes public is the website's source code.

**If you would rather keep it private**, skip that and use the ZIP route in step 5 instead.

## 1. Make an Oracle Cloud account (~15 min)

Go to [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) and sign up.

- It asks for a credit card. It is used to check you are a real person. Always Free resources
  do not charge it.
- **Your "home region" cannot be changed later.** Pick the one closest to you.
- Signup sometimes rejects a card for no clear reason. A different card usually works. This is
  the most annoying part of the whole process, and it is over quickly.

When you land on a dashboard covered in boxes, you are through the hard part.

**Before you do anything else, set a spending alarm.** Menu → **Billing & Cost Management** →
**Budgets** → **Create Budget**, target your tenancy, amount **$1**, and add an alert rule that
emails you at 100%. Nothing in this guide will ever trigger it — that is the point. If it does
fire, something got created that is not free and you will know the same day instead of at the
end of the month.

**What could actually cost money** — this matters most if you upgrade to Pay As You Go, which is
worth doing for capacity and to avoid reclamation. Not your renters, either way. The free
allowance is **4 ARM CPUs and 24 GB of memory** across your machines, 200 GB of disk and **10 TB
of outbound traffic a month**. This site is about 51 KB per visit, so 10 TB is roughly 210
million page views — you will use a rounding error of it. Ten years of bookings at 20 a week
comes to about 38 MB of database against a 200 GB allowance. Oracle does not meter public IP
addresses the way AWS and Google now do, so there is no drip charge for being reachable.

Upgrading does not start a meter. It removes the fence: an Always Free account mostly *cannot*
create billable things, and a Pay As You Go account happily will. Nothing on this list is
something you need, so simply do not click them:

- a second machine, or a shape without the **Always Free eligible** label
- more than 4 OCPUs or 24 GB of A1 across all your instances (you are using 1 and 6)
- a bigger boot volume, or more than 200 GB of storage in total
- **a boot volume backup policy** — the tempting one. Always Free covers 5 volume backups and a
  policy will cheerfully make more. You do not need it: the site already backs its own database
  up nightly, and that file is the only thing worth saving.
- a load balancer, a second Autonomous Database, anything with "Enterprise" in the name

If you upgraded from a 30-day trial, also check **Compute → Instances** and **Storage → Block
Volumes** for anything you made while trying things out. Trial resources that are not Always
Free eligible stop being free the moment you upgrade. Delete what you do not recognise.

**Then verify rather than trust**: a week in, open **Billing & Cost Management → Cost Analysis**.
It should read $0.00, and your first invoice should too. Along with the $1 budget alert above,
that is two independent ways of finding out the same day if something is wrong.

## 2. Create the machine (~5 min)

In the menu (☰ top left): **Compute → Instances → Create instance**.

Change three things and leave everything else alone:

- **Name**: `planesforfriends`
- **Shape**: click *Edit* next to Image and shape → **Change shape** → **Ampere** →
  **VM.Standard.A1.Flex**, the one labelled **Always Free eligible**. Set **1 OCPU** and
  **6 GB** of memory. (The free allowance is 4 OCPUs and 24 GB across all your A1 machines, so
  one quarter of it is yours to spend here and there is no prize for using the rest. 1 and 6 is
  already far more than this site needs.)
- **Image**: **Ubuntu** 22.04 or 24.04. The console only offers images that fit the shape, so
  you will automatically get the ARM build.

Under **Add SSH keys**, choose **Save private key** and download the file. You may never need it
(the browser terminal in step 5 does not), but losing it locks you out later.

Click **Create**. After a minute the state turns to **Running** and there is a **Public IP
address** on the page — something like `152.70.113.8`. **Copy it.** You need it twice.

> **A1.Flex is an ARM machine**, a different kind of chip from the laptop you are reading this
> on. It makes no difference here: this site has no add-on components to compile, and both
> things the installer downloads (Node and Caddy) publish ARM builds. Nothing extra to do.

> **"Out of host capacity" or "Out of capacity for shape VM.Standard.A1.Flex"**
>
> Expect this — the free ARM machines are in heavy demand, and it is the one wall most people
> hit. It means "not right now", not "not ever". In order:
>
> 1. Change the **Availability domain** (AD-1 / AD-2 / AD-3, on the same Create screen) and try
>    each one. Many regions have stock in only one.
> 2. Try again in a few hours, and at an odd hour — capacity frees up constantly. Repeatedly
>    clicking Create is normal behaviour here, not a sign you did something wrong.
> 3. Ask for less: 1 OCPU and 6 GB is far likelier to land than 4 and 24.
> 4. **Upgrade the account to Pay As You Go.** Paid accounts are widely reported to get capacity
>    where free accounts are refused, and it also takes you out of the idle-reclamation pool.
>    Always Free resources stay free after upgrading — see step 1 for what that does and does not
>    mean for your card.

## 3. Get a free web address (~5 min)

Your site needs a name. [duckdns.org](https://www.duckdns.org) gives one away.

1. Sign in with Google or GitHub.
2. Type `rent-planes` and click **add domain**. (If somebody already took it, DuckDNS will
   say so — add a suffix like `rent-planes-mn` and use that everywhere below instead.)
3. In the box next to it, paste the Public IP from step 2, and click **update ip**.

You now own `rent-planes.duckdns.org`. It is not pretty. It works exactly like a real address,
and you can switch to a real one later.

## 4. Open the machine's front door (~3 min)

Oracle blocks all web traffic until you say otherwise. Back in the Oracle tab:

1. From your instance page, click the **Virtual cloud network** link, then **Security Lists**,
   then **Default Security List**.
2. Click **Add Ingress Rules** and add this one:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: **TCP**
   - Destination Port Range: `80,443`
3. Save.

(That is the outer gate. There is a second, inner gate inside the machine itself — the install
command in the next step opens that one for you. Skipping the inner one is the classic reason a
site stays unreachable, so it is handled.)

## 5. Install the site (~5 min)

On your instance page, click the **SSH** button — Oracle calls it *Cloud Shell* or *Launch
Cloud Shell*. A black text window opens in your browser. That is the machine.

Copy these three lines, paste them in, and press Enter. **If DuckDNS made you pick a different
name in step 3, use that one instead.**

```bash
sudo apt-get update -qq && sudo apt-get install -y -qq git
git clone https://github.com/rohansohini/planesforfriends
sudo bash planesforfriends/deploy/install.sh rent-planes.duckdns.org
```

<details>
<summary><b>If you kept the repository private</b> — use this instead</summary>

On GitHub, click the green **Code** button → **Download ZIP**. Then in the Cloud Shell window,
use its **Upload** button (in the Cloud Shell menu) to send that ZIP to the machine, and run:

```bash
sudo apt-get update -qq && sudo apt-get install -y -qq unzip
unzip -q planesforfriends-*.zip
sudo bash planesforfriends-*/deploy/install.sh rent-planes.duckdns.org
```

The installer works from those files directly — it does not need GitHub at all.
</details>

It runs for two or three minutes, printing lines you can ignore. At the end it prints a box:

```
======================================================================
 Planes for Friends is running at: https://rent-planes.duckdns.org

 Admin password (shown once, at first start):
       throttle-rudder-348
======================================================================
```

**Write that password down.** It is not shown again.

## 6. Check it (~2 min)

Open `https://rent-planes.duckdns.org` on your phone. You should see the blue header and
"Rent a plane from a friend", with a padlock in the address bar.

If it does not load, give it 60 seconds — the certificate takes a moment the first time — then
see *If something goes wrong* below.

---

# Once it is live — 10 minutes that matter

1. Go to `your-address/admin` and sign in with the printed password.
2. **Settings** → change the password to something you will remember. Then set the problems
   contact name and number (this is printed on every renter's confirmation), the time zone, and
   the site title.
3. **Owners** → delete the sample owners and add Vinod and Soney with their real phone numbers.
   Renters are told to call these numbers about pricing, so a typo here is a real problem.
4. **Planes** → add the six real planes with their tail numbers.
5. **Book a test flight yourself** on `/rent/vinod`, then look it up on `/lookup` and log a tach
   time. Five minutes, and it catches a wrong number before a renter does.
6. Text the two links to your dad: `your-address/rent/vinod` and `your-address/rent/soney`.
7. **Set up a free uptime alert.** Make an account at [uptimerobot.com](https://uptimerobot.com),
   add a monitor pointing at `https://your-address/healthz` every 5 minutes, with your email as
   the alert. It emails you if the site stops answering — which matters much more here than on a
   paid host, because Oracle can reclaim the machine without telling you first. (It is a
   watchman, not a defence: those pings are nowhere near enough traffic to make the machine look
   busy.)

---

# If something goes wrong

**The page never loads.** Almost always the firewall. Check that the ingress rule in step 4 has
port range `80,443` and source `0.0.0.0/0`. Then, in the terminal, run
`sudo bash planesforfriends/deploy/install.sh rent-planes.duckdns.org` again — it is safe to
re-run and it re-opens the inner gate.

**"Not secure" or a certificate warning.** The name in DuckDNS is not pointing at this machine.
Re-check the IP in step 3 matches the Public IP on the instance page, wait two minutes, re-run
the install command.

**"This site can't be reached" but the address is right.** Confirm the instance says **Running**
in the Oracle console. Free machines are occasionally stopped by Oracle if idle for a long time;
click **Start**.

**You lost the admin password.** In the terminal:
`sudo journalctl -u planesforfriends | grep -A6 'Admin password'`

**Everything looks broken.** In the terminal, `sudo systemctl restart planesforfriends`. Then
`sudo systemctl status planesforfriends` — a green "active (running)" means the site itself is
fine and the problem is outside it.

---

# Later

**Updating the site** — same command, any time. It updates the code and leaves every reservation
alone:

```bash
cd planesforfriends && git pull && sudo bash deploy/install.sh rent-planes.duckdns.org
```

(If you kept the repository private, download a fresh ZIP and re-run the ZIP commands instead.)

**Your data** is one file at `/var/lib/planesforfriends/planesforfriends.db`, and a copy is made
every night at 3:15am into `/var/lib/planesforfriends/backups/`. Those copies are on the same
machine, which is fine for "I deleted something by mistake" and **no help at all if Oracle takes
the machine back**. On a free Oracle machine this is the difference between a 15-minute
annoyance and losing every reservation, so do it: once a month, download one to your laptop:

```bash
sudo cp /var/lib/planesforfriends/backups/*.db ~/ && ls ~/*.db
```

Then use the Cloud Shell's download button on that file. It contains renters' names and phone
numbers, so keep it somewhere private.

**If the machine disappears** (Oracle reclamation, or you break something badly): build a new
one with steps 2–5, point DuckDNS at the new IP address, then put your backup back:

```bash
# after uploading your saved .db file to the new machine
sudo systemctl stop planesforfriends
sudo cp planesforfriends-2026-08-13*.db /var/lib/planesforfriends/planesforfriends.db
sudo rm -f /var/lib/planesforfriends/planesforfriends.db-wal /var/lib/planesforfriends/planesforfriends.db-shm
sudo chown pff:pff /var/lib/planesforfriends/planesforfriends.db
sudo systemctl start planesforfriends
```

Every reservation, tach reading and confirmation number comes back exactly as it was, including
the admin password from that backup.

**Moving to a real domain** later: buy the name, point its A record at the same Public IP, then
re-run the install command with the new name. Nothing else changes.
