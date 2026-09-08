// src/services/voiceOrderDraftService.ts
import { Customer, CustomerSite, Asset, Delivery } from './db';
import { matchHangul, extractChosung, decomposeComplexConsonants } from '../utils/hangulSearch';

export interface EquipmentOrderItem {
  ft: string;
  modelName: string;
  count: number;
}

export interface VoiceOrderDraft {
  customerId: string;
  customerName: string;
  siteId: string;
  siteName: string;
  newSiteName: string;
  siteAddress: string;
  siteContactName: string;
  siteContactPhone: string;
  siteContactEmail?: string;
  deliveryDate: string;
  deliveryTime: string;
  orders: EquipmentOrderItem[];
  memo: string;
  // 전체 출고의뢰 구조 확장 필드 (8대 도메인)
  paidOptions?: string;          // 유상옵션 (철망, 함석, 에어배관 등)
  protection?: string;           // 보양작업 (바닥보양, 휠보양 등)
  checkedSpecs?: Record<string, boolean>; // 요구 사양 체크
  saveOptionsToSite?: boolean;   // 변경된 옵션을 현장 기본값으로 저장할지 여부 (1회성: false)
  billableToCustomer?: boolean;  // 운송비 청구 (고객부담: true, 당사부담: false)
  closingDay?: string;           // 마감일 (말일, 20일, 25일 등)
  paymentDay?: string;           // 결제일 (익월 25일, 말일 등)
  taxBillEmail?: string;         // 세금계산서 메일
  vehicleType?: string;          // 배차 차종 (5톤 렉카, 셀프로더 등)
  isAsap?: boolean;              // 긴급 최우선 배차
  snippets: { text: string; timestamp: string }[];
  updatedAt: string;
}

export const DRAFT_STORAGE_KEY = 'giyeun_sales_dispatch_draft';

const KOREAN_COUNT_MAP: Record<string, number> = {
  '한': 1, '일': 1, '하나': 1, '1': 1,
  '두': 2, '이': 2, '둘': 2, '2': 2,
  '세': 3, '삼': 3, '셋': 3, '3': 3,
  '네': 4, '사': 4, '넷': 4, '4': 4,
  '다섯': 5, '오': 5, '5': 5,
  '여섯': 6, '육': 6, '6': 6,
  '일곱': 7, '칠': 7, '7': 7,
  '여덟': 8, '팔': 8, '8': 8,
  '아홉': 9, '구': 9, '9': 9,
  '열': 10, '십': 10, '10': 10
};

// 빈 기본 임시저장 객체 생성
export function createEmptyDraft(): VoiceOrderDraft {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    customerId: '',
    customerName: '',
    siteId: '',
    siteName: '',
    newSiteName: '',
    siteAddress: '',
    siteContactName: '',
    siteContactPhone: '',
    siteContactEmail: '',
    deliveryDate: tomorrow.toISOString().split('T')[0],
    deliveryTime: '08:00',
    orders: [{ ft: '19ft', modelName: 'GS-1930', count: 1 }],
    memo: '',
    paidOptions: '',
    protection: '',
    checkedSpecs: {},
    billableToCustomer: false,
    closingDay: '',
    paymentDay: '',
    taxBillEmail: '',
    vehicleType: '5톤 렉카',
    isAsap: false,
    snippets: [],
    updatedAt: new Date().toISOString()
  };
}

// 로컬스토리지에서 불러오기
export function loadVoiceOrderDraft(): VoiceOrderDraft | null {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.orders) || parsed.orders.length === 0) {
      return null;
    }
    return parsed;
  } catch (e) {
    console.error('Failed to load voice order draft:', e);
    return null;
  }
}

// 로컬스토리지에 저장
export function saveVoiceOrderDraft(draft: VoiceOrderDraft): void {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
      ...draft,
      updatedAt: new Date().toISOString()
    }));
  } catch (e) {
    console.error('Failed to save voice order draft:', e);
  }
}

// 로컬스토리지 초기화
export function clearVoiceOrderDraft(): void {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear voice order draft:', e);
  }
}

