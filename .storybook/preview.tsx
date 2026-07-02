import { Buffer } from 'buffer';
(window as unknown as Record<string, unknown>).Buffer = Buffer;

import type { Preview } from '@storybook/react';
import { initialize, mswLoader } from 'msw-storybook-addon';
import '../src/index.css';

// Start the mock service worker so no story can make a real network request.
initialize({ onUnhandledRequest: 'bypass' });

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'surface',
      values: [{ name: 'surface', value: '#0e0e0e' }],
    },
    controls: { expanded: true },
    a11y: { context: '#storybook-root' },
  },
  loaders: [mswLoader],
  decorators: [
    (Story) => (
      <div className="dark min-h-screen bg-surface p-6 font-body text-on-surface antialiased">
        <div className="mx-auto w-full max-w-[720px]">
          <Story />
        </div>
      </div>
    ),
  ],
};

export default preview;
