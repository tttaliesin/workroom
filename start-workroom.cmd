@echo off
rem Starts the desktop app from this folder. Requires `pnpm install` (see README.md).
setlocal
set ELECTRON_RUN_AS_NODE=
set WORKROOM_HEADLESS=
rem Node.js 24+ for code checks, MCP and the Codex hook. Falls back to the Codex desktop runtime if present.
if not defined WORKROOM_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "WORKROOM_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo Electron is not installed. Run the setup steps in README.md first.
  pause
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
