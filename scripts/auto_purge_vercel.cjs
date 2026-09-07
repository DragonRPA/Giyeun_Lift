const { execSync } = require('child_process');

// 1. Error 상태 배포 슬롯 무조건 100% Purge 함수
function purgeErrorDeployments() {
  console.log('🔍 [Error-Clean] Vercel 내 Error(실패) 상태의 배포 슬롯 탐색 중...');
  try {
    const output = execSync('npx vercel list --status ERROR --limit 100', { encoding: 'utf-8' });
    const lines = output.split('\n');
    const errorUrls = [];

    for (const line of lines) {
      const match = line.match(/https:\/\/(giyeun|kiyuen)-lift-[a-z0-9]+(-[a-z0-9_\-]+)?\.vercel\.app/i) || line.match(/https:\/\/[a-z0-9_\-]+-[a-z0-9]+\.vercel\.app/i);
      if (match && !match[0].endsWith('//giyeun-lift.vercel.app') && !match[0].endsWith('//kiyuen-lift.vercel.app') && !errorUrls.includes(match[0])) {
        errorUrls.push(match[0]);
      }
    }

    if (errorUrls.length > 0) {
      console.log(`⚠️ 총 ${errorUrls.length}개의 Error 상태 실패 배포 슬롯 발견! 무조건 100% 자동 삭제(Purge)를 실행합니다.`);
      for (const errorUrl of errorUrls) {
        try {
          console.log(`🗑️ [Error 상태 삭제]: ${errorUrl}`);
          execSync(`npx vercel rm ${errorUrl} --yes`, { stdio: 'ignore' });
        } catch (err) {
          console.warn(`⚠️ Error 배포 삭제 실패: ${errorUrl}`);
        }
      }
      console.log(`✅ Error 상태 배포 슬롯 ${errorUrls.length}개 전량 청소 완료!`);
    } else {
      console.log('✅ Error 상태의 실패 배포 슬롯이 존재하지 않습니다.');
    }
  } catch (err) {
    console.warn('Error 배포 슬롯 탐색 중 오류 (무시):', err.message);
  }
}

// 2. Ready 정상 배포 슬롯 수색
function fetchAllVercelDeployments() {
  const allUrls = [];
  let nextToken = null;
  let pageCount = 0;

  while (pageCount < 30) {
    pageCount++;
    const cmd = nextToken 
      ? `npx vercel list --limit 100 --next ${nextToken}` 
      : `npx vercel list --limit 100`;

    let output = '';
    try {
      output = execSync(cmd, { encoding: 'utf-8' });
    } catch (err) {
      break;
    }

    const lines = output.split('\n');
    for (const line of lines) {
      // Error 행 제외하고 Ready 등 정상 라인만 수집
      if (line.includes('Error')) continue;
      const match = line.match(/https:\/\/(giyeun|kiyuen)-lift-[a-z0-9]+(-[a-z0-9_\-]+)?\.vercel\.app/i) || line.match(/https:\/\/[a-z0-9_\-]+-[a-z0-9]+\.vercel\.app/i);
      if (match && !match[0].endsWith('//giyeun-lift.vercel.app') && !match[0].endsWith('//kiyuen-lift.vercel.app') && !allUrls.includes(match[0])) {
        allUrls.push(match[0]);
      }
    }

    const nextMatch = output.match(/--next\s+([0-9a-zA-Z_\-]+)/);
    if (nextMatch && nextMatch[1]) {
      nextToken = nextMatch[1];
    } else {
      break;
    }
  }

  return allUrls;
}

// 3. Ready 정상 배포 슬롯 최근 maxKeepSlots(12개) 보존 실행
function purgeExcessDeployments(maxKeepSlots = 12) {
  // 선행: Error 배포 전량 100% 삭제
  purgeErrorDeployments();

  // 후행: Ready 정상 배포 수색 후 초과분 삭제
  const allUrls = fetchAllVercelDeployments();
  console.log(`📊 [Ready 정상 배포 수색] 총 ${allUrls.length}개 보존 대상 발견 (보존 기준: 최근 ${maxKeepSlots}개)`);

  if (allUrls.length > maxKeepSlots) {
    const toRemove = allUrls.slice(maxKeepSlots);
    console.log(`⚠️ 보존 한도(${maxKeepSlots}개) 초과! 오래된 정상 과거 배포 총 ${toRemove.length}개를 자동 물리 삭제(Purge)합니다.`);

    for (let i = 0; i < toRemove.length; i++) {
      const targetUrl = toRemove[i];
      try {
        console.log(`[${i + 1}/${toRemove.length}] 🗑️ 과거 정상 배포 슬롯 삭제: ${targetUrl}`);
        execSync(`npx vercel rm ${targetUrl} --yes`, { stdio: 'ignore' });
      } catch (err) {
        console.warn(`⚠️ 삭제 실패: ${targetUrl}`);
      }
    }

    console.log(`✅ [Purge 완결] Vercel 상에 Error 배포 0개 & Ready 정상 배포 최근 ${maxKeepSlots}개만 완벽 청정 보존되었습니다.`);
  } else {
    console.log(`✅ 현재 Vercel 배포 상태가 한도(Error 0개 & Ready ${maxKeepSlots}개 이하) 내에서 청정하게 관리되고 있습니다.`);
  }
}

purgeExcessDeployments(12);
