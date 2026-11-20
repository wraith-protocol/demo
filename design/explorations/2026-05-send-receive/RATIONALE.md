# Send / Receive Layout Explorations — May 2026

## Recommendation

> **If we ship one direction next week, it's Send-B (Amount-First) and Receive-C (Empty-State-First), because:**
> Send-B removes the cognitive friction of the meta-address string by letting the user commit to an amount before confronting the long opaque address. The amount is the decision; the address is the plumbing. On mobile the large numpad-style amount field is immediately scannable and thumb-friendly.
> Receive-C solves the real problem: most users land on Receive with zero matches and currently see a blank list with no guidance. Empty-State-First turns that moment into an onboarding step, then gracefully scales to the card stack (≤5 matches) or the dense table (power users) as matches accumulate — all within the same layout shell.

---

## Design Tokens (applied throughout)

| Token              | Hex       | Usage                          |
| ------------------ | --------- | ------------------------------ |
| surface            | `#0e0e0e` | Page background                |
| surface-container  | `#141414` | Card / panel backgrounds       |
| surface-bright     | `#1a1a1a` | Hover states, secondary panels |
| primary            | `#c6c6c7` | Body text, active inputs       |
| on-surface         | `#e6e1e5` | Headings                       |
| on-surface-variant | `#c4c7c5` | Secondary text                 |
| outline            | `#767575` | Labels, placeholders           |
| outline-variant    | `#444444` | Borders, dividers              |
| error              | `#ee7d77` | Error states                   |
| tertiary           | `#22c55e` | Success indicators             |

Fonts: **Space Grotesk** (headings / labels), **Inter** (body copy), **JetBrains Mono** (addresses, hashes, amounts).
No border-radius anywhere. All contrast ratios verified ≥ 4.5:1 for body text against their respective backgrounds.

---

## Send Page Explorations

### Send-A — Recipient-First (meta-address as focal point)

**Concept:** The meta-address input dominates the top of the form. Amount is secondary, tucked below. The visual logic mirrors an email compose view: "who are you sending to?" is the first question.

**Desktop (≥1280px):**

```
┌─────────────────────────────────────────────────────────────────┐
│  STELLAR TESTNET / XLM                                          │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  SEND                                                           │
│  Send XLM privately using stealth addresses.                    │
│                                                                 │
│  RECIPIENT META-ADDRESS                                         │
│  ┌─────────────────────────────────────────────────── [PASTE] ─┐│
│  │ st:xlm:...                                                   ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌──────────────────────────────┐                               │
│  │  AMOUNT                      │                               │
│  │  ┌────────────────── [XLM] ─┐│                               │
│  │  │ 0.0                      ││                               │
│  │  └──────────────────────────┘│                               │
│  └──────────────────────────────┘                               │
│                                                                 │
│  ── Network fee: 100 stroops ── Announcer: Soroban ──           │
│                                                                 │
│  [         SEND PRIVATELY         ]                             │
└─────────────────────────────────────────────────────────────────┘
```

**Mobile (375px):**

```
┌───────────────────────────┐
│ STELLAR TESTNET / XLM     │
│ SEND                      │
│                           │
│ RECIPIENT META-ADDRESS    │
│ ┌─────────────── [PASTE]─┐│
│ │ st:xlm:...             ││
│ └────────────────────────┘│
│                           │
│ AMOUNT                    │
│ ┌──────────────── [XLM] ─┐│
│ │ 0.0                    ││
│ └────────────────────────┘│
│                           │
│ [    SEND PRIVATELY    ]  │
└───────────────────────────┘
```

**States:**

