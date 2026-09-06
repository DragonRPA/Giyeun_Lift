// supabase/functions/cleanup-expired-recordings/index.ts
// ============================================================
// Edge Function: 24시간 경과 음성 파일 자동 삭제
//
// Supabase Dashboard > Edge Functions > Cron 설정:
//   Schedule: 0 3 * * *  (매일 오전 3시)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // auto_delete_at이 지난 레코드 조회 (storage_path가 아직 있는 것만)
  const { data: expired, error } = await supabase
    .from('call_uploads')
    .select('id, storage_path, uploader_id')
    .lt('auto_delete_at', new Date().toISOString())
    .not('storage_path', 'is', null);

  if (error) {
    console.error('만료 레코드 조회 실패:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!expired || expired.length === 0) {
    return new Response(JSON.stringify({ deleted: 0, message: '삭제 대상 없음' }));
  }

  const paths = expired.map((r: { storage_path: string }) => r.storage_path).filter(Boolean);
  const ids   = expired.map((r: { id: string }) => r.id);

  // Storage에서 파일 삭제
  const { error: storageErr } = await supabase.storage
    .from('call-recordings')
    .remove(paths);

  if (storageErr) {
    console.error('Storage 삭제 실패:', storageErr.message);
  }

  // DB에서 storage_path null로 업데이트 (레코드는 유지 — 추적용)
  await supabase
    .from('call_uploads')
    .update({ storage_path: null })
    .in('id', ids);

  console.log(`음성 파일 ${paths.length}개 자동 삭제 완료`);

  return new Response(JSON.stringify({
    deleted: paths.length,
    ids,
  }), { headers: { 'Content-Type': 'application/json' } });
});
