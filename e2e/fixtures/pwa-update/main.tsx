import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { useSendDraft } from '@/hooks/useSendDraft';
import {
  beginTransactionActivity,
  withTransactionActivity,
  type TransactionPhase,
} from '@/lib/transactionActivity';
import {
  reserveSubmissionOperationId,
  submitStellarTransactionOnce,
} from '@/lib/submissionIdempotency';

/** Deterministic wallet/RPC boundaries, with the production update UI and worker. */
function Fixture() {
  const [draft, setDraft] = useSendDraft<string>('fixture:recipient', '');
  const [status, setStatus] = useState('idle');
  const [finish, setFinish] = useState<(() => void) | null>(null);
  const start = (phase: TransactionPhase) => {
    setFinish(() => beginTransactionActivity(phase));
    setStatus(phase);
  };
  const submit = async () => {
    try {
      await withTransactionActivity('submitting', async () => {
        const id = await reserveSubmissionOperationId(draft);
        await submitStellarTransactionOnce(id, 'stable-hash', 'signed-envelope', async () => {
          const count = Number(localStorage.getItem('fixture-broadcasts') || 0);
          localStorage.setItem('fixture-broadcasts', String(count + 1));
          return 'stable-hash';
        });
      });
      setStatus('submitted');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <>
      <UpdatePrompt />
      <label>
        Recipient
        <input
          aria-label="Recipient"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      {(['simulating', 'signing', 'submitting', 'reconciling'] as const).map((phase) => (
        <button key={phase} onClick={() => start(phase)}>
          {phase}
        </button>
      ))}
      <button
        onClick={() => {
          finish?.();
          setFinish(null);
          setStatus('idle');
        }}
      >
        Finish transaction
      </button>
      <button onClick={() => void submit()}>Submit operation</button>
      <output>{status}</output>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
