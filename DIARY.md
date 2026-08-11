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
