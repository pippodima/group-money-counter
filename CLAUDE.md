# Working on this project

A private, offline-only shared expense ledger. PWA, no server, no network, QR sync.

## Documents

| File | Role |
|---|---|
| [DESIGN.md](DESIGN.md) | The spec — what is true now |
| [ROADMAP.md](ROADMAP.md) | Milestones M0–M6, with checkboxes |
| [DIARY.md](DIARY.md) | The history — decisions, rejected ideas, progress |

## Keep the diary current

This is a standing instruction, not a one-off task.

**Append a DIARY.md entry whenever** a milestone or a meaningful chunk of work completes, a
design decision is made or reversed, an approach is tried and abandoned, or something
surprising turns up. Entries are chronological, newest at the bottom.

**Log every decision** in the diary's decision index with an ID and a one-line *why*. If a
decision changes the spec, update DESIGN.md too — the diary records how we got here, the
spec records where we are.

**Record rejected options and the reason.** Why something didn't work is the most expensive
thing to rediscover.

**Tick ROADMAP.md checkboxes** as work lands, and update the `Status:` line.

## Non-negotiables

- **No network calls, ever.** No CDN, no fonts, no analytics, no error reporting. The
  privacy claim is the product, and a single stray import falsifies it.
- **`src/core/` stays pure.** No DOM, no IndexedDB, no `Date.now()`, no locale, no
  insertion-order dependence. It must be a pure function of the sorted event set.
- **Money is integer cents.** No floating point in the domain layer.
- **Ties break on replicated keys** (`memberId`, `expenseId`), never array position — see
  decision D7.