// 음성 조각 증분 병합 (Incremental Merge Parser)
export function mergeVoiceFragmentToDraft(
  currentDraft: VoiceOrderDraft,
  speechText: string,
  customers: Customer[],
  sites: CustomerSite[]
): { updatedDraft: VoiceOrderDraft; modifiedFields: string[] } {
  const updated: VoiceOrderDraft = {
    ...currentDraft,
    orders: [...currentDraft.orders],
    snippets: [...(currentDraft.snippets || [])]
  };

  const modifiedFields: string[] = [];
  const cleanText = speechText.trim();
  if (!cleanText) {
    return { updatedDraft: updated, modifiedFields };
  }

  // 발화 이력 기록
  const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  updated.snippets.push({ text: cleanText, timestamp: timeStr });
  if (updated.snippets.length > 20) {
    updated.snippets = updated.snippets.slice(-20);
  }

  // 1. 전화번호 추출 (010-XXXX-XXXX 또는 010XXXXXXXX)
  const phoneMatch = cleanText.match(/010[-.\s]?\d{3,4}[-.\s]?\d{4}/);
  if (phoneMatch) {
    const rawPhone = phoneMatch[0].replace(/[-.\s]/g, '');
    if (rawPhone.length === 11) {
      const formatted = `${rawPhone.slice(0, 3)}-${rawPhone.slice(3, 7)}-${rawPhone.slice(7)}`;
      updated.siteContactPhone = formatted;
      modifiedFields.push(`연락처: ${formatted}`);
    }
  }

  // 2. 담당자 이름 추출 (예: "김반장", "홍길동 소장", "담당자 이철수")
  const titleMatch = cleanText.match(/([가-힣]{1,4}\s*(?:소장님?|반장님?|과장님?|부장님?|팀장님?))/);
  const explicitMatch = cleanText.match(/(?:담당자|이름은?)\s*([가-힣]{2,4})/);
  if (titleMatch && titleMatch[0]) {
    const candidate = titleMatch[0].trim().replace(/님$/, '');
    if (!['현대', '삼성', '대우', '포스코', '내일', '모레', '아침', '오전', '오후'].some(w => candidate.startsWith(w))) {
      updated.siteContactName = candidate;
      modifiedFields.push(`담당자: ${candidate}`);
    }
  } else if (explicitMatch && explicitMatch[1]) {
    const name = explicitMatch[1].trim();
    if (!['현대', '삼성', '대우', '포스코', '내일', '모레', '아침', '오전', '오후'].includes(name)) {
      updated.siteContactName = name;
      modifiedFields.push(`담당자: ${name}`);
    }
  }

  // 3. 날짜 추출 (내일, 모레, 오늘, X월 X일, X일)
  const now = new Date();
  if (cleanText.includes('내일')) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    updated.deliveryDate = d.toISOString().split('T')[0];
    modifiedFields.push(`납품일: 내일(${updated.deliveryDate})`);
  } else if (cleanText.includes('모레') || cleanText.includes('내일모레')) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    updated.deliveryDate = d.toISOString().split('T')[0];
    modifiedFields.push(`납품일: 모레(${updated.deliveryDate})`);
  } else if (cleanText.includes('오늘') || cleanText.includes('당일')) {
    updated.deliveryDate = now.toISOString().split('T')[0];
    modifiedFields.push(`납품일: 오늘(${updated.deliveryDate})`);
  } else {
    const dateMatch = cleanText.match(/(?:(\d{1,2})월\s*)?(\d{1,2})일/);
    if (dateMatch) {
      const month = dateMatch[1] ? parseInt(dateMatch[1], 10) : now.getMonth() + 1;
      const day = parseInt(dateMatch[2], 10);
      const year = now.getFullYear();
      const targetDate = new Date(year, month - 1, day);
      if (targetDate < now && !dateMatch[1]) {
        targetDate.setMonth(targetDate.getMonth() + 1);
      }
      const ymd = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
      updated.deliveryDate = ymd;
      modifiedFields.push(`납품일: ${ymd}`);
    }
  }

  // 4. 시간 추출 (아침 8시, 오전 7시, 오후 2시, 07:00, 14:00 등)
  const timeMatch = cleanText.match(/(아침|새벽|오전|오후|낮|저녁)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?/);
  if (timeMatch) {
    const ampm = timeMatch[1] || '';
    let hour = parseInt(timeMatch[2], 10);
    const minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    if ((ampm === '오후' || ampm === '저녁' || ampm === '낮') && hour < 12) {
      hour += 12;
    }
    const timeFormatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    updated.deliveryTime = timeFormatted;
    modifiedFields.push(`납품시간: ${timeFormatted}`);
  }

  // 5. 장비 모델 및 수량 추출
  const detectedOrders: EquipmentOrderItem[] = [];
  const modelRegex = /(1930|2632|2646|3219|3226|3246|4047|4626|4632|0812|0808|1012|0608|1412|1612|19피트|26피트|32피트|40피트|46피트|53피트|19ft|26ft|32ft|40ft|46ft|53ft)/gi;
  
  let match;
  const matches: { key: string; index: number }[] = [];
  while ((match = modelRegex.exec(cleanText)) !== null) {
    matches.push({ key: match[0], index: match.index });
  }

  if (matches.length > 0) {
    matches.forEach(m => {
      const rawKey = m.key.toUpperCase();
      let ft = '19ft';
      let model = 'GS-1930';

      // 1) 지식 매트릭스에서 모델번호/별칭 검색
      const specMatch = EQUIPMENT_SPEC_MATRIX.find(item =>
        item.modelName.toUpperCase().includes(rawKey) ||
        item.modelNumberAliases.some(alias => alias.toUpperCase() === rawKey)
      );

      if (specMatch) {
        ft = specMatch.ft;
        model = specMatch.modelName;
      } else if (rawKey.includes('19')) { ft = '19ft'; model = 'GS-1930'; }
      else if (rawKey.includes('26')) { ft = '26ft'; model = 'GS-2632'; }
      else if (rawKey.includes('32')) { ft = '32ft'; model = 'GS-3246'; }
      else if (rawKey.includes('40')) { ft = '40ft'; model = 'GS-4047'; }
      else if (rawKey.includes('46') || rawKey.includes('1412')) { ft = '46ft'; model = 'GTJZ1412'; }
      else if (rawKey.includes('53') || rawKey.includes('1612')) { ft = '53ft'; model = 'GTJZ1612'; }

      // 모델명 앞뒤 15글자 내에서 제조사 및 차폭 보정
      const pre = cleanText.substring(Math.max(0, m.index - 15), m.index);
      const sub = cleanText.substring(m.index, m.index + 25);

      if (/스카이잭|스카이|skyjack/i.test(pre)) {
        if (ft === '19ft') model = 'SJ-3219';
        else if (ft === '26ft') model = 'SJ-3226';
        else if (ft === '32ft') model = 'SJ-4632';
      } else if (/시노붐|시노|sinoboom/i.test(pre)) {
        if (ft === '26ft') model = 'GTJZ0812';
        else if (ft === '32ft') model = 'GTJZ1012';
      }

      if (/광폭|와이드/i.test(sub) && ft === '26ft' && !model.includes('4626') && !model.includes('0812')) {
        model = 'GS-2646';
      }

      // 모델명 뒤 25글자 내에서 수량 탐색
      const countMatch = sub.match(/(\d+)\s*대/) || 
                         sub.match(/(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*대/);
      
      let count = 1;
      if (countMatch) {
        const rawNum = countMatch[1];
        if (KOREAN_COUNT_MAP[rawNum]) {
          count = KOREAN_COUNT_MAP[rawNum];
        } else if (!isNaN(parseInt(rawNum, 10))) {
          count = Math.max(1, parseInt(rawNum, 10));
        }
      }

      detectedOrders.push({ ft, modelName: model, count });
    });

    if (detectedOrders.length > 0) {
      updated.orders = detectedOrders;
      modifiedFields.push(`장비: ${detectedOrders.map(o => `${o.modelName}(${o.count}대)`).join(', ')}`);
    }
  }

  // 6. 거래처 매칭
  let matchedCustomer: Customer | null = null;
  for (const c of customers) {
    const simpleName = c.name.replace(/주식회사|\(주\)|\s/g, '');
    if (simpleName.length >= 2 && cleanText.replace(/\s/g, '').includes(simpleName)) {
      matchedCustomer = c;
      break;
    }
  }

  if (matchedCustomer) {
    updated.customerId = matchedCustomer.id;
    updated.customerName = matchedCustomer.name;
    modifiedFields.push(`고객사: ${matchedCustomer.name}`);
  }

  // 7. 현장 매칭
  let matchedSite: CustomerSite | null = null;
  const sitePool = matchedCustomer 
    ? sites.filter(s => s.customerId === matchedCustomer!.id)
    : sites;

  const siteWordMatch = cleanText.match(/([가-힣A-Za-z0-9]{2,10})\s*(?:현장|신축|공사|캠퍼스|밸리|호텔|타워)/);
  const siteKeyword = siteWordMatch ? siteWordMatch[1].replace(/\s/g, '') : '';

  for (const s of sitePool) {
    const simpleSite = s.name.replace(/\s/g, '');
    const isDirectMatch = simpleSite.length >= 2 && cleanText.replace(/\s/g, '').includes(simpleSite);
    const isKeywordMatch = siteKeyword.length >= 2 && simpleSite.includes(siteKeyword);
    if (isDirectMatch || isKeywordMatch) {
      matchedSite = s;
      break;
    }
  }

  if (matchedSite) {
    updated.siteId = matchedSite.id;
    updated.siteName = matchedSite.name;
    if (matchedSite.address && matchedSite.address !== '미상') {
      updated.siteAddress = matchedSite.address;
    }
    if (matchedSite.contactName && matchedSite.contactName !== '미상' && !updated.siteContactName) {
      updated.siteContactName = matchedSite.contactName;
    }
    if (matchedSite.contact && matchedSite.contact !== '미상' && !updated.siteContactPhone) {
      updated.siteContactPhone = matchedSite.contact;
    }
    modifiedFields.push(`현장: ${matchedSite.name}`);
  } else {
    const siteKeywordMatch = cleanText.match(/([가-힣0-9A-Za-z\s]+?)\s*(?:현장|신축|공사|플랜트|호텔)/);
    if (siteKeywordMatch && siteKeywordMatch[1] && !updated.siteName) {
      const candidate = `${siteKeywordMatch[1].trim()} 현장`;
      if (candidate.length >= 3 && candidate.length <= 25) {
        updated.siteId = 'NEW';
        updated.siteName = candidate;
        updated.newSiteName = candidate;
        modifiedFields.push(`신규현장: ${candidate}`);
      }
    }
  }

  // 8. 도로명/지번 주소 추출 (신규 현장용)
  const addressMatch = cleanText.match(/((?:서울|경기|인천|강원|충북|충남|전북|전남|경북|경남|제주|세종|부산|대구|광주|대전|울산)[가-힣A-Za-z0-9\s]+(?:로|길|동|리|읍|면)\s*[\d-]+(?:\s*번지)?)/);
  if (addressMatch && addressMatch[1]) {
    const parsedAddr = addressMatch[1].trim();
    if (parsedAddr.length >= 6 && (!updated.siteAddress || updated.siteId === 'NEW')) {
      updated.siteAddress = parsedAddr;
      modifiedFields.push(`현장주소: ${parsedAddr}`);
    }
  }

  // 9. 유상옵션 및 보양작업 파싱
  const optResult = parseOptionsAndSpecsVoiceInput(cleanText);
  if (optResult.paidOptions) {
    updated.paidOptions = updated.paidOptions 
      ? Array.from(new Set([...updated.paidOptions.split(', '), ...optResult.paidOptions.split(', ')])).join(', ')
      : optResult.paidOptions;
    modifiedFields.push(`유상옵션: ${optResult.paidOptions}`);
  }
  if (optResult.protection) {
    updated.protection = updated.protection 
      ? Array.from(new Set([...updated.protection.split(', '), ...optResult.protection.split(', ')])).join(', ')
      : optResult.protection;
    modifiedFields.push(`보양: ${optResult.protection}`);
  }
  if (Object.keys(optResult.checkedSpecs).length > 0) {
    updated.checkedSpecs = {
      ...(updated.checkedSpecs || {}),
      ...optResult.checkedSpecs
    };
    modifiedFields.push(`요구사양(${Object.keys(optResult.checkedSpecs).length}종) 체크`);
  }

  // 10. 물류 운송비 부담 & 마감조건 파싱
  const logiResult = parseLogisticsAndBillingVoiceInput(cleanText);
  if (logiResult.billableToCustomer !== undefined) {
    updated.billableToCustomer = logiResult.billableToCustomer;
    modifiedFields.push(logiResult.billableToCustomer ? '운송비: 고객부담(청구)' : '운송비: 당사부담');
  }
  if (logiResult.closingDay) {
    updated.closingDay = logiResult.closingDay;
    modifiedFields.push(`마감일: ${logiResult.closingDay}`);
  }
  if (logiResult.paymentDay) {
    updated.paymentDay = logiResult.paymentDay;
    modifiedFields.push(`결제일: ${logiResult.paymentDay}`);
  }
  if (logiResult.vehicleType) {
    updated.vehicleType = logiResult.vehicleType;
    modifiedFields.push(`차종: ${logiResult.vehicleType}`);
  }

  // 11. 특이사항/메모
  const memoKeywords = ['칼국수', '숏바리', '배터리', '도색', '안전점검', '크레인', '지게차', '신차', '높이제한', '지하', '램프', '진입로'];
  const matchedMemoWords = memoKeywords.filter(k => cleanText.includes(k));
  if (matchedMemoWords.length > 0 || logiResult.specialMemo) {
    const combinedMemo = [
      matchedMemoWords.length > 0 ? `[현장특이사항] ${matchedMemoWords.join(', ')}` : '',
      logiResult.specialMemo || ''
    ].filter(Boolean).join(' | ');

    if (combinedMemo && !updated.memo.includes(combinedMemo)) {
      updated.memo = updated.memo ? `${updated.memo} | ${combinedMemo}` : combinedMemo;
      modifiedFields.push(`메모: ${combinedMemo}`);
    }
  }

  // 변경 발생 시 저장
  saveVoiceOrderDraft(updated);

  return { updatedDraft: updated, modifiedFields };
}

