// src/services/excelTemplateEngine.ts
// e-Bro ERP 엑셀 원본 템플릿 기반 데이터 주입 엔진 (사이트 미연결 독립 모듈)
// ⚠️ 원칙: HTML/CSS 눈대중 모방을 100% 배제하고, 사장님의 실제 .xlsx 엑셀 파일 서식을 100% 보존하며 셀 값만 정밀 주입합니다.

import ExcelJS from 'exceljs';
import { db } from './db';

export interface ExcelCellInjection {
  cell: string; // 예: 'C4', 'D14', 'H7'
  value: string | number | boolean | Date;
}

export interface ExcelImageInjection {
  imageBytes: ArrayBuffer;
  extension: 'png' | 'jpeg';
  range: {
    tl: { col: number; row: number }; // Top-Left 좌표 (0-indexed)
    br?: { col: number; row: number }; // Bottom-Right 좌표 (선택)
    ext?: { width: number; height: number }; // 크기 (선택)
  };
}

export interface SheetInjectionPayload {
  sheetNameOrIndex: string | number;
  cells: ExcelCellInjection[];
  images?: ExcelImageInjection[];
}

export interface ExcelInjectionOptions {
  templateBytes: ArrayBuffer;
  sheets: SheetInjectionPayload[];
}

/**
 * 엑셀 템플릿 바이너리에 실제 비즈니스 데이터를 셀 단위로 주입하여 새로운 엑셀 바이너리를 생성합니다.
 * @param options 템플릿 바이너리 및 시트별 주입 데이터
 * @returns 데이터가 주입된 완성 엑셀 바이너리 (ArrayBuffer)
 */
export async function injectDataIntoExcelTemplate(
  options: ExcelInjectionOptions
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(options.templateBytes);

  for (const sheetPayload of options.sheets) {
    let worksheet: ExcelJS.Worksheet | undefined;

    if (typeof sheetPayload.sheetNameOrIndex === 'number') {
      worksheet = workbook.worksheets[sheetPayload.sheetNameOrIndex];
    } else {
      worksheet = workbook.getWorksheet(sheetPayload.sheetNameOrIndex);
    }

    if (!worksheet) {
      console.warn(`[ExcelTemplateEngine] 시트를 찾을 수 없습니다: ${sheetPayload.sheetNameOrIndex}`);
      continue;
    }

    // 1. 셀 텍스트/숫자 값 주입 (서식·테두리·글꼴 100% 보존)
    for (const item of sheetPayload.cells) {
      const cell = worksheet.getCell(item.cell);
      cell.value = item.value;
    }

    // 2. 직인/도장 이미지 주입 (옵션)
    if (sheetPayload.images && sheetPayload.images.length > 0) {
      for (const img of sheetPayload.images) {
        const imageId = workbook.addImage({
          buffer: img.imageBytes,
          extension: img.extension
        });

        if (img.range.ext) {
          worksheet.addImage(imageId, {
            tl: img.range.tl as any,
            ext: img.range.ext
          });
        } else if (img.range.br) {
          worksheet.addImage(imageId, {
            tl: img.range.tl as any,
            br: img.range.br as any
          });
        }
      }
    }
  }

  const resultBuffer = await workbook.xlsx.writeBuffer();
  return resultBuffer;
}

/**
 * 계약서 양식 데이터 주입 맵퍼 규격 (설계 참고용 인터페이스)
 */
export interface ContractExcelData {
  contractDate: string;        // 계약일자 (YYYY년 MM월 DD일)
  lessorName: string;          // 임대인 상호
  lessorCeo: string;           // 임대인 대표자
  lessorBizNo: string;         // 임대인 사업자등록번호
  lesseeName: string;          // 임차인 상호
  lesseeCeo: string;           // 임차인 대표자
  lesseeBizNo: string;         // 임차인 등록번호
  deliveryLocation: string;    // 장비 인도장소
  siteAddress: string;         // 현장 상세 위치
  deliveryDateTime: string;    // 장비 인도 일시
  managerName: string;         // 현장 담당자
  managerPhone: string;        // 현장 담당자 연락처
  /**
   * 체결 장비 목록
   * ⚠️ 비즈니스 룰:
   * - 12대 이하: 본문 테이블 12줄 내 1:1 직접 표기
   * - 13대 이상: 본문 1행 요약 ('GS-1930 외 N대 (총 N대)') + [별지 제1호: 체결 장비 상세 명세표] 자동 생성
   */
  assets: Array<{
    modelName: string;         // 품목(모델명)
    quantity: number;          // 수량
    serialNo: string;          // 장비 번호(S/N)
    monthlyFee: number;        // 임대료 (월)
    subtotal: number;          // 소계
  }>;
  totalMonthlyFee: number;     // 총 합계
  transportTerms: string;      // 운송료 청구 기준
  hasAnnexList?: boolean;      // 13대 이상 시 별지 생성 여부 (자동 산출)
}

