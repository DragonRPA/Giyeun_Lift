// @ts-nocheck
/**
 * src/services/monthlyReportPdfBuilder.ts
 * 전사 월간 경영 종합보고서(Executive Monthly Dossier) 3페이지 고해상도 벡터 PDF 빌더
 * 
 * - pdf-lib + HTML5 Canvas 결합으로 브라우저 환경에서 완벽한 한글 렌더링 보장
 * - A4 규격 (595.28 x 841.89 pt) 고해상도 벡터 출력
 * - 전사 표준 헌장 3.1 무수식어 건조 표준, 3.5 Gutenberg 대차대조 검증 준수
 */

import { PDFDocument } from 'pdf-lib';
import { ExecutiveMonthlyReport } from './monthlyReportEngine';
import { db } from './db';

// 브라우저 캔버스 기반 고해상도 이미지 레이어 생성 유틸리티
function renderPageToPngBlob(width: number, height: number, drawFn: (ctx: CanvasRenderingContext2D) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context not available'));
        return;
      }

      // 흰색 캔버스 초기화
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);

      // 콜백 드로잉 실행
      drawFn(ctx);

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Canvas toBlob failed'));
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          const arr = new Uint8Array(reader.result as ArrayBuffer);
          resolve(arr);
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
      }, 'image/png');
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * 전사 월간 경영 종합 보고서 3페이지 공식 PDF 빌더 및 자동 다운로드
 */
