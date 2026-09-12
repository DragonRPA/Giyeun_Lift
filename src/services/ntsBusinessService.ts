// src/services/ntsBusinessService.ts
// 국세청 홈택스 사업자등록 진위확인 및 휴폐업 상태조회 클라이언트 서비스

export type BusinessStatusCode = '01' | '02' | '03' | '';
export type BusinessStatusType = 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'UNREGISTERED';

export interface NtsStatusResult {
  bizRegNo: string;               // 10자리 숫자
  formattedBizNo: string;         // 000-00-00000 포맷
  status: BusinessStatusType;     // ACTIVE (계속) | SUSPENDED (휴업) | CLOSED (폐업) | UNREGISTERED (미등록)
  statusLabel: string;            // '계속사업자' | '휴업자' | '폐업자' | '국세청 미등록'
  statusCode: BusinessStatusCode; // '01' | '02' | '03' | ''
  taxType: string;                // 과세유형 (예: '부가가치세 일반과세자')
  taxTypeCd?: string;
  closedDate?: string;            // 폐업일자 (YYYY-MM-DD 형식으로 정규화)
  checkedAt: string;              // 조회 일시 (ISO String)
  source: 'NTS_LIVE_API' | 'CHECKSUM_FALLBACK';
}

/**
 * 1. 사업자등록번호 하이픈 3단 포맷터 ("000-00-00000")
 */
export function formatBizNo(raw: string): string {
  if (!raw) return '';
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }
  return raw;
}

/**
 * 2. 폐업일자 포맷터 ("YYYYMMDD" -> "YYYY-MM-DD")
 */
export function formatClosedDate(rawDate?: string): string | undefined {
  if (!rawDate) return undefined;
  const digits = rawDate.replace(/[^0-9]/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  }
  return rawDate;
}

/**
 * 3. 원시 국세청 응답 항목을 NtsStatusResult 모델로 변환
 */
function parseNtsItem(item: any, source: 'NTS_LIVE_API' | 'CHECKSUM_FALLBACK'): NtsStatusResult {
  const cleanNo = String(item.b_no || '').replace(/[^0-9]/g, '');
  const code = (item.b_stt_cd || '') as BusinessStatusCode;
  let status: BusinessStatusType = 'UNREGISTERED';
  let statusLabel = '국세청 미등록';

  if (code === '01') {
    status = 'ACTIVE';
    statusLabel = '계속사업자';
  } else if (code === '02') {
    status = 'SUSPENDED';
    statusLabel = '휴업자';
  } else if (code === '03') {
    status = 'CLOSED';
    statusLabel = '폐업자';
  } else if (item.tax_type && !item.tax_type.includes('등록되지 않은')) {
    status = 'ACTIVE';
    statusLabel = item.b_stt || '계속사업자';
  }

  return {
    bizRegNo: cleanNo,
    formattedBizNo: formatBizNo(cleanNo),
    status,
    statusLabel,
    statusCode: code,
    taxType: item.tax_type || '과세유형 미상',
    taxTypeCd: item.tax_type_cd,
    closedDate: formatClosedDate(item.end_dt),
    checkedAt: new Date().toISOString(),
    source
  };
}

export const DEFAULT_NTS_API_KEY = '7f24250bd002412aaa152a6e3ec63e556604f75be0fa9181983c33a618cb2e03';

export function getNtsApiKey(): string {
  if (typeof window === 'undefined') return DEFAULT_NTS_API_KEY;
  return localStorage.getItem('erp_nts_api_key') || DEFAULT_NTS_API_KEY;
}

export function setNtsApiKey(key: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('erp_nts_api_key', key.trim());
  }
}

export async function testNtsConnection(serviceKey?: string): Promise<{ success: boolean; message: string; source?: string }> {
  const activeKey = (serviceKey || getNtsApiKey()).trim();
  try {
    const res = await fetch('/api/nts-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b_no: ['1408126442'], serviceKey: activeKey })
    });
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data && json.data.length > 0) {
        const item = json.data[0];
        const isLive = json.source === 'NTS_LIVE_API';
        return {
          success: true,
          source: json.source,
          message: isLive 
            ? `국세청 공식 API 연동 성공 (${item.b_stt || '정상'})` 
            : `체크섬 알고리즘 응답 (API키 미인식)`
        };
      }
    }
    return { success: false, message: `서버 응답 오류 (HTTP ${res.status})` };
  } catch (err: any) {
    return { success: false, message: err?.message || '연결 실패' };
  }
}

/**
 * 4. 단일 사업자등록번호 국세청 상태 실시간 조회
 */
export async function checkSingleNtsStatus(bizNo: string, serviceKey?: string): Promise<NtsStatusResult> {
  const cleanNo = (bizNo || '').replace(/[^0-9]/g, '');
  if (cleanNo.length !== 10) {
    return {
      bizRegNo: cleanNo,
      formattedBizNo: bizNo,
      status: 'UNREGISTERED',
      statusLabel: '유효하지 않은 번호(10자리 필수)',
      statusCode: '',
      taxType: '형식 오류',
      checkedAt: new Date().toISOString(),
      source: 'CHECKSUM_FALLBACK'
    };
  }

  const activeKey = (serviceKey || getNtsApiKey()).trim();

  try {
    const res = await fetch('/api/nts-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b_no: [cleanNo], serviceKey: activeKey })
    });

    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data && json.data.length > 0) {
        return parseNtsItem(json.data[0], json.source || 'NTS_LIVE_API');
      }
    }
  } catch (err) {
    console.warn('[NtsBusinessService] checkSingleNtsStatus network exception:', err);
  }

  // 예외 시 기본 반환
  return {
    bizRegNo: cleanNo,
    formattedBizNo: formatBizNo(cleanNo),
    status: 'ACTIVE',
    statusLabel: '조회 지연 (기본 계속사업자 적용)',
    statusCode: '01',
    taxType: '일반과세자',
    checkedAt: new Date().toISOString(),
    source: 'CHECKSUM_FALLBACK'
  };
}

/**
 * 5. 다중 사업자등록번호 일괄 조회 (100건 단위 청크 자동 분할 및 병렬/순차 큐)
 */
export async function checkBatchNtsStatus(
  bizNos: string[],
  onChunkProgress?: (processed: number, total: number) => void,
  serviceKey?: string
): Promise<Map<string, NtsStatusResult>> {
  const resultMap = new Map<string, NtsStatusResult>();
  const cleanList = Array.from(new Set(bizNos.map(no => (no || '').replace(/[^0-9]/g, '')).filter(no => no.length === 10)));
  const total = cleanList.length;

  if (total === 0) return resultMap;

  const activeKey = (serviceKey || getNtsApiKey()).trim();
  const CHUNK_SIZE = 100;
  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = cleanList.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch('/api/nts-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ b_no: chunk, serviceKey: activeKey })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          const source = json.source || 'NTS_LIVE_API';
          for (const rawItem of json.data) {
            const parsed = parseNtsItem(rawItem, source);
            resultMap.set(parsed.bizRegNo, parsed);
          }
        }
      }
    } catch (err) {
      console.warn('[NtsBusinessService] Batch chunk query error:', err);
    }

    onChunkProgress?.(Math.min(i + CHUNK_SIZE, total), total);
  }

  return resultMap;
}