// ─────────────────────────────────────────────────────────────
// 🛡️ 유상옵션, 보양작업, 요구사양 음성 파서
// ─────────────────────────────────────────────────────────────
export interface ParsedOptionsSpecsResult {
  paidOptions: string;
  protection: string;
  checkedSpecs: Record<string, boolean>;
  modifiedFields: string[];
}

export function parseOptionsAndSpecsVoiceInput(text: string): ParsedOptionsSpecsResult {
  const clean = text.trim();
  const lower = clean.toLowerCase();
  const paidOpts: string[] = [];
  const protections: string[] = [];
  const checkedSpecs: Record<string, boolean> = {};
  const modifiedFields: string[] = [];

  // 1. 유상옵션: 철망 / 함석 설치 면수 감지 (1면~5면, 사면 등)
  const wireMeshMatch = clean.match(/(\d+|사|삼|이|일)\s*면\s*(철망|함석|망)/i) || clean.match(/(철망|함석|망)\s*(\d+|사|삼|이|일)\s*면/i);
  if (wireMeshMatch) {
    const rawSide = wireMeshMatch[1] && isNaN(Number(wireMeshMatch[1])) ? wireMeshMatch[1] : (wireMeshMatch[1] || wireMeshMatch[2]);
    let sideNum = rawSide;
    if (rawSide === '사') sideNum = '4';
    else if (rawSide === '삼') sideNum = '3';
    else if (rawSide === '이') sideNum = '2';
    else if (rawSide === '일') sideNum = '1';
    
    const mat = clean.includes('함석') ? '함석' : '철망';
    const optDesc = `${sideNum}면 ${mat} 설치`;
    paidOpts.push(optDesc);
    checkedSpecs['spec1'] = true;
    modifiedFields.push(optDesc);
  } else if (/사면철망|4면\s*철망/i.test(clean)) {
    paidOpts.push('4면 철망 설치');
    checkedSpecs['spec1'] = true;
    modifiedFields.push('4면 철망 설치');
  } else if (/철망|함석/i.test(clean)) {
    const mat = clean.includes('함석') ? '함석' : '철망';
    paidOpts.push(`${mat} 설치`);
    checkedSpecs['spec1'] = true;
    modifiedFields.push(`${mat} 설치`);
  }

  // 확장대 철망 / 함석
  if (/확장대\s*(?:철망|함석)/i.test(clean)) {
    const mat = clean.includes('함석') ? '함석' : '철망';
    paidOpts.push(`확장대 ${mat} 설치`);
    checkedSpecs['spec2'] = true;
    modifiedFields.push(`확장대 ${mat} 설치`);
  }

  // 기타 유상옵션
  if (/에어배관|에어\s*호스/i.test(clean)) {
    paidOpts.push('에어배관 설치');
    modifiedFields.push('에어배관 설치');
  }
  if (/발전기/i.test(clean)) {
    paidOpts.push('소형 발전기 탑재');
    modifiedFields.push('소형 발전기 탑재');
  }

  // 2. 보양작업 감지
  if (/바닥보양|바닥\s*보양|부직포|플라베니아/i.test(clean)) {
    protections.push('바닥 보양(부직포/플라베니아)');
    modifiedFields.push('바닥 보양');
  }
  if (/타이어보양|타이어\s*보양|바퀴보양|휠보양|휠커버|화이트타이어/i.test(clean)) {
    protections.push('타이어 휠커버 보양');
    checkedSpecs['spec14'] = true;
    modifiedFields.push('타이어/휠 보양');
  }
  if (/사다리\s*보양|탑승구\s*사다리|사다리/i.test(clean)) {
    protections.push('탑승구 사다리 보양');
    checkedSpecs['spec11'] = true;
    modifiedFields.push('탑승구 사다리 보양');
  }
  if (/모서리\s*보양|모서리\s*랩핑|난간\s*랩핑|난간\s*보양|미끄럼방지|랩핑/i.test(clean)) {
    protections.push('모서리 및 난간 랩핑 보양');
    checkedSpecs['spec12'] = true;
    modifiedFields.push('모서리/난간 랩핑');
  }

  // 3. 요구 사양 키워드 매핑
  if (/감지봉|방지봉|협착\s*방지|협착\s*센서|상단감지|상부\s*협착/i.test(clean)) {
    checkedSpecs['spec3'] = true;
    paidOpts.push('상단 협착감지봉(4EA)');
    modifiedFields.push('협착감지봉(4EA)');
  }
  if (/원판|원판설치/i.test(clean)) {
    checkedSpecs['spec4'] = true;
    modifiedFields.push('원판 설치');
  }
  if (/소화기|소화기함/i.test(clean)) {
    checkedSpecs['spec13'] = true;
    modifiedFields.push('소화기함 설치');
  }
  if (/경광등|점멸등|비상정지/i.test(clean)) {
    checkedSpecs['spec15'] = true;
    checkedSpecs['spec19'] = true;
    modifiedFields.push('경광등/비상정지장치');
  }
  if (/인증서|보험증권|체크리스트|안전서류/i.test(clean)) {
    checkedSpecs['spec21'] = true;
    modifiedFields.push('안전인증서/보험증권 서류세트');
  }

  return {
    paidOptions: paidOpts.join(', '),
    protection: protections.join(', '),
    checkedSpecs,
    modifiedFields
  };
}

// ─────────────────────────────────────────────────────────────
// 🚚 운송비 부담주체, 배차 차종 및 청구 마감조건 음성 파서
// ─────────────────────────────────────────────────────────────
export interface ParsedLogisticsBillingResult {
  billableToCustomer?: boolean;
  vehicleType?: string;
  closingDay?: string;
  paymentDay?: string;
  specialMemo?: string;
  modifiedFields: string[];
}

export function parseLogisticsAndBillingVoiceInput(text: string): ParsedLogisticsBillingResult {
  const clean = text.trim();
  const modifiedFields: string[] = [];
  let billableToCustomer: boolean | undefined = undefined;
  let vehicleType: string | undefined = undefined;
  let closingDay: string | undefined = undefined;
  let paymentDay: string | undefined = undefined;
  let specialMemo: string | undefined = undefined;

  // 1. 운송비 부담 주체
  if (/(?:운송비|운반비|운임)(?:[는이가을를도])?\s*(?:고객사?|업체|현장|거래처)?\s*(?:청구|부담|착불|돌리고|별도|추가)/i.test(clean) ||
      /(?:고객사?|업체|현장)(?:[는이가을를도])?\s*(?:운송비|운반비|운임)\s*(?:부담|청구)/i.test(clean) ||
      /착불/i.test(clean)) {
    billableToCustomer = true;
    modifiedFields.push('운송비: 고객부담(청구)');
  } else if (/(?:운송비|운반비|운임)(?:[는이가을를도])?\s*(?:당사|우리|자사)?\s*(?:부담|포함|무료|지원|선불)/i.test(clean) ||
             /(?:당사|우리|자사)(?:[는이가을를도])?\s*(?:운송비|운반비|운임)\s*(?:부담|포함)/i.test(clean) ||
             /선불|당사부담/i.test(clean)) {
    billableToCustomer = false;
    modifiedFields.push('운송비: 당사부담');
  }

  // 2. 배차 차종
  if (/셀프로더|세이프티|셀프카/i.test(clean)) {
    vehicleType = '셀프로더';
    modifiedFields.push('차종: 셀프로더');
  } else if (/5톤\s*렉카|렉카/i.test(clean)) {
    vehicleType = '5톤 렉카';
    modifiedFields.push('차종: 5톤 렉카');
  } else if (/축차|11톤|25톤/i.test(clean)) {
    vehicleType = '대형 축차';
    modifiedFields.push('차종: 대형 축차');
  }

  // 3. 마감일 (말일, 20일, 25일 등)
  const closingMatch = clean.match(/(\d+|말일|월말)\s*일?\s*(?:마감|청구)/i);
  if (closingMatch) {
    closingDay = closingMatch[1].includes('말') ? '말일' : `${closingMatch[1]}일`;
    modifiedFields.push(`마감일: ${closingDay}`);
  }

  // 4. 결제일 (익월 25일, 말일, 익익월 등)
  const paymentMatch = clean.match(/(익월|다음달)?\s*(\d+|말일|월말)\s*일?\s*(?:결제|입금|지급)/i);
  if (paymentMatch) {
    const prefix = paymentMatch[1] || '익월';
    const day = paymentMatch[2].includes('말') ? '말일' : `${paymentMatch[2]}일`;
    paymentDay = `${prefix} ${day}`;
    modifiedFields.push(`결제일: ${paymentDay}`);
  }

  // 5. 특이사항 메모 (지게차 하차, 지하 진입 제한 등)
  const memoList: string[] = [];
  if (/지게차\s*하차|지게차\s*필요/i.test(clean)) memoList.push('지게차 하차 필수');
  if (/지하\s*(\d+)층/i.test(clean)) {
    const floor = clean.match(/지하\s*(\d+)층/)![1];
    memoList.push(`지하 ${floor}층 진입`);
  }
  if (/높이제한\s*([\d\.]+)m?/i.test(clean)) {
    const height = clean.match(/높이제한\s*([\d\.]+)m?/)![1];
    memoList.push(`높이제한 ${height}m`);
  }
  if (/진입로\s*협소|좁은\s*골목/i.test(clean)) memoList.push('진입로 협소 주의');
  if (/사전연락|미리\s*연락/i.test(clean)) memoList.push('도착 30분 전 사전연락 필수');

  if (memoList.length > 0) {
    specialMemo = memoList.join(', ');
  }

  return {
    billableToCustomer,
    vehicleType,
    closingDay,
    paymentDay,
    specialMemo,
    modifiedFields
  };
}


