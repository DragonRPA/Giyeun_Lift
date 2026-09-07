@echo off  
chcp 65001 >nul  
title [eBroAgent] Local Sidecar Agent  
cd /d C:\eBroAgent  
if exist eBroAgent.js (
    node eBroAgent.js
) else if exist agent.js (
    node agent.js
) else (
    node "%~dp0eBroAgent.js"
)
pause
