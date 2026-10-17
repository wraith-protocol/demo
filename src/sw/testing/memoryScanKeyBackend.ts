import type { ScanKeyBackend, SealedScanKey } from '../scanKeyStore';

export class MemoryScanKeyBackend implements ScanKeyBackend {
  readonly records: Map<string, SealedScanKey>;
  readonly keys: Map<string, CryptoKey>;

  constructor(state?: { records: Map<string, SealedScanKey>; keys: Map<string, CryptoKey> }) {
    this.records = new Map(state?.records);
    this.keys = new Map(state?.keys);
  }

  /** Simulates a worker restart: only persisted data survives, as fresh copies. */
  restart(): MemoryScanKeyBackend {
    const records = new Map<string, SealedScanKey>();
    for (const [id, r] of this.records) {
      records.set(id, { ...r, iv: new Uint8Array(r.iv), ciphertext: new Uint8Array(r.ciphertext) });
    }
    return new MemoryScanKeyBackend({ records, keys: this.keys });
  }

  /** Everything that would be written to disk, for leak assertions. */
  dump(): string {
    return JSON.stringify(
      [...this.records.values()].map((r) => ({
        ...r,
        iv: Array.from(r.iv),
        ciphertext: Array.from(r.ciphertext),
      })),
    );
  }

  async getRecord(id: string) {
    return this.records.get(id);
  }
  async getWrappingKey(id: string) {
    return this.keys.get(id);
  }
  async putSealed(record: SealedScanKey, key: CryptoKey) {
    this.records.set(record.publicKey, record);
    this.keys.set(record.publicKey, key);
  }
  async deleteWrappingKey(id: string) {
    this.keys.delete(id);
  }
  async clearWrappingKeys() {
    this.keys.clear();
  }
  async remove(id: string) {
    this.records.delete(id);
    this.keys.delete(id);
  }
}