// ─────────────────────────────────────────────────────────────
// 🔧 2. 현장 AS 접수 통화 텍스트 파서 (Field AS Intake Parser)
// ─────────────────────────────────────────────────────────────
export interface AsCallParseResult {
  customerName: string;
  siteName: string;
  siteAddress?: string;
  assetNo: string;
  reporterName: string;
  reporterContact: string;
  issueCategory: string;
  issueDescription: string;
  priority: 'NORMAL' | 'URGENT';
  locationDetail: string;
  modifiedFields: string[];
}

export function parseAsCallTranscript(
  speechText: string,
  customers: Customer[],
  sites: CustomerSite[],
  assets: Asset[]
): AsCallParseResult {
  const cleanText = speechText.trim();
  const modifiedFields: string[] = [];

  let customerName = '';
  let siteName = '';
  let siteAddress = '';
  let assetNo = '';
  let reporterName = '';
  let reporterContact = '';
  let issueCategory = '기타';
  let issueDescription = cleanText;
  let priority: 'NORMAL' | 'URGENT' = 'NORMAL';
  let locationDetail = '';

  // 0. 본문 내 도로명/지번 주소 정규식 추출
  const addrMatch = cleanText.match(/(?:[가-힣]+(?:시|도)\s+)?[가-힣]+(?:시|군|구)\s+[가-힣0-9\s]+(?:로|길|번길)\s*\d+(?:-\d+)?/);
  if (addrMatch) {
    siteAddress = addrMatch[0].trim();
    modifiedFields.push(`도로명주소: ${siteAddress}`);
  }

  // 1. 긴급도 판별
  if (/급해|당장|중단|작업\s*못해|사고|위험|빨리/i.test(cleanText)) {
    priority = 'URGENT';
    modifiedFields.push('우선순위: 긴급(URGENT)');
  }

  // 2. 카테고리 매핑
  if (/상승|하강|올라|내려|리프트/i.test(cleanText)) {
    issueCategory = '상하강불량';
  } else if (/충전|전원|배터리|방전|시동|차단기/i.test(cleanText)) {
    issueCategory = '충전/전원';
  } else if (/오일|누유|기름|유압/i.test(cleanText)) {
    issueCategory = '오일누유';
  } else if (/키|스위치|비상정지|레버|조이스틱/i.test(cleanText)) {
    issueCategory = '키박스/스위치';
  } else if (/에러|경고등|삐|부저|코드/i.test(cleanText)) {
    issueCategory = '에러코드';
  } else if (/협착|방지봉|안전바/i.test(cleanText)) {
    issueCategory = '방지봉/협착';
  } else if (/파이프|걸림|끼임/i.test(cleanText)) {
    issueCategory = '파이프걸림';
  } else if (/점검|확인/i.test(cleanText)) {
    issueCategory = '점검요청';
  }
  if (issueCategory !== '기타') {
    modifiedFields.push(`증상분류: ${issueCategory}`);
  }

  // 3. 장비 번호 추출 (예: 102호기, 102호, 205호, 1930 등)
  const assetMatch = cleanText.match(/(\d{2,4})\s*호기?/) ||
                     cleanText.match(/(?:장비|번호|관리번호)\s*([0-9A-Za-z]{2,8})/);
  if (assetMatch) {
    const rawNo = assetMatch[1].trim();
    // 실제 assets 목록에서 해당 번호로 시작하거나 일치하는 자산 탐색
    const matchedAsset = assets.find(a => a.assetNo.includes(rawNo) || rawNo.includes(a.assetNo));
    assetNo = matchedAsset ? matchedAsset.assetNo : rawNo;
    modifiedFields.push(`장비번호: ${assetNo}`);
  }

  // 4. 전화번호 추출
  const phoneMatch = cleanText.match(/010[-.\s]?\d{3,4}[-.\s]?\d{4}/);
  if (phoneMatch) {
    const raw = phoneMatch[0].replace(/[-.\s]/g, '');
    if (raw.length === 11) {
      reporterContact = `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
      modifiedFields.push(`연락처: ${reporterContact}`);
    }
  }

  // 5. 담당자명 추출
  const nameMatch = cleanText.match(/([가-힣]{1,4}\s*(?:소장님?|반장님?|과장님?|부장님?|팀장님?))/);
  const explicitMatch = cleanText.match(/(?:담당자|이름은?)\s*([가-힣]{2,4})/);
  if (nameMatch) {
    reporterName = nameMatch[0].trim().replace(/님$/, '');
    modifiedFields.push(`담당자: ${reporterName}`);
  } else if (explicitMatch) {
    reporterName = explicitMatch[1].trim();
    modifiedFields.push(`담당자: ${reporterName}`);
  }

  // 6. 거래처 및 현장 탐색
  for (const c of customers) {
    const sName = c.name.replace(/주식회사|\(주\)|\s/g, '');
    if (sName.length >= 2 && cleanText.replace(/\s/g, '').includes(sName)) {
      customerName = c.name;
      modifiedFields.push(`고객사: ${c.name}`);
      break;
    }
  }

  const siteWordMatch = cleanText.match(/([가-힣A-Za-z0-9]{2,10})\s*(?:현장|신축|공사|캠퍼스|밸리|호텔|타워)/);
  const siteKeyword = siteWordMatch ? siteWordMatch[1].replace(/\s/g, '') : '';

  for (const s of sites) {
    const sName = s.name.replace(/\s/g, '');
    const isDirectMatch = sName.length >= 2 && cleanText.replace(/\s/g, '').includes(sName);
    const isKeywordMatch = siteKeyword.length >= 2 && sName.includes(siteKeyword);

    if (isDirectMatch || isKeywordMatch) {
      siteName = s.name;
      if (s.address && s.address.trim() && !siteAddress) {
        siteAddress = s.address.trim();
        modifiedFields.push(`현장주소: ${s.address.trim()}`);
      }
      if (!customerName) {
        const parentCust = customers.find(c => c.id === s.customerId);
        if (parentCust) {
          customerName = parentCust.name;
          if (!siteAddress && parentCust.address?.trim()) {
            siteAddress = parentCust.address.trim();
            modifiedFields.push(`고객사주소: ${parentCust.address.trim()}`);
          }
        }
      }
      modifiedFields.push(`현장: ${s.name}`);
      break;
    }
  }

  // 7. 위치 상세 (예: 지하 1층, 3층 하역장 등)
  const locMatch = cleanText.match(/(지하\s*\d+층|지상\s*\d+층|\d+층|[가-힣A-Za-z0-9]+\s*(?:하역장|주차장|동|구역|게이트))/);
  if (locMatch) {
    locationDetail = locMatch[0].trim();
    modifiedFields.push(`상세위치: ${locationDetail}`);
  }

  // 고객사가 매칭되었으나 아직 주소가 없으면 고객사 주소 상속
  if (customerName && !siteAddress) {
    const parentCust = customers.find(c => c.name === customerName);
    if (parentCust?.address?.trim()) {
      siteAddress = parentCust.address.trim();
      modifiedFields.push(`고객사주소: ${parentCust.address.trim()}`);
    }
  }

  return {
    customerName,
    siteName,
    siteAddress,
    assetNo,
    reporterName,
    reporterContact,
    issueCategory,
    issueDescription,
    priority,
    locationDetail,
    modifiedFields
  };
}


// ─────────────────────────────────────────────────────────────
// 🚚 3. 배차 담당자 기사 배정 통화 파서 (Dispatch Driver Call Parser)
// ─────────────────────────────────────────────────────────────
export interface DispatchDriverParseResult {
  matchedDeliveryId?: string;
  matchedDeliverySummary?: string;
  vehicleNo: string;
  driverName: string;
  driverContact: string;
  vehicleType: string;
  finalCost: number;
  loadingTime?: string;
  unloadingTime?: string;
  memo?: string;
  modifiedFields: string[];
}

export function parseDispatchDriverCallTranscript(
  speechText: string,
  pendingDeliveries: Delivery[]
): DispatchDriverParseResult {
  const cleanText = speechText.trim();
  const modifiedFields: string[] = [];

  let vehicleNo = '';
  let driverName = '';
  let driverContact = '';
  let vehicleType = '';
  let finalCost = 0;
  let loadingTime = '';
  let unloadingTime = '';
  let matchedDeliveryId: string | undefined = undefined;
  let matchedDeliverySummary: string | undefined = undefined;

  // 1. 차량 번호 추출 (대한민국 영업용 화물차 번호판: 경기88바1234, 88바1234, 12가3456 등)
  const plateMatch = cleanText.match(/([가-힣]{2})?\s*(\d{2,3})\s*([가-힣])\s*(\d{4})/);
  if (plateMatch) {
    const area = plateMatch[1] || '';
    vehicleNo = `${area}${plateMatch[2]}${plateMatch[3]}${plateMatch[4]}`.replace(/\s/g, '');
    modifiedFields.push(`차량번호: ${vehicleNo}`);
  }

  // 2. 기사 연락처 추출
  const phoneMatch = cleanText.match(/010[-.\s]?\d{3,4}[-.\s]?\d{4}/);
  if (phoneMatch) {
    const raw = phoneMatch[0].replace(/[-.\s]/g, '');
    if (raw.length === 11) {
      driverContact = `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
      modifiedFields.push(`기사연락처: ${driverContact}`);
    }
  }

  // 3. 기사명 추출 (이기사, 김기사, 홍길동 기사님 등)
  const driverMatch = cleanText.match(/([가-힣]{1,4})\s*(?:기사님?|사장님?)/);
  if (driverMatch && driverMatch[0]) {
    const cand = driverMatch[0].trim().replace(/님$/, '');
    if (!['경기', '서울', '인천', '충남', '강원', '전북', '내일', '오늘'].some(w => cand.startsWith(w))) {
      driverName = cand;
      modifiedFields.push(`기사명: ${driverName}`);
    }
  }

  // 4. 차종 추출
  const typeMatch = cleanText.match(/(5톤\s*축차|5톤|3\.5톤\s*광폭|3\.5톤|2\.5톤|1톤\s*카고|1톤|윙바디|셀프로더|평판|추레라)/i);
  if (typeMatch) {
    vehicleType = typeMatch[0].trim();
    modifiedFields.push(`차종: ${vehicleType}`);
  }

  // 5. 확정 운송료 추출 (예: 12만원, 12만, 15만원, 130,000원)
  const costMatch1 = cleanText.match(/(\d{1,3})\s*만(?:\s*원)?/);
  const costMatch2 = cleanText.match(/(\d{1,3}(?:,\d{3})+)\s*원/);
  if (costMatch1) {
    finalCost = parseInt(costMatch1[1], 10) * 10000;
    modifiedFields.push(`확정운송비: ${finalCost.toLocaleString()}원`);
  } else if (costMatch2) {
    finalCost = parseInt(costMatch2[1].replace(/,/g, ''), 10);
    modifiedFields.push(`확정운송비: ${finalCost.toLocaleString()}원`);
  }

  // 6. 상하차 시간
  const timeMatch = cleanText.match(/(상차|하차)?\s*(새벽|아침|오전|오후)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[3], 10);
    const minute = timeMatch[4] ? parseInt(timeMatch[4], 10) : 0;
    if (timeMatch[2] === '오후' && hour < 12) hour += 12;
    const formattedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (timeMatch[1] === '상차') {
      loadingTime = formattedTime;
      modifiedFields.push(`상차시간: ${loadingTime}`);
    } else {
      unloadingTime = formattedTime;
      modifiedFields.push(`도착시간: ${unloadingTime}`);
    }
  }

  // 7. 대기 중인 배차건 1순위 자동 매칭
  // pendingDeliveries 중 목적지나 메모에 텍스트 속 키워드가 포함된 건 탐색
  for (const d of pendingDeliveries) {
    const dest = (d.destinationAddress || '').replace(/\s/g, '');
    const memo = (d.memo || '').replace(/\s/g, '');
    const raw = (d.rawText || '').replace(/\s/g, '');

    // 현장명 매칭
    const siteMatches = cleanText.match(/([가-힣A-Za-z0-9]+?)\s*(?:현장|신축|공사|호텔|타워)/);
    if (siteMatches && siteMatches[1]) {
      const kw = siteMatches[1].replace(/\s/g, '');
      if (kw.length >= 2 && (dest.includes(kw) || memo.includes(kw) || raw.includes(kw))) {
        matchedDeliveryId = d.id;
        matchedDeliverySummary = `${d.destinationAddress || '목적지'} (${d.cargoItems || d.type})`;
        modifiedFields.push(`대상배차: ${matchedDeliverySummary}`);
        break;
      }
    }

    // 또는 장비 모델 매칭
    if (!matchedDeliveryId && /1930|2632|3246|4047/.test(cleanText)) {
      const model = cleanText.match(/1930|2632|3246|4047/)![0];
      if (memo.includes(model) || (d.cargoItems && d.cargoItems.includes(model))) {
        matchedDeliveryId = d.id;
        matchedDeliverySummary = `${d.destinationAddress || '목적지'} (${model})`;
        modifiedFields.push(`대상배차: ${matchedDeliverySummary}`);
        break;
      }
    }
  }

  return {
    matchedDeliveryId,
    matchedDeliverySummary,
    vehicleNo,
    driverName,
    driverContact,
    vehicleType,
    finalCost,
    loadingTime,
    unloadingTime,
    memo: cleanText,
    modifiedFields
  };
}

