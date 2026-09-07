@echo off
chcp 65001 >nul
title [BroAgent] 브라우저 원클릭 실행 프로토콜 등록기
echo =================================================================
echo  🏢 e-Bro ERP — 브라우저 원클릭 에이전트 실행 프로토콜 등록
echo =================================================================
echo.

set "CMD=cmd.exe /c start \"\" \"%%SystemRoot%%\System32\WindowsPowerShell\v1.0\powershell.exe\" -NoProfile -WindowStyle Normal -Command \"$host.ui.RawUI.WindowTitle = '[BroAgent] Local Sidecar Agent'; if (Test-Path 'C:\eBroAgent\BroAgent.js') { Set-Location 'C:\eBroAgent'; node BroAgent.js } elseif (Test-Path 'C:\eBroAgent\eBroAgent.js') { Set-Location 'C:\eBroAgent'; node eBroAgent.js } elseif (Test-Path \\\"$env:USERPROFILE\Downloads\BroAgent.js\\\" ) { Set-Location \\\"$env:USERPROFILE\Downloads\\\"; node BroAgent.js } elseif (Test-Path \\\"$env:USERPROFILE\Downloads\eBroAgent.js\\\" ) { Set-Location \\\"$env:USERPROFILE\Downloads\\\"; node eBroAgent.js } else { Write-Host '[BroAgent] BroAgent.js를 찾지 못했습니다.' -ForegroundColor Red; pause }\""

reg add "HKCU\Software\Classes\broagent" /ve /d "URL:BroAgent Protocol" /f >nul
reg add "HKCU\Software\Classes\broagent" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\broagent\shell\open\command" /ve /d "%CMD%" /f >nul

reg add "HKCU\Software\Classes\ebro" /ve /d "URL:eBro Protocol" /f >nul
reg add "HKCU\Software\Classes\ebro" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\ebro\shell\open\command" /ve /d "%CMD%" /f >nul

echo ✅ 브라우저 원클릭 실행 프로토콜(broagent://) 등록 완료!
echo    이제 웹사이트에서 [🚀 사이트에서 에이전트 실행] 버튼을 누르면
echo    Node.js BroAgent가 즉시 실행됩니다.
echo.
pause
