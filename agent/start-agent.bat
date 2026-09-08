@echo off
title [eBroAgent] Local Sidecar Agent

:: Disable QuickEdit mode to prevent accidental mouse click pause
reg.exe add "HKCU\Console" /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>&1

if not exist "C:\eBroAgent" mkdir "C:\eBroAgent"
cd /d "C:\eBroAgent"

if exist "%USERPROFILE%\Downloads\BroAgent.js" (
    copy /y "%USERPROFILE%\Downloads\BroAgent.js" "C:\eBroAgent\BroAgent.js" >nul 2>&1
)
if exist "%~dp0BroAgent.js" (
    copy /y "%~dp0BroAgent.js" "C:\eBroAgent\BroAgent.js" >nul 2>&1
)

if exist BroAgent.js (
    node BroAgent.js
) else if exist eBroAgent.js (
    node eBroAgent.js
) else if exist agent.js (
    node agent.js
) else (
    echo [ERROR] BroAgent.js not found in C:\eBroAgent!
    echo Please download BroAgent.js from the website first.
    pause
)
