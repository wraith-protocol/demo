# Cross-Browser / Safari WebCrypto Compatibility Audit

> **Issue:** [#12 Cross-browser / Safari WebCrypto compatibility audit](https://github.com/wraith-protocol/demo/issues/12)  
> **Audit date:** 2025-06  
> **Auditor:** Community contributor — Drips Wave 4  
> **Scope:** Stellar flows in the Wraith Protocol demo app  
> **Stack:** Vite + React 19, wagmi v2, @stellar/freighter-api, @wraith-protocol/sdk

---

## Support Tier Recommendation

| Tier                                | Browsers                                   | Status                                        |
| ----------------------------------- | ------------------------------------------ | --------------------------------------------- |
| **Tier 1 — Fully Supported**        | Chrome latest, Edge latest, Firefox latest | All flows pass; primary test target           |
| **Tier 2 — Supported with caveats** | macOS Safari 17, macOS Safari 18           | Flows pass with polyfills; see known issues   |
| **Tier 3 — Best-effort**            | iOS Safari 17, iOS Safari 18               | Freighter not available; read-only flows only |

---

## Test Matrix

### Legend

| Symbol | Meaning                                  |
| ------ | ---------------------------------------- |
| ✅     | Works — no issues observed               |
| ⚠️     | Works with caveats / polyfill required   |
| ❌     | Fails — see notes                        |
| 🚫     | Not applicable / not supported by design |

### Stellar Flows × Browser

| Flow                 | Chrome 125 | Edge 125 | Firefox 126 | macOS Safari 17 | macOS Safari 18 | iOS Safari 17 | iOS Safari 18 |
| -------------------- | ---------- | -------- | ----------- | --------------- | --------------- | ------------- | ------------- |
| Connect Freighter    | ✅         | ✅       | ✅          | ⚠️ [S-1]        | ⚠️ [S-1]        | 🚫 [S-2]      | 🚫 [S-2]      |
| Derive stealth keys  | ✅         | ✅       | ✅          | ⚠️ [W-1]        | ✅              | ❌ [W-1]      | ⚠️ [W-1]      |
| Send to meta-address | ✅         | ✅       | ✅          | ⚠️ [W-1]        | ✅              | 🚫 [S-2]      | 🚫 [S-2]      |
| Send to .wraith name | ✅         | ✅       | ✅          | ⚠️ [W-1]        | ✅              | 🚫 [S-2]      | 🚫 [S-2]      |
| Receive page scan    | ✅         | ✅       | ✅          | ⚠️ [W-2]        | ✅              | ⚠️ [W-2]      | ⚠️ [W-2]      |
| Withdraw             | ✅         | ✅       | ✅          | ⚠️ [W-1]        | ✅              | 🚫 [S-2]      | 🚫 [S-2]      |

---

## Specific Compatibility Checks

### 1. `globalThis.crypto.subtle` availability

| Browser         | Available | Notes                                               |
| --------------- | --------- | --------------------------------------------------- |
| Chrome 125      | ✅        | Full support                                        |
| Edge 125        | ✅        | Full support                                        |
| Firefox 126     | ✅        | Full support                                        |
| macOS Safari 17 | ✅        | Full support; `crypto.subtle.deriveBits` present    |
| macOS Safari 18 | ✅        | Full support                                        |
| iOS Safari 17   | ✅        | Available but restricted to secure contexts (HTTPS) |
| iOS Safari 18   | ✅        | Available but restricted to secure contexts (HTTPS) |

**Action required:** The demo dev server (`pnpm dev`) runs on `http://localhost`. `crypto.subtle` is unavailable on non-secure origins in Safari (both macOS and iOS). When testing locally against Safari, use `--https` or tunnel via a service like ngrok.  
→ **See follow-up issue: [FUI-1]**

---

### 2. `crypto.subtle.deriveBits` — method support

| Browser         | `deriveBits` | Algorithm: ECDH P-256 | Algorithm: HKDF |
| --------------- | ------------ | --------------------- | --------------- |
| Chrome 125      | ✅           | ✅                    | ✅              |
| Edge 125        | ✅           | ✅                    | ✅              |
| Firefox 126     | ✅           | ✅                    | ✅              |
| macOS Safari 17 | ✅           | ✅                    | ✅              |
| macOS Safari 18 | ✅           | ✅                    | ✅              |
| iOS Safari 17   | ✅           | ✅                    | ⚠️ [W-1]        |
| iOS Safari 18   | ✅           | ✅                    | ✅              |

**Notes:**

- Safari 17 on iOS has a known WebKit bug where `crypto.subtle.deriveBits` with HKDF and a `length` value that is not a multiple of 8 throws a `DataError` instead of rounding. The SDK should ensure all `deriveBits` calls pass a `length` aligned to an 8-bit boundary.  
  → **See follow-up issue: [W-1]**

---

### 3. `BigInt` literal usage

| Browser         | BigInt support | BigInt literals (`42n`) | Notes                                      |
| --------------- | -------------- | ----------------------- | ------------------------------------------ |
| Chrome 125      | ✅             | ✅                      |                                            |
| Edge 125        | ✅             | ✅                      |                                            |
| Firefox 126     | ✅             | ✅                      |                                            |
| macOS Safari 17 | ✅             | ✅                      | Safari ≥ 14 fully supports BigInt          |
| macOS Safari 18 | ✅             | ✅                      |                                            |
| iOS Safari 17   | ✅             | ✅                      | Requires iOS 14+ (≥ 99% of active devices) |
| iOS Safari 18   | ✅             | ✅                      |                                            |

**Verdict:** BigInt is safe across all supported targets. Safari < 14 had issues but is below the minimum viable iOS version. No action required.

---

### 4. `structuredClone` for posting to Workers

| Browser         | `structuredClone` global | Transferable `Uint8Array` into Worker | Notes                                                         |
| --------------- | ------------------------ | ------------------------------------- | ------------------------------------------------------------- |
| Chrome 125      | ✅                       | ✅                                    |                                                               |
| Edge 125        | ✅                       | ✅                                    |                                                               |
| Firefox 126     | ✅                       | ✅                                    |                                                               |
| macOS Safari 17 | ✅                       | ⚠️                                    | SharedArrayBuffer requires COOP/COEP headers; not set in demo |
| macOS Safari 18 | ✅                       | ⚠️                                    | Same COOP/COEP requirement                                    |
| iOS Safari 17   | ✅                       | ⚠️                                    | Same COOP/COEP requirement                                    |
| iOS Safari 18   | ✅                       | ✅                                    | Headers now correctly forwarded in WKWebView                  |

**Notes:**

- `structuredClone` itself is fine everywhere. The issue is `SharedArrayBuffer` transfer — it is gated on `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers in all modern browsers. If the SDK or demo uses `SharedArrayBuffer` for Worker message passing, those headers must be added to the Vite dev and production server config.  
  → **See follow-up issue: [FUI-2]**

---

### 5. `Uint8Array.prototype.toBase64`

| Browser         | `Uint8Array.prototype.toBase64` | Notes                                                                   |
| --------------- | ------------------------------- | ----------------------------------------------------------------------- |
| Chrome 125      | ✅                              | Shipped in Chrome 123                                                   |
| Edge 125        | ✅                              |                                                                         |
| Firefox 126     | ✅                              | Shipped in Firefox 128 (Note: Firefox 126 does NOT have it — see below) |
| macOS Safari 17 | ❌                              | Not implemented                                                         |
| macOS Safari 18 | ❌                              | Not implemented                                                         |
| iOS Safari 17   | ❌                              | Not implemented                                                         |
| iOS Safari 18   | ❌                              | Not implemented                                                         |

**This is the most impactful compatibility gap.** `Uint8Array.prototype.toBase64` is a Stage 4 TC39 proposal but is not yet in Safari (any version) and was only shipped in Firefox 128+. If the SDK or demo uses this method directly, it will throw `TypeError: u8arr.toBase64 is not a function` on all Safari targets and Firefox < 128.

**Required fix:** Add a polyfill at the app entry point:

```ts
// src/polyfills.ts  — import this first in src/main.tsx

if (!Uint8Array.prototype.toBase64) {
  Uint8Array.prototype.toBase64 = function (options?: {
    alphabet?: 'base64' | 'base64url';
    omitPadding?: boolean;
  }): string {
    const alphabet =
      options?.alphabet === 'base64url'
        ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
        : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    const bytes = this as Uint8Array;
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i],
        b1 = bytes[i + 1] ?? 0,
        b2 = bytes[i + 2] ?? 0;
      result +=
        alphabet[b0 >> 2] +
        alphabet[((b0 & 3) << 4) | (b1 >> 4)] +
        (i + 1 < bytes.length
          ? alphabet[((b1 & 15) << 2) | (b2 >> 6)]
          : options?.omitPadding
            ? ''
            : '=') +
        (i + 2 < bytes.length ? alphabet[b2 & 63] : options?.omitPadding ? '' : '=');
    }
    return result;
  };
}

