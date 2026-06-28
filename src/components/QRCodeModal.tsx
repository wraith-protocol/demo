import { useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CopyButton } from '@/components/CopyButton';

interface QRCodeModalProps {
  value: string;
  onClose: () => void;
  title?: string;
}

export function QRCodeModal({ value, onClose, title = 'Stealth Meta-Address' }: QRCodeModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Close on Escape key press, and focus close button on mount
  useEffect(() => {
    if (closeButtonRef.current) {
      closeButtonRef.current.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: title,
          text: value,
        });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      // Fallback: Copy to clipboard
      try {
        await navigator.clipboard.writeText(value);
      } catch (err) {
        console.error('Failed to copy address:', err);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div className="w-full max-w-sm border border-outline-variant bg-surface-container p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="qr-modal-title"
            className="font-heading text-lg font-bold uppercase tracking-tight text-on-surface"
          >
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close modal"
            className="text-outline hover:text-primary transition-colors focus:outline-none focus:ring-1 focus:ring-primary p-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="rounded-lg bg-white p-4">
            <QRCodeSVG value={value} size={200} />
          </div>

          <div className="flex w-full items-center gap-2 rounded bg-surface p-2 border border-outline-variant">
            <code className="block flex-1 truncate font-mono text-[10px] text-primary">
              {value}
            </code>
            <CopyButton text={value} />
          </div>

          <div className="flex w-full gap-2 mt-2">
            <button
              onClick={handleShare}
              className="flex-1 bg-primary py-2.5 font-heading text-[11px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              Share Address
            </button>
            <button
              onClick={onClose}
              className="flex-1 border border-outline-variant py-2.5 font-heading text-[11px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright focus:outline-none focus:ring-1 focus:ring-primary"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
