# Working notes for Claude

Read the [README](README.md) first for what the app is, how it deploys, and how
storage and sign-in work. This file is the working context that isn't obvious from
the code: conventions, traps, and where things stand.

## Shape of the thing

One self-contained `index.html` (~280KB), no build step, no dependencies. Edit it
directly. Everything is inside one IIFE: state, render functions, handlers.
`sw.js`, `manifest.json` and the icons sit beside it.

Rendering is `innerHTML` replacement — each tab has a `renderX()` that rebuilds
`#lg-content` wholesale and re-attaches its own listeners.

## Traps worth knowing

**`renderAll()` runs on far more than tab changes.** Recording a payment, changing
a status, and debounced search keystrokes all land there and replace the content
area. Anything that should happen only on a real tab change has to be guarded —
see `lastRenderedTab`, which gates the entrance animation. Get this wrong and
routine data entry visibly stutters.

**A rebuild destroys the input being typed in.** Several tabs re-render on every
keystroke; the Pending search lost focus after each character until it was
debounced and given explicit focus/caret restoration. Check this whenever a
handler calls a full re-render.

**The user edits `index.html` in the GitHub web UI.** The local working copy,
`origin/main`, and what is actually deployed have all been three different things.
Before editing: `git fetch`, check ahead/behind, and `curl` the live URL to diff
it. Merging deliberately once beats discovering the drift later.

**Verify a deploy by diffing the live URL, never by checking the site loads.** A
skipped Netlify build still returns HTTP 200 while serving a months-old file.

**Never build a `YYYY-MM-DD` with `toISOString()`.** The shop is UTC+1, so local
midnight is the *previous* day in UTC. `todayISO()` and `shiftDate()` both did this:
"today" read as yesterday until 1am, and every prev/next-day button on Daily View,
Jobs, Expenses and CP Account stepped two days back and none forward. Use `isoOf()`,
which formats from local parts. The bug is invisible in a UTC-or-behind test
environment — check `Intl.DateTimeFormat().resolvedOptions().timeZone` before
concluding date arithmetic works.

**The preview pane serves stale snapshots.** `navigate` and `location.reload()`
both kept returning old bytes for several attempts; `preview_start` with the file
URL forces a genuinely fresh render. If a check reports code you know you just
wrote as missing, suspect the cache before suspecting the edit.

## Testing against live data

The browser session is usually signed in as the owner, so **the ledger on screen
is real business data — customers, debts, cash records.** Read it freely, but do
not write to it to prove a feature works. Open a form and cancel; exercise a
no-op path; or say plainly in the summary that the write path is unverified.
Anything genuinely set for a test (a target figure, say) gets restored afterwards
and the user is told.

Signing in cannot be done — it needs the owner's password.

## How the money actually splits

Three purses, all the same shape (`*OpeningFor` / `*InflowFor` / `*SpentFor`, an
opening float and an optional start date): **CP Account** for production money,
**Expenses**, and **Material** on the Inventory tab. Copy the CP one when adding
another.

Net Profit = cash collected − cost of production − material used − material
wasted. **Buying stock is not in that formula and never has been** — restocking
is funded by the material purse, which collects the used + wasted charged onto
each job. Stock purchases do reduce Net Cash, which is a cash-movement figure,
not profit. Tithe/PF/EX are split off Net Profit, so anything that changes it
changes the split: `dayStats()`, `monthStats()`, `targetStats()` and the Summary
day table all compute it separately and must stay in step. Four copies of one
formula; two of them have already drifted once.

## Conventions that have held

Semantic colours are load-bearing: clay = debt, green = paid, amber = warning.
The Oktopus blues (`--ok-deep` `#0F0FBE`, `--ok-blue` `#1131F4`) are for chrome
and actions only — recolouring the semantic ones costs meaning.

Money figures that represent something owed are also the control for settling it
(`.owed-pay`). The pattern exists because action links live in the last table
column, which is off-screen on a phone.

Motion is budgeted by frequency, not applied evenly. Sign-in is once per device
and gets a staged entrance; tab content gets 200ms and only on a real change;
presses get 140ms; repeated actions get nothing.

