import { useState } from 'react';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { StellarVaultDeposit } from './StellarVaultDeposit';
import { StellarVaultClaim } from './StellarVaultClaim';
import { VaultStatusTable } from './VaultStatusTable';

type VaultTab = 'deposit' | 'claim' | 'status';

export function StellarVault() {
  const { isConnected } = useStellarWallet();
  const [activeTab, setActiveTab] = useState<VaultTab>('deposit');

  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / XLM
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Stealth Vault
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your Freighter wallet to use the stealth vault for time-locked deposits.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / XLM
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Stealth Vault
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Create time-locked deposits, claim after unlock, or refund after the refund window.
        </p>
      </div>

      <div className="flex gap-2 border-b border-outline-variant">
        <button
          onClick={() => setActiveTab('deposit')}
          className={`px-4 py-3 font-heading text-xs uppercase tracking-widest transition-colors ${
            activeTab === 'deposit'
              ? 'border-b-2 border-tertiary text-on-surface'
              : 'border-b-2 border-transparent text-outline hover:text-on-surface-variant'
          }`}
        >
          Create Deposit
        </button>
        <button
          onClick={() => setActiveTab('claim')}
          className={`px-4 py-3 font-heading text-xs uppercase tracking-widest transition-colors ${
            activeTab === 'claim'
              ? 'border-b-2 border-tertiary text-on-surface'
              : 'border-b-2 border-transparent text-outline hover:text-on-surface-variant'
          }`}
        >
          Claim
        </button>
        <button
          onClick={() => setActiveTab('status')}
          className={`px-4 py-3 font-heading text-xs uppercase tracking-widest transition-colors ${
            activeTab === 'status'
              ? 'border-b-2 border-tertiary text-on-surface'
              : 'border-b-2 border-transparent text-outline hover:text-on-surface-variant'
          }`}
        >
          Status
        </button>
      </div>

      {activeTab === 'deposit' && <StellarVaultDeposit />}
      {activeTab === 'claim' && <StellarVaultClaim />}
      {activeTab === 'status' && <VaultStatusTable />}
    </section>
  );
}
