/**
 * 한글 초성 검색 및 내비게이션식 자음 매칭 유틸리티 (hangulSearch.ts)
 * 
 * 기능:
 * 1. 순수 초성 검색: 'ㅇㅈㅇ' -> '이정용', 'ㅅㅅ' -> '삼성물산', 'ㅍㅌ' -> '평택'
 * 2. 혼합 초성 검색: '기ㅇ' -> '기연리프트', '삼성ㅁㅅ' -> '삼성물산'
 * 3. 완성형/영문/숫자 검색: '평택' -> '평택고덕P3', 'CJ' -> 'CJ대한통운', '1008' -> '1008'
 * 4. 0-Dependency: 외부 라이브러리 없이 순수 유니코드 연산 (0.1ms 이내 초고속 처리)
 */

export const CHOSUNG_LIST: readonly string[] = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

export const HANGUL_BASE = 0xAC00; // '가' (44032)
export const HANGUL_END = 0xD7A3;  // '힣' (55203)

/**
 * 단일 문자가 한글 완성형 음절인지 검사
 */
export function isHangulSyllable(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return code >= HANGUL_BASE && code <= HANGUL_END;
}

/**
 * 단일 문자가 한글 초성 자음인지 검사 (ㄱ ~ ㅎ)
 */
export function isChosungChar(char: string): boolean {
  return CHOSUNG_LIST.includes(char);
}

/**
 * 단일 음절에서 초성 추출 (한글이 아니면 원래 문자 반환)
 */
export function getChosung(char: string): string {
  if (!isHangulSyllable(char)) return char;
  const code = char.charCodeAt(0);
  const chosungIndex = Math.floor((code - HANGUL_BASE) / (21 * 28));
  return CHOSUNG_LIST[chosungIndex] || char;
}

/**
 * 텍스트 전체에서 초성 문자열 추출 (예: '이정용' -> 'ㅇㅈㅇ', '기연리프트' -> 'ㄱㅇㄹㅍㅌ')
 */
export function extractChosung(text: string): string {
  if (!text) return '';
  let res = '';
  for (let i = 0; i < text.length; i++) {
    res += getChosung(text[i]);
  }
  return res;
}

/**
 * 검색어를 기반으로 초성과 완성형을 모두 포용하는 정규표현식(RegExp)을 동적 생성
 */
export function createHangulSearchRegex(query: string): RegExp {
  const cleanQuery = query.trim();
  if (!cleanQuery) return /(?:)/;

  let pattern = '';
  for (let i = 0; i < cleanQuery.length; i++) {
    const char = cleanQuery[i];
    const chosungIdx = CHOSUNG_LIST.indexOf(char);

    if (chosungIdx >= 0) {
      // 초성 자음인 경우: 해당 자음으로 시작하는 모든 음절(가-깋 등) 또는 자음 자체 매칭
      const startCode = HANGUL_BASE + chosungIdx * 21 * 28;
      const endCode = HANGUL_BASE + (chosungIdx + 1) * 21 * 28 - 1;
      pattern += `[${String.fromCharCode(startCode)}-${String.fromCharCode(endCode)}${char}]`;
    } else {
      // 특수문자 이스케이프 후 일반 매칭
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  return new RegExp(pattern, 'i');
}

/**
 * 대상 문자열이 검색어와 일치(부분일치, 초성일치, 대소문자 무시)하는지 검사
 * 
 * @param target 대상 문자열 (예: '이정용', '삼성물산 평택고덕P3')
 * @param query 검색어 (예: 'ㅇㅈㅇ', 'ㅅㅅ', '삼성ㅁㅅ', '1008')
 * @returns 일치 여부
 */
export function matchHangul(target?: string | null, query?: string | null): boolean {
  if (!query || !query.trim()) return true;
  if (!target || !target.trim()) return false;

  const cleanTarget = target.trim();
  const cleanQuery = query.trim();

  // 1. 일반 대소문자 무시 포함 검색 (영문, 숫자, 한글 완성형)
  if (cleanTarget.toLowerCase().includes(cleanQuery.toLowerCase())) {
    return true;
  }

  // 2. 순수 초성 문자열 매칭 ('ㅇㅈㅇ' in 'ㅇㅈㅇ')
  const targetChosung = extractChosung(cleanTarget);
  if (targetChosung.includes(cleanQuery)) {
    return true;
  }

  // 3. 동적 정규식 매칭 (혼합형: '삼성ㅁㅅ', '기ㅇ' 등)
  try {
    const regex = createHangulSearchRegex(cleanQuery);
    return regex.test(cleanTarget);
  } catch {
    return false;
  }
}

/**
 * 복수의 대상 문자열 중 하나라도 검색어와 일치하는지 검사
 * 예: matchHangulAny([customer.name, customer.representative, customer.bizRegNo], query)
 */
export function matchHangulAny(targets: (string | null | undefined)[], query?: string | null): boolean {
  if (!query || !query.trim()) return true;
  return targets.some(target => matchHangul(target, query));
}
