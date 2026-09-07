// src/services/geminiGemsService.ts
// e-Bro ERP Google Gemini GEMS 기반 4대 업무서식(출고·회수·교환·AS) 자동완성·교차검증 AI 서비스

export type GemsWorkType = 'DISPATCH' | 'RETURN' | 'EXCHANGE' | 'FIELD_AS' | 'UNKNOWN';

export interface GemsMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: string;
  toolCall?: {
    name: 'submitDispatchOrder' | 'submitReturnOrder' | 'submitExchangeOrder' | 'submitFieldAsIntake';
    args: any;
  };
  toolResult?: {
    success: boolean;
    orderId?: string;
    message: string;
  };
}

export interface GemsContextData {
  customerNames: string[];
  siteNames: string[];
  rentedAssets: { assetNo: string; modelName: string; siteName: string; customerName: string }[];
  todayYmd: string;
  tomorrowYmd: string;
}

// 4대 표준 모델 규격
export const STANDARD_SPEC_MAP: Record<string, string> = {
  '19': '1930',
  '19피트': '1930',
  '19ft': '1930',
  '26': '2632',
  '26피트': '2632',
  '26ft': '2632',
  '32': '3246',
  '32피트': '3246',
  '32ft': '3246',
  '40': '4047',
  '40피트': '4047',
  '40ft': '4047',
  '46': '1412',
  '46피트': '1412',
  '46ft': '1412',
  '53': '1612',
  '53피트': '1612',
  '53ft': '1612',
};

/**
 * Gemini API Key 조회 헬퍼
 * 1. localStorage ('gemini_api_key')
 * 2. import.meta.env.VITE_GEMINI_API_KEY
 */
export function getGeminiApiKey(): string {
  try {
    const local = localStorage.getItem('gemini_api_key');
    if (local && local.trim()) return local.trim();
  } catch {
    // ignore
  }
  return (import.meta.env.VITE_GEMINI_API_KEY as string) || '';
}

export function setGeminiApiKey(key: string) {
  try {
    if (!key || !key.trim()) {
      localStorage.removeItem('gemini_api_key');
    } else {
      localStorage.setItem('gemini_api_key', key.trim());
    }
  } catch {
    // ignore
  }
}

/**
 * 시스템 프롬프트(System Instruction) 생성
 */
function buildSystemInstruction(context: GemsContextData): string {
  return `당신은 e-Bro 고소작업대 렌탈 ERP의 '렌탈 업무 의뢰 AI 비서 (e-Bro 젬스)'입니다.
영업사원이 현장에서 운전 중이거나 보행 중에 말하는 자연어 음성을 듣고, 4대 업무 서식을 지능적으로 교차 검증하여 완성하는 역할을 수행합니다.

### 🏛️ 전사 시스템 표준 헌장 준수 사항:
1. [헌장 1.1] 영업사원의 조작 노력을 최소화하고 건조하고 명확한 전문적인 어조(존댓말)로 응대합니다. 감성적이거나 불필요한 미사여구를 배제합니다.
2. [헌장 2.1] 영업사원은 요구/의뢰(규격 및 수량)만 접수합니다. 개별 출고 자산번호는 시스템/출고부서의 권한이므로 영업사원에게 묻지 않습니다.
3. [헌장 2.2] 대차/교체 발생 시 기존 계약의 단가/청구조건은 100% 자동 상속됩니다.
4. [헌장 2.3] 교환/대차 발생 시 반드시 단일 'EXCHANGE' 배차 1건으로 처리합니다.

### 📋 4대 지원 업무 서식:
1. 출고의뢰 (submitDispatchOrder): 신규 장비 렌탈 투입 의뢰.
   - 필수 확인: 고객사명, 현장명, 납품 희망일시, 장비 규격 및 대수.
2. 회수의뢰 (submitReturnOrder): 현장 가동 종료 장비 철수/반납 의뢰.
   - 필수 확인: 현장명, 회수 대상 자산번호, 반출 희망일시.
3. 교환의뢰 (submitExchangeOrder): 고장 또는 규격변경으로 인한 맞교환(대차).
   - 필수 확인: 현장명, 회수할 전자산 번호, 투입할 후장비 규격, 교환 일시, 교환 사유.
4. 현장AS (submitFieldAsIntake): 긴급 수리 접수.
   - 필수 확인: 고장 장비 자산번호, 구체적 고장 증상.

### 🔍 교차 검증 및 대화 규칙:
- 오늘 날짜는 ${context.todayYmd}, 내일은 ${context.tomorrowYmd}입니다.
- 필수 정보가 누락되었을 때는 함수를 바로 호출하지 말고, 누락된 항목을 간결하고 명확하게 질문하십시오. (예: "회수할 기존 장비의 자산번호를 말씀해주세요.")
- 모든 필수 정보가 채워지면 반드시 해당하는 함수(submitDispatchOrder / submitReturnOrder / submitExchangeOrder / submitFieldAsIntake)를 Function Call로 호출하십시오.
- 시간 언급이 없으면 기본값은 '오전 08:00'으로 간주합니다.
- 장비 규격: 19피트=1930, 26피트=2632, 32피트=3246, 40피트=4047, 46피트=1412, 53피트=1612.`;
}

