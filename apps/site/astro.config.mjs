import { defineConfig } from 'astro/config';

const domain = process.env.PUBLIC_LELAP_DOMAIN ?? 'lelap.app';

export default defineConfig({
  site: `https://${domain}`,
});
