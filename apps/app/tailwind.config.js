// The colours by role; their values are the theme's (packages/core/src/themes.ts, M108), set as
// CSS variables by src/theme.tsx. The night theme's are the defaults in global.css.
const TOKENS = [
  'night',
  'raised',
  'paper',
  'soft',
  'muted',
  'line',
  'amber',
  'ink',
  'danger',
  'ok',
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // Themes come from variables, not from dark: classes; 'class' also stops NativeWind's web build
  // from fighting the media query.
  darkMode: 'class',
  theme: {
    extend: {
      // The type scale (M149): every text size in the app is one of these;
      // scripts/check-type-scale.mjs fails on any other.
      fontSize: {
        title: ['30px', { lineHeight: '36px' }],
        heading: ['22px', { lineHeight: '28px' }],
        section: ['18px', { lineHeight: '28px' }],
        body: ['16px', { lineHeight: '24px' }],
        detail: ['14px', { lineHeight: '20px' }],
        caption: ['12px', { lineHeight: '16px' }],
      },
      colors: Object.fromEntries(
        TOKENS.map((name) => [name, `rgb(var(--color-${name}) / <alpha-value>)`]),
      ),
    },
  },
};
