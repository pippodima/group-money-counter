# Group Money Counter — Design

A Tricount-style shared expense ledger that runs entirely on-device. No accounts, no
server, no network. Devices reconcile by showing each other QR codes.

---

## 1. Constraints (already decided)

| | |
|---|---|
| **Privacy** | Nothing leaves the device over a network. Ever. |
| **Delivery** | Installable PWA, static hosting on GitHub Pages, added to home screen. |
| **Writers** | Every participant can add expenses, including on behalf of others. |
| **Sync** | QR codes, screen to camera. Air-gapped. |
| **Attachments** | None. No receipt photos, no files. |
| **Identity** | Members are plain names. No accounts, no logins, no keys. |

### Non-goals for v1

- Receipt photos or any binary attachments
- Multi-currency (schema leaves room; UI comes later)
- Real-time sync, LAN discovery, WebRTC
- Encryption at rest (the threat model is a lost phone, not a forensic adversary — revisit if that changes)
- Negative expense amounts / refunds (model a refund as a settlement for now)

### The one thing that is *not* private

The app itself is downloaded from GitHub Pages. Code comes from a server; **data never
does**. To keep that claim literally true, the bundle must contain zero external
references: no CDN, no Google Fonts, no analytics, no error reporting, no map tiles, no
avatar service. See §9 for the build check that enforces it.

---

## 2. Data model

All money is **integer cents**. There is no floating point anywhere in the domain layer.

```ts
type Cents    = number;   // integer, always
type MemberId = string;   // crypto.randomUUID()
type DeviceId = string;   // crypto.randomUUID(), generated once per install
type Hlc      = string;   // sortable clock, see §3
type Day      = string;   // "2026-08-11"

interface Group {
  id: string;
  name: string;
  currency: string;       // ISO 4217, fixed per group in v1
  members: Member[];
}

interface Member {
  id: MemberId;
  name: string;
  active: boolean;        // deactivated, never deleted — history must stay intact
}

interface Expense {
  id: string;
  description: string;
  totalCents: Cents;      // > 0
  date: Day;
  payers: Payer[];        // amounts must sum to totalCents
  split: Split;
  createdBy: DeviceId;    // used for duplicate detection, §7
  deleted: boolean;
}

interface Payer { memberId: MemberId; amountCents: Cents }

type Split =
  | { mode: 'equal';   among: MemberId[] }
  | { mode: 'weights'; weights: Record<MemberId, number>; display: 'shares' | 'percent' }
  | { mode: 'exact';   amounts: Record<MemberId, Cents> };   // must sum to totalCents

interface Settlement {
  id: string;
  fromMemberId: MemberId;   // the person handing over money
  toMemberId: MemberId;
  amountCents: Cents;
  date: Day;
  note?: string;
  deleted: boolean;
}
```

### Why these specific choices

**`date` is a calendar day string, not a timestamp.** If it were epoch millis, an expense
entered at 00:30 in Rome would land on the previous day for a device set to London, and
the two phones would disagree about which day the dinner happened. Days are what people
reason about; store days.

**`payers` is a list, not a single `paidBy`.** Split bills where two people each put in
some cash are common enough, and widening this later is a schema migration on data that
lives on other people's phones — which you cannot run. The UI defaults to one payer
holding the full amount and only reveals the rest on demand.

**`percent` is not a storage mode.** Percentages are weights that happen to sum to 100.
Storing them as weights with a `display` hint means one code path computes every
proportional split, and 33.33% never has to round-trip through a lossy representation.

**Members deactivate, never delete.** An expense referencing a deleted member is a
corrupt ledger. Hide them from pickers; keep them in history.

**`totalCents > 0`.** Negative totals invert the rounding logic in §5 and are worth
handling deliberately later rather than accidentally now.

---

## 3. Event log

Nothing mutates state directly. Every change appends an immutable event, and state is a
pure fold over the sorted log. This is what makes merging two phones tractable.

```ts
interface Envelope {
  id:      string;   // `${deviceId}:${seq}` — globally unique, no coordination needed
  hlc:     Hlc;
  groupId: string;
  body:    Event;
}

type Event =
  | { t: 'group.init';        name: string; currency: string }
  | { t: 'group.rename';      name: string }
  | { t: 'member.add';        memberId: MemberId; name: string }
  | { t: 'member.rename';     memberId: MemberId; name: string }
  | { t: 'member.deactivate'; memberId: MemberId }
  | { t: 'expense.create';    expenseId: string; fields: ExpenseFields }
  | { t: 'expense.update';    expenseId: string; patch: Partial<ExpenseFields> }
  | { t: 'expense.delete';    expenseId: string }
  | { t: 'settlement.create'; settlementId: string; fields: SettlementFields }
  | { t: 'settlement.update'; settlementId: string; patch: Partial<SettlementFields> }
  | { t: 'settlement.delete'; settlementId: string };
```

