/**
 * swCache.ts
 *
 * Explicit cache versioning and migration for the Wraith service worker.
 *
 * Every cache the app owns is named `wraith-<kind>-v<CACHE_VERSION>`. Because the
 * version is part of the name, a schema change is a rename rather than an
 * in-place mutation: the new worker writes to fresh caches and the activation
 * handler deletes everything else it owns.
 *
 * Rules enforced here:
 * - Any cache prefixed with `wraith-` that is not in `expectedCacheNames()` is
 *   obsolete, whichever version produced it (so both forward updates and
 *   roll-backs converge on the running version).
 * - Caches created before this convention existed (`LEGACY_CACHE_NAMES` /
 *   `LEGACY_CACHE_PREFIXES`) are treated as obsolete so existing installs
 *   migrate on their next activation.
 * - Anything the app does not own is left alone. Never delete another app's
 *   caches on the same origin.
 *
 * Bump `CACHE_VERSION` whenever the precache/runtime cache *schema* changes —
 * i.e. when the set, meaning, or shape of cached responses changes, not for
 * ordinary asset revisions (Workbox already revisions precache entries
 * individually).
 *
 * This module is imported from the service worker bundle, so it must stay free
 * of browser/DOM and React dependencies.
 */

/** Namespace for every cache the demo owns. */
export const CACHE_PREFIX = 'wraith';

/**
 * Cache schema version. Increment to invalidate every cache this app owns.
 * Keep in sync with the release notes: a bump is a cache migration.
 */
export const CACHE_VERSION = 2;

/** Suffix appended to every versioned cache name (`v1`, `v2`, …). */
export const CACHE_VERSION_SUFFIX = `v${CACHE_VERSION}`;

/** Cache kinds the app owns. `precache`/`runtime` match Workbox's own names. */
export const CACHE_KINDS = [
  'precache',
  'runtime',
  'rpc',
  'fonts-styles',
  'fonts-files',
  'assets',
  'images',
] as const;

export type CacheKind = (typeof CACHE_KINDS)[number];

/** Build the versioned name for a cache kind. */
export function cacheName(kind: CacheKind, version: number = CACHE_VERSION): string {
  return `${CACHE_PREFIX}-${kind}-v${version}`;
}

/** Every cache the running version expects to exist after activation. */
export function expectedCacheNames(version: number = CACHE_VERSION): string[] {
  return CACHE_KINDS.map((kind) => cacheName(kind, version));
}

/** Unversioned cache names written by builds that predate cache versioning. */
export const LEGACY_CACHE_NAMES: readonly string[] = [
  'rpc-cache',
  'google-fonts-cache',
  'google-fonts-webfonts',
];

/** Cache name prefixes produced by Workbox's default (unversioned) naming. */
export const LEGACY_CACHE_PREFIXES: readonly string[] = ['workbox-precache-', 'workbox-runtime-'];

/** True when the cache was created by this app (any version). */
export function isAppCache(name: string): boolean {
  return name.startsWith(`${CACHE_PREFIX}-`);
}

/** True when the cache uses a naming scheme from before explicit versioning. */
export function isLegacyCache(name: string): boolean {
  return (
    LEGACY_CACHE_NAMES.includes(name) ||
    LEGACY_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/**
 * True when the cache must be removed during activation: it belongs to this
 * app but is not part of the running version's expected set.
 */
export function isObsoleteCache(name: string, version: number = CACHE_VERSION): boolean {
  if (!isAppCache(name) && !isLegacyCache(name)) return false;
  return !expectedCacheNames(version).includes(name);
}

export interface CacheMigrationPlan {
  /** Caches to keep — current version plus anything the app does not own. */
  keep: string[];
  /** Obsolete app caches to delete during activation. */
  delete: string[];
}

/** Split the existing cache names into what to keep and what to purge. */
export function planCacheMigration(
  existing: readonly string[],
  version: number = CACHE_VERSION,
): CacheMigrationPlan {
  const keep: string[] = [];
  const remove: string[] = [];

  for (const name of existing) {
    if (isObsoleteCache(name, version)) remove.push(name);
    else keep.push(name);
  }

  return { keep, delete: remove };
}

/** Minimal slice of the Cache Storage API needed for migration. */
export interface CacheStorageLike {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/**
 * Delete every obsolete app cache. Never rejects: a cache-storage failure must
 * not abort activation, otherwise the worker can get stuck in `activating`.
 *
 * @returns the names that were successfully deleted.
 */
export async function purgeObsoleteCaches(
  storage: CacheStorageLike,
  version: number = CACHE_VERSION,
): Promise<string[]> {
  let existing: string[];
  try {
    existing = await storage.keys();
  } catch {
    return [];
  }

  const deleted: string[] = [];
  for (const name of planCacheMigration(existing, version).delete) {
    try {
      await storage.delete(name);
      deleted.push(name);
    } catch {
      // Keep activating — a single failed delete must not block the update.
    }
  }

  return deleted;
}
