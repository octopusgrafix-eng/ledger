# Working notes for Claude

Read the [README](README.md) first for what the app is, how it deploys, and how
storage and sign-in work. This file is the working context that isn't obvious from
the code: conventions, traps, and where things stand.

## Shape of the thing

Two self-contained pages, no build step, no dependencies. Edit them directly.
Each is one IIFE: state, render functions, handlers.

- **`index.html`** (~330KB) — the owner's ledger.
- **`staff.html`** (~60KB) — the shop-floor app: chat, job cards, print files,
  clock. Installs as a *separate* desktop PWA via `staff-manifest.json`.

`sw.js` is shared by both and the icons sit beside them. `firestore.rules` is the
real security boundary between the two.

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

## The staff app and the wall between it and the books

Two Firestore trees, and the wall between them is the entire security design:

```
ledgerData/{ownerUid}     the books. No rule anywhere grants staff any access.
shops/{ownerUid}/…        members, joinRequests, messages, tasks, shifts
staffIndex/{uid}          which shop a signed-in person belongs to
```

`shopId` is always the owner's uid, which is what ties a workspace to a set of
books without exposing them. **A job card carries the spec, customer name, due
date and artwork — never the price, payments or debt.** If you add a field to a
pushed task, check it isn't money.

**Staff write access is pinned by key set, not by trust.** `firestore.rules`
allows a member to change only `stage`, `acceptedBy*`, `staffUpdate`,
`staffNote`, `doneAt`, `updatedAt` on a task. Adding a staff-writable field means
editing that `hasOnly([...])` list too, or the write is rejected server-side with
no clue in the UI.

**The two-way job sync is one-directional by construction.** Staff write
`staffUpdate` with a monotonic `rev`; `applyStaffJobUpdates()` in the ledger
compares it against `job.staffRev` and skips anything already applied. The ledger
never writes back to the task, so there is no loop to break. Verified: replaying
a rev is a no-op, an older rev is ignored, `ACCEPTED` sets the operator without
touching status. Keep that property if you touch it.

**Staff can never set DELIVERED** — it's tied to collecting the balance. The
mirror only accepts `IN PRODUCTION` and `READY`.

**A job can be reserved for one person** via `assignedTo` / `assignedToName`.
Empty means anyone may take it. The enforcement is in `canAdvance` in
`renderJobCard()` — but the *real* guarantee is that `assignedTo` is absent from
the `hasOnly([...])` key set in `firestore.rules`, so a staff member cannot
reassign a job to themselves however the client behaves. Reserved jobs stay
visible to everyone (the floor should know a job is covered) and sort to the top
of the assignee's list. The owner's reassign dropdown only appears while
`stage === 'SENT'`; after acceptance it would just create a second apparent owner.

**The send dialog repaints itself.** Adding a picture or changing the assignment
replaces the whole modal, so anything typed is lost unless `capture()` writes the
fields back into the closure vars first — `note` and `assignTo` live outside
`paint()` for exactly that reason. This is the same trap as the Pending search
losing focus; it bit once here already.

**A snapshot arriving mid-typing must not repaint.** `applyStaffJobUpdates()`
checks `document.activeElement` and skips `renderAll()` if a field is focused —
state is already correct, the next natural render shows it. Same class of bug as
the Pending search losing focus.

**`teamUnread` is a hoisted `var` on purpose.** `renderTabs()` is defined ~3400
lines above the `const team` object and reads the badge count. A `const` read in
its dead zone throws — and `typeof` does *not* save you from that, which is what
the first attempt got wrong.

**There is no file storage, on purpose.** Cloud Storage wants the Blaze plan and
a card; the owner chose not to. Pictures ride *inside* the Firestore document as
a data URI, which is why `makeAttachment()` exists in both files (duplicated —
no build step, that's the project).

The budget is not decoration. A Firestore document dies at 1 MiB and base64
inflates by a third, so `ATTACH_BUDGET` is 400KB per picture and `TASK_BUDGET`
700KB per job card, checked *before* the write so an over-budget card is refused
in the dialog rather than bouncing off the server. `shrinkImage()` pulls two
levers in order — scale to ≤1200px, then walk JPEG quality 0.82→0.4 — and
retries at 70% of the dimension if quality alone can't get there. Verified worst
case: a 4000×3000 pure-noise PNG (the hardest input JPEG can be handed) lands at
358KB in ~2s. Real photos are a fraction of that.

Two traps in that code:
- **The white `fillRect` before `drawImage` is load-bearing.** JPEG has no alpha,
  and logos arrive as transparent PNGs — without the fill they come out on black.
- **`window.open()` on a `data:` URI is blocked by the browser.** Clicking a
  picture must open an overlay (`openImageOverlay`, and the staff app's lightbox),
  never a new tab. `<a download>` on a data URI does work.

These are **previews and are labelled as such** in both apps. Don't let anything
in the UI imply a staff member can print from them.

**The service worker's navigation handler is load-bearing now.** It serves two
shells by path. Answering a `staff.html` navigation with `index.html` would hand
a staff member the ledger's sign-in screen. Bump `CACHE_VERSION` when either
shell's asset list changes.

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

## Testing the staff app without the owner's password

Same trick as the target harness. Copy `staff.html` to `_staff-test.html` **inside
the project folder**, and inject a seed block just before `(async function boot(){`
that assigns `me`, `shopId`, `shopName`, `myName`, `myRole`, fills `messages` /
`tasks` / `shifts` with plain objects (use `{toDate:()=>new Date(...)}` where a
Firestore Timestamp is expected), stubs `subscribeAll = function(){}` and
`askNotifyPermission = function(){}`, then calls `startApp(); renderChat();`.
Guard the real `boot()` behind the same flag so Firebase is never contacted.
Delete the copy afterwards — neither test file is gitignored.

For the ledger's Team tab, seed `index.html` the same way and additionally stub
`teamReady = function(){ return true; }`, set `team.shop`, and fill `team.members`
/ `requests` / `messages` / `tasks` / `shifts`. Stub `save` too, or the harness
will attempt a real (unauthenticated, therefore denied) Firestore write.

**The preview pane really does serve stale bytes here.** A `location.reload()`
silently returned the previous session's page and the mirror test "passed" with
results that were impossible for its first assertion. `preview_start` with a
changed query string forced a genuinely fresh load. If a result looks impossible,
suspect the cache before the code.

## Open items

- **The staff app needs `firestore.rules` published before it does anything.**
  Then press *Open the shop floor* on the Team tab. Until the rules are live,
  approving someone fails with a permission error the UI reports but can't fix.
- **Untested against a real second account.** Every render path in both apps was
  exercised against seeded data; the mirror logic was verified directly
  (idempotent replay, stale-rev rejection, `ACCEPTED` not touching status); and
  the image shrinker was measured on real and worst-case inputs. What has *not*
  run is a genuine two-account round trip: join request → approve → send a job →
  accept → watch the ledger update. That needs a second Firebase account and
  published rules. Do it once before the shop relies on it.
- **Cloud Storage was considered and rejected** (needs Blaze and a card).
  Cloudinary's free tier was the alternative if previews ever stop being enough —
  25GB, no card, but files become public-by-URL, which loses the membership
  gating the current design has for free.
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
