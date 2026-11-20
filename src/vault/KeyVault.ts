import { IdleLock } from '@/lib/idleLock';

type VaultMetadata = {
  id: 'vault-meta';
  salt: Uint8Array;
  iterations: number;
  verifierIv: Uint8Array;
  verifierCiphertext: Uint8Array;
  createdAt: number;
  updatedAt: number;
};

type VaultEntry = {
  label: string;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  createdAt: number;
  updatedAt: number;
};

export interface KeyVaultOptions {
  dbName?: string;
  entryStoreName?: string;
  metadataStoreName?: string;
  iterations?: number;
  idleTimeoutMs?: number;
  lockOnBlur?: boolean;
  lockOnVisibilityChange?: boolean;
}

const DEFAULT_DB_NAME = 'wraith-key-vault';
const DEFAULT_ENTRY_STORE = 'entries';
const DEFAULT_METADATA_STORE = 'metadata';
const DEFAULT_ITERATIONS = 310_000;
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const VERIFIER_PLAINTEXT = 'vault-ready';

function assertBrowserOnly() {
  if (
    typeof window === 'undefined' ||
    typeof indexedDB === 'undefined' ||
    !globalThis.crypto?.subtle
  ) {
    throw new Error('KeyVault is browser-only and requires IndexedDB plus Web Crypto.');
  }
}

function encodeText(value: string) {
  return new TextEncoder().encode(value);
}

function decodeText(value: ArrayBuffer | Uint8Array) {
  return new TextDecoder().decode(value);
}

function cloneBytes(value: ArrayBuffer | Uint8Array) {
  return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
}

export class KeyVault {
  private readonly dbName: string;
  private readonly entryStoreName: string;
  private readonly metadataStoreName: string;
  private readonly iterations: number;
  private readonly idleTimeoutMs: number;
  private readonly lockOnBlur: boolean;
  private readonly lockOnVisibilityChange: boolean;

  private dbPromise: Promise<IDBDatabase> | null = null;
  private cryptoKey: CryptoKey | null = null;
  private unlocked = false;
  private readonly idleLock: IdleLock;

  constructor(options: KeyVaultOptions = {}) {
    assertBrowserOnly();

    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.entryStoreName = options.entryStoreName ?? DEFAULT_ENTRY_STORE;
    this.metadataStoreName = options.metadataStoreName ?? DEFAULT_METADATA_STORE;
    this.iterations = options.iterations ?? DEFAULT_ITERATIONS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.lockOnBlur = options.lockOnBlur ?? true;
    this.lockOnVisibilityChange = options.lockOnVisibilityChange ?? true;
    this.idleLock = new IdleLock({
      timeoutMs: this.idleTimeoutMs,
      lockOnBlur: this.lockOnBlur,
      lockOnVisibilityChange: this.lockOnVisibilityChange,
      onIdle: () => void this.lock(),
    });
  }

  get isUnlocked() {
    return this.unlocked;
  }

  async unlock(passphrase: string): Promise<void> {
    assertBrowserOnly();

    if (!passphrase) {
      throw new Error('A passphrase is required to unlock the vault');
    }

    const db = await this.openDatabase();
    const metadata = await this.loadOrCreateMetadata(db, passphrase);

    const cryptoKey = await this.deriveKey(passphrase, metadata.salt, metadata.iterations);
    await this.verifyPassphrase(db, cryptoKey, metadata);

    this.cryptoKey = cryptoKey;
    this.unlocked = true;
    this.startAutoLock();
  }

  async lock(): Promise<void> {
    this.idleLock.stop();
    this.cryptoKey = null;
    this.unlocked = false;
  }

  async put<T>(label: string, keys: T): Promise<void> {
    this.ensureUnlocked();

    const db = await this.openDatabase();
    const ciphertext = await this.encryptValue(keys);
    const now = Date.now();
    const entry: VaultEntry = {
      label,
      iv: ciphertext.iv,
      ciphertext: ciphertext.ciphertext,
      createdAt: now,
      updatedAt: now,
    };

    await this.writeRecord(db, this.entryStoreName, entry);
    this.touch();
  }

  async get<T>(label: string): Promise<T | null> {
    this.ensureUnlocked();

    const db = await this.openDatabase();
    const entry = await this.readRecord<VaultEntry>(db, this.entryStoreName, label);
    if (!entry) return null;

    const value = await this.decryptValue<T>(entry.ciphertext, entry.iv);
    this.touch();
    return value;
  }

  async delete(label: string): Promise<void> {
    this.ensureUnlocked();

    const db = await this.openDatabase();
    await this.deleteRecord(db, this.entryStoreName, label);
    this.touch();
  }

  private ensureUnlocked() {
    if (!this.unlocked || !this.cryptoKey) {
      throw new Error('KeyVault is locked');
    }
  }

