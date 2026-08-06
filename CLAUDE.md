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

## Open items

- **Netlify (`oktopusaccount.netlify.app`) is frozen** on a pre-sign-in build,
  out of credits. Kept deliberately. Revival steps are in the README.
- **The monthly target is set to 0** — the owner still needs to enter their real
  figure on the Summary tab. Basis defaults to PF (65%); they never confirmed
  whether they wanted PF or whole net profit, so that may need switching.
- **Stage timestamps only exist going forward.** Jobs predating the feature can't
  be timed; production-speed averages stay empty until new jobs flow through.
- **Untested write paths**: saving a corrected stage time, saving a customer
  phone, and recording an old-debt payment (no customer has old debt set).
