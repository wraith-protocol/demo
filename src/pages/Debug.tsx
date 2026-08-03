import { getDeployment } from '@wraith-protocol/sdk/chains/stellar';
import { StellarLink } from '@/components/StellarLink';
import { STELLAR_NETWORK } from '@/config';

export default function Debug() {
  const deployment = getDeployment('stellar');
  const contracts = [
    ['Announcer', deployment.contracts.announcer],
    ['Names registry', deployment.contracts.names],
  ] as const;

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Developer tools
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Stellar debug
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Active network endpoints and deployed Wraith contracts.
        </p>
      </div>

      <div className="border border-outline-variant bg-surface-container">
        <dl className="divide-y divide-outline-variant">
          <div className="grid gap-2 p-4 sm:grid-cols-[140px_minmax(0,1fr)]">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Network
            </dt>
            <dd className="font-mono text-xs text-on-surface">{STELLAR_NETWORK.name}</dd>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-[140px_minmax(0,1fr)]">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Horizon
            </dt>
            <dd className="break-all font-mono text-xs text-on-surface-variant">
              {STELLAR_NETWORK.horizonUrl}
            </dd>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-[140px_minmax(0,1fr)]">
            <dt className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Soroban RPC
            </dt>
            <dd className="break-all font-mono text-xs text-on-surface-variant">
              {STELLAR_NETWORK.rpcUrl}
            </dd>
          </div>
          {contracts.map(([label, contractId]) => (
            <div key={label} className="grid gap-2 p-4 sm:grid-cols-[140px_minmax(0,1fr)]">
              <dt className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {label}
              </dt>
              <dd className="min-w-0">
                <StellarLink
                  value={contractId}
                  type="contract"
                  className="max-w-full"
                  linkClassName="text-xs"
                />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
