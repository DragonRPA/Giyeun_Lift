// src/services/vendorStatementParser.ts
import * as XLSX from 'xlsx';

/**
 * 임차처 거래명세서 엑셀 파싱 단일 표준 레코드 인터페이스
 */
export interface VendorStatementRow {
  id: string;
  assetNo: string;        // 관리번호/장비번호 (예: J0576, H3379, J3043 등 / 기타비용의 경우 "기타/청소비", "기타/수리비")
  serialNo?: string;      // 시리얼/제조번호
  modelName?: string;     // 모델명/장비명/품명 (예: 1230ES, GS1930, 고소작업대 10M / 기타비용의 경우 "청소비")
  rentStart: string;      // YYYY-MM-DD
  rentEnd: string;        // YYYY-MM-DD
  billedAmount: number;   // 공급가액 (청구금액)
  unitPrice?: number;     // 단가 (월렌탈료/일단가)
  taxAmount?: number;     // 세액 (V.A.T)
  totalAmount?: number;   // 공급가액 + 세액 (합계)
  contractNo?: string;    // 임차처 계약번호
  seq?: number;           // 순번
  memo?: string;          // 비고 / 품목 상세명
  itemType: 'EQUIPMENT' | 'REPAIR' | 'OTHER_FEE'; // 장비 렌탈 vs 수리비 vs 청소비/기타 비용
  rawItemName?: string;   // 원본 셀 품목 텍스트
}

export interface ParseVendorStatementResult {
  rows: VendorStatementRow[];
  detectedVendor?: string;
  headerRowIndex: number;
  totalParsedAmount: number;
  totalParsedTax: number;
  totalParsedCount: number;
}

/**
 * 날짜 문자열(단일 날짜 예: "7/1", "7/31", "5/26", "2026-07-01", 엑셀 시리얼 넘버 46235) 파싱 헬퍼
 */
