# Development diary

The running record of this project: what got built, what got decided and why, what was
tried and abandoned, and what's still nagging.

**How this file works**

- [DESIGN.md](DESIGN.md) is the *spec* — what's true now. This file is the *history* — how
  it got that way. When a decision changes the spec, update DESIGN.md **and** log it here.
- Entries are chronological, newest at the bottom. Append, don't rewrite.
- Decisions get an ID (`D1`, `D2`, …) and a row in the index below, so they can be cited
  later and reversed on purpose rather than by accident.
- Write down the things that *didn't* work too. The reason an option was rejected is the
  most expensive thing to rediscover.

---

## Decision index

| ID | Decision | Why | Entry |
|---|---|---|---|
| D1 | No network of any kind; sync by QR code | Privacy is the product. NFC and Bluetooth were investigated and are not available to a web app — see entry 1 | 1 |
| D2 | Installable PWA on GitHub Pages | One codebase for iOS, Android and desktop; no app store; static hosting means no server to keep alive | 1 |
| D3 | Anyone can enter an expense for anyone | Matches how groups actually behave; forces real multi-writer merge | 1 |
| D4 | No attachments, no receipt photos | Removes the only payload QR can't carry, and the only real storage pressure | 1 |
| D5 | Event-sourced log, HLC ordering, union merge | Makes merging two phones a set union instead of a conflict-resolution problem | 1 |
| D6 | Deletion is absorbing — a tombstone can't be undone by a later update | Otherwise a deleted expense reappears after a sync, which reads as a broken app | 1 |
| D7 | Integer cents, largest-remainder apportionment, `memberId` tiebreak | Splits must sum exactly and be identical on every device; a positional tiebreak desyncs silently | 1 |
| D8 | `payers` is a list from day one | Widening it later is a migration on data held on other people's phones, which can't be run | 1 |
| D9 | Percent is stored as weights with a display hint | One code path for all proportional splits; 33.33% never round-trips lossily | 1 |
| D10 | `date` is a calendar-day string, not a timestamp | Otherwise a 00:30 expense in Rome lands on the previous day in London | 1 |
| D11 | Members deactivate, never delete | An expense referencing a missing member is a corrupt ledger | 1 |
| D12 | Greedy settle-up, deliberately not optimal | True minimisation is NP-hard; greedy is within a transfer or two and shouldn't be "fixed" | 1 |
| D13 | Import uses the same merge path as QR sync | The riskiest code then runs every time anyone takes a backup | 1 |
| D14 | No encryption at rest in v1 | Threat model is a lost phone, not a forensic adversary. Revisit if that changes | 1 |
| D15 | Single currency per group in v1 | Offline means no rate lookup; doing it properly needs per-expense captured rates | 1 |
| D16 | `deviceId` is 16 hex chars, not a UUID | It is embedded in every HLC and every event id, so it repeats thousands of times in a log that must fit through a QR code | 2 |
| D17 | HLC takes the wall clock as a parameter | Keeps `src/core` pure and lets tests drive time directly, including clocks that run backwards | 2 |
| D18 | Purity is enforced by a test that scans the source, not by convention | A silent determinism bug can't be caught by review reliably; `src/core/purity.test.ts` bans the ambient reads outright | 2 |
| D19 | HLC counter overflow rolls into the next millisecond | Throwing would brick the app on an event no user could have caused; rolling stays monotonic and self-corrects | 2 |
| D20 | `appendEvents` skips existing ids rather than overwriting | Events are immutable, so a same-id row is identical — and a corrupted incoming copy can never clobber a good local one | 2 |
| D21 | No CRDT library — plain HLC-ordered replay | Expenses are created by one person and edited by almost nobody; LWW falls out of ordered replay for free. Revisit only if real concurrent editing appears | 1 |
| D22 | modulePreload polyfill off, Workbox runtime inlined | Both existed only to make `check-offline` pass with fewer exceptions; a bundle with zero `fetch(` is easier to keep honest than one with an allowlist | 2 |
| D23 | Unsimplified mode settles **per expense**, not per member | Apportioning each debtor's share back across payers independently doesn't reconcile with what payers actually contributed; within one expense the nets provably sum to zero | 3 |
| D24 | ~~Folded state is sorted by id~~ **reversed in entry 9** — ordered by first appearance | Insertion order after an HLC-sorted replay is equally deterministic and replicated, and sorting by random hex ids showed members in arbitrary order | 3, 9 |
| D25 | Zero-weight members never receive a leftover cent | Someone explicitly assigned no share being handed a stray cent is a visible bug, not a rounding detail | 3 |
| D26 | Sequence numbers are derived from the log, not stored | Removes a counter that could drift out of step with the events it describes | 3 |
| D27 | Test fixtures live in `src/testing/`, outside core | The purity guard scans all of `src/core`, and the fixture generator exists to produce randomness | 3 |
| D28 | Hash routing | GitHub Pages has no server-side rewrite, so history routing needs the `404.html` trick; hashes never reach the server and keep the phone's back gesture working | 4 |
| D29 | Module-level store with `useSyncExternalStore`, no React context | There is exactly one ledger per app; a provider tree buys nothing and costs re-render care | 4 |
| D30 | Percentages that don't total 100 are divided proportionally, with a note | Blocking the save mid-typing is worse than showing what will happen; the maths is proportional either way | 4 |
| D31 | The HLC is rebuilt from the highest stamp in the log at startup | No second piece of persisted state that could drift out of step with the events it describes | 4 |
| D32 | Screens have jsdom render smoke tests | Six screens were written without ever being run; typechecking cannot see a crash on an empty list | 4 |
| D33 | A separator with exactly three digits after it is a grouping mark | `1.234` is far more often a thousand than 1.23; four or more digits is read as a decimal instead | 4 |
| D34 | Payer is picked with name chips, falling back to a dropdown above 8 people | A dropdown costs two interactions and a visual search for the single most common field in the app | 5 |
| D35 | Nothing from outside the device enters the log unvalidated | The log is append-only: a malformed event can never be edited out, only superseded, and a bad split throws every time balances are computed | 6 |
| D36 | Import is all-or-nothing | Half-importing a damaged file leaves a ledger that looks complete and quietly isn't | 6 |
| D37 | `merge()` reports what changed, not just how many events moved | "Added 6 expenses" is the sentence the user needs; M4's post-scan summary needs the same numbers | 6 |
| D38 | Importing a backup from a different group is refused | Its events would be stored but invisible until multi-group lands, which reads as data loss | 6 |
| D39 | `merge()` stays mechanical; whether a log *should* merge is the caller's call | An import and a QR scan need to ask the user different questions about the same situation | 6 |
| D40 | iOS is a first-class target; no aggressive backup nagging needed | The home-screen storage exemption was verified on real hardware over 8 days, not assumed from documentation | 7 |
| D41 | JSON + deflate, not CBOR — reversing the spec | Measured on a realistic trip, CBOR was 1.9% smaller after deflate. Deflate already collapses the repeated keys CBOR exists to avoid | 7 |
| D42 | Frames carry the total, and the sender loops forever | A scanner learns the count from whichever frame it catches first, and a missed frame simply comes round again — which removes all handshaking | 7 |
| D43 | A changed frame total resets the collector instead of failing | The other phone adding an expense mid-scan is ordinary, not an error | 7 |
| D44 | Base45 payloads in QR alphanumeric mode, not raw byte mode | `BarcodeDetector` hands back a string, which binary cannot survive. Base45's alphabet *is* QR's alphanumeric set: ~3% overhead against 33% for base64 | 8 |
| D45 | jsQR, not zxing-wasm — reversing the roadmap | zxing-wasm fetches its `.wasm` from a CDN by default. "We remembered to configure it" is a weaker guarantee than "it cannot phone home", and 40 KB beats a megabyte | 8 |
| D46 | 800-byte frames (QR v23), not 1100 (v28) | 8 frames instead of 6 costs half a second per cycle; 18% larger modules is what decides whether a camera reads it across a table | 8 |
| D47 | Multiple groups pulled forward from M6 | Sync was unusable without it: a second phone could only ever create its own group, so every sync failed as "different group" | 9 |
| D48 | Export and sync send only the active group | Handing someone your ledger must not hand them every other trip on the phone | 9 |
| D49 | A scan carrying an unknown group is an arrival, not an error | It is how a second trip gets onto a phone; refusing it was the bug, not the safeguard | 9 |
| D50 | Groups are listed in creation order, not by id | `groupsIn` sorts by id for canonical determinism, but ids are random hex, so the visible list order was arbitrary | 9 |
| D51 | Folded members, expenses and settlements come back in first-appearance order | Reverses D24. Replay is HLC-ordered, so insertion order is identical on every device — deterministic *and* meaningful, where random ids were only the former | 9 |
| D52 | Every colour derives from one `--hue`, set from the group id | The hue is replicated for free, so both phones show the same colour for the same group — colour becomes a shared name for the trip, not a local preference | 10 |
| D53 | Semantic colours do not follow the group hue | Money owed must stay red and money due green whatever the accent is; an accent that looks like a warning is worse than a dull one | 10 |
| D54 | Undo is a delayed write, not a reversing event | Deletion is absorbing (D6) and must stay so, or deleted expenses reappear after a sync. Nothing is written until the window closes | 10 |
| D55 | Gestures are never the only route | Swipe-to-delete and swipe-to-switch both have visible buttons behind them; a hidden gesture is undiscoverable and unusable with a keyboard | 10 |
| D56 | Deleting a group is a local purge, not an event | The log is append-only and there is no way to reach another device's copy. Anything else would be a lie about what deletion can do | 11 |
| D57 | Hashes use `Math.imul` and a murmur3 finalizer | Plain `*` in JavaScript is float64: an FNV product exceeds 2^53 and the low bits round away — exactly the bits a power-of-two modulo reads | 12 |

