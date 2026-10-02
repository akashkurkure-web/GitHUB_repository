# Sets up Claude Code with VS Code on Windows.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\setup-claude-vscode.ps1
$ErrorActionPreference = "Stop"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

Step "Checking VS Code 'code' command"
if (-not (Get-Command code -ErrorAction SilentlyContinue)) {
    Write-Host "'code' not found. In VS Code press Ctrl+Shift+P and run" -ForegroundColor Yellow
    Write-Host "'Shell Command: Install code command in PATH' (or reinstall VS Code with 'Add to PATH' ticked), then re-run this script." -ForegroundColor Yellow
    exit 1
}

Step "Installing Claude Code CLI"
if (Get-Command claude -ErrorAction SilentlyContinue) {
    Write-Host "Already installed: $(claude --version)"
} else {
    irm https://claude.ai/install.ps1 | iex
    $env:Path += ";$env:USERPROFILE\.local\bin"
}

Step "Installing Claude Code VS Code extension"
code --install-extension anthropic.claude-code --force

Step "Verifying"
claude --version
code --list-extensions | Select-String "anthropic.claude-code"

Write-Host "`nDone. Next:" -ForegroundColor Green
Write-Host "  1. Restart VS Code and open this folder."
Write-Host "  2. Click the Claude icon in the sidebar and sign in (or run 'claude' in the VS Code terminal)."
Write-Host "  3. From an external terminal, run '/ide' inside claude to link it to VS Code."