export function parseSingleDateString(dateStr: any, defaultYm: string): string {
  if (dateStr === null || dateStr === undefined) return '';

  // Excel serial number date
  if (typeof dateStr === 'number' && dateStr > 40000 && dateStr < 60000) {
    const d = XLSX.SSF.parse_date_code(dateStr);
    if (d) {
      return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
  }

  const clean = String(dateStr).trim();
  if (!clean || clean === '-') return '';

  const [defaultYear] = defaultYm.split('-');

  // 패턴 1: YYYY-MM-DD 또는 YYYY.MM.DD
  const ymdMatch = clean.match(/(\d{4})[\.\-\/](\d{1,2})[\.\-\/](\d{1,2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
  }

  // 패턴 2: YY-MM-DD 또는 YY.MM.DD (예: 26.07.01, 26-07-01)
  const yymdMatch = clean.match(/(\d{2})[\.\-\/](\d{1,2})[\.\-\/](\d{1,2})/);
  if (yymdMatch) {
    return `20${yymdMatch[1]}-${yymdMatch[2].padStart(2, '0')}-${yymdMatch[3].padStart(2, '0')}`;
  }

  // 패턴 3: M/D 또는 M.D (예: 7/1, 7/31, 5/26, 9/12)
  const mdMatch = clean.match(/^(\d{1,2})[\.\-\/](\d{1,2})$/);
  if (mdMatch) {
    const m = mdMatch[1].padStart(2, '0');
    const d = mdMatch[2].padStart(2, '0');
    return `${defaultYear}-${m}-${d}`;
  }

  return '';
}

/**
 * 다양한 기간 문자열(예: "26.07.01 ~26.07.31", "26-07-01 ~ 26-07-31", "08/01-08/31") 파싱 헬퍼
 */
export function parsePeriodString(periodStr: any, defaultYm: string): { rentStart: string; rentEnd: string } {
  const [defaultYear, defaultMonth] = defaultYm.split('-');
  const lastDay = new Date(parseInt(defaultYear, 10), parseInt(defaultMonth, 10), 0).getDate();
  const fallbackStart = `${defaultYm}-01`;
  const fallbackEnd = `${defaultYm}-${String(lastDay).padStart(2, '0')}`;

  if (!periodStr) {
    return { rentStart: fallbackStart, rentEnd: fallbackEnd };
  }

  const clean = String(periodStr).trim();
  const periodMatch = clean.match(/(\d{2,4})[\.\-\/](\d{1,2})[\.\-\/](\d{1,2})\s*[\~\-]\s*(\d{2,4})[\.\-\/](\d{1,2})[\.\-\/](\d{1,2})/);
  
  if (periodMatch) {
    let y1 = periodMatch[1];
    let m1 = periodMatch[2].padStart(2, '0');
    let d1 = periodMatch[3].padStart(2, '0');
    let y2 = periodMatch[4];
    let m2 = periodMatch[5].padStart(2, '0');
    let d2 = periodMatch[6].padStart(2, '0');

    if (y1.length === 2) y1 = `20${y1}`;
    if (y2.length === 2) y2 = `20${y2}`;

    return {
      rentStart: `${y1}-${m1}-${d1}`,
      rentEnd: `${y2}-${m2}-${d2}`
    };
  }

  // M/D - M/D (예: 08/01-08/31)
  const mdRangeMatch = clean.match(/(\d{1,2})[\.\-\/](\d{1,2})\s*[\~\-]\s*(\d{1,2})[\.\-\/](\d{1,2})/);
  if (mdRangeMatch) {
    return {
      rentStart: `${defaultYear}-${mdRangeMatch[1].padStart(2, '0')}-${mdRangeMatch[2].padStart(2, '0')}`,
      rentEnd: `${defaultYear}-${mdRangeMatch[3].padStart(2, '0')}-${mdRangeMatch[4].padStart(2, '0')}`
    };
  }

  return { rentStart: fallbackStart, rentEnd: fallbackEnd };
}

/**
 * 셀 값을 숫자(금액)로 변환하는 헬퍼
 */
function parseNumber(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const numStr = String(val).replace(/[^0-9\.-]/g, '');
  const parsed = parseFloat(numStr);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * 셀 값을 문자열로 변환하는 헬퍼
 */
function parseString(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/**
 * 임차처 거래명세서 엑셀 범용 파서 엔진
 * - 롯데렌탈(주), (주)하이로드, 하은(주), AJ네트웍스, 주식회사 프린스렌탈, 주식회사 현대네트웍스, 주식회사 현대렌탈, ㈜엘제이리프트 등 전 서식 지원
 * - 동적 헤더 행 자동 탐색 (한글 띄어쓰기 셀 정규화, 품명/장비명, 기간, 단가, 공급가액 등)
 * - 장비명 내 괄호 속 관리번호((HS1406), (BS1020), (D1531)) 자동 분리 추출
 * - 중간 청소비/수리비/세척비/도색비/운송비 등 기타 비용 항목 누락 없는 수용
 * - 하단 합계 행('소계', '합계', '청구금액', '결제계좌', '예금주') 및 빈 행 자동 거름
 */
export function parseVendorStatementExcel(
  worksheet: XLSX.WorkSheet,
  selectedYm: string = new Date().toISOString().slice(0, 7),
  fileName: string = ''
): ParseVendorStatementResult {
  // 1. sheet를 2D 배열로 변환 ({ header: 1 })
  const matrix: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  if (!matrix || matrix.length === 0) {
    return { rows: [], headerRowIndex: -1, totalParsedAmount: 0, totalParsedTax: 0, totalParsedCount: 0 };
  }

  // 2. 공급자(임차처) 자동 감지 (파일명 및 상단 공급자 정보 우선 매핑)
  let detectedVendor: string | undefined = undefined;
  const headerBlockText = matrix.slice(0, 15).map(r => r.join(' ')).join(' ');
  const combinedVendorSearch = fileName + ' ' + headerBlockText;

  if (combinedVendorSearch.includes('엘제이리프트') || fileName.includes('엘제이')) {
    detectedVendor = '㈜엘제이리프트';
  } else if (combinedVendorSearch.includes('프린스렌탈') || fileName.includes('프린스')) {
    detectedVendor = '주식회사 프린스렌탈';
  } else if (combinedVendorSearch.includes('현대네트웍스') || fileName.includes('현대네트웍스')) {
    detectedVendor = '주식회사 현대네트웍스';
  } else if (combinedVendorSearch.includes('현대렌탈') || fileName.includes('현대렌탈')) {
    detectedVendor = '주식회사 현대렌탈';
  } else if (combinedVendorSearch.includes('롯데렌탈') || fileName.includes('롯데렌탈')) {
    detectedVendor = '롯데렌탈(주)';
  } else if (combinedVendorSearch.includes('하은') || fileName.includes('하은')) {
    detectedVendor = '하은(주)';
  } else if (combinedVendorSearch.includes('중부') || combinedVendorSearch.includes('하이로드') || fileName.includes('중부')) {
    detectedVendor = '(주)하이로드';
  } else if (combinedVendorSearch.includes('AJ네트웍스') || combinedVendorSearch.includes('아주렌탈') || combinedVendorSearch.includes('에이엔네트웍스')) {
    detectedVendor = '(주)AJ네트웍스';
  } else if (combinedVendorSearch.includes('라이즈') || fileName.includes('라이즈')) {
    detectedVendor = '주식회사 라이즈리프트';
  } else if (combinedVendorSearch.includes('포스렌탈') || fileName.includes('포스')) {
    detectedVendor = '주식회사 포스렌탈';
  } else if (combinedVendorSearch.includes('한솔') || fileName.includes('한솔')) {
    detectedVendor = '한솔렌탈 주식회사';
  } else if (combinedVendorSearch.includes('화테') || fileName.includes('화테')) {
    detectedVendor = '(주)화테코리아설비렌탈';
  }

  // 3. 헤더 행(Header Row Index) 동적 찾기
  let headerRowIndex = -1;
  let maxHeaderScore = 0;

  const headerKeywords = [
    '관리번호', '자산번호', '장비번호', '장비NO', '시리얼', '제조번호',
    '모델명', '장비명', '품명', '모델', '기간', '사용기간', '사용시작', '사용종료', '투입일자', '철수일자',
    '월렌탈료', '월임대료', '공급가액', '청구금액', '세액', 'V.A.T', 'VAT', '부가세', '순번', '계약번호', '일수', '단가', '운반비', '금액'
  ];

  for (let r = 0; r < Math.min(30, matrix.length); r++) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;

    const rowCleanStr = row.map(c => parseString(c).replace(/\s+/g, '')).join(' ');
    // 계좌/요약 행은 헤더 후보에서 제외
    if (
      rowCleanStr.includes('입금계좌') ||
      rowCleanStr.includes('계좌번호') ||
      rowCleanStr.includes('농협') ||
      rowCleanStr.includes('국민은행') ||
      rowCleanStr.includes('기업은행') ||
      rowCleanStr.includes('하나은행')
    ) {
      continue;
    }

    let score = 0;
    row.forEach(cell => {
      const cellClean = parseString(cell).replace(/\s+/g, '').toUpperCase();
      if (!cellClean) return;
      headerKeywords.forEach(kw => {
        if (cellClean.includes(kw.replace(/\s+/g, '').toUpperCase())) score++;
      });
    });

    if (score > maxHeaderScore && score >= 2) {
      maxHeaderScore = score;
      headerRowIndex = r;
    }
  }

  // 헤더 행을 못 찾은 경우 기본값 0 지정
  if (headerRowIndex === -1) {
    headerRowIndex = 0;
  }

  const headerRow = matrix[headerRowIndex] || [];
  
  // 4. 컬럼 인덱스 매핑 (거래명세서별 상이한 용어를 우리 시스템 표준 단어로 통일)
  let colAssetNo = -1;
  let colSerialNo = -1;
  let colModelName = -1;
  let colPeriod = -1;
  let colRentStart = -1;
  let colRentEnd = -1;
  let colSupplyAmount = -1;
  let colTaxAmount = -1;
  let colMonthlyRent = -1;
  let colSeq = -1;
  let colContractNo = -1;
  let colMemo = -1;

  headerRow.forEach((cell, idx) => {
    const txt = parseString(cell).replace(/\s+/g, '').toUpperCase();
    if (!txt) return;

    if (txt.includes('장비번호') || txt.includes('관리번호') || txt.includes('자산번호') || txt.includes('장비NO')) {
      colAssetNo = idx;
    } else if (txt.includes('시리얼') || txt.includes('제조번호')) {
      colSerialNo = idx;
    } else if (txt.includes('장비명') || txt.includes('모델명') || txt.includes('품명') || txt === '모델' || txt.includes('규격')) {
      colModelName = idx;
    } else if (txt.includes('사용기간') || txt === '기간' || txt.includes('임차기간')) {
      colPeriod = idx;
    } else if (txt.includes('사용시작') || txt.includes('임차시작') || txt.includes('시작일') || txt.includes('투입일')) {
      colRentStart = idx;
    } else if (txt.includes('사용종료') || txt.includes('임차종료') || txt.includes('종료일') || txt.includes('철수일')) {
      colRentEnd = idx;
    } else if (txt.includes('단가') || txt.includes('월렌탈료') || txt.includes('월임대료') || txt.includes('일사용료') || txt.includes('일단가') || txt === '단가') {
      // 1순위: 단가 / 월렌탈료 (절대 공급가액으로 오인되지 않도록 선행 격리)
      colMonthlyRent = idx;
    } else if (txt.includes('공급가액') || txt.includes('청구금액') || txt.includes('실청구액') || txt === '공급가' || txt === '금액' || txt === '합계') {
      // 2순위: 실제 공급가액 (청구금액)
      colSupplyAmount = idx;
    } else if (txt.includes('V.A.T') || txt.includes('VAT') || txt.includes('세액') || txt.includes('부가세')) {
      colTaxAmount = idx;
    } else if (txt.includes('순번') || txt.includes('NO') || txt === '순번') {
      colSeq = idx;
    } else if (txt.includes('계약번호')) {
      colContractNo = idx;
    } else if (txt.includes('비고') || txt.includes('적요') || txt.includes('현장명') || txt.includes('특이사항')) {
      colMemo = idx;
    }
  });

  // 파싱 데이터 행 수집
  const rows: VendorStatementRow[] = [];
  let totalParsedAmount = 0;
  let totalParsedTax = 0;

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const rowData = matrix[r];
    if (!Array.isArray(rowData)) continue;

    // 행 전체 텍스트 병합
    const rowFullText = rowData.map(c => parseString(c)).join(' ').trim();
    if (!rowFullText) continue; // 빈 행 무시

    // 하단 소계/합계 행 및 계좌/연락처 무시
    const firstColStr = parseString(rowData[0]).replace(/\s+/g, '');
    const secondColStr = parseString(rowData[1]).replace(/\s+/g, '');
    const cleanFullText = rowFullText.replace(/\s+/g, '');

    // 1. 하단 최종 결제계좌/VAT포함 총계 행 발견 시 테이블 완전 종료 (이후 푸터 행 수집 중단)
    if (
      cleanFullText.includes('결제계좌') ||
      cleanFullText.includes('입금계좌') ||
      cleanFullText.includes('VAT포함') ||
      cleanFullText.includes('청구금액:') ||
      cleanFullText.includes('아래와같이청구합니다')
    ) {
      break;
    }

    // 2. 소계/합계/총계 및 이메일/전화번호/팩스/사업자번호 등 비청구 더미 행 100% 차단
    if (
      firstColStr === '소계' ||
      firstColStr === '합계' ||
      firstColStr === '계' ||
      firstColStr === '총계' ||
      secondColStr === '소계' ||
      secondColStr === '합계' ||
      secondColStr === '계' ||
      cleanFullText.includes('소계') ||
      cleanFullText.includes('합계') ||
      cleanFullText.includes('총계') ||
      cleanFullText.includes('청구금액') ||
      cleanFullText.includes('예금주') ||
      cleanFullText.includes('공급자보관용') ||
      cleanFullText.includes('공급받는자용') ||
      cleanFullText.includes('영업담당') ||
      cleanFullText.includes('연락처') ||
      cleanFullText.includes('미사용반환') ||
      cleanFullText.includes('@') ||
      cleanFullText.includes('.com') ||
      cleanFullText.includes('.co.kr') ||
      cleanFullText.includes('.net') ||
      cleanFullText.includes('010-') ||
      cleanFullText.includes('031-') ||
      cleanFullText.includes('02-') ||
      cleanFullText.includes('032-') ||
      cleanFullText.includes('051-') ||
      cleanFullText.includes('팩스') ||
      cleanFullText.includes('FAX') ||
      cleanFullText.includes('TEL') ||
      cleanFullText.includes('사업자등록') ||
      cleanFullText.includes('등록번호') ||
      cleanFullText.includes('특이사항')
    ) {
      continue;
    }

    // 각 필드 값 추출
    let rawAssetNo = colAssetNo !== -1 ? parseString(rowData[colAssetNo]) : '';
    const rawSerialNo = colSerialNo !== -1 ? parseString(rowData[colSerialNo]) : '';
    let rawModelName = colModelName !== -1 ? parseString(rowData[colModelName]) : '';
    const rawPeriod = colPeriod !== -1 ? parseString(rowData[colPeriod]) : '';
    const rawRentStart = colRentStart !== -1 ? rowData[colRentStart] : '';
    const rawRentEnd = colRentEnd !== -1 ? rowData[colRentEnd] : '';
    const rawUnitPrice = colMonthlyRent !== -1 ? parseNumber(rowData[colMonthlyRent]) : undefined;
    let rawSupplyAmount = 0;
    if (colSupplyAmount !== -1 && rowData[colSupplyAmount] !== undefined && rowData[colSupplyAmount] !== '') {
      rawSupplyAmount = parseNumber(rowData[colSupplyAmount]);
    } else if (rawUnitPrice !== undefined && rawUnitPrice > 0) {
      rawSupplyAmount = rawUnitPrice;
    }
    const finalUnitPrice = (rawUnitPrice !== undefined && rawUnitPrice > 0) ? rawUnitPrice : rawSupplyAmount;
    const rawTaxAmount = colTaxAmount !== -1 ? parseNumber(rowData[colTaxAmount]) : 0;
    const rawContractNo = colContractNo !== -1 ? parseString(rowData[colContractNo]) : '';
    const rawSeq = colSeq !== -1 ? parseNumber(rowData[colSeq]) : undefined;
    const rawMemo = colMemo !== -1 ? parseString(rowData[colMemo]) : '';

    // 헤더 행 재등장 무시
    if (
      rawAssetNo.replace(/\s+/g, '') === '장비번호' ||
      rawAssetNo.replace(/\s+/g, '') === '관리번호' ||
      rawModelName.replace(/\s+/g, '') === '장비명' ||
      rawModelName.replace(/\s+/g, '') === '모델명' ||
      rawModelName.replace(/\s+/g, '') === '품명'
    ) {
      continue;
    }

    // 관리번호와 모델명이 둘 다 없고 단독 숫자만 있는 합계/소계 잔여 행 무시
    if (!rawAssetNo && !rawModelName) {
      continue;
    }

    // 💡 [핵심] colAssetNo 컬럼이 없거나 비어있고, rawModelName에 괄호 속 관리번호가 있는 경우 분리 추출
    // 예: "S1412AC+ (HS1406)", "SJ3219(신형)(BS1020)", "JCPT1008AC (D1531)", "ES1330L(J71)"
    if (!rawAssetNo && rawModelName) {
      const pMatch = rawModelName.match(/\(([A-Z0-9\-]{2,15})\)/i);
      if (pMatch) {
        rawAssetNo = pMatch[1].trim();
        rawModelName = rawModelName.replace(pMatch[0], '').trim();
      }
    }

    // 날짜 파싱 (M/D 단일 날짜 및 기간 포맷 모두 대처)
    let rentStart = '';
    let rentEnd = '';

    if (rawRentStart) {
      rentStart = parseSingleDateString(rawRentStart, selectedYm);
    }
    if (rawRentEnd) {
      rentEnd = parseSingleDateString(rawRentEnd, selectedYm);
    }

    if (!rentStart || !rentEnd) {
      const dates = parsePeriodString(rawPeriod, selectedYm);
      if (!rentStart) rentStart = dates.rentStart;
      if (!rentEnd) rentEnd = dates.rentEnd;
    }

    // =========================================================
    // 비장비 항목 (청소비/수리비/세척비/도색비/운송비 등) 수용 처리
    // =========================================================
    let itemType: 'EQUIPMENT' | 'REPAIR' | 'OTHER_FEE' = 'EQUIPMENT';
    let finalAssetNo = rawAssetNo;
    let finalModelName = rawModelName;
    let finalMemo = rawMemo;

    if (!rawAssetNo) {
      const feeText = rawModelName || rawMemo || rowFullText;
      const isKnownFeeKeyword =
        feeText.includes('청소') ||
        feeText.includes('수리') ||
        feeText.includes('세척') ||
        feeText.includes('도색') ||
        feeText.includes('부품') ||
        feeText.includes('운송') ||
        feeText.includes('소모품');
      
      if (isKnownFeeKeyword) {
        if (feeText.includes('수리')) {
          itemType = 'REPAIR';
          finalAssetNo = '기타/수리비';
        } else if (feeText.includes('청소')) {
          itemType = 'OTHER_FEE';
          finalAssetNo = '기타/청소비';
        } else {
          itemType = 'OTHER_FEE';
          finalAssetNo = `기타/${rawModelName || '비용'}`;
        }
        finalModelName = rawModelName || feeText || '기타비용';
        finalMemo = rawMemo ? `${rawModelName} - ${rawMemo}` : feeText;
      } else if (rawSupplyAmount > 0) {
        // 엘제이리프트 등 별도 관리번호 컬럼 없는 단기 운송/임차 행 (금액이 존재하는 유효 행만 수용)
        finalAssetNo = `R-${1000 + r}`;
      } else {
        // 관리번호도 없고 비용 키워드도 아니며 청구 금액도 0원인 더미 행은 전면 배제
        continue;
      }
    } else {
      // 장비번호가 있더라도 품목명이 청소비/수리비 등인 경우
      if (rawModelName.includes('청소') || rawModelName.includes('수리') || rawModelName.includes('세척')) {
        itemType = rawModelName.includes('수리') ? 'REPAIR' : 'OTHER_FEE';
      }
    }

    const calculatedTax = rawTaxAmount || Math.round(rawSupplyAmount * 0.1);

    // 레코드 생성
    const rowRecord: VendorStatementRow = {
      id: `stmt-${r}-${Date.now()}`,
      assetNo: finalAssetNo || `R-${1000 + r}`,
      serialNo: rawSerialNo,
      modelName: finalModelName,
      rentStart: rentStart || `${selectedYm}-01`,
      rentEnd: rentEnd || `${selectedYm}-31`,
      billedAmount: rawSupplyAmount,
      unitPrice: finalUnitPrice,
      taxAmount: calculatedTax,
      totalAmount: rawSupplyAmount + calculatedTax,
      contractNo: rawContractNo,
      seq: rawSeq,
      memo: finalMemo,
      itemType,
      rawItemName: rawModelName || rowFullText
    };

    rows.push(rowRecord);
    totalParsedAmount += rawSupplyAmount;
    totalParsedTax += calculatedTax;
  }

  return {
    rows,
    detectedVendor,
    headerRowIndex,
    totalParsedAmount,
    totalParsedTax,
    totalParsedCount: rows.length
  };
}
