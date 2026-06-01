import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { getStatusColor, getStatusTextColor, getStatusLabel } from '@/config/networks';

export function NetworkBadge() {
  const { status, expectedNetwork } = useNetworkStatus();

  return (
    <div className={`flex items-center gap-1.5 rounded-none px-2 py-1 ${getStatusColor(status)}/10`}>
      <span className={`inline-block h-1.5 w-1.5 ${getStatusColor(status)}`} />
      <span className={`font-mono text-[9px] uppercase tracking-wider ${getStatusTextColor(status)}`}>
        {status === 'correct' || status === 'unknown' ? expectedNetwork : getStatusLabel(status)}
      </span>
    </div>
  );
}
