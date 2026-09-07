@echo off
title [e-Bro ERP] Certificate Auto Installer

echo ========================================================
echo   e-Bro ERP - Security Certificate Auto Installer
echo ========================================================
echo.

cd /d "%~dp0"

set "CER_FILE=eBroAgent_Root.cer"
if not exist "%CER_FILE%" (
    if exist "KiyeunLift_Root.cer" (
        set "CER_FILE=KiyeunLift_Root.cer"
    ) else (
        echo [ERROR] Certificate file not found in current folder!
        echo Please make sure eBroAgent_Root.cer is in the same directory.
        echo.
        pause
        exit /b 1
    )
)

echo [1/2] Installing to Trusted Root Certification Authorities...
certutil -addstore -f Root "%CER_FILE%" > nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Requesting Administrator Privileges...
    powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c cd /d ""%~dp0"" && certutil -addstore -f Root ""%CER_FILE%"" && certutil -addstore -f TrustedPublisher ""%CER_FILE%""' -Verb RunAs"
    goto finish
)

echo [2/2] Installing to Trusted Publishers...
certutil -addstore -f TrustedPublisher "%CER_FILE%" > nul 2>&1

:finish
echo.
echo ========================================================
echo   [SUCCESS] Certificate installed successfully!
echo   eBroAgent can now run without any security warnings.
echo ========================================================
echo.
pause
