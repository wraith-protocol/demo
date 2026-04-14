import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0e0e0e',
          container: '#141414',
          bright: '#1a1a1a',
        },
        primary: '#c6c6c7',
        'on-surface': '#e6e1e5',
        'on-surface-variant': '#c4c7c5',
        outline: {
          DEFAULT: '#767575',
          variant: '#444444',
        },
        error: '#ee7d77',
        tertiary: '#22c55e',
      },
      fontFamily: {
        heading: ['"Space Grotesk"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        none: '0',
        DEFAULT: '0',
        sm: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        '3xl': '0',
        full: '0',
      },
    },
  },
  plugins: [],
};

export default config;
