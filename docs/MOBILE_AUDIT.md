Mobile UX Audit - Stellar Flows
Date: 2024-05-31
Status: Completed
Devices Tested:

iPhone 13 mini (375×812)
iPhone 15 (393×852)
Pixel 7 (412×915)
iPad (768×1024)
Galaxy S22 (360×780)
1. Stellar Send Flow
Layout Breaks & Observations
Meta-Address Input: On narrow devices (360px), the "Paste" button inside the input field obscures too much of the input area. The touch target for "Paste" is too small (approx 24px height).
Amount Field: Works generally well but the numeric keyboard doesn't always trigger (needs inputMode="decimal").
Wallet Button: "Send Privately" button is 48px high, which is good for touch targets.
Chain Switcher: Touch target in the header is too small (32px).
Fixed Issues
 Increased touch target for "Paste" button and "Chain Switcher".
 Improved input handling for mobile keyboards.
 Fixed overflow potential for long meta-addresses.
2. Stellar Receive Flow
Layout Breaks & Observations
Stealth Address Cards: The stealth address is truncated, which is good, but the "Copy" button is small.
Withdraw Form: On mobile, the flex-row layout for destination input and withdraw button causes extreme clipping. The button becomes unreadable.
Reveal Secret Key: The revealed key uses break-all, which is correct, but the container padding makes it tight on 360px screens.
Design Decision: Inline vs Modal Withdraw
Selected: Improved Inline Form (Stacking)
Argument: For a list of 10+ matches, a modal for each withdraw might feel too disruptive to the "scanning" flow. However, a stacked inline form provides enough space for the address input and a full-width button, improving touch targets and readability without losing the context of the list.

Fixed Issues
 Changed withdraw form from flex-row to flex-col on mobile.
 Increased touch targets for all action buttons.
 Improved "Reveal Secret Key" readability.
3. General Mobile Observations
Touch Targets
Header items (Chain Switcher, Wallet Connect, Menu) were below the recommended 44pt/48dp. Increased to 44px.
1-Handed Reachability
Primary CTAs (Send, Scan, Withdraw) are generally positioned well, but "Scan for Payments" was moved slightly lower to be within easier thumb reach on large phones.
Screenshots
Screenshots of the improved UI can be found in docs/screenshots/stellar-mobile/.