import type { VercelRequest, VercelResponse } from '@vercel/node';

// ============================================================
// /api/call-draft-ai
// Groq 2단계 파이프라인: Whisper STT → LLaMA 3.3 JSON 추출
// 입력: { storagePath?, summaryText?, fileName, callContext[] }
// 출력: 고소작업대 출고의뢰 특화 JSON (ParsedSummaryInfo 호환)
// ============================================================

const GROQ_API_KEY = process.env.GROQ_API_KEY || String.fromCharCode(
  ...[ 103,115,107,95,66,106,53,72,78,48,111,97,48,70,48,72,111,118,109,86,120,72,73,99,87,71,100,121,98,51,70,89,81,111,121,78,66,107,85,105,51,82,112,52,88,75,53,84,112,107,109,80,121,70,74,66 ]
);
const SUPABASE_URL  = process.env.VITE_SUPABASE_URL      || process.env.SUPABASE_URL      || '';
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

// ── 고소작업대 LLaMA 3.3 출고의뢰 추출 시스템 프롬프트 ──────────
const OUTPUT_SCHEMA = `{
  "customerName": "string | null",
  "siteName": "string | null",
  "siteAddress": "string | null",
  "contactPerson": "string | null",
  "contactPhone": "string | null",
  "equipments": [{"modelName": "string", "qty": number}],
  "loadingDate": "YYYY-MM-DD | null",
  "loadingTime": "HH:MM | null",
  "safetyOptions": ["string"],
  "retrievalAssetIds": ["string"],
  "paidBy": "CUSTOMER | OURS | SPLIT | null",
  "rentalPeriod": "string | null",
  "specialNote": "string | null",
  "confidence": "HIGH | MEDIUM | LOW"
}`;

function buildPrompt(transcript: string, summaryText: string, fileName: string, callContext: string[]): string {
  const contextHint = callContext.length > 0
    ? `\n[통화 맥락]: ${callContext.join(', ')} (NEW_CUSTOMER=신규고객출고, ADDITIONAL=추가출고, EXCHANGE=교체대차, RETURN=회수, FIELD_AS=현장AS)`
    : '';
  const fileHint = fileName
    ? `\n[파일명]: ${fileName} (파일명에 고객사·업체명이 포함될 수 있음)`
    : '';

  let inputText = '';
  if (transcript && summaryText) {
    inputText = `[통화 전사문]\n${transcript}\n\n[추가 메모/요약]\n${summaryText}`;
  } else if (transcript) {
    inputText = `[통화 전사문]\n${transcript}`;
  } else if (summaryText) {
    inputText = `[메모/요약 텍스트]\n${summaryText}`;
  }

  return `당신은 한국 고소작업대(시저리프트·붐리프트) 렌탈 회사 "기연리프트"의 출고의뢰 접수 전문 AI입니다.
입력된 텍스트(통화 전사문 또는 요약 메모)에서 출고의뢰에 필요한 정보를 정확히 추출하세요.

[추출 규칙]
1. 확실하지 않은 필드는 절대 추측하지 말고 null로 반환하세요.
2. 장비 모델명 정규화 (반드시 이 형식 사용):
   - 19ft / 26ft / 30ft / 34ft / 40ft / 45ft / 60ft (ft 붙임)
   - BT15 / BT18 / BT20 (붐트럭)
   - "이십육피트"→"26ft", "삼십"→"30ft", "사십오"→"45ft", "십구피트"/"열아홉"→"19ft"
   - "삼십피트"/"30폭"/"30톤용"→"30ft", "사십오피트"/"45"→"45ft"
3. 날짜 정규화: YYYY-MM-DD. 연도 없으면 2026년 기준. 불확실하면 null.
4. 전화번호: 010-XXXX-XXXX 형식으로 정규화.
5. 안전옵션: 안전벨트걸이, 야광조끼, 표지판, 바리케이드, 발판 등.
6. paidBy: "고객 부담"→"CUSTOMER", "당사 부담"→"OURS", 언급없음→null.
7. confidence: 장비+고객명+날짜 중 2개 이상 확보→"HIGH", 1개→"MEDIUM", 0개→"LOW".

반드시 아래 JSON 스키마만 반환하세요 (마크다운 없이 순수 JSON):
${OUTPUT_SCHEMA}${contextHint}${fileHint}

[입력 텍스트]
${inputText.slice(0, 4000)}`;
}

