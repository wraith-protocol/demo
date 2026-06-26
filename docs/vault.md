# Browser Vault

`KeyVault` stores derived stealth keys in IndexedDB and encrypts them with a passphrase using PBKDF2 + AES-GCM.

## What it does

- Keeps plaintext keys out of `localStorage`
- Lets a browser-only app briefly unlock a vault, use the keys, then lock again
- Auto-locks on idle and tab blur when enabled

## What it does not protect against

- A compromised browser, extension, or renderer process
- XSS that can read the page while the vault is unlocked
- Malware, keyloggers, screen capture, or shoulder surfing
- A weak passphrase
- Someone who can already access the unlocked tab

## Not a hardware wallet replacement

This vault is a convenience layer for browser apps that need short-lived access to derived stealth keys. It is not a replacement for a hardware wallet or any other high-assurance signing device.

## Example

```ts
import { KeyVault } from '@/vault';

const vault = new KeyVault({ idleTimeoutMs: 2 * 60 * 1000 });

await vault.unlock(passphrase);
await vault.put('stellar', derivedKeys);
const restored = await vault.get<typeof derivedKeys>('stellar');
await vault.lock();
```