/**
 * 반입전 체크리스트 데이터 주입 맵퍼 규격
 * ⚠️ 실무 규칙:
 * - 점검자(김관주) 및 점검결과(양호), 충전기 작동값(20.7A)은 원본 템플릿에 고정 인쇄되어 있으므로 편집 불필요.
 * - 도장 날인하지 않음.
 * - 오직 상단의 [모델명]과 [관리번호(S/N)] 2개 항목만 동적 주입.
 */
export interface PreDeliveryChecklistExcelData {
  modelName: string;           // 모델명 (예: 'Z-45/25J', 'GS-1930')
  serialNo: string;            // 관리번호 및 S/N (예: 'G19052 (GS30D-13533)')
}

/**
 * 안전점검 결과서 데이터 주입 맵퍼 규격
 * ⚠️ 실무 규칙:
 * - 제조사/장비중량/운행속도/작업높이/안전인증일은 ERP [제품관리] 마스터에서 100% 자동 호출.
 * - 점검자(김관주) 및 도장 날인은 원본 템플릿에 이미 박혀 있으므로 수정 불필요 (100% 원본 보존).
 */
export interface SafetyInspectionExcelData {
  siteName: string;            // 사업장명
  clientName: string;          // 사용업체
  manufacturer: string;        // 제 조 사 (ERP [제품관리] 마스터에서 자동 호출, 예: 'GENIE', 'SINOBOOM', 'DINGLI', 'SKYJACK')
  lessorName?: string;         // 렌탈사 (기본값: 테넌트 상호)
  modelName: string;           // 모델명
  serialNo: string;            // 차량/장비번호
  weight: string;              // 장비중량 (ERP [제품관리] 마스터에서 자동 호출)
  speed: string;               // 운행속도 (ERP [제품관리] 마스터에서 자동 호출)
  maxHeightCapacity: string;   // 작업최대높이/적재용량 (ERP [제품관리] 마스터에서 자동 호출)
  safetyCertDate: string;      // 안전인증년월일 (ERP [제품관리] 마스터에서 자동 호출)
  inspectionDate: string;      // 안전점검일시 (출고일자)
  manufactureYear?: string;    // 제조년도 (ERP [자산대장] 마스터에서 자동 호출)
  inspectorName?: string;      // 점검자 (상시 '김관주' 고정, 원본 보존)
  results?: Record<string, string>; // 검사결과 목록
}

/**
 * 텍스트 오버레이용 투명 캔버스 레이어를 생성하여 PNG 바이트로 반환합니다.
 */
function createTextCanvasLayer(
  width: number,
  height: number,
  drawFn: (ctx: CanvasRenderingContext2D) => void
): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      ctx.textBaseline = 'middle';
      drawFn(ctx);
    }
    canvas.toBlob(async (blob) => {
      if (blob) {
        const buffer = await blob.arrayBuffer();
        resolve(new Uint8Array(buffer));
      } else {
        resolve(new Uint8Array());
      }
    }, 'image/png');
  });
}

/**
 * 1. 고소작업대 임대차 계약서 PDF 생성 (12줄 수용 및 13개 이상 별지 자동 분기)
 * - 기존 셀 내 잔존 텍스트 영역을 100% 화이트아웃 마스킹하여 겹침/낙서 현상 완전 제거
 */