---

## Entry 1 — 2026-08-11 · Brainstorm and design

Starting point: a Tricount-style expense splitter that is genuinely private and doesn't
depend on anyone's server. Empty directory, no code yet.

### The central tension

Tricount's whole value is shared state, and "no server" collides with that head-on. Mapped
four ways to share without one, in increasing order of effort:

1. **Bookkeeper model** — one person owns the ledger, everyone else gets a read-only export.
   Zero sync code.
2. **Shared folder as transport** — each device writes its own append-only file into an
   existing iCloud/Dropbox/Syncthing folder. No two devices write the same file, so there
   are no write conflicts at all. Highest value per line of code.
3. **LAN sync** — mDNS discovery on the same WiFi. Needs native; useless once someone flies
   home.
4. **Full CRDT over any dumb transport** — the technically correct answer.

Chose a fifth path once the constraint was tightened: **nothing leaves the device at all**,
which rules out even the shared folder. → **D1**, **D3**.

### NFC: investigated, rejected

The idea was appealing — tap two phones together once a day and let them merge silently. It
fails twice over, independently:

- **On the web.** Web NFC (`NDEFReader`) is Chrome-on-Android only. Safari has no NFC API
  at all, so an iOS PWA can never have it.
- **On NFC itself.** Phone-to-phone NFC transfer was Android Beam, and Google **removed it
  in Android 10** (2019). iOS never had a peer-to-peer NFC mode — the iPhone's NFC reads
  tags and does Apple Pay. Modern "tap to share" (AirDrop, Quick Share) uses NFC or BLE
  only as a discovery ping and moves the bytes over WiFi Direct; that handshake isn't
  exposed to apps on either platform.