// ─────────────────────────────────────────────────────────────
// 🏗️ 4. 장비 규격 및 제조사 지식 매트릭스 (Equipment Knowledge Matrix)
// ─────────────────────────────────────────────────────────────
export interface EquipmentSpecMatrixItem {
  manufacturer: string;
  manufacturerAliases: string[];
  ft: string;
  modelName: string;
  modelNumberAliases: string[];
  widthType: 'STANDARD' | 'NARROW' | 'WIDE';
  displayName: string;
}

export const EQUIPMENT_SPEC_MATRIX: EquipmentSpecMatrixItem[] = [
  // 19ft
  { manufacturer: 'Genie', manufacturerAliases: ['지니', '제니', 'GENIE'], ft: '19ft', modelName: 'GS-1930', modelNumberAliases: ['1930', '일구삼공', '19', '십구'], widthType: 'STANDARD', displayName: '지니 GS-1930 (19ft 표준)' },
  { manufacturer: 'Skyjack', manufacturerAliases: ['스카이잭', '스카이', '스카이자켓', 'SKYJACK'], ft: '19ft', modelName: 'SJ-3219', modelNumberAliases: ['3219', '삼이일구', '3215', '삼이일오'], widthType: 'STANDARD', displayName: '스카이잭 SJ-3219 (19ft 표준)' },
  { manufacturer: 'Dingli', manufacturerAliases: ['딩리', '딩글리', 'DINGLI'], ft: '19ft', modelName: 'JCPT0608', modelNumberAliases: ['0608', '공육공팔'], widthType: 'NARROW', displayName: '딩리 JCPT0608 (19ft 소형)' },

  // 26ft
  { manufacturer: 'Genie', manufacturerAliases: ['지니', '제니', 'GENIE'], ft: '26ft', modelName: 'GS-2632', modelNumberAliases: ['2632', '이육삼이', '26', '이십육'], widthType: 'NARROW', displayName: '지니 GS-2632 (26ft 협폭)' },
  { manufacturer: 'Genie', manufacturerAliases: ['지니', '제니', 'GENIE'], ft: '26ft', modelName: 'GS-2646', modelNumberAliases: ['2646', '이육사육'], widthType: 'WIDE', displayName: '지니 GS-2646 (26ft 광폭)' },
  { manufacturer: 'Skyjack', manufacturerAliases: ['스카이잭', '스카이', 'SKYJACK'], ft: '26ft', modelName: 'SJ-3226', modelNumberAliases: ['3226', '삼이이육'], widthType: 'NARROW', displayName: '스카이잭 SJ-3226 (26ft 협폭)' },
  { manufacturer: 'Skyjack', manufacturerAliases: ['스카이잭', '스카이', 'SKYJACK'], ft: '26ft', modelName: 'SJ-4626', modelNumberAliases: ['4626', '사육이육'], widthType: 'WIDE', displayName: '스카이잭 SJ-4626 (26ft 광폭)' },
  { manufacturer: 'Sinoboom', manufacturerAliases: ['시노붐', '시노', 'SINOBOOM'], ft: '26ft', modelName: 'GTJZ0812', modelNumberAliases: ['0812', '공팔일이', '812', '팔일이'], widthType: 'WIDE', displayName: '시노붐 GTJZ0812 (26ft 광폭)' },
  { manufacturer: 'Sinoboom', manufacturerAliases: ['시노붐', '시노', 'SINOBOOM'], ft: '26ft', modelName: 'GTJZ0808', modelNumberAliases: ['0808', '공팔공팔'], widthType: 'NARROW', displayName: '시노붐 GTJZ0808 (26ft 협폭)' },

  // 32ft
  { manufacturer: 'Genie', manufacturerAliases: ['지니', '제니', 'GENIE'], ft: '32ft', modelName: 'GS-3246', modelNumberAliases: ['3246', '삼이사육', '32', '삼십이'], widthType: 'WIDE', displayName: '지니 GS-3246 (32ft 광폭)' },
  { manufacturer: 'Skyjack', manufacturerAliases: ['스카이잭', '스카이', 'SKYJACK'], ft: '32ft', modelName: 'SJ-4632', modelNumberAliases: ['4632', '사육삼이'], widthType: 'WIDE', displayName: '스카이잭 SJ-4632 (32ft 광폭)' },
  { manufacturer: 'Sinoboom', manufacturerAliases: ['시노붐', '시노', 'SINOBOOM'], ft: '32ft', modelName: 'GTJZ1012', modelNumberAliases: ['1012', '일공일이', '열일이'], widthType: 'WIDE', displayName: '시노붐 GTJZ1012 (32ft 광폭)' },

  // 40ft
  { manufacturer: 'Genie', manufacturerAliases: ['지니', '제니', 'GENIE'], ft: '40ft', modelName: 'GS-4047', modelNumberAliases: ['4047', '사공사칠', '40', '사십'], widthType: 'WIDE', displayName: '지니 GS-4047 (40ft 광폭)' },
  { manufacturer: 'Sinoboom', manufacturerAliases: ['시노붐', '시노', 'SINOBOOM'], ft: '40ft', modelName: 'GTJZ1212', modelNumberAliases: ['1212', '일이일이'], widthType: 'WIDE', displayName: '시노붐 GTJZ1212 (40ft 광폭)' },

  // 46ft & 53ft
  { manufacturer: 'Genie', manufacturerAliases: ['지니', '제니', 'GENIE'], ft: '46ft', modelName: 'GS-4655', modelNumberAliases: ['4655', '사육오오', '46', '사십육', '1412'], widthType: 'WIDE', displayName: '지니 GS-4655 (46ft 광폭)' },
  { manufacturer: 'Dingli', manufacturerAliases: ['딩리', 'DINGLI'], ft: '53ft', modelName: 'S1614AC+', modelNumberAliases: ['1614', '일육일사', '1612', '53', '오십삼'], widthType: 'WIDE', displayName: '딩리 S1614AC+ (53ft 초대형)' }
];