### Hybrid logical clock

Phone clocks drift, and two devices *will* disagree about which edit came last. A hybrid
logical clock keeps wall-clock meaning (so the log sorts roughly chronologically and is
human-debuggable) while guaranteeing a total order that every device agrees on.

Encode it as a lexicographically sortable string so sorting is a plain string compare and
IndexedDB can index it directly:

```
000001754899200000-0003-a91f4c2e
└── millis, 15 digits ──┘ └cnt┘ └─ deviceId ─┘
```

15 digits of epoch milliseconds is good until the year 33658. The counter is 4 hex digits.
The deviceId tail makes ties deterministic across devices, which matters more than it
sounds — see the determinism rule in §5.

```ts
// local event
function now(s: HlcState): Hlc {
  const wall = Date.now();
  if (wall > s.millis) { s.millis = wall; s.counter = 0; }
  else                 { s.counter++; }
  return encode(s.millis, s.counter, s.deviceId);
}

// on receiving a remote event, before merging it
function observe(s: HlcState, remote: Hlc): void {
  const r = decode(remote);
  const wall = Date.now();
  if (wall > s.millis && wall > r.millis) { s.millis = wall;     s.counter = 0; }
  else if (r.millis > s.millis)           { s.millis = r.millis; s.counter = r.counter + 1; }
  else if (s.millis > r.millis)           { s.counter++; }
  else                                    { s.counter = Math.max(s.counter, r.counter) + 1; }
}
```

### Merge

Merging two logs is a **set union keyed on `Envelope.id`**. Events are immutable, so two
envelopes with the same id are byte-identical and there is nothing to compare or resolve.
Union is idempotent, commutative, and associative — sync as many times as you like, in any
order, from any direction.

### Fold

```
1. Union all events.
2. Sort ascending by hlc.
3. Replay in order.
```

Because the log is replayed in HLC order, **last-writer-wins falls out for free**. There
is no need to store a per-field clock: a later `expense.update` simply overwrites an
earlier one as the fold walks past it.

The one rule that needs explicit handling: **deletion is absorbing**. Keep a tombstone
set; once an id is in it, ignore all further creates and updates for that id. Without
this, an update with a higher HLC than the delete resurrects a deleted expense, and the
user watches something they deleted come back after a sync — which reads as the app being
broken.

Full replay on every load. A busy two-week trip is a few thousand events; folding that is
single-digit milliseconds. Add a cached snapshot only past ~5,000 events, and only if
profiling says so.

---

## 4. Determinism is the core invariant

Every device must fold the same event set into byte-identical state. If two phones compute
different splits from the same events, balances disagree and the app is worthless — and
the failure is silent.

The fold and everything downstream of it must be a **pure function of the sorted event
set**. Concretely, the domain layer may never read:

- `Date.now()`, timezones, or locale
- insertion order, array positions, or `Object.keys()` iteration order
- anything device-local (except `deviceId`, and only where it is part of a replicated value)

Anywhere a tie is broken or a collection is ordered, sort by a **replicated key** — the
`memberId` or `expenseId` — never by whatever order the array happens to be in.

The test that guards this is in §10 and it is the single most valuable test in the project.

---

## 5. Split math

### Largest remainder

€10 split three ways must produce 3.34 / 3.33 / 3.33 — summing to exactly 1000 cents, with
the same person getting the extra cent on every device.

```ts
function apportion(total: Cents, weights: [MemberId, number][]): Map<MemberId, Cents> {
  const W = weights.reduce((a, [, w]) => a + w, 0);
  if (W <= 0) throw new Error('weights must sum to a positive number');

  const rows = weights.map(([id, w]) => {
    const exact = (total * w) / W;
    const base  = Math.floor(exact);
    return { id, base, frac: exact - base };
  });

  let remainder = total - rows.reduce((a, r) => a + r.base, 0);

  // Deterministic: largest fractional part first, memberId as tiebreak.
  rows.sort((a, b) => b.frac - a.frac || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < remainder; i++) rows[i].base++;

  return new Map(rows.map(r => [r.id, r.base]));
}
```

The `a.id < b.id` tiebreak is not cosmetic. Two members with identical weights have
identical fractional parts, and without a replicated tiebreak the extra cent lands on
whoever happens to sort first in that device's array — violating §4.

Mode mapping:

| Mode | Weights passed to `apportion` |
|---|---|
| `equal` | every member in `among` gets weight `1` |
| `weights` | the stored weights, verbatim (shares and percent both land here) |
| `exact` | no apportioning — validate the amounts sum to `totalCents` and use them directly |