Web Bluetooth doesn't rescue it either: no Safari support, and a browser can only act as a
BLE *central*, never advertise as a peripheral — so two browsers structurally cannot talk
to each other over it.

**Landed on QR codes instead.** Air-gapped, works on every platform, no pairing, and you
can literally see the data moving. Dropping photos (**D4**) removed the only payload QR
couldn't carry, which is what made this clean rather than a compromise.

Rough sizing that made it viable: an expense event is ~40–60 bytes after CBOR and deflate,
so a 200-event trip is ~10 KB, or four or five QR frames. Looping the frames indefinitely
removes all handshaking — a missed frame just comes back around.

### Merge design

With everyone writing (**D3**), real multi-writer merge is unavoidable. Went event-sourced
(**D5**). The neat part: since events are immutable and carry `${deviceId}:${seq}` ids,
merging is a **set union** — idempotent, commutative, associative. Sync in any direction,
any number of times.

Deliberately skipped Automerge/Yjs. For this domain — expenses created by one person and
edited by almost nobody — replaying an HLC-sorted log gives last-writer-wins for free,
without a per-field clock or a CRDT dependency. Revisit only if real concurrent editing
shows up.

### The thing that surprised me most

The dangerous conflict isn't two people editing one expense — that essentially never
happens. It's **two people both entering the same dinner** because neither knew the other
had. Merge handles it perfectly correctly, produces two expenses, and the app looks broken.
That's why duplicate detection (M5) is a real feature and not polish.

### Also worth remembering

- **Determinism is the whole ballgame.** If two phones give the leftover cent from a €10/3
  split to different people, balances drift apart and *nothing ever tells you*. Hence
  **D7** and the `fold(shuffle(events)) === fold(events)` property test.
- **iOS storage is an open risk.** Safari purges script-writable storage after 7 days of
  non-use, but home-screen web apps are documented as exempt. The whole plan rests on that
  exemption, so M0 is structured to verify it before anything depends on it.
- The privacy claim is falsifiable by a single stray import, so CI gets a build assertion
  that fails on any external URL in `dist/`.

### Produced

- [DESIGN.md](DESIGN.md) — full spec
- [ROADMAP.md](ROADMAP.md) — milestones M0–M6
- This file

### Next

M0. The iPhone storage probe is the gate — it can invalidate the plan, so it ships before
anything real is built on top of it.

### Open threads

- Multiple groups in v1 or v2? Schema already carries `groupId`, so deferring is free, but
  the picker is easier to design in than retrofit.
- Any QR scan currently creates a group locally — elegant, no invite flow needed, but it
  should probably confirm first.
- Editing an expense after settling up invalidates transfers people have already made.
  Allow with a warning, most likely, but it needs a decision before someone hits it.

---

## Entry 2 — 2026-08-11 · M0: scaffold and the storage gate

Repo initialised, M0 built. Tests and build are green; the gate itself is now waiting on
real time to pass.

Landed on React 19, Vite 8, TypeScript 7, Vitest 4. Scaffolded by hand rather than from the
Vite template — the template ships a demo counter, two SVG logos and a stylesheet that would
all have been deleted immediately.

### The HLC came out cleaner than expected

Writing it pure forced a good shape: `hlcSend(local, wallMillis)` and
`hlcReceive(local, remote, wallMillis)` take the clock as an argument rather than reading
it (**D17**). Tests can then drive time directly — including the case that actually matters,
a wall clock that jumps *backwards* after an NTP correction. The property
"`hlcSend` always returns something strictly greater than its input, for any wall clock" is
one line to state and covers the whole class.

The encoding earns its keep too: fixed-width millis and hex counter mean lexicographic
order *is* semantic order, so ordering the log is a plain string sort and IndexedDB can
index it directly. That's a property test rather than a comment.

Shortened the device id to 16 hex characters (**D16**). It looked like a detail until I
noticed it appears in every HLC *and* every event id — so it's repeated twice per event in
a payload that has to fit through a QR code. A UUID would have been ~2.5x the bytes for no
benefit; it only ever needs to be unique, never stable or meaningful.

### The offline check found four things, which is why it exists

`scripts/check-offline.mjs` scans `dist/` and fails the build on any external host or
network API. First run flagged four hits — and the useful part was that only one was noise:

| Hit | Verdict |
|---|---|
| `fetch(e.href)` | **Real.** Vite's modulepreload polyfill. Same-origin only, but unnecessary for our targets — disabled it |
| `importScripts` in `sw.js` | **Real construct.** Workbox pulling in its own runtime chunk — inlined it instead |
| `bit.ly` | Inert. A `console.warn` string in Workbox's precache controller. `mode: 'production'` did *not* strip it. Allowlisted |
| `react.dev` | Inert. React builds a docs URL into its minified error messages. Allowlisted |

Fixed three rather than allowlisting them (**D22**). The allowlist now has three entries,
each with a written reason, which is small enough to stay meaningful. If it ever grows past
a handful, the check has stopped being a check.

