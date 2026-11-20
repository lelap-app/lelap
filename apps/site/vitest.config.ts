import { getViteConfig } from 'astro/config';

// Astro's Vite setup, so tests can render pages (test/llms.test.ts) the way the build does.
export default getViteConfig({
  test: { include: ['test/**/*.test.ts'] },
});
