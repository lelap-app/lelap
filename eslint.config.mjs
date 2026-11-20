import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/dist/',
    '**/dist-web/',
    '**/.astro/',
    '**/.wrangler/',
    '**/node_modules/',
    '**/.expo/',
    'apps/app/android/',
    'apps/app/ios/',
    'modules/*/android/build/',
  ]),
  js.configs.recommended,
  tseslint.configs.strict,
  astro.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // Hooks only at a component's or hook's top level (M145). exhaustive-deps stays off: screens
    // list the library's `version` to read the database again, which it calls unnecessary.
    files: ['apps/app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
  {
    // Babel, Metro, Tailwind and Expo config plugins load these CommonJS files.
    files: ['apps/app/*.config.js', 'apps/app/plugins/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
