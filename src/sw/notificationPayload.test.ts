import { describe, expect, it, vi } from 'vitest';
import {
  MAX_PUSH_PAYLOAD_BYTES,
  deliverPushNotification,
  parsePushPayload,
  type NotificationDeliveryDependencies,
} from './notificationPayload';

const origin = 'https://demo.wraith.example';
const validPayload = {
  version: 1,
  id: 'tx:abc123',
  title: 'Payment received',
  body: 'A stealth payment is ready.',
  amount: '12.5',
  asset: 'XLM',
  sender: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ2',
  url: '/notifications?match=abc123',
};

function createDependencies(ids = new Set<string>()) {
  const show = vi.fn(async () => undefined);
  const broadcast = vi.fn(async () => undefined);
  const dependencies: NotificationDeliveryDependencies = {
    claim: async (id) => {
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    },
    release: async (id) => {
      ids.delete(id);
    },
    show,
    broadcast,
  };
  return { dependencies, show, broadcast };
}

describe('push notification payloads', () => {
  it('validates and delivers a versioned payload', async () => {
    const { dependencies, show, broadcast } = createDependencies();

    await expect(
      deliverPushNotification(JSON.stringify(validPayload), origin, dependencies, 1234),
    ).resolves.toBe('delivered');
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: validPayload.title,
        tag: validPayload.id,
        data: expect.objectContaining({ url: validPayload.url, timestamp: 1234 }),
      }),
    );
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it('rejects a duplicate after a worker restart', async () => {
    const persistedIds = new Set<string>();
    const firstWorker = createDependencies(persistedIds);
    const restartedWorker = createDependencies(persistedIds);
    const raw = JSON.stringify(validPayload);

    await expect(deliverPushNotification(raw, origin, firstWorker.dependencies)).resolves.toBe(
      'delivered',
    );
    await expect(deliverPushNotification(raw, origin, restartedWorker.dependencies)).resolves.toBe(
      'duplicate',
    );
    expect(restartedWorker.show).not.toHaveBeenCalled();
  });

  it('derives a stable identity when id is omitted', () => {
    const { id: _id, ...withoutId } = validPayload;
    const raw = JSON.stringify(withoutId);
    expect(parsePushPayload(raw, origin).id).toBe(parsePushPayload(raw, origin).id);
  });

  it.each([
    ['invalid JSON', '{'],
    ['unsupported schema', JSON.stringify({ ...validPayload, version: 2 })],
    ['unexpected fields', JSON.stringify({ ...validPayload, data: { admin: true } })],
    ['unsafe URL', JSON.stringify({ ...validPayload, url: 'https://evil.example/pay' })],
  ])('rejects %s', async (_case, raw) => {
    const { dependencies, show } = createDependencies();
    await expect(deliverPushNotification(raw, origin, dependencies)).resolves.toBe('rejected');
    expect(show).not.toHaveBeenCalled();
  });

  it('rejects payloads over the byte limit', async () => {
    const raw = JSON.stringify({ ...validPayload, body: 'x'.repeat(MAX_PUSH_PAYLOAD_BYTES) });
    const { dependencies, show } = createDependencies();
    await expect(deliverPushNotification(raw, origin, dependencies)).resolves.toBe('rejected');
    expect(show).not.toHaveBeenCalled();
  });

  it('releases the identity when delivery fails', async () => {
    const ids = new Set<string>();
    const { dependencies } = createDependencies(ids);
    dependencies.show = vi.fn(async () => {
      throw new Error('notification unavailable');
    });

    await expect(
      deliverPushNotification(JSON.stringify(validPayload), origin, dependencies),
    ).rejects.toThrow('notification unavailable');
    expect(ids.has(validPayload.id)).toBe(false);
  });
});
