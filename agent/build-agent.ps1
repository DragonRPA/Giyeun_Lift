# agent/build-agent.ps1
# (주)기연리프트 로컬 에이전트 원클릭 컴파일 및 서명 스크립트

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }
$rootDir = Split-Path -Parent $scriptDir

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  [eBroAgent.exe] Compilation and Packaging" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 0. 기존 실행 중인 프로세스 안전 종료
Write-Host "0. Stopping existing eBroAgent processes..." -ForegroundColor Yellow
Get-Process -Name "eBroAgent", "KiyeunAgent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

# 1. esbuild 번들링
Write-Host "1. Bundling with esbuild..." -ForegroundColor Yellow
cmd /c "npx esbuild `"$scriptDir\eBroAgent.js`" --bundle --platform=node --outfile=`"$scriptDir\agent-bundle.js`""
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ esbuild 번들링 실패!" -ForegroundColor Red
    exit 1
}

# 2. Node SEA Prep Blob 생성
Write-Host "2. Generating Node.js SEA Blob..." -ForegroundColor Yellow
Set-Location $rootDir
cmd /c "node --experimental-sea-config `"$scriptDir\sea-config.json`""
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ SEA Blob 생성 실패!" -ForegroundColor Red
    exit 1
}
Set-Location $scriptDir

# 3. node.exe 복제
Write-Host "3. Copying node.exe binary..." -ForegroundColor Yellow
$nodeExe = (Get-Command node).Source
$targetExe = Join-Path $scriptDir "eBroAgent.exe"
Copy-Item $nodeExe $targetExe -Force
Start-Sleep -Milliseconds 500

# 4. postject SEA Blob 주입
Write-Host "4. Injecting SEA blob with postject..." -ForegroundColor Yellow
cmd /c "npx postject `"$targetExe`" NODE_SEA_BLOB `"$scriptDir\sea-prep.blob`" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ postject 주입 실패!" -ForegroundColor Red
    exit 1
}
Start-Sleep -Milliseconds 1000

# 5. 디지털 서명 및 public/downloads 동기화
Write-Host "5. Code signing and sync to public/downloads..." -ForegroundColor Yellow
$publicDownloadsDir = Join-Path $rootDir "public\downloads"
if (-not (Test-Path $publicDownloadsDir)) { New-Item -ItemType Directory -Path $publicDownloadsDir -Force | Out-Null }
Copy-Item (Join-Path $scriptDir "eBroAgent.js") (Join-Path $publicDownloadsDir "eBroAgent.js") -Force
Copy-Item (Join-Path $scriptDir "agent.js") (Join-Path $publicDownloadsDir "agent.js") -Force
Copy-Item (Join-Path $scriptDir "start-agent.bat") (Join-Path $publicDownloadsDir "start-agent.bat") -Force
Copy-Item (Join-Path $scriptDir "kill-agent.bat") (Join-Path $publicDownloadsDir "kill-agent.bat") -Force
powershell -ExecutionPolicy Bypass -File (Join-Path $scriptDir "sign-agent.ps1")

Write-Host "========================================================" -ForegroundColor Green
Write-Host "  [OK] eBroAgent.exe and eBroAgent.js build completed!" -ForegroundColor Green
Write-Host "  - agent\eBroAgent.exe" -ForegroundColor White
Write-Host "  - public\downloads\eBroAgent.exe" -ForegroundColor White
Write-Host "  - public\downloads\eBroAgent.js" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Green
