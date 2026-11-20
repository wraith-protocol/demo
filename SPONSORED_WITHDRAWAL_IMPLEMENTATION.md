# Stellar Sponsored Withdrawal Implementation

## Overview

This document describes the implementation of sponsored withdrawals for Stellar stealth addresses that have insufficient balance to pay their own transaction fees.

## Problem Statement

A stealth address on Stellar that has received only a small payment may not have enough XLM to pay the base reserve (1 XLM) and transaction fee for a withdrawal. Previously, the demo would silently fail in these cases.

## Solution

Implemented fee-bump transactions where a sponsor account (the user's connected Freighter wallet) pays fees on behalf of the stealth account's inner transaction.

## Implementation Details

### Files Modified

- `src/components/StellarReceive.tsx`

### Key Features

#### 1. Auto-Detection of Sponsorship Need

The system automatically detects when a stealth account needs sponsorship by checking:

```typescript
const currentBalance = parseFloat(xlmBal.balance);
const subentryCount = account.subentry_count ?? 0;
const baseReserve = 0.5; // 0.5 XLM per base reserve
const minAccountReserve = (2 + subentryCount) * baseReserve;
const estimatedFee = 0.00001; // 100 stroops base fee
const feeBumpFee = 0.0001; // Additional fee for fee-bump envelope

const needsSponsor = currentBalance < minAccountReserve + estimatedFee + feeBumpFee;
```

#### 2. User Consent UI

When sponsorship is needed, a clear UI prompt is shown:

- Explains that the stealth address can't pay its own fees
- Informs the user that their connected wallet will sponsor the transaction
- Warns that Freighter will prompt for signature
- Clarifies that the entire balance (including base reserve) will be merged

#### 3. Fee-Bump Transaction Flow

The sponsored withdrawal uses Stellar's fee-bump transaction primitive:

**Inner Transaction:**

- Source: Stealth account
- Operation: `accountMerge` to destination
- Fee: 0 (will be paid by outer transaction)
- Signed by: Derived stealth private key

**Outer Fee-Bump Transaction:**

- Fee source: Connected wallet (sponsor)
- Fee: 1000 stroops (0.0001 XLM)
- Signed by: Freighter wallet

#### 4. Account Merge Operation

The implementation uses `accountMerge` instead of `payment` for sponsored withdrawals because:

- It recovers the entire balance including the base reserve
- It's cleaner for stealth UX (no dust left behind)
- The stealth account is closed after withdrawal

### Code Structure

#### New State Variables

```typescript
const [feeBumpHash, setFeeBumpHash] = useState<string | null>(null);
const [showSponsorPrompt, setShowSponsorPrompt] = useState(false);
```

#### New Function: `handleSponsoredWithdraw`

Handles the complete sponsored withdrawal flow:

1. Fetches stealth account details
2. Builds inner transaction with `accountMerge` operation
3. Signs inner transaction with stealth key
4. Builds fee-bump transaction wrapper
5. Signs fee-bump with connected wallet (via Freighter)
6. Submits fee-bump transaction to Horizon
7. Updates UI with transaction hash

### User Experience

#### Standard Withdrawal (Sufficient Balance)

1. User enters destination address
2. Clicks "Withdraw"
3. Transaction is submitted directly
4. Success message with transaction link

#### Sponsored Withdrawal (Insufficient Balance)

1. User enters destination address
2. Clicks "Withdraw"
3. System detects insufficient balance
4. Sponsored withdrawal prompt appears
5. User clicks "Pay with Connected Wallet"
6. Freighter prompts for signature
7. Transaction is submitted
8. Success message indicates sponsored withdrawal with transaction link

### Technical Considerations

#### Fee Calculation

- Base reserve: 0.5 XLM per entry (minimum 2 entries = 1 XLM)
- Standard transaction fee: 100 stroops (0.00001 XLM)
- Fee-bump fee: 1000 stroops (0.0001 XLM)

#### Error Handling

- Validates connected wallet is available for sponsorship
- Checks stealth account exists and has balance
- Handles Freighter signature rejection
- Provides clear error messages to user

#### Transaction Verification

- Both inner and outer transaction hashes are tracked
- UI indicates when a withdrawal was sponsored
- Links to Stellar explorer for transaction details

## Testing Recommendations

### Manual Testing Scenarios

1. **Standard withdrawal**: Stealth account with > 2 XLM balance
2. **Sponsored withdrawal**: Stealth account with < 2 XLM balance
3. **User cancellation**: Cancel sponsored withdrawal prompt
4. **Freighter rejection**: Reject signature in Freighter
5. **Network errors**: Test with network disconnection

### Playwright Test Coverage (Recommended)

- Happy path: Sponsored withdrawal with small balance
- Standard withdrawal path still works
- UI shows correct prompts and messages
- Transaction links are valid

## Future Enhancements

### Potential Improvements

1. **Dynamic fee estimation**: Query network for current base fee
2. **Batch withdrawals**: Sponsor multiple stealth withdrawals in one fee-bump
3. **Gas estimation**: Show user exact fee they'll pay as sponsor
4. **Partial withdrawals**: Allow withdrawing less than full balance with sponsorship

### Documentation Needs

- User guide: `docs/guides/stellar-sponsored-withdraw.mdx`
- Developer guide: Fee-bump transaction patterns
- FAQ: When sponsorship is needed and why

## References

- [Stellar Fee-Bump Transactions](https://developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/fee-bump-transactions)
- [Stellar Account Merge Operation](https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations#account-merge)
- [Stellar Base Reserve](https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance)

## Acceptance Criteria Status

✅ Sponsored-withdraw flow implemented and visible in the UI
✅ Auto-detect of "needs sponsorship" based on balance/fee math
✅ Uses `accountMerge` to recover base reserve
✅ Clear UI communication about Freighter prompts
⏳ Playwright test coverage (recommended next step)
⏳ Documentation follow-up (recommended next step)

## Decision: mergeAccount vs Dust-Resistant

**Decision Made**: Always use `mergeAccount` for sponsored withdrawals.

**Rationale**:

1. **User Experience**: Stealth addresses are meant to be ephemeral. Leaving dust behind creates confusion.
2. **Privacy**: Closing the account completely is cleaner from a privacy perspective.
3. **Cost Recovery**: Users recover the full 1 XLM base reserve, not just the balance minus reserve.
4. **Simplicity**: One clear path for sponsored withdrawals is easier to understand and maintain.

**Alternative Considered**: Leaving accounts open with dust for potential future use was considered but rejected because:

- Stealth addresses are typically single-use
- Managing multiple dust accounts is poor UX
- The base reserve is significant (1 XLM) and should be recovered
