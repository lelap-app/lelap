// Cloudflare Workers entry for steps 1 and 2. Step 3 reads a folder, so it runs on Node instead.
import { addon } from './settings.mjs';

export default { fetch: addon.fetch };
