import type { TestRunnerConfig } from '@storybook/test-runner';
import { toMatchImageSnapshot } from 'jest-image-snapshot';

/**
 * Visual-regression config for `@storybook/test-runner`. Every story is rendered
 * in headless Chromium, its play function is run, and a full-page screenshot is
 * diffed against the committed baseline in `__image_snapshots__/`.
 *
 * Baselines are platform-sensitive (font anti-aliasing differs across OSes), so
 * generate/update them in the CI-matching Playwright Docker image. See
 * CONTRIBUTING.md.
 */
const config: TestRunnerConfig = {
  setup() {
    expect.extend({ toMatchImageSnapshot });
  },
  async preVisit(page) {
    // Headless Chromium denies clipboard writes, which would throw inside copy
    // stories. Grant the permission and stub the (writable) prototype method so
    // the UI state transition is what gets tested.
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'])
      .catch(() => {});
    await page.addInitScript(() => {
      if (typeof Clipboard !== 'undefined' && Clipboard.prototype) {
        Clipboard.prototype.writeText = () => Promise.resolve();
        Clipboard.prototype.readText = () => Promise.resolve('');
      }
    });
  },
  async postVisit(page, context) {
    // Wait for web fonts to settle so snapshots are deterministic.
    await page.evaluate(() => document.fonts.ready);

    const image = await page.screenshot({ fullPage: true });
    expect(image).toMatchImageSnapshot({
      customSnapshotsDir: `${process.cwd()}/__image_snapshots__`,
      customSnapshotIdentifier: context.id,
      failureThreshold: 0.02,
      failureThresholdType: 'percent',
    });
  },
};

export default config;
