import { useNetworkStatus } from '@/hooks/useNetworkStatus';

export function WrongNetworkBanner() {
  const { status, expectedNetwork, detectedNetwork, switchInstructions, isMainnet, isCorrect } =
    useNetworkStatus();

  if (isCorrect || status === 'unknown') return null;

  const bgClass = isMainnet ? 'bg-red-500/10 border-red-500/30' : 'bg-yellow-500/10 border-yellow-500/30';
  const textClass = isMainnet ? 'text-red-400' : 'text-yellow-400';
  const dotClass = isMainnet ? 'bg-red-500' : 'bg-yellow-500';

  return (
    <div className={`mb-6 border ${bgClass} p-4`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 inline-block h-2 w-2 shrink-0 ${dotClass}`} />
        <div className="flex flex-col gap-1">
          <span className={`font-heading text-xs font-bold uppercase tracking-widest ${textClass}`}>
            {isMainnet ? '⚠ LIVE NETWORK DETECTED' : 'Wrong Network'}
          </span>
          <p className="font-body text-xs leading-relaxed text-on-surface-variant">
            {isMainnet ? (
              <>
                Your wallet is on <strong className="text-on-surface">{detectedNetwork}</strong>, a
                production network. The demo runs on <strong className="text-on-surface">{expectedNetwork}</strong>.
                {' '}{switchInstructions}
              </>
            ) : (
              <>
                Your wallet is connected to <strong className="text-on-surface">{detectedNetwork || 'an unknown network'}</strong>.
                The demo expects <strong className="text-on-surface">{expectedNetwork}</strong>.
                {' '}{switchInstructions}
              </>
            )}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-outline">
            Actions disabled until resolved
          </p>
        </div>
      </div>
    </div>
  );
}
