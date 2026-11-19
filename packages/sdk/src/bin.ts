#!/usr/bin/env node
// The `lelap-sdk` command. Node only; the rest of the SDK runs anywhere with the Fetch API.
import { runCli } from './cli';

type NodeProcess = {
  argv: string[];
  stdout: { write: (text: string) => boolean };
  exitCode?: number;
};

const { process } = globalThis as unknown as { process: NodeProcess };
process.exitCode = await runCli(process.argv.slice(2), {
  write: (text) => void process.stdout.write(text),
});
