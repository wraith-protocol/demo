/**
 * src/components/PasskeyUnsupportedCard.tsx
 *
 * Rendered in the Stellar wallet picker instead of a generic error string
 * when a device can't complete the passkey PRF ceremony. Pure and
 * prop-driven — see CONTRIBUTING.md's view/container convention.
 */

interface PasskeyUnsupportedCardProps {
  installUrl: string;
}

export function PasskeyUnsupportedCard({ installUrl }: PasskeyUnsupportedCardProps) {
  return (
    <div
      data-testid="passkey-unsupported-card"
      className="space-y-2 border border-[#2a2a2a] bg-[#1a1a1a] p-4"
    >
      <p className="text-xs font-semibold text-[#e6e1e5]">Passkey isn&apos;t available here</p>
      <p className="text-[11px] leading-relaxed text-[#c4c7c5]">
        This browser or device doesn&apos;t support passkeys with the PRF extension, which the smart
        account needs to derive its signing key. Try a recent Chrome, Safari, or Edge on a device
        with Touch ID, Face ID, Windows Hello, or a PRF-capable hardware security key (e.g. a
        YubiKey with firmware 5.2.7+).
      </p>
      <a
        href={installUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-[11px] text-[#767575] underline hover:text-[#c4c7c5]"
      >
        Check device support ↗
      </a>
    </div>
  );
}