export async function generateContractPdf(data: ContractExcelData): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const res = await fetch('/templates/임대차계약서_양식_원본.pdf');
  if (!res.ok) throw new Error(`계약서 원본 템플릿 로드 실패: HTTP ${res.status}`);

  const templateBytes = await res.arrayBuffer();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();

  // ── [1단계] 기존 템플릿에 들어있던 잔존 텍스트 영역 순백색(White-out) 마스킹 ──
  // (pdf-lib 좌표계: 좌측 하단이 0, 0)
  const white = rgb(1, 1, 1);

  // 상단 계약일자 마스킹
  page.drawRectangle({ x: 200, y: height - 105, width: 200, height: 16, color: white });

  // 임차인(을) 등록번호, 상호, 대표자 마스킹
  page.drawRectangle({ x: 380, y: height - 130, width: 180, height: 15, color: white });
  page.drawRectangle({ x: 380, y: height - 150, width: 180, height: 15, color: white });
  page.drawRectangle({ x: 380, y: height - 170, width: 180, height: 15, color: white });

  // 인도장소, 인도일시, 상세주소, 담당자, 연락처 마스킹
  page.drawRectangle({ x: 120, y: height - 222, width: 200, height: 15, color: white });
  page.drawRectangle({ x: 395, y: height - 222, width: 165, height: 15, color: white });
  page.drawRectangle({ x: 120, y: height - 240, width: 440, height: 15, color: white });
  page.drawRectangle({ x: 120, y: height - 276, width: 200, height: 15, color: white });
  page.drawRectangle({ x: 395, y: height - 276, width: 165, height: 15, color: white });

  // 체결 장비 그리드 12행 전체 화이트아웃 마스킹 (기존 옛날 데이터 전면 삭제)
  page.drawRectangle({ x: 35, y: height - 528, width: 525, height: 218, color: white });

  // 합계 금액 영역 마스킹
  page.drawRectangle({ x: 395, y: height - 425, width: 165, height: 18, color: white });

  // 하단 영업담당자 영역 마스킹
  page.drawRectangle({ x: 375, y: height - 765, width: 180, height: 15, color: white });

  // ── [2단계] 정밀 폰트 텍스트 렌더링 ──
  const scale = 3.5;
  const canvasW = width * scale;
  const canvasH = height * scale;

  const overlayPng = await createTextCanvasLayer(canvasW, canvasH, (ctx) => {
    ctx.fillStyle = '#111827';

    // 1. 계약 체결일자 (상단 중앙)
    ctx.font = 'bold 30px "Malgun Gothic", "맑은 고딕", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(data.contractDate || new Date().toISOString().split('T')[0], canvasW * 0.5, canvasH * 0.115);

    // 2. 임차인(을) 정보
    ctx.textAlign = 'left';
    ctx.font = '500 24px "Malgun Gothic", "맑은 고딕", sans-serif';
    ctx.fillText(data.lesseeBizNo || '', canvasW * 0.65, canvasH * 0.144);
    ctx.fillText(data.lesseeName || '', canvasW * 0.65, canvasH * 0.168);
    ctx.fillText(data.lesseeCeo || '', canvasW * 0.65, canvasH * 0.192);

    // 3. 임대차 계약 내용 (현장 및 대리인)
    ctx.fillText(data.deliveryLocation || '', canvasW * 0.21, canvasH * 0.254);
    ctx.fillText(data.deliveryDateTime || '', canvasW * 0.67, canvasH * 0.254);
    ctx.fillText(data.siteAddress || '', canvasW * 0.21, canvasH * 0.276);
    ctx.fillText(data.managerName || '', canvasW * 0.21, canvasH * 0.318);
    ctx.fillText(data.managerPhone || '', canvasW * 0.67, canvasH * 0.318);

    // 4. 체결 장비 12줄 그리드
    const isOver12 = data.assets.length >= 13;
    const startY = canvasH * 0.380;
    const rowHeight = canvasH * 0.0216;

    if (isOver12) {
      ctx.fillText(`${data.assets[0]?.modelName || '고소작업대'} 외 ${data.assets.length - 1}대 (총 ${data.assets.length}대)`, canvasW * 0.08, startY);
      ctx.textAlign = 'center';
      ctx.fillText(`${data.assets.length}`, canvasW * 0.22, startY);
      ctx.textAlign = 'left';
      ctx.fillText('[별지 제1호: 체결 장비 상세 명세표 참조]', canvasW * 0.27, startY);
      ctx.textAlign = 'right';
      ctx.fillText(data.totalMonthlyFee ? data.totalMonthlyFee.toLocaleString() : '-', canvasW * 0.58, startY);
    } else {
      data.assets.forEach((asset, idx) => {
        if (idx >= 12) return;
        const currentY = startY + idx * rowHeight;
        ctx.textAlign = 'left';
        ctx.fillText(asset.modelName || '', canvasW * 0.08, currentY);
        ctx.textAlign = 'center';
        ctx.fillText(`${asset.quantity || 1}`, canvasW * 0.22, currentY);
        ctx.textAlign = 'left';
        ctx.fillText(asset.serialNo || '', canvasW * 0.26, currentY);
        ctx.textAlign = 'right';
        ctx.fillText(asset.monthlyFee ? asset.monthlyFee.toLocaleString() : '', canvasW * 0.49, currentY);
        ctx.fillText(asset.subtotal ? asset.subtotal.toLocaleString() : '', canvasW * 0.58, currentY);
      });
    }

    // 5. 합계 금액
    ctx.font = 'bold 28px "Malgun Gothic", "맑은 고딕", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`₩ ${(data.totalMonthlyFee || 0).toLocaleString()}`, canvasW * 0.92, canvasH * 0.494);

    // 6. 영업 담당자 정보
    ctx.textAlign = 'left';
    ctx.font = '500 24px "Malgun Gothic", "맑은 고딕", sans-serif';
    if (data.managerName) {
      ctx.fillText(data.managerName, canvasW * 0.65, canvasH * 0.900);
    }
  });

  const embeddedImage = await pdfDoc.embedPng(overlayPng);
  page.drawImage(embeddedImage, {
    x: 0,
    y: 0,
    width,
    height
  });

  return await pdfDoc.save();
}

