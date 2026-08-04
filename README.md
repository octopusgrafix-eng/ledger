# The Daybook — Job Ledger

A single-file business management app for the print shop: job pipeline, pricing,
customer debt tracking, receipts, stock purchases, and profit/tithe splits —
all in one self-contained `index.html`.

## Live site

**https://octopusgrafix-eng.github.io/ledger/**

Served by GitHub Pages from the `main` branch, root folder. No build step — Pages
publishes `index.html` as-is, and it's free and unmetered because this repo is public.

> The old `oktopusaccount.netlify.app` URL is **dead and must not be used**. That
> Netlify account exceeded its credit allowance, so deploys are silently marked
> *"Skipped due to account credit usage exceeded"* while the last successful build
> keeps being served with HTTP 200 — it looks healthy but is frozen, and that build
> predates the sign-in gate, so it exposes the ledger with no login at all.

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

If Firestore is unreachable (offline, network blocked), the app keeps working
off the local cache and retries on the next save.

Access is enforced by [`firestore.rules`](firestore.rules): a ledger document is
readable and writable only by the signed-in user whose uid matches it. Publish
these in the Firebase console under *Firestore → Rules*.

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
