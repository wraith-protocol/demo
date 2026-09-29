# Transaction Idempotency Protection

## Overview

This document describes the idempotency protection system implemented to prevent duplicate transaction submissions in the Wraith Protocol demo application.

## Problem Statement

Before this implementation, the application had several issues:
- Users could accidentally submit the same transaction multiple times by clicking rapidly
- Slow wallet responses could lead to duplicate submissions
- Page reloads during pending transactions could result in re-submission
- Network timeouts didn't have proper handling to prevent retries

## Solution

The idempotency protection system consists of three main components:

### 1. Transaction Intent Store (`src/stores/transactionIntentStore.ts`)

A Zustand store that tracks all transaction intents with the following features:

**Intent Lifecycle:**
- `pending` - Intent created, waiting to be processed
- `signing` - User is signing the transaction in wallet
- `submitting` - Transaction is being submitted to network
- `confirmed` - Transaction successfully confirmed
- `failed` - Transaction failed
- `abandoned` - Intent expired without completion

**Key Features:**
- Generates unique intent IDs for each transaction attempt
- Stores intent metadata (recipient, amount, asset, etc.)
- Prevents duplicate intents with same parameters
- Auto-expires intents after 5 minutes
- Persists to localStorage for recovery after reload
- Cleans up old intents (24 hour retention for completed/failed)

**API:**
```typescript
const {
  createIntent,           // Create new intent
  getIntent,             // Get intent by ID
  updateIntentStatus,    // Update status
  setIntentTxHash,       // Set transaction hash
  findPendingIntent,     // Find existing pending intent
  cleanupExpired,        // Remove expired intents
  abandonIntent,         // Manually abandon intent
} = useTransactionIntentStore();
```

### 2. Idempotent Transaction Hook (`src/hooks/useIdempotentTransaction.ts`)

A React hook that wraps transaction submission with idempotency protection:

**Features:**
- Prevents concurrent submissions from same component
- Checks for existing pending intents before creating new one
- Integrates with activity store for transaction tracking
- Provides loading state and error handling
- Supports success/error callbacks

**Usage:**
```typescript
const { isSubmitting, submit, reset } = useIdempotentTransaction({
  chain: 'stellar',
  wallet: address,
  action: 'send',
  metadata: {
    recipient: metaAddress,
    amount: amountValue,
    asset: assetKey,
  },
});

// In submit handler
await submit(
  async () => {
    // Build and submit transaction
    const txHash = await buildAndSubmit();
    return {
      txHash,
      result: { success: true },
    };
  },
  {
    onSuccess: (result) => {
      // Handle success
    },
    onError: (error) => {
      // Handle error
    },
  }
);
```

### 3. Updated Components

**StellarSend Component:**
- Integrated `useIdempotentTransaction` hook
- Wrapped transaction building in idempotent submit
- Button disabled during submission
- Reset clears intent state

**Other Components to Update:**
- `StellarBatchWithdrawModal.tsx` - Batch withdrawals
- `StellarSplit.tsx` - Batch sends
- `Names.tsx` - Name registration/transfer/renewal
- `StellarVaultDeposit.tsx` - Vault deposits
- `StellarVaultClaim.tsx` - Vault claims

## Deduplication Strategy

### Intent Matching

Intents are matched by a deterministic key generated from:
- Chain
- Wallet address
- Action type
- Metadata (recipient, amount, asset, etc.)

Example:
```
stellar:GTEST123:send:recipient=st:xlm:test&amount=10&asset=XLM
```

### Duplicate Prevention

1. **Before Submission:**
   - Check if pending intent exists with same parameters
   - If found, block submission and return existing intent ID

2. **During Signing:**
   - Component-level lock prevents concurrent calls
   - Intent status set to `signing`

3. **During Submission:**
   - Intent status set to `submitting`
   - Transaction hash recorded

4. **After Completion:**
   - Intent status set to `confirmed` or `failed`
   - Activity store updated

5. **After Page Reload:**
   - Persisted intents loaded from localStorage
   - Pending intents block re-submission
   - Expired intents (>5 minutes) auto-abandoned

## Testing

### Unit Tests

**Transaction Intent Store Tests** (`transactionIntentStore.test.ts`):
- ✅ Create new intent
- ✅ Prevent duplicate intents with same parameters
- ✅ Allow new intent after previous confirmed
- ✅ Update intent status
- ✅ Set transaction hash
- ✅ Cleanup expired intents
- ✅ Find pending intent
- ✅ Abandon intent manually
- ✅ Handle wallet rejection
- ✅ Handle network timeout
- ✅ Prevent duplicate during retry