`exact` is validated **at entry time** and rejected if it doesn't balance. Never silently
absorb the difference.

---

## 6. Balances and settling up

```
For each non-deleted expense:
    for each payer p:            net[p] += p.amountCents
    for each (member, share):    net[member] -= share

For each non-deleted settlement (A hands money to B):
    net[A] += amount
    net[B] -= amount

Invariant: Σ net === 0
```

Positive net means the group owes you. Negative means you owe the group. That invariant is
a cheap assertion and it catches almost every arithmetic bug the moment it appears.

### Simplified settle-up

Greedy: repeatedly match the largest creditor against the largest debtor and transfer the
smaller of the two magnitudes. Produces at most *n−1* transfers.

```ts
creditors = members with net > 0, sorted by net desc, then memberId asc
debtors   = members with net < 0, sorted by |net| desc, then memberId asc

while both non-empty:
    x = min(creditors[0].net, -debtors[0].net)
    emit transfer: debtors[0] → creditors[0], amount x
    subtract x from both; drop any that reach zero
```

Minimising transfers exactly is NP-hard (it reduces to subset-sum). Greedy is the standard
answer, it's within one or two transfers of optimal in practice, and it should be left
alone. This note exists so future-you doesn't spend a weekend "fixing" it.

### Unsimplified mode

Some groups specifically want to pay back the person who actually paid, rather than being
told to send money to someone they never transacted with. Offer a toggle.

Build a debt matrix directly from expenses — `owed[debtor][creditor] += share` — then net
each pair against each other (`A→B` cancels against `B→A`) but perform **no transitive
simplification**. Both modes must reduce every balance to zero when applied; that's a test.

---

## 7. QR sync

### Payload pipeline

```
events (sorted by hlc)
  → CBOR encode            (cbor-x — compact, native integers, no base64 tax)
  → deflate raw            (fflate)
  → chunk into frames
  → per-frame header + QR byte mode
```

An expense event serialises to roughly 40–60 bytes after CBOR and deflate. Two hundred
events is around 10 KB, which is four or five frames.

### Frame format

```
┌────────┬─────────┬──────────┬───────┬───────┬─────────────┐
│ magic  │ version │ group[4] │ index │ total │  chunk …    │
│ 2 B    │ 1 B     │ 4 B      │ 2 B   │ 2 B   │  ~1100 B    │
└────────┴─────────┴──────────┴───────┴───────┴─────────────┘
```

`version` gates compatibility: a mismatched major refuses the scan with a clear message
rather than merging garbage. The 4-byte group prefix catches the case where two phones are
accidentally syncing different trips.

Target **QR version 27 at ECC level M**, about 1,100 bytes per frame. Do not max out to
version 40 / ECC L just because the payload would fit in fewer frames — dense codes scan
badly across two phone screens at arm's length, in a restaurant, at night. More frames that
scan on the first try beat fewer that don't.

### Display and capture

The sender **loops the frames indefinitely** at ~4 fps. The receiver collects frames by
index and shows progress (`3 / 5`). A missed frame is not an error — the loop comes back
around. This removes all handshaking, retry logic, and protocol state.

For decoding, `BarcodeDetector` exists in Chrome but **not in Safari**, so a WASM decoder
(`zxing-wasm`) is required for iOS, not optional. Bundle it; never fetch it.

### The two-pass flow

Because merge is a union, the second pass is trivially a superset:

```
1.  Anna shows.  Marco scans.   →  Marco now holds A ∪ M
2.  Marco shows. Anna scans.    →  Anna now holds A ∪ M
                                   both converged
```

The UI should drive this explicitly — after step 1 completes, Marco's screen says *"Now
swap: show this to Anna."* Two passes, roughly ten seconds, no network.

After merging, always show a summary: *"Added 6 expenses from Marco's phone. 1 possible
duplicate."* A sync that silently changes the numbers is a sync people stop trusting.

### Threat model

QR is line-of-sight and unauthenticated. Anyone who can photograph the screen gets the
ledger. Given the contents — who bought the pizza — that is acceptable, and it buys the
absence of any pairing, key exchange, or account system. Worth stating out loud so the
tradeoff is a decision rather than an oversight.

---

## 8. Duplicate detection

The real-world conflict is not two people editing one expense. It's Marco and Anna **both
entering the same €48 dinner** because neither knew the other had. Merge handles this
perfectly correctly and produces two expenses, and the app looks broken.

After every merge, flag candidate pairs where all of the following hold:

- both non-deleted
- different `createdBy` (same device entering it twice is the user's own doing)
- identical `totalCents`
- `date` within ±1 day
- identical payer sets

Exact amount matching only. Fuzzy amounts generate false positives, and a duplicate prompt
that cries wolf gets dismissed reflexively.

Present them as a review list with three actions: **keep both**, **delete this one**,
**delete that one**. Resolution needs no new event type — it's an ordinary
`expense.delete`. "Keep both" should be remembered so the pair isn't re-flagged on every
subsequent sync.

---

## 9. Storage and shell

### IndexedDB

| Store | Key | Notes |
|---|---|---|
| `events` | `id` | index `by-group-hlc` on `[groupId, hlc]` |
| `meta` | key | `deviceId`, HLC state, dismissed duplicate pairs |

Groups, expenses and balances are all derived. The event log is the only durable truth.

### Storage durability

Safari normally purges script-writable storage after seven days without interaction, but
web apps added to the Home Screen are exempt from that cap. **This plan depends on that
exemption, so verify it on a real iPhone in Phase 0** — before there is anything to lose —
rather than discovering it after a trip.

Either way: ship export as a prominent, nagging feature, not a settings-menu afterthought.

### Export / import

```json
{ "format": "gmc/1", "exportedAt": "…", "groupId": "…", "events": [ … ] }
```

Import runs the **same merge path as QR sync**. This is deliberate: it means the riskiest
code in the project gets exercised every time anyone takes a backup, instead of only during
the sync flow.

### PWA

`vite-plugin-pwa`, precache everything, `registerType: 'autoUpdate'`.

Add a **build assertion** that fails CI if the production bundle contains any external URL
or network call. The privacy claim is the product; a stray font import or telemetry snippet
would quietly falsify it, and no one reviews a diff for that.

### Stack

Vite · TypeScript · React · Vitest + fast-check · `idb` · `cbor-x` · `fflate` ·
`qrcode` (encode) · `zxing-wasm` (decode) · `vite-plugin-pwa`

All bundled, nothing fetched. Svelte is a leaner alternative to React if bundle size
matters more than ecosystem.

---

## 10. Tests

Keep the entire domain layer in `src/core/` with zero DOM and zero IndexedDB imports. Every
interesting bug in this project lives in pure functions, which is a gift — they're
trivially testable. Property tests with `fast-check`:

| Property | Guards |
|---|---|
| `fold(shuffle(events)) === fold(events)` | §4 determinism — **the most valuable test here** |
| `Σ apportion(total, weights) === total` | no cent invented or lost, for any weights |
| `Σ net === 0` | balance arithmetic |
| applying the settle-up plan zeroes every balance | both simplified and unsimplified modes |
| `decode(frames(encode(events))) === events` | QR round-trip, including chunk boundaries |
| deleting then updating leaves it deleted | tombstone absorption |

---

## 11. Build order

**Phase 0 — Scaffold.** Vite + TS + Vitest, PWA manifest, service worker, IndexedDB
wrapper, `deviceId` generation, HLC implementation. *Deploy a hello-world to GitHub Pages,
install it on a real iPhone, and confirm storage survives a week.* Do this first; it
invalidates the plan if it fails.

**Phase 1 — Domain core, no UI.** Events, fold, tombstones, split math, balances,
settle-up. Fully property-tested before a single component exists.

**Phase 2 — Single-device app.** Create group, manage members, add/edit/delete expenses
across all three split modes, expense list, balances, settle-up view. Genuinely useful at
this point, as a solo bookkeeper's tool.

**Phase 3 — Export / import JSON.** Ships backup and exercises the merge path on real data
long before QR is involved.

**Phase 4 — QR sync.** Encode, animated frame display, camera capture, decode, merge,
post-merge summary. The two-pass guided flow.

**Phase 5 — Duplicate review.** Only meaningful once multiple devices are actually writing.

**Phase 6 — Polish.** Multiple groups, settlements UI, install prompt, backup nagging.

**Later.** Multi-currency with per-expense FX rate captured at entry time (you're offline;
historical rates cannot be looked up afterwards). Refunds / negative amounts.

---

## 12. Open questions

- **Multiple groups in v1 or v2?** The schema already carries `groupId` everywhere, so
  deferring costs nothing — but the group picker is UI work that's easier to design in
  from the start than to retrofit.
- **Joining mid-trip.** Currently the first sync *is* the join: scanning a ledger you don't
  have creates it locally. That's elegant and needs no invite flow, but it means any scan
  silently creates a group. Worth a confirmation step.
- **Currency formatting.** `Intl.NumberFormat` is built in and free, but it reads device
  locale — which is fine for display and forbidden anywhere near the domain layer (§4).
- **What happens when someone leaves the group mid-trip** with a non-zero balance.
- **Editing an expense after settling up.** Balances shift retroactively and previously
  settled transfers no longer make sense. Probably fine to allow with a warning, but decide
  before someone hits it.
