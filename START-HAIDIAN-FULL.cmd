@echo off
cd /d "%~dp0"
wsl -d Ubuntu --cd "%~dp0." -- bash scripts/run-haidian-local.sh
pause
