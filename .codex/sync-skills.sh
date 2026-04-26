#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/skills"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
TARGET_DIR="$CODEX_HOME_DIR/skills"

mkdir -p "$TARGET_DIR"

synced=0

for skill_dir in "$SOURCE_DIR"/*; do
  [[ -d "$skill_dir" ]] || continue

  skill_name="$(basename "$skill_dir")"
  target_path="$TARGET_DIR/$skill_name"

  if [[ -e "$target_path" && ! -L "$target_path" ]]; then
    echo "skip $skill_name: $target_path exists and is not a symlink" >&2
    continue
  fi

  ln -sfn "$skill_dir" "$target_path"
  echo "synced $skill_name -> $target_path"
  synced=$((synced + 1))
done

echo "synced $synced skill(s) into $TARGET_DIR"
echo "restart Codex to pick up newly installed skills in interactive sessions"
