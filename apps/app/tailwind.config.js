/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // One dark theme. 'class' also stops NativeWind's web build from fighting the media query.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        night: '#0d0e11',
        raised: '#17191e',
        paper: '#f4f1ea',
        soft: '#c9c5bc',
        muted: '#8d8a83',
        line: '#33353b',
        amber: '#f5b041',
        ink: '#1a1305',
        danger: '#ff8a7a',
      },
    },
  },
};
