import { useState } from 'react';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
