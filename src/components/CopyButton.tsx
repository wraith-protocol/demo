import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copyText() {
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      aria-label={`Copy ${text}`}
      onClick={() => void copyText()}
      className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
    >
      {copied ? t('copyButton.copied') : t('copyButton.copy')}
    </button>
  );
}