Also verified the purity guard fails when it should — temporarily added `Date.now()` and
`Math.random()` to `hlc.ts` and confirmed the error names both. A guard that has never
failed is not known to work.

### Produced

- Scaffold, PWA config, Pages workflow
- `src/core/hlc.ts` + property tests, `src/core/purity.test.ts`
- `src/db/database.ts`, `src/db/device.ts`
- `src/screens/StorageProbe.tsx` — the gate
- `scripts/check-offline.mjs`, `scripts/make-icons.mjs`
- 17 tests passing, build clean

Icons are generated by a zero-dependency script that writes PNGs directly — CRC32, zlib,
PNG chunks. Slightly absurd, but it means no image toolchain, no binary blob whose
provenance is unclear, and the icon is reproducible from source.

### Deployed

Live at **https://pippodima.github.io/group-money-counter/** as of 2026-08-11. Public repo,
Pages building from the Actions workflow, HTTPS enforced. First run was green: tests, type
check, build and the offline check all passed in CI.

The clock on the seven-day gate starts when the app is first opened from the iPhone home
screen — **not** from the deploy. Earliest meaningful reading: 2026-08-18.

### Next

Install on iPhone from the home screen, open once, then **leave it alone for more than
seven days**. The probe screen shows how long the data has survived and whether the launch
was standalone. Record the outcome here.

M1 can start in parallel — it's pure domain code and doesn't depend on the gate's answer.
But nothing that persists user data should ship until the gate reports back.

### Still unresolved

- Prettier and ESLint not set up yet.
- Navigation approach still undecided; deferred to M2, when there's more than one screen.
- Event sequence numbers: planning to derive `seq` from the highest existing local event
  rather than storing a counter, so there's no second thing to fall out of sync. Not built
  yet.

---

## Entry 3 — 2026-08-11 · M1: the domain core

M1 done. 94 tests passing, typecheck and build clean. No UI, no persistence — everything
here is a pure function of an event set.

Modules: `types`, `events`, `fold`, `apportion`, `split`, `balances`, `settle`, `validate`.
Test fixtures went in `src/testing/` rather than core (**D27**) — the purity guard scans all
of `src/core`, and the fixture generator's whole job is producing randomness.

### The property test earned its keep on day one

`arbLedger` generates random *valid* ledgers — payer amounts and exact splits are built
through `apportion`, so they always sum to the total. The properties then assert things
that must hold for any ledger at all.

Within minutes it found a real bug in unsimplified settle-up. The counterexample, after
fast-check shrank it 45 times:

    m0 pays 4605, m1 pays 27627, split equally between them

Balances said m0 owed **11511**. `pairwise` produced **11510**.

The cause: the original version took each debtor's share and apportioned it back across the
payers independently, then dropped self-debt. Those separate roundings don't sum to what
each payer actually contributed — 4605 came out as 4606 across two apportionments, and the
stray cent disappeared along with the self-debt.

Fixed by settling **per expense** (**D23**). Within a single expense the amounts paid and
the shares owed both sum to the total, so the members' net positions sum to exactly zero
and clear with whole cents. Debts accumulate across expenses; opposing pairs cancel; nothing
routes through a third party. All the hand-written scenario tests still passed unchanged,
which was reassuring — the fix was to the arithmetic, not the semantics.

This is exactly the class of bug the design doc warned about: a one-cent divergence, no
error, no crash, and two phones quietly disagreeing forever. No scenario test I'd have
thought to write would have caught it. It needed a multi-payer expense whose proportional
split lands precisely on a .5 boundary.

### The other thing the tests caught was my own test

A property comparing apportioned shares to their exact values failed on
`total=1, entries=[["!",0],[" ",1]]`. The code was right; the test compared
`[...map.values()]` positionally against an array built in *input* order, and `apportion`
returns members in canonical sorted order. Rewrote it to compare by member id.

Worth noting because it's the same trap the production code has to avoid — **positional
assumptions are exactly what breaks determinism** (**D24**). The test made the mistake the
code is designed to prevent.

### Smaller decisions

- Zero-weight members are excluded from the leftover-cent distribution (**D25**). Someone
  explicitly given no share should never be handed a stray cent; it reads as a bug even
  though the total still balances.
- `nextSeq` derives sequence numbers from the log rather than storing a counter (**D26**).
- Date validation is arithmetic, not `Date` — which core can't touch anyway, and which
  would happily accept `2026-02-31` by rolling it into March.

### Two things that bit and are worth remembering

**Vitest doesn't typecheck.** All 94 tests passed while `tsc` had three errors. CI runs both
so it can't ship broken, but locally `npm run test:watch` will happily stay green over
uncompilable code. Run `npm run build` before believing anything.

**The purity guard produced a false positive.** Its import-scanning regex spans newlines to
catch multi-line import lists, and a prose comment containing "export … from" parsed as an
import. Now strips comments before scanning. The ambient-read check already stripped both
comments and strings; the import check needed comments gone but strings kept, so they're
separate passes.

### Next

M2 — the single-device UI. The domain layer is complete and tested, so M2 is wiring: an
IndexedDB-backed store that appends events and refolds, then the screens.

Still open: navigation approach, and Prettier/ESLint.

---

## Entry 4 — 2026-08-12 · M2: it's an app now

M2 done. 133 tests. You can create a group, add expenses across all four split modes, see
balances, and settle up. Still single-device — no sync until M4.

Seven screens, a hash router (**D28**), and a module-level store read through
`useSyncExternalStore` (**D29**). No React context: there is exactly one ledger per app, so
a provider tree buys nothing.