**Idempotent Transaction Hook Tests** (`useIdempotentTransaction.test.ts`):
- ✅ Handle successful submission
- ✅ Prevent double submission on rapid clicks
- ✅ Handle wallet rejection
- ✅ Handle network timeout
- ✅ Block duplicate with same parameters
- ✅ Allow retry after failure
- ✅ Call success/error callbacks
- ✅ Handle page reload scenario

### Integration Tests

Run tests with:
```bash
pnpm test:unit transactionIntentStore.test
pnpm test:unit useIdempotentTransaction.test
```

## Edge Cases Handled

1. **Double Click:**
   - Component lock prevents concurrent submissions
   - Intent store blocks duplicate intents

2. **Slow Wallet Response:**
   - Intent remains in `signing` state
   - New submission attempts blocked

3. **Network Timeout:**
   - Intent marked as `failed` with error message
   - **Timeout Reconciliation**: If transaction has a hash, reconcile function checks Horizon
   - If transaction succeeded on Horizon despite timeout, status updated to `confirmed`
   - Prevents duplicate submission of transactions that succeeded but client timed out
   - User can retry with reset

4. **Sent-But-Timeout Scenario:**
   - Transaction submitted to Horizon successfully
   - Client times out waiting for response
   - Reconcile function queries Horizon for transaction status
   - If found and successful, intent/activity marked as `confirmed`
   - If not found or failed, intent/activity marked as `failed`
   - Prevents false negatives where transaction succeeded but client thought it failed

5. **Page Reload During Submission:**
   - Persisted intents prevent re-submission
   - Expired intents (>5 min) auto-abandoned

6. **Wallet Rejection:**
   - Intent marked as `failed`
   - User can retry after reset

7. **Transaction Built But Submission Failed:**
   - Transaction hash recorded in intent
   - Activity store updated to failed status (after reconciliation attempt)

## Migration Guide

To add idempotency protection to a component:

1. **Import the hook:**
```typescript
import { useIdempotentTransaction } from '@/hooks/useIdempotentTransaction';
```

2. **Set up the hook:**
```typescript
const { isSubmitting, submit, reset } = useIdempotentTransaction({
  chain: 'stellar',
  wallet: address || '',
  action: 'send', // or 'batch-send', 'vault-deposit', etc.
  metadata: {
    // Include parameters that should prevent duplicates
    recipient: metaAddress,
    amount: amountValue,
    asset: assetKey,
  },
});
```

3. **Wrap transaction submission:**
```typescript
const handleSubmit = async () => {
  await submit(
    async () => {
      // Your existing transaction building logic
      const tx = await buildTransaction();
      const txHash = tx.hash().toString('hex');
      
      // Submit transaction
      await submitToNetwork(tx);
      
      return {
        txHash,
        result: { /* any data you want to pass to onSuccess */ },
      };
    },
    {
      onSuccess: (result) => {
        // Success handling
        setIsSuccess(true);
      },
      onError: (error) => {
        // Error handling
        setError(error.message);
      },
    }
  );
};
```

4. **Update button disabled state:**
```typescript
<button
  onClick={handleSubmit}
  disabled={!canSubmit || isSubmitting}
>
  Send
</button>
```

5. **Update reset function:**
```typescript
const handleReset = () => {
  // Your existing reset logic
  setRecipient('');
  setAmount('');
  
  // Reset idempotent state
  reset();
};
```

## Architecture Decisions

### Why Separate Intent and Activity Stores?

- **Intent Store:** Tracks submission attempts (may fail, may be abandoned)
- **Activity Store:** Tracks confirmed transactions (blockchain state)
- Separation allows for cleaner reconciliation and separate concerns

### Why 5 Minute Expiration?

- Long enough for most wallet interactions
- Short enough to not block legitimate retries
- Balances UX vs. safety

### Why Deterministic vs. Random Keys?

- Deterministic keys enable deduplication across page reloads
- Random component helps prevent collisions
- Hybrid approach: deterministic matching + unique IDs

### Why Component-Level Lock?

- Prevents React state race conditions
- Simpler than complex state management
- Works with fast user interactions

## Future Enhancements

1. **Blockchain Reconciliation:**
   - Poll blockchain for transaction status
   - Auto-update intent status from on-chain data

2. **Cross-Tab Synchronization:**
   - BroadcastChannel API for multi-tab coordination
   - Prevent duplicates across browser tabs

3. **Retry Strategy:**
   - Exponential backoff for failed submissions
   - Auto-retry on network errors

4. **Analytics:**
   - Track duplicate prevention metrics
   - Monitor intent lifecycle timing

5. **User Feedback:**
   - Visual indicator when submission blocked
   - Show existing pending intent details

## Related Issues

- Resolves: #183 - Add idempotency protection to transaction submissions
- Related: Activity store (#activityStore)
- Related: Transaction submission flows (#transactions)
