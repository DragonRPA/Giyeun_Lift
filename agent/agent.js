/**
 * =========================================================================
 * 🏢 e-Bro ERP — 로컬 경량 사이드카 에이전트 (eBroAgent)
 * =========================================================================
 * - 역할: CF R2 파일 로컬 미러링, 로컬 문서고 아카이빙, 프런트 실시간 통신 대행
 * - 통신: 로컬 HTTP (http://127.0.0.1:5175)
 * - 의존성: Node.js 내장 모듈만 사용 (외부 npm 패키지 Zero)
 * =========================================================================
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');


const VERSION = 'v2.0.0.Build.1';
const PORT = process.env.PORT || 5175;
const CALLSIGN = process.env.AGENT_CALLSIGN || 'admin';
const MACHINE_NAME = os.hostname();

// 📁 전사 표준 절대경로: C:\eBroAgent\ 및 하위 문서고
const AGENT_HOME = 'C:\\eBroAgent';
const LEGACY_AGENT_HOME = 'C:\\KiyeunAgent';
const TARGET_EXE_PATH = path.join(AGENT_HOME, 'eBroAgent.exe');
const ARCHIVE_ROOT = path.join(AGENT_HOME, '문서고');
const DRIVE_MIRROR_DIR = path.join(AGENT_HOME, 'drive_mirror');
const STATION_CONFIG_FILE = path.join(AGENT_HOME, 'station_config.json');

let activeStationConfig = null;
try {
  if (fs.existsSync(STATION_CONFIG_FILE)) {
    activeStationConfig = JSON.parse(fs.readFileSync(STATION_CONFIG_FILE, 'utf8'));
  }
} catch (e) {}

// =========================================================================
// 🚀 [스마트 자가 자동 설치 & 구버전 자동 교체(Auto-Kill & Takeover) 엔진]
// 사용자가 다운로드 폴더나 바탕화면에서 eBroAgent.exe를 실행한 경우,
// 1) 기존에 돌고 있던 구버전 eBroAgent/KiyeunAgent 프로세스를 조용히 자동 종료!
// 2) C:\eBroAgent\eBroAgent.exe 를 최신 바이너리로 안전 덮어쓰기!
// 3) 표준 위치에서 최신 에이전트를 백그라운드로 즉시 바통 터치 기동!
// =========================================================================
const currentExePath = process.execPath;
const currentPid = process.pid;
const isExe = currentExePath.toLowerCase().endsWith('.exe') && !currentExePath.toLowerCase().includes('node.exe');

// 1. 다른 경로에서 실행된 경우 (설치/업그레이드 모드)
if (isExe && path.resolve(currentExePath).toLowerCase() !== path.resolve(TARGET_EXE_PATH).toLowerCase()) {
  try {
    if (!fs.existsSync(AGENT_HOME)) fs.mkdirSync(AGENT_HOME, { recursive: true });
    if (!fs.existsSync(ARCHIVE_ROOT)) fs.mkdirSync(ARCHIVE_ROOT, { recursive: true });
    if (!fs.existsSync(DRIVE_MIRROR_DIR)) fs.mkdirSync(DRIVE_MIRROR_DIR, { recursive: true });

    console.log('====================================================');
    console.log(`📦 [eBroAgent] 에이전트 최신 버전(${VERSION}) 자가 교체/설치 진행`);
    console.log(`📍 현재 실행 위치: ${currentExePath}`);
    console.log(`🎯 표준 정착 경로: ${TARGET_EXE_PATH}`);

    // 기존 구버전 프로세스 및 5175 포트 점유 프로세스 완벽 강제 종료 (설치 모드에서만)
    try {
      console.log('🔄 기존 구버전 프로세스 자동 정리 중...');
      execSync('powershell -NoProfile -Command "Get-Process -Name eBroAgent, KiyeunAgent -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne ' + currentPid + ' } | Stop-Process -Force"', { stdio: 'ignore' });
    } catch (kErr) {}

    // 0.6초 대기 후 파일 복사
    setTimeout(() => {
      try {
        fs.copyFileSync(currentExePath, TARGET_EXE_PATH);
        console.log('✅ C:\\eBroAgent\\eBroAgent.exe 최신 버전으로 교체 완료!');
        console.log('🚀 최신 엔진으로 백그라운드 기동합니다...');
        console.log('====================================================');

        const child = spawn(TARGET_EXE_PATH, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });
        child.unref();

        console.log('🎉 업그레이드가 완료되었습니다. 이 창은 2초 후 자동으로 닫힙니다.');
        setTimeout(() => { process.exit(0); }, 2000);
      } catch (copyErr) {
        console.error('⚠️ 파일 복사 실패 (현재 위치에서 실행 유지):', copyErr.message);
      }
    }, 600);
    return;
  } catch (err) {
    console.error('⚠️ 자가 설치 중 오류 발생:', err.message);
  }
}

// 🔄 윈도우 시작 시 자동 실행(Auto-Startup) 레지스트리 자동 등록
try {
  execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "eBroAgent" /t REG_SZ /d "${TARGET_EXE_PATH}" /f`, { stdio: 'ignore' });
  try { execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "KiyeunAgent" /f', { stdio: 'ignore' }); } catch (e) {}
} catch (e) {}

// 디렉토리 자동 생성 (정식 위치 실행 시)
try {
  if (!fs.existsSync(AGENT_HOME)) fs.mkdirSync(AGENT_HOME, { recursive: true });
  if (!fs.existsSync(ARCHIVE_ROOT)) fs.mkdirSync(ARCHIVE_ROOT, { recursive: true });
  if (!fs.existsSync(DRIVE_MIRROR_DIR)) fs.mkdirSync(DRIVE_MIRROR_DIR, { recursive: true });
} catch (e) {
  console.warn('디렉토리 생성 경고:', e.message);
}

console.log('====================================================');
console.log(`🚀 [eBroAgent] 로컬 사이드카 에이전트 가동 (${VERSION})`);
console.log(`📡 콜사인(Callsign): ${CALLSIGN}`);
console.log(`💻 컴퓨터 이름: ${MACHINE_NAME}`);
console.log(`📂 에이전트 홈 경로: ${AGENT_HOME}`);
console.log(`📑 문서 영구 보관소: ${ARCHIVE_ROOT}`);
console.log(`🌐 로컬 통신 포트: http://127.0.0.1:${PORT}`);
console.log('====================================================');

// ── HTTP 요청 핸들러 ──
let activeCallsign = CALLSIGN;

const server = http.createServer(async (req, res) => {
  // CORS 및 W3C Private Network Access (PNA) 헤더 전사 허용 (헌장 1.1, 5.2)
  const reqOrigin = req.headers.origin;
  if (reqOrigin) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Range, Accept, Origin, Cache-Control, Pragma, *');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const rawUrl = req.url || '';
  const pathname = rawUrl.split('?')[0];
  const queryIndex = rawUrl.indexOf('?');
  const queryString = queryIndex !== -1 ? rawUrl.substring(queryIndex + 1) : '';
  const searchParams = new URLSearchParams(queryString);

  // 1. 헬스체크 및 동적 콜사인 바인딩 API
  if (req.method === 'GET' && pathname === '/health') {
    const queryCallsign = searchParams.get('callsign');
    if (queryCallsign && queryCallsign.trim()) {
      activeCallsign = queryCallsign.trim();
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'ONLINE',
      version: VERSION,
      callsign: activeCallsign,
      machineName: MACHINE_NAME,
      archiveRoot: ARCHIVE_ROOT,
      driveMirrorDir: DRIVE_MIRROR_DIR,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // 2. 에이전트 원클릭 핫 재시작 (Restart) API
  if (req.method === 'POST' && pathname === '/api/restart') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: '에이전트를 1초 후 자동 재시작합니다.' }));
    setTimeout(() => {
      const child = spawn(TARGET_EXE_PATH, [], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      process.exit(0);
    }, 500);
    return;
  }

  // 3. 에이전트 원클릭 셧다운 (Shutdown) API
  if (req.method === 'POST' && pathname === '/api/shutdown') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: '에이전트를 안전하게 종료합니다.' }));
    setTimeout(() => { process.exit(0); }, 500);
    return;
  }

  // 3-2. Cloudflare R2 원본 실시간 강제 재동기화 API
  if (req.method === 'POST' && pathname === '/api/trigger-sync') {
    autoSyncFromCloudflare().then((syncRes) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(syncRes || {
        success: true,
        message: 'Cloudflare R2 실시간 버킷 동기화가 완료되었습니다.'
      }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }

  // 3-2-2. 📧 실시간 Gmail SMTP 이메일 발송 API (/api/send-email)
  if (req.method === 'POST' && pathname === '/api/send-email') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(bodyData || '{}');
        const { to, cc, subject, body, googleEmail, gmailAppPassword, attachments } = payload;

        if (!to || !subject || !body) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: '수신자(to), 제목(subject), 본문(body)은 필수 항목입니다.' }));
          return;
        }

        const cleanEmail = String(googleEmail || '').trim();
        const cleanPass = String(gmailAppPassword || '').replace(/\s+/g, '').trim();

        if (!cleanEmail || !cleanPass) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: '구글 계정 이메일과 16자리 앱 비밀번호가 필요합니다.' }));
          return;
        }

        const nodemailer = require('nodemailer');

        const transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          auth: { user: cleanEmail, pass: cleanPass }
        });

        const parsedAttachments = Array.isArray(attachments) ? attachments.map((att) => {
          const base64Data = String(att.content || '').replace(/^data:.*?;base64,/, '');
          return {
            filename: att.filename || '계약서류팩.pdf',
            content: Buffer.from(base64Data, 'base64'),
            contentType: att.contentType || 'application/pdf'
          };
        }) : undefined;

        const info = await transporter.sendMail({
          from: `"(주)기연리프트" <${cleanEmail}>`,
          to: String(to).trim(),
          cc: cc ? String(cc).trim() : undefined,
          subject: String(subject).trim(),
          text: String(body),
          attachments: parsedAttachments
        });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, messageId: info.messageId, accepted: info.accepted }));
      } catch (err) {
        console.error('Agent email send error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message || '이메일 발송에 실패했습니다.' }));
      }
    });
    return;
  }

  // 3-3. 🌟 정품 엑셀 원본 기반 7종 통합 계약 서류팩 PDF 생성 엔진 (Excel COM + pdf-lib)
  if (req.method === 'POST' && pathname === '/api/generate-contract-bundle') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      const tempBuildDir = path.join(AGENT_HOME, 'temp_build_' + Date.now());
      try {
        const payload = JSON.parse(body || '{}');
        if (!fs.existsSync(tempBuildDir)) fs.mkdirSync(tempBuildDir, { recursive: true });

        const custName = payload.customerName || '고객사';
        const bizRegNo = payload.bizRegNo || '등록번호미지정';
        const ceoName = payload.ceoName || '대표자';
        const contractDate = payload.contractDate || new Date().toISOString().split('T')[0];
        const siteName = payload.siteName || '현장미지정';
        const siteAddress = payload.siteAddress || '';
        const managerName = payload.managerName || '현장담당자';
        const managerPhone = payload.managerPhone || '010-0000-0000';
        const optionsText = payload.optionsText || '협착방지대, 튜브소화기';
        const remarksText = payload.remarksText || '안전발판 지급';

        const assets = payload.assets && payload.assets.length > 0 ? payload.assets : [
          { assetNo: 'G06119', modelName: 'GTJZ0608ME', sn: '0108000379', rentalFee: 390000 }
        ];

        const primaryAsset = assets[0];
        const totalRentalFee = assets.reduce((sum, a) => sum + (Number(a.rentalFee) || 0), 0);

        // PowerShell 스크립트 작성 (UTF-8 BOM 필수)
        const psScript = `\ufeff
$ErrorActionPreference = 'Stop'

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.ScreenUpdating = $false
$excel.EnableEvents = $false
$excel.Interactive = $false

function Replace-Tag($targetWs, $tag, $val) {
  $null = $targetWs.Cells.Replace($tag, $val, 2, 1, $false, $false, $false)
}

# --- 1. 마스터 파일 복사 및 열기 ---
$masterIn = '${DRIVE_MIRROR_DIR.replace(/\\/g, '\\\\')}\\\\01.계약서패키지_마스터.xlsx'
$masterWork = '${tempBuildDir.replace(/\\/g, '\\\\')}\\\\01.마스터_작업용.xlsx'
$masterPdf = '${tempBuildDir.replace(/\\/g, '\\\\')}\\\\01.계약서패키지.pdf'
Copy-Item $masterIn $masterWork -Force
$wb = $excel.Workbooks.Open($masterWork)

# 시트 이름 매핑 (순서 변경 및 이름 공백/변경 대응 유연한 검색)
function Get-SheetByKeyword($workbook, $keyword, $fallbackIndex) {
    foreach ($sheet in $workbook.Sheets) {
        if ($sheet.Name -match $keyword) {
            return $sheet
        }
    }
    return $workbook.Sheets.Item($fallbackIndex)
}

$wsContract = Get-SheetByKeyword $wb "계약서" 1
$wsChecklistBase = Get-SheetByKeyword $wb "반입전|체크리스트" 2
$wsSafetyBase = Get-SheetByKeyword $wb "안전점검|결과서" 3

# --- 2. 계약서 데이터 주입 (Sheet 1) ---
Replace-Tag $wsContract "{Today}" "${contractDate}"
Replace-Tag $wsContract "{사업자등록번호}" "${bizRegNo}"
Replace-Tag $wsContract "{고객명}" "${custName}"
Replace-Tag $wsContract "{대표자}" "${ceoName}"
Replace-Tag $wsContract "{현장명}" "${siteName}"
Replace-Tag $wsContract "{하차일시}" "${contractDate}"
Replace-Tag $wsContract "{현장주소}" "${siteAddress}"
Replace-Tag $wsContract "{현장담당자}" "${managerName}"
Replace-Tag $wsContract "{현장담당자연락처}" "${managerPhone}"
Replace-Tag $wsContract "{모델명}" "${primaryAsset.modelName}"
Replace-Tag $wsContract "{수량}" "${assets.length}"
Replace-Tag $wsContract "{SN}" "${primaryAsset.sn}"
Replace-Tag $wsContract "{관리번호}" "${primaryAsset.assetNo}"
Replace-Tag $wsContract "{임대료}" "${(primaryAsset.rentalFee || 390000).toLocaleString()}"
Replace-Tag $wsContract "{소계}" "${totalRentalFee.toLocaleString()}"
Replace-Tag $wsContract "{합계}" "₩${totalRentalFee.toLocaleString()}"
Replace-Tag $wsContract "{옵션}" "${optionsText}"
Replace-Tag $wsContract "{특이사항}" "${remarksText}"

# ── 자산별 행(Row 44부터) 1대당 1줄씩 명시적 기입 ──
` + assets.map((ast, idx) => {
  const row = 44 + idx;
  const aModel = ast.modelName || 'GS-2646';
  const aSn = ast.sn ? String(ast.sn) : '';
  const aNo = ast.assetNo || '';
  const aFee = (ast.rentalFee || 480000).toLocaleString();
  return `
$wsContract.Cells.Item(${row}, 1).Value2 = "${aModel}"
$wsContract.Cells.Item(${row}, 3).Value2 = "1"
$wsContract.Cells.Item(${row}, 4).Value2 = "${aSn}\`r\`n${aNo}"
$wsContract.Cells.Item(${row}, 5).Value2 = "${aFee}"
$wsContract.Cells.Item(${row}, 7).Value2 = "${aFee}"
`;
}).join('') + (assets.length < 12 ? Array.from({ length: 12 - assets.length }, (_, k) => {
  const row = 44 + assets.length + k;
  return `
$wsContract.Cells.Item(${row}, 1).Value2 = ""
$wsContract.Cells.Item(${row}, 3).Value2 = ""
$wsContract.Cells.Item(${row}, 4).Value2 = ""
$wsContract.Cells.Item(${row}, 5).Value2 = ""
$wsContract.Cells.Item(${row}, 7).Value2 = ""
`;
}).join('') : '') + `

$wsContract.PageSetup.PaperSize = 9
$wsContract.PageSetup.Orientation = 1
$wsContract.PageSetup.Zoom = $false
$wsContract.PageSetup.FitToPagesWide = 1
if (${assets.length} -le 12) {
  $wsContract.PageSetup.PrintArea = "A26:K78"
  $wsContract.PageSetup.FitToPagesTall = 1
} else {
  $wsContract.PageSetup.PrintArea = ""
  $wsContract.PageSetup.FitToPagesTall = $false
}

# --- 3. 체크리스트 및 안전점검결과서 시트 복제 및 데이터 주입 ---
# JSON 배열 데이터를 PowerShell 객체로 파싱
$assetsJson = '${JSON.stringify(assets).replace(/'/g, "''")}' | ConvertFrom-Json

for ($i = 0; $i -lt $assetsJson.Count; $i++) {
    $asset = $assetsJson[$i]
    
    if ($i -eq 0) {
        $curChecklist = $wsChecklistBase
        $curSafety = $wsSafetyBase
    } else {
        $wsChecklistBase.Copy([Type]::Missing, $wb.Sheets.Item($wb.Sheets.Count))
        $curChecklist = $wb.Sheets.Item($wb.Sheets.Count)
        $wsSafetyBase.Copy([Type]::Missing, $wb.Sheets.Item($wb.Sheets.Count))
        $curSafety = $wb.Sheets.Item($wb.Sheets.Count)
    }
    
    Replace-Tag $curChecklist "{모델명}" "$($asset.modelName)"
    Replace-Tag $curChecklist "{관리번호}" "$($asset.assetNo)"
    $curChecklist.PageSetup.Orientation = 1
    $curChecklist.PageSetup.Zoom = $false
    $curChecklist.PageSetup.FitToPagesWide = 1
    $curChecklist.PageSetup.FitToPagesTall = 1

    Replace-Tag $curSafety "{사업장명}" "${siteName}"
    Replace-Tag $curSafety "{형식}" "자주식 시저형"
    Replace-Tag $curSafety "{제조사}" "SINOBOOM"
    Replace-Tag $curSafety "{고객명}" "${custName}"
    Replace-Tag $curSafety "{동력방식}" "배터리식"
    Replace-Tag $curSafety "{모델명}" "$($asset.modelName)"
    Replace-Tag $curSafety "{중량}" "1,520 kg"
    Replace-Tag $curSafety "{운행속도}" "3.5 km/h"
    Replace-Tag $curSafety "{작업높이}" "6.0 m"
    Replace-Tag $curSafety "{적재}" "230 kg"
    Replace-Tag $curSafety "{차량번호}" "$($asset.assetNo) ($($asset.sn))"
    Replace-Tag $curSafety "{제조연도}" "2021년"
    Replace-Tag $curSafety "{안전인증일}" "2021-05-12"
    Replace-Tag $curSafety "{Today}" "${contractDate}"
    Replace-Tag $curSafety "{점검자}" "김관주"
    $curSafety.PageSetup.Orientation = 1
    $curSafety.PageSetup.Zoom = $false
    $curSafety.PageSetup.FitToPagesWide = 1
    $curSafety.PageSetup.FitToPagesTall = 1
}

# --- 4. 전체 워크북 1회 Export (모든 시트가 1개의 PDF로) ---
$wb.ExportAsFixedFormat(0, $masterPdf)
$wb.Close($false)

$excel.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
`;

        const psFile = path.join(tempBuildDir, 'build_bundle.ps1');
        fs.writeFileSync(psFile, psScript, 'utf8');

        // Excel 변환 동기 실행
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, { encoding: 'utf8' });

        // PDF 병합 (pdf-lib)
        const { PDFDocument } = require('pdf-lib');

        const mergedPdf = await PDFDocument.create();
        const pdfSources = [
          path.join(tempBuildDir, '01.계약서패키지.pdf')
        ];

        // 중복 모델 제거
        const uniqueModels = [...new Set((assets || []).map(a => a.modelName).filter(Boolean))];
        
        // Eq_doc 내의 모델 폴더에서 PDF 파일들 추가
        for (const model of uniqueModels) {
          const eqDocDir = path.join(DRIVE_MIRROR_DIR, 'Eq_doc', model);
          if (fs.existsSync(eqDocDir)) {
            const files = fs.readdirSync(eqDocDir).filter(f => f.toLowerCase().endsWith('.pdf'));
            // 정렬해서 넣기 (예: 01.제원표, 02.등록증 등)
            files.sort();
            for (const f of files) {
              pdfSources.push(path.join(eqDocDir, f));
            }
          }
        }

        // 공통 서류 추가
        pdfSources.push(path.join(DRIVE_MIRROR_DIR, '08.생산물배상책임보험증권.pdf'));
        pdfSources.push(path.join(DRIVE_MIRROR_DIR, '09.사업자등록증.pdf'));
        pdfSources.push(path.join(DRIVE_MIRROR_DIR, '10.통장사본.pdf'));


        for (const p of pdfSources) {
          if (fs.existsSync(p)) {
            const bytes = fs.readFileSync(p);
            const doc = await PDFDocument.load(bytes);
            const copied = await mergedPdf.copyPages(doc, doc.getPageIndices());
            copied.forEach(page => mergedPdf.addPage(page));
          }
        }

        const finalPdfBytes = await mergedPdf.save();
        const pageCount = mergedPdf.getPageCount();
        const safeCustName = (payload.customerName || '고객').replace(/[\\/:*?"<>|]/g, '');
        const safeSiteName = String(payload.siteName || '현장').replace(/[\\/:*?"<>|]/g, '');
        const contractStartDateStr = String(payload.contractStartDate || payload.contractDate || '').replace(/[\\/:*?"<>|]/g, '');
        const fileName = `[기연리프트계약서]_${safeCustName}_${safeSiteName}_${contractStartDateStr}.pdf`;

        // 로컬 문서고 영구 아카이빙
        const yyyyMm = contractDate.substring(0, 7) || new Date().toISOString().substring(0, 7);
        const archiveDir = path.join(ARCHIVE_ROOT, yyyyMm);
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
        const localSavePath = path.join(archiveDir, fileName);
        fs.writeFileSync(localSavePath, finalPdfBytes);

        // 임시 폴더 청소
        try { fs.rmSync(tempBuildDir, { recursive: true, force: true }); } catch (e) {}

        const b64 = Buffer.from(finalPdfBytes).toString('base64');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          fileName,
          pageCount,
          localPath: localSavePath,
          base64Content: b64,
          message: `✅ 100% 정품 엑셀 기반 7종 통합 서류팩 생성 완료 (총 ${pageCount}페이지)`
        }));
      } catch (bundleErr) {
        console.error('❌ 서류팩 생성 실패:', bundleErr);
        try { fs.rmSync(tempBuildDir, { recursive: true, force: true }); } catch (e) {}
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: bundleErr.message }));
      }
    });
    return;
  }

  // 3-4. 🌟 정품 엑셀 원본 기반 거래명세서 A4 PDF 생성 엔진 (Excel COM & 다중 페이지 자동 분할)
  if (req.method === 'POST' && pathname === '/api/generate-statement') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      const tempBuildDir = path.join(AGENT_HOME, 'temp_statement_' + Date.now());
      try {
        const payload = JSON.parse(body || '{}');
        if (!fs.existsSync(tempBuildDir)) fs.mkdirSync(tempBuildDir, { recursive: true });

        const custName = payload.customerName || '고객사';
        const bizRegNo = payload.customerBizNo || payload.bizRegNo || '등록번호미지정';
        const ceoName = payload.customerCeo || '대표자';
        const billingDate = payload.billingDate || new Date().toISOString().split('T')[0];
        const siteName = payload.siteName || '현장';
        const siteAddress = payload.customerAddress || '';
        const siteManagerName = payload.siteManagerName || '-';
        const siteManagerPhone = payload.siteManagerPhone || '-';
        const custBillingName = payload.custBillingManagerName || payload.billingManagerName || '-';
        const custBillingPhone = payload.custBillingManagerPhone || payload.billingManagerPhone || '-';
        const custBillingEmail = payload.custBillingEmail || '-';
        const custBizType = payload.customerBizType || '-';
        const custBizItem = payload.customerBizItem || '-';

        const salespersonName = payload.salespersonName || '김동우 팀장';
        const salespersonPhone = payload.salespersonPhone || '010-9402-5296';
        const billingManagerName = payload.billingManagerName || '정수아';
        const billingManagerPhone = payload.billingManagerPhone || '031-334-5295';

        const items = payload.items || [];
        const totalSupply = payload.totalSupply || 0;
        const totalVat = payload.totalVat || 0;
        const totalGrand = payload.totalGrand || 0;

        // 11개 단위 분할 (다중 페이지 거래명세서 엔진)
        const chunkSize = 11;
        const chunks = [];
        for (let i = 0; i < items.length; i += chunkSize) {
          chunks.push(items.slice(i, i + chunkSize));
        }
        if (chunks.length === 0) chunks.push([]);
        const totalPages = chunks.length;

        const psScript = `\ufeff
$ErrorActionPreference = 'Stop'

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.ScreenUpdating = $false
$excel.EnableEvents = $false
$excel.Interactive = $false

function Replace-Tag($targetWs, $tag, $val) {
  $null = $targetWs.Cells.Replace($tag, $val, 2, 1, $false, $false, $false)
}

function Setup-Sheet-Page($targetWs) {
  $targetWs.PageSetup.PaperSize = 9
  $targetWs.PageSetup.Orientation = 1
  $targetWs.PageSetup.PrintArea = "A1:U28"
  $targetWs.PageSetup.Zoom = $false
  $targetWs.PageSetup.FitToPagesWide = 1
  $targetWs.PageSetup.FitToPagesTall = 1
  $targetWs.PageSetup.CenterHorizontally = $true
  $targetWs.PageSetup.LeftMargin = $excel.InchesToPoints(0.2)
  $targetWs.PageSetup.RightMargin = $excel.InchesToPoints(0.2)
  $targetWs.PageSetup.TopMargin = $excel.InchesToPoints(0.25)
  $targetWs.PageSetup.BottomMargin = $excel.InchesToPoints(0.25)
}

# --- 1. 거래명세서 마스터 템플릿 복사 및 열기 ---
$masterIn = '${DRIVE_MIRROR_DIR.replace(/\\/g, '\\\\')}\\\\00.거래명세서양식.xlsx'
$statementWork = '${tempBuildDir.replace(/\\/g, '\\\\')}\\\\거래명세서_작업용.xlsx'
$statementPdf = '${tempBuildDir.replace(/\\/g, '\\\\')}\\\\거래명세서.pdf'

Copy-Item $masterIn $statementWork -Force
$wb = $excel.Workbooks.Open($statementWork)
$wsBase = $wb.Sheets.Item(1)

` + chunks.map((chunk, pageIdx) => {
  const pageNum = pageIdx + 1;
  const pageTag = totalPages > 1 ? ` ( ${pageNum} / ${totalPages} 쪽 )` : '';
  const isFirst = pageIdx === 0;
  const startGlobalIdx = pageIdx * chunkSize;

  let s = '';
  if (isFirst) {
    s += `\n$curWs = $wsBase\n`;
  } else {
    s += `
$wsBase.Copy([Type]::Missing, $wb.Sheets.Item($wb.Sheets.Count))
$curWs = $wb.Sheets.Item($wb.Sheets.Count)
`;
  }

  s += `
# 페이지 ${pageNum} 공급자 / 공급받는자 데이터 주입
Replace-Tag $curWs "{사업자등록번호}" "${bizRegNo}"
Replace-Tag $curWs "{고객명}" "${custName}"
Replace-Tag $curWs "{대표자}" "${ceoName}"
Replace-Tag $curWs "{주소}" "${siteAddress}"
Replace-Tag $curWs "{업태}" "${custBizType}"
Replace-Tag $curWs "{종목}" "${custBizItem}"
Replace-Tag $curWs "{현장담당자}" "${siteManagerName}"
Replace-Tag $curWs "{현장담당자연락처}" "${siteManagerPhone}"
Replace-Tag $curWs "{계산서담당자}" "${custBillingName}"
Replace-Tag $curWs "{계산서담당자연락처}" "${custBillingPhone}"
Replace-Tag $curWs "{계산서이메일}" "${custBillingEmail}"
Replace-Tag $curWs "{현장명}" "${siteName}${pageTag}"

Replace-Tag $curWs "{영업사원}" "${salespersonName}"
Replace-Tag $curWs "{영업사원연락처}" "${salespersonPhone}"
Replace-Tag $curWs "{청구담당자}" "${billingManagerName}"
Replace-Tag $curWs "{청구담당자연락처}" "${billingManagerPhone}"

$curWs.Cells.Item(13, 5).Value2 = "${billingDate}${pageTag}"

`;

  // 품목 기입 (Row 16 ~ Row 26)
  for (let r = 0; r < 11; r++) {
    const item = chunk[r];
    const rowNum = 16 + r;
    if (item) {
      const globalNo = startGlobalIdx + r + 1;
      const m = item.month || '';
      const d = item.day || '';
      const desc = (item.itemDescription || '').replace(/"/g, '""');
      const qty = item.quantity || 1;
      const price = (item.unitPrice || 0).toLocaleString();
      const supply = (item.supplyAmount || 0).toLocaleString();
      const vat = (item.vatAmount || 0).toLocaleString();
      const notes = (item.notes || '').replace(/"/g, '""');

      s += `
$curWs.Cells.Item(${rowNum}, 2).Value2 = "${globalNo}"
$curWs.Cells.Item(${rowNum}, 3).Value2 = "${m}"
$curWs.Cells.Item(${rowNum}, 4).Value2 = "${d}"
$curWs.Cells.Item(${rowNum}, 5).Value2 = "${desc}"
$curWs.Cells.Item(${rowNum}, 12).Value2 = "${qty}"
$curWs.Cells.Item(${rowNum}, 13).Value2 = "${price}"
$curWs.Cells.Item(${rowNum}, 15).Value2 = "${supply}"
$curWs.Cells.Item(${rowNum}, 17).Value2 = "${vat}"
$curWs.Cells.Item(${rowNum}, 20).Value2 = "${notes}"
`;
    } else {
      s += `
$curWs.Cells.Item(${rowNum}, 2).Value2 = ""
$curWs.Cells.Item(${rowNum}, 3).Value2 = ""
$curWs.Cells.Item(${rowNum}, 4).Value2 = ""
$curWs.Cells.Item(${rowNum}, 5).Value2 = ""
$curWs.Cells.Item(${rowNum}, 12).Value2 = ""
$curWs.Cells.Item(${rowNum}, 13).Value2 = ""
$curWs.Cells.Item(${rowNum}, 15).Value2 = ""
$curWs.Cells.Item(${rowNum}, 17).Value2 = ""
$curWs.Cells.Item(${rowNum}, 20).Value2 = ""
`;
    }
  }

  s += `
# 합계 행 치환
Replace-Tag $curWs "{공급가합계}" "${totalSupply.toLocaleString()}"
Replace-Tag $curWs "{부가세합계}" "${totalVat.toLocaleString()}"
Replace-Tag $curWs "{총액}" "${totalGrand.toLocaleString()}"

Setup-Sheet-Page $curWs
`;

  return s;
}).join('\n') + `

# --- 5. 전체 워크북 1회 Export (모든 시트가 1개의 단일 다중 페이지 PDF로) ---
$wb.ExportAsFixedFormat(0, $statementPdf, 0, $true, $false, [System.Reflection.Missing]::Value, [System.Reflection.Missing]::Value, $false)

$wb.Close($false)
$excel.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
`;

        const psFile = path.join(tempBuildDir, 'generate_statement.ps1');
        fs.writeFileSync(psFile, psScript, { encoding: 'utf8' });

        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, {
          cwd: tempBuildDir,
          encoding: 'utf8',
          timeout: 60000,
          windowsHide: true
        });

        const statementPdfPath = path.join(tempBuildDir, '거래명세서.pdf');
        if (!fs.existsSync(statementPdfPath)) {
          throw new Error('거래명세서 정품 PDF 생성 실패: 결과 파일 없음');
        }

        const pdfBuffer = fs.readFileSync(statementPdfPath);
        const b64 = pdfBuffer.toString('base64');
        const fileName = `[기연리프트]_거래명세서_${custName}_${siteName}_${payload.billingYm || ''}.pdf`;

        // 완료 후 임시 폴더 정리
        try { fs.rmSync(tempBuildDir, { recursive: true, force: true }); } catch (e) {}

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          fileName,
          pageCount: 1,
          base64Content: b64,
          message: `✅ 100% 정품 엑셀 기반 거래명세서 PDF 생성 완료`
        }));
      } catch (statementErr) {
        console.error('❌ 거래명세서 생성 실패:', statementErr);
        try { fs.rmSync(tempBuildDir, { recursive: true, force: true }); } catch (e) {}
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: statementErr.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/get-file') {
    const fileId = searchParams.get('fileId');
    const fileName = searchParams.get('fileName') || (fileId ? `${fileId}.pdf` : '');
    if (!fileId && !fileName) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'fileId or fileName is required' }));
      return;
    }

    (async () => {
      try {
        const ext = path.extname(fileName).toLowerCase();
        const mimeTypes = {
          '.pdf': 'application/pdf',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.xls': 'application/vnd.ms-excel',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.txt': 'text/plain',
          '.json': 'application/json'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';

        // 1순위: 로컬 미러링 폴더(C:\eBroAgent\drive_mirror\)에서 파일 확인
        let localFilePath = path.join(DRIVE_MIRROR_DIR, fileName);
        if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
          const fileBuf = fs.readFileSync(localFilePath);
          res.writeHead(200, { 'Content-Type': contentType, 'X-Cache-Source': 'LOCAL_MIRROR' });
          res.end(fileBuf);
          return;
        }

        // 2순위: 하위 폴더 탐색 (fileName이 서브 디렉토리 없이 전달된 경우 대비)
        const findFileRecursively = (dir, targetName) => {
          if (!fs.existsSync(dir)) return null;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.name.startsWith('.') || ent.name === 'archive') continue;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              const found = findFileRecursively(full, targetName);
              if (found) return found;
            } else if (ent.name.toLowerCase() === targetName.toLowerCase()) {
              return full;
            }
          }
          return null;
        };

        const foundPath = findFileRecursively(DRIVE_MIRROR_DIR, path.basename(fileName));
        if (foundPath && fs.existsSync(foundPath)) {
          const fileBuf = fs.readFileSync(foundPath);
          res.writeHead(200, { 'Content-Type': contentType, 'X-Cache-Source': 'LOCAL_MIRROR_RECURSIVE' });
          res.end(fileBuf);
          return;
        }

        // 3순위: R2 공개 URL 또는 기본 CF R2 도메인에서 자동 다운로드 후 로컬 캐싱
        const directUrl = searchParams.get('url') || (fileName ? `https://pub-a2fd3c2ae0cc450b8ebe34baf1b051e1.r2.dev/${fileName.split('/').map(encodeURIComponent).join('/')}` : null);
        if (directUrl && directUrl.startsWith('http')) {
          try {
            const fetchRes = await fetch(directUrl);
            if (fetchRes.ok) {
              const ab = await fetchRes.arrayBuffer();
              if (ab.byteLength > 100) {
                const targetDir = path.dirname(localFilePath);
                if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
                fs.writeFileSync(localFilePath, Buffer.from(ab));

                res.writeHead(200, { 'Content-Type': contentType, 'X-Cache-Source': 'R2_URL_DOWNLOADED' });
                res.end(Buffer.from(ab));
                return;
              }
            }
          } catch (urlErr) {}
        }

        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: `파일을 찾을 수 없습니다: ${fileName}` }));
      } catch (err) {
        console.error('❌ /api/get-file 오류:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    })();
    return;
  }
  // 4. 계약 서류 팩 무손실 생산 및 로컬 문서고 보관 API
  if (req.method === 'POST' && pathname === '/api/execute-job') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        console.log(`📥 [작업 수신] ${payload.jobType || 'CONTRACT_BUNDLE'} (계약: ${payload.contractNo || 'N/A'}, 작업자: ${activeCallsign})`);

        // 로컬 문서고에 날짜별 자동 분류 폴더 생성
        const today = new Date().toISOString().split('T')[0];
        const monthDir = path.join(ARCHIVE_ROOT, today.substring(0, 7));
        if (!fs.existsSync(monthDir)) fs.mkdirSync(monthDir, { recursive: true });

        const safeCustName = (payload.customerName || '고객사').replace(/[/\\?%*:|"<>]/g, '_');
        const fileName = `[기연리프트]_${payload.contractNo || '계약'}_${safeCustName}_${today}.pdf`;
        const localSavePath = path.join(monthDir, fileName);

        if (payload.base64Content) {
          const pdfBuffer = Buffer.from(payload.base64Content, 'base64');
          fs.writeFileSync(localSavePath, pdfBuffer);
        }

        // 결과 응답
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          callsign: activeCallsign,
          localFilePath: localSavePath,
          message: `✅ 로컬 에이전트(${activeCallsign})가 정품 문서를 생산하여 로컬 문서고(${localSavePath})에 안전 보관했습니다.`
        }));
      } catch (err) {
        console.error('❌ 작업 처리 실패:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 6. 로컬 설치 프린터 목록 조회 API
  if (req.method === 'GET' && pathname === '/api/printers') {
    try {
      const psCmd = 'Get-CimInstance -ClassName Win32_Printer | Select-Object Name, Default | ConvertTo-Json';
      const output = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8' }).trim();
      let printerData = [];
      try {
        const parsed = JSON.parse(output || '[]');
        printerData = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        printerData = [];
      }

      const printers = printerData.map(p => p.Name).filter(Boolean);
      const defaultPrinterObj = printerData.find(p => p.Default);
      const defaultPrinter = defaultPrinterObj ? defaultPrinterObj.Name : (printers[0] || '');

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        printers,
        defaultPrinter,
        count: printers.length
      }));
    } catch (err) {
      console.error('❌ /api/printers 오류:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message, printers: [], defaultPrinter: '' }));
    }
    return;
  }

  // 7. 출고요청서 전용 프린터 0초 다이렉트 인쇄 API
  if (req.method === 'POST' && pathname === '/api/print-dispatch') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const printerName = payload.printerName || 'Apeos C2060';
        const htmlContent = payload.htmlContent || '';
        const title = payload.title || '기연리프트_출고요청서';

        if (!htmlContent) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'htmlContent is required' }));
          return;
        }

        // 임시 인쇄용 HTML 파일 작성 (UTF-8)
        const tempPrintHtml = path.join(AGENT_HOME, `temp_dispatch_print_${Date.now()}.html`);
        fs.writeFileSync(tempPrintHtml, `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; padding: 20px; color: #111; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 8px 10px; font-size: 13px; text-align: left; }
    th { background-color: #f9fafb; font-weight: bold; width: 130px; }
    .header { text-align: center; border-bottom: 2px solid #312e81; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; color: #1e1b4b; letter-spacing: 2px; }
    .section-title { font-size: 14px; font-weight: bold; border-left: 4px solid #312e81; padding-left: 8px; margin: 16px 0 8px 0; color: #312e81; }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`, 'utf8');

        console.log(`🖨️ [다이렉트 인쇄] 대상 프린터: [${printerName}], 임시파일: ${tempPrintHtml}`);

        const printCmd = `Start-Process rundll32.exe -ArgumentList 'mshtml.dll,PrintHTML "${tempPrintHtml}" "${printerName}"' -NoNewWindow`;
        execSync(`powershell -NoProfile -Command "${printCmd}"`, { stdio: 'ignore' });

        // 10초 후 임시 파일 자동 정리
        setTimeout(() => {
          try { if (fs.existsSync(tempPrintHtml)) fs.unlinkSync(tempPrintHtml); } catch (e) {}
        }, 10000);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          printer: printerName,
          message: `✅ 전용 프린터 [${printerName}] 로 출고요청서가 즉시 전송되었습니다.`
        }));
      } catch (err) {
        console.error('❌ /api/print-dispatch 인쇄 오류:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 8. 로컬 인쇄 스테이션 설정 조회 API
  if (req.method === 'GET' && pathname === '/api/station-config') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      config: activeStationConfig || {
        stationId: '',
        stationName: '',
        localPrinterName: '',
        docTypeDefault: 'ALL',
        machineName: MACHINE_NAME
      }
    }));
    return;
  }

  // 9. 로컬 인쇄 스테이션 설정 저장 API
  if (req.method === 'POST' && pathname === '/api/station-config') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        activeStationConfig = {
          stationId: payload.stationId || '',
          stationName: payload.stationName || '',
          localPrinterName: payload.localPrinterName || '',
          docTypeDefault: payload.docTypeDefault || 'ALL',
          machineName: payload.machineName || MACHINE_NAME,
          updatedAt: new Date().toISOString()
        };
        fs.writeFileSync(STATION_CONFIG_FILE, JSON.stringify(activeStationConfig, null, 2), 'utf8');
        console.log(`✅ [스테이션 설정 저장] ${activeStationConfig.stationName} (${activeStationConfig.stationId}) -> 로컬 프린터: [${activeStationConfig.localPrinterName}]`);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, config: activeStationConfig }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠️ 포트 ${PORT} 가 사용 중입니다. 이전 프로세스를 정리하고 1초 후 재시도합니다...`);
    try {
      execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
    } catch (e) {}
    setTimeout(() => {
      server.close();
      server.listen(PORT, '127.0.0.1', () => {
        console.log(`🟢 로컬 에이전트 서비스 리스닝 시작: http://127.0.0.1:${PORT}`);
      });
    }, 1000);
  } else {
    console.error('❌ 서버 에러:', err);
  }
});

// ── 0. Cloudflare R2 실시간 버킷 동적 스캔 및 자동 미러링 엔진 (Zero-Dependency SigV4) ──
const CF_ACCOUNT_ID = '35014a2514680107d74e1e68d96e6c32';
const CF_BUCKET_NAME = 'kiyeun-storage';
const CF_ACCESS_KEY = '03cdb7560d37242de608a5db2a976030';
const CF_SECRET_KEY = 'b2407ab4532e02317860bc3d63226fb7bc232e88083b150c15023906ed141986';
const CF_PUBLIC_URL = 'https://pub-a2fd3c2ae0cc450b8ebe34baf1b051e1.r2.dev';

function hmac(key, str) {
  return crypto.createHmac('sha256', key).update(str, 'utf8').digest();
}
function hash(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

async function fetchR2BucketAllObjects() {
  const host = CF_ACCOUNT_ID + '.r2.cloudflarestorage.com';
  const region = 'auto';
  const service = 's3';
  let isTruncated = true;
  let nextContinuationToken = null;
  const allObjects = [];

  while (isTruncated) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const canonicalUri = '/' + CF_BUCKET_NAME;
    let canonicalQuery = 'list-type=2';
    if (nextContinuationToken) {
      canonicalQuery += '&continuation-token=' + encodeURIComponent(nextContinuationToken);
    }
    const payloadHash = hash('');
    const canonicalHeaders = 'host:' + host + '\nx-amz-content-sha256:' + payloadHash + '\nx-amz-date:' + amzDate + '\n';
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = 'GET\n' + canonicalUri + '\n' + canonicalQuery + '\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + payloadHash;
    const credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';
    const stringToSign = 'AWS4-HMAC-SHA256\n' + amzDate + '\n' + credentialScope + '\n' + hash(canonicalRequest);

    const kDate = hmac('AWS4' + CF_SECRET_KEY, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    const authHeader = 'AWS4-HMAC-SHA256 Credential=' + CF_ACCESS_KEY + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

    const xmlData = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: host,
        port: 443,
        path: canonicalUri + '?' + canonicalQuery,
        method: 'GET',
        headers: {
          'Host': host,
          'x-amz-date': amzDate,
          'x-amz-content-sha256': payloadHash,
          'Authorization': authHeader
        }
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => res.statusCode === 200 ? resolve(d) : reject(new Error('HTTP ' + res.statusCode + ': ' + d)));
      });
      req.on('error', reject);
      req.end();
    });

    const isTruncatedMatch = /<IsTruncated>(true|false)<\/IsTruncated>/.exec(xmlData);
    isTruncated = isTruncatedMatch ? isTruncatedMatch[1] === 'true' : false;

    const tokenMatch = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xmlData);
    nextContinuationToken = tokenMatch ? tokenMatch[1] : null;

    const contentRegex = /<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g;
    let match;
    while ((match = contentRegex.exec(xmlData)) !== null) {
      const key = match[1];
      const size = parseInt(match[2], 10);
      const isDirectory = key.endsWith('/');
      allObjects.push({ key, size, isDirectory });
    }
  }

  return allObjects;
}

async function autoSyncFromCloudflare() {
  console.log('🔄 [CF 실시간 동적 미러링] Cloudflare R2 원본 저장소 실시간 스캔 시작...');
  try {
    const objects = await fetchR2BucketAllObjects();
    const fileCount = objects.filter(o => !o.isDirectory).length;
    const folderCount = objects.filter(o => o.isDirectory).length;
    console.log(`📦 [CF R2 버킷 파일 목록 확인] 파일 ${fileCount}개, 빈 폴더 ${folderCount}개 발견`);
    let downloaded = 0;
    let skipped = 0;
    let foldersCreated = 0;

    for (const obj of objects) {
      // 빈 폴더 또는 디렉토리 마커 처리
      if (obj.isDirectory) {
        const targetDir = path.join(DRIVE_MIRROR_DIR, obj.key);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
          console.log(`📁 [CF 빈 폴더 생성] ${obj.key}`);
          foldersCreated++;
        }
        continue;
      }

      // 일반 파일 다운로드
      const targetFile = path.join(DRIVE_MIRROR_DIR, obj.key);
      const targetDir = path.dirname(targetFile);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      if (fs.existsSync(targetFile)) {
        const st = fs.statSync(targetFile);
        if (st.isDirectory()) {
          fs.rmSync(targetFile, { recursive: true, force: true });
        } else if (st.size === obj.size && st.size > 0) {
          skipped++;
          continue;
        }
      }

      try {
        const encKey = obj.key.split('/').map(encodeURIComponent).join('/');
        const res = await fetch(`${CF_PUBLIC_URL}/${encKey}`, { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const ab = await res.arrayBuffer();
          if (ab.byteLength > 0) {
            fs.writeFileSync(targetFile, Buffer.from(ab));
            downloaded++;
            console.log(`💾 [CF 동기화 완료] ${obj.key} (${ab.byteLength.toLocaleString()} bytes)`);
          }
        }
      } catch (dlErr) {
        console.error(`❌ [다운로드 실패] ${obj.key}:`, dlErr.message);
      }
    }

    if (downloaded > 0 || foldersCreated > 0) {
      console.log(`✅ [CF 동적 미러링 완료] 파일 갱신: ${downloaded}개, 폴더 생성: ${foldersCreated}개, 최신 유지: ${skipped}개`);
    } else {
      console.log(`✅ [CF 동적 미러링 완료] 모든 파일(${fileCount}개) 및 폴더가 이미 최신 상태로 로컬에 보존되어 있습니다.`);
    }

    return {
      success: true,
      downloaded,
      skipped,
      foldersCreated,
      totalFiles: fileCount,
      message: `✅ Cloudflare R2 동기화 완료 (갱신: ${downloaded}개, 최신 유지: ${skipped}개)`
    };
  } catch (err) {
    console.error('⚠️ CF R2 실시간 버킷 조회 오류:', err.message);
    return {
      success: false,
      error: err.message,
      message: `⚠️ Cloudflare R2 버킷 스캔 오류: ${err.message}`
    };
  }
}

// =========================================================================
// 🖨️ [분산 원격 인쇄 큐 워커 엔진 (Headless Distributed Queue Worker)]
// =========================================================================
const SUPABASE_REST_URL = 'https://wywgkikkjgbnlljkkmnz.supabase.co/rest/v1';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5d2draWtramdibmxsamtrbW56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNjcxMzgsImV4cCI6MjA5OTk0MzEzOH0.gSftxhQjFmWUQzikx-Q5UsdgNKSZISZqJvUGeLBOCqU';

let isQueueProcessing = false;

async function checkAndProcessPrintQueue() {
  if (isQueueProcessing) return;
  if (!activeStationConfig || !activeStationConfig.stationId || !activeStationConfig.localPrinterName) return;

  isQueueProcessing = true;
  try {
    const stationId = encodeURIComponent(activeStationConfig.stationId);
    const queryUrl = `${SUPABASE_REST_URL}/print_queue?stationId=eq.${stationId}&status=eq.PENDING&order=requestedAt.asc&limit=1`;

    const res = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) {
      isQueueProcessing = false;
      return;
    }

    const jobs = await res.json();
    if (!Array.isArray(jobs) || jobs.length === 0) {
      isQueueProcessing = false;
      return;
    }

    const job = jobs[0];
    console.log(`\n📥 [원격 인쇄 작업 수신] 스테이션: [${activeStationConfig.stationName}], 작업: [${job.id}] ${job.title}`);

    // 1. 작업 상태를 PRINTING으로 선점 잠금 (중복 실행 방지)
    try {
      await fetch(`${SUPABASE_REST_URL}/print_queue?id=eq.${encodeURIComponent(job.id)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'PRINTING', updatedAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(4000)
      });
    } catch (lockErr) {}

    // 2. 인쇄용 임시 HTML 파일 작성 및 다이렉트 무인 출력 실행
    const tempPrintHtml = path.join(AGENT_HOME, `remote_print_${job.id}_${Date.now()}.html`);
    const printerName = activeStationConfig.localPrinterName;
    const title = job.title || '기연리프트_출력물';

    fs.writeFileSync(tempPrintHtml, `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: 'Malgun Gothic', 'Noto Sans KR', sans-serif; padding: 20px; color: #111; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 8px 10px; font-size: 13px; text-align: left; }
    th { background-color: #f9fafb; font-weight: bold; width: 130px; }
    .header { text-align: center; border-bottom: 2px solid #312e81; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; color: #1e1b4b; letter-spacing: 2px; }
    .section-title { font-size: 14px; font-weight: bold; border-left: 4px solid #312e81; padding-left: 8px; margin: 16px 0 8px 0; color: #312e81; }
    @media print {
      @page { margin: 10mm; }
    }
  </style>
</head>
<body>
  ${job.documentHtml || ''}
</body>
</html>`, 'utf8');

    console.log(`🖨️ [무인 다이렉트 출력 전송] 프린터: [${printerName}], 작업: ${job.id}`);
    const printCmd = `Start-Process rundll32.exe -ArgumentList 'mshtml.dll,PrintHTML "${tempPrintHtml}" "${printerName}"' -NoNewWindow`;
    execSync(`powershell -NoProfile -Command "${printCmd}"`, { stdio: 'ignore' });

    // 3. 완료 상태 업데이트
    await fetch(`${SUPABASE_REST_URL}/print_queue?id=eq.${encodeURIComponent(job.id)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        status: 'COMPLETED',
        printedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      signal: AbortSignal.timeout(4000)
    });

    console.log(`✅ [인쇄 완료 보고 완료] 작업: ${job.id}`);

    setTimeout(() => {
      try { if (fs.existsSync(tempPrintHtml)) fs.unlinkSync(tempPrintHtml); } catch (e) {}
    }, 15000);

  } catch (printErr) {
    console.error('❌ 인쇄 큐 작업 처리 중 오류:', printErr.message);
  } finally {
    isQueueProcessing = false;
  }
}

async function sendStationHeartbeat() {
  if (!activeStationConfig || !activeStationConfig.stationId) return;
  try {
    const stationId = encodeURIComponent(activeStationConfig.stationId);
    await fetch(`${SUPABASE_REST_URL}/print_stations?id=eq.${stationId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        status: 'ONLINE',
        lastHeartbeat: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      signal: AbortSignal.timeout(3000)
    });
  } catch (e) {}
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🟢 로컬 에이전트 서비스 리스닝 시작: http://127.0.0.1:${PORT}`);
  // 기동 즉시 백그라운드에서 CF 실시간 동적 미러링 실행 (1회)
  setTimeout(autoSyncFromCloudflare, 300);
  // 이후 1시간마다 백그라운드 자가 점검 (3600000 ms)
  setInterval(autoSyncFromCloudflare, 3600000);

  // 🖨️ 분산 인쇄 큐 워커 타이머 (3초 주기)
  setInterval(checkAndProcessPrintQueue, 3000);
  // 🖨️ 스테이션 하트비트 (30초 주기)
  setInterval(sendStationHeartbeat, 30000);
});


