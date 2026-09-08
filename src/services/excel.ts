// d:\Kiyeun_Lift\src\services\excel.ts
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

export const exportToExcel = (data: any[], fileName: string, sheetName: string = 'Sheet1') => {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

/**
 * 정산 사용기간 계산 헬퍼 (시작일~종료일 YYYY-MM-DD ~ YYYY-MM-DD)
 */
export function calcServicePeriod(d: any, billing: any, contract: any): string {
  if (d?.servicePeriod) return d.servicePeriod;
  if (d?.startDate && d?.endDate) return `${d.startDate} ~ ${d.endDate}`;
  if (billing?.periodStart && billing?.periodEnd) return `${billing.periodStart} ~ ${billing.periodEnd}`;
  if (billing?.startDate && billing?.endDate) return `${billing.startDate} ~ ${billing.endDate}`;

  const ym = billing?.billingYm;
  if (ym && ym.length === 7) {
    const [yStr, mStr] = ym.split('-');
    const year = Number(yStr);
    const month = Number(mStr);
    const closingDay = contract?.closingDay || contract?.defaultStatementClosingDay || 30;

    if (closingDay >= 28 || closingDay === 31 || closingDay === 30) {
      const lastDay = new Date(year, month, 0).getDate();
      return `${ym}-01 ~ ${ym}-${String(lastDay).padStart(2, '0')}`;
    } else {
      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevStartDay = closingDay + 1;
      const s = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevStartDay).padStart(2, '0')}`;
      const e = `${ym}-${String(closingDay).padStart(2, '0')}`;
      return `${s} ~ ${e}`;
    }
  }

  if (contract?.startDate) {
    const endStr = !contract.endDate || contract.endDate === '미정' || contract.endDate.startsWith('9999') ? '미정' : contract.endDate;
    return `${contract.startDate} ~ ${endStr}`;
  }

  return billing?.billingYm ? `${billing.billingYm}-01 ~ ${billing.billingYm}-31` : '';
}

/**
 * 💡 [새 서식 표준] 품목 포맷 헬퍼: {모델명}[{관리번호}]_{청구시작일}~{청구종료일}
 * 예: JCPT1012AC[K10304]_2026-08-01~2026-08-31
 */
export function formatStatementItemName(d: any, billing: any, contract: any): string {
  const period = calcServicePeriod(d, billing, contract);
  const compactPeriod = period.replace(/\s*~\s*/, '~');

  const modelName = d.modelName || d.itemName || '장비';
  const assetNo = d.assetNo ? String(d.assetNo).trim() : '';

  if (assetNo) {
    return `${modelName}[${assetNo}]_${compactPeriod}`;
  } else {
    return `${modelName}_${compactPeriod}`;
  }
}

/**
 * 신규 표준 거래명세서 양식 파일(구글 드라이브 또는 public/)을 ExcelJS로 읽어서
 * 실제 청구 데이터를 셀 값만 채워넣고 다운로드.
 *
 * 신규 셀 주소 매핑 (2026-08 개편):
 * - 공급자: E9=계약담당자, J9=연락처, E10=계산서담당자, J10=연락처, E13=작성일자
 * - 공급받는자: O5=등록번호, O6=상호, T6=대표, O7=주소, O8=업태, T8=종목
 *              O9=현장담당자, T9=연락처, O10=계산서담당자, T10=연락처, O11=계산서메일, O12=현장명
 * - 데이터 행 (row 16~26, 최대 11행):
 *   B=순번, C=월, D=일, E=품목({모델명}[{관리번호}]_{시작일}~{종료일}), L=수량, M=단가, O=공급가액, Q=부가세, T=비고
 * - 합계 행 (row 27): E27=공급가합계, J27=부가세합계, O27=총합계
 */
export const exportTransactionStatementExcel = async (
  billing: any,
  details: any[],
  customer: any,
  contract: any,
  site: any,
  salesperson?: any,
  fileName?: string,
  templateUrl?: string
) => {
  // 1. URL 변환 (구글 드라이브 공유링크 → 직접 다운로드 URL)
  let fetchUrl = '/거래명세서양식.xlsx';

  if (templateUrl) {
    if (templateUrl.includes('docs.google.com/spreadsheets')) {
      const fileIdMatch = templateUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        fetchUrl = `https://docs.google.com/spreadsheets/d/${fileIdMatch[1]}/export?format=xlsx`;
      }
    } else if (templateUrl.includes('drive.google.com')) {
      const fileIdMatch = templateUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                          templateUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        fetchUrl = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
      }
    } else if (templateUrl.startsWith('http')) {
      fetchUrl = templateUrl;
    }
  }

  // 2. 양식 파일 fetch
  const response = await fetch(fetchUrl);
  if (!response.ok) throw new Error(`거래명세서 양식 파일 로드 실패 (${fetchUrl}): HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error(
      `거래명세서 양식 파일을 받지 못했습니다 (HTML 응답).\n` +
      `구글 드라이브 파일이 "링크 있는 모든 사용자" 공개로 설정되었는지 확인하세요.\n` +
      `(fetchUrl: ${fetchUrl})`
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  // 3. ExcelJS로 워크북 로드 (이미지·도장·서식 100% 보존)
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('거래명세서 양식 파일에 시트가 없습니다.');

  // 헬퍼: 셀에 값만 설정 (스타일 건드리지 않음)
  const setVal = (addr: string, value: string | number | null) => {
    const cell = worksheet.getCell(addr);
    cell.value = value;
  };

  // 헬퍼: 셀에 가운데정렬 및 값 설정
  const setCenterVal = (addr: string, value: string | number | null) => {
    const cell = worksheet.getCell(addr);
    cell.value = value;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  };

  // 숫자 값 설정 (기존 numFmt 보존)
  const setNum = (addr: string, value: number) => {
    const cell = worksheet.getCell(addr);
    const existingFmt = (cell.numFmt as string) || '#,##0';
    cell.value = value;
    cell.numFmt = existingFmt;
  };

  const billingDate: string = billing?.billingDate || new Date().toISOString().split('T')[0];
  const parts = billingDate.split('-');
  const dateY = parts[0] || '';
  const dateM = parts[1] ? Number(parts[1]) : '';
  const dateD = parts[2] ? Number(parts[2]) : '';
  const formattedBillingDate = `${dateY}년 ${String(dateM).padStart(2, '0')}월 ${String(dateD).padStart(2, '0')}일`;

  // === 공급자 (당사) 영업담당자 정보 (가운데 정렬) ===
  const spName = salesperson?.name || contract?.salespersonName || '';
  const spPhone = salesperson?.mobile || salesperson?.phone || '';
  if (spName) setCenterVal('E9', spName);
  if (spPhone) setCenterVal('J9', spPhone);
  setCenterVal('E10', '정수아');
  setCenterVal('J10', '031-334-5295');

  // === 공급받는자 (고객사 및 현장) 정보 (가운데 정렬) ===
  setCenterVal('O5', customer?.bizRegNo || '');                                      // 등록번호
  setCenterVal('O6', customer?.name || '');                                         // 상호
  setCenterVal('T6', customer?.representative || '');                               // 대표자
  setCenterVal('O7', customer?.address || '');                                      // 주소
  if (customer?.bizType) setCenterVal('O8', customer.bizType);                      // 업태
  if (customer?.bizItem) setCenterVal('T8', customer.bizItem);                      // 종목

  // 현장담당자, 계산서담당자, 계산서메일, 현장명 (가운데 정렬)
  setCenterVal('O9', site?.managerName || site?.contactName || customer?.managerName || ''); // 현장담당자
  setCenterVal('T9', site?.managerPhone || site?.contactPhone || customer?.phone || '');    // 현장담당자 연락처
  setCenterVal('O10', customer?.billingManagerName || customer?.managerName || '');         // 계산서담당자
  setCenterVal('T10', customer?.billingManagerPhone || customer?.phone || '');             // 계산서담당자 연락처
  setCenterVal('O11', customer?.billingEmail || customer?.email || '');                     // 계산서메일
  setCenterVal('O12', site?.name || (typeof site === 'string' ? site : '') || '');          // 현장명

  // 작성일자 (E13) - 가운데 정렬
  setCenterVal('E13', formattedBillingDate);

  // === 데이터 품목 행 (row 16~26, 최대 11행) ===
  const ITEM_START_ROW = 16;
  const ITEM_MAX = 11;

  const sortedDetails = [...details].sort((a, b) => {
    const aIsAsset = Boolean(a.contractAssetId);
    const bIsAsset = Boolean(b.contractAssetId);
    if (aIsAsset && !bIsAsset) return -1;
    if (!aIsAsset && bIsAsset) return 1;
    return 0;
  });

  let totalSupply = 0;
  let totalVat = 0;

  for (let i = 0; i < ITEM_MAX; i++) {
    const d = sortedDetails[i];
    const row = ITEM_START_ROW + i;

    if (d) {
      const unitPrice = d.unitPrice || 0;
      const qty = d.quantity || 1;
      const itemSupply = unitPrice * qty;
      const itemVat = Math.round(itemSupply * 0.1);
      totalSupply += itemSupply;
      totalVat += itemVat;

      // 💡 [새 서식 표준] 품목: {모델명}[{관리번호}]_{청구시작일}~{청구종료일}
      const itemDescription = formatStatementItemName(d, billing, contract);

      setCenterVal(`B${row}`, i + 1);                     // 순번
      setCenterVal(`C${row}`, dateM);                     // 월
      setCenterVal(`D${row}`, dateD);                     // 일
      setVal(`E${row}`, itemDescription);                 // 품목 (병합셀 E~K)
      setCenterVal(`L${row}`, qty);                       // 수량
      setNum(`M${row}`, unitPrice);                       // 단가 (병합셀 M~N)
      setNum(`O${row}`, itemSupply);                      // 공급가액 (병합셀 O~P)
      setNum(`Q${row}`, itemVat);                         // 부가세 (병합셀 Q~S)
      setVal(`T${row}`, d.memo || d.notes || '');         // 비고 (병합셀 T~U)
    } else {
      // 빈 행 초기화
      setVal(`B${row}`, null);
      setVal(`C${row}`, null);
      setVal(`D${row}`, null);
      setVal(`E${row}`, null);
      setVal(`L${row}`, null);
      setVal(`M${row}`, null);
      setVal(`O${row}`, null);
      setVal(`Q${row}`, null);
      setVal(`T${row}`, null);
    }
  }

  // === 하단 합계 행 (Row 27) ===
  const totalGrand = totalSupply + totalVat;
  setNum('E27', totalSupply);
  setNum('J27', totalVat);
  setNum('O27', totalGrand);

  // 4. 파일 다운로드
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileName || '거래명세서'}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * 거래명세서 양식에 데이터를 채운 Excel 워크북 Buffer만 반환 (다운로드 없음).
 * PDF 저장용 엑셀 파일 생성, 이메일 첨부 등 다운로드 외 용도에 사용.
 */
export const exportTransactionStatementExcelBuffer = async (
  billing: any,
  details: any[],
  customer: any,
  contract: any,
  site: any,
  salesperson?: any,
  templateUrl?: string
): Promise<ArrayBuffer> => {
  let fetchUrl = '/거래명세서양식.xlsx';
  if (templateUrl) {
    if (templateUrl.includes('docs.google.com/spreadsheets')) {
      const m = templateUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      if (m) fetchUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
    } else if (templateUrl.includes('drive.google.com')) {
      const m = templateUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || templateUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (m) fetchUrl = `https://drive.google.com/uc?export=download&id=${m[1]}`;
    } else if (templateUrl.startsWith('http')) {
      fetchUrl = templateUrl;
    }
  }

  const response = await fetch(fetchUrl);
  if (!response.ok) throw new Error(`거래명세서 양식 파일 로드 실패: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error('거래명세서 양식 파일을 받지 못했습니다 (HTML 응답).\n구글 드라이브 파일이 "링크 있는 모든 사용자" 공개로 설정되었는지 확인하세요.');
  }

  const arrayBuffer = await response.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('거래명세서 양식 파일에 시트가 없습니다.');

  const setVal = (addr: string, value: string | number | null) => { worksheet.getCell(addr).value = value; };
  const setCenterVal = (addr: string, value: string | number | null) => {
    const cell = worksheet.getCell(addr);
    cell.value = value;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  };
  const setNum = (addr: string, value: number) => {
    const cell = worksheet.getCell(addr);
    const fmt = (cell.numFmt as string) || '#,##0';
    cell.value = value;
    cell.numFmt = fmt;
  };

  const billingDate: string = billing?.billingDate || new Date().toISOString().split('T')[0];
  const parts = billingDate.split('-');
  const dateY = parts[0] || '';
  const dateM = parts[1] ? Number(parts[1]) : '';
  const dateD = parts[2] ? Number(parts[2]) : '';
  const formattedBillingDate = `${dateY}년 ${String(dateM).padStart(2, '0')}월 ${String(dateD).padStart(2, '0')}일`;

  // === 공급자 영업담당자 정보 (가운데 정렬) ===
  const spName = salesperson?.name || contract?.salespersonName || '';
  const spPhone = salesperson?.mobile || salesperson?.phone || '';
  if (spName) setCenterVal('E9', spName);
  if (spPhone) setCenterVal('J9', spPhone);
  setCenterVal('E10', '정수아');
  setCenterVal('J10', '031-334-5295');

  // === 공급받는자 정보 (가운데 정렬) ===
  setCenterVal('O5', customer?.bizRegNo || '');
  setCenterVal('O6', customer?.name || '');
  setCenterVal('T6', customer?.representative || '');
  setCenterVal('O7', customer?.address || '');
  if (customer?.bizType) setCenterVal('O8', customer.bizType);
  if (customer?.bizItem) setCenterVal('T8', customer.bizItem);

  setCenterVal('O9', site?.managerName || site?.contactName || customer?.managerName || '');
  setCenterVal('T9', site?.managerPhone || site?.contactPhone || customer?.phone || '');
  setCenterVal('O10', customer?.billingManagerName || customer?.managerName || '');
  setCenterVal('T10', customer?.billingManagerPhone || customer?.phone || '');
  setCenterVal('O11', customer?.billingEmail || customer?.email || '');
  setCenterVal('O12', site?.name || (typeof site === 'string' ? site : '') || '');

  setCenterVal('E13', formattedBillingDate);

  const ITEM_START_ROW = 16;
  const ITEM_MAX = 11;

  const sortedDetails = [...details].sort((a, b) => {
    const aIsAsset = Boolean(a.contractAssetId);
    const bIsAsset = Boolean(b.contractAssetId);
    if (aIsAsset && !bIsAsset) return -1;
    if (!aIsAsset && bIsAsset) return 1;
    return 0;
  });

  let totalSupply = 0;
  let totalVat = 0;

  for (let i = 0; i < ITEM_MAX; i++) {
    const d = sortedDetails[i];
    const row = ITEM_START_ROW + i;
    if (d) {
      const unitPrice = d.unitPrice || 0;
      const qty = d.quantity || 1;
      const itemSupply = unitPrice * qty;
      const itemVat = Math.round(itemSupply * 0.1);
      totalSupply += itemSupply;
      totalVat += itemVat;

      // 💡 [새 서식 표준] 품목: {모델명}[{관리번호}]_{청구시작일}~{청구종료일}
      const itemDescription = formatStatementItemName(d, billing, contract);

      setCenterVal(`B${row}`, i + 1);
      setCenterVal(`C${row}`, dateM);
      setCenterVal(`D${row}`, dateD);
      setVal(`E${row}`, itemDescription);
      setCenterVal(`L${row}`, qty);
      setNum(`M${row}`, unitPrice);
      setNum(`O${row}`, itemSupply);
      setNum(`Q${row}`, itemVat);
      setVal(`T${row}`, d.memo || d.notes || '');
    } else {
      setVal(`B${row}`, null);
      setVal(`C${row}`, null);
      setVal(`D${row}`, null);
      setVal(`E${row}`, null);
      setVal(`L${row}`, null);
      setVal(`M${row}`, null);
      setVal(`O${row}`, null);
      setVal(`Q${row}`, null);
      setVal(`T${row}`, null);
    }
  }

  // === 하단 합계 행 (Row 27) ===
  const totalGrand = totalSupply + totalVat;
  setNum('E27', totalSupply);
  setNum('J27', totalVat);
  setNum('O27', totalGrand);

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
};