/**
 * Gemini Function Declarations (Tools)
 */
const GEMS_TOOLS = [
  {
    function_declarations: [
      {
        name: 'submitDispatchOrder',
        description: '출고의뢰(신규 렌탈 장비 납품 요청)를 생성합니다. 거래처, 현장명, 납품일시, 장비규격 및 수량이 확정되었을 때 호출합니다.',
        parameters: {
          type: 'OBJECT',
          properties: {
            customerName: { type: 'STRING', description: '거래처/고객사 이름' },
            siteName: { type: 'STRING', description: '현장 이름' },
            siteAddress: { type: 'STRING', description: '현장 도로명/지번 주소 (모를 경우 생략)' },
            deliveryDate: { type: 'STRING', description: '납품 희망 일자 (YYYY-MM-DD)' },
            deliveryTime: { type: 'STRING', description: '납품 희망 시간 (HH:mm, 기본 08:00)' },
            equipments: {
              type: 'ARRAY',
              description: '요청 장비 목록',
              items: {
                type: 'OBJECT',
                properties: {
                  ft: { type: 'STRING', description: '작업 높이 (예: 19ft, 26ft, 32ft, 40ft, 46ft, 53ft)' },
                  modelName: { type: 'STRING', description: '모델명 (예: 1930, 2632, 3246, 4047)' },
                  count: { type: 'INTEGER', description: '요청 대수' }
                },
                required: ['ft', 'modelName', 'count']
              }
            },
            siteContactName: { type: 'STRING', description: '현장 담당자 이름' },
            siteContactPhone: { type: 'STRING', description: '현장 담당자 전화번호' },
            memo: { type: 'STRING', description: '보양작업/비마킹타이어/안전옵션/메모' }
          },
          required: ['customerName', 'siteName', 'deliveryDate', 'equipments']
        }
      },
      {
        name: 'submitReturnOrder',
        description: '회수의뢰(대여 장비 반납/철수)를 생성합니다. 현장명과 회수 대상 장비 자산번호가 확인되었을 때 호출합니다.',
        parameters: {
          type: 'OBJECT',
          properties: {
            customerName: { type: 'STRING', description: '고객사명' },
            siteName: { type: 'STRING', description: '현장명' },
            targetAssetNos: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: '회수할 장비의 자산번호 목록 (예: ["1930-08", "3246-12"])'
            },
            returnDate: { type: 'STRING', description: '반출 희망 일자 (YYYY-MM-DD)' },
            returnTime: { type: 'STRING', description: '반출 희망 시간 (HH:mm)' },
            siteContactName: { type: 'STRING', description: '반출 담당자' },
            siteContactPhone: { type: 'STRING', description: '반출 담당자 연락처' },
            reason: { type: 'STRING', description: '회수 사유' }
          },
          required: ['siteName', 'targetAssetNos', 'returnDate']
        }
      },
      {
        name: 'submitExchangeOrder',
        description: '교환/대차의뢰(현장 장비 맞교환)를 단일 EXCHANGE 배차 1건으로 생성합니다. 회수할 전자산과 투입할 후장비 규격이 확인되었을 때 호출합니다.',
        parameters: {
          type: 'OBJECT',
          properties: {
            customerName: { type: 'STRING', description: '고객사명' },
            siteName: { type: 'STRING', description: '현장명' },
            oldAssetNo: { type: 'STRING', description: '회수할 전자산 번호 (예: 2632-05)' },
            newEquipmentModel: { type: 'STRING', description: '신규 투입할 장비 모델명 (예: 2632, 3246)' },
            newEquipmentFt: { type: 'STRING', description: '신규 투입 장비 높이 (예: 26ft)' },
            exchangeDate: { type: 'STRING', description: '교환 희망 일자 (YYYY-MM-DD)' },
            exchangeTime: { type: 'STRING', description: '교환 희망 시간 (HH:mm)' },
            reason: { type: 'STRING', description: '교환 사유 (예: 고장 대차, 규격 상향 등)' },
            siteContactName: { type: 'STRING', description: '현장 담당자' },
            siteContactPhone: { type: 'STRING', description: '현장 담당자 연락처' },
            memo: { type: 'STRING', description: '특이사항' }
          },
          required: ['siteName', 'oldAssetNo', 'newEquipmentModel', 'exchangeDate']
        }
      },
      {
        name: 'submitFieldAsIntake',
        description: '현장 AS 긴급 수리 접수를 생성합니다. 장비번호와 고장 증상이 확인되었을 때 호출합니다.',
        parameters: {
          type: 'OBJECT',
          properties: {
            assetNo: { type: 'STRING', description: '고장 장비 자산번호' },
            symptom: { type: 'STRING', description: '고장 증상 및 상황' },
            siteName: { type: 'STRING', description: '현장 위치' },
            priority: { type: 'STRING', enum: ['NORMAL', 'URGENT'], description: '긴급도' },
            reporterContact: { type: 'STRING', description: '신고자 연락처' }
          },
          required: ['assetNo', 'symptom']
        }
      }
    ]
  }
];

