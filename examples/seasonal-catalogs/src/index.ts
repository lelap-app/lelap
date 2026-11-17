import { addon } from './addon';

// A Cloudflare Worker; Deno.serve(addon.fetch) or Bun's `export default` take the same function.
export default { fetch: addon.fetch };
