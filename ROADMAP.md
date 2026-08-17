# Roadmap

Milestones for Group Money Counter. Spec lives in [DESIGN.md](DESIGN.md); the running
record of decisions and dead ends lives in [DIARY.md](DIARY.md).

Each milestone leaves the app in a working, shippable state. Risky unknowns are
front-loaded — M0 can invalidate the plan, so it goes first.

**Status:** M0 deployed, its seven-day storage check still running. M1–M3 complete —
169 tests passing. Next: M4, QR sync.

---

## M0 · Scaffold and the storage gate

> **Done when:** a hello-world PWA is live on GitHub Pages, installed on a real iPhone home
> screen, and IndexedDB data written to it has survived more than 7 days untouched.

This milestone exists to answer one question before any real work depends on the answer.

### Toolchain
- [x] Vite + React + TypeScript project
- [x] Vitest + fast-check
- [ ] Prettier, ESLint
- [x] Test forbidding ambient reads and outside imports in `src/core/` — `src/core/purity.test.ts`

### Shipping
- [x] `vite-plugin-pwa`, manifest, icons, `registerType: 'autoUpdate'`
- [x] Vite `base` set to `/group-money-counter/` for Pages
- [x] GitHub Actions workflow building and deploying to Pages
- [x] Decide navigation — hash routing. Pages has no server-side rewrite, so history routing
      would need the `404.html` trick, and hashes keep the phone's back gesture working
- [x] Build assertion that fails CI if `dist/` contains any external URL or network call —
      `scripts/check-offline.mjs`

### Foundations
- [x] `idb` wrapper with `events` and `meta` stores, index `by-group-hlc`
- [x] `deviceId` generated once and persisted
- [x] HLC: encode, decode, send, receive — plus property tests

### The gate
- [x] Debug screen writing a timestamp to IndexedDB and displaying how long ago it was written
- [ ] Install to iPhone home screen, write data, leave untouched
- [ ] **Check after 7+ days. Record the result in DIARY.md.**
- [ ] Same check on Android for comparison

---

## M1 · Domain core, no UI

> **Done when:** every property test in DESIGN.md §10 passes, and `src/core/` imports nothing
> from the browser.

Pure functions only. Every interesting bug in this project lives here.

### Modules
- [x] `types.ts` — model from DESIGN §2
- [x] `events.ts` — Event union, envelope construction, merge, canonical ordering
- [x] `fold.ts` — union by id, sort by HLC, replay, tombstone set
- [x] `apportion.ts` — largest remainder with memberId tiebreak
- [x] `split.ts` — the three modes reduced to per-member shares
- [x] `balances.ts` — net per member
- [x] `settle.ts` — greedy simplified, plus unsimplified per-expense matrix

### Validation
- [x] `payers` amounts sum to `totalCents`
- [x] `exact` split amounts sum to `totalCents`
- [x] weights non-negative, sum > 0
- [x] `totalCents > 0`
- [x] Split references only members that exist
- [x] `date` is a real calendar day — checked arithmetically, not via `Date`

### Property tests
- [x] `fold(shuffle(events)) === fold(events)` ← the important one
- [x] `Σ apportion(total, weights) === total`
- [x] `Σ net === 0`
- [x] Applying the settle-up plan zeroes every balance, both modes
- [x] Delete-then-update leaves it deleted
- [x] Merging a log with itself is a no-op
- [x] Merge is order-independent in both directions
- [x] Simplified plan never exceeds n−1 transfers

---

## M2 · Single-device app

> **Done when:** you can run a real trip through it solo and the numbers are right.

Useful as a bookkeeper's tool at this point, with no sync at all.

### Plumbing
- [x] Store layer: load events → fold → reactive state
- [x] `append(event)` action: write to IDB, refold, re-render
- [x] Money input that accepts `12,50` and `12.50`, mobile numeric keyboard, stores cents
- [x] Currency display via `Intl.NumberFormat` — display layer only, never `src/core/`

### Screens
- [x] Create group — name, currency, members
- [x] Member management, including deactivate
- [x] Expense form — description, amount, date, payer(s)
- [x] Split editor: equal — member checkbox list
- [x] Split editor: shares — live preview of each person's amount
- [x] Split editor: percent — proportional, with a note when it isn't 100
- [x] Split editor: exact — amount fields with a running "left to assign"
- [x] Multi-payer toggle, hidden by default
- [x] Expense list grouped by date
- [x] Expense detail, edit, delete
- [x] Balances screen
- [x] Settle-up screen with the simplify toggle
- [x] Record a settlement, and undo one

---

## M3 · Export and import

> **Done when:** a ledger can round-trip through a JSON file and out to a second device.

Ships backup, and exercises the merge path on real data before QR exists.

- [x] Export `{ format: "gmc/1", … }` as a file download
- [x] Import via file picker → merge → summary
- [x] Merge summary — "added N expenses and M people" (reused by M4)
- [x] Format version check with a clear refusal on mismatch
- [x] Structural validation of untrusted events — `isEnvelope` / `isEvent` in core, so a
      hand-edited file cannot poison an append-only log. M4 reuses this for scanned frames
- [x] All-or-nothing import: a damaged entry is named and nothing is stored
- [x] Refuse a backup belonging to a different group, until multiple groups exist

---

## M4 · QR sync

> **Done when:** two physical phones converge to identical balances in under 30 seconds,
> with airplane mode on.

- [ ] CBOR + deflate encode/decode of the event array
- [ ] Frame chunking, header, magic, version, 4-byte group prefix
- [ ] Measure real frame counts against a realistic trip; tune chunk size
- [ ] QR rendering to canvas, target version 27 / ECC M
- [ ] Animated frame loop at ~4 fps, cycling indefinitely
- [ ] Camera capture via `getUserMedia`
- [ ] Decode: `BarcodeDetector` where available, `zxing-wasm` fallback for Safari
- [ ] Frame collection with `3 / 5` progress
- [ ] Two-pass guided flow with the "now swap" prompt
- [ ] Version mismatch and wrong-group handling
- [ ] Round-trip property test through framing
- [ ] **Real two-device test, airplane mode, both directions**
- [ ] Test in bad light and at an awkward angle — tune density if it struggles

---

## M5 · Duplicate review

> **Done when:** the same dinner entered on two phones surfaces as one prompt, not two rows.

- [ ] Candidate detection per DESIGN §8
- [ ] Review list: keep both / delete this / delete that
- [ ] Persist dismissed pairs in `meta` so they aren't re-flagged every sync
- [ ] Surface the count in the post-merge summary

---

## M6 · Polish

> **Done when:** you'd hand it to a friend without explaining anything first.

- [ ] Multiple groups and a group picker
- [ ] Confirmation step when a scan would create a new group
- [ ] Add-to-home-screen guidance, especially the iOS Share-sheet path
- [ ] Backup nagging — prompt on a schedule, and after large changes
- [ ] Empty states, error states, loading states
- [ ] Keyboard and screen-reader pass
- [ ] README with screenshots and the privacy claim stated plainly
- [ ] Licence

---

## Later

- [ ] Multi-currency, with the FX rate captured on the expense at entry time
- [ ] Refunds and negative amounts
- [ ] Expense categories and a per-category summary
- [ ] Recurring or templated expenses
- [ ] Snapshot cache in IDB, if the event log ever exceeds ~5,000 events
- [ ] Reconsider encryption at rest if the threat model changes
