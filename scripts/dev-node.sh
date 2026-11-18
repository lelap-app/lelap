#!/usr/bin/env bash
# Runs a command with the Node version in .nvmrc, for the dev servers in .claude/launch.json (M110).
# Uses the Node on PATH when it is the right one, else nvm or fnm if one is installed.
#   scripts/dev-node.sh 'pnpm dev:site'
set -euo pipefail

want="$(tr -d 'v \n' < "$(dirname "$0")/../.nvmrc")"
major() { node -p 'process.versions.node.split(".")[0]' 2> /dev/null || true; }

if [ "$(major)" != "${want%%.*}" ]; then
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # nvm's script fails under `set -u`.
    set +u
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm use "$want" > /dev/null || true
    set -u
  elif command -v fnm > /dev/null; then
    eval "$(fnm env)"
    fnm use "$want" > /dev/null || true
  fi
fi
if [ "$(major)" != "${want%%.*}" ]; then
  echo "Node $want is needed (.nvmrc); found $(node -v 2> /dev/null || echo none). Install it, or put it on PATH." >&2
  exit 1
fi
exec bash -c "$1"
