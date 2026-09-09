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

/**
 * 한글 복자음(겹받침) 11종 ➔ 기본 초성 자음 2자 분해 매핑 테이블
 * 한글 IME(입력기) 조합기가 빠른 초성 연속 입력 시 'ㅂ'+'ㅅ'을 'ㅄ'으로 합성하는 현상을 원래 키스트로크 순서로 정규화
 */
export const COMPLEX_CONSONANT_MAP: Record<string, string> = {
  'ㄳ': 'ㄱㅅ',
  'ㄵ': 'ㄴㅈ',
  'ㄶ': 'ㄴㅎ',
  'ㄺ': 'ㄹㄱ',
  'ㄻ': 'ㄹㅁ',
  'ㄼ': 'ㄹㅂ',
  'ㄽ': 'ㄹㅅ',
  'ㄾ': 'ㄹㅌ',
  'ㄿ': 'ㄹㅍ',
  'ㅀ': 'ㄹㅎ',
  'ㅄ': 'ㅂㅅ'
};

/**
 * 텍스트 내의 모든 복자음을 기본 초성 자음 2자로 자동 분해 정규화
 * 예: 'ㅄ' -> 'ㅂㅅ', 'ㅄㅇㅇ' -> 'ㅂㅅㅇㅇ', 'ㄳ' -> 'ㄱㅅ'
 */
export function decomposeComplexConsonants(text: string): string {
  if (!text) return '';
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    result += COMPLEX_CONSONANT_MAP[char] || char;
  }
  return result;
}

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
  return CHOSUNG_LIST.includes(char) || char in COMPLEX_CONSONANT_MAP;
}

/**
 * 단일 음절에서 초성 추출 (한글이 아니면 원래 문자 반환)
 */
export function getChosung(char: string): string {
  if (!isHangulSyllable(char)) return COMPLEX_CONSONANT_MAP[char] || char;
  const code = char.charCodeAt(0);
  const chosungIndex = Math.floor((code - HANGUL_BASE) / (21 * 28));
  return CHOSUNG_LIST[chosungIndex] || char;
}

/**
 * 텍스트 전체에서 초성 문자열 추출 (예: '이정용' -> 'ㅇㅈㅇ', '기연리프트' -> 'ㄱㅇㄹㅍㅌ', 'ㅄ' -> 'ㅂㅅ')
 */
export function extractChosung(text: string): string {
  if (!text) return '';
  const decomposed = decomposeComplexConsonants(text);
  let res = '';
  for (let i = 0; i < decomposed.length; i++) {
    res += getChosung(decomposed[i]);
  }
  return res;
}

// 정규식 캐시 (메모리 누수 방지 LRU/Map 캐시 최대 200개)
const regexCache = new Map<string, RegExp>();

/**
 * 검색어를 기반으로 초성과 완성형을 모두 포용하는 정규표현식(RegExp)을 동적 생성 및 캐싱
 */
export function createHangulSearchRegex(query: string): RegExp {
  const cleanQuery = decomposeComplexConsonants(query.trim());
  if (!cleanQuery) return /(?:)/;

  if (regexCache.has(cleanQuery)) {
    return regexCache.get(cleanQuery)!;
  }

  let pattern = '';
  for (let i = 0; i < cleanQuery.length; i++) {
    const char = cleanQuery[i];
    const chosungIdx = CHOSUNG_LIST.indexOf(char);

    if (chosungIdx >= 0) {
      // 초성 자음인 경우: 해당 자음으로 시작하는 모든 음절(가-깋 등) 또는 자음 자체 매칭
      const startCode = HANGUL_BASE + chosungIdx * 588;
      const endCode = HANGUL_BASE + (chosungIdx + 1) * 588 - 1;
      pattern += `[${String.fromCharCode(startCode)}-${String.fromCharCode(endCode)}${char}]`;
    } else {
      // 특수문자 이스케이프 후 일반 매칭
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  const regex = new RegExp(pattern, 'i');
  if (regexCache.size > 200) {
    const firstKey = regexCache.keys().next().value;
    if (firstKey) regexCache.delete(firstKey);
  }
  regexCache.set(cleanQuery, regex);
  return regex;
}

const CHOSUNG_SET = new Set(CHOSUNG_LIST);

/**
 * 텍스트 내에 초성 자음(ㄱ~ㅎ)이나 복자음이 하나라도 포함되어 있는지 고속 검사
 */
export function containsChosung(text: string): boolean {
  if (!text) return false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (CHOSUNG_SET.has(char) || char in COMPLEX_CONSONANT_MAP) {
      return true;
    }
  }
  return false;
}

export interface HangulMatcher {
  test: (target?: string | null) => boolean;
  testAny: (targets: (string | null | undefined)[]) => boolean;
}

/**
 * 검색어를 1회 전처리/컴파일하여 수천~수만 건 대량 데이터 반복 검색에 최적화된 고속 매처를 생성
 */
export function createHangulMatcher(query?: string | null): HangulMatcher {
  if (!query || !query.trim()) {
    return {
      test: () => true,
      testAny: () => true
    };
  }

  const cleanQuery = decomposeComplexConsonants(query.trim());
  const lowerQuery = cleanQuery.toLowerCase();
  const hasChosung = containsChosung(cleanQuery);
  const regex = hasChosung ? createHangulSearchRegex(cleanQuery) : null;

  const test = (target?: string | null): boolean => {
    if (!target || !target.trim()) return false;
    const cleanTarget = target.trim();

    // 1. 일반 대소문자 무시 부분일치 (영문, 숫자, 한글 완성형) - O(N) 초고속
    if (cleanTarget.toLowerCase().includes(lowerQuery)) return true;

    // 쿼리에 초성이 없다면 초성/정규식 매칭 불필요
    if (!hasChosung) return false;

    // 2. 순수 초성 문자열 매칭 ('ㅇㅈㅇ' in 'ㅇㅈㅇ')
    const targetChosung = extractChosung(cleanTarget);
    if (targetChosung.includes(cleanQuery)) return true;

    // 3. 초성-완성형 혼합 정규식 매칭
    return regex ? regex.test(cleanTarget) : false;
  };

  const testAny = (targets: (string | null | undefined)[]): boolean => {
    if (!targets || targets.length === 0) return false;
    for (let i = 0; i < targets.length; i++) {
      if (test(targets[i])) return true;
    }
    return false;
  };

  return { test, testAny };
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
  return createHangulMatcher(query).test(target);
}

/**
 * 복수의 대상 문자열 중 하나라도 검색어와 일치하는지 검사
 * 예: matchHangulAny([customer.name, customer.representative, customer.bizRegNo], query)
 */
export function matchHangulAny(targets: (string | null | undefined)[], query?: string | null): boolean {
  if (!query || !query.trim()) return true;
  if (!targets || targets.length === 0) return false;
  return createHangulMatcher(query).testAny(targets);
}