/**
 * 2. 반입 전 CHECK LIST PDF 생성
 * - 상단 [모델명], [관리번호(S/N)] 셀 영역 화이트아웃 마스킹 후 정밀 주입
 */
export async function generateChecklistPdf(data: PreDeliveryChecklistExcelData): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const res = await fetch('/templates/반입전체크리스트_양식_원본.pdf');
  if (!res.ok) throw new Error(`체크리스트 원본 템플릿 로드 실패: HTTP ${res.status}`);

  const templateBytes = await res.arrayBuffer();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();
  const white = rgb(1, 1, 1);

  // 상단 모델명 및 관리번호(S/N) 기존 텍스트 셀 화이트아웃 마스킹
  page.drawRectangle({ x: 180, y: height - 46, width: 140, height: 16, color: white });
  page.drawRectangle({ x: 410, y: height - 46, width: 150, height: 16, color: white });

  const scale = 3.5;
  const canvasW = width * scale;
  const canvasH = height * scale;

  const overlayPng = await createTextCanvasLayer(canvasW, canvasH, (ctx) => {
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 26px "Malgun Gothic", "맑은 고딕", sans-serif';

    // 1. 상단 모델명 (가로/세로 중앙 맞춤)
    ctx.textAlign = 'left';
    ctx.fillText(data.modelName || '', canvasW * 0.32, canvasH * 0.045);

    // 2. 상단 관리번호 (S/N)
    ctx.fillText(data.serialNo || '', canvasW * 0.71, canvasH * 0.045);
  });

  const embeddedImage = await pdfDoc.embedPng(overlayPng);
  page.drawImage(embeddedImage, {
    x: 0,
    y: 0,
    width,
    height
  });

  return await pdfDoc.save();
}

/**
 * 3. 고소작업대(T/L) 안전점검 결과서 PDF 생성
 * - 상단 헤더 5행의 기존 텍스트 셀 전체 화이트아웃 마스킹 후 ERP 마스터 제원 정밀 주입
 * - 점검자(김관주) 및 도장 날인은 원본 보존
 */
