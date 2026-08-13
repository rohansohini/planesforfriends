# Planes for Friends

A small plane-rental scheduler for a couple of friends who own recreational aircraft.
Renters need no account — they pick a plane, pick an open time, leave their name, phone and
email, and get a confirmation ID they use later to log tach time.

## Running it

Node 22.5 or newer. No dependencies to install — it uses Node's built-in HTTP server and
its built-in SQLite.

```bash
node scripts/seed.js        # creates Vinod + Soney and their planes (add --demo for sample bookings)
npm start                   # http://localhost:3000
```

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `ADMIN_PASSWORD` | `flyplanes` | Admin password, only read the first time the database is created |
| `PFF_DB_PATH` | `data/planesforfriends.db` | Where the SQLite file lives |

The whole system is one SQLite file. Back it up by copying `data/planesforfriends.db`.

## Pages

| URL | Who | What |
| --- | --- | --- |
| `/` | anyone | Lists everyone you can rent from |
| `/rent/vinod`, `/rent/soney`, `/rent/<anyone-else>` | renters | Plane picker → availability calendar → booking form → confirmation ID |
| `/lookup` | renters | Enter a confirmation ID to see the reservation and log tach time |
| `/admin` | owners | Password-protected console for everything |

Owner pages are created automatically when you add an owner in the admin console — add
"Raj Patel" and `/rent/raj-patel` is live immediately.

## How renting works

1. **Pick a plane.** Every owner page shows a plane picker, even when the owner has only one.
2. **Pick a time.** The week calendar shows 30-minute slots. Time that is already booked is
   striped, greyed out and unclickable — a hard block, not a warning. Past time is greyed out
   too. The exact start/end can be fine-tuned in the two time fields under the calendar.
3. **Leave your details.** Name, phone, email. The server re-checks for a conflict at the moment
   of booking, so two people clicking at once cannot double-book.
4. **Get a confirmation ID** like `PFF-7K3QD2`, shown on screen along with the four
   pre-flight instructions:
   1. Contact *the owner* at *their number* for pricing.
   2. Treat the plane as if it was your own.
   3. Top off the gas once you are finished.
   4. Contact *Soney* at *Soney's number* if there are any problems.

   The owner's name and number come from the plane's owner; the problems contact is a site
   setting (Admin → Settings), so it changes in one place.
5. **After flying**, `/lookup` takes the confirmation ID and accepts a tach time — a single
   logged number, editable afterwards.

### Renter privacy

The public calendar endpoint only ever returns anonymous busy windows — start time, end time,
and whether it is a rental or a maintenance block. Names, phone numbers and emails never reach
another renter's browser. Confirmation IDs are random (32-character alphabet, ambiguous
characters like `0`/`O` removed), so they cannot be guessed by counting up.

## The admin console

Sign in at `/admin` with the shared password.

- **Schedule** — every reservation across every plane and every owner. Filter by plane with the
  dropdown (grouped by owner) and by date range. Tach time edits inline: type a number, tab
  away, saved. Everything else — plane, times, renter details, notes, status — is in the Edit
  modal, which also deletes.
  - **Add reservation** books on someone's behalf (phone-in bookings).
  - **Block off time** marks a plane unavailable for maintenance or personal use; renters see it
    as taken with no explanation.
  - **Download spreadsheet (CSV)** exports exactly what the filters show — one row per
    reservation with tach time, hours reserved, renter contact and notes. Opens in Excel,
    Numbers or Google Sheets.
- **Planes** — add a plane, assign it to an owner, edit tail number/model/nickname/renter notes,
  hide it from the site without deleting, or delete it outright. Adding a plane puts it on that
  owner's page immediately.
- **Owners** — add anyone to rent from, which creates their `/rent/<name>` page. Their phone
  number is what renters see for pricing. Owners can be hidden without being deleted.
- **Settings** — site title, the "problems" contact name and number, the export time zone, the
  hours the calendar shows, how far ahead renters can book, and the admin password.

## Notes and limits

- **No notifications.** Nothing is texted or emailed; the confirmation is shown on screen, and
  owners see new bookings when they open the admin page.
- **Times display in each browser's local time zone.** The time zone in Settings is used for the
  CSV export only. If everyone is in the same time zone (the normal case), the two agree.
- **One shared admin password**, hashed with scrypt, session cookie good for 12 hours. Fine for
  a few friends; if this ever grows past that, per-owner logins are the next step.
- **Put it behind HTTPS** before it goes on the public internet — the admin password is sent in
  the request body, and the session cookie sets `Secure` automatically when it sees an
  `X-Forwarded-Proto: https` header from a reverse proxy.

## Layout

```
server.js            HTTP server, page routes, static files
src/db.js            SQLite schema, settings, password hashing
src/store.js         owners / planes / reservations, conflict checks
src/api.js           JSON API, instructions, CSV export
src/auth.js          admin sessions
public/              index.html, rent.html, lookup.html, admin.html + css/js
scripts/seed.js      starting owners and planes
```
