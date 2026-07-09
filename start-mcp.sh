#!/bin/bash

# MCP Server startup script
# This fixes the ENOENT error when MCP host apps don't inherit PATH

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRY_SCRIPT="$SCRIPT_DIR/src/server.ts"

# GUI apps (e.g. Claude Desktop) launch this script with a minimal PATH that
# doesn't include version managers like mise. tsx's `#!/usr/bin/env node`
# shebang then fails to find node. Prepend common tool locations so `node`
# (and mise's shims) resolve regardless of how we're launched.
export PATH="${MISE_DATA_DIR:-$HOME/.local/share/mise}/shims:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

TSX_BIN="$SCRIPT_DIR/node_modules/.bin/tsx"
[ -x "$TSX_BIN" ] || { echo "Error: tsx not found. Run 'npm install' in $SCRIPT_DIR"; exit 1; }
[ -f "$ENTRY_SCRIPT" ] || { echo "Error: server.ts not found at $ENTRY_SCRIPT"; exit 1; }

cd "$SCRIPT_DIR"
exec "$TSX_BIN" "$ENTRY_SCRIPT" "$@"