export async function generateSafetyInspectionPdf(data: SafetyInspectionExcelData): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const res = await fetch('/templates/안전점검결과서_양식_원본.pdf');
  if (!res.ok) throw new Error(`안전점검결과서 원본 템플릿 로드 실패: HTTP ${res.status}`);

  const templateBytes = await res.arrayBuffer();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();
  const white = rgb(1, 1, 1);

  // 상단 헤더 5개 행의 데이터 영역 화이트아웃 마스킹
  // Row 1: 사업장명, 제조사
  page.drawRectangle({ x: 105, y: height - 58, width: 220, height: 14, color: white });
  page.drawRectangle({ x: 420, y: height - 58, width: 140, height: 14, color: white });

  // Row 2: 사용업체, 모델명
  page.drawRectangle({ x: 105, y: height - 73, width: 220, height: 14, color: white });
  page.drawRectangle({ x: 420, y: height - 73, width: 140, height: 14, color: white });

  // Row 3: 장비중량, 운행속도, 작업높이/용량
  page.drawRectangle({ x: 105, y: height - 88, width: 100, height: 14, color: white });
  page.drawRectangle({ x: 270, y: height - 88, width: 60, height: 14, color: white });
  page.drawRectangle({ x: 420, y: height - 88, width: 140, height: 14, color: white });

  // Row 4: 차량(관리)번호, 제조년도, 안전인증년월일
  page.drawRectangle({ x: 105, y: height - 103, width: 100, height: 14, color: white });
  page.drawRectangle({ x: 270, y: height - 103, width: 60, height: 14, color: white });
  page.drawRectangle({ x: 420, y: height - 103, width: 140, height: 14, color: white });

  // Row 5: 안전점검일시
  page.drawRectangle({ x: 105, y: height - 118, width: 220, height: 14, color: white });

  const scale = 3.5;
  const canvasW = width * scale;
  const canvasH = height * scale;

  const overlayPng = await createTextCanvasLayer(canvasW, canvasH, (ctx) => {
    ctx.fillStyle = '#111827';
    ctx.font = '500 23px "Malgun Gothic", "맑은 고딕", sans-serif';
    ctx.textAlign = 'left';

    // Row 1: 사업장명, 제조사 (렌탈사)
    ctx.fillText(data.siteName || '', canvasW * 0.19, canvasH * 0.059);
    const mfgText = `${data.manufacturer || 'GENIE'} ${data.lessorName || db.currentTenant?.tradeName || '(주)임대인'}`;
    ctx.fillText(mfgText, canvasW * 0.72, canvasH * 0.059);

    // Row 2: 사용업체, 모델명
    ctx.fillText(data.clientName || '', canvasW * 0.19, canvasH * 0.076);
    ctx.fillText(data.modelName || '', canvasW * 0.72, canvasH * 0.076);

    // Row 3: 장비중량, 운행속도, 작업높이/적재용량
    ctx.fillText(data.weight || '', canvasW * 0.19, canvasH * 0.093);
    ctx.fillText(data.speed || '', canvasW * 0.46, canvasH * 0.093);
    ctx.fillText(data.maxHeightCapacity || '', canvasW * 0.72, canvasH * 0.093);

    // Row 4: 차량(관리)번호, 제조년도, 안전인증년월일
    ctx.fillText(data.serialNo || '', canvasW * 0.19, canvasH * 0.111);
    ctx.fillText(data.manufactureYear || '', canvasW * 0.46, canvasH * 0.111);
    ctx.fillText(data.safetyCertDate || '', canvasW * 0.72, canvasH * 0.111);

    // Row 5: 안전점검일시
    ctx.fillText(data.inspectionDate || new Date().toISOString().split('T')[0], canvasW * 0.19, canvasH * 0.129);
  });

  const embeddedImage = await pdfDoc.embedPng(overlayPng);
  page.drawImage(embeddedImage, {
    x: 0,
    y: 0,
    width,
    height
  });

  return await pdfDoc.save();
}

/**
 * 거래명세서 정품 A4 PDF 렌더링 규격 인터페이스
 */
export interface TransactionStatementItem {
  month: number;
  day: number;
  itemDescription: string; // {모델명}[{관리번호}]_{청구시작일}~{청구종료일}
  quantity: number;
  unitPrice: number;
  supplyAmount: number;
  vatAmount: number;
  notes?: string;
}

export interface TransactionStatementPdfData {
  billingDate: string; // YYYY-MM-DD
  billingYm: string;   // YYYY-MM
  contractNo?: string;

  // 공급자 (당사)
  lessorBizNo?: string;
  lessorName?: string;
  lessorCeo?: string;
  lessorAddress?: string;
  salespersonName?: string;
  salespersonPhone?: string;
  billingManagerName?: string;
  billingManagerPhone?: string;
  lessorEmail?: string;

