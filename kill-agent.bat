@echo off
title [eBro ERP] Stop Agent Daemon

echo ========================================================
echo   eBro ERP - Stop Local Sidecar Agent (eBroAgent)
echo ========================================================
echo.

echo [1/2] Terminating eBroAgent.exe and KiyeunAgent.exe processes...
powershell -NoProfile -Command "Get-Process -Name eBroAgent, KiyeunAgent -ErrorAction SilentlyContinue | Stop-Process -Force"

echo [2/2] Releasing Port 5175...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5175 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo.
echo ========================================================
echo   [SUCCESS] eBroAgent daemon has been completely stopped.
echo ========================================================
echo.
pause