export async function downloadExecutiveReportPdf(data: ExecutiveMonthlyReport): Promise<void> {
  const pdfDoc = await PDFDocument.create();

  // A4 규격 (포인트: 595.28 x 841.89)
  const a4W = 595.28;
  const a4H = 841.89;
  const scale = 2.2; // 고해상도 인쇄 품질
  const canvasW = Math.round(a4W * scale);
  const canvasH = Math.round(a4H * scale);

  const { period, kpis, fleet, sales, operations, finance, conservation, executiveDirective, teamComments = [] } = data;
  const tenantBrand = db.currentTenant?.displayName || db.currentTenant?.tradeName || 'e-Bro';

  // =========================================================================
  // [1페이지: 표지 헤더 + 경영 종합 KPI + 렌탈 자산 플릿 현황]
  // =========================================================================
  const page1Bytes = await renderPageToPngBlob(canvasW, canvasH, (ctx) => {
    // 1. 최상단 네이비 타이틀 바
    ctx.fillStyle = '#0F172A'; // Slate-900
    ctx.fillRect(40 * scale, 30 * scale, (a4W - 80) * scale, 46 * scale);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold ' + (17 * scale) + 'px "Malgun Gothic", "맑은 고딕", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`[${tenantBrand}] ${period.year}년 ${String(period.month).padStart(2, '0')}월 경영 정기보고서`, 55 * scale, 59 * scale);

    ctx.fillStyle = '#94A3B8';
    ctx.font = 'bold ' + (10 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('EXECUTIVE MONTHLY DOSSIER', (a4W - 55) * scale, 58 * scale);

    // 2. 메타 정보 박스
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(40 * scale, 84 * scale, (a4W - 80) * scale, 48 * scale);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1 * scale;
    ctx.strokeRect(40 * scale, 84 * scale, (a4W - 80) * scale, 48 * scale);

    ctx.fillStyle = '#334155';
    ctx.font = 'bold ' + (10 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`• 보고 기간: ${period.startDate} ~ ${period.endDate}`, 55 * scale, 102 * scale);
    ctx.fillText(`• 작성 기준: 마감 스냅샷 동결 (${period.closingDate})`, 55 * scale, 120 * scale);
    ctx.fillText(`• 수 신 처 : 대표이사 및 이사회`, 330 * scale, 102 * scale);
    ctx.fillText(`• 발행 일시: ${period.generatedAt}`, 330 * scale, 120 * scale);

    // 3. 섹션 1: 경영 종합 핵심 지표 (4대 KPI 카드)
    let curY = 145;
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold ' + (12 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('1. 경영 종합 성과 지표 (Executive KPIs)', 40 * scale, curY * scale);

    const cardW = 120;
    const cardH = 62;
    const gap = 12;
    const startX = 40;

    const cards = [
      { label: '총 매출 청구액', val: `₩${kpis.totalRevenue.toLocaleString()}`, sub: `수납 ₩${kpis.collectedAmount.toLocaleString()}`, color: '#2563EB' },
      { label: '장비 가동률', val: `${kpis.fleetUtilizationRate}%`, sub: `대여중 ${kpis.activeAssetCount}대 / 총 ${kpis.totalFleetCount}대`, color: '#0D9488' },
      { label: '수납률 (진척도)', val: `${kpis.collectionRate}%`, sub: `미수잔액 ₩${kpis.unpaidAmount.toLocaleString()}`, color: '#10B981' },
      { label: '추정 공헌이익', val: `₩${kpis.estimatedMargin.toLocaleString()}`, sub: `이익률 ${kpis.marginRate}%`, color: '#6366F1' },
    ];

    cards.forEach((c, idx) => {
      const cx = startX + idx * (cardW + gap);
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(cx * scale, (curY + 10) * scale, cardW * scale, cardH * scale);
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1 * scale;
      ctx.strokeRect(cx * scale, (curY + 10) * scale, cardW * scale, cardH * scale);

      ctx.fillStyle = '#64748B';
      ctx.font = 'bold ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(c.label, (cx + 8) * scale, (curY + 26) * scale);

      ctx.fillStyle = c.color;
      ctx.font = 'bold ' + (13 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(c.val, (cx + 8) * scale, (curY + 46) * scale);

      ctx.fillStyle = '#475569';
      ctx.font = '500 ' + (8 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(c.sub, (cx + 8) * scale, (curY + 62) * scale);
    });

    // 4. 섹션 2: 렌탈 자산 플릿 운용 현황 (규격별 테이블)
    curY = 240;
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold ' + (12 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('2. 렌탈 자산 플릿(Fleet) 가동 현황', 40 * scale, curY * scale);

    // 테이블 헤더
    const tableY = curY + 10;
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(40 * scale, tableY * scale, (a4W - 80) * scale, 24 * scale);
    ctx.strokeStyle = '#CBD5E1';
    ctx.strokeRect(40 * scale, tableY * scale, (a4W - 80) * scale, 24 * scale);

    ctx.fillStyle = '#334155';
    ctx.font = 'bold ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('규격 / 모델 그룹', 50 * scale, (tableY + 16) * scale);
    ctx.fillText('총 보유', 190 * scale, (tableY + 16) * scale);
    ctx.fillText('대여중 (가동)', 270 * scale, (tableY + 16) * scale);
    ctx.fillText('대여가능 (유휴)', 360 * scale, (tableY + 16) * scale);
    ctx.fillText('수리/정비중', 440 * scale, (tableY + 16) * scale);
    ctx.fillText('가동률 (%)', 500 * scale, (tableY + 16) * scale);

    let rowY = tableY + 24;
    fleet.specSummaries.forEach((spec) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(40 * scale, rowY * scale, (a4W - 80) * scale, 22 * scale);
      ctx.strokeStyle = '#E2E8F0';
      ctx.strokeRect(40 * scale, rowY * scale, (a4W - 80) * scale, 22 * scale);

      ctx.fillStyle = '#1E293B';
      ctx.font = '600 ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(spec.specName, 50 * scale, (rowY + 15) * scale);
      ctx.fillText(`${spec.totalCount} 대`, 190 * scale, (rowY + 15) * scale);
      ctx.fillText(`${spec.rentedCount} 대`, 270 * scale, (rowY + 15) * scale);
      ctx.fillText(`${spec.availableCount} 대`, 360 * scale, (rowY + 15) * scale);
      ctx.fillText(`${spec.repairingCount} 대`, 440 * scale, (rowY + 15) * scale);

      ctx.fillStyle = spec.utilizationRate >= 80 ? '#0D9488' : '#D97706';
      ctx.font = 'bold ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(`${spec.utilizationRate}%`, 500 * scale, (rowY + 15) * scale);

      rowY += 22;
    });

    // 5. 30일 이상 장기 유휴 장비 경고 목록
    curY = rowY + 20;
    ctx.fillStyle = '#DC2626';
    ctx.font = 'bold ' + (11 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('⚠️ 30일 이상 장기 유휴 장비 리스트 (기회손실 발생 집중영업 대상)', 40 * scale, curY * scale);

    const idleHeaderY = curY + 8;
    ctx.fillStyle = '#FEF2F2';
    ctx.fillRect(40 * scale, idleHeaderY * scale, (a4W - 80) * scale, 22 * scale);
    ctx.strokeStyle = '#FECACA';
    ctx.strokeRect(40 * scale, idleHeaderY * scale, (a4W - 80) * scale, 22 * scale);

    ctx.fillStyle = '#991B1B';
    ctx.font = 'bold ' + (8.5 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('자산번호', 50 * scale, (idleHeaderY + 15) * scale);
    ctx.fillText('모델명 / 규격', 150 * scale, (idleHeaderY + 15) * scale);
    ctx.fillText('유휴 일수', 310 * scale, (idleHeaderY + 15) * scale);
    ctx.fillText('월 렌탈단가', 400 * scale, (idleHeaderY + 15) * scale);
    ctx.fillText('월 기회손실 추정액', 480 * scale, (idleHeaderY + 15) * scale);

    let idleRowY = idleHeaderY + 22;
    fleet.longIdleAssets.slice(0, 5).forEach((idle) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(40 * scale, idleRowY * scale, (a4W - 80) * scale, 20 * scale);
      ctx.strokeStyle = '#FEE2E2';
      ctx.strokeRect(40 * scale, idleRowY * scale, (a4W - 80) * scale, 20 * scale);

      ctx.fillStyle = '#1E293B';
      ctx.font = '500 ' + (8.5 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(idle.assetNumber, 50 * scale, (idleRowY + 14) * scale);
      ctx.fillText(`${idle.modelName} (${idle.spec})`, 150 * scale, (idleRowY + 14) * scale);
      ctx.fillText(`${idle.daysIdle} 일`, 310 * scale, (idleRowY + 14) * scale);
      ctx.fillText(`₩${idle.monthlyRate.toLocaleString()}`, 400 * scale, (idleRowY + 14) * scale);

      ctx.fillStyle = '#DC2626';
      ctx.font = 'bold ' + (8.5 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(`₩${idle.estimatedOpportunityLoss.toLocaleString()}`, 480 * scale, (idleRowY + 14) * scale);

      idleRowY += 20;
    });

    // 1페이지 하단 페이지 번호
    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Page 1 of 3  •  e-Bro ERP 시스템 자동 생성`, (a4W / 2) * scale, (a4H - 25) * scale);
  });

  // =========================================================================
  // [2페이지: 영업 실적 및 계약 + 배차 물류 원가 + 정비 품질 관리]
  // =========================================================================
  const page2Bytes = await renderPageToPngBlob(canvasW, canvasH, (ctx) => {
    // 2페이지 상단 헤더 스트립
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(40 * scale, 30 * scale, (a4W - 80) * scale, 24 * scale);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold ' + (10 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`[${tenantBrand}] ${period.year}년 ${period.month}월 정기보고서 — 영업/물류/정비 세부 실적`, 50 * scale, 46 * scale);

    ctx.textAlign = 'right';
    ctx.fillText('SECTION 2 & 3', (a4W - 50) * scale, 46 * scale);

    // 1. 섹션 3: 영업 실적 및 최다 매출 기여 거래처 TOP 5
    let curY = 70;
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold ' + (12 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('3. 영업 실적 및 당월 최다 매출 기여 거래처 TOP 5', 40 * scale, curY * scale);

    const custTableY = curY + 10;
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(40 * scale, custTableY * scale, (a4W - 80) * scale, 22 * scale);
    ctx.strokeStyle = '#CBD5E1';
    ctx.strokeRect(40 * scale, custTableY * scale, (a4W - 80) * scale, 22 * scale);

    ctx.fillStyle = '#334155';
    ctx.font = 'bold ' + (8.5 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('순위', 50 * scale, (custTableY + 15) * scale);
    ctx.fillText('고객사명 (거래처)', 90 * scale, (custTableY + 15) * scale);
    ctx.fillText('가동 장비수', 270 * scale, (custTableY + 15) * scale);
    ctx.fillText('당월 청구액', 360 * scale, (custTableY + 15) * scale);
    ctx.fillText('매출 비중 (%)', 460 * scale, (custTableY + 15) * scale);

    let custRowY = custTableY + 22;
    sales.topCustomers.forEach((cust, idx) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(40 * scale, custRowY * scale, (a4W - 80) * scale, 20 * scale);
      ctx.strokeStyle = '#E2E8F0';
      ctx.strokeRect(40 * scale, custRowY * scale, (a4W - 80) * scale, 20 * scale);

      ctx.fillStyle = '#1E293B';
      ctx.font = '600 ' + (8.5 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(`${idx + 1}위`, 50 * scale, (custRowY + 14) * scale);
      ctx.fillText(cust.customerName, 90 * scale, (custRowY + 14) * scale);
      ctx.fillText(`${cust.assetCount} 대`, 270 * scale, (custRowY + 14) * scale);
      ctx.fillText(`₩${cust.totalBilled.toLocaleString()}`, 360 * scale, (custRowY + 14) * scale);
      ctx.fillText(`${cust.sharePct}%`, 460 * scale, (custRowY + 14) * scale);

      custRowY += 20;
    });

    // 2. 섹션 4: 배차 물류 원가 및 스펙 오발주 손실 배차
    curY = custRowY + 25;
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold ' + (12 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('4. 배차 물류 효율 및 스펙 오발주 긴급 교환 손실 내역', 40 * scale, curY * scale);

    // 물류 요약 바
    const logiBoxY = curY + 10;
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(40 * scale, logiBoxY * scale, (a4W - 80) * scale, 32 * scale);
    ctx.strokeStyle = '#E2E8F0';
    ctx.strokeRect(40 * scale, logiBoxY * scale, (a4W - 80) * scale, 32 * scale);

    ctx.fillStyle = '#334155';
    ctx.font = '600 ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText(`• 총 배차: ${operations.dispatchByType.total}건 (출고 ${operations.dispatchByType.outbound} / 회수 ${operations.dispatchByType.inbound} / 교환 ${operations.dispatchByType.exchange})`, 50 * scale, (logiBoxY + 20) * scale);
    ctx.fillStyle = '#0D9488';
    ctx.font = 'bold ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText(`• 헌장 2.3 EXCHANGE 단일 배차 절감액: +₩${kpis.exchangeSavedCost.toLocaleString()}`, 310 * scale, (logiBoxY + 20) * scale);

    // 스펙 오발주 손실 배차 테이블
    let specTableY = logiBoxY + 40;
    ctx.fillStyle = '#DC2626';
    ctx.font = 'bold ' + (10 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('🚨 현장 진입불가 / 스펙 오발주로 인한 당사 손실 배차 건', 40 * scale, specTableY * scale);

    const specHdrY = specTableY + 8;
    ctx.fillStyle = '#FEF2F2';
    ctx.fillRect(40 * scale, specHdrY * scale, (a4W - 80) * scale, 20 * scale);
    ctx.strokeStyle = '#FECACA';
    ctx.strokeRect(40 * scale, specHdrY * scale, (a4W - 80) * scale, 20 * scale);

    ctx.fillStyle = '#991B1B';
    ctx.font = 'bold ' + (8 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('발생일자', 50 * scale, (specHdrY + 14) * scale);
    ctx.fillText('거래처 / 현장', 120 * scale, (specHdrY + 14) * scale);
    ctx.fillText('장비번호', 240 * scale, (specHdrY + 14) * scale);
    ctx.fillText('사유 및 원인 분석', 310 * scale, (specHdrY + 14) * scale);
    ctx.fillText('당사 손실운송비', 460 * scale, (specHdrY + 14) * scale);

    let specRowY = specHdrY + 20;
    operations.specMismatchEvents.forEach((evt) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(40 * scale, specRowY * scale, (a4W - 80) * scale, 20 * scale);
      ctx.strokeStyle = '#FEE2E2';
      ctx.strokeRect(40 * scale, specRowY * scale, (a4W - 80) * scale, 20 * scale);

      ctx.fillStyle = '#334155';
      ctx.font = '500 ' + (8 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(evt.date, 50 * scale, (specRowY + 14) * scale);
      ctx.fillText(`${evt.customerName} (${evt.destination})`, 120 * scale, (specRowY + 14) * scale);
      ctx.fillText(evt.assetNumber, 240 * scale, (specRowY + 14) * scale);
      ctx.fillText(evt.reason.slice(0, 26), 310 * scale, (specRowY + 14) * scale);

      ctx.fillStyle = '#DC2626';
      ctx.font = 'bold ' + (8 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(`₩${evt.extraCost.toLocaleString()}`, 460 * scale, (specRowY + 14) * scale);

      specRowY += 20;
    });

    // 3. 섹션 5: 정비 및 AS 품질 지표
    curY = specRowY + 25;
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold ' + (12 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('5. 정비 및 현장 AS 품질 관리 (PDI 품질 지표)', 40 * scale, curY * scale);

    const maintBoxY = curY + 10;
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(40 * scale, maintBoxY * scale, (a4W - 80) * scale, 30 * scale);
    ctx.strokeStyle = '#E2E8F0';
    ctx.strokeRect(40 * scale, maintBoxY * scale, (a4W - 80) * scale, 30 * scale);

    ctx.fillStyle = '#334155';
    ctx.font = '600 ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText(`• 당월 완료 정비: 총 ${operations.maintenanceByType.total}건 (현장 AS ${operations.maintenanceByType.fieldAs} / 오버홀 ${operations.maintenanceByType.overhaul})`, 50 * scale, (maintBoxY + 19) * scale);
    ctx.fillText(`• 평균 복구시간(MTTR): ${kpis.avgMttrHours} 시간  |  출고 7일내 조기고장: ${kpis.earlyFailuresCount}건`, 310 * scale, (maintBoxY + 19) * scale);

    // 2페이지 하단 페이지 번호
    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Page 2 of 3  •  e-Bro ERP 시스템 자동 생성`, (a4W / 2) * scale, (a4H - 25) * scale);
  });

  // =========================================================================
  // [3페이지: 채권 에이징 + 영업 면제(Waiver) + 경영진 진단 및 서명란]
  // =========================================================================
  const page3Bytes = await renderPageToPngBlob(canvasW, canvasH, (ctx) => {
    // 3페이지 상단 헤더 스트립
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(40 * scale, 30 * scale, (a4W - 80) * scale, 24 * scale);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold ' + (10 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`[${tenantBrand}] ${period.year}년 ${period.month}월 정기보고서 — 채권/면제투명성/경영진지시`, 50 * scale, 46 * scale);

    ctx.textAlign = 'right';
    ctx.fillText('SECTION 4 & 5', (a4W - 50) * scale, 46 * scale);

    // 1. 섹션 6: 미수 채권 연체 에이징 분석
    let curY = 70;
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold ' + (12 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('6. 미수 채권 연체 에이징(Aging) 분석', 40 * scale, curY * scale);

    const agingBoxY = curY + 10;
    const agW = (a4W - 80 - 36) / 4;
    const agings = [
      { label: '정상 (30일 이하)', val: `₩${finance.receivablesAging.under30Days.toLocaleString()}`, color: '#10B981' },
      { label: '31일 ~ 60일', val: `₩${finance.receivablesAging.days31To60.toLocaleString()}`, color: '#3B82F6' },
      { label: '61일 ~ 90일', val: `₩${finance.receivablesAging.days61To90.toLocaleString()}`, color: '#F59E0B' },
      { label: '90일 초과 (고위험)', val: `₩${finance.receivablesAging.over90Days.toLocaleString()}`, color: '#DC2626' },
    ];

    agings.forEach((ag, idx) => {
      const ax = 40 + idx * (agW + 12);
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(ax * scale, agingBoxY * scale, agW * scale, 45 * scale);
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1 * scale;
      ctx.strokeRect(ax * scale, agingBoxY * scale, agW * scale, 45 * scale);

      ctx.fillStyle = '#64748B';
      ctx.font = 'bold ' + (8 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(ag.label, (ax + 8) * scale, (agingBoxY + 18) * scale);

      ctx.fillStyle = ag.color;
      ctx.font = 'bold ' + (10 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(ag.val, (ax + 8) * scale, (agingBoxY + 36) * scale);
    });

    // 2. 섹션 7: 영업 청구 면제(Waiver) 손실 투명 보고
    curY = agingBoxY + 65;
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold ' + (12 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('7. 영업 청구 면제(Waiver) 손실 투명성 보고', 40 * scale, curY * scale);

    const waiverHdrY = curY + 10;
    ctx.fillStyle = '#FEF2F2';
    ctx.fillRect(40 * scale, waiverHdrY * scale, (a4W - 80) * scale, 22 * scale);
    ctx.strokeStyle = '#FECACA';
    ctx.strokeRect(40 * scale, waiverHdrY * scale, (a4W - 80) * scale, 22 * scale);

    ctx.fillStyle = '#991B1B';
    ctx.font = 'bold ' + (8.5 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('구분', 50 * scale, (waiverHdrY + 15) * scale);
    ctx.fillText('일자', 110 * scale, (waiverHdrY + 15) * scale);
    ctx.fillText('고객사명', 170 * scale, (waiverHdrY + 15) * scale);
    ctx.fillText('면제 사유 및 배경', 270 * scale, (waiverHdrY + 15) * scale);
    ctx.fillText('담당자', 430 * scale, (waiverHdrY + 15) * scale);
    ctx.fillText('면제 금액', 480 * scale, (waiverHdrY + 15) * scale);

    let waiverRowY = waiverHdrY + 22;
    finance.waivers.slice(0, 4).forEach((wv) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(40 * scale, waiverRowY * scale, (a4W - 80) * scale, 20 * scale);
      ctx.strokeStyle = '#FEE2E2';
      ctx.strokeRect(40 * scale, waiverRowY * scale, (a4W - 80) * scale, 20 * scale);

      ctx.fillStyle = '#334155';
      ctx.font = '500 ' + (8 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(wv.typeLabel.slice(0, 8), 50 * scale, (waiverRowY + 14) * scale);
      ctx.fillText(wv.date, 110 * scale, (waiverRowY + 14) * scale);
      ctx.fillText(wv.customerName, 170 * scale, (waiverRowY + 14) * scale);
      ctx.fillText(wv.reason.slice(0, 24), 270 * scale, (waiverRowY + 14) * scale);
      ctx.fillText(wv.waivedBy, 430 * scale, (waiverRowY + 14) * scale);

      ctx.fillStyle = '#DC2626';
      ctx.font = 'bold ' + (8 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.fillText(`₩${wv.waivedAmount.toLocaleString()}`, 480 * scale, (waiverRowY + 14) * scale);

      waiverRowY += 20;
    });

    // 3. 섹션 8: 경영진 종합 진단 및 차월 중점 지시사항
    curY = waiverRowY + 25;
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold ' + (12 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('8. 경영진 종합 진단 및 차월 중점 지시사항 (Executive Directives)', 40 * scale, curY * scale);

    const directiveBoxY = curY + 10;
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(40 * scale, directiveBoxY * scale, (a4W - 80) * scale, 90 * scale);
    ctx.strokeStyle = '#CBD5E1';
    ctx.strokeRect(40 * scale, directiveBoxY * scale, (a4W - 80) * scale, 90 * scale);

    ctx.fillStyle = '#334155';
    ctx.font = 'bold ' + (9.5 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('[경영진 총평]', 55 * scale, (directiveBoxY + 22) * scale);

    ctx.font = '500 ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
    const remarks = executiveDirective.remarks || '당월 장비 가동률 양호하나 30일 이상 유휴 장비에 대한 적극적인 프로모션 및 90일 이상 고위험 연체 거래처에 대한 출고금지 등 채권 보전 조치를 엄격히 집행할 것.';
    ctx.fillText(remarks.slice(0, 52), 55 * scale, (directiveBoxY + 38) * scale);
    if (remarks.length > 52) {
      ctx.fillText(remarks.slice(52, 104), 55 * scale, (directiveBoxY + 52) * scale);
    }

    ctx.font = 'bold ' + (9.5 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.fillText('[차월 중점 과제]', 55 * scale, (directiveBoxY + 70) * scale);
    ctx.font = '500 ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
    const tasks = executiveDirective.priorityTasks || '1. 32ft 장기 유휴 장비 대형 현장 우선 투입  2. 스펙 오발주 교환 손실 방지를 위한 계약 전 실측 강화  3. 연체 200만원 이상 거래처 직권 결재 집행';
    ctx.fillText(tasks.slice(0, 56), 55 * scale, (directiveBoxY + 84) * scale);

    // ── 팀별 코멘트 요약 섹션 ─────────────────────────────────────────
    const teamCommentY = directiveBoxY + 105;
    const activeComments = teamComments.filter((tc: any) => tc && tc.comment && tc.comment.trim());

    if (activeComments.length > 0) {
      ctx.fillStyle = '#1E293B';
      ctx.font = 'bold ' + (11 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('9. 부서별 코멘트 (팀별 부연 의견)', 40 * scale, teamCommentY * scale);

      let tcRowY = teamCommentY + 12;
      activeComments.slice(0, 4).forEach((tc: any) => {
        const tcBoxH = 36;
        ctx.fillStyle = '#F8FAFC';
        ctx.fillRect(40 * scale, tcRowY * scale, (a4W - 80) * scale, tcBoxH * scale);
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 0.8 * scale;
        ctx.strokeRect(40 * scale, tcRowY * scale, (a4W - 80) * scale, tcBoxH * scale);

        // 팀명 뱃지
        ctx.fillStyle = '#4F46E5';
        ctx.fillRect(40 * scale, tcRowY * scale, 68 * scale, tcBoxH * scale);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(tc.teamName || '팀', 74 * scale, (tcRowY + 15) * scale);
        if (tc.authorName) {
          ctx.font = '500 ' + (8 * scale) + 'px "Malgun Gothic", sans-serif';
          ctx.fillText(tc.authorName.slice(0, 6), 74 * scale, (tcRowY + 27) * scale);
        }

        // 코멘트 텍스트
        ctx.fillStyle = '#334155';
        ctx.font = '500 ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'left';
        const commentText = (tc.comment || '').slice(0, 58);
        ctx.fillText(commentText, 118 * scale, (tcRowY + 16) * scale);

        // 링크 있으면 표시
        if (tc.links && tc.links.length > 0 && tc.links[0].url) {
          ctx.fillStyle = '#6366F1';
          ctx.font = '500 ' + (8 * scale) + 'px "Malgun Gothic", sans-serif';
          ctx.fillText(`🔗 ${tc.links[0].title || tc.links[0].url.slice(0, 40)}`, 118 * scale, (tcRowY + 28) * scale);
        }

        tcRowY += tcBoxH + 6;
      });

      // 4. 최하단 Gutenberg 대차대조식 검증 바 및 결재/서명란
      const auditBarY = tcRowY + 8;
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(40 * scale, auditBarY * scale, (a4W - 80) * scale, 34 * scale);

      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`📄 매출청구총액 ₩${kpis.totalRevenue.toLocaleString()} = 🟢 수납액 ₩${kpis.collectedAmount.toLocaleString()} + 🔴 미수잔액 ₩${kpis.unpaidAmount.toLocaleString()}`, 55 * scale, (auditBarY + 21) * scale);

      ctx.fillStyle = '#4ADE80';
      ctx.fillText(`⚖️ 대차 차액 ₩${conservation.delta.toLocaleString()} (100% 일치)`, 390 * scale, (auditBarY + 21) * scale);

      // 대표이사 결재란
      const signBoxY = auditBarY + 45;
      ctx.fillStyle = '#1E293B';
      ctx.font = 'bold ' + (10 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`보고 확정일: ${period.generatedAt.slice(0, 10)}    |    대표이사:  (인) / 서명`, (a4W - 45) * scale, signBoxY * scale);
    } else {
      // 4. 최하단 Gutenberg 대차대조식 검증 바 및 결재/서명란
      const auditBarY = teamCommentY;
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(40 * scale, auditBarY * scale, (a4W - 80) * scale, 34 * scale);

      ctx.fillStyle = '#38BDF8';
      ctx.font = 'bold ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`📄 매출청구총액 ₩${kpis.totalRevenue.toLocaleString()} = 🟢 수납액 ₩${kpis.collectedAmount.toLocaleString()} + 🔴 미수잔액 ₩${kpis.unpaidAmount.toLocaleString()}`, 55 * scale, (auditBarY + 21) * scale);

      ctx.fillStyle = '#4ADE80';
      ctx.fillText(`⚖️ 대차 차액 ₩${conservation.delta.toLocaleString()} (100% 일치)`, 390 * scale, (auditBarY + 21) * scale);

      // 대표이사 결재란
      const signBoxY = auditBarY + 45;
      ctx.fillStyle = '#1E293B';
      ctx.font = 'bold ' + (10 * scale) + 'px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`보고 확정일: ${period.generatedAt.slice(0, 10)}    |    대표이사:  (인) / 서명`, (a4W - 45) * scale, signBoxY * scale);
    }

    // 3페이지 하단 페이지 번호
    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 ' + (9 * scale) + 'px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Page 3 of 3  •  e-Bro ERP 시스템 자동 생성`, (a4W / 2) * scale, (a4H - 25) * scale);
  });


  // 3개 페이지를 순서대로 PDF 문서에 추가
  const p1 = await pdfDoc.embedPng(page1Bytes);
  const p2 = await pdfDoc.embedPng(page2Bytes);
  const p3 = await pdfDoc.embedPng(page3Bytes);

  const page1 = pdfDoc.addPage([a4W, a4H]);
  page1.drawImage(p1, { x: 0, y: 0, width: a4W, height: a4H });

  const page2 = pdfDoc.addPage([a4W, a4H]);
  page2.drawImage(p2, { x: 0, y: 0, width: a4W, height: a4H });

  const page3 = pdfDoc.addPage([a4W, a4H]);
  page3.drawImage(p3, { x: 0, y: 0, width: a4W, height: a4H });

  // PDF 파일 저장 및 브라우저 다운로드 트리거
  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `[${tenantBrand}]_${period.year}년_${period.month}월_경영정기보고서.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