  // 공급받는 자 (고객사)
  customerBizNo?: string;
  customerName?: string;
  customerCeo?: string;
  customerAddress?: string;
  customerBizType?: string;
  customerBizItem?: string;
  siteManagerName?: string;
  siteManagerPhone?: string;
  custBillingManagerName?: string;
  custBillingManagerPhone?: string;
  custBillingEmail?: string;
  siteName?: string;
  bankAccount?: string;

  // 품목 내역 (최대 11행)
  items: TransactionStatementItem[];

  totalSupply: number;
  totalVat: number;
  totalGrand: number;
}

/**
 * 4. ERP 공식 표준 거래명세서 정품 A4 PDF 생성 엔진 (MS Excel COM 전용)
 * ⚠️ 원칙: 2D Canvas 눈대중 모방을 100% 영구 배제하고, 로컬 사이드카 에이전트의 정품 MS Excel COM 엔진(00.거래명세서양식.xlsx 정품 원본 기반)만을 사용합니다.
 */
export async function generateTransactionStatementPdf(data: TransactionStatementPdfData): Promise<Uint8Array> {
  try {
    const agentResp = await fetch('http://127.0.0.1:5175/api/generate-statement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (agentResp.ok) {
      const agentRes = await agentResp.json();
      if (agentRes.success && agentRes.base64Content) {
        const binaryStr = atob(agentRes.base64Content);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        return bytes;
      }
      throw new Error(agentRes.error || '엑셀 COM 엔진 PDF 변환 실패');
    }
    throw new Error(`에이전트 응답 오류 (HTTP ${agentResp.status})`);
  } catch (agentErr: any) {
    throw new Error(
      `⚠️ 로컬 엑셀 COM 에이전트(eBroAgent) 연결 불가:\n\n` +
      `거래명세서 PDF는 정품 MS Excel COM 엔진을 통해서만 생성됩니다.\n` +
      `C:\\eBroAgent\\eBroAgent.js 또는 eBroAgent.exe 가 실행 중인지 확인해 주세요.\n` +
      `(원인: ${agentErr?.message || agentErr})`
    );
  }
}

/**
 * 5. 거래명세서 정품 엑셀 파일(.xlsx) 원본 생성 엔진
 * - 템플릿: public/00.거래명세서양식.xlsx
 * - ExcelJS를 통해 셀 단위로 데이터를 주입한 정품 .xlsx 바이너리 반환
 */
