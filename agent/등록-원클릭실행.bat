@echo off
title [eBroAgent] One-Click Protocol Register

echo ========================================================
echo   e-Bro ERP - One-Click Agent Protocol Register
echo ========================================================
echo.

if not exist "C:\eBroAgent" mkdir "C:\eBroAgent"

if exist "%USERPROFILE%\Downloads\BroAgent.js" (
    copy /y "%USERPROFILE%\Downloads\BroAgent.js" "C:\eBroAgent\BroAgent.js" >nul 2>&1
)
if exist "%~dp0BroAgent.js" (
    copy /y "%~dp0BroAgent.js" "C:\eBroAgent\BroAgent.js" >nul 2>&1
)
if exist "%~dp0start-agent.bat" (
    copy /y "%~dp0start-agent.bat" "C:\eBroAgent\start-agent.bat" >nul 2>&1
)

:: Create temporary .reg file and import cleanly
set "TMP_REG=%TEMP%\ebro_agent_register.reg"
(
echo Windows Registry Editor Version 5.00
echo.
echo [HKEY_CURRENT_USER\Software\Classes\broagent]
echo @="URL:BroAgent Protocol"
echo "URL Protocol"=""
echo.
echo [HKEY_CURRENT_USER\Software\Classes\broagent\shell\open\command]
echo @="C:\\eBroAgent\\start-agent.bat"
echo.
echo [HKEY_CURRENT_USER\Software\Classes\ebro]
echo @="URL:eBro Protocol"
echo "URL Protocol"=""
echo.
echo [HKEY_CURRENT_USER\Software\Classes\ebro\shell\open\command]
echo @="C:\\eBroAgent\\start-agent.bat"
) > "%TMP_REG%"

reg.exe import "%TMP_REG%" >nul 2>&1
del /f /q "%TMP_REG%" >nul 2>&1

:: Chrome/Edge Loopback Access Policy and QuickEdit disable
reg.exe add "HKLM\SOFTWARE\Policies\Google\Chrome\LoopbackNetworkAllowedForUrls" /v "1" /t REG_SZ /d "https://giyuenlift.ebro.run" /f >nul 2>&1
reg.exe add "HKLM\SOFTWARE\Policies\Google\Chrome\LoopbackNetworkAllowedForUrls" /v "2" /t REG_SZ /d "https://*.ebro.run" /f >nul 2>&1
reg.exe add "HKLM\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" /v "1" /t REG_SZ /d "https://giyuenlift.ebro.run" /f >nul 2>&1
reg.exe add "HKLM\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" /v "2" /t REG_SZ /d "https://*.ebro.run" /f >nul 2>&1
reg.exe add "HKLM\SOFTWARE\Policies\Microsoft\Edge\LoopbackNetworkAllowedForUrls" /v "1" /t REG_SZ /d "https://giyuenlift.ebro.run" /f >nul 2>&1
reg.exe add "HKLM\SOFTWARE\Policies\Microsoft\Edge\LoopbackNetworkAllowedForUrls" /v "2" /t REG_SZ /d "https://*.ebro.run" /f >nul 2>&1
reg.exe add "HKLM\SOFTWARE\Policies\Microsoft\Edge\LocalNetworkAccessAllowedForUrls" /v "1" /t REG_SZ /d "https://giyuenlift.ebro.run" /f >nul 2>&1
reg.exe add "HKLM\SOFTWARE\Policies\Microsoft\Edge\LocalNetworkAccessAllowedForUrls" /v "2" /t REG_SZ /d "https://*.ebro.run" /f >nul 2>&1
reg.exe add "HKCU\Console" /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>&1

echo.
echo ========================================================
echo   [SUCCESS] Browser Protocol (broagent://) Registered!
echo.
echo   You can now click [Launch Agent from Browser]
echo   on the website to start the agent automatically.
echo ========================================================
echo.
pause
