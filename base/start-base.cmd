@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS first. See START-HERE.md.
  pause
  exit /b 1
)
node tools/base.mjs serve %*
if errorlevel 1 pause
