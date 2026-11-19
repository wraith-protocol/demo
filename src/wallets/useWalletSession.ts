import { useRef } from 'react';
import { WalletSession, type WalletIdentity } from './session';

/**
 * Keeps a WalletSession in sync with the wallet identity exposed by the
 * chain's provider hooks. The update happens during render so an identity
 * change invalidates in-flight work before any effects can start new work.
 */
export function useWalletSession(identity: WalletIdentity | null): WalletSession {
  const sessionRef = useRef<WalletSession | null>(null);

  if (sessionRef.current === null) {
    sessionRef.current = new WalletSession(identity);
  } else {
    sessionRef.current.update(identity);
  }

  return sessionRef.current;
}
