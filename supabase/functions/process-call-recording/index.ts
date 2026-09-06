// supabase/functions/process-call-recording/index.ts
// ============================================================
// Edge Function: 통화 파일 STT + LLM 필드 추출
//
// 환경변수 (Supabase Dashboard > Settings > Edge Functions > Secrets):
//   GROQ_API_KEY    : Groq API 키
//   SUPABASE_URL    : 자동 주입
//   SUPABASE_SERVICE_ROLE_KEY : 자동 주입
//
// 트리거: call_uploads INSERT 시 Database Webhook으로 호출
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const STT_MODEL = 'whisper-large-v3-turbo';
const LLM_MODEL = 'llama-3.3-70b-versatile';

const CONTEXT_LABELS: Record<string, string> = {
  NEW_CUSTOMER:    '신규고객 출고',
  ADDITIONAL:      '기존고객 추가출고',
  EXCHANGE:        '교체(대차)요청',
  RETURN:          '회수요청',
  FIELD_AS:        '현장 AS 요청',
  TRANSPORT_NEGO:  '운송사 배차 협의',
  SUBLEASE_NEGO:   '전대 임차 협의',
};

// ─── 메인 핸들러 ────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const groqApiKey = Deno.env.get('GROQ_API_KEY')!;

  let callUploadId: string;
  try {
    const body = await req.json();
    // Database Webhook payload: body.record
    callUploadId = body.record?.id ?? body.id;
    if (!callUploadId) throw new Error('call_upload id 없음');
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 400 });
  }

  // 1. call_uploads 레코드 조회
  const { data: upload, error: fetchErr } = await supabase
    .from('call_uploads')
    .select('*')
    .eq('id', callUploadId)
    .single();

  if (fetchErr || !upload) {
    return new Response(JSON.stringify({ error: '레코드 없음' }), { status: 404 });
  }

  // 처리 중 상태로 변경
  await supabase.from('call_uploads')
    .update({ status: 'PROCESSING' })
    .eq('id', callUploadId);

  try {
    // 2. Supabase Storage에서 오디오 파일 다운로드
    let transcript = '';
    if (upload.storage_path) {
      const { data: fileData, error: dlErr } = await supabase.storage
        .from('call-recordings')
        .download(upload.storage_path);

      if (dlErr || !fileData) {
        throw new Error(`파일 다운로드 실패: ${dlErr?.message}`);
      }

      // 3. Groq Whisper STT 호출
      const formData = new FormData();
      formData.append('file', fileData, upload.file_name ?? 'audio.m4a');
      formData.append('model', STT_MODEL);
      formData.append('language', 'ko');
      formData.append('response_format', 'text');
      // 업무 전문 어휘 힌트 (인식률 향상)
      formData.append('prompt', '고소작업대 붐리프트 시저리프트 렌탈 출고 배차 현장 반납 대차 상차 하차');

      const sttRes = await fetch(`${GROQ_API_BASE}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqApiKey}` },
        body: formData,
      });

      if (!sttRes.ok) {
        const errText = await sttRes.text();
        throw new Error(`Groq STT 실패: ${errText}`);
      }
      transcript = await sttRes.text();
    }

    // 4. LLM 필드 추출
    const contextLabels = (upload.call_context ?? [])
      .map((c: string) => CONTEXT_LABELS[c] ?? c)
      .join(', ');

    const systemPrompt = `당신은 한국 고소작업대 렌탈 회사의 업무 담당자입니다.
영업 통화 내용에서 업무 필드를 정확히 추출하세요.
반드시 JSON만 출력하고 다른 텍스트는 절대 포함하지 마세요.
확실하지 않으면 confidence를 MISSING 또는 LOW로 표시하세요.`;

    const userPrompt = `맥락: ${contextLabels || '미지정'}

통화 전사:
---
${transcript || '(음성 인식 없음)'}
---
${upload.summary_text ? `\n전화 요약:\n${upload.summary_text}\n` : ''}

아래 JSON 형식으로 추출하세요:
{
  "customerName": { "value": "", "confidence": "HIGH|MEDIUM|LOW|MISSING", "source": "STT|SUMMARY|MISSING" },
  "siteName":     { "value": "", "confidence": "HIGH|MEDIUM|LOW|MISSING", "source": "STT|SUMMARY|MISSING" },
  "equipments":   [{ "modelName": "", "qty": 1 }],
  "loadingDate":  { "value": "YYYY-MM-DD or ''", "confidence": "HIGH|MEDIUM|LOW|MISSING" },
  "loadingTime":  { "value": "HH:MM or ''", "confidence": "HIGH|MEDIUM|LOW|MISSING" },
  "contactPerson":{ "value": "", "confidence": "HIGH|MEDIUM|LOW|MISSING" },
  "contactPhone": { "value": "", "confidence": "HIGH|MEDIUM|LOW|MISSING" },
  "note":         "",
  "isNewCustomer": false
}`;

    const llmRes = await fetch(`${GROQ_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      throw new Error(`Groq LLM 실패: ${errText}`);
    }

    const llmData = await llmRes.json();
    const extracted = JSON.parse(llmData.choices[0].message.content);

    // 5. 교차 검증: STT + summary 모두 있으면 신뢰도 HIGH 상향
    if (transcript && upload.summary_text) {
      const upgradeConf = (field: { value: string; confidence: string }) => {
        if (field.confidence === 'MEDIUM' && field.value) {
          field.confidence = 'HIGH';
          field.source = 'DB'; // 교차 검증 완료
        }
        return field;
      };
      ['customerName', 'siteName', 'loadingDate', 'loadingTime'].forEach(key => {
        if (extracted[key]) extracted[key] = upgradeConf(extracted[key]);
      });
    }

    // 6. 출고일 기준 긴급도 계산
    let urgency = 'LOW';
    if (extracted.loadingDate?.value) {
      const daysUntil = Math.ceil(
        (new Date(extracted.loadingDate.value).getTime() - Date.now()) / 86400000
      );
      if (daysUntil <= 1) urgency = 'HIGH';
      else if (daysUntil <= 3) urgency = 'MEDIUM';
    }

    // 7. draft_dispatch_orders INSERT
    const { data: draft, error: insertErr } = await supabase
      .from('draft_dispatch_orders')
      .insert({
        owner_id:           upload.uploader_id,
        source_call_ids:    [callUploadId],
        context:            upload.call_context ?? [],

        customer_name:      extracted.customerName?.value ?? null,
        customer_name_conf: extracted.customerName?.confidence ?? 'MISSING',
        customer_name_src:  extracted.customerName?.source ?? 'STT',

        site_name:          extracted.siteName?.value ?? null,
        site_name_conf:     extracted.siteName?.confidence ?? 'MISSING',

        equipment_json:     extracted.equipments ?? [],

        loading_date:       extracted.loadingDate?.value || null,
        loading_date_conf:  extracted.loadingDate?.confidence ?? 'MISSING',
        loading_time:       extracted.loadingTime?.value || null,
        loading_time_conf:  extracted.loadingTime?.confidence ?? 'MISSING',

        contact_person:     extracted.contactPerson?.value ?? null,
        contact_person_conf:extracted.contactPerson?.confidence ?? 'MISSING',
        contact_phone:      extracted.contactPhone?.value ?? null,
        note:               extracted.note ?? null,

        is_new_customer:    extracted.isNewCustomer ?? false,
        urgency,
        status:             'DRAFT',
      })
      .select()
      .single();

    if (insertErr) throw new Error(`초안 저장 실패: ${insertErr.message}`);

    // 8. call_uploads 상태 업데이트
    await supabase.from('call_uploads')
      .update({ status: 'PROCESSED', processed_at: new Date().toISOString(), draft_id: draft.id })
      .eq('id', callUploadId);

    return new Response(JSON.stringify({ success: true, draftId: draft.id }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    // STT/LLM 실패: 빈 초안 생성 (수동 입력 폴백)
    console.error('처리 오류:', err);

    const { data: emptyDraft } = await supabase
      .from('draft_dispatch_orders')
      .insert({
        owner_id:        upload.uploader_id,
        source_call_ids: [callUploadId],
        context:         upload.call_context ?? [],
        status:          'DRAFT',
        urgency:         'LOW',
        // 모든 필드 MISSING — 수동 입력 필요
      })
      .select()
      .single();

    await supabase.from('call_uploads')
      .update({
        status:        'FAILED',
        error_message: String(err),
        retry_count:   (upload.retry_count ?? 0) + 1,
        draft_id:      emptyDraft?.id ?? null,
      })
      .eq('id', callUploadId);

    return new Response(JSON.stringify({
      success: false,
      fallback: true,
      draftId: emptyDraft?.id,
      error: String(err),
    }), { status: 200 }); // 200 반환 (빈 초안은 생성됨)
  }
});
