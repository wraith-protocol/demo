import { useState, useEffect, useCallback } from 'react';
import { STELLAR_NETWORK } from '@/config';

export interface ReflectorPrice {
  asset: 'XLM' | 'USDC';
  price: number;
  timestamp: number;
}

export interface ReflectorCache {
  prices: Record<string, ReflectorPrice>;
  lastFetch: number;
}

class ReflectorOracle {
  private cache: ReflectorCache = { prices: {}, lastFetch: 0 };
  private readonly CACHE_DURATION = 60_000; // 60 seconds
  private static readonly REFLECTOR_RPC = STELLAR_NETWORK.rpcUrl;

  private getCacheKey(asset: string): string {
    return `reflector-${asset}`;
  }

  private isCacheValid(): boolean {
    return Date.now() - this.cache.lastFetch < this.cacheDuration;
  }

  private updateCache(prices: Record<string, ReflectorPrice>): void {
    this.cache = {
      prices,
      lastFetch: Date.now(),
    };
  }

  async fetchPrices(): Promise<Record<string, ReflectorPrice>> {
    if (this.isCacheValid() && Object.keys(this.cache.prices).length > 0) {
      return this.cache.prices;
    }

    try {
      const response = await fetch(`${ReflectorOracle.REFLECTOR_RPC}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getContractData',
          params: {
            contractId: 'CDLGWSMS3QYXK2W6BJ2MMXK6CJ7KJZ6K2QTQ4C6BP4PXBXLR5OMMESQTS',
            key: 'price-feed-xlm',
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Reflector RPC error: ${response.status}`);
      }

      const data = await response.json();

      if ('result' in data) {
        const xlmPrice = data.result?.decoded?.price ?? 0.42;

        const results = {
          XLM: {
            asset: 'XLM' as const,
            price: xlmPrice,
            timestamp: Date.now(),
          },
          USDC: {
            asset: 'USDC' as const,
            price: 1.0,
            timestamp: Date.now(),
          },
        };

        this.updateCache(results);
        return results;
      }

      return this.getFallbackPrices();
    } catch (error) {
      console.error('Failed to fetch prices from Reflector:', error);
      return this.getFallbackPrices();
    }
  }

  private getFallbackPrices(): Record<string, ReflectorPrice> {
    return {
      XLM: {
        asset: 'XLM' as const,
        price: 0.42,
        timestamp: Date.now(),,
      },
      USDC: {
        asset: 'USDC' as const,
        price: 1.0,
        timestamp: Date.now(),
      },
    };
  }

  clearCache(): void {
    this.cache = { prices: {}, lastFetch: 0 };
  }
}

export const reflectorOracle = new ReflectorOracle();