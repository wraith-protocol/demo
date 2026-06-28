#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sendA, sendB, sendC, receiveA, receiveB, receiveC } = require('./frames.cjs');

const OUT = __dirname;
const TMP = path.join(OUT, '_tmp');
fs.mkdirSync(TMP, { recursive: true });

const frames = [
  [sendA, 'send-a-recipient-first', 'desktop', 1280, 'idle'],
  [sendA, 'send-a-recipient-first', 'desktop', 1280, 'loading'],
  [sendA, 'send-a-recipient-first', 'desktop', 1280, 'error'],
  [sendA, 'send-a-recipient-first', 'mobile', 375, 'idle'],
  [sendA, 'send-a-recipient-first', 'mobile', 375, 'loading'],
  [sendA, 'send-a-recipient-first', 'mobile', 375, 'error'],

  [sendB, 'send-b-amount-first', 'desktop', 1280, 'idle'],
  [sendB, 'send-b-amount-first', 'desktop', 1280, 'loading'],
  [sendB, 'send-b-amount-first', 'desktop', 1280, 'error'],
  [sendB, 'send-b-amount-first', 'mobile', 375, 'idle'],
  [sendB, 'send-b-amount-first', 'mobile', 375, 'loading'],
  [sendB, 'send-b-amount-first', 'mobile', 375, 'error'],

  [sendC, 'send-c-flat-form', 'desktop', 1280, 'idle'],
  [sendC, 'send-c-flat-form', 'desktop', 1280, 'loading'],
  [sendC, 'send-c-flat-form', 'desktop', 1280, 'error'],
  [sendC, 'send-c-flat-form', 'mobile', 375, 'idle'],
  [sendC, 'send-c-flat-form', 'mobile', 375, 'loading'],
  [sendC, 'send-c-flat-form', 'mobile', 375, 'error'],

  [receiveA, 'receive-a-dense-table', 'desktop', 1280, 'idle'],
  [receiveA, 'receive-a-dense-table', 'desktop', 1280, 'loading'],
  [receiveA, 'receive-a-dense-table', 'desktop', 1280, 'error'],
  [receiveA, 'receive-a-dense-table', 'desktop', 1280, 'scanned'],
  [receiveA, 'receive-a-dense-table', 'mobile', 375, 'idle'],
  [receiveA, 'receive-a-dense-table', 'mobile', 375, 'loading'],
  [receiveA, 'receive-a-dense-table', 'mobile', 375, 'error'],
  [receiveA, 'receive-a-dense-table', 'mobile', 375, 'scanned'],

  [receiveB, 'receive-b-card-stack', 'desktop', 1280, 'idle'],
  [receiveB, 'receive-b-card-stack', 'desktop', 1280, 'loading'],
  [receiveB, 'receive-b-card-stack', 'desktop', 1280, 'error'],
  [receiveB, 'receive-b-card-stack', 'desktop', 1280, 'scanned'],
  [receiveB, 'receive-b-card-stack', 'mobile', 375, 'idle'],
  [receiveB, 'receive-b-card-stack', 'mobile', 375, 'loading'],
  [receiveB, 'receive-b-card-stack', 'mobile', 375, 'error'],
  [receiveB, 'receive-b-card-stack', 'mobile', 375, 'scanned'],

  [receiveC, 'receive-c-empty-state-first', 'desktop', 1280, 'idle'],
  [receiveC, 'receive-c-empty-state-first', 'desktop', 1280, 'loading'],
  [receiveC, 'receive-c-empty-state-first', 'desktop', 1280, 'error'],
  [receiveC, 'receive-c-empty-state-first', 'desktop', 1280, 'scanned'],
  [receiveC, 'receive-c-empty-state-first', 'mobile', 375, 'idle'],
  [receiveC, 'receive-c-empty-state-first', 'mobile', 375, 'loading'],
  [receiveC, 'receive-c-empty-state-first', 'mobile', 375, 'error'],
  [receiveC, 'receive-c-empty-state-first', 'mobile', 375, 'scanned'],
];

let ok = 0,
  fail = 0;

for (const [fn, dir, vp, width, state] of frames) {
  const name = `${dir}--${vp}--${state}`;
  const htmlPath = path.join(TMP, `${name}.html`);
  const pngPath = path.join(OUT, `${name}.png`);

  fs.writeFileSync(htmlPath, fn(width, state));

  try {
    execSync(
      `google-chrome --headless=new --disable-gpu --no-sandbox ` +
        `--screenshot="${pngPath}" ` +
        `--window-size=${width},900 ` +
        `--hide-scrollbars ` +
        `"file://${htmlPath}"`,
      { stdio: 'pipe' },
    );
    console.log(`✓ ${name}.png`);
    ok++;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message.split('\n')[0]}`);
    fail++;
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${ok} exported, ${fail} failed.`);
