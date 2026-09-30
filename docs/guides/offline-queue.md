# Offline queue and reconciliation policy (Wave 9, #184)

The PWA shell caches assets (see `src/sw/app-sw.ts`), but transaction and
scanner work used to have no documented offline policy: a user who lost
connectivity mid-flow was left with stale pending state after reconnecting.
This document is the policy. The implementation lives in:

- `src/lib/offlineQueue.ts` — queue core: classification, validation, persistence
- `src/lib/offlineReconcile.ts` — reconnect reconciliation engine
- `src/stores/offlineQueueStore.ts` — persisted zustand store + explicit broadcast
- `src/hooks/useOfflineReconcile.ts` — `online` / service-worker triggers
- `src/components/OfflineQueuePanel.tsx` — review UI (Send page)
- `src/components/OfflineBanner.tsx` — queue-aware connectivity banner

## 1. Separate safe-to-queue work from signing-required work

| Kind             | Example                                                   | Policy             | May complete without the user?                                                                               |
| ---------------- | --------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `payment-intent` | Unsigned send (form, payment link, scan) captured offline | `safe-to-queue`    | No — stops at **needs-review** for explicit confirm + sign                                                   |
| `scan-session`   | QR camera / QR image / payment-link / shared-text capture | `safe-to-queue`    | Yes — revalidated, then **done**                                                                             |
| `signed-submit`  | Fully-signed envelope awaiting broadcast                  | `signing-required` | **Never** — stops at **needs-review**; broadcast only via the explicit two-step "Broadcast now" confirmation |

`classifyOfflineWork()` is the single place this mapping lives. Persisted
entries are re-validated on load, and an entry whose stored `policy`
disagrees with its `kind` is discarded — a tampered policy can never
promote signing-required work to auto-complete.

Nothing in the queue ever triggers a wallet signature. Signing and
broadcast stay explicit user actions.

## 2. Persist pending scan and user intent state

Entries persist in `localStorage` under `wraith-offline-queue` using the
versioned, validated, bounded envelope from `src/lib/versionedStorage.ts`
(max 50 entries; corrupt state is discarded, never trusted).

Cap policy — actionable work is never dropped silently: adds evict the
oldest _terminal_ entries to make room, and when all 50 entries are still
actionable the add is explicitly rejected (`accepted: false`, input
untouched). Callers surface this: the Send form errors, and the panel shows
a "queue full" notice until you reconnect or discard items. Oversized
loaded state is capped with the same prune-oldest-terminal-first rule.

Captured at the source, while offline:

- **QR camera / QR image** (`StellarSend.applyQrPayload`) — the parsed
  payload is applied to the form _and_ persisted as a `scan-session`.
- **Payment links** (`/pay?to=…&amount=…&exp=…`) — persisted once on open as
  a `scan-session` with source `payment-link`, carrying `exp` through.
- **Shared text** (`/send?text=…`, `App.tsx`) — persisted as a
  `scan-session` with source `shared-text`.
- **Send attempts** (`StellarSend.handleSend`) — instead of failing on the
  first network call, the intent (recipient, amount, asset, memo, link
  expiry) is persisted as a `payment-intent` and the user sees a queued
  confirmation.

The stealth-announcement scanner needs no queue: it resumes from the
persisted `lastScannedLedger` checkpoint on every run.

## 3. Reconcile on reconnect with clear conflict handling

Triggers (first one wins; reconciliation is a no-op while offline):

1. Browser `online` event (`useOfflineReconcile`).
2. Service-worker Background Sync tag `wraith-offline-queue` → the worker
   posts `OFFLINE_QUEUE_FLUSH` to all clients (the worker cannot read page
   localStorage, so it only nudges).
3. Mount pass when entries are already pending (covers reload-then-online).

Each `queued` entry is processed oldest-first with an attempt budget
(default 5, then `failed`):

- `payment-intent` → re-check expiry + recipient shape → `needs-review`
  (user confirms and signs in Send) or `conflict` (`expired` /
  `invalid-recipient`).
- `scan-session` → re-parse the capture (and its embedded link expiry) →
  `done` (payload delivered to the app) or `conflict` (`expired` /
  `unparseable-scan`).
- `signed-submit` → fresh envelopes wait at `needs-review`; envelopes older
  than 24h become `conflict` (`stale-envelope`) because the account sequence
  has likely moved on — re-signing must be deliberate, so they are never
  broadcast.

Conflicts render in the OfflineQueuePanel with a plain-language reason and
a resolution action (review pre-filled in Send, or discard). Terminal
states (`done`, `conflict`, `failed`) are never re-processed; "Clear
finished" removes them.

## 4. Coverage

- Unit: `src/lib/offlineQueue.test.ts` (classification, validation,
  persistence round-trip, dedupe, cap pruning) and
  `src/lib/offlineReconcile.test.ts` (intent/scan outcomes, stale
  envelopes, attempt budget, offline no-op, throwing consumers).
- E2E: `e2e/offline-queue.spec.ts` (banner + queue count while offline,
  real offline send → queued intent, reconnect reconciliation incl.
  expired-intent conflict, signed envelopes never auto-broadcast).
