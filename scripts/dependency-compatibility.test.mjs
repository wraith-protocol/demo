// Compatibility coverage for the transitive dependency overrides in
// package.json. The global `ws`, `image-size` and `toml` overrides were
// replaced with path-scoped overrides because they forced consumers onto a
// version outside the major range they declare:
//
//   - `@stellar/stellar-sdk` declares `toml: ^3` but needs a patched major 4.
//   - `metro` declares `image-size: ^1` but needs a patched major 2.
//
// These tests exercise the exact code path each consumer relies on with the
// version pnpm actually installs, so a future override cannot silently break
// them again.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hostRequire = createRequire(import.meta.url);

/** A require() bound to a package's own location, so we see its resolution. */
function requireFrom(packageName) {
  return createRequire(hostRequire.resolve(packageName));
}

/** Read the installed version of `name` as resolved from `requireFn`. */
function installedVersion(requireFn, name) {
  let dir = dirname(requireFn.resolve(name));
  // Walk up to the package root. Some packages block `./package.json` via
  // their "exports" map, so resolving package.json directly is not reliable.
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg.name === name) return pkg.version;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Unable to determine the installed version of ${name}`);
}

function versionAtLeast(version, minimum) {
  const actual = version.split('.').map(Number);
  const expected = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const a = actual[i] ?? 0;
    const b = expected[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/** react-native -> metro tooling, reached through the Solana wallet adapter. */
function resolveReactNativeTooling() {
  const adapter = requireFrom('@solana/wallet-adapter-react');
  const mobile = createRequire(adapter.resolve('@solana-mobile/wallet-adapter-mobile'));
  const reactNative = createRequire(mobile.resolve('react-native'));
  return {
    reactNative,
    metro: createRequire(reactNative.resolve('metro')),
  };
}

function pngWithSize(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 6; // colour type: RGBA
  return Buffer.concat([signature, ihdr]);
}

describe('ws override compatibility', () => {
  it('keeps the ws 7 consumers on a patched ws 7 release they can construct', () => {
    const web3 = requireFrom('@solana/web3.js');
    const jayson = createRequire(web3.resolve('jayson'));
    const { reactNative, metro } = resolveReactNativeTooling();

    // jayson's WebSocket client does `new (require('ws'))(...)`; metro and
    // react-native call `require('ws').Server`. Both rely on the ws 7 CJS
    // shape, which ws 8 changed.
    const consumers = [
      ['jayson', jayson],
      ['metro', metro],
      ['react-native', reactNative],
    ];

    for (const [label, requireFn] of consumers) {
      const version = installedVersion(requireFn, 'ws');
      expect(version, `${label} resolved ws ${version}`).toMatch(/^7\./);
      expect(versionAtLeast(version, '7.5.11'), `${label} resolved ws ${version}`).toBe(true);
      expect(typeof requireFn('ws'), `${label} require('ws') shape`).toBe('function');
    }
  });
});

describe('image-size override compatibility', () => {
  it('keeps metro on a patched image-size that reports asset dimensions', () => {
    const { metro } = resolveReactNativeTooling();
    const version = installedVersion(metro, 'image-size');
    expect(version).toMatch(/^2\./);
    expect(versionAtLeast(version, '2.0.3')).toBe(true);

    const imageSizeModule = metro('image-size');
    const imageSize = imageSizeModule.default ?? imageSizeModule;
    expect(typeof imageSize).toBe('function');

    // metro calls `imageSize(content)` to size React Native assets.
    expect(imageSize(pngWithSize(7, 5))).toMatchObject({
      width: 7,
      height: 5,
      type: 'png',
    });
  });
});

describe('toml override compatibility', () => {
  it('keeps stellar-sdk on a patched toml that preserves its parse contract', () => {
    const sdk = requireFrom('@stellar/stellar-sdk');
    const version = installedVersion(sdk, 'toml');
    expect(version).toMatch(/^5\./);
    expect(versionAtLeast(version, '5.0.1')).toBe(true);

    const toml = sdk('toml');
    // StellarToml.Resolver runs `toml.parse(response.data)` and returns the
    // parsed object, so a valid stellar.toml must round-trip.
    const parsed = toml.parse(
      'NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"\n' +
        '[[CURRENCIES]]\ncode="USDC"\n',
    );
    expect(parsed.NETWORK_PASSPHRASE).toContain('Stellar');
    expect(parsed.CURRENCIES[0].code).toBe('USDC');

    // Malformed documents must still throw so the Resolver can reject them.
    expect(() => toml.parse('not = valid = toml')).toThrow();
  });
});
