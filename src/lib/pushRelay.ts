/**
 * pushRelay.ts
 *
 * Library for interacting with Web Push relay service for stealth payment alerts.
 *
 * Privacy-first design:
 * - Only meta-address hash is sent as identifier
 * - No personal or wallet data is transmitted
 * - User can configure their own self-hosted relay
 *
 * Relay API contract:
 * POST /subscribe
 * {
 *   subscription: PushSubscriptionJSON,
 *   metaAddressHash: string,  // SHA-256 hash of the stealth meta-address
 *   chain: 'stellar'
 * }
 *
 * POST /unsubscribe
 * {
 *   subscription: PushSubscriptionJSON,
 *   metaAddressHash: string,
 *   chain: 'stellar'
 * }
 */

const DEFAULT_RELAY_URL = 'https://relay.wraith-protocol.dev/api';

interface RelayConfig {
  relayUrl: string;
  chain: 'stellar';
}

interface SubscribeRequest {
  subscription: PushSubscriptionJSON;
  metaAddressHash: string;
  chain: 'stellar';
}

interface UnsubscribeRequest {
  subscription: PushSubscriptionJSON;
  metaAddressHash: string;
  chain: 'stellar';
}

interface RelayResponse {
  success: boolean;
  error?: string;
}

/**
 * Compute SHA-256 hash of a string (meta-address)
 */
async function computeMetaAddressHash(metaAddress: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(metaAddress);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Subscribe to push notifications via relay
 */
export async function subscribeToRelay(
  subscription: PushSubscription,
  metaAddress: string,
  config: Partial<RelayConfig> = {},
): Promise<RelayResponse> {
  const relayUrl = config.relayUrl || DEFAULT_RELAY_URL;
  const chain = config.chain || 'stellar';

  try {
    const metaAddressHash = await computeMetaAddressHash(metaAddress);

    const response = await fetch(`${relayUrl}/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        metaAddressHash,
        chain,
      } as SubscribeRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Relay returned ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();
    return data as RelayResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error subscribing to relay',
    };
  }
}

/**
 * Unsubscribe from push notifications via relay
 */
export async function unsubscribeFromRelay(
  subscription: PushSubscription,
  metaAddress: string,
  config: Partial<RelayConfig> = {},
): Promise<RelayResponse> {
  const relayUrl = config.relayUrl || DEFAULT_RELAY_URL;
  const chain = config.chain || 'stellar';

  try {
    const metaAddressHash = await computeMetaAddressHash(metaAddress);

    const response = await fetch(`${relayUrl}/unsubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        metaAddressHash,
        chain,
      } as UnsubscribeRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Relay returned ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();
    return data as RelayResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error unsubscribing from relay',
    };
  }
}

/**
 * Test relay connectivity
 */
export async function testRelayConnectivity(
  config: Partial<RelayConfig> = {},
): Promise<{ reachable: boolean; error?: string }> {
  const relayUrl = config.relayUrl || DEFAULT_RELAY_URL;

  try {
    const response = await fetch(`${relayUrl}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      return { reachable: true };
    } else {
      return {
        reachable: false,
        error: `Relay returned ${response.status}`,
      };
    }
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : 'Unknown error testing relay',
    };
  }
}

export { DEFAULT_RELAY_URL };
