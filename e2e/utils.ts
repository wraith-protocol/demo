export function maskAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function maskHash(hash: string): string {
  if (!hash || hash.length < 16) return hash;
  return `${hash.slice(0, 12)}...${hash.slice(-4)}`;
}

export function maskPrivateKey(key: string): string {
  if (!key || key.length < 16) return '***MASKED***';
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

export function getViewportName(width: number): string {
  if (width < 640) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}