export interface ParsedEquipmentResult {
  order: EquipmentOrderItem;
  orders?: EquipmentOrderItem[];
  matchedItem: EquipmentSpecMatrixItem;
  confirmedDescription: string;
}

function parseSingleEquipmentVoiceInput(text: string): ParsedEquipmentResult | null {
  const clean = text.trim();
  if (!clean) return null;

  // 1. 수량 추출 (기본 1대)
  let count = 1;
  const countMatch = clean.match(/(\d+)\s*대/) || clean.match(/(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*대/);
  if (countMatch) {
    const raw = countMatch[1];
    if (KOREAN_COUNT_MAP[raw]) count = KOREAN_COUNT_MAP[raw];
    else if (!isNaN(parseInt(raw, 10))) count = Math.max(1, parseInt(raw, 10));
  } else {
    // "하나", "둘", "셋" 단독 발화
    const singleCountMatch = clean.match(/(하나|둘|셋|넷|다섯)/);
    if (singleCountMatch && KOREAN_COUNT_MAP[singleCountMatch[1]]) {
      count = KOREAN_COUNT_MAP[singleCountMatch[1]];
    }
  }

  // 2. 제조사 감지
  let matchedMfr: string | null = null;
  for (const item of EQUIPMENT_SPEC_MATRIX) {
    if (item.manufacturerAliases.some(alias => clean.includes(alias))) {
      matchedMfr = item.manufacturer;
      break;
    }
  }

  // 3. 차폭(폭) 감지
  let preferredWidth: 'NARROW' | 'WIDE' | null = null;
  if (/광폭|와이드|넓은/i.test(clean)) preferredWidth = 'WIDE';
  else if (/협폭|내로우|좁은/i.test(clean)) preferredWidth = 'NARROW';

  // 4. 모델 단축번호 직접 매칭 우선 (예: "3219", "0812", "1930", "2646")
  for (const item of EQUIPMENT_SPEC_MATRIX) {
    if (item.modelNumberAliases.some(alias => clean.includes(alias))) {
      // 제조사 조건이 있으면 일치하는지 확인
      if (matchedMfr && item.manufacturer !== matchedMfr) continue;
      // 차폭 조건이 있으면 일치하는지 확인
      if (preferredWidth && item.widthType !== preferredWidth) continue;

      return {
        order: { ft: item.ft, modelName: item.modelName, count },
        matchedItem: item,
        confirmedDescription: `${item.manufacturer} ${item.modelName} (${item.ft}) ${count}대`
      };
    }
  }

  // 5. 피트(ft) 규격 감지 (예: "19피트", "26피트", "32피트", "40피트")
  const ftMatch = clean.match(/(19|26|32|40|46|53)\s*(?:피트|ft)?/i);
  if (ftMatch) {
    const ftStr = `${ftMatch[1]}ft`;
    // 해당 피트 규격의 후보군 검색
    let candidates = EQUIPMENT_SPEC_MATRIX.filter(m => m.ft === ftStr);

    if (matchedMfr) {
      const mfrFiltered = candidates.filter(m => m.manufacturer === matchedMfr);
      if (mfrFiltered.length > 0) candidates = mfrFiltered;
    }

    if (preferredWidth) {
      const widthFiltered = candidates.filter(m => m.widthType === preferredWidth);
      if (widthFiltered.length > 0) candidates = widthFiltered;
    }

    const selected = candidates[0] || EQUIPMENT_SPEC_MATRIX.find(m => m.ft === ftStr)!;
    return {
      order: { ft: selected.ft, modelName: selected.modelName, count },
      matchedItem: selected,
      confirmedDescription: `${selected.manufacturer} ${selected.modelName} (${selected.ft}) ${count}대`
    };
  }

  return null;
}

/**
 * 4대 패턴(제조사+규격, 모델단축번호, 제조사+모델, 단순피트) 복합 장비 파서 (단일 및 다종 복합 발화 지원)
 */
export function parseEquipmentVoiceInput(text: string): ParsedEquipmentResult | null {
  const clean = text.trim();
  if (!clean) return null;

  // 복합 발화 분기 ("랑", "하고", "그리고", ",", "+", "및")
  if (/(?:랑|하고|그리고|,|\+|\b및\b)/.test(clean)) {
    const rawSegments = clean.split(/(?:랑|하고|그리고|,|\+|\b및\b)/).map(s => s.trim()).filter(Boolean);
    const parsedList: ParsedEquipmentResult[] = [];

    for (const seg of rawSegments) {
      const p = parseSingleEquipmentVoiceInput(seg);
      if (p) parsedList.push(p);
    }

    if (parsedList.length > 1) {
      const orders = parsedList.map(p => p.order);
      const totalCount = orders.reduce((sum, o) => sum + o.count, 0);
      const descList = parsedList.map(p => p.confirmedDescription).join(' | ');
      return {
        order: orders[0],
        orders,
        matchedItem: parsedList[0].matchedItem,
        confirmedDescription: `${descList} (총 ${totalCount}대)`
      };
    } else if (parsedList.length === 1) {
      return parsedList[0];
    }
  }

  return parseSingleEquipmentVoiceInput(clean);
}

// ─────────────────────────────────────────────────────────────
// 📅 5. 스마트 하차일시 정규화 엔진 (Smart DateTime Normalizer)
// ─────────────────────────────────────────────────────────────
export interface ParsedDateTimeResult {
  date: string;         // YYYY-MM-DD
  time: string;         // HH:mm 또는 ASAP
  isAsap: boolean;      // 긴급 시간무관 여부
  confirmQuestion: string; // 시스템이 되물어 확인할 음성/텍스트 질문
  displayText: string;  // 화면 표기용 요약 텍스트
}

export function parseDateTimeVoiceInput(text: string, baseDate: Date = new Date()): ParsedDateTimeResult {
  const clean = text.trim();
  const today = new Date(baseDate);
  let targetDate = new Date(baseDate);
  targetDate.setDate(targetDate.getDate() + 1); // 기본값: 내일

  let isAsap = false;
  let targetTime = '08:00'; // 기본값: 08:00

  // 1. 긴급/조기 발화 감지: "일찍", "최대한 빨리", "가장 빨리", "당장", "급하게", "빨리"
  if (/최대한\s*빨리|가장\s*빨리|당장|급해|빨리빨리|아침\s*일찍|새벽\s*일찍/i.test(clean)) {
    isAsap = true;
    targetTime = 'ASAP';
  } else if (/일찍|첫차|첫타임/i.test(clean)) {
    // "일찍" 단독 발화도 사장님 지침에 따라 시간무관 가장 빨리로 1순위 유도
    isAsap = true;
    targetTime = 'ASAP';
  }

  // 2. 날짜 추출
  if (/오늘|당일|지금/i.test(clean)) {
    targetDate = new Date(today);
  } else if (/내일/i.test(clean)) {
    targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (/모레|내일모레/i.test(clean)) {
    targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 2);
  } else if (/글피/i.test(clean)) {
    targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 3);
  } else {
    // 요일 계산 (다음주 월요일, 이번주 금요일 등)
    const dayMap: Record<string, number> = {
      '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6
    };
    const weekDayMatch = clean.match(/(다음주|이번주|다다음주)?\s*([월화수목금토일])요일/);
    if (weekDayMatch) {
      const weekModifier = weekDayMatch[1] || '이번주';
      const targetDay = dayMap[weekDayMatch[2]];
      const currentDay = today.getDay();

      let diff = targetDay - currentDay;
      if (weekModifier === '다음주') {
        diff += 7;
      } else if (weekModifier === '다다음주') {
        diff += 14;
      } else {
        // 이번주인데 이미 지난 요일이면 다음주로 보정
        if (diff <= 0) diff += 7;
      }

      targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + diff);
    } else {
      // 절대 날짜 (예: 9월 10일, 15일)
      const absDateMatch = clean.match(/(?:(\d{1,2})월\s*)?(\d{1,2})일/);
      if (absDateMatch) {
        const month = absDateMatch[1] ? parseInt(absDateMatch[1], 10) : today.getMonth() + 1;
        const day = parseInt(absDateMatch[2], 10);
        targetDate = new Date(today.getFullYear(), month - 1, day);
        if (targetDate < today && !absDateMatch[1]) {
          targetDate.setMonth(targetDate.getMonth() + 1);
        }
      }
    }
  }

  // 3. 시간 추출 (구체적 시간이 명시된 경우 ASAP 해제)
  const explicitHourMatch = clean.match(/(새벽|아침|오전|오후|저녁|낮)?\s*(\d{1,2})시(?:\s*(\d{1,2})분|\s*(반))?/);
  if (explicitHourMatch) {
    isAsap = false;
    const ampm = explicitHourMatch[1] || '';
    let hour = parseInt(explicitHourMatch[2], 10);
    const minute = explicitHourMatch[4] === '반' ? 30 : (explicitHourMatch[3] ? parseInt(explicitHourMatch[3], 10) : 0);
    if ((ampm === '오후' || ampm === '저녁' || ampm === '낮') && hour < 12) {
      hour += 12;
    }
    targetTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  } else if (!isAsap) {
    if (/아침/i.test(clean)) targetTime = '08:00';
    else if (/오전/i.test(clean)) targetTime = '09:00';
    else if (/점심|낮/i.test(clean)) targetTime = '12:00';
    else if (/오후/i.test(clean)) targetTime = '13:00';
  }

  const ymd = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayName = dayNames[targetDate.getDay()];
  const dateDisplay = `${targetDate.getMonth() + 1}월 ${targetDate.getDate()}일(${dayName})`;

  let confirmQuestion = '';
  let displayText = '';

  if (isAsap) {
    confirmQuestion = `${dateDisplay}, 시간 무관하게 가장 빨리(최우선 배차)로 접수할까요?`;
    displayText = `${dateDisplay} [긴급 최우선 배차(ASAP)]`;
  } else {
    confirmQuestion = `${dateDisplay} ${targetTime} 도착으로 지정할까요?`;
    displayText = `${dateDisplay} ${targetTime}`;
  }

  return {
    date: ymd,
    time: targetTime,
    isAsap,
    confirmQuestion,
    displayText
  };
}

