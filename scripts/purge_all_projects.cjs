/**
 * purge_all_projects.cjs
 * Vercel 전체 프로젝트 배포 슬롯 대대적 정리
 * - giyuen-lift: 최근 5개만 보존
 * - space-consult-assist: 최근 3개만 보존
 * - homepage: 최근 3개만 보존
 */
const { execSync } = require("child_process");

function listDeployments(project) {
  try {
    const out = execSync(`cmd /c "npx vercel list ${project} --limit 100"`, { encoding: "utf-8" });
    const urls = [];
    for (const line of out.split("\n")) {
      const m = line.match(/https:\/\/[a-z0-9\-]+-[a-z0-9]+\.vercel\.app/i);
      if (m && !line.includes("Error")) {
        const url = m[0];
        // 도메인 URL(프로덕션 alias) 제외
        if (!url.includes(`${project}.vercel.app`) && !urls.includes(url)) {
          urls.push(url);
        }
      }
    }
    return urls;
  } catch (e) {
    console.warn(`  [WARN] ${project} 목록 조회 실패:`, e.message.split("\n")[0]);
    return [];
  }
}

function purgeProject(project, keepCount) {
  console.log(`\n🔍 [${project}] 배포 목록 조회 중...`);
  const urls = listDeployments(project);
  console.log(`  총 ${urls.length}개 발견 (${keepCount}개 보존 예정)`);
  
  if (urls.length <= keepCount) {
    console.log(`  ✅ 한도 이내 - 삭제 불필요`);
    return 0;
  }
  
  const toRemove = urls.slice(keepCount);
  console.log(`  🗑️ ${toRemove.length}개 삭제 시작...`);
  
  let deleted = 0;
  for (const url of toRemove) {
    try {
      execSync(`cmd /c "npx vercel rm ${url} --yes"`, { stdio: "ignore" });
      console.log(`    ✅ 삭제: ${url}`);
      deleted++;
    } catch (e) {
      console.warn(`    ❌ 실패: ${url}`);
    }
  }
  return deleted;
}

console.log("🚀 Vercel 전체 프로젝트 대대적 스토리지 정리 시작\n");
const r1 = purgeProject("giyuen-lift", 5);
const r2 = purgeProject("space-consult-assist", 3);
const r3 = purgeProject("homepage", 3);
console.log(`\n✅ 완료: giyuen-lift ${r1}개 / space-consult-assist ${r2}개 / homepage ${r3}개 삭제`);
