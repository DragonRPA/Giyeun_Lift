@echo off  
chcp 65001 >nul  
title [eBroAgent] Local Sidecar Agent  
cd /d C:\eBroAgent  
if exist BroAgent.js (
    node BroAgent.js
) else if exist eBroAgent.js (
    node eBroAgent.js
) else if exist agent.js (
    node agent.js
) else if exist "%~dp0BroAgent.js" (
    node "%~dp0BroAgent.js"
) else (
    node "%~dp0eBroAgent.js"
)
pause