// ─────────────────────────────────────────────────────────────
// 👤 6. 단계별 단답형 초정밀 파서 (Step-by-Step Parsers)
// ─────────────────────────────────────────────────────────────
export function parseCustomerVoiceInput(text: string, customers: Customer[]): Customer | null {
  const clean = decomposeComplexConsonants(text).replace(/주식회사|\(주\)|\s/g, '').toLowerCase();
  if (!clean || clean.length < 1) return null;

  // 1. 정확 일치 (Exact Name Match)
  for (const c of customers) {
    const sName = c.name.replace(/주식회사|\(주\)|\s/g, '').toLowerCase();
    if (sName === clean) return c;
  }

  // 2. 완성형 접두 일치 (Prefix Full-name Match)
  for (const c of customers) {
    const sName = c.name.replace(/주식회사|\(주\)|\s/g, '').toLowerCase();
    if (sName.startsWith(clean)) return c;
  }

  // 3. 초성 완전 일치 (Exact Chosung Match, e.g. 'ㅂㅅㅇㅇㅆ' === 'ㅂㅅㅇㅇㅆ')
  for (const c of customers) {
    const sName = c.name.replace(/주식회사|\(주\)|\s/g, '');
    const chosung = extractChosung(sName);
    if (chosung === clean) return c;
  }

  // 4. 초성 접두 일치 (Prefix Chosung Match - ALLOWED 고객사 우선)
  // 예: 'ㅅㅇ' -> '세연테크' ('ㅅㅇㅌㅋ'.startsWith('ㅅㅇ') = true)
  //     '백산이엔씨' ('ㅂㅅㅇㅇㅆ')는 'ㅅㅇ'로 시작하지 않으므로 걸러짐!
  const prefixChosungAllowed = customers.filter(c => {
    if (c.transactionStatus === 'BLOCKED') return false;
    const sName = c.name.replace(/주식회사|\(주\)|\s/g, '');
    return extractChosung(sName).startsWith(clean);
  });
  if (prefixChosungAllowed.length > 0) return prefixChosungAllowed[0];

  const prefixChosungAny = customers.filter(c => {
    const sName = c.name.replace(/주식회사|\(주\)|\s/g, '');
    return extractChosung(sName).startsWith(clean);
  });
  if (prefixChosungAny.length > 0) return prefixChosungAny[0];

  // 5. 완성형 포함 일치 (Name Contains)
  for (const c of customers) {
    const sName = c.name.replace(/주식회사|\(주\)|\s/g, '').toLowerCase();
    if (clean.includes(sName) || sName.includes(clean)) return c;
  }

  // 6. 2글자 이상 부분 시작 매칭
  for (const c of customers) {
    const sName = c.name.replace(/주식회사|\(주\)|\s/g, '').toLowerCase();
    if (sName.length >= 2 && clean.startsWith(sName.slice(0, 2))) return c;
  }

  // 7. 한글 초성 부분 매칭 (ALLOWED 우선)
  const hangulMatchAllowed = customers.filter(c => {
    if (c.transactionStatus === 'BLOCKED') return false;
    const sName = c.name.replace(/주식회사|\(주\)|\s/g, '');
    return matchHangul(sName, clean);
  });
  if (hangulMatchAllowed.length > 0) return hangulMatchAllowed[0];

  const hangulMatchAny = customers.filter(c => {
    const sName = c.name.replace(/주식회사|\(주\)|\s/g, '');
    return matchHangul(sName, clean);
  });
  if (hangulMatchAny.length > 0) return hangulMatchAny[0];

  // 8. 대표자명 매칭
  for (const c of customers) {
    if (c.representative && matchHangul(c.representative, clean)) return c;
  }

  return null;
}

export interface ParsedSiteVoiceResult {
  site?: CustomerSite;
  isNew?: boolean;
  newSiteName?: string;
  extractedAddress?: string;
  extractedContactName?: string;
  extractedContactPhone?: string;
}

