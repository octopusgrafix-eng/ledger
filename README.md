# Oktopus Ledger

A single-file business management app for the print shop: job pipeline, pricing,
customer debt tracking, receipts, stock purchases, and profit/tithe splits —
all in one self-contained `index.html`.

Alongside it sits **`staff.html`** — a separate installable app for the shop
floor: chat, the jobs you send out, the print files, and a clock. Staff can see
the work; they cannot see the money.

## Live site

**https://octopusgrafix-eng.github.io/ledger/** — the ledger (owner)

**https://octopusgrafix-eng.github.io/ledger/staff.html** — the staff app

Served by GitHub Pages from the `main` branch, root folder. No build step — Pages
publishes `index.html` as-is, and it's free and unmetered because this repo is public.

### The Netlify mirror (currently frozen)

`oktopusaccount.netlify.app` is the original URL. It is **kept, but temporarily
out of date** — the Netlify account exceeded its credit allowance on 2026-08-04,
so deploys are silently marked *"Skipped due to account credit usage exceeded"*
while the last successful build (commit `a7dbe80`) keeps being served with
HTTP 200. It looks healthy but is frozen on a build that predates the sign-in gate.

**Use the GitHub Pages URL above until credits reset.**

It is not a data leak: `firestore.rules` requires an authenticated uid, so that
frozen build cannot read or write anything (verified — unauthenticated reads and
writes to the old shared `ledgerData/appState` path both return
`403 PERMISSION_DENIED`). It shows an empty ledger throwing permission errors,
which is confusing rather than dangerous.

**To revive it once credits reset:**

1. Netlify → **Deploys** → **Trigger deploy** → *Deploy site*
2. Confirm the new deploy says **Published**, not *Skipped*
3. Load the site and check the sign-in screen appears — if you get straight into
   a ledger with no login, you are still on the old cached build; hard-reload

Both URLs then serve this same repo and the same Firestore data, so they stay in
sync with each other automatically. The service worker registers relative to its
own path, so it works correctly at the Netlify root and the Pages `/ledger/`
subpath alike.

## Sign-in

The ledger is gated behind Firebase Auth (email/password). Nothing is read or
painted until a user is confirmed, and each account only ever sees its own books.

There is deliberately **no sign-up form** — accounts are created by the owner in
the Firebase console (*Authentication → Users → Add user*), so nobody can
provision themselves an account on the public site.

Sign-in persists per device, so you sign in once on each of your phone/desktop.

## Data storage

Data is stored in three layers, in priority order:

1. **Firebase Firestore** — the permanent, cross-device store. Each user's whole
   ledger lives in a single document keyed by their auth uid (`ledgerData/{uid}`),
   so a page load costs one round trip instead of one per data type.
   The app subscribes with `onSnapshot`, so a change saved on one device appears
   on the other in about a second without a refresh.
2. **Browser localStorage** — a local cache, namespaced per uid so two accounts
   on the same browser never see each other's cached books. The app paints
   instantly from this cache before Firestore has responded, then reconciles.
3. **`window.storage`** — used only when previewed inside a Claude artifact;
   irrelevant on the deployed site.

### Working with no network

The ledger keeps working with no signal at all, and **nothing entered offline is
lost**. Writes are queued on the device (in both Firestore's own offline store
and the browser cache) and sent up automatically the moment the network returns —
they survive a refresh, a crash, or the machine being switched off overnight.

While anything is still waiting, the line under the date reads:

> ⚠ 3 changes not yet synced — saved on this device

That is your signal that this one machine is holding work nothing else has yet.
It clears itself once everything is up. While it shows: **don't clear the
browser, and take a Backup if you can.**

If the same job is edited on two devices, the more recent edit wins — the app
compares when each was written rather than assuming the cloud is right.

Access is enforced by [`firestore.rules`](firestore.rules): a ledger document is
readable and writable only by the signed-in user whose uid matches it. Publish
these in the Firebase console under *Firestore → Rules*.

## The staff app

`staff.html` is a second PWA on the same origin and the same Firebase project.
It installs as its own desktop app with its own icon — it has its own
`staff-manifest.json`, and the shared service worker serves each shell by path.

### What staff can and cannot see

Staff data lives in a **different Firestore collection** to the books:

