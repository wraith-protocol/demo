export const MAX_PUSH_PAYLOAD_BYTES = 4 * 1024;

const ALLOWED_FIELDS = new Set([
  'version',
  'id',
  'title',
  'body',
  'amount',
  'asset',
  'sender',
  'url',
]);

export interface ValidatedPushPayload {
  version: 1;
  id: string;
  title: string;
  body: string;
  amount?: string;
  asset?: string;
  sender?: string;
  url: string;
}

export interface NotificationPresentation {
  title: string;
  body: string;
  tag: string;
  data: {
    id: string;
    stealthAddress?: string;
    amount?: string;
    asset?: string;
    sender?: string;
    timestamp: number;
    url: string;
  };
}

export interface NotificationDeliveryDependencies {
  claim(id: string): Promise<boolean>;
  release(id: string): Promise<void>;
  show(presentation: NotificationPresentation): Promise<void>;
  broadcast?(payload: ValidatedPushPayload, timestamp: number): Promise<void>;
}

export type NotificationDeliveryResult = 'delivered' | 'duplicate' | 'rejected';

function assertString(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && value.length === 0)) {
    throw new Error(`${field} must be ${required ? 'a non-empty' : 'a'} string`);
  }
  if (value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function validateUrl(value: unknown, origin: string): string {
  if (value === undefined) return '/notifications';
  const candidate = assertString(value, 'url', 256, true)!;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    throw new Error('url must be a same-origin path');
  }

  const parsed = new URL(candidate, origin);
  if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('url must be a same-origin HTTP path');
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deriveId(payload: Omit<ValidatedPushPayload, 'id'>): string {
  return `push-v1-${stableHash(JSON.stringify(payload))}`;
}

export function parsePushPayload(rawPayload: string, origin: string): ValidatedPushPayload {
  if (new TextEncoder().encode(rawPayload).byteLength > MAX_PUSH_PAYLOAD_BYTES) {
    throw new Error('push payload exceeds the 4 KiB limit');
  }

  let value: unknown;
  try {
    value = JSON.parse(rawPayload);
  } catch {
    throw new Error('push payload must be valid JSON');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('push payload must be an object');
  }

  const record = value as Record<string, unknown>;
  const unexpected = Object.keys(record).find((key) => !ALLOWED_FIELDS.has(key));
  if (unexpected) throw new Error(`unexpected push payload field: ${unexpected}`);
  if (record.version !== 1) throw new Error('unsupported push payload version');

  const title = assertString(record.title, 'title', 100, true)!;
  const body = assertString(record.body, 'body', 500, true)!;
  const amount = assertString(record.amount, 'amount', 64);
  const asset = assertString(record.asset, 'asset', 16);
  const sender = assertString(record.sender, 'sender', 128);
  const url = validateUrl(record.url, origin);

  if (amount && !/^\d+(?:\.\d{1,7})?$/.test(amount)) throw new Error('amount is invalid');
  if (asset && !/^[A-Z0-9]{1,16}$/.test(asset)) throw new Error('asset is invalid');

  const base = { version: 1 as const, title, body, amount, asset, sender, url };
  const suppliedId = assertString(record.id, 'id', 128);
  if (suppliedId && !/^[A-Za-z0-9._:-]+$/.test(suppliedId)) {
    throw new Error('id is invalid');
  }

  return { ...base, id: suppliedId ?? deriveId(base) };
}

export function buildNotificationPresentation(
  payload: ValidatedPushPayload,
  timestamp: number,
): NotificationPresentation {
  const lines = [payload.body];
  if (payload.amount) {
    lines.push(`Amount: ${payload.amount}${payload.asset ? ` ${payload.asset}` : ''}`);
  }
  if (payload.sender) {
    const sender =
      payload.sender.length > 24
        ? `${payload.sender.slice(0, 10)}...${payload.sender.slice(-10)}`
        : payload.sender;
    lines.push(`From: ${sender}`);
  }

  return {
    title: payload.title,
    body: lines.join('\n'),
    tag: payload.id,
    data: {
      id: payload.id,
      stealthAddress: payload.sender,
      amount: payload.amount,
      asset: payload.asset,
      sender: payload.sender,
      timestamp,
      url: payload.url,
    },
  };
}

export async function deliverPushNotification(
  rawPayload: string,
  origin: string,
  dependencies: NotificationDeliveryDependencies,
  now = Date.now(),
): Promise<NotificationDeliveryResult> {
  let payload: ValidatedPushPayload;
  try {
    payload = parsePushPayload(rawPayload, origin);
  } catch {
    return 'rejected';
  }

  if (!(await dependencies.claim(payload.id))) return 'duplicate';

  try {
    await Promise.all([
      dependencies.show(buildNotificationPresentation(payload, now)),
      dependencies.broadcast?.(payload, now) ?? Promise.resolve(),
    ]);
    return 'delivered';
  } catch (error) {
    await dependencies.release(payload.id);
    throw error;
  }
}