export function parseSiteVoiceInput(
  text: string,
  sites: CustomerSite[],
  customerId?: string
): ParsedSiteVoiceResult | null {
  const rawText = decomposeComplexConsonants(text.trim());
  if (!rawText || rawText.length < 1) return null;

  // 1. 전화번호 추출
  let extractedContactPhone: string | undefined = undefined;
  const phoneMatch = rawText.match(/010[-.\s]?\d{3,4}[-.\s]?\d{4}/);
  if (phoneMatch) {
    extractedContactPhone = phoneMatch[0];
  }

  // 2. 담당자 직함/이름 추출
  let extractedContactName: string | undefined = undefined;
  const contactMatch = rawText.match(/([가-힣]{1,4}\s*(?:소장님?|반장님?|과장님?|부장님?|팀장님?))/);
  if (contactMatch) {
    extractedContactName = contactMatch[0].replace(/님$/, '').trim();
  }

  // 3. 도로명/지번 주소 추출
  let extractedAddress: string | undefined = undefined;
  const addrMatch = rawText.match(/((?:서울|경기|인천|강원|충북|충남|전북|전남|경북|경남|제주|세종|부산|대구|광주|대전|울산)[가-힣A-Za-z0-9\s]+(?:로|길|동|리|읍|면)\s*[\d-]+(?:\s*번지)?)/);
  if (addrMatch) {
    extractedAddress = addrMatch[1].trim();
  }

  // 4. 현장명 후보 정제: 주소, 전화번호, 담당자, 신규현장 키워드 제거
  let cleanCandidate = rawText;
  if (extractedContactPhone) cleanCandidate = cleanCandidate.replace(extractedContactPhone, ' ');
  if (phoneMatch) cleanCandidate = cleanCandidate.replace(phoneMatch[0], ' ');
  if (contactMatch) cleanCandidate = cleanCandidate.replace(contactMatch[0], ' ');
  if (addrMatch) cleanCandidate = cleanCandidate.replace(addrMatch[0], ' ');
  cleanCandidate = cleanCandidate.replace(/신규\s*현장|새로운\s*현장|새\s*현장|신규현장|신규/g, ' ');
  cleanCandidate = cleanCandidate.replace(/\s+/g, ' ').trim();

  const targetSites = customerId ? sites.filter(s => s.customerId === customerId) : sites;

  // 5. 기존 현장 완성형 매칭
  const cleanForMatch = (cleanCandidate || rawText).replace(/\s/g, '').toLowerCase();
  for (const s of targetSites) {
    const sName = s.name.replace(/\s/g, '').toLowerCase();
    if (sName === cleanForMatch || cleanForMatch.includes(sName) || sName.includes(cleanForMatch)) {
      return {
        site: s,
        isNew: false,
        extractedAddress: extractedAddress || s.address,
        extractedContactName: extractedContactName || s.contactName,
        extractedContactPhone: extractedContactPhone || s.contact
      };
    }
  }

  // 5-2. 기존 현장 초성 매칭 (예: 'ㅍㅌ' -> '평택고덕', 'ㅍㄱ' -> '판교 R&D 센터 현장')
  for (const s of targetSites) {
    const sName = s.name.replace(/\s/g, '');
    if (matchHangul(sName, cleanForMatch)) {
      return {
        site: s,
        isNew: false,
        extractedAddress: extractedAddress || s.address,
        extractedContactName: extractedContactName || s.contactName,
        extractedContactPhone: extractedContactPhone || s.contact
      };
    }
  }

  // 6. 신규 현장 감지
  const finalSiteName = cleanCandidate.length >= 2 ? cleanCandidate : rawText;
  return {
    isNew: true,
    newSiteName: finalSiteName.endsWith('현장') ? finalSiteName : `${finalSiteName} 현장`,
    extractedAddress,
    extractedContactName,
    extractedContactPhone
  };
}

// ─────────────────────────────────────────────────────────────
// 🤝 7. 대화형 예/아니오 및 담당자 핀포인트 파서 (Context Proactive Parsers)
// ─────────────────────────────────────────────────────────────

/**
 * 긍정("네", "예", "맞아", "동일", "같아") / 부정("아니요", "아니", "달라", "바뀜", "변경") 판별
 */
export function parseYesNoVoiceInput(text: string): boolean | null {
  const clean = text.replace(/[\s\.\,\!\?]/g, '').toLowerCase();
  if (/^(?:네|예|맞아|응|어|그래|좋아|동일|맞습니다|그렇게|예스|yes|동일해|같아|맞소|맞아요|동일해요|그렇습니다)$/i.test(clean) ||
      /(?:네|예|맞아|응|동일|맞습니다|그렇게|같아요|동일해요)/i.test(clean)) {
    return true;
  }
  if (/^(?:아니|아니요|아뇨|달라|틀려|아닙니다|바뀜|변경|다름|no|노|아니오|바뀌었|바뀜|달라요)$/i.test(clean) ||
      /(?:아니|아니요|아뇨|달라|틀려|아닙니다|바뀌|변경|다릅니다)/i.test(clean)) {
    return false;
  }
  return null;
}

/**
 * 담당자 성함/직함 정밀 추출 (예: "김철수 소장", "이반장님", "홍길동")
 */
export function parseContactNameVoiceInput(text: string): string | null {
  const clean = text.trim();
  if (!clean || clean.length < 2) return null;
  const titleMatch = clean.match(/([가-힣]{1,4}\s*(?:소장님?|반장님?|과장님?|부장님?|팀장님?|대리님?|기사님?))/);
  if (titleMatch) {
    return titleMatch[0].replace(/님$/, '').trim();
  }
  const explicit = clean.match(/(?:이름|성함|담당자)?\s*([가-힣]{2,4})/);
  if (explicit && explicit[1]) {
    return explicit[1].trim();
  }
  return clean.slice(0, 10);
}

/**
 * 음성 전화번호 파싱 (010-XXXX-XXXX 및 "공일공 일이삼사..." 한글 음성 지원)
 */
export function parseContactPhoneVoiceInput(text: string): string | null {
  const clean = text.trim();
  // 1) 010-XXXX-XXXX 표준 형태
  const phoneMatch = clean.match(/010[-.\s]?\d{3,4}[-.\s]?\d{4}/);
  if (phoneMatch) {
    const raw = phoneMatch[0].replace(/[-.\s]/g, '');
    return `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
  }
  // 2) 한글 음성 발화 ("공일공 일이삼사 오육칠팔") 또는 공백 분리 숫자
  const digitStr = clean
    .replace(/공|영/g, '0').replace(/일|하나/g, '1').replace(/이|둘/g, '2')
    .replace(/삼|셋/g, '3').replace(/사|넷/g, '4').replace(/오|다섯/g, '5')
    .replace(/육|여섯/g, '6').replace(/칠|일곱/g, '7').replace(/팔|여덟/g, '8')
    .replace(/구|아홉/g, '9')
    .replace(/[^\d]/g, '');
  if (digitStr.startsWith('010') && digitStr.length === 11) {
    return `${digitStr.slice(0, 3)}-${digitStr.slice(3, 7)}-${digitStr.slice(7)}`;
  }
  return null;
}

/**
 * 현장의 기존 출고 옵션 요약 생성 (예: "4면 철망, 바닥보양(플라베니아), 요구사양 3건")
 */
export function getSiteOptionsSummary(site: CustomerSite): string {
  const parts: string[] = [];
  if (site.paidOptions) parts.push(site.paidOptions);
  if (site.protection) parts.push(site.protection);
  const specCount = Object.values(site.checkedSpecs || {}).filter(Boolean).length;
  if (specCount > 0) parts.push(`요구사양 ${specCount}건`);
  return parts.length > 0 ? parts.join(', ') : '표준 사양';
}

/**
 * 현장의 기존 기억된 옵션과 이번 출고 요청 옵션 간 차이 발생 여부 감지
 */
export function isOptionsChangedFromSite(
  site: CustomerSite | null | undefined,
  paidOptions?: string,
  protection?: string,
  checkedSpecs?: Record<string, boolean>
): boolean {
  if (!site) return false;
  
  const toStr = (v: any) => {
    if (!v) return '';
    if (Array.isArray(v)) return v.flat().map((s: any) => String(s).trim()).filter(Boolean).join(', ');
    return String(v).trim();
  };

  // 1. 유상옵션 비교 (정규화)
  const sitePaid = toStr(site.paidOptions);
  const reqPaid = toStr(paidOptions);
  if (sitePaid !== reqPaid) return true;

  // 2. 보양작업 비교 (정규화)
  const siteProt = toStr(site.protection);
  const reqProt = toStr(protection);
  if (siteProt !== reqProt) return true;

  // 3. 요구사양 비교
  const siteSpecs = site.checkedSpecs || {};
  const reqSpecs = checkedSpecs || {};
  const allSpecKeys = Array.from(new Set([...Object.keys(siteSpecs), ...Object.keys(reqSpecs)]));
  for (const k of allSpecKeys) {
    if (!!siteSpecs[k] !== !!reqSpecs[k]) {
      return true;
    }
  }

  return false;
}

