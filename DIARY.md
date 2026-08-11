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
| D24 | Folded state is sorted by id, not by date | Canonical order must use a replicated key so the determinism test is meaningful; display order is a view concern | 3 |
| D25 | Zero-weight members never receive a leftover cent | Someone explicitly assigned no share being handed a stray cent is a visible bug, not a rounding detail | 3 |
| D26 | Sequence numbers are derived from the log, not stored | Removes a counter that could drift out of step with the events it describes | 3 |
| D27 | Test fixtures live in `src/testing/`, outside core | The purity guard scans all of `src/core`, and the fixture generator exists to produce randomness | 3 |

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