/**
 * 🌟 로컬 스마트 규칙 기반 파서 (API 키 미설정 또는 오프라인 시 자동 폴백)
 */
export function parseGemsLocally(userText: string, context: GemsContextData): {
  textResponse: string;
  toolCall?: { name: any; args: any };
  isComplete: boolean;
} {
  const text = userText.trim();
  const lower = text.toLowerCase();

  // 1. 교환/대차 감지
  if (lower.includes('교환') || lower.includes('대차') || lower.includes('바꿔') || lower.includes('맞교환')) {
    const assetMatch = text.match(/([0-9]{4}[-_][0-9]{1,4}|[0-9]{4}호기)/i);
    let targetModel = '';
    let targetFt = '';
    for (const [key, val] of Object.entries(STANDARD_SPEC_MAP)) {
      if (text.includes(key)) {
        targetModel = val;
        targetFt = key.includes('ft') || key.includes('피트') ? key : `${key}ft`;
        break;
      }
    }

    if (!assetMatch) {
      return {
        textResponse: '교환(대차) 의뢰를 접수합니다. 현장에서 회수할 기존 장비의 자산번호(예: 2632-05)를 말씀해주세요.',
        isComplete: false
      };
    }

    const oldAssetNo = assetMatch[0].replace('호기', '');
    const siteMatch = context.siteNames.find(s => text.includes(s)) || '현장';
    const custMatch = context.customerNames.find(c => text.includes(c)) || '고객사';

    return {
      textResponse: `[교환의뢰 완결] 회수 장비: ${oldAssetNo} ➔ 투입 장비: ${targetModel || '동급'}으로 교환의뢰를 생성했습니다.`,
      toolCall: {
        name: 'submitExchangeOrder',
        args: {
          customerName: custMatch,
          siteName: siteMatch,
          oldAssetNo,
          newEquipmentModel: targetModel || '2632',
          newEquipmentFt: targetFt || '26ft',
          exchangeDate: context.tomorrowYmd,
          exchangeTime: '08:00',
          reason: '현장 요청 맞교환'
        }
      },
      isComplete: true
    };
  }

  // 2. 회수 감지
  if (lower.includes('회수') || lower.includes('반납') || lower.includes('빼') || lower.includes('철수')) {
    const assetMatch = text.match(/([0-9]{4}[-_][0-9]{1,4}|[0-9]{4}호기)/i);
    const siteMatch = context.siteNames.find(s => text.includes(s)) || '현장';
    if (!assetMatch) {
      return {
        textResponse: '회수의뢰를 접수합니다. 회수할 장비의 자산번호(예: 1930-08)를 말씀해주세요.',
        isComplete: false
      };
    }
    const assetNo = assetMatch[0].replace('호기', '');
    return {
      textResponse: `[회수의뢰 완결] ${siteMatch} 현장의 ${assetNo} 장비 회수의뢰를 접수했습니다.`,
      toolCall: {
        name: 'submitReturnOrder',
        args: {
          siteName: siteMatch,
          targetAssetNos: [assetNo],
          returnDate: context.tomorrowYmd,
          returnTime: '17:00',
          reason: '공사 완료 회수'
        }
      },
      isComplete: true
    };
  }

  // 3. 출고 감지 (기본)
  let foundModel = '1930';
  let foundFt = '19ft';
  let foundCount = 1;

  for (const [key, val] of Object.entries(STANDARD_SPEC_MAP)) {
    if (text.includes(key)) {
      foundModel = val;
      foundFt = key.includes('ft') || key.includes('피트') ? key : `${key}ft`;
      break;
    }
  }

  const countMatch = text.match(/([0-9]{1,2})\s*대/);
  if (countMatch) {
    foundCount = parseInt(countMatch[1], 10) || 1;
  } else if (text.includes('두 대') || text.includes('두대')) {
    foundCount = 2;
  } else if (text.includes('세 대') || text.includes('세대')) {
    foundCount = 3;
  } else if (text.includes('네 대') || text.includes('네대')) {
    foundCount = 4;
  } else if (text.includes('한 대') || text.includes('한대')) {
    foundCount = 1;
  }

  const siteMatch = context.siteNames.find(s => text.includes(s)) || '현장';
  const custMatch = context.customerNames.find(c => text.includes(c)) || '고객사';
  const phoneMatch = text.match(/010[- ]?[0-9]{4}[- ]?[0-9]{4}/);

  return {
    textResponse: `[출고의뢰 인식] ${custMatch} ${siteMatch} 현장, ${foundFt} (${foundModel}) ${foundCount}대 출고의뢰를 인식했습니다.`,
    toolCall: {
      name: 'submitDispatchOrder',
      args: {
        customerName: custMatch,
        siteName: siteMatch,
        deliveryDate: context.tomorrowYmd,
        deliveryTime: '08:00',
        equipments: [{ ft: foundFt, modelName: foundModel, count: foundCount }],
        siteContactPhone: phoneMatch ? phoneMatch[0].replace(/ /g, '-') : '',
        memo: text
      }
    },
    isComplete: true
  };
}

