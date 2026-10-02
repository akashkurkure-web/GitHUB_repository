#!/usr/bin/env bash
# Sets up Claude Code with VS Code on macOS / Linux / WSL.
# Run:  bash scripts/setup-claude-vscode.sh
set -euo pipefail

step() { printf '\n==> %s\n' "$1"; }

step "Checking VS Code 'code' command"
if ! command -v code >/dev/null 2>&1; then
  echo "'code' not found. In VS Code press Cmd/Ctrl+Shift+P and run"
  echo "'Shell Command: Install code command in PATH', then re-run this script."
  exit 1
fi

step "Installing Claude Code CLI"
if command -v claude >/dev/null 2>&1; then
  echo "Already installed: $(claude --version)"
else
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
fi

step "Installing Claude Code VS Code extension"
code --install-extension anthropic.claude-code --force

step "Verifying"
claude --version
code --list-extensions | grep -i anthropic.claude-code

cat <<'MSG'

Done. Next:
  1. Restart VS Code and open this folder.
  2. Click the Claude icon in the sidebar and sign in (or run 'claude' in the VS Code terminal).
  3. From an external terminal, run '/ide' inside claude to link it to VS Code.
MSG
