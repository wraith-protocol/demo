import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
