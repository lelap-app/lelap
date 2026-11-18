import { randomBytes } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

function kept(file: string): string {
  const value = readFileSync(file, 'utf8').trim();
  // Empty would quietly switch features off; better to stop and say so.
  if (!value) throw new Error(`${file} is empty. Delete it to make a new one, or set it yourself.`);
  return value;
}

/**
 * A secret setting: the environment's value when it has one, else the one kept in `dir`
 * (`SECRETS_DIR`), made there from 32 random bytes the first time. Undefined without either.
 */
export function secret(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  dir: string | undefined = env.SECRETS_DIR,
): string | undefined {
  const given = env[name]?.trim();
  if (given) return given;
  if (!dir) return undefined;
  const file = join(dir, name.toLowerCase());
  try {
    return kept(file);
  } catch (error) {
    if (!missing(error)) throw error;
  }
  mkdirSync(dir, { recursive: true });
  // Written whole under another name, then linked: several services start at once, and a link
  // fails when the name exists, so they all end up with the first one's value.
  const draft = `${file}.${process.pid}.${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(draft, `${randomBytes(32).toString('base64url')}\n`, { mode: 0o600 });
    linkSync(draft, file);
    // Not the value: logs travel further than the volume.
    console.log(`Made ${name} in ${file}. Keep this volume: a new value breaks what used the old.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    rmSync(draft, { force: true });
  }
  return kept(file);
}