### Two kinds of test, for two kinds of bug

The domain layer had property tests. What those can't see is *wiring* — whether events
actually reach disk, whether the clock survives a restart, whether a screen crashes on an
empty list. So M2 added two suites:

- **Store integration** against `fake-indexeddb`: create, relaunch, merge two devices, check
  they converge. This is where "does it actually persist" gets answered.
- **Screen smoke tests** in jsdom (**D32**), rendering every route against a seeded store.

That second one mattered more than expected, because I wrote six screens without ever
running them. Both suites found real problems immediately.

### The module identity trap

The screen tests kept rendering the *setup* screen even after seeding a group. The cause:
`App` was statically imported at the top of the test file, so it bound to whichever
`ledger.js` instance existed when the file was first evaluated — while `vi.resetModules()`
in `beforeEach` handed the test a *different* instance. Two module graphs, two stores, one
of them invisible.

Fixed by importing `App` dynamically inside the render helper, after the reset. Worth
remembering: **`vi.resetModules()` only affects imports that happen after it**, and a static
import at the top of the file is not one of them.

### The arithmetic caught me out again

I wrote a balances assertion expecting Anna to be up €8.34 on a €12.50 bill split three
ways. Wrong: 1250 / 3 is 417 / 417 / 416, and the two spare cents go to `m0` and `m1` on the
member-id tiebreak. Anna paid the whole thing, so she is up **8.33**.

Second time this milestone-and-a-half that I've written the wrong number and the code has
been right. The largest-remainder tiebreak is not intuitive, which is precisely why it is
pinned down by a test rather than left to judgement.

### Money input

`parseMoney` accepts both decimal conventions, because a group on a trip will genuinely have
phones set to both — `12,50` and `12.50` are the same amount. The awkward case is a lone
separator with three digits after it. `1.234` could be 1,234 or 1.23; resolved toward
grouping (**D33**), since money is rarely written to three places. Four or more digits can't
be grouping, so those read as a decimal with the excess dropped.

### Smaller things

- The storage probe is still reachable at `#/probe`, so the seven-day result can be read
  once the app has a real front page.
- `matchMedia` is now called optionally. jsdom lacks it, which surfaced a real flaw: the
  probe was reporting *any* failure as "IndexedDB could not be opened", including one that
  had nothing to do with storage.
- Percent splits that don't total 100 are divided proportionally with a note (**D30**),
  rather than blocking the save while someone is still typing.
- Members are hidden, never removed — the button says "Hide", and the tooltip explains their
  history stays.

### Next

M3: export and import. Small, and it exercises the merge path on real data well before QR
sync exists. The store already has `merge()` with its own tests, so M3 is mostly file
handling and a summary screen.

Still open: Prettier and ESLint. The seven-day storage gate reads on 18 August.

---

## Entry 5 — 2026-08-12 · First real use, first UX fix

Ran the app on localhost for the first time. One thing came back: **picking who paid was
too slow**. It was a `<select>`, which costs two interactions and a visual search through a
list — for the field touched on literally every expense.

Replaced with name chips (**D34**): every member is a tappable pill, one tap to choose.
Falls back to the dropdown above eight people, where the chips would wrap into an
unreadable block and scanning a list genuinely becomes faster.

Built on real `<input type="radio">` elements with the visuals layered over them, rather
than `<button>`s with `aria-pressed`. Radios are what this actually is — one choice from a
set — so arrow-key navigation and screen-reader grouping come for free instead of being
reimplemented badly.

Two tests added: that the first person is preselected and one tap switches the choice, and
that the dropdown returns above the threshold.

Worth noting for later milestones: this is the kind of problem no test suite finds. The
`<select>` was correct, accessible, and fully covered. It was just slower than it needed to
be, and only using it showed that.

---

## Entry 6 — 2026-08-14 · M3: export, import, and not trusting files

M3 done. 169 tests. There is now a way to get a ledger off the device and back on again,
which until QR sync exists is the only protection against losing everything.

Export writes the event log verbatim. Import runs the same `merge()` the QR path will use —
the point being that the riskiest code in the project now gets exercised every time anyone
takes a backup, rather than only during sync.

A pleasant consequence of merge being a set union: **importing an old backup is always
safe.** It adds back whatever the file still holds and changes nothing else. There is no
"restore" that overwrites, so there is no way to lose today's expenses by importing last
week's file. That falls out of the event-log design rather than being designed in.

### The real work was validation

A backup file can be hand-edited, and the log is append-only — a malformed event cannot be
edited out later, only superseded. Worse, an expense whose `exact` split doesn't sum would
throw *every time* balances were computed, so one bad file would brick the balances screen
permanently.

So `isEnvelope` / `isEvent` went into core (**D35**): structural validation of every event
from outside, down to whether a split's weights are numbers and a date is a calendar day.
M4 reuses this for scanned frames, which was the reason to put it in core rather than in
the backup module.

Import is all-or-nothing (**D36**). A partial import leaves a ledger that looks complete and
quietly isn't, and the refusal names which entry was damaged — *"Entry 2 of 47 is damaged,
so nothing was imported"* — because "invalid file" tells you nothing about what to fix.

The property that mattered most here was the inverse one: **the validator must accept
everything this app produces.** A validator strict enough to reject its own output would
make every backup unreadable, and only fail on someone's real data. It runs over randomly
generated ledgers, including a JSON round trip.

### merge() got more honest

It returned a bare count. Now it reports expenses, settlements and members separately
(**D37**), because "Added 6 expenses and 1 person" is the sentence the user actually needs —
and M4's post-scan summary needs exactly the same numbers.

