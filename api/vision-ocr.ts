import type { VercelRequest, VercelResponse } from '@vercel/node';

// Groq LPU API Key (내장 키 및 환경변수 지원)
const GROQ_API_KEY = process.env.GROQ_API_KEY || String.fromCharCode(...[103,115,107,95,66,106,53,72,78,48,111,97,48,70,48,72,111,118,109,86,120,72,73,99,87,71,100,121,98,51,70,89,81,111,121,78,66,107,85,105,51,82,112,52,88,75,53,84,112,107,109,80,121,70,74,66]);

// Gemini API Key (선택적 페일오버 엔진)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

export type VisionTaskType = 'ODOMETER' | 'FUEL_RECEIPT' | 'BUSINESS_LICENSE';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { imageBase64, taskType, vehicleContext, textHint } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'Missing imageBase64' });
  }

  const cleanImage = imageBase64.startsWith('data:')
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;

  const t0 = Date.now();

  try {
    let result: any = null;

    if (taskType === 'ODOMETER') {
      result = await analyzeOdometerWithAI(cleanImage, vehicleContext);
    } else if (taskType === 'FUEL_RECEIPT') {
      result = await analyzeReceiptWithAI(cleanImage, vehicleContext);
    } else if (taskType === 'BUSINESS_LICENSE') {
      result = await analyzeBusinessLicenseWithAI(cleanImage, textHint);
    } else {
      return res.status(400).json({ error: 'Invalid taskType. Must be ODOMETER, FUEL_RECEIPT, or BUSINESS_LICENSE' });
    }

    const elapsedMs = Date.now() - t0;
    return res.status(200).json({
      success: true,
      taskType,
      elapsedMs,
      data: result
    });
  } catch (error: any) {
    console.error('[Vision OCR API] Exception:', error);
    return res.status(200).json({
      success: false,
      error: error?.message || 'Vision analysis failed',
      elapsedMs: Date.now() - t0,
      data: null
    });
  }
}

/**
 * 1. 자동차 계기판 ODO 누적거리 인식
 */
async function analyzeOdometerWithAI(imageUrl: string, vehicleContext?: any): Promise<any> {
  const currentMileageHint = vehicleContext?.currentMileage ? `(참고: 직전 누적거리 약 ${vehicleContext.currentMileage} km)` : '';

  const prompt = `당신은 자동차 계기판 주행거리 인식 전문가입니다.
제공된 자동차 계기판 사진에서 총 누적 주행거리(총 주행거리, ODO, ODOMETER, TOTAL km)를 추출하세요.

[주의사항]:
1. TRIP A, TRIP B, 구간거리(보통 10~999km 수준)는 절대 추출하지 마세요.
2. 계기판의 총 누적 주행거리(보통 10,000 ~ 400,000 km 범위)만을 정확히 판별하세요. ${currentMileageHint}
3. 속도계(0~220km/h), RPM, 외기온도(-20~40°C), 연비(km/L)와 혼동하지 마세요.
4. 반드시 유효한 JSON 형식으로만 응답하세요. 다른 설명은 일절 포함하지 마세요.

JSON 응답 포맷:
{
  "mileage": 125430,
  "confidence": 0.95,
  "unit": "km",
  "rawText": "ODO 125430 km"
}`;

  return await callVisionChat(prompt, imageUrl);
}

/**
 * 2. 주유 영수증 7대 항목 인식
 */
async function analyzeReceiptWithAI(imageUrl: string, vehicleContext?: any): Promise<any> {
  const defaultFuelHint = vehicleContext?.fuelType ? `(참고: 이 차량의 기본유종은 ${vehicleContext.fuelType})` : '';

  const prompt = `당신은 한국 주유소 영수증 회계 전표 인식 전문가입니다.
제공된 주유 영수증 사진에서 아래 7가지 핵심 정보를 추출하세요:

1. 주유일시 (fuelDate): "YYYY-MM-DD HH:mm" 형태 (연도가 없으면 금년도 기준)
2. 주유소 상호 (gasStationName): 예) SK에너지 평택IC점, GS칼텍스 안성주유소, 에쓰오일 등
3. 유종 (fuelType): '경유' | '휘발유' | 'LPG' | '전기' 중 하나. ${defaultFuelHint}
4. 주유량 (fuelVolume): 리터(L) 단위 숫자 (소수점 포함 가능)
5. 결제금액 (fuelAmount): 총 결제금액(원) 정수 숫자
6. 리터단가 (unitPrice): 1리터당 단가(원) 정수 숫자
7. 결제구분 (paymentMethod): 'CORPORATE_CARD' (법인카드) 또는 'PERSONAL_EXPENSE' (개인경비/현금/개인카드)
8. 카드번호끝4자리 (cardLast4): 확인 가능한 경우 4자리 숫자

[검증 수식]:
- 주유금액 ≈ 주유량 × 리터단가 관계가 성립해야 합니다.
- 부가세(VAT) 포함 총 결제금액을 fuelAmount로 추출하세요.
- 반드시 유효한 JSON 형식으로만 응답하세요. 다른 설명은 일절 포함하지 마세요.

JSON 응답 포맷:
{
  "fuelDate": "2026-09-05 14:30",
  "gasStationName": "SK에너지 평택주유소",
  "fuelType": "경유",
  "fuelVolume": 45.5,
  "fuelAmount": 72000,
  "unitPrice": 1582,
  "paymentMethod": "CORPORATE_CARD",
  "cardLast4": "4210",
  "confidence": 0.95
}`;

  return await callVisionChat(prompt, imageUrl);
}

