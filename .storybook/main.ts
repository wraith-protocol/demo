import type { StorybookConfig } from '@storybook/react-vite';

function isPwaPlugin(plugin: unknown): boolean {
  return (
    typeof plugin === 'object' &&
    plugin !== null &&
    'name' in plugin &&
    typeof plugin.name === 'string' &&
    plugin.name.startsWith('vite-plugin-pwa')
  );
}

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-interactions', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  staticDirs: ['../public'],
  viteFinal: async (viteConfig) => {
    const plugins = (viteConfig.plugins ?? []).flat(Infinity);
    viteConfig.plugins = plugins.filter(
      (plugin) => !isPwaPlugin(plugin),
    ) as typeof viteConfig.plugins;
    return viteConfig;
  },
};

export default config;
