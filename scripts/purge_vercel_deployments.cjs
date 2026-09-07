const { execSync } = require('child_process');

function purgeOldDeployments() {
  try {
    const raw = execSync('npx.cmd vercel list', { encoding: 'utf8' });
    const lines = raw.split('\n');
    const urls = [];
    
    lines.forEach(l => {
      const match = l.match(/(https:\/\/(giyeun|kiyuen)-lift-[a-z0-9]+-dragonrpa\.vercel\.app)/);
      if (match) {
        if (!urls.includes(match[1])) {
          urls.push(match[1]);
        }
      }
    });

    console.log(`현재 감지된 Vercel 배포 슬롯 수: ${urls.length}개`);
    // 최대 12개 유지, 초과분 삭제
    if (urls.length > 12) {
      const toRemove = urls.slice(12);
      console.log(`🧹 초과된 오래된 배포 슬롯 ${toRemove.length}개 자동 삭제(Purge) 시작...`);
      for (const u of toRemove) {
        try {
          console.log(`- 삭제 중: ${u}`);
          execSync(`npx.cmd vercel remove ${u} --yes`, { encoding: 'utf8' });
          console.log(`  ✓ 삭제 완료`);
        } catch (e) {
          console.log(`  ⚠️ 삭제 실패: ${e.message}`);
        }
      }
    } else {
      console.log('✓ 배포 슬롯 개수 정상 범위 (12개 이하)');
    }
  } catch (err) {
    console.error('배포 목록 조회 실패:', err.message);
  }
}

purgeOldDeployments();
