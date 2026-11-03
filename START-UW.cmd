@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13+ or 24 LTS first.
  pause
  exit /b 1
)
if exist PACKAGE-MANIFEST.json (
  node scripts/verify-package.mjs
  if errorlevel 1 exit /b 1
)
node scripts/verify.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4190/ . Stop with Ctrl+C.
node server.mjs
pause