  private async openDatabase(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.entryStoreName)) {
          db.createObjectStore(this.entryStoreName, { keyPath: 'label' });
        }
        if (!db.objectStoreNames.contains(this.metadataStoreName)) {
          db.createObjectStore(this.metadataStoreName, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open vault database'));
    });

    return this.dbPromise;
  }

  private async loadOrCreateMetadata(db: IDBDatabase, passphrase: string): Promise<VaultMetadata> {
    const existing = await this.readRecord<VaultMetadata>(db, this.metadataStoreName, 'vault-meta');
    if (existing) {
      return {
        ...existing,
        salt: cloneBytes(existing.salt),
        verifierIv: cloneBytes(existing.verifierIv),
        verifierCiphertext: cloneBytes(existing.verifierCiphertext),
      };
    }

    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const cryptoKey = await this.deriveKey(passphrase, salt, this.iterations);
    const verifier = await this.encryptKnownPlaintext(cryptoKey);
    const now = Date.now();
    const metadata: VaultMetadata = {
      id: 'vault-meta',
      salt,
      iterations: this.iterations,
      verifierIv: verifier.iv,
      verifierCiphertext: verifier.ciphertext,
      createdAt: now,
      updatedAt: now,
    };

    await this.writeRecord(db, this.metadataStoreName, metadata);
    return metadata;
  }

  private async verifyPassphrase(
    db: IDBDatabase,
    cryptoKey: CryptoKey,
    metadata: VaultMetadata,
  ): Promise<void> {
    const stored = await this.readRecord<VaultMetadata>(db, this.metadataStoreName, 'vault-meta');
    if (!stored) {
      throw new Error('Vault metadata is missing');
    }

    const iv = cloneBytes(stored.verifierIv ?? metadata.verifierIv);
    const ciphertext = cloneBytes(stored.verifierCiphertext ?? metadata.verifierCiphertext);
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      cryptoKey,
      ciphertext as unknown as BufferSource,
    );
    const decoded = decodeText(plaintext);

    if (decoded !== VERIFIER_PLAINTEXT) {
      throw new Error('Invalid vault passphrase');
    }
  }

  private async deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
    const baseKey = await globalThis.crypto.subtle.importKey(
      'raw',
      encodeText(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    );

    return globalThis.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as unknown as BufferSource,
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private async encryptKnownPlaintext(cryptoKey: CryptoKey) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      cryptoKey,
      encodeText(VERIFIER_PLAINTEXT),
    );

    return {
      iv,
      ciphertext: new Uint8Array(ciphertext),
    };
  }

  private async encryptValue<T>(value: T) {
    if (!this.cryptoKey) throw new Error('KeyVault is locked');

    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encodeText(JSON.stringify(value));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      this.cryptoKey,
      plaintext,
    );

    return {
      iv,
      ciphertext: new Uint8Array(ciphertext),
    };
  }

  private async decryptValue<T>(ciphertext: Uint8Array, iv: Uint8Array): Promise<T> {
    if (!this.cryptoKey) throw new Error('KeyVault is locked');

    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      this.cryptoKey,
      ciphertext as unknown as BufferSource,
    );

    return JSON.parse(decodeText(plaintext)) as T;
  }

  private async readRecord<T>(
    db: IDBDatabase,
    storeName: string,
    key: IDBValidKey,
  ): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Failed to read vault record'));
    });
  }

  private async writeRecord<T extends { label?: string; id?: string }>(
    db: IDBDatabase,
    storeName: string,
    record: T,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to write vault record'));
      tx.objectStore(storeName).put(record as never);
    });
  }

  private async deleteRecord(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete vault record'));
      tx.objectStore(storeName).delete(key);
    });
  }

  private startAutoLock() {
    if (this.unlocked) this.idleLock.start();
  }

  private touch() {
    if (this.unlocked) {
      this.idleLock.touch();
    }
  }

  async exportRecoveryKit(
    label: string,
    passphrase: string,
    metaAddress: string,
    chain = 'stellar',
    labels?: Record<string, any>,
  ) {
    const keys = await this.get<any>(label);
    if (!keys) {
      throw new Error(`No keys found in vault for label "${label}"`);
    }

    const { exportRecoveryKit: exportKit, bytesToHex: bToHex } =
      await import('@/lib/stellar/recoveryKit');

    const viewingScalarHex = keys.viewingKey
      ? typeof keys.viewingKey === 'string'
        ? keys.viewingKey
        : bToHex(keys.viewingKey)
      : '';
    const viewingPubKeyHex = keys.viewingPubKey ? bToHex(keys.viewingPubKey) : undefined;
    const spendingPubKeyHex = keys.spendingPubKey ? bToHex(keys.spendingPubKey) : undefined;
    const spendingScalarHex = keys.spendingScalar
      ? typeof keys.spendingScalar === 'bigint'
        ? keys.spendingScalar.toString(16).padStart(64, '0')
        : String(keys.spendingScalar)
      : undefined;

    return exportKit({
      passphrase,
      chain,
      metaAddress,
      viewingScalarHex,
      viewingPubKeyHex,
      spendingPubKeyHex,
      spendingScalarHex,
      labels,
    });
  }
}
