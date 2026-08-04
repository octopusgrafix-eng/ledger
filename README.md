# The Daybook — Job Ledger

A single-file business management app for the print shop: job pipeline, pricing,
customer debt tracking, receipts, stock purchases, and profit/tithe splits —
all in one self-contained `index.html`.

## Live site

Deployed via Netlify, auto-deploying from the `main` branch of this repo.

## Data storage

Data is stored in three layers, in priority order:

1. **Firebase Firestore** — the permanent, cross-device store. All ledger data
   lives in a single document (`ledgerData/appState`) so a page load only needs
   one round trip instead of one per data type.
2. **Browser localStorage** — a local cache, written on every load and save.
   The app paints instantly from this cache before Firestore has even responded,
   then quietly reconciles once the cloud read comes back.
3. **`window.storage`** — used only when previewed inside a Claude artifact;
   irrelevant on the deployed site.

If Firestore is unreachable (offline, network blocked), the app keeps working
off the local cache and retries on the next save.

## Local development

This is a static, dependency-free HTML file — there's no build step.

Just open `index.html` directly in a browser, or serve it locally:

\`\`\`bash
python3 -m http.server 8000
\`\`\`

Then visit `http://localhost:8000`.

## Deploying changes

Push to `main` (or edit directly on GitHub) and Netlify redeploys automatically.

## Backup / restore

Use the **Backup** button in the app's settings to download a full JSON
snapshot of your data at any time, and **Restore** to load one back in —
useful before major changes, or as an extra safety net alongside Firestore.
