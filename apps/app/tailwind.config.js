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
      colors: Object.fromEntries(
        TOKENS.map((name) => [name, `rgb(var(--color-${name}) / <alpha-value>)`]),
      ),
    },
  },
};
