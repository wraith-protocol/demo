import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${text}`}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
    >
      {copied ? t('copyButton.copied') : t('copyButton.copy')}
    </button>
  );
}
