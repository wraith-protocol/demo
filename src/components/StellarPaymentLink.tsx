import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CopyButton } from '@/components/CopyButton';

export interface StellarPaymentLinkProps {
  metaAddress: string;
}

export function StellarPaymentLink({ metaAddress }: StellarPaymentLinkProps) {
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [expiresIn, setExpiresIn] = useState('24h');
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  const handleGenerate = () => {
    const url = new URL(window.location.origin + '/pay');
    url.searchParams.set('to', metaAddress);
    if (amount) url.searchParams.set('amount', amount);
    if (memo) url.searchParams.set('memo', memo);

    let expSecs = 0;
    const nowSecs = Math.floor(Date.now() / 1000);
    if (expiresIn === '1h') expSecs = nowSecs + 3600;
    else if (expiresIn === '24h') expSecs = nowSecs + 86400;
    else if (expiresIn === '7d') expSecs = nowSecs + 7 * 86400;

    if (expSecs > 0) {
      url.searchParams.set('exp', expSecs.toString());
    }

    setGeneratedUrl(url.toString());
  };

  return (
    <div className="border border-outline-variant bg-surface-container p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Receive Payment
        </span>
        <button
          onClick={() => setShowForm(!showForm)}
          className="font-mono text-[10px] font-semibold uppercase tracking-widest text-primary transition-colors hover:brightness-110"
        >
          {showForm ? 'Close' : 'Generate Payment Link'}
        </button>
      </div>

      {showForm && (
        <div className="mt-4 flex flex-col gap-4 border-t border-outline-variant/30 pt-4">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Amount (optional)
            </label>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="h-10 border border-outline-variant bg-surface px-3 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Memo (optional)
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="e.g. Coffee"
              maxLength={28}
              className="h-10 border border-outline-variant bg-surface px-3 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Expires In
            </label>
            <select
              value={expiresIn}
              onChange={(e) => setExpiresIn(e.target.value)}
              className="h-10 border border-outline-variant bg-surface px-3 font-mono text-sm text-primary focus:border-primary"
            >
              <option value="1h">1 hour</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="never">Never</option>
            </select>
          </div>
          <button
            onClick={handleGenerate}
            className="mt-2 h-10 w-full bg-primary font-heading text-[11px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110"
          >
            Generate Link
          </button>
        </div>
      )}

      {showForm && generatedUrl && (
        <div className="mt-6 flex flex-col items-center gap-4 border-t border-outline-variant/30 pt-6">
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={generatedUrl} size={160} />
          </div>
          <div className="flex w-full items-center gap-2 rounded bg-surface p-2 border border-outline-variant">
            <code className="block flex-1 truncate font-mono text-[10px] text-primary">
              {generatedUrl}
            </code>
            <CopyButton text={generatedUrl} />
          </div>
        </div>
      )}
    </div>
  );
}
