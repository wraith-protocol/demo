/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// workbox-precaching injects the precache manifest at the __WB_MANIFEST injection point.
// Declare it here so TypeScript knows about it in the service worker source file.
declare const __WB_MANIFEST: Array<{ url: string; revision: string | null }>;

// Build-time configuration for the Stellar deployment table in
// src/lib/stellar/deployments.ts. Contract IDs are validated before use, so a
// typo here fails the call rather than scanning the wrong contract.
interface ImportMetaEnv {
  /** `testnet` | `futurenet` | `public`; defaults to `testnet`. */
  readonly VITE_STELLAR_NETWORK?: string;
  readonly VITE_STELLAR_ANNOUNCER_CONTRACT_ID?: string;
  readonly VITE_STELLAR_REGISTRY_CONTRACT_ID?: string;
  readonly VITE_WRAITH_NAMES_CONTRACT_ID?: string;
  readonly VITE_STELLAR_VAULT_CONTRACT_ID?: string;
}

interface Window {
  __WRAITH_CONFIG__?: {
    stellarVaultContractId?: string;
  };
  sorobanServerMock?: unknown;
}
