import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
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
    // Babel, Metro, Tailwind and Expo config plugins load these CommonJS files.
    files: ['apps/app/*.config.js', 'apps/app/plugins/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
