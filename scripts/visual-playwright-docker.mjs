import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockfile = readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
const playwrightVersion = lockfile.match(/^\s{2}'@playwright\/test@([\d.]+)':/m)?.[1];

if (!playwrightVersion) {
  throw new Error('Could not determine the locked @playwright/test version from pnpm-lock.yaml');
}

const updateSnapshots = process.argv.includes('--update');
const specArgumentIndex = process.argv.indexOf('--spec');
const visualSpec = specArgumentIndex >= 0 ? process.argv[specArgumentIndex + 1] : undefined;

if (visualSpec && !/^e2e\/visual-[a-z0-9-]+\.spec\.ts$/.test(visualSpec)) {
  throw new Error(`Not a visual spec path: ${visualSpec}`);
}

const image = `mcr.microsoft.com/playwright:v${playwrightVersion}-jammy`;
const volume = 'wraith-demo-visual-node-modules';
const projectArgs =
  '--project=chromium-desktop --project=chromium-mobile --project=chromium-tablet';
const testCommand = visualSpec
  ? `pnpm exec playwright test ${projectArgs} ${visualSpec}${updateSnapshots ? ' --update-snapshots' : ''}`
  : updateSnapshots
    ? 'pnpm test:visual:update'
    : 'pnpm test:visual';
const command = [
  'corepack enable',
  'corepack prepare pnpm@10.28.2 --activate',
  'pnpm install --frozen-lockfile',
  'pnpm build',
  testCommand,
].join(' && ');

const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--ipc=host',
    '--mount',
    `type=bind,source=${root},target=/workspace`,
    '--mount',
    `type=volume,source=${volume},target=/workspace/node_modules`,
    '--workdir',
    '/workspace',
    '--env',
    'VITE_WRAITH_NAMES_CONTRACT_ID=CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL',
    image,
    'bash',
    '-lc',
    command,
  ],
  { stdio: 'inherit', cwd: root },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