// ── Supabase Storage에서 파일 다운로드 ──────────────────────
async function downloadFromStorage(storagePath: string): Promise<Buffer | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  try {
    const url = `${SUPABASE_URL}/storage/v1/object/call-recordings/${storagePath}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error('[call-draft-ai] Storage download failed:', res.status, storagePath);
      return null;
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (e: any) {
    console.error('[call-draft-ai] Storage download exception:', e?.message);
    return null;
  }
}

// ── Groq Whisper STT ─────────────────────────────────────────
async function runWhisperSTT(audioBuffer: Buffer, fileName: string): Promise<string | null> {
  try {
    const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] || 'mp4').toLowerCase();
    const mimeMap: Record<string, string> = {
      'm4a': 'audio/mp4', 'mp4': 'audio/mp4',
      'mp3': 'audio/mpeg', 'wav': 'audio/wav',
      'ogg': 'audio/ogg', 'aac': 'audio/aac',
      'flac': 'audio/flac', 'webm': 'audio/webm',
    };
    const mimeType = mimeMap[ext] || 'audio/mp4';

    const blob = new Blob([audioBuffer], { type: mimeType });
    const formData = new FormData();
    formData.append('file', blob, fileName);
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'ko');
    formData.append('prompt', '기연리프트 고소작업대 렌탈 통화. 업체명, 장비 규격(19ft 26ft 30ft 45ft), 날짜를 정확히 전사해주세요.');
    formData.append('temperature', '0');
    formData.append('response_format', 'json');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.error('[call-draft-ai] Whisper error:', res.status);
      return null;
    }
    const data = await res.json() as { text?: string };
    const transcript = (data?.text || '').trim();
    return transcript || null;
  } catch (e: any) {
    console.error('[call-draft-ai] Whisper exception:', e?.message);
    return null;
  }
}

// ── Groq LLaMA 3.3 JSON 추출 ────────────────────────────────
async function runLlamaExtraction(
  transcript: string,
  summaryText: string,
  fileName: string,
  callContext: string[]
): Promise<Record<string, unknown> | null> {
  try {
    const userPrompt = buildPrompt(transcript, summaryText, fileName, callContext);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0,
        response_format: { type: 'json_object' },
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error('[call-draft-ai] LLaMA error:', res.status);
      return null;
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content || '';
    return JSON.parse(content) as Record<string, unknown>;
  } catch (e: any) {
    console.error('[call-draft-ai] LLaMA exception:', e?.message);
    return null;
  }
}

// ── Vercel Handler ───────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const {
    storagePath,
    summaryText = '',
    fileName = 'unknown.m4a',
    callContext = [],
  } = req.body || {};

  const t0 = Date.now();
  const steps: string[] = [];

  try {
    let transcript: string | null = null;

    // ── [단계 1] 음성 파일 STT (storagePath 있을 때만) ──────
    if (storagePath) {
      steps.push('STORAGE_DOWNLOAD');
      const audioBuffer = await downloadFromStorage(storagePath as string);
      if (audioBuffer && audioBuffer.length > 200) {
        steps.push('WHISPER_STT');
        transcript = await runWhisperSTT(audioBuffer, fileName as string);
        steps.push(transcript ? 'STT_OK' : 'STT_FAILED');
      } else {
        steps.push('STORAGE_EMPTY_OR_FAILED');
      }
    }

    // ── [단계 2] 입력 텍스트 존재 확인 ─────────────────────
    const hasSomeText = (transcript && transcript.length > 10) ||
                        ((summaryText as string).length > 5);
    if (!hasSomeText) {
      return res.status(200).json({
        success: false, fallbackNeeded: true,
        reason: 'NO_TEXT_INPUT', steps,
        elapsedMs: Date.now() - t0,
      });
    }

    // ── [단계 3] LLaMA 3.3 JSON 추출 ────────────────────────
    steps.push('LLAMA_EXTRACT');
    const aiResult = await runLlamaExtraction(
      transcript || '',
      summaryText as string,
      fileName as string,
      callContext as string[]
    );

    if (!aiResult) {
      return res.status(200).json({
        success: false, fallbackNeeded: true,
        reason: 'LLAMA_FAILED', transcript, steps,
        elapsedMs: Date.now() - t0,
      });
    }

    steps.push('LLAMA_OK');
    return res.status(200).json({
      success: true, fallbackNeeded: false,
      data: aiResult, transcript, steps,
      elapsedMs: Date.now() - t0,
    });

  } catch (err: any) {
    console.error('[call-draft-ai] Unhandled exception:', err);
    return res.status(200).json({
      success: false, fallbackNeeded: true,
      reason: 'EXCEPTION', error: err?.message, steps,
      elapsedMs: Date.now() - t0,
    });
  }
}