```
ledgerData/{ownerUid}          the books — owner only, no staff rule exists
shops/{ownerUid}/members       who is on the team
shops/{ownerUid}/joinRequests  people asking to be let in
shops/{ownerUid}/messages      the chat
shops/{ownerUid}/tasks         job cards pushed from the ledger
shops/{ownerUid}/shifts        clock in / clock out, one doc per person per day
staffIndex/{uid}               which shop a signed-in person belongs to
```

`shopId` is always the owner's uid. A job card carries the spec, the customer
name, the due date and the artwork — **never the price, the payments or the
debt**. There is no rule anywhere that lets a staff account read `ledgerData`.

### What staff can do

- **Chat** with the shop in real time, with pictures attached
- **Accept a job**, then move it *ACCEPTED → IN PRODUCTION → READY*
- **See the artwork** for a job as a preview (see below)
- **Clock in and out**, and see who else is on the clock

Staff can never mark a job DELIVERED — that is tied to collecting the balance,
so it stays with the owner. Firestore rules pin exactly which fields a staff
account may write on a job card; everything else is rejected server-side.

### Reserving a job for one person

When you send a job you choose **who should do it** — *Anyone on the floor*, or
one named person, for the work only they do properly.

A reserved job is still **visible** to everyone, so the floor knows it's covered,
but only that person can accept it. It sorts to the top of their list marked
*★ Put aside for you*; everyone else sees *Kept for Tunde* and no Accept button.

You can change your mind from the Team tab — each job still waiting to be
accepted has a dropdown next to it. Once someone has accepted, the assignment
has done its job and the dropdown goes away. Staff cannot reassign a job to
themselves: `assignedTo` isn't in the set of fields the rules let them write.

### Job updates flow back into the ledger

When a staff member moves a job, the ledger applies it to the matching job:
*IN PRODUCTION* and *READY* update the status and add a history entry, and
accepting a job fills in the Operator. Each change carries a revision number the
job remembers, so replaying a change can't double-apply it and the ledger never
writes anything the staff app reads back.

### Pictures, and what they are not

There is **no file storage behind this app**, deliberately — it costs nothing and
needs no console setup or payment card. A picture travels *inside* the message or
job card, as a data URI.

That buys a hard ceiling. A Firestore document is capped at 1 MiB and base64
inflates a file by a third, so before sending, an image is scaled to at most
1200px and its JPEG quality walked down until it fits a 400KB budget — about a
300KB JPEG. A whole job card is budgeted at 700KB across all of its pictures.

**These are previews, not print files.** They are there so the operator can see
what the job is; the artwork itself still reaches them the way it always has.
The apps label them as previews rather than letting anyone assume otherwise.

Non-image files go through untouched *if* they fit the same 400KB budget — a
small PDF will, a real print file won't, and the app says so instead of failing
silently.

### One-time setup in the Firebase console

Only one thing, and only once:

1. **Firestore → Rules** — paste [`firestore.rules`](firestore.rules), Publish.
2. In the ledger, open the **Team** tab and press **Open the shop floor**.

### Adding a staff member

1. **Authentication → Users → Add user** in the Firebase console — set their
   email and a password. There is no sign-up form, so nobody can let themselves in.
2. Send them the staff app link and the **shop code** (both are on the Team tab,
   with copy buttons).
3. They sign in, paste the code, and appear under **Waiting to join**.
4. Press **Approve**. Their screen flips into the app on its own.

To cut someone off, use **turn access off** on the Team tab — it takes effect
immediately, and because pictures live inside the documents themselves, losing
access to the shop loses access to everything in it.

## Local development

This is a static, dependency-free HTML file — there's no build step.

Just open `index.html` directly in a browser, or serve it locally:

\`\`\`bash
python3 -m http.server 8000
\`\`\`

Then visit `http://localhost:8000`.

## Deploying changes

Push to `main` (or edit directly on GitHub) and Netlify redeploys automatically.

If a push doesn't show up on the live site, check **Netlify → Site configuration
→ Build & deploy** that the site is actually linked to this repo's `main` branch
and that the latest deploy succeeded — a site created by drag-and-drop upload
stays disconnected from Git and will keep serving the last file you dropped,
no matter what you push here.

## Backup / restore

Use the **Backup** button in the app's settings to download a full JSON
snapshot of your data at any time, and **Restore** to load one back in —
useful before major changes, or as an extra safety net alongside Firestore.
