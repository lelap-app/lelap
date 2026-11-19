// The add-on test kit against the samples without the SDK: plain Node and Python, over real HTTP.
// The samples that use the SDK run it in their own tests.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkAddon } from './check';

type Server = {
  listen: (port: number, host: string, done: () => void) => void;
  address: () => { port: number };
  close: () => void;
};
type ChildProcess = {
  stdout: { on: (event: 'data', listener: (chunk: unknown) => void) => void };
  on: (event: 'exit', listener: () => void) => void;
  kill: () => void;
};
type Spawn = (command: string, args: string[], options: { cwd: string }) => ChildProcess;

const examples = new URL('../../../examples/', import.meta.url);
// Specifiers in variables: the SDK's own types know nothing of Node or the samples.
const load = <T>(specifier: string): Promise<T> => import(/* @vite-ignore */ specifier);

describe('the plain Node sample', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const { createAddonServer } = await load<{ createAddonServer: () => Server }>(
      new URL('node-addon/addon.mjs', examples).href,
    );
    server = createAddonServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}/`;
  });
  afterAll(() => server.close());

  it('passes', async () => {
    const report = await checkAddon(base);
    expect(report.problems).toEqual([]);
    expect(report.requests).toBeGreaterThan(5);
  });
});

describe('the Python sample', () => {
  let child: ChildProcess | null = null;
  let base = '';

  beforeAll(async () => {
    const { spawn } = await load<{ spawn: Spawn }>('node:child_process');
    const script =
      'from addon import create_server\n' +
      "s = create_server(port=0, host='127.0.0.1')\n" +
      'print(s.server_address[1], flush=True)\n' +
      's.serve_forever()';
    const started = spawn('python3', ['-c', script], {
      cwd: new URL('python-addon/', examples).pathname,
    });
    base = await new Promise<string>((resolve) => {
      started.on('exit', () => resolve(''));
      started.stdout.on('data', (chunk) => resolve(`http://127.0.0.1:${String(chunk).trim()}/`));
    });
    child = started;
  });
  afterAll(() => child?.kill());

  it('passes', async (context) => {
    // CI and `pnpm test` run the sample's own tests with python3 too; without it there is nothing to check.
    if (!base) return context.skip();
    const report = await checkAddon(base);
    expect(report.problems).toEqual([]);
    expect(report.requests).toBeGreaterThan(5);
  });
});
