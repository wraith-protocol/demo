import { defineConfig } from 'vitest/config';
import path from 'path';

const alias = {
  '@': path.resolve(__dirname, 'src'),
};

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          globals: true,
          include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
          exclude: [
            'src/hooks/useStellarScanner.test.ts',
            'src/hooks/useStellarWithdrawal.test.ts',
          ],
          alias,
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          globals: true,
          include: [
            'src/hooks/useStellarScanner.test.ts',
            'src/hooks/useStellarWithdrawal.test.ts',
          ],
          alias,
        },
      },
    ],
  },
});
