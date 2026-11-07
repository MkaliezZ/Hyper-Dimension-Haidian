@echo off
cd /d "%~dp0"
if not exist "base\node_modules\javascript-astar\package.json" call npm --prefix base ci --ignore-scripts --no-audit --no-fund
if errorlevel 1 exit /b 1
node server.mjs
pause