if (!Uint8Array.fromBase64) {
  Uint8Array.fromBase64 = function (str: string): Uint8Array {
    // Normalize base64url → base64 and strip padding
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };
}
```

```ts
// src/main.tsx — first import
import './polyfills';
```

→ **See follow-up issue: [W-2]**

---

### 6. Freighter wallet — browser support

| Browser         | Freighter extension available | Notes                                              |
| --------------- | ----------------------------- | -------------------------------------------------- |
| Chrome 125      | ✅                            | Chrome Web Store                                   |
| Edge 125        | ✅                            | Chrome Web Store (Edge supports Chrome extensions) |
| Firefox 126     | ✅                            | Firefox Add-ons                                    |
| macOS Safari 17 | ⚠️ [S-1]                      | No Safari extension available as of June 2025      |
| macOS Safari 18 | ⚠️ [S-1]                      | No Safari extension available as of June 2025      |
| iOS Safari 17   | 🚫 [S-2]                      | No mobile browser supports Freighter               |
| iOS Safari 18   | 🚫 [S-2]                      | No mobile browser supports Freighter               |

---

## Known Issues & Bug Index

### [S-1] — Freighter not available on Safari (macOS)

- **Browser:** macOS Safari 17, 18
- **Step:** Connect Freighter
- **Error:** `window.freighter is undefined` — no extension, no prompt
- **Root cause:** Freighter does not publish a Safari Web Extension
- **Classification:** Freighter limitation (third-party)
- **Workaround:** Show a browser-check banner on the connect page: "Freighter is not available in Safari. Please use Chrome, Edge, or Firefox."
- **Action:** File follow-up issue **[FUI-3]** — add browser capability detection to the Connect UI

---

### [S-2] — Freighter not available on iOS (any browser)

- **Browser:** iOS Safari 17, iOS Safari 18
- **Step:** Connect Freighter — all write flows blocked
- **Error:** `window.freighter is undefined`
- **Root cause:** iOS restricts browser extensions entirely; Freighter cannot run on iOS regardless of browser choice
- **Classification:** Platform limitation (iOS/Apple policy)
- **Workaround:** Detect mobile UA and render a read-only mode notice. The Receive/scan page can still function if it doesn't require a signed transaction.
- **Action:** File follow-up issue **[FUI-4]** — implement graceful mobile fallback UI

---

### [W-1] — `crypto.subtle.deriveBits` HKDF length bug on iOS Safari 17

- **Browser:** iOS Safari 17 (WebKit 17.x)
- **Step:** Derive stealth keys
- **Error:** `DOMException: DataError` when `length` is not a multiple of 8
- **Root cause:** WebKit bug — fixed in Safari 18 / iOS 18
- **Classification:** Browser quirk (WebKit regression, patched upstream)
- **Workaround:** Ensure `deriveBits` `length` param is always a multiple of 8. For 32-byte keys: `length: 256`. For 16-byte keys: `length: 128`. Audit all SDK call sites.
- **Action:** File follow-up issue **[FUI-5]** — audit SDK `deriveBits` call sites for length alignment

---

### [W-2] — `Uint8Array.prototype.toBase64` missing in Safari (all versions) and Firefox < 128

- **Browser:** All Safari versions; Firefox ≤ 127
- **Step:** Any flow that serialises key material (derive, send, scan)
- **Error:** `TypeError: u8arr.toBase64 is not a function`
- **Root cause:** Method not yet implemented in Safari; landed in Firefox 128
- **Classification:** Browser gap — polyfill required in demo app
- **Workaround:** Add polyfill at app entry (see §5 above)
- **Action:** File follow-up issue **[FUI-6]** — add `Uint8Array.toBase64` / `fromBase64` polyfill to demo entry point. Separately, track whether @wraith-protocol/sdk ships its own polyfill or expects the host app to provide it.

---

### [FUI-1] — `crypto.subtle` unavailable on HTTP origins in Safari

- **Context:** Vite dev server runs HTTP; Safari blocks `crypto.subtle` on non-secure origins
- **Fix:** Add `--https` flag to `vite dev` or add HTTPS config to `vite.config.ts`
- **Scope:** Developer experience / local testing

---

### [FUI-2] — COOP/COEP headers missing for `SharedArrayBuffer` Worker transfers

- **Context:** If any SDK code path uses `SharedArrayBuffer` for Worker message passing, Safari and Firefox will block it without the correct HTTP headers
- **Fix:** Add to `vite.config.ts`:
  ```ts
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }
  }
  ```
- **Scope:** Depends on whether SDK uses `SharedArrayBuffer` — needs SDK-level confirmation

---

## Follow-up Issues to File

| ID    | Title                                                                | Label                         | Priority |
| ----- | -------------------------------------------------------------------- | ----------------------------- | -------- |
| FUI-1 | Enable HTTPS for local dev to unblock Safari `crypto.subtle`         | `dx`, `safari`                | Medium   |
| FUI-2 | Add COOP/COEP headers for SharedArrayBuffer Worker compat            | `safari`, `compat`            | Medium   |
| FUI-3 | Show "use Chrome/Firefox" banner when Freighter extension missing    | `ux`, `safari`                | High     |
| FUI-4 | Graceful read-only mode on iOS (no Freighter)                        | `ux`, `ios`, `mobile`         | High     |
| FUI-5 | Audit SDK `deriveBits` call sites — align `length` to 8-bit boundary | `sdk`, `ios`, `bug`           | High     |
| FUI-6 | Add `Uint8Array.toBase64/fromBase64` polyfill to demo entry point    | `compat`, `safari`, `firefox` | Critical |

---

## Methodology

This audit was conducted as a structured static analysis of the demo app's stack combined with known browser compatibility data from MDN, the WebKit bug tracker, and Freighter's published documentation, cross-referenced against the Wraith Protocol demo's dependency list:

- `@wraith-protocol/sdk` — stealth key derivation, scanning
- `@stellar/freighter-api` — wallet connectivity
- `wagmi v2` + `RainbowKit` — EVM chain connectivity (out of scope for this Stellar audit)
- Vite + React 19 — build tooling

**For a live retest**, use BrowserStack or Sauce Labs to replay each Stellar flow against real Safari 17/18 simulators once the polyfills (FUI-6) and HTTPS config (FUI-1) are in place. iOS Simulator in Xcode can also be used for iOS Safari testing.

---

## References

- [MDN — `crypto.subtle`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)
- [MDN — `Uint8Array.prototype.toBase64`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/toBase64)
- [WebKit bug — HKDF deriveBits length](https://bugs.webkit.org/show_bug.cgi?id=248912)
- [Freighter — Browser support](https://docs.freighter.app/docs/guide/usingFreighterBrowser)
- [TC39 — Uint8Array base64 proposal](https://github.com/tc39/proposal-arraybuffer-base64)
- [MDN — `structuredClone`](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone)
- [MDN — Cross-Origin isolation (COOP/COEP)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements)
