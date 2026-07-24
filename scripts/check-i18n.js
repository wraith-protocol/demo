#!/usr/bin/env node
/**
 * scripts/check-i18n.js
 *
 * CI gate: verifies that every key present in the reference locale (EN)
 * exists in all other supported locales (ES, PT, FR).
 *
 * Exit code 0  → all locales are complete.
 * Exit code 1  → one or more locales have missing keys.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const I18N_DIR = join(__dirname, '..', 'src', 'i18n');

const REFERENCE_LOCALE = 'en';
const LOCALES_TO_CHECK = ['es', 'pt', 'fr'];

/**
 * Recursively collect all dot-separated key paths from a nested object.
 * @param {object} obj
 * @param {string} prefix
 * @returns {string[]}
 */
function collectKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function loadJson(locale) {
  const filePath = join(I18N_DIR, `${locale}.json`);
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`❌  Could not read ${locale}.json: ${err.message}`);
    process.exit(1);
  }
}

const referenceData = loadJson(REFERENCE_LOCALE);
const referenceKeys = new Set(collectKeys(referenceData));

let hasErrors = false;

for (const locale of LOCALES_TO_CHECK) {
  const data = loadJson(locale);
  const localeKeys = new Set(collectKeys(data));

  const missing = [...referenceKeys].filter((k) => !localeKeys.has(k));
  const extra = [...localeKeys].filter((k) => !referenceKeys.has(k));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`✅  ${locale}.json — complete (${localeKeys.size} keys)`);
  } else {
    hasErrors = true;
    if (missing.length > 0) {
      console.error(`\n❌  ${locale}.json — ${missing.length} missing key(s):`);
      for (const key of missing) {
        console.error(`    - ${key}`);
      }
    }
    if (extra.length > 0) {
      console.warn(`\n⚠️   ${locale}.json — ${extra.length} extra key(s) not in EN (will be ignored at runtime):`);
      for (const key of extra) {
        console.warn(`    + ${key}`);
      }
    }
  }
}

if (hasErrors) {
  console.error('\n❌  i18n check failed — add missing keys before merging.\n');
  process.exit(1);
} else {
  console.log('\n✅  All locales are complete.\n');
  process.exit(0);
}
