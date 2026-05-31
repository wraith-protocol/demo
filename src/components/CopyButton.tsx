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
      className="flex h-10 shrink-0 items-center px-2 font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary active:bg-surface-bright"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
