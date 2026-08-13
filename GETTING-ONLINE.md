# Getting the site online — no experience needed

This is the click-by-click version. You will use a black text window (a "terminal") twice, and
both times you are copying and pasting a line I give you. You do not need to understand it.

## First, pick one

| | Time | Cost | What it feels like |
| --- | --- | --- | --- |
| **A. Free cloud machine** (Oracle) | ~45 min | $0 forever | Fiddly signup, then two pasted commands |
| **B. Paid, easiest** (Render) | ~10 min | ~$7/month | All clicking, no terminal at all |
| **C. A computer you already own** | ~20 min | $0 | Easy, but the site is down when that computer is off |

If $7 a month is fine, **do B** — it is genuinely much simpler and you can skip most of this
page. If you want free, **do A**; the walkthrough below is written for it.

One honest note on free options: Google's free VM now bills separately for its public internet
address (roughly $3/month), so "free" there is not quite free. Oracle's still includes it. Free
tiers change, so glance at your billing page after the first week either way.

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

## 2. Create the machine (~5 min)

In the menu (☰ top left): **Compute → Instances → Create instance**.

Change three things and leave everything else alone:

- **Name**: `planesforfriends`
- **Image**: click *Edit* next to Image and shape, choose **Ubuntu** (22.04 or 24.04)
- **Shape**: choose **VM.Standard.E2.1.Micro**. Look for the words **Always Free eligible** next
  to it. Take this one, not the "Ampere" ARM shapes — those are free too but usually out of
  stock, which is a wall you do not need to hit today.

Under **Add SSH keys**, choose **Save private key** and download the file. You may never need it
(the browser terminal in step 4 does not), but losing it locks you out later.

Click **Create**. After a minute the state turns to **Running** and there is a **Public IP
address** on the page — something like `152.70.113.8`. **Copy it.** You need it twice.

## 3. Get a free web address (~5 min)

Your site needs a name. [duckdns.org](https://www.duckdns.org) gives one away.

1. Sign in with Google or GitHub.
2. Type a name — `vinod-planes`, say — and click **add domain**.
3. In the box next to it, paste the Public IP from step 2, and click **update ip**.

You now own `vinod-planes.duckdns.org`. It is not pretty. It works exactly like a real address,
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

Copy these three lines, paste them in, and press Enter. **Change `vinod-planes` to your own
name from step 3.**

```bash
sudo apt-get update -qq && sudo apt-get install -y -qq git
git clone https://github.com/rohansohini/planesforfriends
sudo bash planesforfriends/deploy/install.sh vinod-planes.duckdns.org
```

<details>
<summary><b>If you kept the repository private</b> — use this instead</summary>

On GitHub, click the green **Code** button → **Download ZIP**. Then in the Cloud Shell window,
use its **Upload** button (in the Cloud Shell menu) to send that ZIP to the machine, and run:

```bash
sudo apt-get update -qq && sudo apt-get install -y -qq unzip
unzip -q planesforfriends-*.zip
sudo bash planesforfriends-*/deploy/install.sh vinod-planes.duckdns.org
```

The installer works from those files directly — it does not need GitHub at all.
</details>

It runs for two or three minutes, printing lines you can ignore. At the end it prints a box:

```
======================================================================
 Planes for Friends is running at: https://vinod-planes.duckdns.org

 Admin password (shown once, at first start):
       throttle-rudder-348
======================================================================
```

**Write that password down.** It is not shown again.

## 6. Check it (~2 min)

Open `https://vinod-planes.duckdns.org` on your phone. You should see the blue header and
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

---

# If something goes wrong

**The page never loads.** Almost always the firewall. Check that the ingress rule in step 4 has
port range `80,443` and source `0.0.0.0/0`. Then, in the terminal, run
`sudo bash planesforfriends/deploy/install.sh vinod-planes.duckdns.org` again — it is safe to
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
cd planesforfriends && git pull && sudo bash deploy/install.sh vinod-planes.duckdns.org
```

(If you kept the repository private, download a fresh ZIP and re-run the ZIP commands instead.)

**Your data** is one file at `/var/lib/planesforfriends/planesforfriends.db`, and a copy is made
every night at 3:15am into `/var/lib/planesforfriends/backups/`. Those copies are on the same
machine, which is fine for "I deleted something by mistake" and no help if the machine
disappears. Once a month, download one to your laptop:

```bash
sudo cp /var/lib/planesforfriends/backups/*.db ~/ && ls ~/*.db
```

Then use the Cloud Shell's download button on that file. It contains renters' names and phone
numbers, so keep it somewhere private.

**Moving to a real domain** later: buy the name, point its A record at the same Public IP, then
re-run the install command with the new name. Nothing else changes.