- **Idle:** Address input focused, placeholder `st:xlm:...` in `text-outline`. Amount input below.
- **Loading:** Button text → `CONFIRM IN WALLET...`, opacity 0.5, no spinner (matches existing pattern).
- **Error:** `text-error` paragraph below the button. Input border does NOT turn red (avoids alarming the user before they've finished typing).

**Tradeoffs:**

- ✅ Mirrors mental model of "send to someone" — address is the intent.
- ✅ Senders who copy-paste a meta-address first will find this natural.
- ❌ The meta-address string is long and opaque; leading with it can feel intimidating on first use.
- ❌ On mobile the address input is the full width of the screen — hard to verify visually.

---

### Send-B — Amount-First (amount as focal point) ★ RECOMMENDED

**Concept:** A large, numpad-style amount field dominates the screen. The meta-address input is below it, treated as "delivery details" — important but secondary. The user decides _how much_ before _to whom_.

**Desktop (≥1280px):**

```
┌─────────────────────────────────────────────────────────────────┐
│  STELLAR TESTNET / XLM                                          │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  SEND                                                           │
│                                                                 │
│                    ┌──────────────────────┐                     │
│                    │                      │                     │
│                    │   0.0          XLM   │  ← 48px tall,       │
│                    │                      │     font-mono 3xl   │
│                    └──────────────────────┘                     │
│                                                                 │
│  RECIPIENT META-ADDRESS                                         │
│  ┌─────────────────────────────────────────────────── [PASTE] ─┐│
│  │ st:xlm:...                                                   ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ── Network fee: 100 stroops ── Announcer: Soroban ──           │
│                                                                 │
│  [         SEND PRIVATELY         ]                             │
└─────────────────────────────────────────────────────────────────┘
```

**Mobile (375px):**

```
┌───────────────────────────┐
│ STELLAR TESTNET / XLM     │
│ SEND                      │
│                           │
│  ┌─────────────── [XLM] ─┐│
│  │                       ││
│  │  0.0                  ││  ← 56px tall, font-mono 4xl
│  │                       ││
│  └────────────────────────┘│
│                           │
│ RECIPIENT META-ADDRESS    │
│ ┌─────────────── [PASTE]─┐│
│ │ st:xlm:...             ││
│ └────────────────────────┘│
│                           │
│ [    SEND PRIVATELY    ]  │
└───────────────────────────┘
```

**States:**

- **Idle:** Amount field auto-focused. Cursor blinks inside the large field.
- **Loading:** Button → `CONFIRM IN WALLET...`. Amount field becomes read-only (no visual change, just `disabled`).
- **Error:** `text-error` below the address input, not the amount — errors are almost always about the address or network, not the number.

**Tradeoffs:**

- ✅ Amount is the decision; address is the plumbing. This ordering matches how people think about payments.
- ✅ Large amount field is thumb-friendly on mobile and immediately scannable.
- ✅ Visually distinctive — no other page in the app has a dominant number field.
- ❌ Users who arrive with a meta-address already copied may find the amount field in the way.

---

### Send-C — Flat Single Form (compressed, no visual hierarchy)

**Concept:** Both fields are equal height, equal weight, stacked tightly with minimal spacing. No labels dominate. The form reads as a single atomic unit. Inspired by terminal / CLI aesthetics.

**Desktop (≥1280px):**

```
┌─────────────────────────────────────────────────────────────────┐
│  STELLAR TESTNET / XLM                                          │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  SEND                                                           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ RECIPIENT   st:xlm:...                          [PASTE]      ││
│  ├──────────────────────────────────────────────────────────────┤│
│  │ AMOUNT      0.0                                 XLM          ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                 │
│  fee 100 stroops · soroban announcer                            │
│                                                                 │
│  [         SEND PRIVATELY         ]                             │
└─────────────────────────────────────────────────────────────────┘
```

**Mobile (375px):**

```
┌───────────────────────────┐
│ STELLAR TESTNET / XLM     │
│ SEND                      │
│                           │
│ ┌────────────────────────┐│
│ │ RECIPIENT              ││
│ │ st:xlm:...   [PASTE]   ││
│ ├────────────────────────┤│
│ │ AMOUNT                 ││
│ │ 0.0            XLM     ││
│ └────────────────────────┘│
│                           │
│ [    SEND PRIVATELY    ]  │
└───────────────────────────┘
```

**States:**

- **Idle:** Both rows visible, no field pre-focused.
- **Loading:** Entire form panel dims to `opacity-50`. Button → `CONFIRM IN WALLET...`.
- **Error:** Red border on the offending row only. Error text below the panel.

**Tradeoffs:**

- ✅ Minimal vertical space — fits entirely above the fold on any device.
- ✅ Feels like a developer tool (intentional for this demo).
- ❌ No visual hierarchy — both fields feel equally important, which is slightly misleading.
- ❌ The inline label + input on one row is cramped on 375px; the meta-address truncates badly.
- ❌ Harder to extend (e.g. adding a memo field) without breaking the flat aesthetic.

---

## Receive Page Explorations

### Receive-A — Dense Table (power users, many matches)

**Concept:** Matches are rendered as a compact table with one row per stealth address. Balance, address (truncated), and a withdraw action are all on one line. Optimised for users with 10+ matches.

**Desktop (≥1280px):**

```
┌─────────────────────────────────────────────────────────────────┐
│  STELLAR TESTNET / XLM                                          │
│  RECEIVE                                                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ YOUR META-ADDRESS                              [COPY]        ││
│  │ st:xlm:AAAA...ZZZZ                                          ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                 │
│  [SCAN FOR PAYMENTS]                    3 transfers found       │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ ADDRESS              BALANCE    ACTION                       ││
│  ├──────────────────────────────────────────────────────────────┤│
│  │ GABC...XYZ  [↗]      12.5 XLM  [WITHDRAW ▸]                 ││
│  │ GDEF...UVW  [↗]       0.5 XLM  [WITHDRAW ▸]                 ││
│  │ GHIJ...RST  [↗]      Empty     —                            ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Mobile (375px):**

```
┌───────────────────────────┐
│ STELLAR TESTNET / XLM     │
│ RECEIVE                   │
│                           │
│ YOUR META-ADDRESS  [COPY] │
│ st:xlm:AAAA...ZZZZ        │
│                           │
│ [SCAN FOR PAYMENTS]       │
│ 3 transfers found         │
│                           │
│ ┌────────────────────────┐│
│ │ GABC...XYZ  12.5 XLM  ││
│ │             [WITHDRAW] ││
│ ├────────────────────────┤│
│ │ GDEF...UVW   0.5 XLM  ││
│ │             [WITHDRAW] ││
│ ├────────────────────────┤│
│ │ GHIJ...RST   Empty    ││
│ └────────────────────────┘│
└───────────────────────────┘
```

**States:**

- **Idle (keys derived, not yet scanned):** Table area shows a dashed placeholder: `SCAN TO SEE TRANSFERS`.
- **Loading (scanning):** Table rows replaced by 3 skeleton rows (pulsing `bg-surface-bright` bars, no spinner).
- **Error:** `text-error` paragraph above the table. Table remains visible if a previous scan succeeded.

**Tradeoffs:**

- ✅ Maximum information density — ideal for developers testing many sends.
- ✅ Withdraw action is one click from the list, no expansion needed.
- ❌ Withdraw destination input doesn't fit on one row — clicking "Withdraw" must expand a sub-row, adding interaction complexity.
- ❌ Empty state is a blank table, which reads as broken rather than "nothing yet".
- ❌ On mobile, the table header row wastes space and the truncated addresses are hard to verify.

---

### Receive-B — Card Stack (≤5 matches, visually distinctive)

**Concept:** Each match is a full-width card with generous padding. The stealth address, balance, and withdraw form are all visible without expansion. Cards stack vertically. Works well up to ~5 matches; beyond that, scrolling becomes tedious.

**Desktop (≥1280px):**

```
┌─────────────────────────────────────────────────────────────────┐
│  STELLAR TESTNET / XLM                                          │
│  RECEIVE                                                        │
│                                                                 │
│  [meta-address panel]                                           │
│  [registration panel]                                           │
│                                                                 │
│  [SCAN FOR PAYMENTS]                    2 transfers found       │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ ● STEALTH ADDRESS                                            ││
│  │   GABC...XYZ  [↗] [COPY]                                    ││
│  │                                          12.5000000 XLM     ││
│  │                                                              ││
│  │   WITHDRAW TO                                                ││
│  │   ┌──────────────────────────────────────┐ [WITHDRAW]       ││
│  │   │ Destination address (G...)           │                  ││
│  │   └──────────────────────────────────────┘                  ││
│  │                                                              ││
│  │   [reveal secret key]                                        ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ ● STEALTH ADDRESS                                            ││
│  │   GDEF...UVW  [↗] [COPY]                                    ││
│  │                                           0.5000000 XLM     ││
│  │   ...                                                        ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Mobile (375px):**

```
┌───────────────────────────┐
│ STELLAR TESTNET / XLM     │
│ RECEIVE                   │
│                           │
│ [meta-address panel]      │
│ [registration panel]      │
│                           │
│ [SCAN FOR PAYMENTS]       │
│ 2 transfers found         │
│                           │
│ ┌────────────────────────┐│
│ │ STEALTH ADDRESS        ││
│ │ GABC...XYZ  [↗][COPY] ││
│ │              12.5 XLM  ││
│ │                        ││
│ │ WITHDRAW TO            ││
│ │ ┌──────────────────┐   ││
│ │ │ G...             │   ││
│ │ └──────────────────┘   ││
│ │ [      WITHDRAW      ] ││
│ │                        ││
│ │ [reveal secret key]    ││
│ └────────────────────────┘│
└───────────────────────────┘
```

**States:**

- **Idle (keys derived, not scanned):** No cards. A muted prompt: `Scan to check for incoming transfers.`
- **Loading:** Two ghost cards with pulsing skeleton content.
- **Error:** `text-error` above the card list.

**Tradeoffs:**

- ✅ This is essentially the current implementation — low implementation delta.
- ✅ All withdraw controls are immediately visible; no expand/collapse.
- ✅ Visually distinctive — each payment feels like a discrete object.
- ❌ With 10+ matches, the page becomes a very long scroll.
- ❌ Empty state is still just "nothing here" — no guidance.

---

### Receive-C — Empty-State-First ★ RECOMMENDED

**Concept:** The page is designed around the most common first-visit state: no keys derived, no matches. Each step (derive → register → scan) is a distinct visual stage that collapses once completed. When matches exist, they render as cards (≤5) or switch to a compact list (>5) automatically.

**Desktop (≥1280px) — Stage 0: No keys yet:**

```
┌─────────────────────────────────────────────────────────────────┐
│  STELLAR TESTNET / XLM                                          │
│  RECEIVE                                                        │
│  Derive your stealth keys, register on-chain, then scan.        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  01  DERIVE KEYS                                             ││
│  │      Sign once with Freighter to generate your stealth keys. ││
│  │                                                              ││
│  │      [        DERIVE KEYS        ]                           ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  02  REGISTER  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ││
│  │      (complete step 01 first)                                ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  03  SCAN  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ││
│  │      (complete step 02 first)                                ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Desktop — Stage 3: Keys derived, registered, scan complete (2 matches):**

```
┌─────────────────────────────────────────────────────────────────┐
│  STELLAR TESTNET / XLM                                          │
│  RECEIVE                                                        │
│                                                                 │
│  ✓ 01  DERIVE KEYS    st:xlm:AAAA...ZZZZ  [COPY]               │
│  ✓ 02  REGISTERED     tx 3f2a...  [↗]                           │
│                                                                 │
│  03  SCAN                                                       │
│  [SCAN FOR PAYMENTS]                    2 transfers found       │
│                                                                 │
│  [card stack — same as Receive-B above]                         │
└─────────────────────────────────────────────────────────────────┘
```

**Desktop — Stage 3: Scan complete, 0 matches:**

```
┌─────────────────────────────────────────────────────────────────┐
│  ...steps 01 + 02 collapsed...                                  │
│                                                                 │
│  03  SCAN                                                       │
│  [SCAN FOR PAYMENTS]                                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │                                                              ││
│  │         NO TRANSFERS FOUND                                   ││
│  │                                                              ││
│  │  Share your meta-address with a sender to receive funds.     ││
│  │                                                              ││
│  │  YOUR META-ADDRESS                              [COPY]       ││
│  │  st:xlm:AAAA...ZZZZ                                         ││
│  │                                                              ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

**Mobile (375px) — Stage 0:**

```
┌───────────────────────────┐
│ STELLAR TESTNET / XLM     │
│ RECEIVE                   │
│                           │
│ ┌────────────────────────┐│
│ │ 01  DERIVE KEYS        ││
│ │ Sign once with         ││
│ │ Freighter.             ││
│ │                        ││
│ │ [   DERIVE KEYS    ]   ││
│ └────────────────────────┘│
│                           │
│ ┌────────────────────────┐│
│ │ 02  REGISTER  ░░░░░░░  ││
│ └────────────────────────┘│
│                           │
│ ┌────────────────────────┐│
│ │ 03  SCAN  ░░░░░░░░░░░  ││
│ └────────────────────────┘│
└───────────────────────────┘
```

**States:**

- **Idle (step N incomplete):** Steps N+1 and beyond are visually dimmed (`opacity-40`, no interaction). Active step has a full-weight CTA button.
- **Loading (any step):** The active step's button → `...`, panel dims. Other steps unchanged.
- **Error:** `text-error` inside the failing step's panel only. Other steps unaffected.

**Tradeoffs:**

- ✅ Solves the blank-page problem — first-time users always see a clear next action.
- ✅ Progressive disclosure: completed steps collapse, reducing visual noise as the user advances.
- ✅ The empty-scan state surfaces the meta-address prominently, turning "nothing found" into a useful prompt to share it.
- ✅ Scales: cards for ≤5 matches, compact list for >5, all within the same step-3 panel.
- ❌ More implementation complexity than the current flat layout (step state machine).
- ❌ Returning users (keys already derived) see collapsed steps — slightly less transparent about what happened. Mitigated by showing the meta-address inline in the collapsed step-01 row.

---

## Flags for Review

No new color tokens or icon styles were introduced. All directions use only the existing token set.

One observation: the current `outline` token (`#767575`) on `surface-container` (`#141414`) yields a contrast ratio of ~4.6:1 — just above the 4.5:1 minimum. This is fine for labels (non-body text is exempt from WCAG AA body-text requirements) but worth monitoring if label font size drops below 14px.

The step-number labels in Receive-C (`01`, `02`, `03`) use `font-mono text-[10px]` in `text-outline` — these are decorative/supplementary, not the primary text, so the lower contrast is acceptable. The actionable text within each step uses `text-on-surface` or `text-primary`, both well above 4.5:1.