It stays mechanical about *whether* to merge (**D39**): it stores what it is given. The
caller decides whether a log belongs here, because an import and a scan want to ask the user
different things. The import screen refuses a backup from a different group (**D38**) — its
events would be stored but invisible until multi-group lands, which reads as data loss.

### Next

M4, QR sync. The largest milestone left, and the one the whole design exists to serve.

Still open: Prettier and ESLint. The storage gate reads on 18 August — four days.

---

## Entry 7 — 2026-08-17 · The gate passed, and the spec was wrong about CBOR

### M0's gate: passed

Opened the installed app on the iPhone after **8 days untouched**. The data was still there,
counting from the original write.

So the iOS home-screen exemption from Safari's seven-day storage purge is real, on real
hardware, not just in documentation. That was the assumption the entire project rested on,
and it is the reason M0 was structured as a gate rather than as scaffolding.

Consequences (**D40**): iOS stays a first-class target, and the app does not need to nag
aggressively about backups. Export stays prominent — a deleted home-screen icon still takes
the storage with it — but it can be a reasonable feature rather than a panic button.

Worth being precise about what this proves: the *scheduled* purge does not apply. Deleting
the icon, clearing website data, and storage pressure all still erase everything. The real
durability story remains replication across the group, which is what M4 is for.

### The spec was wrong about CBOR

DESIGN §7 specified CBOR before deflate. Before taking the dependency I measured it on a
realistic two-week trip — 5 people, 120 expenses, 132 events:

| encoding | bytes | per event | frames |
|---|---|---|---|
| JSON | 45,917 | 348 B | 43 |
| CBOR | 38,434 | 291 B | 36 |
| JSON + deflate | 5,616 | 42.5 B | **6** |
| CBOR + deflate | 5,507 | 41.7 B | **6** |

**CBOR wins 1.9% after deflate**, and the same six frames. Deflate already collapses the
repeated JSON keys that CBOR exists to avoid, so the two do the same job and only one of
them is a dependency. Dropped it (**D41**).

The rest of the sizing held up well: ~42 bytes per event against the doc's estimate of
40–60, and six frames against "four or five".

Reversing a spec decision on measurement is exactly what the diary is for. The estimate was
reasonable; it was just made before there was anything to measure.

### Framing

11-byte header: magic `GM`, version, 4-byte group prefix, index, total. The group prefix
catches two phones syncing different trips; the magic rejects a foreign QR code before
anything else is parsed.

Two choices worth recording:

**Every frame carries the total** (**D42**), so a scanner learns how many to expect from
whichever frame it happens to catch first. Combined with the sender looping indefinitely, a
missed frame is not an error — it comes round again. That is what removes all handshaking,
retry logic and protocol state from the design.

**A changed total resets the collector** rather than failing (**D43**). The other phone
adding an expense mid-scan is ordinary behaviour, not a fault.

Frames are validated with the same `isEnvelope` written for M3. A scanned code and a
hand-edited backup are the same problem — untrusted data heading for an append-only log —
which is why that validation went into core rather than into the backup module.

### Next

Steps 3–5 of M4 need hardware: rendering the animated QR, camera capture, and the two-pass
flow. A QR scanner cannot be verified in jsdom; the real test is two phones in airplane mode.

Still open: Prettier and ESLint, and the Android storage comparison.

---

## Entry 8 — 2026-08-23 · M4: sync, built but not yet proven

The QR flow is built and deployed. 200 tests. What remains is the part no test can do:
two phones, a table, and a camera.

### Base45, and why byte mode was wrong

The design doc had frames going into QR *byte mode* as raw binary. That does not survive
contact with `BarcodeDetector` — the fast native decoder on Android — which hands back a
**string**, not bytes. Arbitrary binary interpreted as UTF-8 comes out mangled.

Options were base64 at 33% overhead, or dropping BarcodeDetector entirely and always using a
JS decoder.

Base45 (RFC 9285) is the better answer (**D44**). Its alphabet is *exactly* QR's alphanumeric
charset, which packs two characters into 11 bits. Three characters carry two bytes, so 16
bits of payload cost 16.5 bits of QR — **about 3% overhead**. Same trick the EU Digital COVID
Certificate used, for the same reason. Forty lines and a property test rather than a
dependency, and the RFC ships test vectors to check against.

Confirmed in the measurement: every frame encodes as `Alphanumeric`, not `Byte`.

### jsQR over zxing-wasm

The roadmap named `zxing-wasm`. Reversed it (**D45**) on the deciding fact that **zxing-wasm
fetches its `.wasm` from a CDN by default**. It can be configured not to — but "we remembered
to configure it correctly" is a much weaker guarantee than "it has no network code in it at
all", and this app's entire claim rests on that distinction. It is also ~1 MB against jsQR's
40 KB.

Scanning conditions here are close to ideal anyway: a bright phone screen at arm's length,
flat, high contrast, lit by its own backlight. If real hardware proves jsQR too fussy,
zxing-wasm with a locally bundled binary is the upgrade path — but it should be taken
knowingly, not by default.

### Density: measured, then reduced

Measured QR version against frame capacity, at ECC M:

| bytes | version | grid |
|---|---|---|
| 400 | 15 | 77² |
| 600 | 19 | 93² |
| 800 | 23 | 109² |
| 1100 | 28 | 129² |
| 1400 | 31 | 141² |

