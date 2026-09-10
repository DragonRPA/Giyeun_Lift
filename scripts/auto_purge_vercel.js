import { execSync } from 'child_process';

export function autoPurgeVercelDeployments(maxSlots = 12) {
  try {
    console.log('🔍 [Auto-Purge] Vercel 배포 슬롯 개수 자동 점검 중...');
    const output = execSync('npx.cmd vercel list', { encoding: 'utf-8' });
    
    // Vercel deployment URLs 추출
    const lines = output.split('\n');
    const urls = [];
    for (const line of lines) {
      const match = line.match(/https:\/\/(giyeun|kiyuen)-lift-[a-z0-9]+(-[a-z0-9_\-]+)?\.vercel\.app/i) || line.match(/https:\/\/[a-z0-9_\-]+-[a-z0-9]+\.vercel\.app/i);
      if (match && !match[0].endsWith('//giyeun-lift.vercel.app') && !match[0].endsWith('//kiyuen-lift.vercel.app') && !urls.includes(match[0])) {
        urls.push(match[0]);
      }
    }

    console.log(`📊 현재 Vercel 총 배포 슬롯 개수: ${urls.length}개 (최대 허용: ${maxSlots}개)`);

    if (urls.length > maxSlots) {
      const excessCount = urls.length - maxSlots;
      console.log(`⚠️ 허용 한도(${maxSlots}개)를 ${excessCount}개 초과하여 오래된 배포 슬롯 자동 삭제를 집행합니다.`);
      
      // 최신 maxSlots개는 보존하고, 오래된 슬롯(array 뒤쪽)부터 삭제
      const toRemove = urls.slice(maxSlots);
      for (const targetUrl of toRemove) {
        try {
          console.log(`🗑️ 자동 Purge 실행: ${targetUrl}`);
          execSync(`npx.cmd vercel rm ${targetUrl} --yes`, { stdio: 'inherit' });
        } catch (err) {
          console.warn(`Purge 경고: ${targetUrl} 삭제 실패 - ${err.message}`);
        }
      }
      console.log(`✅ Vercel ${maxSlots}개 슬롯 유지 자동 Purge 완료!`);
    } else {
      console.log(`✅ 현재 배포 슬롯(${urls.length}개)이 한도(${maxSlots}개 이하) 내에서 안전하게 관리되고 있습니다.`);
    }
  } catch (err) {
    console.warn('Auto-Purge 점검 중 오류 (무시하고 진행):', err.message);
  }
}

autoPurgeVercelDeployments(12);
