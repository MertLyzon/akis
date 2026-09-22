#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
  .venv/bin/python -m pip install -r backend/requirements.txt
fi
if [ ! -f node_modules/vite/bin/vite.js ]; then npm ci; fi
exec .venv/bin/python scripts/dev.py
