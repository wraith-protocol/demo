import { describe, expect, it, vi } from 'vitest';
import { runAsScannerLeader, scannerLockName } from './scannerLeader';

describe('Stellar scanner leadership', () => {
  it('scopes the lock to wallet and network', () => {
    expect(scannerLockName('GONE', 'testnet')).not.toBe(scannerLockName('GTWO', 'testnet'));
    expect(scannerLockName('GONE', 'testnet')).not.toBe(scannerLockName('GONE', 'mainnet'));
  });

  it('runs under an available browser lock and publishes only public progress', async () => {
    const postMessage = vi.fn();
    const close = vi.fn();
    const channel = { postMessage, close } as unknown as BroadcastChannel;
    const locks = {
      request: vi.fn(async (_name, _options, callback) => callback({ name: 'lock' })),
    } as unknown as LockManager;
    const result = await runAsScannerLeader(
      {
        walletAddress: 'GTEST',
        network: 'testnet',
        locks,
        channelFactory: () => channel,
        tabId: 'leader',
      },
      {
        scan: async (publish) => {
          publish({ cursor: 42, matches: [{ stealthAddress: 'GSTEALTH' }] });
          return 'done';
        },
      },
    );

    expect(result).toEqual({ role: 'leader', result: 'done' });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'progress', progress: { cursor: 42, matches: [{ stealthAddress: 'GSTEALTH' }] } }),
    );
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain('viewingKey');
    expect(close).toHaveBeenCalled();
  });

  it('does not scan when another tab owns the browser lock', async () => {
    const scan = vi.fn(async () => 'done');
    const locks = {
      request: vi.fn(async (_name, _options, callback) => callback(undefined)),
    } as unknown as LockManager;

    await expect(
      runAsScannerLeader(
        { walletAddress: 'GTEST', network: 'testnet', locks, channelFactory: () => ({ close: vi.fn() } as unknown as BroadcastChannel) },
        { scan },
      ),
    ).resolves.toEqual({ role: 'follower' });
    expect(scan).not.toHaveBeenCalled();
  });

  it('falls back to a local scan when coordination storage is unavailable', async () => {
    const result = await runAsScannerLeader(
      { walletAddress: 'GTEST', network: 'testnet', channelFactory: () => { throw new Error('blocked'); } },
      { scan: async () => 'local' },
    );
    expect(result).toEqual({ role: 'leader', result: 'local' });
  });

  it('releases the lease after a failed scan so a retry can lead', async () => {
    let attempt = 0;
    const request = vi.fn(async (_name, _options, callback) => callback({ name: 'lock' }));
    const options = {
      walletAddress: 'GTEST',
      network: 'testnet',
      locks: { request } as unknown as LockManager,
      channelFactory: () => ({ postMessage: vi.fn(), close: vi.fn() }) as unknown as BroadcastChannel,
    };

    await expect(
      runAsScannerLeader(options, {
        scan: async () => {
          attempt += 1;
          throw new Error('temporary RPC failure');
        },
      }),
    ).rejects.toThrow('temporary RPC failure');

    await expect(
      runAsScannerLeader(options, { scan: async () => `retry-${attempt + 1}` }),
    ).resolves.toEqual({ role: 'leader', result: 'retry-2' });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