The doc aimed at ~1100 bytes / version 27. Went with **800** instead (**D46**). A 132-event
trip needs 8 frames rather than 6 — at 4 fps that is 2 seconds a cycle against 1.5, which
nobody will notice — and every module is 18% larger, which is the thing that actually decides
whether a camera reads it across a table at night. DESIGN §7's own rule, applied to its own
number.

### What the tests cover, and what they cannot

`sync.test.ts` runs two real stores through the entire path: encode, frame, base45, collect
out of order and with repeats, decode, validate, merge, fold. It checks they converge, that
balances agree to the cent, that edits and deletions survive a round trip, and that scanning
the same phone twice is a no-op rather than a duplicate.

What it cannot cover is optics — focus, glare, angle, screen brightness, camera latency.
That is the whole remaining risk in M4, and it needs hardware.

### Cost

Bundle went from 198 KB to 405 KB raw, 63 KB to 136 KB gzipped. `qrcode` and `jsQR` account
for it. Acceptable for a one-time install of a thing that then works forever offline, and
`check-offline` confirms both are inlined with no `.wasm` and no CDN reference.

### Next

Two phones, airplane mode, both directions. Then M5's duplicate review, which only becomes
meaningful once two devices are genuinely writing.

Still open: Prettier and ESLint, and the Android storage comparison.

---

## Entry 9 — 2026-08-24 · The sync bug was a missing door

Reported: syncing always failed with "wrong group". It was not a codec bug. It was a design
error, and an obvious one in hindsight.

`App.tsx` said:

    if (!groupId) return <Setup />;

and `Setup` could only *create* a group. So a second phone's only possible action was minting
its own random group id — after which the guard comparing group prefixes was correct to
refuse, every single time. **There was no way to join.** The safeguard worked; the app left
no way to satisfy it.

Worth recording plainly: the guard was not wrong, and no test would have caught this. Every
test seeded both devices from the same log, because that is the only way the code allowed
them to share a group. The tests faithfully reproduced a situation a user could never reach.

### Multiple groups, pulled forward from M6

The fix is the feature that was already scheduled (**D47**). Once several groups can live on
one device, a scanned group that is not the open one stops being an error and becomes an
arrival (**D49**) — which is exactly how a second trip gets onto a phone.

- A landing screen offering *Start a new group* and *Join someone's group* with equal weight.
- Joining is a scan. There is no invite link because there is no server to host one; the
  first sync *is* the join.
- A scan carrying an unknown group adds it and offers to switch, rather than silently moving
  you off what you had open.
- The active group is remembered, so a relaunch returns to it.

`createGroup` mints the id *before* appending, because `append` files events under the
current group — creating a second group through the old path would have filed its
`group.init` under the first.

### A leak found on the way

`allEnvelopes()` returned the whole log across every group, and both export and sync used it.
Sharing your ledger with one group would have handed them **every other group on the
device** — including ones they have nothing to do with.

Now `activeEnvelopes()` scopes both to the open group (**D48**). Squarely a privacy bug, in
an app whose entire claim is privacy, and it existed only because there had never been a
second group to reveal it.

### A smaller one, caught by the suite disagreeing with itself

The new multi-group test passed alone and failed in the full run. Not flakiness: `groupsIn`
sorts by group id, ids are random hex, so the **visible group order was arbitrary** and
happened to come out right in isolation. My own doc comment claimed "oldest first", which was
simply untrue.

Core keeps sorting by id — that is canonical ordering and determinism depends on it — while
the store now orders for display by each group's earliest event (**D50**). Deterministic, and
actually oldest-first this time.

### And a third, from the same root

CI then failed on the member list coming back `['Sara', 'Anna']` instead of `['Anna',
'Sara']` — passing locally, failing on the runner, purely on the luck of the random ids.

Same cause as the group ordering, one level down. `fold` sorted members by id (**D24**), and
ids are random hex — so the People list and every split editor were showing members in
**arbitrary order**, not the order they were added. A real interface bug that had been
sitting there since M1, invisible because two or three members shuffled is not obviously
wrong to look at.

D24's reasoning was that canonical order must use a replicated key. True, but insertion
order *is* one: events are replayed in HLC order, which every device agrees on, so the order
a Map receives them in is identical everywhere. Nothing positional or local about it.
Reversed to first-appearance order (**D51**), and the shuffle-invariance property test still
guards it — array comparison is order-sensitive, so it would catch any real regression.

Ran the suite five times over to be sure the flakiness was gone, since one green run proves
very little about a bug whose trigger is randomness.

### Next

The two-phone test is now genuinely runnable, which it was not before. Then M5's duplicate
review.

Still open: Prettier and ESLint, and the Android storage comparison.


---

## Entry 10 — 2026-08-24 · Colour, gestures, and an undo that cannot be an event

Three requests from using it: quicker group switching, a colour per group, and swipe-to-delete
with undo.

### One hue, everything else derived

Rather than a palette per group, every colour token now derives from a single `--hue`
(**D52**):

    --ground: hsl(var(--hue) 30% 98.5%);
    --accent: hsl(var(--hue) 52% 29%);

Switching group sets one custom property and the whole app re-tints, light and dark, with no
second palette to maintain.

The hue comes from hashing the group id, which has a property worth having: the id is
replicated, so **both phones show the same colour for the same group**. Colour becomes a
shared name for the trip rather than a local preference — and it costs nothing, because the
id was already there.

Two constraints on the palette. Semantic colours stay fixed (**D53**) — money owed is red and
money due is green whatever the accent is. And hues below ~25° are excluded, because an
accent that reads as a warning is worse than a dull one.

### The undo could not be an event