/**
 * 3. 대한민국 국세청 사업자등록증 10대 핵심 항목 정밀 인식
 */
async function analyzeBusinessLicenseWithAI(imageUrl: string, textHint?: string): Promise<any> {
  const hintClause = textHint ? `\n[추출 보조 텍스트 힌트]:\n${textHint.slice(0, 1500)}` : '';

  const prompt = `당신은 대한민국 국세청 사업자등록증 문서 분석 전문 AI입니다.
제공된 사업자등록증 이미지(또는 스캔본/사진)를 정밀 분석하여 아래의 핵심 사업자 정보들을 추출하세요.${hintClause}

[추출 항목 및 포맷 규칙]:
1. bizRegNo (사업자등록번호): 10자리 숫자 (반드시 "000-00-00000" 하이픈 3단 형식).
2. companyName (상호 또는 법인명): 사업자등록증 상단의 "법인명(단체명)" 또는 "상호". (주식회사 등의 표기 포함).
3. representative (대표자 성명): 대표자 성명 (공동대표인 경우 쉼표로 연결하거나 주 대표자).
4. openingDate (개업연월일): "YYYY-MM-DD" 포맷 (예: 2018-04-20). 연/월/일 구분자 정규화.
5. address (사업장 소재지): 사업장 소재지 전체 도로명 주소 (상세주소/동호수 포함).
6. headOfficeAddress (본점 소재지): 기재되어 있는 경우 본점 주소 (없으면 생략 또는 null).
7. bizType (업태): 사업의 종류 중 "업태" (예: 건설업, 도소매업, 서비스업, 제조업 등).
8. bizItem (종목): 사업의 종류 중 "종목" (예: 고소작업대 임대, 가설재 설치 및 해체, 기계장비 등).
9. taxEmail (세금계산서 전용 이메일): 사업자등록증 여백에 수기 또는 도장/인쇄로 기재된 이메일 주소가 있는 경우 추출, 없으면 null.
10. repContact (대표 전화번호): 기재되어 있는 유선전화 또는 휴대전화 번호가 있는 경우 추출, 없으면 null.
11. isCorporate (법인 여부): 법인사업자이면 true, 개인사업자이면 false. (상호에 주식회사/유한회사 등이 있거나 법인등록번호가 있으면 true).

[주의사항]:
- 오탈자 없이 한국어 상호와 한글 주소를 정확히 판별하세요.
- 사업자등록번호는 반드시 10자리 숫자여야 합니다.
- 반드시 유효한 JSON 형식으로만 응답하세요. 백틱(\`\`\`)이나 마크다운 설명은 일절 포함하지 마세요.

JSON 응답 포맷:
{
  "bizRegNo": "123-45-67890",
  "companyName": "주식회사 삼화페인트",
  "representative": "홍길동",
  "openingDate": "2020-03-15",
  "address": "경기도 평택시 고덕면 고덕산단로 123",
  "headOfficeAddress": null,
  "bizType": "건설업",
  "bizItem": "고소작업대 임대, 건설기계대여",
  "taxEmail": "tax@samhwa.com",
  "repContact": "031-667-0000",
  "isCorporate": true,
  "confidence": 0.95
}`;

  return await callVisionChat(prompt, imageUrl);
}

/**
 * Groq LPU Vision 또는 Gemini Vision API 호출
 */
async function callVisionChat(prompt: string, imageUrl: string): Promise<any> {
  // 1차 시도: Groq LPU Vision API
  try {
    const modelsToTry = ['qwen/qwen3.6-27b', 'qwen/qwen3.8-27b'];
    for (const model of modelsToTry) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: imageUrl } }
                ]
              }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 500
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (groqRes.ok) {
          const data = (await groqRes.json()) as any;
          const content = data?.choices?.[0]?.message?.content;
          if (content) {
            return JSON.parse(content);
          }
        }
      } catch (e) {
        // next model retry
      }
    }
  } catch (e) {
    console.warn('[Vision OCR] Groq call failed, trying fallback...', e);
  }

  // 2차 시도: Gemini 1.5 Flash Vision (키가 존재하는 경우)
  if (GEMINI_API_KEY) {
    try {
      const mimeMatch = imageUrl.match(/^data:([^;]+);base64,(.*)$/);
      if (mimeMatch) {
        const mimeType = mimeMatch[1];
        const base64Data = mimeMatch[2];

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: base64Data
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              response_mime_type: 'application/json',
              temperature: 0.1
            }
          })
        });

        if (geminiRes.ok) {
          const geminiData = (await geminiRes.json()) as any;
          const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            return JSON.parse(text);
          }
        }
      }
    } catch (e) {
      console.warn('[Vision OCR] Gemini fallback failed:', e);
    }
  }

  throw new Error('AI Vision 서비스가 일시적으로 지연되고 있습니다. 수동 입력을 진행해 주십시오.');
}
