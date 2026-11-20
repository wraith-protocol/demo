export type PrivacyPosture = 'strict' | 'relaxed';

export interface RpcRoute {
  chain: string;
  label?: string;
  url: string;
  defaultUrl: string;
}

function normalizeRpcUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`;
  } catch {
    return url.replace(/\/$/, '');
  }
}

export function getRpcHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function getPrivacyPosture(
  telemetryEnabled: boolean,
  routes: readonly RpcRoute[],
  activeChain?: string,
): PrivacyPosture {
  const relevantRoutes = activeChain
    ? routes.filter((route) => route.chain === activeChain)
    : routes;
  const allRoutesAreNonDefault =
    relevantRoutes.length > 0 &&
    relevantRoutes.every(
      (route) => normalizeRpcUrl(route.url) !== normalizeRpcUrl(route.defaultUrl),
    );

  return !telemetryEnabled && allRoutesAreNonDefault ? 'strict' : 'relaxed';
}