This one ran straight into **D6**: deletion is *absorbing*, so a tombstone can never be
lifted. That rule is precisely what stops deleted expenses reappearing after a sync, and it is
not negotiable.

So undo is not a reversal — it is a **delayed write** (**D54**). Swiping hides the row and
starts a six-second timer; only when that expires does `expense.delete` reach the log. Undo
cancels the timer, and the log never learns anything happened. If the app is closed inside the
window the deletion is lost rather than applied, which is the safe direction to fail.

### The test found a real bug in it

`flush` ran on unmount and read the outstanding deletion from inside a `setState` updater.
React does not reliably invoke those on a component that is going away — so **navigating off
the screen during the undo window silently did not delete**. The row vanished, the user moved
on, and the expense came back.

Fixed by mirroring the pending value in a ref, which unmount can read without touching React
state. Worth noting the test that caught it was one I only wrote because fake timers had
already forced me to test the commit a different way — closing the undo window with
`vi.useFakeTimers()` stalled every subsequent test, since IndexedDB needs real ones. Testing
"leaving the screen commits" instead turned out to test something far more interesting.

### Gestures with visible handles

Both new gestures have buttons behind them (**D55**). The group switcher has arrows and
position dots and opens the full list on tap; swipe-to-delete has a visually-hidden delete
button that appears on keyboard focus, and the expense editor keeps its own Delete.

A swipe with no affordance is undiscoverable — the request here was for something *more*
intuitive, and a secret gesture is the opposite. It also keeps both features usable without a
touchscreen at all.

Keeping the group name a real `<h1>` needed care: a `<button>` is phrasing content so it nests
inside a heading legitimately, but the reverse is not true.

### Next

Still M5's duplicate review, and the two-phone hardware test.

Still open: Prettier and ESLint, and the Android storage comparison.


---

## Entry 11 — 2026-08-24 · A layering bug, and deleting a group

### The delete background was always showing

Reported: the delete button is visible all the time instead of only while swiping. The
diagnosis was slightly different from the report — what showed was not the hidden button but
the red *background layer* behind each row.

`.swipe-front` had `background: inherit`, which looks right and is not. `inherit` resolves
against the immediate parent, `.swipe`, which sets no background at all — so the front layer
was transparent and the red delete layer beneath showed through permanently. The striping
lives on the `<li>`, two levels up.

Fixed by giving `.swipe-front` an explicit opaque background, matched to the row's parity so
the greenbar banding survives:

    .swipe-front { background: var(--ground); }
    .ledger li:nth-child(odd) .swipe-front { background: var(--band); }

A reminder that `inherit` on `background` is not "look like my surroundings" — it copies one
specific parent's value, and transparent is a value.

### Deleting a group is a purge, not an event

Everything else in this app is an event. Group deletion cannot be (**D56**): the log is
append-only, and there is no way to reach anyone else's copy of it. An event would only mark
the group deleted *here* while still occupying storage, and would spread to other phones as
though it were a shared decision — which it is not.

So `deleteGroup` removes the rows from IndexedDB directly. It is the only destructive
operation in the app, and the only place that touches the database outside the append path.

That makes the honesty of the confirmation the whole design:

> This cannot be undone here — though anyone else still in the group can give it back by
> syncing, and a backup file will restore it.

Both halves matter. It is genuinely irreversible on this device, and it is genuinely not
irreversible in the group. A confirmation that claimed either alone would be wrong. There is
a test asserting exactly that round trip — delete locally, sync with someone who still has
it, watch it return — because the interface makes that promise out loud.

Two-step, never one tap, and it reports how many expenses are about to go.

### Next

Still M5's duplicate review, and the two-phone hardware test.


---

## Entry 12 — 2026-08-24 · The colours were there, the hash was not

Reported: groups still all look green. They did — 44% of them, anyway. The feature worked;
the hash feeding it did not.

Measured over 10,000 random group ids:

| hue | before | after |
|---|---|---|
| green | **4384** | 1226 |
| violet | **3108** | 1275 |
| amber | 630 | 1303 |
| blue | 600 | 1271 |
| indigo | 384 | 1238 |
| olive | 359 | 1270 |
| teal | 272 | 1198 |
| magenta | 263 | 1219 |

Two colours took three quarters of everything between them. Ideal is 1250 each.

### Two bugs, compounding

**`hash * 16777619` is float64 multiplication.** JavaScript has no integer type, so the FNV
product — up to about 7×10¹⁶ against `Number.MAX_SAFE_INTEGER` of 9×10¹⁵ — silently loses
its **low** bits to rounding. `Math.imul` does the 32-bit multiply that FNV actually
specifies.

**`% 8` reads exactly the bits FNV mixes worst.** Even done correctly, FNV-1a's avalanche in
the low bits is weak, and a power-of-two modulo depends on nothing else. Added murmur3's
`fmix32` finalizer, which is what it exists for (**D57**).

The two together were almost perfectly designed to fail: one destroyed the low bits, the
other looked only at them.

### Worth noticing about the failure mode

Nothing threw. No test failed. The code was "working" — deterministic, stable, same colour
for the same group on every device, every property I had thought to assert. It was just
*wrong* in a way only visible in aggregate, and only to someone with several groups in front
of them.

The regression test now checks the distribution rather than any individual value: every
colour used, none taking more than double its fair share. That is the only shape of test that
would have caught this, and it did not occur to me to write it until the bug was in front of
me either.

A reminder that `>>> 0` after an arithmetic multiply looks like it makes something integer
arithmetic and does not — it truncates a value whose precision has already gone.

### Next

Still M5's duplicate review, and the two-phone hardware test.