**`firebase.auth()` throws when the app never initialised** — it does not return
null. A `window.firebase && firebase.auth` guard passes and then the call blows
up; inside a Promise executor that rejects silently and the button just does
nothing. Wrap it in try/catch and treat the throw as "not signed in".

**The service worker serves the shell stale-while-revalidate**, so a deploy only
appears on the *next* open — the visit after a push still shows the old build and
caches the new one behind it. The Refresh button (`refreshNow`) forces the check:
it calls `window.__lgCheckUpdate`, a bridge exposed by the SW registration script,
which lives outside the app IIFE and is the only thing holding `reg`. Note
`reg.update()` resolves when the *check* finishes, not when a found worker has
installed — read `reg.waiting` too early and you'll always see nothing.

## Testing target/profit logic without the owner's data

The preview loses the signed-in session easily, and signing back in needs the
owner's password. To exercise this logic anyway: copy `index.html` to
`_target-test.html` **inside the project folder** (a scratchpad path renders as a
static snapshot and won't run scripts), and inject a seed block just before
`const ready = await waitForFirebase(8000);` that fills `state`, sets
`state.loaded`, unhides `ledger-root`, and calls `renderTabs(); renderAll();`
then returns — that short-circuits Firebase entirely. Expose a
`window.__SEED(pairs)` helper so scenarios can be swapped without reloading.
Delete the copy afterwards; it is not gitignored.

The header buttons (Backup / Restore / Clear) are wired in `startLedger()`, which
the harness skips — clicking them does nothing there. Expose the handlers on
`window` from the seed block instead. `requirePassword` can be driven by stubbing
`window.firebase` with a fake `currentUser` and an `EmailAuthProvider.credential`
that only accepts a chosen literal; it reads `window.firebase` at call time, so
the stub can be swapped in and out around a single call.

## Open items

- **Netlify (`oktopusaccount.netlify.app`) is frozen** on a pre-sign-in build,
  out of credits. Kept deliberately. Revival steps are in the README.
- **The monthly target is ₦8,450,000 on the PF basis**, set 6 Aug 2026. It encodes
  "₦500,000 of net profit per working day": 26 working days × ₦500k = ₦13m net,
  × 65% = ₦8.45m. Because the app divides by the *current* month's working days
  (24–27 across 2026), a fixed target drifts the daily figure — ₦8.45m is ₦500k/day
  in August but ₦521k in February. Revisit if they want exactly ₦500k every month.
- **The daily target carries both ways.** `targetStats()` keeps a signed running
  `deficit`: a day that falls short raises tomorrow's figure, a day that beats it
  lowers tomorrow's. Today's required is clamped at 0 (a big enough surplus means
  today needs nothing) but the surplus itself keeps rolling. Sundays never add a
  share and never count as "missed", though a debt can sit on one and earning on
  one pays it down. With the ₦8.45m target and a slow month, the carried figure
  gets large fast — if the owner would rather it reset weekly, that's a change to
  the loop, not the card.
- **Stage timestamps only exist going forward.** Jobs predating the feature can't
  be timed; production-speed averages stay empty until new jobs flow through.
- **Untested write paths**: saving a corrected stage time, saving a customer
  phone, and recording an old-debt payment (no customer has old debt set).
- **The material purse opens deep in the red (−₦100,857 as of 6 Aug 2026).** Not
  a bug: a ₦189,000 restock on 5 Aug hasn't been used up, and the purse only
  counts material as it gets charged onto jobs. It climbs back on its own. If the
  owner wants a clean start rather than watching it recover, the fix is an
  opening float or a "start purse from" date in Material Purse Setup.
- **Wasted material now comes out of Net Profit everywhere.** `dayStats()` and
  `monthStats()` always did; the Summary day table didn't, so it disagreed with
  Daily View and with its own CSV export. Fixed. No job in the ledger records
  waste yet, so the subtraction is code-verified but has never run on real
  figures — the first job with waste is worth eyeballing across Daily View,
  Summary and Inventory to confirm the three agree.