export async function generateTransactionStatementExcel(data: TransactionStatementPdfData): Promise<ArrayBuffer> {
  const resp = await fetch('/00.거래명세서양식.xlsx');
  if (!resp.ok) {
    throw new Error('거래명세서 엑셀 마스터 템플릿(00.거래명세서양식.xlsx)을 불러올 수 없습니다.');
  }
  const templateBytes = await resp.arrayBuffer();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBytes);
  const baseWs = workbook.worksheets[0];
  if (!baseWs) throw new Error('엑셀 템플릿 워크시트를 찾을 수 없습니다.');

  // 11개 단위 분할
  const items = data.items || [];
  const chunkSize = 11;
  const chunks: TransactionStatementItem[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  if (chunks.length === 0) chunks.push([]);
  const totalPages = chunks.length;

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const chunk = chunks[pageIdx];
    const pageNum = pageIdx + 1;
    const pageTag = totalPages > 1 ? ` ( ${pageNum} / ${totalPages} 쪽 )` : '';
    const startGlobalIdx = pageIdx * chunkSize;

    // 첫 번째 시트는 기존 시트 사용, 이후 시트는 복제
    let ws: ExcelJS.Worksheet;
    if (pageIdx === 0) {
      ws = baseWs;
      ws.name = totalPages > 1 ? `거래명세서_1` : '거래명세서';
    } else {
      // 시트 복제 및 서식 유지 (또는 신규 시트에 복사)
      ws = workbook.addWorksheet(`거래명세서_${pageNum}`);
      ws.model = JSON.parse(JSON.stringify(baseWs.model));
      ws.name = `거래명세서_${pageNum}`;
    }

    // 태그 치환 헬퍼
    const replaceTagInSheet = (tag: string, val: string) => {
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.value && typeof cell.value === 'string' && cell.value.includes(tag)) {
            cell.value = cell.value.replace(tag, val);
          }
        });
      });
    };

    // 1. 공급자/공급받는자 태그 치환
    replaceTagInSheet('{사업자등록번호}', data.customerBizNo || '-');
    replaceTagInSheet('{고객명}', data.customerName || '-');
    replaceTagInSheet('{대표자}', data.customerCeo || '-');
    replaceTagInSheet('{주소}', data.customerAddress || '-');
    replaceTagInSheet('{업태}', data.customerBizType || '-');
    replaceTagInSheet('{종목}', data.customerBizItem || '-');
    replaceTagInSheet('{현장담당자}', data.siteManagerName || '-');
    replaceTagInSheet('{현장담당자연락처}', data.siteManagerPhone || '-');
    replaceTagInSheet('{계산서담당자}', data.custBillingManagerName || '-');
    replaceTagInSheet('{계산서담당자연락처}', data.custBillingManagerPhone || '-');
    replaceTagInSheet('{계산서이메일}', data.custBillingEmail || '-');
    replaceTagInSheet('{현장명}', `${data.siteName || '-'}${pageTag}`);

    replaceTagInSheet('{영업사원}', data.salespersonName || '-');
    replaceTagInSheet('{영업사원연락처}', data.salespersonPhone || '-');
    replaceTagInSheet('{청구담당자}', data.billingManagerName || '정수아');
    replaceTagInSheet('{청구담당자연락처}', data.billingManagerPhone || '031-334-5295');

    // 작성일자 (E13)
    ws.getCell('E13').value = `${data.billingDate || new Date().toISOString().split('T')[0]}${pageTag}`;

    // 2. 품목 11행 기입 (Row 16 ~ Row 26)
    for (let i = 0; i < 11; i++) {
      const rowNum = 16 + i;
      const item = chunk[i];
      if (item) {
        ws.getCell(`B${rowNum}`).value = startGlobalIdx + i + 1;
        ws.getCell(`C${rowNum}`).value = item.month || '';
        ws.getCell(`D${rowNum}`).value = item.day || '';
        ws.getCell(`E${rowNum}`).value = item.itemDescription || '';
        ws.getCell(`L${rowNum}`).value = item.quantity || 1;
        ws.getCell(`M${rowNum}`).value = item.unitPrice ? item.unitPrice.toLocaleString() : '';
        ws.getCell(`O${rowNum}`).value = item.supplyAmount ? item.supplyAmount.toLocaleString() : '';
        ws.getCell(`Q${rowNum}`).value = item.vatAmount ? item.vatAmount.toLocaleString() : '';
        ws.getCell(`T${rowNum}`).value = item.notes || '';
      } else {
        ws.getCell(`B${rowNum}`).value = '';
        ws.getCell(`C${rowNum}`).value = '';
        ws.getCell(`D${rowNum}`).value = '';
        ws.getCell(`E${rowNum}`).value = '';
        ws.getCell(`L${rowNum}`).value = '';
        ws.getCell(`M${rowNum}`).value = '';
        ws.getCell(`O${rowNum}`).value = '';
        ws.getCell(`Q${rowNum}`).value = '';
        ws.getCell(`T${rowNum}`).value = '';
      }
    }

    // 3. 합계 치환
    replaceTagInSheet('{공급가합계}', data.totalSupply.toLocaleString());
    replaceTagInSheet('{부가세합계}', data.totalVat.toLocaleString());
    replaceTagInSheet('{총액}', data.totalGrand.toLocaleString());
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * 엑셀 정품 PDF 템플릿 로더 (하위 호환)
 */
export async function generateSafetyInspectionPdfFromExcelTemplate(
  data?: Partial<SafetyInspectionExcelData>
): Promise<Uint8Array> {
  return generateSafetyInspectionPdf({
    siteName: data?.siteName || '',
    clientName: data?.clientName || '',
    manufacturer: data?.manufacturer || 'GENIE',
    modelName: data?.modelName || 'GS-1930',
    serialNo: data?.serialNo || 'G19052',
    weight: data?.weight || '1,500 kg',
    speed: data?.speed || '4.0 Km/h',
    maxHeightCapacity: data?.maxHeightCapacity || '7.8 M / 227 kg',
    safetyCertDate: data?.safetyCertDate || '2024-03-01',
    inspectionDate: data?.inspectionDate || new Date().toISOString().split('T')[0]
  });
}

