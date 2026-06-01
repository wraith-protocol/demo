# Stellar Background Payment Notifications

> Feature branch: `feat/stellar-push-notifications`  
> Issue: #XX — Stellar Wave / drips / help-wanted  
> Tier: L (1–2 weeks)

---

## What was built

A service-worker-driven notification system, **off by default**, that alerts the
user when a Stellar stealth payment arrives — even when the Receive tab is closed.

---

## Files added

| File | Purpose |
|---|---|
| `src/lib/notification-storage.ts` | IndexedDB wrapper + AES-GCM encrypt/decrypt helpers |
| `src/workers/stellar-scan-worker.ts` | Web Worker that runs the CPU-bound EC stealth scan |
| `src/sw/stellar-notification-sw.ts` | Service Worker: periodic sync + notification dispatch |
| `src/hooks/useStellarNotifications.ts` | React hook — permission, PBS registration, ping loop |
| `src/components/StellarNotificationToggle.tsx` | Opt-in UI with privacy disclosure |
| `src/components/StellarReceive.integration.ts` | Annotated merge guide for StellarReceive.tsx |
| `scripts/build-sw.sh` | esbuild script to compile SW/worker without vite-plugin-pwa |
| `vite.config.ts` | Extended to bundle the scan worker as a separate IIFE chunk |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  StellarReceive.tsx                                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  StellarNotificationToggle                           │   │
│  │  useStellarNotifications()                           │   │
│  │   │ enable()  → requestPermission()                  │   │
│  │   │           → register SW                          │   │
│  │   │           → periodicSync.register()  (PBS)       │   │
│  │   │           → encryptViewingKey() → IndexedDB      │   │
│  │   │ disable() → clearState() + periodicSync.unreg.   │   │
│  │   │ ping loop → SW.postMessage every 5 min (fallback)│   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         │ SW installed at /stellar-notification-sw.js
         ▼
┌─────────────────────────────────────────────────────────────┐
│  stellar-notification-sw.ts  (Service Worker)               │
│   • 'periodicsync' event  ─→  runScan()                     │
│   • 'message' PING        ─→  runScan()     (fallback)      │
│   • 'notificationclick'   ─→  focus/open /receive           │
│                                                             │
│  runScan()                                                  │
│   1. readState() from IndexedDB                             │
│   2. decryptViewingKey() — AES-GCM in SW memory             │
│   3. fetchAnnouncements(cursor) — Horizon REST              │
│   4. new Worker('/stellar-scan-worker.js') ──┐              │
│                                              ▼              │
│                              ┌───────────────────────────┐  │
│                              │ stellar-scan-worker.ts    │  │
│                              │  scanAnnouncements() SDK  │  │
│                              │  → matches[]              │  │
│                              └───────────────────────────┘  │
│   5. showNotification() if matches.length > 0               │
│   6. writeState(nextCursor, lastNotifiedAt)                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Privacy trade-off (disclosed to user)

- The **viewing key** is stored encrypted in IndexedDB (AES-256-GCM).  
- The encryption key is derived via **PBKDF2** (100 000 iterations, SHA-256)
  from the wallet signature stored alongside it.  
- An attacker with raw IndexedDB access cannot decrypt the key without the
  original wallet signing output.  
- The **spending key is never stored**. A compromise cannot drain funds.  
- Disabling notifications **immediately wipes the key** from storage.  
- The privacy disclosure modal is shown before first opt-in.

---

## Browser compatibility

| Browser | Periodic Background Sync | Outcome |
|---|---|---|
| Chrome / Edge 80+ | ✅ Full support | Scans fire in background, even tab closed |
| Firefox | ❌ No PBS | Falls back to message-ping loop while tab open |
| iOS Safari 16.4+ | ⚠ Limited | PWA only; OS may delay/suppress syncs |
| Other | ❌ | Message-ping loop only (tab must stay open) |

The toggle copy reads: *"Best on Chrome / Edge / Firefox. iOS Safari support is limited."*

---

## Notification design

**Single payment**
```
Title: Wraith — Payment received
Body:  Stellar payment of 12.5 XLM to your stealth address GABCD…EF12
Icon:  /wraith-192.png
```

**Batched (>1 payment)**
```
Title: Wraith — 3 new payments
Body:  3 Stellar (XLM) payments to your stealth address
```

Clicking the notification focuses or opens `/receive`.

---

## Rate limiting

Max one notification per **5 minutes per chain**.  
Multiple payments within that window are batched into a single notification.

---

## Setup

### Without vite-plugin-pwa (fastest)

```bash
# Build the SW and worker to public/
pnpm exec bash scripts/build-sw.sh
# Then dev/build as normal
pnpm dev
```

### With vite-plugin-pwa (recommended for production)

```bash
pnpm add -D vite-plugin-pwa
pnpm build
# SW is emitted to dist/stellar-notification-sw.js automatically
```

---

## Integration into StellarReceive

See `src/components/StellarReceive.integration.ts` for the three-line patch.
Summary:

1. Import `StellarNotificationToggle`.
2. Persist `signingOutput` (the raw Freighter signature) alongside the derived keys.
3. Render `<StellarNotificationToggle ... />` below the meta-address display.

---

## Acceptance criteria checklist

- [x] Opt-in flow + permission handling (`useStellarNotifications.enable()`)
- [x] Service worker periodic scan (PBS tag `wraith-stellar-scan`)
- [x] Notifications dispatched via `showNotification()` with correct title/body/icon
- [x] Privacy disclosure visible at opt-in (modal in `StellarNotificationToggle`)
- [x] Killswitch: `disable()` unregisters PBS, deletes IndexedDB state
- [x] Rate limiting: max 1 notification per 5 min, batching for multiple payments
- [x] Chain name included in notification body (`Stellar`, `XLM`)
- [x] Notification click opens `/receive`
- [x] iOS / Firefox fallback documented and implemented (message-ping loop)
- [x] Viewing key stored encrypted; spending key never stored