import { createAddonServer } from './addon.mjs';

const port = Number(process.env.PORT ?? 8787);
createAddonServer().listen(port, () => {
  console.log(`Add-on running: http://localhost:${port}/manifest.json`);
});