/**
 * Gemini GEMS 대화 실행 메인 파이프라인
 */
export async function sendGemsMessage(
  history: GemsMessage[],
  userPrompt: string,
  context: GemsContextData
): Promise<{
  textResponse: string;
  toolCall?: { name: any; args: any };
  isComplete: boolean;
}> {
  const apiKey = getGeminiApiKey();

  // API 키가 없으면 로컬 스마트 룰 파서로 자동 폴백 (무중단 작동)
  if (!apiKey) {
    console.log('ℹ️ Gemini API 키 미설정 ➔ 로컬 스마트 렌탈 파서 모드로 자동 실행합니다.');
    return parseGemsLocally(userPrompt, context);
  }

  try {
    const systemInstruction = buildSystemInstruction(context);

    // 대화 히스토리 포맷팅
    const contents = history
      .filter(m => m.role === 'user' || m.role === 'model')
      .map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

    // 현재 사용자 발화 추가
    contents.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemInstruction }]
        },
        contents,
        tools: GEMS_TOOLS,
        tool_config: {
          function_calling_config: {
            mode: 'AUTO'
          }
        },
        generationConfig: {
          temperature: 0.1, // 정밀한 서식 파싱을 위한 낮은 temperature
          maxOutputTokens: 1000
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('Gemini API 응답 오류, 로컬 파서로 폴백:', res.status, errText);
      return parseGemsLocally(userPrompt, context);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0]?.content;
    const parts = candidate?.parts || [];

    let textResponse = '';
    let toolCall: { name: any; args: any } | undefined;

    for (const part of parts) {
      if (part.text) {
        textResponse += part.text;
      }
      if (part.functionCall) {
        toolCall = {
          name: part.functionCall.name,
          args: part.functionCall.args
        };
      }
    }

    return {
      textResponse: textResponse.trim() || (toolCall ? '의뢰 서식을 완성했습니다.' : '말씀하신 내용을 처리 중입니다.'),
      toolCall,
      isComplete: Boolean(toolCall)
    };
  } catch (err: any) {
    console.warn('Gemini API 통신 실패, 로컬 파서로 안전 폴백:', err.message);
    return parseGemsLocally(userPrompt, context);
  }
}
