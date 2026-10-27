#!/bin/bash
# Install the GrokBot pet package into the local Codex pet directory.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../pet-grokbot"
DEST="${CODEX_HOME:-$HOME/.codex}/pets/grokbot"
mkdir -p "$DEST"
cp "$SRC/pet.json" "$SRC/spritesheet.webp" "$DEST/"
echo "Installed: $DEST"
echo "Open Codex's pet picker (the list where boba / anon live) and choose GrokBot."
echo "If it is not listed yet, restart the Codex app once."
