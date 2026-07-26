export interface StellarQrPayload {
  metaAddress: string;
  amount?: string;
  memo?: string;
}

const META_ADDRESS_PREFIX = 'st:xlm:';
const SUPPORTED_PROTOCOLS = new Set(['stellar:', 'web+stellar:', 'http:', 'https:']);
const CAMERA_UNAVAILABLE_ERRORS = new Set([
  'AbortError',
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'OverconstrainedError',
  'SecurityError',
]);

function assertMetaAddress(value: string | null): string {
  const metaAddress = value?.trim() ?? '';
  if (!metaAddress.startsWith(META_ADDRESS_PREFIX)) {
    throw new Error('QR code does not contain a Stellar stealth meta-address');
  }
  return metaAddress;
}

export function createStellarQrUri(metaAddress: string): string {
  const params = new URLSearchParams({ to: assertMetaAddress(metaAddress) });
  return `stellar:pay?${params.toString()}`;
}

export function parseStellarQrPayload(value: string): StellarQrPayload {
  const payload = value.trim();
  if (payload.startsWith(META_ADDRESS_PREFIX)) {
    return { metaAddress: payload };
  }

  let url: URL;
  try {
    url = new URL(payload);
  } catch {
    throw new Error('QR code is not a supported Stellar payment payload');
  }

  if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
    throw new Error('QR code uses an unsupported protocol');
  }

  if (
    (url.protocol === 'stellar:' || url.protocol === 'web+stellar:') &&
    url.pathname.replace(/^\/+/, '') !== 'pay'
  ) {
    throw new Error('QR code is not a Stellar payment URI');
  }

  const metaAddress = assertMetaAddress(
    url.searchParams.get('to') ??
      url.searchParams.get('recipient') ??
      url.searchParams.get('destination'),
  );
  const amount = url.searchParams.get('amount')?.trim();
  const memo = url.searchParams.get('memo')?.trim();

  return {
    metaAddress,
    ...(amount ? { amount } : {}),
    ...(memo ? { memo } : {}),
  };
}

export function isCameraUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  return CAMERA_UNAVAILABLE_ERRORS.has(name) || message.includes('MediaDevices API has no support');
}

export async function decodeQrImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image containing a QR code');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const { BrowserQRCodeReader } = await import('@zxing/browser');
    const result = await new BrowserQRCodeReader().decodeFromImageUrl(objectUrl);
    return result.getText();
  } catch {
    throw new Error('No readable QR code was found in that image');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
