import { defineConfig } from 'vitest/config';

// The remote code against real WebDAV and S3 servers (M94): `pnpm test:integration` after
// `scripts/test-servers.sh up`. Kept out of `pnpm test`, which needs no servers; CI runs it in its
// own job when the remote code changes.
export default defineConfig({
  test: { include: ['integration/**/*.test.ts'], testTimeout: 30_000, fileParallelism: false },
});
