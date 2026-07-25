import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockConnectedWallet } from './a11y-fixtures';

test.describe('Accessibility - /send', () => {
  test('has zero critical or serious violations (Stellar, disconnected)', async ({ page }) => {
    await page.goto('/send');
    await page
      .locator('select')
      .filter({ has: page.locator('option[value="stellar"]') })
      .selectOption('stellar');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    if (seriousOrCritical.length > 0) {
      console.log(JSON.stringify(seriousOrCritical, null, 2));
    }

    expect(seriousOrCritical).toEqual([]);
  });

  test('has zero critical or serious violations (Stellar, connected)', async ({ page }) => {
    await mockConnectedWallet(page);
    await page.goto('/send');
    await page
      .locator('select')
      .filter({ has: page.locator('option[value="stellar"]') })
      .selectOption('stellar');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    if (seriousOrCritical.length > 0) {
      console.log(JSON.stringify(seriousOrCritical, null, 2));
    }

    expect(seriousOrCritical).toEqual([]);
  });
});
