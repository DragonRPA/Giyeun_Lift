import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { 
  Truck, Check, AlertCircle, Plus, Trash2, Clock, Layers, 
  FileText, Copy, Lock, CreditCard, CheckCircle, RefreshCw, X,
  Calendar, RotateCcw, ShieldCheck, CheckSquare, XCircle, Search,
  MessageSquare, User, Edit2, Upload, Download, FileSpreadsheet,
  CheckCircle2, AlertTriangle, Filter, DollarSign, Send, Sun, MapPin, Printer,
  UserCheck, FileAudio, Volume2, Sparkles, UploadCloud, Loader2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { exportToExcel } from '../services/excel';
import { Delivery, TransportCompany, TransportDriver, TransportNegotiation, db, DeliveryStatus, Asset } from '../services/db';
import { DestinationWeatherModal } from '../components/DestinationWeatherModal';
import { matchHangul } from '../utils/hangulSearch';
import { buildDispatchSmsText, launchDispatchSms } from '../utils/nativeLauncher';
import { broadcastWorkNotification } from '../utils/workNotificationService';
import { issueHandoverTask, clearHandoverTasks } from '../utils/taskHandoverPipeline';
import {
  TransportCallQueueItem,
  getTransportCallQueue,
  saveTransportCallQueue,
  processNewTransportCall,
  markTransportCallConfirmed,
  deleteTransportCall
} from '../services/transportCallService';

const VEHICLE_TYPE_OPTIONS = ['1.4T', '2.5T', '3.5T', '5T', '5T장축', '8.5T', '11T', '노배드'];

interface VehicleReq {
  vehicleType: string;
  count: number;
}

interface CargoItem {
  modelName: string;
  count: number;
}

interface AssignedVehicleRow {
  id: string;
  transportCompany: string;
  vehicleType: string;
  vehicleNo: string;
  driverName: string;
  driverContact: string;
  expectedCost: number; // 💰 예상 운송비 (원) - 필수
  finalCost?: number;   // 💵 실제 운송비 (원) - 선택
  deliveryCost: number; // 기존 호환용
}

export interface ReconPairRow {
  pairId: string;
  systemDelivery?: Delivery;
  excelRow?: any;
  matchStatus: 'MATCHED' | 'MISMATCH' | 'SYSTEM_ONLY' | 'EXCEL_ONLY' | 'PENDING' | 'PAYMENT_REQUESTED' | 'EXCLUDED';
  systemCost: number;
  excelCost: number;
  diffCost: number;
  memo?: string;
  surchargeReason?: string;
  isReconciled: boolean;
  isExcluded?: boolean;
}

// 💡 [사장님 지시] 배차 운반비 0원 온전 보존 헬퍼 (하드코딩 70,000원 기본값 완전 제거)
export const getEffectiveDeliveryCost = (d?: Delivery | null): number => {
  if (!d) return 0;
  if (d.finalCost !== undefined && d.finalCost !== null) return d.finalCost;
  if (d.deliveryCost !== undefined && d.deliveryCost !== null) return d.deliveryCost;
  if (d.expectedCost !== undefined && d.expectedCost !== null) return d.expectedCost;
  const vehicleCost = d.assignedVehicles?.reduce((acc: number, v: any) => acc + (v.deliveryCost || 0), 0);
  if (vehicleCost !== undefined && vehicleCost > 0) return vehicleCost;
  return 0;
};

export const TruckDispatch: React.FC = () => {
  const { 
    currentUser,
    deliveries, contracts, customers, products, sites, users,
    contractAssets, assets,
    transportCompanies, transportDrivers, transportNegotiations, outboundInspections, hasPermission, 
    refreshAllData, showErrorModal, convertReconciledDeliveriesToSettlement,
    currentTenant,
    printStations, printQueue, enqueuePrintJob,
    completeDelivery, completeInboundDelivery
  } = useApp();

  const canSave = hasPermission('delivery', 'save');

  // 출고 검수 상태 파싱 헬퍼
  const getOutboundInspectionStatus = (contractId?: string) => {
    if (!contractId) return 'NONE';
    const insps = outboundInspections.filter(i => i.contractId === contractId);
    if (insps.length === 0) return 'NONE';
    if (insps.some(i => i.status === 'REJECTED')) return 'REJECTED';
    if (insps.every(i => i.status === 'COMPLETED')) return 'COMPLETED';
    if (insps.some(i => i.status === 'IN_PROGRESS')) return 'IN_PROGRESS';
    return 'PENDING';
  };

  const deliveryCounts = useMemo(() => {
    const counts = { today: 0, tomorrow: 0, pending: 0, dispatched: 0, delivered: 0, cancelled: 0, exchange: 0 };
    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    for (const d of deliveries) {
      const dt = d.loadingDate || d.scheduledDate;
      if (dt === todayStr) counts.today++;
      if (dt === tomorrowStr) counts.tomorrow++;
      const st = getNormalizedDeliveryStatus(d);
      if (st === 'PENDING') counts.pending++;
      else if (st === 'DISPATCHED') counts.dispatched++;
      else if (st === 'DELIVERED') counts.delivered++;
      else if (st === 'CANCELLED') counts.cancelled++;
      if (d.dispatchCategory === '교환' || d.type === 'EXCHANGE') counts.exchange++;
    }
    return counts;
  }, [deliveries]);

  const getOutboundInspectionBadge = (contractId?: string) => {
    const status = getOutboundInspectionStatus(contractId);
    switch (status) {
      case 'REJECTED':
        return (
          <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 800, backgroundColor: 'rgba(239,68,68,0.15)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.3)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <AlertCircle size={12} /> 🔴 출고의뢰 반려됨
          </span>
        );
      case 'COMPLETED':
        return (
          <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 800, backgroundColor: 'rgba(34,197,94,0.15)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.3)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <CheckCircle size={12} /> 🟢 출고승인 완료
          </span>
        );
      case 'IN_PROGRESS':
      case 'PENDING':
        return (
          <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 800, backgroundColor: 'rgba(59,130,246,0.15)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.3)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <Clock size={12} /> 🔵 출고검수 진행중
          </span>
        );
      default:
        return null;
    }
  };

  // 🖨️ 분산 인쇄 큐 상태 배지 헬퍼 (프린터1/프린터2 무인 출력 상태 실시간 표출)
  const getPrintQueueBadge = (delivery: Delivery) => {
    const c = contracts.find(ct => ct.id === delivery.contractId);
    const cNo = c?.contractNo;
    const matchedJob = printQueue
      .filter(q => {
        if (cNo && q.docNo && q.docNo.includes(cNo)) return true;
        if (delivery.id && q.docNo && q.docNo.includes(delivery.id)) return true;
        return false;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!matchedJob) return null;

    const st = printStations.find(s => s.id === matchedJob.stationId);
    const stationLabel = st?.stationName || (matchedJob.docType === 'DISPATCH_ORDER' ? '프린터1' : '프린터2');

    switch (matchedJob.status) {
      case 'COMPLETED':
        return (
          <span
            style={{
              padding: '2px 7px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: 800,
              backgroundColor: 'rgba(34,197,94,0.15)',
              color: '#15803d',
              border: '1px solid rgba(34,197,94,0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap'
            }}
            title={`인쇄완료: ${matchedJob.completedAt ? new Date(matchedJob.completedAt).toLocaleTimeString('ko-KR') : ''}`}
          >
            🖨️ {stationLabel}: 🟢 출력완료
          </span>
        );
      case 'PRINTING':
        return (
          <span
            style={{
              padding: '2px 7px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: 800,
              backgroundColor: 'rgba(59,130,246,0.15)',
              color: '#1d4ed8',
              border: '1px solid rgba(59,130,246,0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            🖨️ {stationLabel}: 🔵 출력중
          </span>
        );
      case 'FAILED':
        return (
          <span
            style={{
              padding: '2px 7px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: 800,
              backgroundColor: 'rgba(239,68,68,0.15)',
              color: '#b91c1c',
              border: '1px solid rgba(239,68,68,0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap'
            }}
            title={matchedJob.lastError || '출력 실패'}
          >
            🖨️ {stationLabel}: 🔴 오류
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span
            style={{
              padding: '2px 7px',
              borderRadius: '12px',
              fontSize: '11px',
              fontWeight: 800,
              backgroundColor: 'rgba(245,158,11,0.15)',
              color: '#b45309',
              border: '1px solid rgba(245,158,11,0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            🖨️ {stationLabel}: 🟡 대기중
          </span>
        );
    }
  };

  const getContract = (contractId?: string) => contracts.find(c => c.id === contractId);
  const getCustomer = (customerId?: string) => customers.find(c => c.id === customerId);

  // 회수 배차 대상 자산 조회 (delivery.assetIds 우선 매핑, 없으면 contractId 기준)
  const getReturnAssets = (delivery: Delivery) => {
    if (!delivery) return [];
    if (delivery.assetIds) {
      const ids = delivery.assetIds.split(',').map(id => id.trim()).filter(Boolean);
      const found = ids.map(id => assets.find(a => a.id === id)).filter(Boolean) as Asset[];
      if (found.length > 0) {
        return found.map(a => ({ modelName: a.modelName || '-', assetNo: a.assetNo || '-', id: a.id }));
      }
    }
    if (delivery.contractId) {
      return contractAssets
        .filter(ca => ca.contractId === delivery.contractId)
        .map(ca => {
          const asset = assets.find(a => a.id === ca.assetId);
          return asset ? { modelName: asset.modelName || ca.expectedModel || '-', assetNo: asset.assetNo || '-', id: asset.id } : null;
        })
        .filter(Boolean) as { modelName: string; assetNo: string; id: string }[];
    }
    return [];
  };

  // 출고/입고 요청서 인쇄
  const handlePrintDispatchRequest = (delivery: Delivery, docType: 'OUTBOUND' | 'INBOUND') => {
    const contract = getContract(delivery.contractId);
    const customer = contract ? getCustomer(contract.customerId) : null;
    const site = sites?.find(s => s.id === contract?.siteId);
    const cargoItems = parseCargoItems(delivery);
    const returnAssets = getReturnAssets(delivery);
    const isOutbound = docType === 'OUTBOUND';
    const title = isOutbound ? '출고요청서' : '입고요청서';
    const today = new Date().toISOString().split('T')[0];

    const assetRows = isOutbound
      ? cargoItems.map((c, i) => `<tr><td>${i + 1}</td><td>${c.modelName}</td><td>${c.count}대</td><td></td><td></td></tr>`).join('')
      : returnAssets.map((a, i) => `<tr><td>${i + 1}</td><td>${a.modelName}</td><td>{${a.assetNo}}</td><td>1대</td><td></td></tr>`).join('');

    const fromLabel = isOutbound ? '상차지 (출발)' : '상차지 (회수지)';
    const toLabel   = isOutbound ? '하차지 (현장)' : '하차지 (반납지)';
    const fromAddr  = delivery.pickupVendorName 
      ? `[타사 직출고] ${delivery.pickupVendorName} (${delivery.originAddress || '-'})` 
      : (isOutbound ? (delivery.originAddress || '당사 보관소') : (delivery.destinationAddress || site?.address || '-'));
    const toAddr    = delivery.viaDropoffName 
      ? `[혼적 경유] 1차: ${delivery.viaDropoffName} (${delivery.viaDropoffAddress || '본사'}) ➔ 2차: ${delivery.destinationAddress || '원사 보관소'}` 
      : (isOutbound ? (delivery.destinationAddress || site?.address || '-') : (delivery.originAddress || '당사 보관소'));

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: 'Malgun Gothic', sans-serif; font-size: 12px; margin: 24px; color: #111; }
  h1 { text-align: center; font-size: 20px; font-weight: 900; margin-bottom: 4px; }
  .sub { text-align: center; font-size: 11px; color: #666; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #888; padding: 6px 8px; }
  th { background: #f0f0f0; font-weight: 700; text-align: left; width: 120px; }
  .asset-table th { text-align: center; background: #e8eef8; }
  .asset-table td { text-align: center; }
  .sign-row { display: flex; gap: 16px; margin-top: 24px; }
  .sign-box { flex: 1; border: 1px solid #888; border-radius: 4px; padding: 10px 14px; min-height: 60px; }
  .sign-label { font-weight: 700; font-size: 11px; color: #555; margin-bottom: 8px; }
  @media print { body { margin: 10px; } button { display: none; } }
</style>
</head><body>
<h1>${currentTenant?.displayName || currentTenant?.tradeName || 'e-Bro'} ${title}</h1>
<div class="sub">문서번호: ${delivery.id} | 발행일자: ${today}</div>
<table>
  <tr><th>계약번호</th><td>${contract?.contractNo || '-'}</td><th>배차구분</th><td>${delivery.dispatchCategory || (isOutbound ? '출고' : '입고')}</td></tr>
  <tr><th>고객사</th><td>${customer?.name || '-'}</td><th>현장</th><td>${site?.name || '-'}</td></tr>
  <tr><th>요청일</th><td>${delivery.requestDate || '-'}</td><th>배차일</th><td>${delivery.loadingDate || '-'}</td></tr>
  <tr><th>${fromLabel}</th><td>${fromAddr}</td><th>${toLabel}</th><td>${toAddr}</td></tr>
  <tr><th>담당 기사</th><td>${delivery.driverName || '(미배정)'}</td><th>차량번호</th><td>${delivery.vehicleNo || '-'}</td></tr>
  <tr><th>비고</th><td colspan="3">${delivery.memo || ''}</td></tr>
</table>
<table class="asset-table">
  <thead><tr><th>No</th><th>모델명</th>${isOutbound ? '<th>수량</th><th>비고</th><th>서명</th>' : '<th>관리번호</th><th>수량</th><th>비고</th>'}</tr></thead>
  <tbody>${assetRows || '<tr><td colspan="5" style="text-align:center;color:#999;">장비 정보 없음</td></tr>'}</tbody>
</table>
<div class="sign-row">
  <div class="sign-box"><div class="sign-label">${isOutbound ? '출고 완료자' : '입고 등록자'} 확인</div></div>
  <div class="sign-box"><div class="sign-label">현장 수령인 서명</div></div>
  <div class="sign-box"><div class="sign-label">운송 기사 서명</div></div>
</div>
<div style="margin-top:16px;text-align:center">
  <button onclick="window.print()" style="padding:8px 24px;font-size:13px;cursor:pointer;">🖨️ 인쇄</button>
</div>
</body></html>`;

    const w = window.open('', '_blank', 'width=800,height=900');
    if (w) { w.document.write(html); w.document.close(); }
  };

  // 🖨️ 원격 분산 인쇄 큐 전송 (출고: 프린터1, 입고: 프린터2 자동 라우팅 무인 출력)
  const handleRemoteQueuePrintDispatchRequest = async (delivery: Delivery, docType: 'OUTBOUND' | 'INBOUND') => {
    const contract = getContract(delivery.contractId);
    const customer = contract ? getCustomer(contract.customerId) : null;
    const site = sites?.find(s => s.id === contract?.siteId);
    const cargoItems = parseCargoItems(delivery);
    const returnAssets = getReturnAssets(delivery);
    const isOutbound = docType === 'OUTBOUND';
    const title = isOutbound ? '출고요청서' : '입고요청서';
    const today = new Date().toISOString().split('T')[0];

    const assetRows = isOutbound
      ? cargoItems.map((c, i) => `<tr><td>${i + 1}</td><td>${c.modelName}</td><td>${c.count}대</td><td></td><td></td></tr>`).join('')
      : returnAssets.map((a, i) => `<tr><td>${i + 1}</td><td>${a.modelName}</td><td>{${a.assetNo}}</td><td>1대</td><td></td></tr>`).join('');

    const fromLabel = isOutbound ? '상차지 (출발)' : '상차지 (회수지)';
    const toLabel   = isOutbound ? '하차지 (현장)' : '하차지 (반납지)';
    const fromAddr  = delivery.pickupVendorName 
      ? `[타사 직출고] ${delivery.pickupVendorName} (${delivery.originAddress || '-'})` 
      : (isOutbound ? (delivery.originAddress || '당사 보관소') : (delivery.destinationAddress || site?.address || '-'));
    const toAddr    = delivery.viaDropoffName 
      ? `[혼적 경유] 1차: ${delivery.viaDropoffName} (${delivery.viaDropoffAddress || '본사'}) ➔ 2차: ${delivery.destinationAddress || '원사 보관소'}` 
      : (isOutbound ? (delivery.destinationAddress || site?.address || '-') : (delivery.originAddress || '당사 보관소'));

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: 'Malgun Gothic', sans-serif; font-size: 12px; margin: 24px; color: #111; }
  h1 { text-align: center; font-size: 20px; font-weight: 900; margin-bottom: 4px; }
  .sub { text-align: center; font-size: 11px; color: #666; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #888; padding: 6px 8px; }
  th { background: #f0f0f0; font-weight: 700; text-align: left; width: 120px; }
  .asset-table th { text-align: center; background: #e8eef8; }
  .asset-table td { text-align: center; }
  .sign-row { display: flex; gap: 16px; margin-top: 24px; }
  .sign-box { flex: 1; border: 1px solid #888; border-radius: 4px; padding: 10px 14px; min-height: 60px; }
  .sign-label { font-weight: 700; font-size: 11px; color: #555; margin-bottom: 8px; }
  @media print { body { margin: 10px; } button { display: none; } }
</style>
</head><body>
<h1>${currentTenant?.displayName || currentTenant?.tradeName || 'e-Bro'} ${title}</h1>
<div class="sub">문서번호: ${delivery.id} | 발행일자: ${today}</div>
<table>
  <tr><th>계약번호</th><td>${contract?.contractNo || '-'}</td><th>배차구분</th><td>${delivery.dispatchCategory || (isOutbound ? '출고' : '입고')}</td></tr>
  <tr><th>고객사</th><td>${customer?.name || '-'}</td><th>현장</th><td>${site?.name || '-'}</td></tr>
  <tr><th>요청일</th><td>${delivery.requestDate || '-'}</td><th>배차일</th><td>${delivery.loadingDate || '-'}</td></tr>
  <tr><th>${fromLabel}</th><td>${fromAddr}</td><th>${toLabel}</th><td>${toAddr}</td></tr>
  <tr><th>담당 기사</th><td>${delivery.driverName || '(미배정)'}</td><th>차량번호</th><td>${delivery.vehicleNo || '-'}</td></tr>
  <tr><th>비고</th><td colspan="3">${delivery.memo || ''}</td></tr>
</table>
<table class="asset-table">
  <thead><tr><th>No</th><th>모델명</th>${isOutbound ? '<th>수량</th><th>비고</th><th>서명</th>' : '<th>관리번호</th><th>수량</th><th>비고</th>'}</tr></thead>
  <tbody>${assetRows || '<tr><td colspan="5" style="text-align:center;color:#999;">장비 정보 없음</td></tr>'}</tbody>
</table>
<div class="sign-row">
  <div class="sign-box"><div class="sign-label">${isOutbound ? '출고 완료자' : '입고 등록자'} 확인</div></div>
  <div class="sign-box"><div class="sign-label">현장 수령인 서명</div></div>
  <div class="sign-box"><div class="sign-label">운송 기사 서명</div></div>
</div>
</body></html>`;

    // 타겟 스테이션 결정 (선호 스테이션 우선 -> 출고: DISPATCH_ORDER/프린터1, 입고: RETURN_ORDER/프린터2)
    const targetDocType = isOutbound ? 'DISPATCH_ORDER' : 'RETURN_ORDER';
    const savedStationId = localStorage.getItem(isOutbound ? 'preferred_print_station_dispatch' : 'preferred_print_station_return');
    const targetStation = (savedStationId && savedStationId !== 'BROWSER_DIRECT' && printStations.find(s => s.id === savedStationId)) ||
      printStations.find(s => s.docTypeDefault === targetDocType) ||
      (isOutbound
        ? printStations.find(s => s.stationName.includes('프린터1') || s.stationName.includes('출고'))
        : printStations.find(s => s.stationName.includes('프린터2') || s.stationName.includes('입고'))) ||
      printStations[0];

    try {
      await enqueuePrintJob({
        stationId: targetStation?.id,
        docType: targetDocType,
        docNo: contract?.contractNo || delivery.id,
        title: `${title}_${customer?.name || '고객사'}_${delivery.id}`,
        documentHtml: html,
        requestedById: currentUser?.id,
        requestedByName: currentUser?.name
      });
      alert(`[${targetStation?.stationName || (isOutbound ? '프린터1' : '프린터2')}] 인쇄 큐 전송 완료`);
    } catch (err: any) {
      alert(`원격 인쇄 큐 전송 실패: ${err.message || err}`);
    }
  };

  // 1. 배차 4단계 진행 상태 판정 헬퍼
  const getNormalizedDeliveryStatus = (d: Delivery): 'PENDING' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' => {
    if (!d) return 'PENDING';
    if (d.status === 'DISPATCHED') return 'DISPATCHED';
    if (d.status === 'DELIVERED' || d.status === 'COMPLETED') return 'DELIVERED';
    if (d.status === 'CANCELLED') return 'CANCELLED';
    return 'PENDING';
  };

  // 엑셀 날짜(시리얼 숫자 46174 등 또는 포맷팅 텍스트)를 YYYY-MM-DD로 변환하는 정규화 헬퍼
  const formatExcelDateStr = (rawVal: any): string => {
    if (!rawVal) return '-';
    const str = String(rawVal).trim();
    if (!str) return '-';

    // 1. 엑셀 시리얼 숫자 (예: 46174)
    if (!isNaN(Number(str)) && Number(str) > 30000 && Number(str) < 60000) {
      const serial = Number(str);
      const utcDays = Math.floor(serial - 25569);
      const utcValue = utcDays * 86400;
      const dateObj = new Date(utcValue * 1000);
      const year = dateObj.getUTCFullYear();
      const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // 2. 06월 01일 포맷
    const currentYear = new Date().getFullYear();
    if (str.includes('월') && str.includes('일')) {
      const mMatch = str.match(/(\d+)월\s*(\d+)일/);
      if (mMatch) {
        return `${currentYear}-${String(mMatch[1]).padStart(2, '0')}-${String(mMatch[2]).padStart(2, '0')}`;
      }
    }

    // 3. 6/1 포맷
    if (str.includes('/')) {
      const parts = str.split('/');
      if (parts.length === 2) {
        return `${currentYear}-${String(parts[0]).padStart(2, '0')}-${String(parts[1]).padStart(2, '0')}`;
      } else if (parts.length === 3) {
        return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
      }
    }

    return str;
  };

  const [activeTab, setActiveTab] = useState<'DISPATCH' | 'NEGOTIATION' | 'RECONCILIATION'>('DISPATCH');

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 4단계 배차 진행 상태 탭 state ('ALL' | 'PENDING' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED')
  const [activeDispatchStatusTab, setActiveDispatchStatusTab] = useState<string>('ALL');

  // 📅 배차 요청/운송일 기간 조회 피커 state
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [searchQuery, setSearchQuery] = useState<string>('');

  const handleSetDateRange = (type: 'TODAY' | 'WEEK' | 'MONTH' | 'ALL') => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    if (type === 'TODAY') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (type === 'WEEK') {
      const future = new Date();
      future.setDate(today.getDate() + 7);
      setStartDate(todayStr);
      setEndDate(future.toISOString().split('T')[0]);
    } else if (type === 'MONTH') {
      const future = new Date();
      future.setMonth(today.getMonth() + 1);
      setStartDate(todayStr);
      setEndDate(future.toISOString().split('T')[0]);
    } else {
      setStartDate('');
      setEndDate('');
    }
  };

  // ── 운송사 배차 협의 (NEGOTIATION) 전용 상태 ──
  const [selectedNegoDeliveryId, setSelectedNegoDeliveryId] = useState<string | null>(null);
  const [negoCompanyId, setNegoCompanyId] = useState<string>('');
  const [negoVehicleType, setNegoVehicleType] = useState<string>('5T');
  const [negoProposedCost, setNegoProposedCost] = useState<number>(0);
  const [negoTargetCost, setNegoTargetCost] = useState<number>(0);
  const [negoCallSummary, setNegoCallSummary] = useState<string>('');
  const [negoSpecialTerms, setNegoSpecialTerms] = useState<string>('');
  const [negoFilterStatus, setNegoFilterStatus] = useState<'ALL' | 'PENDING' | 'IN_NEGOTIATION' | 'CONFIRMED'>('ALL');
  const [negoSearchQuery, setNegoSearchQuery] = useState<string>('');

  // ── 통화 협의 큐 (Call Ingestion Queue) 상태 ──
  const [callQueue, setCallQueue] = useState<TransportCallQueueItem[]>(() => getTransportCallQueue());
  const [selectedCallQueueId, setSelectedCallQueueId] = useState<string | null>(() => {
    const q = getTransportCallQueue();
    return q.length > 0 ? q[0].id : null;
  });
  const [isUploadingCall, setIsUploadingCall] = useState<boolean>(false);
  const [callUploadError, setCallUploadError] = useState<string | null>(null);
  const callFileInputRef = useRef<HTMLInputElement>(null);

  const selectedCall = useMemo(() => {
    return callQueue.find(q => q.id === selectedCallQueueId) || null;
  }, [callQueue, selectedCallQueueId]);

  // 통화 큐 아이템 선택 시 폼 및 배차 건 자동 프리필
  const handleSelectCallQueueItem = (call: TransportCallQueueItem) => {
    setSelectedCallQueueId(call.id);
    if (call.extracted.matchedDeliveryId) {
      setSelectedNegoDeliveryId(call.extracted.matchedDeliveryId);
    }
    if (call.extracted.matchedCompanyId) {
      setNegoCompanyId(call.extracted.matchedCompanyId);
    }
    if (call.extracted.vehicleType) {
      setNegoVehicleType(call.extracted.vehicleType);
    }
    if (call.extracted.proposedCost) {
      setNegoProposedCost(call.extracted.proposedCost);
    }
    if (call.extracted.targetCost) {
      setNegoTargetCost(call.extracted.targetCost);
    }
    if (call.extracted.specialTerms) {
      setNegoSpecialTerms(call.extracted.specialTerms);
    }
    if (call.extracted.callSummary) {
      setNegoCallSummary(call.extracted.callSummary);
    }
  };

  // 통화 녹음 파일 업로드 및 분석 핸들러
  const handleUploadCallFile = async (file: File) => {
    setIsUploadingCall(true);
    setCallUploadError(null);
    try {
      const newItem = await processNewTransportCall(file, transportCompanies, deliveries);
      const updatedQueue = getTransportCallQueue();
      setCallQueue(updatedQueue);
      handleSelectCallQueueItem(newItem);
      showToast(`'${file.name}' 통화 녹음이 AI 분석되어 큐에 등록되었습니다.`);
    } catch (err: any) {
      console.error('Call upload error:', err);
      setCallUploadError(err?.message || '통화 녹음 파일 분석에 실패했습니다.');
    } finally {
      setIsUploadingCall(false);
    }
  };

  // 통화 큐 아이템 삭제
  const handleDeleteCallQueueItem = (callId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteTransportCall(callId);
    const updated = getTransportCallQueue();
    setCallQueue(updated);
    if (selectedCallQueueId === callId) {
      setSelectedCallQueueId(updated.length > 0 ? updated[0].id : null);
    }
    showToast('통화 큐 항목이 삭제되었습니다.');
  };

  // 기존 배차 관리 상세 선택 상태
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);

  // 운송사 배차 협의 전용 선택 배차 건
  const selectedNegoDelivery = useMemo(() => {
    return deliveries.find(d => d.id === selectedNegoDeliveryId) || null;
  }, [deliveries, selectedNegoDeliveryId]);

  // 운송사 협의 이력 저장 핸들러
  const handleSaveNegotiation = async () => {
    if (!selectedNegoDeliveryId) {
      showToast('배차 건을 먼저 선택하십시오.', 'error');
      return;
    }
    if (!negoCompanyId) {
      showToast('협의 운송사를 선택하십시오.', 'error');
      return;
    }
    const company = transportCompanies.find(c => c.id === negoCompanyId);
    const newNego: TransportNegotiation = {
      id: `TN-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      deliveryId: selectedNegoDeliveryId,
      transportCompanyId: negoCompanyId,
      transportCompanyName: company?.name || '기타 운송사',
      vehicleType: negoVehicleType,
      proposedCost: Number(negoProposedCost) || 0,
      targetCost: Number(negoTargetCost) || 0,
      status: 'IN_NEGOTIATION',
      negotiatorName: currentUser?.name || '배차담당자',
      callSummary: negoCallSummary,
      specialTerms: negoSpecialTerms,
      negotiatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    db.insertRow<TransportNegotiation>('transportNegotiations', newNego);
    await db.awaitPendingWrites();
    refreshAllData();
    showToast(`${company?.name || '운송사'} 협의 견적이 등록되었습니다.`);
    setNegoCallSummary('');
    setNegoSpecialTerms('');
  };

  // 협의 조건으로 배차 건 확정 승계 핸들러
  const handleConfirmNegotiation = async (nego: TransportNegotiation) => {
    if (!nego.deliveryId) return;
    const targetDel = deliveries.find(d => d.id === nego.deliveryId);
    if (!targetDel) return;

    // 1. 배차 건에 운송사 및 비용 반영
    const costToApply = nego.confirmedCost || nego.proposedCost || 0;
    const memoAddition = `[협의확정] ${nego.transportCompanyName} ${nego.vehicleType} ₩${costToApply.toLocaleString()}`;
    db.updateRow<Delivery>('deliveries', nego.deliveryId, {
      transportCompany: nego.transportCompanyName,
      vehicleType: nego.vehicleType,
      deliveryCost: costToApply,
      expectedCost: costToApply,
      deliveryCostConfirmed: costToApply,
      memo: targetDel.memo ? `${targetDel.memo} | ${memoAddition}` : memoAddition,
      updatedAt: new Date().toISOString()
    });

    // 2. 협의 상태 CONFIRMED로 변경
    db.updateRow<TransportNegotiation>('transportNegotiations', nego.id, {
      status: 'CONFIRMED',
      confirmedCost: costToApply,
      updatedAt: new Date().toISOString()
    });

    // 기존 IN_NEGOTIATION인 항목들 REJECTED 처리
    (db.transportNegotiations || []).forEach(n => {
      if (n.id !== nego.id && n.deliveryId === nego.deliveryId && n.status === 'IN_NEGOTIATION') {
        db.updateRow<TransportNegotiation>('transportNegotiations', n.id, {
          status: 'REJECTED',
          updatedAt: new Date().toISOString()
        });
      }
    });

    await db.awaitPendingWrites();
    refreshAllData();

    if (selectedCallQueueId) {
      markTransportCallConfirmed(selectedCallQueueId);
      setCallQueue(getTransportCallQueue());
    }

    showToast(`배차 조건이 [${nego.transportCompanyName} / ₩${costToApply.toLocaleString()}]으로 확정되었습니다.`);
  };

  // 폼 입력 조건(또는 통화 분석 추출 조건)으로 1클릭 즉시 배차 확정
  const handleConfirmCurrentForm = async () => {
    if (!selectedNegoDeliveryId) {
      showToast('좌측에서 배차 대상을 먼저 선택하십시오.', 'error');
      return;
    }
    if (!negoCompanyId) {
      showToast('협의 운송사를 선택하십시오.', 'error');
      return;
    }
    const company = transportCompanies.find(c => c.id === negoCompanyId);
    const companyName = company?.name || '기타 운송사';
    const costToApply = Number(negoProposedCost) || Number(negoTargetCost) || 0;

    // 1. 배차 건에 운송사, 차종, 비용 즉시 확정 반영
    const targetDel = deliveries.find(d => d.id === selectedNegoDeliveryId);
    if (targetDel) {
      const memoAddition = `[협의확정] ${companyName} ${negoVehicleType} ₩${costToApply.toLocaleString()}`;
      db.updateRow<Delivery>('deliveries', selectedNegoDeliveryId, {
        transportCompany: companyName,
        vehicleType: negoVehicleType,
        deliveryCost: costToApply,
        expectedCost: costToApply,
        deliveryCostConfirmed: costToApply,
        status: targetDel.status === 'PENDING' ? 'DISPATCHED' : targetDel.status,
        memo: targetDel.memo ? `${targetDel.memo} | ${memoAddition}` : memoAddition,
        updatedAt: new Date().toISOString()
      });
    }

    // 2. 협의 이력에 CONFIRMED 레코드 생성/저장
    const newNego: TransportNegotiation = {
      id: `TN-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      deliveryId: selectedNegoDeliveryId,
      transportCompanyId: negoCompanyId,
      transportCompanyName: companyName,
      vehicleType: negoVehicleType,
      proposedCost: costToApply,
      targetCost: Number(negoTargetCost) || costToApply,
      confirmedCost: costToApply,
      status: 'CONFIRMED',
      negotiatorName: currentUser?.name || '배차담당자',
      callSummary: negoCallSummary,
      specialTerms: negoSpecialTerms,
      negotiatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    db.insertRow<TransportNegotiation>('transportNegotiations', newNego);

    // 3. 큐 항목 상태 변경
    if (selectedCallQueueId) {
      markTransportCallConfirmed(selectedCallQueueId);
      setCallQueue(getTransportCallQueue());
    }

    await db.awaitPendingWrites();
    refreshAllData();
    showToast(`배차 조건이 [${companyName} / ₩${costToApply.toLocaleString()}]으로 즉시 확정되었습니다.`);
  };
  
  // 배차 세부 유형 ('출고' | '입고' | '반납' | '정비' | '이동')
  const [dispatchCategory, setDispatchCategory] = useState<'출고' | '입고' | '반납' | '정비' | '이동' | '교환'>('출고');
  
  // 상차 일시 & 시간 지정
  const [loadingDate, setLoadingDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [loadingTimeSlot, setLoadingTimeSlot] = useState('오전');
  const [loadingCustomTime, setLoadingCustomTime] = useState('');

  // 하차 일시 & 시간 지정
  const [unloadingDate, setUnloadingDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [unloadingTimeSlot, setUnloadingTimeSlot] = useState('오전');
  const [unloadingCustomTime, setUnloadingCustomTime] = useState('');

  // --- 하차지 일기예보 모달 state ---
  const [showDestWeatherModal, setShowDestWeatherModal] = useState(false);
  const [destWeatherParams, setDestWeatherParams] = useState({
    customerName: '',
    siteName: '',
    rawAddress: ''
  });

  const handleOpenDestWeatherForDelivery = (del?: Delivery | null, customAddress?: string) => {
    let customerName = '-';
    let siteName = '-';
    let rawAddress = customAddress || destinationAddress || '';

    if (del) {
      const contract = contracts.find(c => c.id === del.contractId);
      const customer = customers.find(cust => cust.id === contract?.customerId);
      const site = sites?.find(s => s.id === contract?.siteId);

      customerName = customer?.name || (del as any).customerName || '-';
      siteName = site?.name || (typeof site === 'string' ? site : '현장미지정');
      
      if (!rawAddress) {
        rawAddress = site?.address || customer?.address || '';
        if (!rawAddress && del.memo) {
          const match = del.memo.match(/주소:\s*(.*?)(?=\||$)/);
          if (match) rawAddress = match[1].trim();
        }
      }
    }

    setDestWeatherParams({
      customerName: customerName || '배차 하차지',
      siteName: siteName || '현장',
      rawAddress: rawAddress || '경기도 용인시'
    });
    setShowDestWeatherModal(true);
  };

  // 실무자 마감 비고
  const [closingMemo, setClosingMemo] = useState('');

  const [scheduledDate, setScheduledDate] = useState('');
  const [originAddress, setOriginAddress] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [billableToCust, setBillableToCust] = useState(false);
  const [billableCustId, setBillableCustId] = useState('');
  const [assignedVehicles, setAssignedVehicles] = useState<AssignedVehicleRow[]>([]);

  // 수동 배차 모달 state
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualCategory, setManualCategory] = useState<'출고' | '입고' | '반납' | '정비' | '이동' | '교환'>('출고');
  const [manualCustomerId, setManualCustomerId] = useState('');
  const [manualContractId, setManualContractId] = useState('');
  const [manualOrigin, setManualOrigin] = useState('당사 보관소');
  const [manualDestination, setManualDestination] = useState('');
  const [manualLoadingDate, setManualLoadingDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [manualLoadingTimeSlot, setManualLoadingTimeSlot] = useState('오전');
  const [manualLoadingCustomTime, setManualLoadingCustomTime] = useState('');
  const [manualUnloadingDate, setManualUnloadingDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [manualUnloadingTimeSlot, setManualUnloadingTimeSlot] = useState('오전');
  const [manualUnloadingCustomTime, setManualUnloadingCustomTime] = useState('');
  const [manualExpectedCost, setManualExpectedCost] = useState(0);
  const [manualBillable, setManualBillable] = useState(false);
  const [manualMemo, setManualMemo] = useState('');
  const [manualClosingMemo, setManualClosingMemo] = useState('');

  const [manualVehicles, setManualVehicles] = useState<VehicleReq[]>([{ vehicleType: '3.5T', count: 1 }]);
  const [manualCargos, setManualCargos] = useState<CargoItem[]>([{ modelName: products[0]?.modelName || 'Skyjack SJ3219', count: 1 }]);

  // 📄 [월말 운송료 대사 탭 state & 1:1 Split Pair 파이프라인]
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 💡 [사장님 지시] 기본 조회: 2026년 7월 / 당월 1일 기준
  const [reconStartDate, setReconStartDate] = useState<string>('2026-07-01');
  const [reconEndDate, setReconEndDate] = useState<string>('2026-07-31');
  const [selectedReconCompany, setSelectedReconCompany] = useState<string>('ALL');
  
  // 💡 [사장님 지시] 지급 상태 필터: 기본값은 'UNPAID' (지급 미완료 / 미정산 건만 집중 대사)
  const [reconPaymentFilter, setReconPaymentFilter] = useState<'UNPAID' | 'PAID' | 'ALL'>('UNPAID');
  const [reconStatusFilter, setReconStatusFilter] = useState<'ALL' | 'PENDING' | 'MATCHED' | 'MISMATCH' | 'EXCEL_ONLY' | 'SYSTEM_ONLY' | 'EXCLUDED' | 'PAYMENT_REQUESTED'>('ALL');
  const [reconSearchQuery, setReconSearchQuery] = useState<string>('');

  // 1:1 Pair 행 배열 state 및 독립 듀얼 패널 선택 state
  const [reconPairs, setReconPairs] = useState<ReconPairRow[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [selectedPairIds, setSelectedPairIds] = useState<Set<string>>(new Set());
  const [reconNotificationMsg, setReconNotificationMsg] = useState<string>('');
  const [selectedSystemDeliveryId, setSelectedSystemDeliveryId] = useState<string | null>(null);
  const [selectedExcelRowIndex, setSelectedExcelRowIndex] = useState<number | null>(null);

  // 💡 [사장님 지시] 대사 행 더블클릭 시 배차 상세 및 대사 비교 모달 state
  const [selectedReconDetailPair, setSelectedReconDetailPair] = useState<ReconPairRow | null>(null);

  // 💡 [사장님 지시] 금액 수정 모달 state & DB 반영 핸들러
  const [showCostEditModal, setShowCostEditModal] = useState<boolean>(false);
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null);
  const [editingCostInput, setEditingCostInput] = useState<number>(0);

  const handleOpenCostEdit = (d: Delivery, currentCost: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingDelivery(d);
    setEditingCostInput(currentCost);
    setShowCostEditModal(true);
  };

  const handleSaveDeliveryCost = async () => {
    if (!editingDelivery) return;
    const newCost = Number(editingCostInput);
    if (isNaN(newCost) || newCost < 0) {
      showErrorModal('유효한 금액을 입력해 주세요.');
      return;
    }

    try {
      // 1. DB (deliveries 테이블) 동기 업데이트 수행 (deliveryCost 및 assignedVehicles 차량 운송비 동시 동기화)
      const updatedVehicles = editingDelivery.assignedVehicles && editingDelivery.assignedVehicles.length > 0
        ? editingDelivery.assignedVehicles.map((v, i) => i === 0 ? { ...v, deliveryCost: newCost } : { ...v, deliveryCost: 0 })
        : [];

      const updateData: any = {
        finalCost: newCost,
        deliveryCost: newCost
      };

      if (updatedVehicles.length > 0) {
        updateData.assignedVehicles = updatedVehicles;
      }

      db.updateRow('deliveries', editingDelivery.id, updateData);

      // 💡 [사장님 지시] 원격 Supabase DB 쓰기가 100% 완료될 때까지 동기 대기 (Zero Silent Failures)
      await db.awaitPendingWrites();

      // 💡 [사장님 지시] 단순 대기만 하지 않고, 실제 DB를 다시 SELECT 읽기조회하여 목표 금액으로 100% 정상 수정되었는지 실시간 검증 (Read-Back Verification)
      const verifiedDelivery = db.deliveries.find(d => d.id === editingDelivery.id);
      const verifiedCost = verifiedDelivery ? (verifiedDelivery.deliveryCost || (verifiedDelivery.assignedVehicles && verifiedDelivery.assignedVehicles[0]?.deliveryCost) || 0) : 0;

      if (!verifiedDelivery || verifiedCost !== newCost) {
        throw new Error(`DB 반영 검증 실패 (목표 금액: ₩${newCost.toLocaleString()}원 vs 실제 DB 저장액: ₩${verifiedCost.toLocaleString()}원). DB 갱신이 정상적으로 처리되지 않았습니다.`);
      }

      // 2. 전체 데이터 및 state 갱신
      await refreshAllData();

      // 3. 1:1 대사 reconPairs 실시간 차액 및 자동 짝짓기 재계산
      setReconPairs(prev => prev.map(p => {
        if (p.systemDelivery?.id === editingDelivery.id) {
          const excelCost = p.excelCost || 0;
          const newDiff = excelCost > 0 ? (excelCost - newCost) : 0;
          const isMatchedNow = p.excelRow ? (newDiff === 0 && excelCost > 0) : false;

          return {
            ...p,
            systemCost: newCost,
            diffCost: newDiff,
            matchStatus: isMatchedNow ? 'MATCHED' : (newDiff !== 0 && excelCost > 0 ? 'MISMATCH' : p.matchStatus),
            isReconciled: isMatchedNow,
            memo: isMatchedNow ? '금액 수정 후 100% 일치 대사 완료' : `금액 수정 반영됨 (시스템 ₩${newCost.toLocaleString()}원)`
          };
        }
        return p;
      }));

      setShowCostEditModal(false);
      setEditingDelivery(null);
      setReconNotificationMsg(`💰 ${editingDelivery.id} 배차 운송료가 ₩${newCost.toLocaleString()}원으로 수정되어 DB에 반영되었습니다.`);
    } catch (err: any) {
      showErrorModal('금액 수정 중 오류가 발생하였습니다: ' + err.message);
    }
  };

  // 💡 [사장님 지시] 좌측 1개 행 + 우측 1개 행 수동 선택 1:1 대사완료 매칭
  const handleManualPairMatch = () => {
    if (!selectedSystemDeliveryId || selectedExcelRowIndex === null) {
      showErrorModal('좌측 시스템 배차 1건과 우측 엑셀 항목 1건을 각각 선택해 주세요.');
      return;
    }

    const sysD = deliveries.find(d => d.id === selectedSystemDeliveryId);
    const excelRows = reconPairs.filter(p => p.excelRow);
    const excelPair = excelRows[selectedExcelRowIndex];

    if (!sysD || !excelPair) {
      showErrorModal('선택한 배차 또는 엑셀 항목을 찾을 수 없습니다.');
      return;
    }

    const sysCost = getEffectiveDeliveryCost(sysD);
    const costKey = Object.keys(excelPair.excelRow).find(k => k.includes('합계') || k.includes('운송비') || k.includes('청구금액') || k.includes('금액'));
    const excelCost = costKey ? Number(String(excelPair.excelRow[costKey]).replace(/[^0-9.-]+/g, '')) : 0;
    const diff = excelCost - sysCost;

    // 💡 [사장님 지시] 좌측/우측 금액 상이 시 대사 처리 거절
    if (diff !== 0) {
      showErrorModal(`⚠️ [대사 처리 거절]\n\n• 좌측 시스템 금액: ₩${sysCost.toLocaleString()}원\n• 우측 엑셀 청구금액: ₩${excelCost.toLocaleString()}원\n• 차액: ₩${Math.abs(diff).toLocaleString()}원\n\n좌측과 우측 패널의 금액이 상이한 항목은 대사 처리가 불가능합니다.`);
      return;
    }

    setReconPairs(prev => {
      const filtered = prev.filter(p => p.systemDelivery?.id !== sysD.id && p.pairId !== excelPair.pairId);
      return [
        ...filtered,
        {
          pairId: `MANUAL-PAIR-${sysD.id}-${Date.now()}`,
          systemDelivery: sysD,
          excelRow: excelPair.excelRow,
          matchStatus: 'MATCHED',
          systemCost: sysCost,
          excelCost,
          diffCost: diff,
          memo: '담당자 1:1 수동 선택 대사 완료',
          isReconciled: true
        }
      ];
    });

    setSelectedSystemDeliveryId(null);
    setSelectedExcelRowIndex(null);
    setReconNotificationMsg(`✅ ${sysD.id} 배차건과 엑셀 행이 1:1 수동 대사 완료 처리되었습니다.`);
  };

  // 📅 기간 선택 피커 헬퍼 (월별 정산 원클릭 지원)
  const handleSetReconMonth = (year: number, month: number) => {
    const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    setReconStartDate(startStr);
    setReconEndDate(endStr);
  };

  const handleSetReconDatePreset = (preset: '2026-07' | '2026-08' | 'THIS_MONTH' | 'LAST_MONTH' | '1M' | '3M' | 'ALL') => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    if (preset === '2026-07') {
      handleSetReconMonth(2026, 7);
    } else if (preset === '2026-08') {
      handleSetReconMonth(2026, 8);
    } else if (preset === 'THIS_MONTH') {
      handleSetReconMonth(today.getFullYear(), today.getMonth() + 1);
    } else if (preset === 'LAST_MONTH') {
      const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      handleSetReconMonth(lm.getFullYear(), lm.getMonth() + 1);
    } else if (preset === '1M') {
      const past = new Date();
      past.setMonth(today.getMonth() - 1);
      setReconStartDate(past.toISOString().split('T')[0]);
      setReconEndDate(todayStr);
    } else if (preset === '3M') {
      const past = new Date();
      past.setMonth(today.getMonth() - 3);
      setReconStartDate(past.toISOString().split('T')[0]);
      setReconEndDate(todayStr);
    } else {
      setReconStartDate('');
      setReconEndDate('');
    }
  };

  // 🏢 운송사별 미지급(대사 대상) 건수 및 금액 실시간 집계 (선택된 기간 기준)
  const unpaidStatsByCompany = useMemo(() => {
    const inPeriodDeliveries = deliveries.filter(d => {
      if (getNormalizedDeliveryStatus(d) !== 'DELIVERED') return false;
      const dDate = d.loadingDate || d.requestDate || d.scheduledDate || d.createdAt?.substring(0, 10);
      if (reconStartDate && dDate && dDate < reconStartDate) return false;
      if (reconEndDate && dDate && dDate > reconEndDate) return false;
      return true;
    });

    const stats: Record<string, { total: number; unpaid: number; unpaidCost: number }> = {
      ALL: { total: 0, unpaid: 0, unpaidCost: 0 }
    };

    inPeriodDeliveries.forEach(d => {
      const isPaid = (d as any).reconciliationStatus === 'PAYMENT_REQUESTED' || (d as any).reconciliationStatus === 'SETTLED' || d.isCostSettled === true;
      const cost = getEffectiveDeliveryCost(d);

      // 운송사명 파싱
      const rawComp = d.assignedVehicles?.[0]?.transportCompany || d.transportCompany || '';
      let matchedComp = '기타';
      if (rawComp.includes('경기')) matchedComp = '경기';
      else if (rawComp.includes('엘제이') || rawComp.toLowerCase().includes('lj')) matchedComp = '엘제이';
      else if (rawComp.includes('자인') || rawComp.includes('엠제이') || rawComp.toLowerCase().includes('mj')) matchedComp = '자인';
      else if (rawComp) matchedComp = rawComp;

      stats.ALL.total++;
      if (!isPaid) {
        stats.ALL.unpaid++;
        stats.ALL.unpaidCost += cost;
      }

      if (!stats[matchedComp]) {
        stats[matchedComp] = { total: 0, unpaid: 0, unpaidCost: 0 };
      }
      stats[matchedComp].total++;
      if (!isPaid) {
        stats[matchedComp].unpaid++;
        stats[matchedComp].unpaidCost += cost;
      }
    });

    return stats;
  }, [deliveries, reconStartDate, reconEndDate]);

  // 🚚 운송 완료(DELIVERED) 건들 대사 대상 필터링 (지급 상태 및 운송사별 연동)
  const completedDeliveriesForRecon = useMemo(() => {
    return deliveries.filter(d => {
      // 1. 운송 완료건만 대상
      if (getNormalizedDeliveryStatus(d) !== 'DELIVERED') return false;

      // 2. 💡 [사장님 지시] 지급/정산 상태 필터 (기본: 지급 미완료 건만 대사 대상)
      const isPaid = (d as any).reconciliationStatus === 'PAYMENT_REQUESTED' || (d as any).reconciliationStatus === 'SETTLED' || d.isCostSettled === true;
      if (reconPaymentFilter === 'UNPAID' && isPaid) return false;
      if (reconPaymentFilter === 'PAID' && !isPaid) return false;

      // 3. 날짜 필터
      const dDate = d.loadingDate || d.requestDate || d.scheduledDate || d.createdAt?.substring(0, 10);
      if (reconStartDate && dDate && dDate < reconStartDate) return false;
      if (reconEndDate && dDate && dDate > reconEndDate) return false;

      // 4. 운송 거래처 필터
      if (selectedReconCompany !== 'ALL') {
        const rawComp = d.assignedVehicles?.[0]?.transportCompany || d.transportCompany || '';
        const match = rawComp.toLowerCase().includes(selectedReconCompany.toLowerCase());
        if (!match) return false;
      }

      // 5. 검색어 (배차ID, 기사명, 거래처, 고객사명)
      if (reconSearchQuery) {
        const q = reconSearchQuery.trim();
        const contract = contracts.find(c => c.id === d.contractId);
        const customer = contract ? customers.find(c => c.id === contract.customerId) : null;
        const match = (d.id && d.id.toLowerCase().includes(q.toLowerCase())) ||
          (d.driverName && matchHangul(d.driverName, q)) ||
          (d.destinationAddress && matchHangul(d.destinationAddress, q)) ||
          (contract && contract.contractNo.toLowerCase().includes(q.toLowerCase())) ||
          (customer && matchHangul(customer.name, q));
        if (!match) return false;
      }

      return true;
    }).sort((a, b) => {
      const dateA = a.loadingDate || a.requestDate || a.scheduledDate || a.createdAt?.substring(0, 10) || '9999-99-99';
      const dateB = b.loadingDate || b.requestDate || b.scheduledDate || b.createdAt?.substring(0, 10) || '9999-99-99';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (a.id || '').localeCompare(b.id || '');
    });
  }, [deliveries, reconPaymentFilter, reconStartDate, reconEndDate, selectedReconCompany, reconSearchQuery, contracts, customers]);

  // 💡 [사장님 지시] 조회 버튼 클릭 시 로딩된 대사 정보(엑셀 1:1 대사 pair, 업로드 파일, 선택 상태 등)를 완전 초기화하여 깨끗한 원장 조회 상태로 복귀
  const handleReconSearch = () => {
    setReconPairs([]);
    setUploadedFileName('');
    setSelectedPairIds(new Set());
    setSelectedSystemDeliveryId(null);
    setSelectedExcelRowIndex(null);
    setReconStatusFilter('ALL');
    setReconSearchQuery('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setReconNotificationMsg(`🔍 [${selectedReconCompany === 'ALL' ? '전체 거래처' : selectedReconCompany}] (${reconStartDate} ~ ${reconEndDate} / ${reconPaymentFilter === 'UNPAID' ? '미지급건' : reconPaymentFilter === 'PAID' ? '지급완료건' : '전체'}) 조회가 갱신되었습니다. (대사 정보 초기화됨)`);
  };

  // 거래명세서 엑셀 파싱 및 스마트 1:1 페어링 파이프라인 (다변형 서식/날짜 정규화 & 2단계 지능형 매칭 엔진)
  const handleExcelFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        
        // 1. 유효 데이터가 가장 많은 시트 자동 선택 (빈 시트 필터링)
        let targetSheetName = workbook.SheetNames[0];
        let maxRowCount = 0;
        for (const sName of workbook.SheetNames) {
          const ws = workbook.Sheets[sName];
          const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (raw && raw.length > maxRowCount) {
            maxRowCount = raw.length;
            targetSheetName = sName;
          }
        }

        const sheet = workbook.Sheets[targetSheetName];
        const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (!rawRows || rawRows.length === 0) {
          showErrorModal('업로드한 엑셀 파일에 데이터가 없습니다.');
          return;
        }

        // 2. 동적 헤더 행 감지 (정밀 셀 단위 매칭: 최다 키워드 일치 행 선정)
        const headerKeywords = ['일자', '날짜', '상차지', '하차지', '톤수', '차종', '운송비', '현장명', '업체명', '기사명', '비고', 'no', '단가', '금액', '합계', '장비명', '사용기간', '품명'];
        let headerRowIndex = -1;
        let maxMatchCount = 0;

        for (let r = 0; r < Math.min(30, rawRows.length); r++) {
          const cells = rawRows[r].map((c: any) => String(c).replace(/\s+/g, '').toLowerCase());
          const fullRowTextClean = cells.join(' ');
          // 명세서 상단 공급가액/합계금액 요약표 행은 명세서 본문 테이블 헤더가 아니므로 제외
          if (fullRowTextClean.includes('공급가액') || fullRowTextClean.includes('사업장주소') || fullRowTextClean.includes('등록번호')) {
            continue;
          }
          const matchCount = headerKeywords.filter(kw =>
            cells.some((cell: string) => cell === kw || (cell.length <= 10 && cell.includes(kw)))
          ).length;
          if (matchCount > maxMatchCount && matchCount >= 3) {
            maxMatchCount = matchCount;
            headerRowIndex = r;
          }
        }

        if (headerRowIndex === -1) {
          headerRowIndex = 0;
        }

        // 3. 헤더 컬럼명 추출
        const rawHeaderRow = rawRows[headerRowIndex] || [];
        const headerNames: string[] = rawHeaderRow.map((col: any, cIdx: number) => {
          const title = String(col).trim();
          if (title) return title;
          return `비고_${cIdx + 1}`;
        });

        const isMemoKey = (k: string) => {
          const kl = k.replace(/\s+/g, '').toLowerCase();
          // 날짜, 금액, 상차지, 번호 등 정규 컬럼은 비고에 넣지 않음
          if (kl.includes('일자') || kl.includes('날짜') || kl.includes('운송일') || kl.includes('사용기간') ||
              kl.includes('금액') || kl.includes('단가') || kl.includes('운송비') || kl.includes('청구') ||
              kl.includes('no') || kl.includes('번호')) {
            return false;
          }
          return kl.includes('현장') || kl.includes('업체') || kl.includes('비고') ||
                 kl.includes('메모') || kl.includes('특이') || kl.includes('참고') || kl.includes('장비') || kl.includes('품명');
        };

        // 4. 데이터 행 구성 (디토 상속 & 날짜/금액 정규화)
        const parsedRows: any[] = [];
        let lastDate = '';
        let lastOrigin = '';
        let lastDest = '';

        const isDitto = (val: string) =>
          !val || val === '"' || val === '·' || val === '〃' || val === "''";

        const currentYear = reconStartDate ? reconStartDate.split('-')[0] : String(new Date().getFullYear());
        const currentMonth = reconStartDate ? reconStartDate.split('-')[1] : String(new Date().getMonth() + 1).padStart(2, '0');

        for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
          const rowArr = rawRows[r];
          if (!rowArr || rowArr.every((cell: any) => String(cell).trim() === '')) continue;

          const firstCellClean = String(rowArr[0] || '').replace(/\s+/g, '');
          const fullRowTextClean = rowArr.map((cell: any) => String(cell).trim()).join(' ');

          // 합계/소계/서명/입금계좌 행 제외
          const isFooterRow =
            firstCellClean.startsWith('합계') || firstCellClean.startsWith('소계') || firstCellClean.startsWith('총계') ||
            fullRowTextClean.includes('공급가액') || fullRowTextClean.includes('합계금액') || fullRowTextClean.includes('부가세') ||
            fullRowTextClean.includes('사업장주소') || fullRowTextClean.includes('등록번호') || fullRowTextClean.includes('입금계좌') ||
            fullRowTextClean.includes('계좌번호');
          if (isFooterRow) continue;

          const rowObj: any = {};
          headerNames.forEach((hName, cIdx) => {
            rowObj[hName] = String(rowArr[cIdx] !== undefined ? rowArr[cIdx] : '').trim();
          });

          // 금액 추출 (공백 제거 정규화 매칭):
          let rawCost = 0;
          // 1순위: 운송비, 청구금액, 청구액, 단가 등 명확한 운송비 헤더 (일자/날짜/번호 제외)
          const priorityCostKey = Object.keys(rowObj).find(k => {
            const ck = k.replace(/\s+/g, '');
            return (ck.includes('운송비') || ck.includes('청구') || ck.includes('단가')) && !ck.includes('일자') && !ck.includes('날짜') && !ck.toLowerCase().includes('no');
          });
          // 2순위: 금액, 합계 (일자/날짜/번호 제외)
          const generalCostKey = Object.keys(rowObj).find(k => {
            const ck = k.replace(/\s+/g, '');
            return (ck.includes('금액') || ck.includes('합계')) && !ck.includes('일자') && !ck.includes('날짜') && !ck.toLowerCase().includes('no');
          });
          const costKey = priorityCostKey || generalCostKey;

          if (costKey && rowObj[costKey]) {
            rawCost = Number(String(rowObj[costKey]).replace(/[^0-9.-]+/g, '')) || 0;
          }
          if (rawCost === 0) {
            // 끝부분 컬럼에서 금액 역추적 (날짜 시리얼 35000~55000 제외)
            for (let c = rowArr.length - 1; c >= 0; c--) {
              const num = Number(String(rowArr[c]).replace(/[^0-9.-]+/g, ''));
              if (num >= 10000 && num <= 5000000 && !(num >= 40000 && num <= 50000 && c <= 2)) {
                rawCost = num;
                break;
              }
            }
          }

          const dateKey = Object.keys(rowObj).find(k => {
            const ck = k.replace(/\s+/g, '');
            return ck.includes('일자') || ck.includes('날짜') || ck.includes('운송일') || ck.includes('사용기간');
          });
          const originKey = Object.keys(rowObj).find(k => {
            const ck = k.replace(/\s+/g, '');
            return ck.includes('상차지') || ck.includes('출발지') || ck.includes('상차');
          });
          const destKey = Object.keys(rowObj).find(k => {
            const ck = k.replace(/\s+/g, '');
            return ck.includes('하차지') || ck.includes('도착지') || ck.includes('현장') || ck.includes('하차');
          });

          let rawDateCell = dateKey ? String(rowObj[dateKey]).trim() : '';
          let rawOrigin = originKey ? String(rowObj[originKey]).trim() : '';
          let rawDest = destKey ? String(rowObj[destKey]).trim() : '';

          if (rawCost <= 0 && !rawDateCell && !rawOrigin && !rawDest) continue;

          if (isDitto(rawDateCell) && lastDate) rawDateCell = lastDate;
          else if (rawDateCell && !isDitto(rawDateCell)) lastDate = rawDateCell;

          if (isDitto(rawOrigin) && lastOrigin) rawOrigin = lastOrigin;
          else if (rawOrigin && !isDitto(rawOrigin)) lastOrigin = rawOrigin;

          if (isDitto(rawDest) && lastDest) rawDest = lastDest;
          else if (rawDest && !isDitto(rawDest)) lastDest = rawDest;

          // 📅 날짜 정규화: "2026.07/01", "2일", "7/1", 엑셀 시리얼 넘버 등
          let normDate = rawDateCell;
          if (rawDateCell) {
            const numVal = Number(rawDateCell);
            if (!isNaN(numVal) && numVal > 30000 && numVal < 60000) {
              const utcDays = Math.floor(numVal - 25569);
              const d = new Date(utcDays * 86400 * 1000);
              normDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            } else if (rawDateCell.match(/^(\d{1,2})일$/)) {
              const day = rawDateCell.replace('일', '').padStart(2, '0');
              normDate = `${currentYear}-${currentMonth}-${day}`;
            } else if (rawDateCell.includes('.') && rawDateCell.includes('/')) {
              // "2026.07/01" 형태
              const parts = rawDateCell.split(/[\.\/]/);
              if (parts.length >= 3) {
                normDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
              }
            } else if (rawDateCell.includes('/')) {
              const parts = rawDateCell.split('/');
              if (parts.length === 2) normDate = `${currentYear}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
              else if (parts.length === 3) normDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            } else if (rawDateCell.includes('-')) {
              const parts = rawDateCell.split(' ')[0].split('-');
              if (parts.length === 3) normDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            }
          }

          if (dateKey) rowObj[dateKey] = normDate;
          rowObj['정규일자'] = normDate;
          rowObj['정규금액'] = rawCost;
          rowObj['정규상차지'] = rawOrigin;
          rowObj['정규하차지'] = rawDest;

          // 비고 병합
          const memoParts: string[] = [];
          Object.keys(rowObj).forEach(k => {
            if (!isMemoKey(k) || k.startsWith('정규')) return;
            const val = String(rowObj[k] || '').trim();
            if (val && !isDitto(val) && val !== '-') {
              memoParts.push(val);
            }
          });
          rowObj['비고'] = memoParts.join(' | ');

          parsedRows.push(rowObj);
        }

        if (parsedRows.length === 0) {
          showErrorModal('엑셀 파싱 결과 데이터 행을 찾을 수 없습니다.');
          return;
        }

        // 5. 2단계 지능형 1:1 대사 매칭 엔진
        const remainingSystemDeliveries = [...completedDeliveriesForRecon];
        const pairs: ReconPairRow[] = [];
        let autoMatchedCount = 0;
        let mismatchCount = 0;

        parsedRows.forEach((row, rIdx) => {
          const excelCost = row['정규금액'] || 0;
          const excelDate = row['정규일자'] || '';
          const excelDest = row['정규하차지'] || row['현장명'] || '';
          const excelMemo = row['비고'] || '';

          // 텍스트 유사도 헬퍼 (포함 관계 확인)
          const isTextSimilar = (a: string, b: string) => {
            if (!a || !b) return false;
            const ca = a.replace(/\s+/g, '').toLowerCase();
            const cb = b.replace(/\s+/g, '').toLowerCase();
            if (ca.includes(cb) || cb.includes(ca)) return true;
            // 핵심 2~3글자 단어 매칭
            const words = a.split(/[\s\(\)\/]+/).filter(w => w.length >= 2);
            return words.some(w => cb.includes(w.toLowerCase()));
          };

          // 날짜 일치도 헬퍼 (±1일 허용)
          const isDateNear = (d1: string, d2: string) => {
            if (!d1 || !d2) return false; // 💡 날짜가 없으면 임의 매칭 방지
            if (d1 === d2) return true;
            try {
              const t1 = new Date(d1).getTime();
              const t2 = new Date(d2).getTime();
              return Math.abs(t1 - t2) <= 86400000 * 1.5;
            } catch {
              return false;
            }
          };

          // 1단계: 날짜(±1일) + 현장/업체 유사도 + 금액 100% 일치
          let matchIdx = remainingSystemDeliveries.findIndex(d => {
            const sysDate = d.loadingDate || d.requestDate || '';
            const sysCost = getEffectiveDeliveryCost(d);
            const contract = contracts.find(c => c.id === d.contractId);
            const customer = contract ? customers.find(c => c.id === contract.customerId) : null;
            const sysDest = d.destinationAddress || '';
            const custName = customer?.name || '';

            const dateMatch = isDateNear(sysDate, excelDate);
            const textMatch = !excelDest || isTextSimilar(sysDest, excelDest) || isTextSimilar(custName, excelMemo) || isTextSimilar(sysDest, excelMemo);
            const costMatch = excelCost > 0 && (sysCost === excelCost || d.finalCost === excelCost);

            return dateMatch && textMatch && costMatch;
          });

          // 2단계 (핵심 혁신): 날짜(±1일) + 현장/업체 유사도 + 금액 불일치 (할증/대기료 짝짓기!)
          let isMismatch = false;
          if (matchIdx === -1) {
            matchIdx = remainingSystemDeliveries.findIndex(d => {
              const sysDate = d.loadingDate || d.requestDate || '';
              const contract = contracts.find(c => c.id === d.contractId);
              const customer = contract ? customers.find(c => c.id === contract.customerId) : null;
              const sysDest = d.destinationAddress || '';
              const custName = customer?.name || '';

              const dateMatch = isDateNear(sysDate, excelDate);
              const textMatch = (excelDest && isTextSimilar(sysDest, excelDest)) ||
                                (excelMemo && isTextSimilar(custName, excelMemo)) ||
                                (excelMemo && isTextSimilar(sysDest, excelMemo));

              return dateMatch && textMatch;
            });
            if (matchIdx !== -1) isMismatch = true;
          }

          if (matchIdx !== -1) {
            const matchedDelivery = remainingSystemDeliveries.splice(matchIdx, 1)[0];
            const sysCost = getEffectiveDeliveryCost(matchedDelivery);
            const diff = excelCost - sysCost;

            // 할증 사유 자동 감지 (대기, 경유, 회차 등)
            let detectedReason = '';
            if (excelMemo.includes('대기')) detectedReason = '현장 대기료';
            else if (excelMemo.includes('상차') || excelMemo.includes('하차') || excelMemo.includes('2곳') || excelMemo.includes('경유')) detectedReason = '경유지 할증';
            else if (excelMemo.includes('회차')) detectedReason = '회차비';
            else if (diff > 0) detectedReason = `단가 차액 (+₩${diff.toLocaleString()})`;

            if (isMismatch && diff !== 0) {
              mismatchCount++;
              pairs.push({
                pairId: `PAIR-${matchedDelivery.id}-${rIdx}`,
                systemDelivery: matchedDelivery,
                excelRow: row,
                matchStatus: 'MISMATCH',
                systemCost: sysCost,
                excelCost,
                diffCost: diff,
                surchargeReason: detectedReason,
                memo: excelMemo || `시스템 ₩${sysCost.toLocaleString()}원 vs 엑셀 ₩${excelCost.toLocaleString()}원 (${detectedReason})`,
                isReconciled: false
              });
            } else {
              autoMatchedCount++;
              pairs.push({
                pairId: `PAIR-${matchedDelivery.id}-${rIdx}`,
                systemDelivery: matchedDelivery,
                excelRow: row,
                matchStatus: 'MATCHED',
                systemCost: sysCost,
                excelCost,
                diffCost: 0,
                surchargeReason: detectedReason,
                memo: excelMemo || '날짜/현장/금액 일치 (자동 매칭)',
                isReconciled: true
              });
            }
          } else {
            // 엑셀 단독 항목
            pairs.push({
              pairId: `EXCEL-ONLY-${rIdx}`,
              excelRow: row,
              matchStatus: 'EXCEL_ONLY',
              systemCost: 0,
              excelCost,
              diffCost: excelCost,
              memo: row['비고'] || '시스템 배차 미존재 (전대 회수 또는 오청구)',
              isReconciled: false,
              isExcluded: false
            });
          }
        });

        // 남은 시스템 배차 (시스템 단독 항목)
        remainingSystemDeliveries.forEach((sysD, sIdx) => {
          const sysCost = getEffectiveDeliveryCost(sysD);
          pairs.push({
            pairId: `SYS-ONLY-${sysD.id}-${sIdx}`,
            systemDelivery: sysD,
            matchStatus: 'SYSTEM_ONLY',
            systemCost: sysCost,
            excelCost: 0,
            diffCost: -sysCost,
            memo: '명세서 엑셀 미기재 (미청구 또는 타 운송사 건)',
            isReconciled: false
          });
        });

        setReconPairs(pairs);
        const excelOnlyCnt = pairs.filter(p => p.matchStatus === 'EXCEL_ONLY').length;
        const msg = `🎉 2단계 지능형 대사 완료! [🟢 일치 ${autoMatchedCount}건] | [🟡 금액불일치/할증 ${mismatchCount}건] | [🔴 엑셀단독 ${excelOnlyCnt}건] | [⚪ 시스템단독 ${remainingSystemDeliveries.length}건]`;
        setReconNotificationMsg(msg);
      } catch (err: any) {
        showErrorModal('엑셀 파싱 중 오류가 발생하였습니다: ' + err.message);
      }
    };

    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ⚡ 차액 원클릭 승인 (MISMATCH -> MATCHED 확정)
  const handleApproveMismatch = async (pairId: string) => {
    const pair = reconPairs.find(p => p.pairId === pairId);
    if (!pair || !pair.systemDelivery) return;

    try {
      await db.updateRow('deliveries', pair.systemDelivery.id, {
        finalCost: pair.excelCost,
        deliveryCost: pair.excelCost,
        reconciliationStatus: 'RECONCILED',
        memo: [pair.systemDelivery.memo, `[차액승인: ₩${pair.excelCost.toLocaleString()} (${pair.surchargeReason || '할증인정'})]`].filter(Boolean).join(' | ')
      } as any);
      await db.awaitPendingWrites();
      refreshAllData();

      setReconPairs(prev => prev.map(p => {
        if (p.pairId === pairId) {
          return {
            ...p,
            matchStatus: 'MATCHED',
            systemCost: p.excelCost,
            diffCost: 0,
            isReconciled: true
          };
        }
        return p;
      }));
    } catch (e: any) {
      showErrorModal(`차액 승인 실패: ${e.message}`);
    }
  };

  // ⚡ 모든 차액/할증 건 1클릭 일괄 승인
  const handleApproveAllMismatches = async () => {
    const mismatches = reconPairs.filter(p => p.matchStatus === 'MISMATCH' && p.systemDelivery);
    if (mismatches.length === 0) return;

    showToast(`금액 불일치 건 총 ${mismatches.length}건을 청구 금액으로 일괄 승인 처리합니다.`);

    try {
      for (const pair of mismatches) {
        if (pair.systemDelivery) {
          await db.updateRow('deliveries', pair.systemDelivery.id, {
            finalCost: pair.excelCost,
            deliveryCost: pair.excelCost,
            reconciliationStatus: 'RECONCILED',
            memo: [pair.systemDelivery.memo, `[할증일괄승인: ₩${pair.excelCost.toLocaleString()} (${pair.surchargeReason || '할증'})]`].filter(Boolean).join(' | ')
          } as any);
        }
      }
      await db.awaitPendingWrites();
      refreshAllData();

      setReconPairs(prev => prev.map(p => {
        if (p.matchStatus === 'MISMATCH' && p.systemDelivery) {
          return {
            ...p,
            matchStatus: 'MATCHED',
            systemCost: p.excelCost,
            diffCost: 0,
            isReconciled: true
          };
        }
        return p;
      }));
      setReconNotificationMsg(`✅ 할증 및 금액 불일치 ${mismatches.length}건이 일괄 승인되었습니다.`);
    } catch (e: any) {
      showErrorModal(`일괄 승인 오류: ${e.message}`);
    }
  };

  // 🚫 엑셀 단독 건 오청구 제외 (반려 처리하여 데드락 해제)
  const handleExcludeExcelOnly = (pairId: string) => {
    setReconPairs(prev => prev.map(p => {
      if (p.pairId === pairId) {
        const nextExcluded = !p.isExcluded;
        return {
          ...p,
          isExcluded: nextExcluded,
          isReconciled: nextExcluded ? true : false,
          matchStatus: nextExcluded ? 'EXCLUDED' : 'EXCEL_ONLY'
        };
      }
      return p;
    }));
  };

  // ➕ 엑셀 단독 건을 시스템 배차로 즉시 생성
  const handleCreateDeliveryFromExcel = async (pairId: string) => {
    const pair = reconPairs.find(p => p.pairId === pairId);
    if (!pair || !pair.excelRow) return;

    const row = pair.excelRow;
    const cost = pair.excelCost;
    const date = row['정규일자'] || reconStartDate;
    const dest = row['정규하차지'] || row['현장명'] || '미기재 현장';
    const memo = row['비고'] || '엑셀 거래명세서 기반 자동 배차 생성';

    try {
      const newDelivId = `DEL-${date.replace(/-/g, '').slice(2)}-${Math.floor(100 + Math.random() * 900)}`;
      const newDeliv: any = {
        id: newDelivId,
        type: 'INBOUND',
        status: 'DELIVERED',
        requestDate: date,
        loadingDate: date,
        unloadingDate: date,
        destinationAddress: dest,
        transportCompany: selectedReconCompany === 'ALL' ? '기타운송' : selectedReconCompany,
        deliveryCost: cost,
        finalCost: cost,
        expectedCost: cost,
        isCostSettled: false,
        dispatchCategory: '입고',
        reconciliationStatus: 'RECONCILED',
        memo: `[명세서 자동생성] ${memo}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await db.insertRow('deliveries', newDeliv);

      setReconPairs(prev => prev.map(p => {
        if (p.pairId === pairId) {
          return {
            ...p,
            systemDelivery: newDeliv,
            systemCost: cost,
            diffCost: 0,
            matchStatus: 'MATCHED',
            isReconciled: true,
            memo: `신규 배차 생성 및 대사 완료 (${newDelivId})`
          };
        }
        return p;
      }));

      await db.awaitPendingWrites();
      await refreshAllData();
      setReconNotificationMsg(`✅ 신규 배차(${newDelivId})가 생성되고 대사 완료되었습니다.`);
    } catch (e: any) {
      showErrorModal(`배차 생성 실패: ${e.message}`);
    }
  };

  // 💡 [사장님 지시] 💳 대사 완료 1건의 통합 매입 지급요청 생성 (Payment Request Bundle)
  const handleExecuteBundlePaymentRequest = async () => {
    const excelPairs = reconPairs.filter(p => p.excelRow);

    if (excelPairs.length === 0) {
      showErrorModal('지급 요청을 작성하려면 먼저 상단의 [📄 엑셀 거래명세서 업로드]를 진행해 주세요.');
      return;
    }

    // 오른쪽 패널(거래명세서 엑셀) 항목 중 대사 미완료건이 있는지 검사 (반려/제외 처리된 건은 통과)
    const unreconciledExcelPairs = excelPairs.filter(p => !p.isReconciled && !p.isExcluded);

    if (unreconciledExcelPairs.length > 0) {
      showErrorModal(`⚠️ 업로드한 거래명세서 엑셀 항목 (${excelPairs.length}건) 중 아직 대사/승인되지 않은 항목이 ${unreconciledExcelPairs.length}건 남아있어 지급요청을 작성할 수 없습니다.\n\n불일치 건은 [차액 승인] 또는 [오청구 제외/반려]를 처리해 주세요.`);
      return;
    }

    const reconciledPairs = reconPairs.filter(p => p.isReconciled && p.systemDelivery && !p.isExcluded);

    const bundleCode = `PAY-BUNDLE-${new Date().toISOString().substring(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const totalBundleCost = reconciledPairs.reduce((acc, p) => acc + p.systemCost, 0);

    try {
      for (const pair of reconciledPairs) {
        if (pair.systemDelivery) {
          await db.updateRow('deliveries', pair.systemDelivery.id, {
            reconciliationStatus: 'PAYMENT_REQUESTED',
            paymentRequestedAt: new Date().toISOString(),
            memo: `[통합지급요청: ${bundleCode}] ${pair.memo || ''}`
          } as any);
        }
      }

      await db.awaitPendingWrites();
      refreshAllData();

      setReconPairs(prev => prev.map(p => {
        if (p.isReconciled && p.systemDelivery && !p.isExcluded) {
          return { ...p, matchStatus: 'PAYMENT_REQUESTED' as any };
        }
        return p;
      }));

      setReconNotificationMsg(`🎉 [통합 지급요청 완료] 요청번호: ${bundleCode} | 총 ${reconciledPairs.length}건 (합계 ₩${totalBundleCost.toLocaleString()}원) 매입 지급 요청이 저장되었습니다.`);
      showErrorModal(`🎉 [통합 지급 요청 완비]\n\n• 지급요청 번호: ${bundleCode}\n• 포함된 배차건수: ${reconciledPairs.length}건\n• 총 매입 지급금액: ₩${totalBundleCost.toLocaleString()}원\n\n매입 지급 요청이 성공적으로 저장되었습니다.`, '매입 지급 요청 완료');
    } catch (err: any) {
      showErrorModal('지급 요청 처리 중 오류가 발생하였습니다: ' + err.message);
    }
  };

  // 대사 통계 실시간 집계
  const reconStats = useMemo(() => {
    const isPairMode = reconPairs.length > 0;
    
    if (isPairMode) {
      const excelPairs = reconPairs.filter(p => p.excelRow);
      let excelTotalCount = excelPairs.length;
      let excelTotalCost = excelPairs.reduce((acc, p) => acc + p.excelCost, 0);

      let matchedCount = reconPairs.filter(p => p.isReconciled && !p.isExcluded).length;
      let matchedCost = reconPairs.filter(p => p.isReconciled && !p.isExcluded).reduce((acc, p) => acc + p.systemCost, 0);
      let mismatchCount = reconPairs.filter(p => p.matchStatus === 'MISMATCH').length;
      let mismatchCost = reconPairs.filter(p => p.matchStatus === 'MISMATCH').reduce((acc, p) => acc + p.excelCost, 0);
      let excludedCount = reconPairs.filter(p => p.isExcluded).length;
      let excludedCost = reconPairs.filter(p => p.isExcluded).reduce((acc, p) => acc + p.excelCost, 0);
      let paymentRequestedCount = reconPairs.filter(p => p.matchStatus === 'PAYMENT_REQUESTED').length;
      let paymentRequestedCost = reconPairs.filter(p => p.matchStatus === 'PAYMENT_REQUESTED').reduce((acc, p) => acc + p.systemCost, 0);

      return {
        isPairMode: true,
        totalCount: excelTotalCount,
        totalCost: excelTotalCost,
        matchedCount,
        matchedCost,
        mismatchCount,
        mismatchCost,
        excludedCount,
        excludedCost,
        paymentRequestedCount,
        paymentRequestedCost,
        systemCount: completedDeliveriesForRecon.length
      };
    }

    const totalCount = completedDeliveriesForRecon.length;
    const totalCost = completedDeliveriesForRecon.reduce((acc, d) => {
      const cost = getEffectiveDeliveryCost(d);
      return acc + cost;
    }, 0);

    return {
      isPairMode: false,
      totalCount,
      totalCost,
      matchedCount: 0,
      matchedCost: 0,
      mismatchCount: 0,
      mismatchCost: 0,
      excludedCount: 0,
      excludedCost: 0,
      paymentRequestedCount: 0,
      paymentRequestedCost: 0,
      systemCount: totalCount
    };
  }, [reconPairs, completedDeliveriesForRecon]);


  // 💡 [사장님 지시] 건별 대사 완료 토글 및 [↩️ 대사 취소 (대기 원복)] 기능 (금액 상이 시 대사 거절)
  const handleTogglePairReconciled = (pairId: string) => {
    const targetPair = reconPairs.find(p => p.pairId === pairId);
    if (!targetPair) return;

    if (!targetPair.isReconciled) {
      // 대사 완료 전환 시 금액 검증
      if (targetPair.diffCost !== 0 || targetPair.systemCost !== targetPair.excelCost) {
        showErrorModal(`⚠️ [대사 처리 거절]\n\n• 좌측 시스템 금액: ₩${targetPair.systemCost.toLocaleString()}원\n• 우측 엑셀 청구금액: ₩${targetPair.excelCost.toLocaleString()}원\n• 차액: ₩${Math.abs(targetPair.diffCost).toLocaleString()}원\n\n좌측과 우측의 금액이 상이한 항목은 대사 처리가 불가능합니다.`);
        return;
      }
    }

    setReconPairs(prev => prev.map(p => {
      if (p.pairId === pairId) {
        const nextReconciled = !p.isReconciled;
        return {
          ...p,
          isReconciled: nextReconciled,
          matchStatus: nextReconciled ? 'MATCHED' : (p.diffCost !== 0 ? 'MISMATCH' : 'PENDING'),
          memo: nextReconciled ? '담당자 수동 대사 완료' : '대사 취소됨 (대기 원복)'
        };
      }
      return p;
    }));
  };

  // 선택건 일괄 대사 완료 (금액 상이건 대사 거절)
  const handleBatchReconcilePairs = () => {
    if (selectedPairIds.size === 0) {
      showErrorModal('대사 완료 처리할 항목을 1건 이상 체크해 주세요.');
      return;
    }

    let rejectedCount = 0;
    let successCount = 0;

    setReconPairs(prev => prev.map(p => {
      if (selectedPairIds.has(p.pairId)) {
        if (p.diffCost !== 0 || p.systemCost !== p.excelCost) {
          rejectedCount++;
          return p; // 금액 상이 항목은 대사 처리 거절 (상태 유지)
        }
        successCount++;
        return { ...p, isReconciled: true, matchStatus: 'MATCHED', memo: '선택 항목 일괄 대사 완료' };
      }
      return p;
    }));

    setSelectedPairIds(new Set());

    if (rejectedCount > 0) {
      showErrorModal(`⚠️ 선택한 항목 중 ${rejectedCount}건은 좌/우 금액이 상이하여 대사 처리가 거절되었습니다.\n\n(금액이 일치하는 ${successCount}건만 대사 완료 처리되었습니다.)`);
    } else if (successCount > 0) {
      setReconNotificationMsg(`✅ 선택한 Pair 항목 ${successCount}건이 대사 완료(MATCHED)로 전환되었습니다.`);
    }
  };

  // 💡 [사장님 지시] 선택건 일괄 대사 취소 (대기 원복)
  const handleBatchCancelReconcilePairs = () => {
    if (selectedPairIds.size === 0) {
      showErrorModal('대사를 취소할 항목을 1건 이상 체크해 주세요.');
      return;
    }
    setReconPairs(prev => prev.map(p => {
      if (selectedPairIds.has(p.pairId)) {
        return { ...p, isReconciled: false, matchStatus: 'PENDING', memo: '일괄 대사 취소 (대기 원복)' };
      }
      return p;
    }));
    setSelectedPairIds(new Set());
    setReconNotificationMsg(`↩️ 선택한 Pair 항목들이 대사 대기(PENDING) 상태로 원복되었습니다.`);
  };

  // 엑셀 업로드 시 시스템 미등록 청구 항목 배열
  const unmatchedExcelRows = useMemo(() => {
    return reconPairs
      .filter(p => p.matchStatus === 'EXCEL_ONLY' && p.excelRow)
      .map(p => p.excelRow);
  }, [reconPairs]);

  // 엑셀 내보내기 다운로드
  const handleExportReconciliationReport = () => {
    if (reconPairs.length === 0 && completedDeliveriesForRecon.length === 0) {
      showErrorModal('내보낼 대사 내역이 없습니다.');
      return;
    }

    const exportRows = reconPairs.length > 0
      ? reconPairs.map((p, i) => {
          const sysD = p.systemDelivery;
          const contract = sysD ? contracts.find(c => c.id === sysD.contractId) : null;
          const customer = contract ? customers.find(c => c.id === contract.customerId) : null;

          return {
            '순번': i + 1,
            '대사 상태': p.isExcluded ? '반려(제외)' : p.isReconciled ? '대사완료(확정)' : p.matchStatus === 'MISMATCH' ? '금액불일치(할증)' : p.matchStatus === 'EXCEL_ONLY' ? '엑셀단독' : p.matchStatus === 'SYSTEM_ONLY' ? '시스템단독' : '대사대기',
            '시스템 배차ID': sysD?.id || '미존재',
            '운송일자': sysD?.loadingDate || sysD?.requestDate || p.excelRow?.['운송일자'] || p.excelRow?.['날짜'] || '',
            '운송 거래처': sysD?.transportCompany || sysD?.assignedVehicles?.[0]?.transportCompany || '자사배차',
            '고객사/현장': customer?.name ? `${customer.name} (${sysD?.destinationAddress || ''})` : p.excelRow?.['하차지'] || p.excelRow?.['도착지'] || '',
            '운송 기사명': sysD?.driverName || p.excelRow?.['기사명'] || p.excelRow?.['운송기사'] || '',
            '시스템 운송비(원)': p.systemCost,
            '엑셀 청구액(원)': p.excelCost,
            '차액(원)': p.diffCost,
            '할증 사유': p.surchargeReason || '',
            '비고 / 특이사항': p.memo || ''
          };
        })
      : completedDeliveriesForRecon.map((d, i) => {
          const contract = contracts.find(c => c.id === d.contractId);
          const customer = contract ? customers.find(c => c.id === contract.customerId) : null;
          const cost = getEffectiveDeliveryCost(d);

          return {
            '순번': i + 1,
            '배차ID': d.id,
            '운송일자': d.loadingDate || d.requestDate,
            '운송 거래처': d.transportCompany || d.assignedVehicles?.[0]?.transportCompany || '자사배차',
            '고객사명': customer?.name || '미지정',
            '도착지(현장)': d.destinationAddress || '',
            '운송 기사명': d.driverName || '기사미지정',
            '차종': d.vehicleType || '3.5T',
            '시스템 운송비(원)': cost,
            '엑셀 청구액(원)': cost,
            '차액(원)': 0,
            '대사 상태': (d as any).reconciliationStatus === 'PAYMENT_REQUESTED' ? '지급요청완료' : '대사대기',
            '비고 / 특이사항': d.memo || ''
          };
        });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '월말_운송료_1to1대사내역');
    XLSX.writeFile(workbook, `월말_운송료_1to1대사내역_${reconStartDate}_${reconEndDate}.xlsx`);
  };

  // 엑셀 템플릿 다운로드
  const handleDownloadExcelTemplate = () => {
    const templateData = [
      { '배차ID': 'DLV-0000001', '운송일자': '2026-07-28', '운송기사': '김기사', '청구금액': 70000, '비고': '양호' },
      { '배차ID': 'DLV-0000002', '운송일자': '2026-07-28', '운송기사': '이기사', '청구금액': 85000, '비고': '특이사항 없음' }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '거래명세서_양식');
    XLSX.writeFile(wb, '월말_운송료_대사_거래명세서_양식.xlsx');
  };


  // 2. 배차건 정밀 필터링 (상태 4단계 + 요청/운송일 기간 피커 + 검색어)
  const filteredDeliveries = useMemo(() => {
    return deliveries.filter(d => {
      const dStatus = getNormalizedDeliveryStatus(d);
      if (activeDispatchStatusTab !== 'ALL' && dStatus !== activeDispatchStatusTab) return false;

      const dDate = d.loadingDate || d.requestDate || d.scheduledDate || d.createdAt?.substring(0, 10);
      if (startDate && dDate && dDate < startDate) return false;
      if (endDate && dDate && dDate > endDate) return false;

      if (!searchQuery || !searchQuery.trim()) return true;
      const q = searchQuery.trim();
      const contract = getContract(d.contractId);
      const customer = contract ? getCustomer(contract.customerId) : null;

      return (
        (d.id && d.id.toLowerCase().includes(q.toLowerCase())) ||
        (d.driverName && matchHangul(d.driverName, q)) ||
        (d.destinationAddress && matchHangul(d.destinationAddress, q)) ||
        (contract && contract.contractNo.toLowerCase().includes(q.toLowerCase())) ||
        (customer && matchHangul(customer.name, q))
      );
    });
  }, [deliveries, activeDispatchStatusTab, startDate, endDate, searchQuery, contracts, customers]);

  // 💡 배차 완료 상태에서 수정을 위해 임시 잠금 해제(Unlock)하는 모드 state
  const [isEditUnlocked, setIsEditUnlocked] = useState<boolean>(false);

  const handleSelectDelivery = (d: Delivery) => {
    const todayStr = new Date().toISOString().split('T')[0];
    setSelectedDelivery(d);
    setIsEditUnlocked(false); // 💡 새로 선택 시 기본 잠금(readOnly) 적용!

    let defaultCat: '출고' | '입고' | '반납' | '정비' | '이동' | '교환' = d.dispatchCategory || (d.type === 'EXCHANGE' ? '교환' : d.type === 'OUTBOUND' ? '출고' : d.type === 'RETURN' || d.type === 'INBOUND' ? '반납' : '출고');
    setDispatchCategory(defaultCat);

    setLoadingDate(d.loadingDate || todayStr);
    const lSlot = d.loadingTimeSlot || '오전';
    if (lSlot !== '오전' && lSlot !== '오후') {
      setLoadingTimeSlot('희망시간');
      setLoadingCustomTime(lSlot);
    } else {
      setLoadingTimeSlot(lSlot);
      setLoadingCustomTime('');
    }

    setUnloadingDate(d.unloadingDate || todayStr);
    const uSlot = d.unloadingTimeSlot || '오전';
    if (uSlot !== '오전' && uSlot !== '오후') {
      setUnloadingTimeSlot('희망시간');
      setUnloadingCustomTime(uSlot);
    } else {
      setUnloadingTimeSlot(uSlot);
      setUnloadingCustomTime('');
    }

    setClosingMemo(d.closingMemo || '');
    setScheduledDate(d.scheduledDate || todayStr);
    setOriginAddress(d.originAddress || '당사 보관소');

    const contract = getContract(d.contractId);
    const cust = contract ? getCustomer(contract.customerId) : null;
    setDestinationAddress(d.destinationAddress || (cust ? `${cust.name} 현장` : ''));

    setBillableToCust(d.billableToCustomer || false);
    setBillableCustId(d.billableCustomerId || (contract?.customerId || ''));

    if (d.vehicles) {
      try {
        const parsed = JSON.parse(d.vehicles);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAssignedVehicles(parsed);
          return;
        }
      } catch (e) {}
    }

    setAssignedVehicles([{
      id: 'v-' + Date.now(),
      transportCompany: d.transportCompany || '',
      vehicleType: d.vehicleType || '3.5T',
      vehicleNo: d.vehicleNo || '',
      driverName: d.driverName || '',
      driverContact: d.driverContact || '',
      expectedCost: getEffectiveDeliveryCost(d),
      finalCost: d.finalCost !== undefined && d.finalCost !== null ? d.finalCost : 0,
      deliveryCost: getEffectiveDeliveryCost(d)
    }]);
  };

  const handleVehicleFieldChange = (index: number, field: keyof AssignedVehicleRow, value: any) => {
    setAssignedVehicles(prev => {
      const updated = [...prev];
      let sanitizedValue = value;
      if (field === 'expectedCost' || field === 'finalCost' || field === 'deliveryCost') {
        sanitizedValue = Math.max(0, Number(value) || 0);
      }
      updated[index] = { ...updated[index], [field]: sanitizedValue };

      // 기사 선택 시 연락처, 차량번호, 차종(톤수) 및 운송사 자동 매핑
      if (field === 'driverName' && value) {
        const driverMatch = transportDrivers.find(d => d.driverName.trim() === value.trim());
        if (driverMatch) {
          if (driverMatch.driverContact) updated[index].driverContact = driverMatch.driverContact;
          if (driverMatch.vehicleNo) updated[index].vehicleNo = driverMatch.vehicleNo;
          if (driverMatch.vehicleType) updated[index].vehicleType = driverMatch.vehicleType;
          const comp = transportCompanies.find(c => c.id === driverMatch.companyId);
          if (comp) updated[index].transportCompany = comp.name;
        }
      }
      return updated;
    });
  };

  const handleAddVehicleRow = () => {
    setAssignedVehicles(prev => [
      ...prev,
      {
        id: 'v-' + Date.now(),
        transportCompany: '',
        vehicleType: '3.5T',
        vehicleNo: '',
        driverName: '',
        driverContact: '',
        expectedCost: 0,
        finalCost: 0,
        deliveryCost: 0
      }
    ]);
  };

  const handleRemoveVehicleRow = (index: number) => {
    if (assignedVehicles.length <= 1) return;
    setAssignedVehicles(prev => prev.filter((_, i) => i !== index));
  };

  // 📲 기사 배차 안내 문자 발송 / 클립보드 복사
  const handleSendDriverSms = (targetDelivery: Delivery) => {
    const mainVeh = assignedVehicles.find(v => v.driverContact && v.driverContact.trim()) || assignedVehicles[0];
    const contact = mainVeh?.driverContact || targetDelivery.driverContact;
    const name = mainVeh?.driverName || targetDelivery.driverName;
    const vNo = mainVeh?.vehicleNo || targetDelivery.vehicleNo;
    const vType = mainVeh?.vehicleType || targetDelivery.vehicleType;
    const cost = (mainVeh?.finalCost && mainVeh.finalCost > 0 ? mainVeh.finalCost : mainVeh?.expectedCost) || targetDelivery.finalCost || targetDelivery.deliveryCost;

    if (!contact || !contact.trim()) {
      showErrorModal('기사 연락처가 등록되지 않았습니다. 차량/기사 배정 란에 기사 연락처를 입력해 주세요.');
      return;
    }

    const contract = contracts.find(c => c.id === targetDelivery.contractId);
    const customer = customers.find(c => c.id === contract?.customerId || c.id === targetDelivery.billableCustomerId);
    const site = sites.find(s => s.id === contract?.siteId || (targetDelivery.destinationAddress && s.name.includes(targetDelivery.destinationAddress)));

    const dObj = {
      ...targetDelivery,
      driverName: name,
      driverContact: contact,
      vehicleNo: vNo,
      vehicleType: vType,
      finalCost: cost,
      destinationAddress: destinationAddress || targetDelivery.destinationAddress,
      originAddress: originAddress || targetDelivery.originAddress,
      loadingDate: loadingDate || targetDelivery.loadingDate,
      loadingTimeSlot: (loadingTimeSlot === '희망시간' ? loadingCustomTime : loadingTimeSlot) || targetDelivery.loadingTimeSlot,
      memo: closingMemo || targetDelivery.memo
    };

    const defaultYard = currentTenant?.yards?.find(y => y.isDefault) || currentTenant?.yards?.[0];
    const hqYardAddress = defaultYard?.address || currentTenant?.mainYardAddress || currentTenant?.businessAddress || '본사 주기장';
    const hqYardPhone = currentTenant?.tel || '배차/출고팀';
    const companyName = currentTenant?.displayName || currentTenant?.tradeName || currentTenant?.corporateName || '기연리프트';

    const smsBody = buildDispatchSmsText({
      delivery: dObj,
      siteName: site?.name || targetDelivery.destinationAddress,
      siteAddress: targetDelivery.destinationAddress || site?.address,
      siteContactName: site?.contactName,
      siteContactPhone: site?.contact,
      customerName: customer?.name,
      companyName,
      hqYardAddress,
      hqYardPhone,
    });

    launchDispatchSms({
      driverContact: contact,
      smsBody
    });
  };

  // 3. 배차 배정 저장 (status: 'DISPATCHED' 배차 완료 전환!)
  const handleSaveDispatch = async () => {
    if (!selectedDelivery) return;
    if (!canSave) {
      showErrorModal('배차 수정 권한이 없습니다.');
      return;
    }

    // 🚨 출고 제한(BLOCKED) 거래처 출고 배차 원천 차단
    const targetContract = selectedDelivery.contractId ? contracts.find(c => c.id === selectedDelivery.contractId) : null;
    const targetCustomer = targetContract ? customers.find(c => c.id === targetContract.customerId) : null;
    const isOutboundOrExchange = selectedDelivery.type === 'OUTBOUND' || selectedDelivery.dispatchCategory === '출고' || selectedDelivery.dispatchCategory === '교환';
    if (isOutboundOrExchange && targetCustomer?.transactionStatus === 'BLOCKED') {
      showErrorModal(`[출고제한] 거래처 [${targetCustomer.name}]은(는) 연체 관리 또는 경영진 지시로 인해 신규 출고가 차단된 상태입니다. 배차 기사를 배정할 수 없습니다.`, '출고 차단');
      return;
    }

    // ⚠️ 출고 의뢰가 반려된 상태인지 검사 및 예방적 경고 알림!
    const inspStatus = getOutboundInspectionStatus(selectedDelivery.contractId);
    if (inspStatus === 'REJECTED') {
      showToast('출고 검수 반려 이력이 있는 의뢰건의 배차 기사 배정을 진행합니다.', 'warning');
    }

    try {
      const finalLoadingSlot = loadingTimeSlot === '희망시간' ? loadingCustomTime : loadingTimeSlot;
      const finalUnloadingSlot = unloadingTimeSlot === '희망시간' ? unloadingCustomTime : unloadingTimeSlot;
      const totalExpectedCost = assignedVehicles.reduce((sum, v) => sum + (Number(v.expectedCost) || 0), 0);
      const totalFinalCost = assignedVehicles.reduce((sum, v) => sum + (Number(v.finalCost) || 0), 0);

      const mainVeh = assignedVehicles[0] || {};
      const payload: Partial<Delivery> = {
        status: 'DISPATCHED',
        dispatchCategory: dispatchCategory,
        loadingDate: loadingDate,
        loadingTimeSlot: finalLoadingSlot,
        unloadingDate: unloadingDate,
        unloadingTimeSlot: finalUnloadingSlot,
        scheduledDate: scheduledDate || loadingDate,
        originAddress: originAddress,
        destinationAddress: destinationAddress,
        billableToCustomer: billableToCust,
        billableCustomerId: billableCustId,
        transportCompany: mainVeh.transportCompany || '',
        vehicleType: mainVeh.vehicleType || '3.5T',
        vehicleNo: mainVeh.vehicleNo || '',
        driverName: mainVeh.driverName || '',
        driverContact: mainVeh.driverContact || '',
        expectedCost: totalExpectedCost,
        finalCost: totalFinalCost,
        deliveryCost: totalFinalCost || totalExpectedCost,
        vehicles: JSON.stringify(assignedVehicles),
        closingMemo: closingMemo,
        memo: selectedDelivery.memo || closingMemo,
        updatedAt: new Date().toISOString()
      };

      db.updateRow<Delivery>('deliveries', selectedDelivery.id, payload);
      await db.awaitPendingWrites();

      // [업무 인계 파이프라인] 선행 배차 의뢰 ToDo 자동 상계
      await clearHandoverTasks({
        entityId: selectedDelivery.id,
        category: 'DISPATCH_REQUEST',
        completedByUserId: currentUser?.id,
        completedByName: currentUser?.name,
        completionAction: 'DISPATCH_ASSIGNED'
      });

      const curContract = selectedDelivery.contractId ? contracts.find(c => c.id === selectedDelivery.contractId) : null;
      const curCust = curContract ? customers.find(c => c.id === curContract.customerId)?.name : '';
      const curSite = curContract ? sites.find(s => s.id === curContract.siteId)?.name : '';

      // [업무 인계 파이프라인] 출고 건인 경우 주기장 PDI 검수 ToDo 후속 발행
      if (selectedDelivery.type === 'OUTBOUND') {
        await issueHandoverTask({
          category: 'OUTBOUND_PDI_INSPECTION',
          title: `[출고 PDI 검수 요망] ${curCust || '고객사'} (${mainVeh.driverName || '기사'} 배정)`,
          content: `차량 배정 완료 (${mainVeh.driverName || '기사'}, ${mainVeh.vehicleNo || '차량번호'}). 상차 전 PDI 기능검수를 완료해 주십시오.`,
          targetDept: 'YARD',
          priority: 'HIGH',
          actionUrl: '/admin/outbound_inspections',
          entityType: 'DELIVERY',
          entityId: selectedDelivery.id,
          senderId: currentUser?.id,
          senderName: currentUser?.name
        });
      }

      broadcastWorkNotification({
        type: 'DISPATCH',
        title: '배차 완료 안내',
        body: `${curCust || '현장'} (${curSite || '배차'}) ${mainVeh.driverName || '기사'} (${mainVeh.vehicleType || '차량'}) 배정 완료`,
        url: '/admin/dispatch',
        targetDepts: ['SALES', 'YARD', 'ADMIN', 'EXECUTIVE']
      }).catch(console.warn);

      refreshAllData();
      showToast('배차 기사 배정 완료 (상태: 배차 완료)');
      setSelectedDelivery(null);
    } catch (err: any) {
      showErrorModal(`⚠️ 배차 저장 실패:\n${err?.message || err}`);
    }
  };

  // 4. 운송 완료 처리 (status: 'DELIVERED')
  const handleCompleteDeliveryStatus = async (deliveryId: string) => {
    if (!canSave) return;

    const targetDelivery = deliveries.find(d => d.id === deliveryId);
    if (targetDelivery) {
      const inspStatus = getOutboundInspectionStatus(targetDelivery.contractId);
      if (inspStatus === 'REJECTED') {
        showToast('출고 검수 반려 이력이 있는 의뢰건의 운송 완료 마감을 진행합니다.', 'warning');
      }
    }

    try {
      const isInbound = targetDelivery?.type === 'INBOUND'
        || targetDelivery?.dispatchCategory === '입고'
        || targetDelivery?.dispatchCategory === '반납';

      if (isInbound) {
        // [헌장 1.3] INBOUND 배차 완료 = 배차 상태만 DELIVERED로 기록.
        // 자산 상태(RENTED → AVAILABLE) 전환은 입고검수 화면에서만 수행한다.
        // completeInboundDelivery를 여기서 호출하지 않는다.
        db.updateRow<Delivery>('deliveries', deliveryId, {
          status: 'DELIVERED',
          updatedAt: new Date().toISOString()
        });
        await db.awaitPendingWrites();
      } else {
        // OUTBOUND / EXCHANGE: completeDelivery — 출고 이력 추가 + 계약 ACTIVE 전환.
        // 자산 상태는 변경하지 않음 (출고 검수 승인 시점에 RENTED 전환 — 헌장 1.3).
        await completeDelivery(deliveryId);
        await db.awaitPendingWrites();
      }

      // [업무 인계 파이프라인] 운송 관련 ToDo 상계
      await clearHandoverTasks({
        entityId: deliveryId,
        completionAction: 'DELIVERED',
        completedByUserId: currentUser?.id,
        completedByName: currentUser?.name
      });

      // [업무 인계 파이프라인] 영업담당자에게 현장 도착 완료 ToDo 발행
      const targetContract = targetDelivery?.contractId ? contracts.find(c => c.id === targetDelivery.contractId) : null;
      await issueHandoverTask({
        category: 'SITE_ARRIVAL_CONFIRM',
        title: `[현장 도착 완료] ${targetDelivery?.destinationAddress || '현장'} 하차 안착`,
        content: `장비가 현장에 도착하여 하차가 완료되었습니다. 고객 인수증 수령 및 가동 개시를 확인하십시오.`,
        targetDept: 'SALES',
        assignedUserId: targetContract?.salespersonId,
        priority: 'HIGH',
        actionUrl: '/admin/contract',
        entityType: 'DELIVERY',
        entityId: deliveryId,
        senderId: currentUser?.id,
        senderName: currentUser?.name
      });

      refreshAllData();
      showToast('운송이 완료 마감되었습니다. (운송 완료)');
      setSelectedDelivery(null);
    } catch (err: any) {
      showErrorModal(`⚠️ 운송 완료 처리 실패:\n${err?.message || err}`);
    }
  };

  // 5. 배차 취소 처리 (status: 'CANCELLED')
  const handleCancelDeliveryStatus = async (deliveryId: string) => {
    if (!canSave) return;
    
    try {
      db.updateRow<Delivery>('deliveries', deliveryId, {
        status: 'CANCELLED',
        updatedAt: new Date().toISOString()
      });
      await db.awaitPendingWrites();

      // [업무 인계 파이프라인] 배차 취소 시 관련 ToDo 자동 상계
      await clearHandoverTasks({
        entityId: deliveryId,
        completionAction: 'CANCELLED',
        completedByUserId: currentUser?.id,
        completedByName: currentUser?.name
      });

      refreshAllData();
      showToast('배차가 취소되었습니다. (배차 취소)');
      setSelectedDelivery(null);
    } catch (err: any) {
      showErrorModal(`⚠️ 배차 취소 처리 실패:\n${err?.message || err}`);
    }
  };

  const handleSaveManualDispatch = async () => {
    if (!manualOrigin || !manualDestination) {
      showErrorModal('상차지(출발지)와 하차지(도착지)를 작성해 주세요.');
      return;
    }

    if (manualCategory === '출고' || manualCategory === '교환') {
      const targetCust = customers.find(c => c.id === manualCustomerId || (manualContractId && contracts.find(ct => ct.id === manualContractId)?.customerId === c.id));
      if (targetCust?.transactionStatus === 'BLOCKED') {
        showErrorModal(`[출고제한] 거래처 [${targetCust.name}]은(는) 신규 장비 출고가 차단된 상태입니다. 신규 출고 배차를 생성할 수 없습니다.`, '출고 차단');
        return;
      }
    }

    try {
      const finalLoadingSlot = manualLoadingTimeSlot === '희망시간' ? manualLoadingCustomTime : manualLoadingTimeSlot;
      const finalUnloadingSlot = manualUnloadingTimeSlot === '희망시간' ? manualUnloadingCustomTime : manualUnloadingTimeSlot;
      const nowIso = new Date().toISOString();

      db.insertRow<Delivery>('deliveries', {
        type: manualCategory === '출고' ? 'OUTBOUND' : manualCategory === '교환' ? 'EXCHANGE' : manualCategory === '반납' ? 'RETURN' : 'INBOUND',
        status: 'PENDING',
        dispatchCategory: manualCategory,
        contractId: manualContractId || undefined,
        requestDate: manualLoadingDate,
        scheduledDate: manualLoadingDate,
        loadingDate: manualLoadingDate,
        loadingTimeSlot: finalLoadingSlot,
        unloadingDate: manualUnloadingDate,
        unloadingTimeSlot: finalUnloadingSlot,
        originAddress: manualOrigin,
        destinationAddress: manualDestination,
        deliveryCost: manualExpectedCost,
        expectedCost: manualExpectedCost,
        finalCost: manualExpectedCost,
        billableToCustomer: manualBillable,
        billableCustomerId: manualCustomerId || undefined,
        isCostSettled: false,
        memo: manualMemo || manualClosingMemo,
        closingMemo: manualClosingMemo || manualMemo,
        vehicleRequirements: JSON.stringify(manualVehicles),
        cargoItems: JSON.stringify(manualCargos),
        createdAt: nowIso,
        updatedAt: nowIso
      });

      await db.awaitPendingWrites();
      refreshAllData();
      showToast('신규 배차건이 생성되었습니다.');
      setShowManualModal(false);
    } catch (err: any) {
      showErrorModal(`⚠️ 수동 배차 생성 실패:\n${err?.message || err}`);
    }
  };

  const parseCargoItems = (d: Delivery): CargoItem[] => {
    if (d.cargoItems) {
      try {
        const parsed = JSON.parse(d.cargoItems);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {}
    }
    return [{ modelName: '고소작업대 (장비 미지정)', count: 1 }];
  };

  const getDeliveryStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
      case 'REQUESTED':
        return <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, backgroundColor: 'rgba(245,158,11,0.15)', color: '#d97706', border: '1px solid rgba(245,158,11,0.3)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> 🟡 배차 전 (대기)</span>;
      case 'DISPATCHED':
        return <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, backgroundColor: 'rgba(59,130,246,0.15)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.3)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Truck size={12} /> 🔵 배차 완료 (기사배정)</span>;
      case 'DELIVERED':
      case 'COMPLETED':
        return <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, backgroundColor: 'rgba(34,197,94,0.15)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.3)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={12} /> 🟢 운송 완료</span>;
      case 'CANCELLED':
        return <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, backgroundColor: 'rgba(239,68,68,0.15)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.3)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><XCircle size={12} /> 🔴 배차 취소</span>;
      default:
        return <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, backgroundColor: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)' }}>미지정</span>;
    }
  };

  const handleExportDispatchExcel = () => {
    if (filteredDeliveries.length === 0) {
      showToast('내보낼 배차 데이터가 없습니다.', 'warning');
      return;
    }
    const rows = filteredDeliveries.map((d, index) => {
      const contract = getContract(d.contractId);
      const customer = contract ? getCustomer(contract.customerId) : null;
      const site = sites.find(s => s.id === contract?.siteId);
      const cargoItems = parseCargoItems(d);
      const cargoStr = cargoItems.map(c => `${c.modelName} ${c.count}대`).join(', ') || (d as any).equipmentSummary || '-';
      const normStatus = getNormalizedDeliveryStatus(d);
      const statusLabel = normStatus === 'PENDING' ? '배차대기'
        : normStatus === 'DISPATCHED' ? '배차완료'
        : normStatus === 'DELIVERED' ? '운송완료'
        : normStatus === 'CANCELLED' ? '배차취소' : normStatus;
      const effCost = getEffectiveDeliveryCost(d);
      
      return {
        'No': index + 1,
        '배차번호': d.id,
        '구분': d.dispatchCategory || d.type || '출고',
        '상태': statusLabel,
        '요청일자': d.requestDate || '-',
        '배차(상차)일': d.loadingDate || d.scheduledDate || '-',
        '하차(도착)일': d.unloadingDate || '-',
        '계약번호': contract?.contractNo || '-',
        '고객사': customer?.name || (d as any).customerName || '-',
        '현장명': site?.name || (d as any).siteName || '-',
        '운송장비': cargoStr,
        '출발지(상차지)': d.originAddress || '당사 보관소',
        '도착지(하차지)': d.destinationAddress || site?.address || '-',
        '운송사': d.transportCompany || '-',
        '차종': d.vehicleType || '-',
        '차량번호': d.vehicleNo || '-',
        '기사명': d.driverName || '-',
        '기사연락처': d.driverContact || '-',
        '예상운송비': d.expectedCost || 0,
        '확정운송비': effCost,
        '고객청구여부': d.billableToCustomer ? '청구' : '당사부담',
        '청구대상고객사': d.billableCustomerId ? (getCustomer(d.billableCustomerId)?.name || '-') : '-',
        '특이사항/메모': d.memo || '',
        '마감비고': d.closingMemo || ''
      };
    });
    const todayStr = new Date().toISOString().split('T')[0];
    exportToExcel(rows, `배차대장_${todayStr}`, '배차목록');
    showToast(`배차 대장 ${rows.length}건 엑셀 내보내기 완료`);
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', color: 'var(--text-primary)', position: 'relative' }}>
      {/* 알림 토스트 배너 (헌장 5.2) */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '24px',
          zIndex: 99999,
          padding: '10px 18px',
          borderRadius: '6px',
          backgroundColor: toastMessage.type === 'success' ? 'var(--success)' : toastMessage.type === 'error' ? 'var(--danger)' : '#f59e0b',
          color: '#ffffff',
          fontWeight: 600,
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'fadeIn 0.2s ease-in-out'
        }}>
          {toastMessage.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          <span>{toastMessage.text}</span>
        </div>
      )}
      {/* 헤더 영역 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontWeight: '800', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <Truck size={22} color="var(--primary)" /> 배차 / 운송 관리
          </h2>
        </div>
        {activeTab === 'DISPATCH' && canSave && (
          <button className="btn-primary" onClick={() => setShowManualModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontWeight: 700, fontSize: '13px' }}>
            <Plus size={15} /> [+ 수동 배차 생성]
          </button>
        )}
      </div>

      {/* 메인 탭 (헌장 3.1 무수식어 건조 표준: 배차 관리 / 운송료 대사 - 운송사 배차 협의는 임시 숨김) */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', marginBottom: '20px' }}>
        <button
          onClick={() => setActiveTab('DISPATCH')}
          style={{
            padding: '10px 18px', fontSize: '14px', fontWeight: 700, backgroundColor: 'transparent', border: 'none',
            borderBottom: activeTab === 'DISPATCH' ? '3px solid var(--primary)' : 'none',
            color: activeTab === 'DISPATCH' ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer',
            whiteSpace: 'nowrap', flexShrink: 0
          }}
        >
          <Truck size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          배차 관리
        </button>
        {/* 운송사 배차 협의 메뉴는 사용자 요청으로 임시 숨김 처리 */}
        <button
          onClick={() => setActiveTab('RECONCILIATION')}
          style={{
            padding: '10px 18px', fontSize: '14px', fontWeight: 700, backgroundColor: 'transparent', border: 'none',
            borderBottom: activeTab === 'RECONCILIATION' ? '3px solid var(--primary)' : 'none',
            color: activeTab === 'RECONCILIATION' ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer',
            whiteSpace: 'nowrap', flexShrink: 0
          }}
        >
          <FileText size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          운송료 대사
        </button>
      </div>

      {/* 탭 1: 배차 관리 */}
      {activeTab === 'DISPATCH' && (
        <div>
          {/* 📊 오늘/내일/이번주 상차 배차 통계 바 */}
          {(() => {
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>오늘 상차 예정</span>
                  <strong style={{ fontSize: '15px', color: deliveryCounts.today > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>{deliveryCounts.today}건</strong>
                </div>
                <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>내일 상차 예정</span>
                  <strong style={{ fontSize: '15px', color: deliveryCounts.tomorrow > 0 ? '#0070C0' : 'var(--text-muted)' }}>{deliveryCounts.tomorrow}건</strong>
                </div>
                <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>배차 대기 (미배정)</span>
                  <strong style={{ fontSize: '15px', color: deliveryCounts.pending > 0 ? '#d97706' : 'var(--text-muted)' }}>{deliveryCounts.pending}건</strong>
                </div>
              </div>
            );
          })()}

          {/* 📋 영업 의뢰 배차 대기 ToDo 큐 (할일 목록) */}
          {(() => {
            const pendingTodoDeliveries = deliveries.filter(d => getNormalizedDeliveryStatus(d) === 'PENDING');
            return (
              <div style={{
                marginBottom: '20px',
                padding: '16px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      📋 영업 의뢰 배차 대기 ToDo
                    </span>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      backgroundColor: pendingTodoDeliveries.length > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                      color: pendingTodoDeliveries.length > 0 ? '#ef4444' : '#16a34a',
                      fontSize: '12px',
                      fontWeight: 800,
                      border: pendingTodoDeliveries.length > 0 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(34, 197, 94, 0.3)'
                    }}>
                      미배정 {pendingTodoDeliveries.length}건
                    </span>
                  </div>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    영업사원 계약·출고 의뢰 자동 연계 ➔ 기사 배정 확정 시 ToDo 자동 완결
                  </span>
                </div>

                {pendingTodoDeliveries.length === 0 ? (
                  <div style={{
                    padding: '16px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(34, 197, 94, 0.06)',
                    border: '1px dashed rgba(34, 197, 94, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    color: '#16a34a',
                    fontSize: '13px',
                    fontWeight: 700
                  }}>
                    <CheckCircle2 size={16} />
                    현재 영업부에서 접수된 배차 대기 할일이 모두 완료되었습니다. (잔여 ToDo 0건)
                  </div>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                    gap: '12px'
                  }}>
                    {pendingTodoDeliveries.slice(0, 6).map((d) => {
                      const contract = getContract(d.contractId);
                      const customer = contract ? getCustomer(contract.customerId) : null;
                      const site = sites.find(s => s.id === contract?.siteId);
                      const siteName = site?.name || d.destinationAddress || (customer ? `${customer.name} 현장` : '현장');
                      const salesperson = users.find(u => u.id === contract?.salespersonId)?.name || '영업담당';
                      const isSelected = selectedDelivery?.id === d.id;
                      const cargoList = parseCargoItems(d);
                      const cargoStr = cargoList.map(c => `${c.modelName} ${c.count}대`).join(', ');
                      const dCategory = d.type === 'EXCHANGE' ? '🔄 [대차교환]' : (d.type === 'INBOUND' || d.type === 'RETURN') ? '📦 [회수반납]' : '🚚 [출고배차]';
                      const loadingDt = `${d.loadingDate || d.scheduledDate || '일정미정'} ${d.loadingTimeSlot || '오전'}`;

                      return (
                        <div
                          key={d.id}
                          onClick={() => handleSelectDelivery(d)}
                          style={{
                            padding: '12px 14px',
                            borderRadius: '10px',
                            backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-body)',
                            border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            transition: 'all 0.15s ease',
                            boxShadow: isSelected ? '0 2px 8px rgba(59, 130, 246, 0.15)' : 'none'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{
                              fontSize: '11.5px',
                              fontWeight: 800,
                              color: d.type === 'EXCHANGE' ? '#8b5cf6' : d.type === 'INBOUND' ? '#f59e0b' : '#0284c7',
                              backgroundColor: d.type === 'EXCHANGE' ? 'rgba(139, 92, 246, 0.12)' : d.type === 'INBOUND' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(2, 132, 199, 0.12)',
                              padding: '2px 7px',
                              borderRadius: '6px'
                            }}>
                              {dCategory}
                            </span>
                            <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                              의뢰: <strong style={{ color: 'var(--text-primary)' }}>{salesperson}</strong>
                            </span>
                          </div>

                          <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {customer?.name || '고객사'} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>| {siteName}</span>
                          </div>

                          <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div>📅 상차희망: <strong style={{ color: '#d97706' }}>{loadingDt}</strong></div>
                            <div>📦 요청장비: <strong style={{ color: 'var(--text-primary)' }}>{cargoStr}</strong></div>
                            {d.memo && (
                              <div style={{ color: 'var(--text-muted)', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                💬 {d.memo}
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectDelivery(d);
                              }}
                              style={{
                                padding: '5px 12px',
                                borderRadius: '6px',
                                backgroundColor: isSelected ? 'var(--primary)' : 'rgba(59, 130, 246, 0.12)',
                                color: isSelected ? '#fff' : 'var(--primary)',
                                border: '1px solid var(--primary)',
                                fontSize: '11.5px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <UserCheck size={12} />
                              기사 배정 ➔
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {pendingTodoDeliveries.length > 6 && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '12px',
                        backgroundColor: 'var(--bg-body)',
                        borderRadius: '10px',
                        border: '1px dashed var(--border-color)',
                        color: 'var(--text-muted)',
                        fontSize: '12px',
                        fontWeight: 600
                      }}>
                        외 {pendingTodoDeliveries.length - 6}건의 대기 의뢰는 아래 목록에서 조회 가능
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* 4단계 배차 진행 상태 카운트 탭 */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {[
              { key: 'ALL', label: '전체 보기', count: deliveries.length },
              { key: 'PENDING', label: '🟡 배차 전 (대기)', count: deliveries.filter(d => getNormalizedDeliveryStatus(d) === 'PENDING').length },
              { key: 'DISPATCHED', label: '🔵 배차 완료 (기사배정)', count: deliveries.filter(d => getNormalizedDeliveryStatus(d) === 'DISPATCHED').length },
              { key: 'DELIVERED', label: '🟢 운송 완료', count: deliveries.filter(d => getNormalizedDeliveryStatus(d) === 'DELIVERED').length },
              { key: 'CANCELLED', label: '🔴 배차 취소', count: deliveries.filter(d => getNormalizedDeliveryStatus(d) === 'CANCELLED').length },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveDispatchStatusTab(tab.key)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid',
                  borderColor: activeDispatchStatusTab === tab.key ? 'var(--primary)' : 'var(--border-color)',
                  backgroundColor: activeDispatchStatusTab === tab.key ? 'rgba(59,130,246,0.1)' : 'var(--bg-card)',
                  color: activeDispatchStatusTab === tab.key ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: activeDispatchStatusTab === tab.key ? 700 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
              >
                {tab.label}
                <span style={{
                  backgroundColor: activeDispatchStatusTab === tab.key ? 'var(--primary)' : 'var(--bg-body)',
                  color: activeDispatchStatusTab === tab.key ? '#fff' : 'var(--text-muted)',
                  borderRadius: '12px',
                  padding: '1px 7px',
                  fontSize: '11px',
                  fontWeight: 700
                }}>
                  {tab.count}
                </span>
              </button>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
              <button
                onClick={handleExportDispatchExcel}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  fontSize: '12.5px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                }}
              >
                <Download size={14} />
                엑셀 내보내기
              </button>
            </div>
          </div>

          {/* 2열 메인 레이아웃 (좌: 배차 목록 + 📅 기간조회 | 우: 기사 배정 폼) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 420px) 1fr', gap: '20px' }}>
            
            {/* [좌측] 배차 목록 카드 + 📅 요청/운송일 기간 선택 폼 */}
            <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 230px)', minHeight: '600px' }}>
              
              {/* 📅 배차 요청/운송일 기간 선택 폼 */}
              <div style={{ marginBottom: '12px', padding: '10px 12px', backgroundColor: 'var(--bg-body)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Calendar size={13} /> 배차 운송일/신청일 기간 조회
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[
                      { label: '오늘', type: 'TODAY' },
                      { label: '1주일', type: 'WEEK' },
                      { label: '1개월', type: 'MONTH' },
                      { label: '전체', type: 'ALL' }
                    ].map(b => (
                      <button
                        key={b.type}
                        onClick={() => handleSetDateRange(b.type as any)}
                        style={{
                          padding: '2px 7px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-card)',
                          fontSize: '10.5px',
                          fontWeight: 600,
                          color: 'var(--text-secondary)',
                          cursor: 'pointer'
                        }}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>~</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  />
                  {(startDate || endDate) && (
                    <button
                      onClick={() => handleSetDateRange('ALL')}
                      title="기간 초기화"
                      style={{
                        padding: '5px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--bg-card)',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'flex'
                      }}
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* 검색창 */}
              <div style={{ marginBottom: '14px', position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="고객사 / 현장 / 계약 / 기사명 검색..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px 8px 36px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-body)',
                    color: 'var(--text-primary)',
                    fontSize: '12.5px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* 배차 목록 렌더링 */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
                {filteredDeliveries.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)', fontSize: '13px' }}>
                    조건에 일치하는 배차 요청건이 없습니다.
                  </div>
                ) : (
                  filteredDeliveries.map(d => {
                    const contract = getContract(d.contractId);
                    const customer = contract ? getCustomer(contract.customerId) : null;
                    const isSelected = selectedDelivery?.id === d.id;
                    const cargoItems = parseCargoItems(d);
                    const normStatus = getNormalizedDeliveryStatus(d);

                    return (
                      <div 
                        key={d.id}
                        onClick={() => handleSelectDelivery(d)}
                        style={{
                          padding: '14px',
                          borderRadius: '10px',
                          border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                          backgroundColor: isSelected ? 'rgba(59,130,246,0.05)' : 'var(--bg-body)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          boxShadow: isSelected ? '0 4px 12px rgba(59,130,246,0.12)' : 'none'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '4px' }}>
                          <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--primary)' }}>
                            [{d.dispatchCategory || '출고'}] {d.requestDate || d.loadingDate}
                          </span>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            {getOutboundInspectionBadge(d.contractId)}
                            {getPrintQueueBadge(d)}
                            {getDeliveryStatusBadge(normStatus)}
                          </div>
                        </div>

                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🏢 {customer?.name || '고객사 미지정'}</span>
                          {customer?.transactionStatus === 'BLOCKED' && (
                            <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', backgroundColor: '#ef4444', color: '#fff', flexShrink: 0 }}>
                              출고제한
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            📍 {d.destinationAddress || '목적지 미지정'}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenDestWeatherForDelivery(d);
                            }}
                            style={{
                              padding: '2px 6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              borderRadius: '4px',
                              border: '1px solid rgba(59, 130, 246, 0.4)',
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              color: '#3B82F6',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              flexShrink: 0,
                              marginLeft: '6px'
                            }}
                            title="해당 하차지 실시간 날씨 및 주간 예보 보기"
                          >
                            <Sun size={11} color="#F59E0B" /> 날씨
                          </button>
                        </div>

                        {/* 화물/자산 정보 표시 */}
                        {(d.type === 'INBOUND' || d.dispatchCategory === '입고' || d.dispatchCategory === '반납') ? (
                          // 회수 배차: 계약/회수 자산 목록 표시 (모델명 {관리번호})
                          <div style={{ padding: '6px 8px', backgroundColor: 'rgba(239,68,68,0.05)', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.2)', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                            🔄 회수 대상:&nbsp;
                            {getReturnAssets(d).length > 0
                              ? getReturnAssets(d).map(a => `${a.modelName} {${a.assetNo}}`).join(' / ')
                              : (cargoItems.length > 0 ? cargoItems.map(c => `${c.modelName} ${c.count}대`).join(', ') : '자산 정보 미확인')}
                          </div>
                        ) : (
                          // 출고 배차: 화물 cargoItems 표시
                          <div style={{ padding: '6px 8px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '11.5px', color: 'var(--text-muted)' }}>
                            📦 화물: {cargoItems.map(c => `${c.modelName} ${c.count}대`).join(', ')}
                          </div>
                        )}

                        {d.driverName && (
                          <div style={{ marginTop: '6px', fontSize: '11.5px', fontWeight: 700, color: '#16a34a' }}>
                            🚛 기사: {d.driverName} ({d.vehicleNo || '차량번호미상'})
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* [우측] 배차 기사 배정 및 상세 폼 */}
            <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', height: 'calc(100vh - 230px)', minHeight: '600px', overflowY: 'auto' }}>
              {!selectedDelivery ? (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  <Truck size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
                  <p style={{ fontSize: '14px', fontWeight: 600 }}>좌측에서 기사를 배정할 배차건을 선택해 주세요.</p>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>
                        🚛 배차 운송 기사 배정 및 상하차 세부 설정
                      </h3>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        배차 ID: {selectedDelivery.id} | 요청일: {selectedDelivery.requestDate}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {getOutboundInspectionBadge(selectedDelivery.contractId)}
                      {getPrintQueueBadge(selectedDelivery)}
                      {getDeliveryStatusBadge(getNormalizedDeliveryStatus(selectedDelivery))}
                      
                      {/* 🖨️ 현장 무인 인쇄 버튼 (출고: 프린터1, 입고: 프린터2 자동 라우팅) */}
                      <button
                        type="button"
                        onClick={() => handleRemoteQueuePrintDispatchRequest(selectedDelivery, (selectedDelivery.type === 'INBOUND' || selectedDelivery.dispatchCategory === '입고' || selectedDelivery.dispatchCategory === '반납') ? 'INBOUND' : 'OUTBOUND')}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '7px',
                          backgroundColor: '#1e293b',
                          color: '#ffffff',
                          border: '1px solid #0f172a',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                        }}
                        title="현장 로컬 PC 프린터(프린터1 또는 프린터2)로 자동 원격 출력합니다"
                      >
                        <Printer size={13} />
                        {(selectedDelivery.type === 'INBOUND' || selectedDelivery.dispatchCategory === '입고' || selectedDelivery.dispatchCategory === '반납') ? '입고요청서 인쇄' : '출고요청서 인쇄'}
                      </button>

                      {/* 🖨️ 브라우저 직접 인쇄 버튼 */}
                      <button
                        type="button"
                        onClick={() => handlePrintDispatchRequest(selectedDelivery, (selectedDelivery.type === 'INBOUND' || selectedDelivery.dispatchCategory === '입고' || selectedDelivery.dispatchCategory === '반납') ? 'INBOUND' : 'OUTBOUND')}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '7px',
                          backgroundColor: 'var(--bg-app)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-color)',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                        }}
                        title="사무실 현재 컴퓨터 브라우저에서 직접 인쇄"
                      >
                        직접 인쇄
                      </button>

                      {/* 📲 기사 배차 안내 문자 발송 / 클립보드 복사 버튼 */}
                      <button
                        type="button"
                        onClick={() => handleSendDriverSms(selectedDelivery)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '7px',
                          backgroundColor: 'rgba(56, 189, 248, 0.12)',
                          color: '#0284c7',
                          border: '1px solid rgba(56, 189, 248, 0.35)',
                          fontSize: '12px',
                          fontWeight: 800,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
                        }}
                      >
                        <MessageSquare size={13} color="#0284c7" />
                        기사 배차문자
                      </button>

                      {/* 💡 상단 배차/운송완료/취소 액션 버튼 */}
                      {canSave && (
                        <>
                          <button
                            onClick={handleSaveDispatch}
                            className="btn-primary"
                            style={{ padding: '6px 14px', fontWeight: 800, fontSize: '12.5px', borderRadius: '7px', display: 'inline-flex', alignItems: 'center', gap: '5px', boxShadow: '0 2px 6px rgba(59,130,246,0.25)' }}
                          >
                            <ShieldCheck size={14} /> [🔵 배차 기사 배정 완료]
                          </button>

                          {getNormalizedDeliveryStatus(selectedDelivery) === 'DISPATCHED' && (
                            <button
                              onClick={() => handleCompleteDeliveryStatus(selectedDelivery.id)}
                              style={{ padding: '6px 14px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontWeight: 800, fontSize: '12.5px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', boxShadow: '0 2px 6px rgba(22,163,74,0.25)' }}
                            >
                              <CheckCircle size={14} /> [🟢 운송 완료 마감]
                            </button>
                          )}

                          <button
                            onClick={() => handleCancelDeliveryStatus(selectedDelivery.id)}
                            style={{ padding: '6px 10px', borderRadius: '7px', backgroundColor: 'rgba(239,68,68,0.1)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.3)', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer' }}
                          >
                            🚫 배차 취소
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {(() => {
                    const normStatus = getNormalizedDeliveryStatus(selectedDelivery);
                    const isDispatchedOrCompleted = normStatus === 'DISPATCHED' || normStatus === 'DELIVERED' || normStatus === 'CANCELLED';
                    // 💡 [사장님 지시] 배차가 이미 완료/마감된 건은 visible = true, enable = false (수정 불가 잠금!)
                    const isFormDisabled = !canSave || (isDispatchedOrCompleted && !isEditUnlocked);

                    return (
                      <div>
                        {(() => {
                          const curContract = getContract(selectedDelivery.contractId);
                          const curCustomer = curContract ? getCustomer(curContract.customerId) : null;
                          const isOutOrEx = selectedDelivery.type === 'OUTBOUND' || selectedDelivery.dispatchCategory === '출고' || selectedDelivery.dispatchCategory === '교환';
                          if (isOutOrEx && curCustomer?.transactionStatus === 'BLOCKED') {
                            return (
                              <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#b91c1c', fontWeight: 800, fontSize: '13px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <AlertTriangle size={18} color="#ef4444" />
                                <span>[출고제한 거래처] 거래처 [{curCustomer.name}]은(는) 연체 관리로 인해 신규 장비 출고가 차단되었습니다. 배차를 확정할 수 없습니다.</span>
                              </div>
                            );
                          }
                          return null;
                        })()}

                        {/* 배차 세부 설정 폼 (3컬럼: 배차 구분 | 상차일자 & 시간 | 하차일자 & 시간) */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.25fr 1.25fr', gap: '14px', marginBottom: '16px' }}>
                          <div>
                            <label style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px', display: 'block', color: 'var(--text-secondary)' }}>배차 구분</label>
                            <select
                              value={dispatchCategory}
                              disabled={isFormDisabled}
                              onChange={e => setDispatchCategory(e.target.value as any)}
                              style={{ width: '100%', padding: '7px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-body)', fontSize: '12.5px', color: 'var(--text-primary)', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default' }}
                            >
                              <option value="출고">출고</option>
                              <option value="입고">입고</option>
                              <option value="교환">교환</option>
                              <option value="반납">반납</option>
                              <option value="정비">정비</option>
                              <option value="이동">이동</option>
                            </select>
                          </div>

                          <div>
                            <label style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px', display: 'block', color: 'var(--text-secondary)' }}>상차일자 & 시간</label>
                            <div style={{ display: 'flex', gap: '6px', position: 'relative', height: '34px' }}>
                              <input
                                type="date"
                                value={loadingDate}
                                disabled={isFormDisabled}
                                onChange={e => setLoadingDate(e.target.value)}
                                style={{ flex: 1, padding: '7px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-body)', fontSize: '12.5px', color: 'var(--text-primary)', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default', marginRight: '106px' }}
                              />
                              <select
                                value={loadingTimeSlot}
                                disabled={isFormDisabled}
                                onChange={e => {
                                  setLoadingTimeSlot(e.target.value);
                                  (e.target as HTMLSelectElement).blur();
                                }}
                                onFocus={e => { (e.target as HTMLSelectElement).size = 10; }}
                                onBlur={e => { (e.target as HTMLSelectElement).size = 1; }}
                                style={{
                                  width: '100px',
                                  padding: '6px',
                                  borderRadius: '6px',
                                  border: '1px solid var(--border-color)',
                                  backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-body)',
                                  fontSize: '12.5px',
                                  color: 'var(--text-primary)',
                                  opacity: isFormDisabled ? 0.75 : 1,
                                  cursor: isFormDisabled ? 'not-allowed' : 'default',
                                  position: 'absolute',
                                  right: 0,
                                  top: 0,
                                  zIndex: 30,
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                                }}
                              >
                                <option value="오전">오전</option>
                                <option value="오후">오후</option>
                                <option value="수시">수시</option>
                                <option value="06시">06시</option>
                                <option value="07시">07시</option>
                                <option value="08시">08시</option>
                                <option value="09시">09시</option>
                                <option value="10시">10시</option>
                                <option value="11시">11시</option>
                                <option value="12시">12시</option>
                                <option value="13시">13시</option>
                                <option value="14시">14시</option>
                                <option value="15시">15시</option>
                                <option value="16시">16시</option>
                                <option value="17시">17시</option>
                                <option value="18시">18시</option>
                                <option value="19시">19시</option>
                                <option value="20시">20시</option>
                              </select>
                            </div>
                          </div>

                          <div>
                            <label style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px', display: 'block', color: 'var(--text-secondary)' }}>하차일자 & 시간</label>
                            <div style={{ display: 'flex', gap: '6px', position: 'relative', height: '34px' }}>
                              <input
                                type="date"
                                value={unloadingDate}
                                disabled={isFormDisabled}
                                onChange={e => setUnloadingDate(e.target.value)}
                                style={{ flex: 1, padding: '7px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-body)', fontSize: '12.5px', color: 'var(--text-primary)', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default', marginRight: '106px' }}
                              />
                              <select
                                value={unloadingTimeSlot}
                                disabled={isFormDisabled}
                                onChange={e => {
                                  setUnloadingTimeSlot(e.target.value);
                                  (e.target as HTMLSelectElement).blur();
                                }}
                                onFocus={e => { (e.target as HTMLSelectElement).size = 10; }}
                                onBlur={e => { (e.target as HTMLSelectElement).size = 1; }}
                                style={{
                                  width: '100px',
                                  padding: '6px',
                                  borderRadius: '6px',
                                  border: '1px solid var(--border-color)',
                                  backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-body)',
                                  fontSize: '12.5px',
                                  color: 'var(--text-primary)',
                                  opacity: isFormDisabled ? 0.75 : 1,
                                  cursor: isFormDisabled ? 'not-allowed' : 'default',
                                  position: 'absolute',
                                  right: 0,
                                  top: 0,
                                  zIndex: 30,
                                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                                }}
                              >
                                <option value="오전">오전</option>
                                <option value="오후">오후</option>
                                <option value="수시">수시</option>
                                <option value="06시">06시</option>
                                <option value="07시">07시</option>
                                <option value="08시">08시</option>
                                <option value="09시">09시</option>
                                <option value="10시">10시</option>
                                <option value="11시">11시</option>
                                <option value="12시">12시</option>
                                <option value="13시">13시</option>
                                <option value="14시">14시</option>
                                <option value="15시">15시</option>
                                <option value="16시">16시</option>
                                <option value="17시">17시</option>
                                <option value="18시">18시</option>
                                <option value="19시">19시</option>
                                <option value="20시">20시</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                          <div>
                            <label style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px', display: 'block', color: 'var(--text-secondary)' }}>상차지 (출발지)</label>
                            <input
                              type="text"
                              value={originAddress}
                              disabled={isFormDisabled}
                              onChange={e => setOriginAddress(e.target.value)}
                              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-body)', fontSize: '12.5px', color: 'var(--text-primary)', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px', display: 'block', color: 'var(--text-secondary)' }}>하차지 (도착지)</label>
                            <input
                              type="text"
                              value={destinationAddress}
                              disabled={isFormDisabled}
                              onChange={e => setDestinationAddress(e.target.value)}
                              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-body)', fontSize: '12.5px', color: 'var(--text-primary)', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default' }}
                            />
                          </div>
                        </div>

                        {/* ────────────────────────────────────────────────────────────────── */}
                        {/* 🚚 배정 운송 기사 및 운송 거래처 목록 (isFormDisabled 시 비활성화!) */}
                        {/* ────────────────────────────────────────────────────────────────── */}
                        <div style={{ marginBottom: '20px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <label style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>🚚 배정 운송 기사 목록</label>
                            {!isFormDisabled && (
                              <button onClick={handleAddVehicleRow} style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 700, borderRadius: '4px', border: '1px solid var(--primary)', color: 'var(--primary)', backgroundColor: 'transparent', cursor: 'pointer' }}>
                                + 차량 추가
                              </button>
                            )}
                          </div>

                          {/* 컬럼 헤더 (사장님 지시: 예상 운송비 필수, 실제 운송비 선택적 입력 2열로 분리) */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.1fr 0.9fr 0.8fr 1.1fr 1fr 1fr 30px', gap: '6px', padding: '6px 10px', backgroundColor: 'var(--bg-body)', borderRadius: '6px', fontSize: '11px', fontWeight: 800, color: 'var(--primary)', marginBottom: '6px', border: '1px solid var(--border-color)' }}>
                            <div>운송사</div>
                            <div>기사명</div>
                            <div>차량번호</div>
                            <div>차종</div>
                            <div>연락처</div>
                            <div>예상운송비</div>
                            <div>실제운송비</div>
                            <div></div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {assignedVehicles.map((veh, idx) => {
                              const matchedComp = transportCompanies.find(c => c.name.trim() === veh.transportCompany.trim());
                              const filteredDrivers = matchedComp
                                ? transportDrivers.filter(d => d.companyId === matchedComp.id)
                                : transportDrivers;

                              return (
                                <div key={veh.id || idx} style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', display: 'grid', gridTemplateColumns: '1.2fr 1.1fr 0.9fr 0.8fr 1.1fr 1fr 1fr 30px', gap: '6px', alignItems: 'center' }}>
                                  
                                  {/* 1. 운송사 셀렉트 */}
                                  <select
                                    value={veh.transportCompany}
                                    disabled={isFormDisabled}
                                    onChange={e => handleVehicleFieldChange(idx, 'transportCompany', e.target.value)}
                                    style={{ padding: '6px 6px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '11.5px', outline: 'none', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default' }}
                                  >
                                    <option value="">-- 운송사 선택 --</option>
                                    {transportCompanies.map(c => (
                                      <option key={c.id} value={c.name}>{c.name}</option>
                                    ))}
                                  </select>

                                  {/* 2. 기사명 셀렉트 */}
                                  <select
                                    value={veh.driverName}
                                    disabled={isFormDisabled}
                                    onChange={e => {
                                      handleVehicleFieldChange(idx, 'driverName', e.target.value);
                                    }}
                                    style={{ padding: '6px 6px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '11.5px', outline: 'none', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default' }}
                                  >
                                    <option value="">-- 기사 선택 --</option>
                                    {filteredDrivers.map(drv => (
                                      <option key={drv.id} value={drv.driverName}>
                                        {drv.driverName} ({drv.vehicleNo || '차량미상'})
                                      </option>
                                    ))}
                                  </select>

                                  {/* 2.5 차량번호 */}
                                  <input
                                    type="text"
                                    placeholder="차량번호"
                                    value={veh.vehicleNo || ''}
                                    disabled={isFormDisabled}
                                    onChange={e => handleVehicleFieldChange(idx, 'vehicleNo', e.target.value)}
                                    style={{ padding: '6px 6px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '11.5px', outline: 'none', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default' }}
                                  />

                                  {/* 3. 차종 셀렉트 */}
                                  <select
                                    value={veh.vehicleType}
                                    disabled={isFormDisabled}
                                    onChange={e => handleVehicleFieldChange(idx, 'vehicleType', e.target.value)}
                                    style={{ padding: '6px 6px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '11.5px', outline: 'none', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default' }}
                                  >
                                    {VEHICLE_TYPE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                                  </select>

                                  {/* 4. 연락처 */}
                                  <input
                                    type="text"
                                    placeholder="연락처"
                                    value={veh.driverContact}
                                    disabled={isFormDisabled}
                                    onChange={e => handleVehicleFieldChange(idx, 'driverContact', e.target.value)}
                                    style={{ padding: '6px 6px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '11.5px', outline: 'none', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default' }}
                                  />

                                  {/* 5. 💰 예상 운송비 (필수) */}
                                  <input
                                    type="number"
                                    placeholder="예상 운송비"
                                    value={veh.expectedCost !== undefined ? veh.expectedCost : ''}
                                    disabled={isFormDisabled}
                                    onChange={e => {
                                      const val = Number(e.target.value);
                                      handleVehicleFieldChange(idx, 'expectedCost', val);
                                      handleVehicleFieldChange(idx, 'deliveryCost', val);
                                    }}
                                    style={{ padding: '6px 6px', borderRadius: '6px', border: '1px solid var(--primary)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-card)', color: 'var(--primary)', fontSize: '11.5px', fontWeight: 800, textAlign: 'right', outline: 'none', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default' }}
                                  />

                                  {/* 6. 💵 실제 운송비 (선택 - 알면 금액 입력, 모르면 기본값 0 유지) */}
                                  <input
                                    type="number"
                                    placeholder="0 (알면 입력)"
                                    value={veh.finalCost !== undefined && veh.finalCost !== null ? veh.finalCost : 0}
                                    disabled={isFormDisabled}
                                    onChange={e => {
                                      const val = e.target.value === '' ? 0 : Number(e.target.value);
                                      handleVehicleFieldChange(idx, 'finalCost', val);
                                    }}
                                    style={{ padding: '6px 6px', borderRadius: '6px', border: '1px solid #16a34a', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'rgba(34,197,94,0.05)', color: '#16a34a', fontSize: '11.5px', fontWeight: 800, textAlign: 'right', outline: 'none', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default' }}
                                  />

                                  {!isFormDisabled && (
                                    <button onClick={() => handleRemoveVehicleRow(idx)} style={{ color: '#ef4444', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                                      <Trash2 size={16} />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* 마감 비고 메모 */}
                        <div style={{ marginBottom: '16px' }}>
                          <label style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px', display: 'block', color: 'var(--text-secondary)' }}>📝 배차 특이사항 및 마감 메모</label>
                          <textarea
                            value={closingMemo}
                            disabled={isFormDisabled}
                            onChange={e => setClosingMemo(e.target.value)}
                            placeholder="배차 기사 전달사항, 현장 특이사항 기록..."
                            style={{ width: '100%', height: '65px', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: isFormDisabled ? 'var(--bg-card)' : 'var(--bg-body)', color: 'var(--text-primary)', fontSize: '12.5px', boxSizing: 'border-box', opacity: isFormDisabled ? 0.75 : 1, cursor: isFormDisabled ? 'not-allowed' : 'default' }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {/* 💬 최하단: 스마트 출고 요청 자연어 원본 텍스트 박스 */}
                  <div style={{ marginBottom: '20px', padding: '14px 16px', backgroundColor: 'rgba(59,130,246,0.06)', border: '1.5px solid rgba(59,130,246,0.25)', borderRadius: '10px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MessageSquare size={16} /> 💬 스마트 출고 요청 자연어 원본 텍스트 (배차 판단 참고용)
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.6', fontFamily: 'Consolas, Monaco, monospace', backgroundColor: 'var(--bg-card)', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      {selectedDelivery.rawText || selectedDelivery.memo || '요청된 자연어 원문이 없습니다.'}
                    </div>
                  </div>

                  {/* ⚖️ 우하단 터미널 액션 바 (Z-패턴 4단계 최종 완결, 헌장 3.5) */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '14px 18px',
                    backgroundColor: 'var(--bg-body)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    marginBottom: '16px'
                  }}>
                    {canSave && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleCancelDeliveryStatus(selectedDelivery.id)}
                          style={{ padding: '7px 12px', borderRadius: '6px', backgroundColor: 'rgba(239,68,68,0.1)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.3)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                        >
                          🚫 배차 취소
                        </button>

                        {getNormalizedDeliveryStatus(selectedDelivery) === 'DISPATCHED' && (
                          <button
                            type="button"
                            onClick={() => handleCompleteDeliveryStatus(selectedDelivery.id)}
                            style={{ padding: '7px 14px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 800, fontSize: '12.5px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                          >
                            <CheckCircle size={14} /> [🟢 운송 완료 마감]
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={handleSaveDispatch}
                          className="btn-primary"
                          style={{ padding: '7px 16px', fontWeight: 800, fontSize: '12.5px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                        >
                          <ShieldCheck size={15} /> [🔵 배차 기사 배정 완료]
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 회계 대차대조식 검증 바 (헌장 3.5) */}
          {(() => {
            const pendingDeliveries = deliveries.filter(d => d.status === 'PENDING').length;
            const dispatchedDeliveries = deliveries.filter(d => d.status === 'DISPATCHED').length;
            const deliveredDeliveries = deliveries.filter(d => d.status === 'DELIVERED').length;
            const cancelledDeliveries = deliveries.filter(d => d.status === 'CANCELLED').length;
            const exchangeCount = deliveries.filter(d => d.dispatchCategory === '교환' || d.type === 'EXCHANGE').length;

            return (
              <div style={{
                padding: '8px 14px',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                fontSize: '11.5px',
                borderRadius: '6px',
                marginTop: '12px',
                flexShrink: 0
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                  <span>배차 대기: <strong style={{ color: '#d97706' }}>총 {pendingDeliveries}건</strong></span>
                  <span>|</span>
                  <span>배차 완료: <strong style={{ color: 'var(--primary)' }}>총 {dispatchedDeliveries}건</strong></span>
                  <span>|</span>
                  <span>운송 완료: <strong style={{ color: 'var(--success)' }}>총 {deliveredDeliveries}건</strong></span>
                  <span>|</span>
                  <span>대차(EXCHANGE) 왕복배차: <strong style={{ color: '#8b5cf6' }}>총 {exchangeCount}건</strong></span>
                  <span>|</span>
                  <span>취소: <strong style={{ color: 'var(--danger)' }}>총 {cancelledDeliveries}건</strong></span>
                </div>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--success-light)',
                  color: 'var(--success)',
                  fontWeight: 700,
                  fontSize: '11px'
                }}>
                  ⚖️ 대차 정상 (배차의뢰-기사배정-운송비 1:1 무결)
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {/* 탭 2: 운송사 배차 협의 (통화파일 업로드 ➔ 큐 처리 ➔ AI 분석 ➔ 배차 매핑 ➔ 확정) */}
      {activeTab === 'NEGOTIATION' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* ── [Step 1] 최상단: 통화 파일 업로드 및 협의 큐 (Call Queue Pipeline) ── */}
          <div style={{
            backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px',
            padding: '16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '12px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileAudio size={18} style={{ color: '#3b82f6' }} />
                  <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
                    배차 협의 통화 큐 (Call Queue)
                  </span>
                  <span style={{
                    padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 800,
                    backgroundColor: 'rgba(59,130,246,0.15)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.3)'
                  }}>
                    대기 {callQueue.filter(q => q.status !== 'CONFIRMED').length}건
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  스마트폰 또는 PC에서 녹음된 통화 파일(.m4a, .mp3, .wav)을 업로드하면 AI가 운송사, 차종, 운송비, 특약을 자동 추출합니다.
                </div>
              </div>

              {/* 통화 파일 업로드 액션 버튼 & 히든 인풋 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="file"
                  ref={callFileInputRef}
                  accept="audio/*,.m4a,.mp3,.wav,.aac,.amr"
                  style={{ display: 'none' }}
                  onChange={e => {
                    if (e.target.files && e.target.files[0]) {
                      handleUploadCallFile(e.target.files[0]);
                      e.target.value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={isUploadingCall}
                  onClick={() => callFileInputRef.current?.click()}
                  style={{
                    padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--primary)',
                    color: '#ffffff', border: 'none', fontWeight: 800, fontSize: '12.5px',
                    cursor: isUploadingCall ? 'not-allowed' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    opacity: isUploadingCall ? 0.7 : 1
                  }}
                >
                  {isUploadingCall ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      <span>AI STT & 분석 중...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud size={15} />
                      <span>통화 녹음 파일 직접 업로드</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {callUploadError && (
              <div style={{ padding: '8px 12px', borderRadius: '6px', backgroundColor: 'rgba(239,68,68,0.1)', color: '#dc2626', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={14} /> {callUploadError}
              </div>
            )}

            {/* 통화 큐 카드 가로 리스트 */}
            <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
              {callQueue.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', width: '100%', color: 'var(--text-muted)', fontSize: '12px', backgroundColor: 'var(--bg-body)', borderRadius: '6px' }}>
                  등록된 배차 통화 녹음이 없습니다. [통화 녹음 파일 직접 업로드] 버튼을 눌러 새 통화 파일을 등록하십시오.
                </div>
              ) : (
                callQueue.map(item => {
                  const isSelected = selectedCallQueueId === item.id;
                  const isConfirmed = item.status === 'CONFIRMED';
                  const isAnalyzing = item.status === 'ANALYZING';

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelectCallQueueItem(item)}
                      style={{
                        minWidth: '270px', maxWidth: '300px', flexShrink: 0,
                        padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                        backgroundColor: isSelected ? 'rgba(59,130,246,0.12)' : 'var(--bg-body)',
                        border: isSelected ? '2px solid var(--primary)' : isConfirmed ? '1px solid #10b981' : '1px solid var(--border-color)',
                        display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{
                          fontSize: '10.5px', fontWeight: 800, padding: '2px 6px', borderRadius: '4px',
                          backgroundColor: isConfirmed ? 'rgba(16,185,129,0.15)' : isAnalyzing ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)',
                          color: isConfirmed ? '#10b981' : isAnalyzing ? '#d97706' : '#2563eb'
                        }}>
                          {isConfirmed ? '✅ 배차확정됨' : isAnalyzing ? '⏳ AI 분석중' : '🟢 분석완료'}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            {item.durationSec ? `${item.durationSec}초` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={e => handleDeleteCallQueueItem(item.id, e)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex' }}
                            title="큐에서 삭제"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>

                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.fileName}
                      </div>

                      {/* 추출 하이라이트 배지 */}
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {item.extracted.transportCompanyName && (
                          <span style={{ fontSize: '10.5px', fontWeight: 800, backgroundColor: 'rgba(59,130,246,0.15)', color: '#2563eb', padding: '1px 5px', borderRadius: '4px' }}>
                            {item.extracted.transportCompanyName}
                          </span>
                        )}
                        {item.extracted.vehicleType && (
                          <span style={{ fontSize: '10.5px', fontWeight: 800, backgroundColor: 'rgba(139,92,246,0.15)', color: '#8b5cf6', padding: '1px 5px', borderRadius: '4px' }}>
                            {item.extracted.vehicleType}
                          </span>
                        )}
                        {item.extracted.proposedCost ? (
                          <span style={{ fontSize: '10.5px', fontWeight: 800, backgroundColor: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '1px 5px', borderRadius: '4px' }}>
                            ₩{item.extracted.proposedCost.toLocaleString()}
                          </span>
                        ) : null}
                      </div>

                      {item.extracted.matchedDeliverySummary && (
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          매칭: {item.extracted.matchedDeliverySummary}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── [Step 2 & 3] 2분할 마스터-디테일 스튜디오 (좌측 배차 대상 + 우측 AI 협의 데스크) ── */}
          <div style={{ display: 'flex', gap: '16px', minHeight: '650px', alignItems: 'flex-start' }}>
            {/* ── 좌측 Master: 배차 대상 건 리스트 (너비 400px 고정) ── */}
            <div style={{
              width: '400px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '10px',
              backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px',
              padding: '14px', boxSizing: 'border-box'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                  <Truck size={16} /> 배차 대상 목록
                </h3>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                  총 {deliveries.filter(d => d.status !== 'CANCELLED').length}건
                </span>
              </div>

              {/* 통화 AI 추천 배차 상단 배너 카드 */}
              {selectedCall?.extracted.matchedDeliveryId && (() => {
                const matchedDel = deliveries.find(d => d.id === selectedCall.extracted.matchedDeliveryId);
                if (!matchedDel) return null;
                const mContract = contracts.find(c => c.id === matchedDel.contractId);
                const mCust = customers.find(c => c.id === mContract?.customerId);
                const mSite = sites?.find(s => s.id === mContract?.siteId);
                const isCurrentSelected = selectedNegoDeliveryId === matchedDel.id;
                return (
                  <div
                    onClick={() => setSelectedNegoDeliveryId(matchedDel.id)}
                    style={{
                      padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                      backgroundColor: isCurrentSelected ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.08)',
                      border: '1.5px dashed #10b981',
                      display: 'flex', flexDirection: 'column', gap: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Sparkles size={12} /> 🎯 통화 AI 추천 매칭 배차
                      </span>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                        #{matchedDel.id.slice(-6)}
                      </span>
                    </div>
                    <div style={{ fontSize: '12.5px', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {mCust?.name || '(고객사)'} · {mSite?.name || '현장'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {matchedDel.destinationAddress || matchedDel.originAddress || '현장 주소'}
                    </div>
                  </div>
                );
              })()}

              {/* 필터 & 검색 */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <select
                  value={negoFilterStatus}
                  onChange={e => setNegoFilterStatus(e.target.value as any)}
                  style={{
                    padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700
                  }}
                >
                  <option value="ALL">전체 상태</option>
                  <option value="PENDING">배차 대기</option>
                  <option value="IN_NEGOTIATION">협의 중</option>
                  <option value="CONFIRMED">협의 완료</option>
                </select>
                <input
                  type="text"
                  value={negoSearchQuery}
                  onChange={e => setNegoSearchQuery(e.target.value)}
                  placeholder="고객/현장/주소 검색..."
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: '12px'
                  }}
                />
              </div>

              {/* 배차 건 스크롤 리스트 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '580px', overflowY: 'auto' }}>
                {(() => {
                  const filtered = deliveries.filter(d => {
                    if (d.status === 'CANCELLED') return false;
                    const negos = (transportNegotiations || []).filter(n => n.deliveryId === d.id);
                    const hasConfirmed = negos.some(n => n.status === 'CONFIRMED');
                    const hasNegotiating = negos.some(n => n.status === 'IN_NEGOTIATION');

                    if (negoFilterStatus === 'PENDING' && d.status !== 'PENDING') return false;
                    if (negoFilterStatus === 'IN_NEGOTIATION' && !hasNegotiating) return false;
                    if (negoFilterStatus === 'CONFIRMED' && !hasConfirmed) return false;

                    if (negoSearchQuery) {
                      const q = negoSearchQuery.toLowerCase();
                      const contract = contracts.find(c => c.id === d.contractId);
                      const customer = customers.find(c => c.id === contract?.customerId);
                      const site = sites?.find(s => s.id === contract?.siteId);
                      const match = (customer?.name || '').toLowerCase().includes(q) ||
                                    (site?.name || '').toLowerCase().includes(q) ||
                                    (d.destinationAddress || '').toLowerCase().includes(q) ||
                                    (d.originAddress || '').toLowerCase().includes(q);
                      if (!match) return false;
                    }
                    return true;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)', fontSize: '12px' }}>
                        해당 조건의 배차 건이 없습니다.
                      </div>
                    );
                  }

                  return filtered.map(del => {
                    const isSelected = selectedNegoDeliveryId === del.id;
                    const isAiMatched = selectedCall?.extracted.matchedDeliveryId === del.id;
                    const contract = contracts.find(c => c.id === del.contractId);
                    const customer = customers.find(c => c.id === contract?.customerId);
                    const site = sites?.find(s => s.id === contract?.siteId);
                    const negos = (transportNegotiations || []).filter(n => n.deliveryId === del.id);
                    const confirmedNego = negos.find(n => n.status === 'CONFIRMED');

                    const typeLabel = del.type === 'OUTBOUND' ? '출고' : del.type === 'INBOUND' ? '회수' : del.type === 'EXCHANGE' ? '교환' : '이동';
                    const typeColor = del.type === 'OUTBOUND' ? '#2563eb' : del.type === 'INBOUND' ? '#dc2626' : del.type === 'EXCHANGE' ? '#0891b2' : '#6b7280';

                    return (
                      <div
                        key={del.id}
                        onClick={() => setSelectedNegoDeliveryId(del.id)}
                        style={{
                          padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s ease',
                          backgroundColor: isSelected ? 'rgba(59,130,246,0.12)' : 'var(--bg-body)',
                          border: isSelected ? '1.5px solid var(--primary)' : isAiMatched ? '1.5px solid #10b981' : '1px solid var(--border-color)',
                          display: 'flex', flexDirection: 'column', gap: '5px', position: 'relative'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{
                              padding: '2px 6px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 800,
                              backgroundColor: `${typeColor}20`, color: typeColor, border: `1px solid ${typeColor}40`, whiteSpace: 'nowrap'
                            }}>
                              {typeLabel}
                            </span>
                            {isAiMatched && (
                              <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 800, backgroundColor: 'rgba(16,185,129,0.15)', padding: '1px 5px', borderRadius: '4px' }}>
                                🎯 매칭
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                            {del.loadingDate || del.scheduledDate || del.requestDate}
                          </span>
                        </div>

                        <div style={{ fontSize: '12.5px', fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {customer?.name || '(고객사 미지정)'} · {site?.name || '현장'}
                        </div>

                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <MapPin size={11} /> {del.destinationAddress || del.originAddress || '주소 미입력'}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#10b981' }}>
                            ₩{del.deliveryCost ? del.deliveryCost.toLocaleString() : '미정'}
                          </span>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            {confirmedNego ? (
                              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', backgroundColor: 'rgba(16,185,129,0.15)', color: '#10b981', fontWeight: 800 }}>
                                확정: {confirmedNego.transportCompanyName}
                              </span>
                            ) : negos.length > 0 ? (
                              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', backgroundColor: 'rgba(59,130,246,0.15)', color: '#2563eb', fontWeight: 800 }}>
                                견적 {negos.length}건
                              </span>
                            ) : (
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                협의대기
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* ── 우측 Detail Studio: 선택된 배차의 운송사 협의 데스크 ── */}
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column', gap: '14px',
              backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px',
              padding: '16px', boxSizing: 'border-box', minWidth: 0
            }}>
              {!selectedNegoDelivery ? (
                <div style={{ textAlign: 'center', padding: '100px 20px', color: 'var(--text-muted)' }}>
                  <Truck size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
                  <h4 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 6px 0' }}>선택된 배차 건이 없습니다</h4>
                  <p style={{ fontSize: '12px', margin: 0 }}>상단 통화 큐에서 통화를 선택하거나, 좌측 목록에서 협의할 배차 건을 선택하십시오.</p>
                </div>
              ) : (
                (() => {
                  const contract = contracts.find(c => c.id === selectedNegoDelivery.contractId);
                  const customer = customers.find(c => c.id === contract?.customerId);
                  const site = sites?.find(s => s.id === contract?.siteId);
                  const currentNegos = (transportNegotiations || []).filter(n => n.deliveryId === selectedNegoDelivery.id);

                  return (
                    <>
                      {/* 선택된 통화 음성 플레이어 & STT 전사문 카드 (큐에서 선택된 경우) */}
                      {selectedCall && (
                        <div style={{
                          backgroundColor: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '8px',
                          padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Sparkles size={15} style={{ color: '#3b82f6' }} />
                              <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>
                                AI 통화 분석: {selectedCall.fileName}
                              </span>
                              <span style={{
                                fontSize: '10.5px', padding: '1px 6px', borderRadius: '4px', fontWeight: 800,
                                backgroundColor: selectedCall.extracted.confidence === 'HIGH' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                                color: selectedCall.extracted.confidence === 'HIGH' ? '#10b981' : '#d97706'
                              }}>
                                신뢰도 {selectedCall.extracted.confidence}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleSelectCallQueueItem(selectedCall)}
                              style={{
                                fontSize: '11px', fontWeight: 800, padding: '4px 8px', borderRadius: '4px',
                                backgroundColor: 'rgba(59,130,246,0.15)', color: '#2563eb', border: 'none', cursor: 'pointer'
                              }}
                            >
                              ⚡ 폼에 다시 자동 채우기
                            </button>
                          </div>

                          {/* 오디오 플레이어 */}
                          {selectedCall.audioUrl && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Volume2 size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                              <audio controls src={selectedCall.audioUrl} style={{ width: '100%', height: '32px' }} />
                            </div>
                          )}

                          {/* STT 음성 전사문 */}
                          {selectedCall.transcript && (
                            <div style={{
                              fontSize: '12px', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-body)',
                              padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)',
                              lineHeight: 1.5, maxHeight: '80px', overflowY: 'auto'
                            }}>
                              <strong style={{ color: 'var(--text-primary)', marginRight: '6px' }}>[음성 전사]</strong>
                              "{selectedCall.transcript}"
                            </div>
                          )}
                        </div>
                      )}

                      {/* 1. 배차 기본 정보 카드 */}
                      <div style={{
                        backgroundColor: 'var(--bg-body)', border: '1px solid var(--border-color)', borderRadius: '8px',
                        padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px'
                      }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                              배차 번호 #{selectedNegoDelivery.id.slice(-6)} · {selectedNegoDelivery.type}
                            </span>
                            {selectedCall?.extracted.matchedDeliveryId === selectedNegoDelivery.id && (
                              <span style={{ fontSize: '10.5px', color: '#10b981', fontWeight: 800, backgroundColor: 'rgba(16,185,129,0.15)', padding: '1px 6px', borderRadius: '4px' }}>
                                🎯 통화 매칭 대상
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '2px' }}>
                            {customer?.name || '고객사'} — {site?.name || '현장'}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                            <span><strong>상차:</strong> {selectedNegoDelivery.originAddress || '본사 주기장'} ({selectedNegoDelivery.loadingDate || '-'})</span>
                            <span>➔</span>
                            <span><strong>하차:</strong> {selectedNegoDelivery.destinationAddress || '현장 주소'} ({selectedNegoDelivery.unloadingDate || '-'})</span>
                          </div>
                          {selectedNegoDelivery.memo && (
                            <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
                              메모: {selectedNegoDelivery.memo}
                            </div>
                          )}
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>현재 등록 운송비</div>
                          <div style={{ fontSize: '18px', fontWeight: 800, color: '#10b981' }}>
                            ₩{selectedNegoDelivery.deliveryCost ? selectedNegoDelivery.deliveryCost.toLocaleString() : '0'}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            차종: {selectedNegoDelivery.vehicleType || '미지정'} | 운송사: {selectedNegoDelivery.transportCompany || '미지정'}
                          </div>
                        </div>
                      </div>

                      {/* 2. 기 접수된 운송사 협의 내역 */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <h4 style={{ fontSize: '13px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                            <FileText size={14} /> 운송사별 견적 및 협의 현황 ({currentNegos.length}건)
                          </h4>
                        </div>

                        {currentNegos.length === 0 ? (
                          <div style={{ padding: '20px', textAlign: 'center', backgroundColor: 'var(--bg-body)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '12px' }}>
                            아직 등록된 운송사 협의 내역이 없습니다. 아래 폼에서 첫 견적을 등록하거나 통화를 확정하십시오.
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                            {currentNegos.map(n => {
                              const isConfirmed = n.status === 'CONFIRMED';
                              const isRejected = n.status === 'REJECTED';
                              return (
                                <div
                                  key={n.id}
                                  style={{
                                    padding: '12px', borderRadius: '8px', border: isConfirmed ? '2px solid #10b981' : isRejected ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border-color)',
                                    backgroundColor: isConfirmed ? 'rgba(16,185,129,0.08)' : isRejected ? 'rgba(239,68,68,0.03)' : 'var(--bg-body)',
                                    display: 'flex', flexDirection: 'column', gap: '6px'
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>
                                      {n.transportCompanyName}
                                    </span>
                                    <span style={{
                                      fontSize: '10.5px', padding: '2px 6px', borderRadius: '4px', fontWeight: 800,
                                      backgroundColor: isConfirmed ? '#10b981' : isRejected ? '#ef4444' : '#2563eb',
                                      color: '#ffffff'
                                    }}>
                                      {isConfirmed ? '확정/낙찰' : isRejected ? '결렬' : '협의중'}
                                    </span>
                                  </div>

                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                                    <span>차종: <strong>{n.vehicleType}</strong></span>
                                    <span>제시: <strong style={{ color: '#ef4444' }}>₩{n.proposedCost.toLocaleString()}</strong></span>
                                    <span>목표: <strong style={{ color: '#10b981' }}>₩{n.targetCost.toLocaleString()}</strong></span>
                                  </div>

                                  {n.specialTerms && (
                                    <div style={{ fontSize: '11px', color: '#d97706', backgroundColor: 'rgba(217,119,6,0.1)', padding: '4px 6px', borderRadius: '4px' }}>
                                      특약: {n.specialTerms}
                                    </div>
                                  )}

                                  {n.callSummary && (
                                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                                      {n.callSummary}
                                    </div>
                                  )}

                                  {!isConfirmed && (
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                                      <button
                                        type="button"
                                        className="btn-primary"
                                        onClick={() => handleConfirmNegotiation(n)}
                                        style={{ padding: '6px 12px', fontSize: '11.5px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                      >
                                        <Check size={13} /> 이 조건으로 배차 확정
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* 3. 신규 운송사 견적 및 통화 협의 기록 폼 (헌장 3.4 상하 세로 스택 레이아웃) */}
                      <div style={{
                        backgroundColor: 'var(--bg-body)', border: '1px solid var(--border-color)', borderRadius: '8px',
                        padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <h4 style={{ fontSize: '13px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Plus size={14} /> 운송사 통화 견적 및 협의 조건
                          </h4>
                          {selectedCall && (
                            <span style={{ fontSize: '11px', color: '#3b82f6', fontWeight: 700 }}>
                              AI 추출 내용 자동 입력됨
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
                          {/* 1. 협의 운송사 */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>협의 운송사 *</label>
                            <select
                              value={negoCompanyId}
                              onChange={e => setNegoCompanyId(e.target.value)}
                              style={{
                                padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700
                              }}
                            >
                              <option value="">운송사 선택</option>
                              {transportCompanies.map(c => (
                                <option key={c.id} value={c.id}>{c.name} ({c.contact || '연락처없음'})</option>
                              ))}
                            </select>
                          </div>

                          {/* 2. 제안 차종 */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>제안 차종</label>
                            <select
                              value={negoVehicleType}
                              onChange={e => setNegoVehicleType(e.target.value)}
                              style={{
                                padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700
                              }}
                            >
                              {VEHICLE_TYPE_OPTIONS.map(v => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          </div>

                          {/* 3. 운송사 제시가 */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>운송사 제시 금액 (원)</label>
                            <input
                              type="number"
                              value={negoProposedCost || ''}
                              onChange={e => setNegoProposedCost(Number(e.target.value))}
                              placeholder="예: 120000"
                              style={{
                                padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700
                              }}
                            />
                          </div>

                          {/* 4. 당사 목표가 */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>당사 목표 금액 (원)</label>
                            <input
                              type="number"
                              value={negoTargetCost || ''}
                              onChange={e => setNegoTargetCost(Number(e.target.value))}
                              placeholder="예: 100000"
                              style={{
                                padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700
                              }}
                            />
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
                          {/* 특약 사항 */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>할증/회차 특약 메모</label>
                            <input
                              type="text"
                              value={negoSpecialTerms}
                              onChange={e => setNegoSpecialTerms(e.target.value)}
                              placeholder="예: 회차비 50%, 야간 2만원 할증..."
                              style={{
                                padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px'
                              }}
                            />
                          </div>

                          {/* 통화 내용 요약 */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>통화 및 협의 내용 요약</label>
                            <input
                              type="text"
                              value={negoCallSummary}
                              onChange={e => setNegoCallSummary(e.target.value)}
                              placeholder="예: 내일 오전 08시 상차 가능하다고 회신받음..."
                              style={{
                                padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px'
                              }}
                            />
                          </div>
                        </div>

                        {/* 우하단 등록 및 1클릭 배차 확정 버튼군 */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={handleSaveNegotiation}
                            style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                          >
                            <Check size={14} /> 협의 내용만 저장
                          </button>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={handleConfirmCurrentForm}
                            style={{
                              padding: '8px 20px', fontSize: '12.5px', fontWeight: 800,
                              backgroundColor: '#10b981', borderColor: '#10b981', color: '#ffffff',
                              display: 'inline-flex', alignItems: 'center', gap: '6px'
                            }}
                          >
                            <CheckCircle size={15} /> ⭐ 이 조건으로 배차 반영 및 확정
                          </button>
                        </div>
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </div>
        </div>
      )}

      {/* 탭 3: 월말 운송료 대사 및 매입 지급 요청 (Z-패턴 4단계 직무 완결 동선) */}
      {activeTab === 'RECONCILIATION' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          {/* ────────────── ① 좌상단 (Start/Scope) & ② 우상단 (Input/Pipeline) Z-패턴 2단 레이아웃 ────────────── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(520px, 1.4fr) minmax(360px, 1fr)',
            gap: '14px',
            alignItems: 'stretch'
          }}>
            
            {/* ① 좌측 상단 [START / SCOPE]: 정산 대상 범위 설정 */}
            <div style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '12px'
            }}>
              {/* 스코프 헤더 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Calendar size={15} color="var(--primary)" /> 정산 범위 설정
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  기간 및 운송사 스코프 지정
                </span>
              </div>

              {/* 1. 정산 연월 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  정산 연월:
                </label>
                <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {[
                    { label: '26년 7월', key: '2026-07' },
                    { label: '26년 8월', key: '2026-08' },
                    { label: '당월', key: 'THIS_MONTH' },
                    { label: '전월', key: 'LAST_MONTH' },
                    { label: '전체', key: 'ALL' }
                  ].map(b => (
                    <button
                      key={b.key}
                      onClick={() => handleSetReconDatePreset(b.key as any)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        borderRadius: '4px',
                        border: '1px solid',
                        borderColor: (b.key === '2026-07' && reconStartDate === '2026-07-01' && reconEndDate === '2026-07-31') ||
                                     (b.key === '2026-08' && reconStartDate === '2026-08-01' && reconEndDate === '2026-08-31')
                                      ? 'var(--primary)' : 'var(--border-color)',
                        backgroundColor: (b.key === '2026-07' && reconStartDate === '2026-07-01' && reconEndDate === '2026-07-31') ||
                                         (b.key === '2026-08' && reconStartDate === '2026-08-01' && reconEndDate === '2026-08-31')
                                          ? 'rgba(59,130,246,0.12)' : 'var(--bg-body)',
                        color: (b.key === '2026-07' && reconStartDate === '2026-07-01' && reconEndDate === '2026-07-31') ||
                               (b.key === '2026-08' && reconStartDate === '2026-08-01' && reconEndDate === '2026-08-31')
                                ? 'var(--primary)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {b.label}
                    </button>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px', backgroundColor: 'var(--bg-body)', padding: '2px 5px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                    <input
                      type="date"
                      value={reconStartDate}
                      onChange={e => setReconStartDate(e.target.value)}
                      style={{ padding: '2px 4px', borderRadius: '3px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '11px' }}
                    />
                    <span style={{ fontSize: '11px' }}>~</span>
                    <input
                      type="date"
                      value={reconEndDate}
                      onChange={e => setReconEndDate(e.target.value)}
                      style={{ padding: '2px 4px', borderRadius: '3px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '11px' }}
                    />
                  </div>
                </div>
              </div>

              {/* 2. 정산 운송사 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  정산 운송사:
                </label>
                <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setSelectedReconCompany('ALL')}
                    style={{
                      padding: '4px 9px',
                      borderRadius: '5px',
                      border: '1px solid',
                      borderColor: selectedReconCompany === 'ALL' ? 'var(--primary)' : 'var(--border-color)',
                      backgroundColor: selectedReconCompany === 'ALL' ? 'rgba(59,130,246,0.12)' : 'var(--bg-body)',
                      color: selectedReconCompany === 'ALL' ? 'var(--primary)' : 'var(--text-primary)',
                      fontWeight: selectedReconCompany === 'ALL' ? 800 : 500,
                      fontSize: '11.5px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <span>전체 운송사</span>
                    <span style={{ padding: '1px 4px', borderRadius: '8px', fontSize: '10px', fontWeight: 800, backgroundColor: 'rgba(59,130,246,0.2)', color: 'var(--primary)' }}>
                      미지급 {unpaidStatsByCompany.ALL?.unpaid || 0}건
                    </span>
                  </button>

                  {[
                    { name: '경기', label: '경기' },
                    { name: '엘제이', label: '엘제이' },
                    { name: '자인', label: '자인 (엠제이)' }
                  ].map(comp => {
                    const stat = unpaidStatsByCompany[comp.name] || { total: 0, unpaid: 0, unpaidCost: 0 };
                    const isSelected = selectedReconCompany === comp.name;
                    return (
                      <button
                        key={comp.name}
                        onClick={() => setSelectedReconCompany(comp.name)}
                        style={{
                          padding: '4px 9px',
                          borderRadius: '5px',
                          border: '1px solid',
                          borderColor: isSelected ? 'var(--primary)' : 'var(--border-color)',
                          backgroundColor: isSelected ? 'rgba(59,130,246,0.12)' : 'var(--bg-body)',
                          color: isSelected ? 'var(--primary)' : 'var(--text-primary)',
                          fontWeight: isSelected ? 800 : 500,
                          fontSize: '11.5px',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        <span>{comp.label}</span>
                        <span style={{
                          padding: '1px 4px',
                          borderRadius: '8px',
                          fontSize: '10px',
                          fontWeight: 800,
                          backgroundColor: stat.unpaid > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                          color: stat.unpaid > 0 ? '#dc2626' : '#16a34a'
                        }}>
                          {stat.unpaid}건
                        </span>
                      </button>
                    );
                  })}

                  <select
                    value={selectedReconCompany}
                    onChange={e => setSelectedReconCompany(e.target.value)}
                    style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: '11px', height: '26px' }}
                  >
                    <option value="ALL">기타 운송사...</option>
                    {transportCompanies.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 3. 지급 상태 & 조회 버튼 */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px dashed var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>지급 상태:</span>
                  {[
                    { key: 'UNPAID', label: '미완료 (대사대상)' },
                    { key: 'PAID', label: '지급요청/완료' },
                    { key: 'ALL', label: '전체' }
                  ].map(p => (
                    <button
                      key={p.key}
                      onClick={() => setReconPaymentFilter(p.key as any)}
                      style={{
                        padding: '3px 8px',
                        fontSize: '11px',
                        fontWeight: reconPaymentFilter === p.key ? 800 : 500,
                        borderRadius: '4px',
                        border: '1px solid',
                        borderColor: reconPaymentFilter === p.key ? (p.key === 'UNPAID' ? '#dc2626' : 'var(--primary)') : 'var(--border-color)',
                        backgroundColor: reconPaymentFilter === p.key ? (p.key === 'UNPAID' ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)') : 'var(--bg-body)',
                        color: reconPaymentFilter === p.key ? (p.key === 'UNPAID' ? '#dc2626' : 'var(--primary)') : 'var(--text-muted)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleReconSearch}
                  className="btn-primary"
                  style={{ padding: '5px 14px', fontSize: '12px', fontWeight: 800, borderRadius: '5px', display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}
                >
                  <Search size={13} /> 조회
                </button>
              </div>
            </div>

            {/* ② 우측 상단 [INPUT / PIPELINE]: 데이터 유입 파이프라인 */}
            <div style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Upload size={15} color="var(--primary)" /> 거래명세서 데이터 유입
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  엑셀 거래명세서 ➔ 1:1 자동 대사
                </span>
              </div>

              {/* 메인 액션 버튼: 엑셀 거래명세서 업로드 & 자동대사 */}
              <input type="file" ref={fileInputRef} onChange={handleExcelFileUpload} accept=".xlsx, .xls, .csv" style={{ display: 'none' }} />
              
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-primary"
                style={{
                  padding: '12px 18px',
                  fontSize: '13.5px',
                  fontWeight: 900,
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 3px 10px rgba(59,130,246,0.3)',
                  cursor: 'pointer',
                  border: 'none',
                  backgroundColor: 'var(--primary)',
                  color: '#fff'
                }}
              >
                <Upload size={16} /> 엑셀 거래명세서 업로드 & 자동 대사
              </button>

              {/* 하단 파이프라인 보조 버튼군 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                <button
                  onClick={handleDownloadExcelTemplate}
                  style={{
                    padding: '6px 8px',
                    fontSize: '11px',
                    fontWeight: 700,
                    borderRadius: '5px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-body)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <FileSpreadsheet size={12} /> 양식 다운로드
                </button>

                <button
                  onClick={handleExportReconciliationReport}
                  style={{
                    padding: '6px 8px',
                    fontSize: '11px',
                    fontWeight: 700,
                    borderRadius: '5px',
                    border: '1px solid rgba(16,185,129,0.4)',
                    backgroundColor: 'rgba(16,185,129,0.1)',
                    color: '#10b981',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <Download size={12} /> 대사 리포트
                </button>

                <button
                  onClick={async () => {
                    const targetYm = reconStartDate.slice(0, 7);
                    const compId = selectedReconCompany === 'ALL' ? undefined : transportCompanies.find(c => c.name === selectedReconCompany)?.id;
                    try {
                      const count = await convertReconciledDeliveriesToSettlement(targetYm, compId);
                      if (count > 0) {
                        showToast(`대사 완료 배차 ${count}건이 월말 매입 정산 대장으로 이관되었습니다.`);
                      } else {
                        showToast(`[${targetYm}] 연월에 대사 완료 상태인 미이관 배차건이 없습니다.`, 'warning');
                      }
                    } catch (err: any) {
                      showErrorModal(`매입 정산 이관 실패: ${err?.message || err}`);
                    }
                  }}
                  style={{
                    padding: '6px 8px',
                    fontSize: '11px',
                    fontWeight: 800,
                    borderRadius: '5px',
                    border: '1px solid rgba(99,102,241,0.4)',
                    backgroundColor: 'rgba(99,102,241,0.12)',
                    color: '#6366f1',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  매입정산 이관
                </button>
              </div>
            </div>

          </div>


          {/* ────────────── ③ 중앙 본문 (Body / Inspection): 고밀도 1:1 대사 작업대 그리드 (화면의 85% 확보) ────────────── */}
          <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            
            {/* 상태 필터 배지 바 + 일괄 승인 버튼 + 검색창 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { key: 'ALL', label: '전체', count: reconPairs.length || completedDeliveriesForRecon.length, color: 'var(--text-primary)', bg: 'var(--bg-body)' },
                  { key: 'MATCHED', label: '대사 일치', count: reconStats.matchedCount, color: '#16a34a', bg: 'rgba(34,197,94,0.1)' },
                  { key: 'MISMATCH', label: '금액 불일치', count: reconStats.mismatchCount, color: '#ca8a04', bg: 'rgba(234,179,8,0.12)' },
                  { key: 'EXCEL_ONLY', label: '엑셀 단독', count: reconPairs.filter(p => p.matchStatus === 'EXCEL_ONLY').length, color: '#dc2626', bg: 'rgba(239,68,68,0.1)' },
                  { key: 'SYSTEM_ONLY', label: '시스템 단독', count: reconPairs.filter(p => p.matchStatus === 'SYSTEM_ONLY').length, color: 'var(--text-muted)', bg: 'var(--bg-body)' },
                  { key: 'EXCLUDED', label: '오청구 제외', count: reconStats.excludedCount, color: 'var(--text-muted)', bg: 'rgba(100,116,139,0.1)' },
                  { key: 'PAYMENT_REQUESTED', label: '지급요청 완료', count: reconStats.paymentRequestedCount, color: '#2563eb', bg: 'rgba(37,99,235,0.1)' }
                ].map(t => (
                  <button
                    key={t.key}
                    onClick={() => setReconStatusFilter(t.key as any)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: '1px solid',
                      borderColor: reconStatusFilter === t.key ? t.color : 'var(--border-color)',
                      backgroundColor: reconStatusFilter === t.key ? t.bg : 'var(--bg-body)',
                      color: reconStatusFilter === t.key ? t.color : 'var(--text-secondary)',
                      fontWeight: reconStatusFilter === t.key ? 800 : 500,
                      fontSize: '11.5px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <span>{t.label}</span>
                    <strong style={{ fontSize: '11px', opacity: 0.9 }}>{t.count}</strong>
                  </button>
                ))}

                {/* 금액 불일치 / 할증 건 일괄 승인 버튼 */}
                {reconStats.mismatchCount > 0 && (
                  <button
                    onClick={handleApproveAllMismatches}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '6px',
                      border: '1px solid #ca8a04',
                      backgroundColor: 'rgba(234,179,8,0.18)',
                      color: '#a16207',
                      fontSize: '11.5px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    할증 {reconStats.mismatchCount}건 일괄 승인
                  </button>
                )}
              </div>

              {/* 검색창 */}
              <div style={{ position: 'relative', width: '220px' }}>
                <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="배차ID / 현장 / 업체 / 기사 검색..."
                  value={reconSearchQuery}
                  onChange={e => setReconSearchQuery(e.target.value)}
                  style={{ width: '100%', padding: '4px 8px 4px 26px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: '11.5px', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {/* 알림 메시지 */}
            {reconNotificationMsg && (
              <div style={{ fontSize: '12px', padding: '6px 10px', backgroundColor: 'rgba(59,130,246,0.08)', borderRadius: '6px', color: 'var(--primary)', fontWeight: 600 }}>
                {reconNotificationMsg}
              </div>
            )}

            {/* 1:1 대사 그리드 테이블 (행 높이 42px / 한눈에 15건 조망) */}
            <div style={{ maxHeight: 'calc(100vh - 320px)', minHeight: '400px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-body)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', position: 'sticky', top: 0, zIndex: 5, whiteSpace: 'nowrap' }}>
                    <th style={{ padding: '8px 10px', width: '70px', textAlign: 'center' }}>상태</th>
                    <th style={{ padding: '8px 10px', width: '85px' }}>시스템 일자</th>
                    <th style={{ padding: '8px 10px', minWidth: '180px' }}>시스템 배차 정보 (고객사 / 현장 / 기사)</th>
                    <th style={{ padding: '8px 10px', width: '90px', textAlign: 'right' }}>시스템 금액</th>
                    <th style={{ padding: '8px 6px', width: '30px', textAlign: 'center' }}>비교</th>
                    <th style={{ padding: '8px 10px', width: '85px' }}>엑셀 일자</th>
                    <th style={{ padding: '8px 10px', minWidth: '180px' }}>엑셀 청구 내역 (현장명 / 비고)</th>
                    <th style={{ padding: '8px 10px', width: '90px', textAlign: 'right' }}>엑셀 청구액</th>
                    <th style={{ padding: '8px 10px', width: '130px', textAlign: 'center' }}>차액 분석</th>
                    <th style={{ padding: '8px 10px', width: '140px', textAlign: 'center' }}>조치</th>
                  </tr>
                </thead>
                <tbody>
                  {reconPairs.length === 0 ? (
                    completedDeliveriesForRecon.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: 'center', padding: '50px 10px', color: 'var(--text-muted)' }}>
                          조회된 기간 내 배차 내역이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      completedDeliveriesForRecon.map(d => {
                        const contract = contracts.find(c => c.id === d.contractId);
                        const customer = contract ? customers.find(c => c.id === contract.customerId) : null;
                        const memoCustomer = d.memo && d.memo.includes('업체:') ? d.memo.split('업체:')[1].split('|')[0].trim() : '';
                        const displayCustomer = customer?.name || memoCustomer || '고객사미지정';
                        const cost = getEffectiveDeliveryCost(d);
                        return (
                          <tr key={d.id} style={{ borderBottom: '1px solid var(--border-color)', height: '40px' }}>
                            <td style={{ textAlign: 'center', padding: '6px' }}>
                              <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: 'var(--bg-body)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                                ⚪ 대기
                              </span>
                            </td>
                            <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{d.loadingDate || d.requestDate}</td>
                            <td style={{ padding: '6px 10px' }}>
                              <strong style={{ color: 'var(--text-primary)' }}>{displayCustomer}</strong> | {d.destinationAddress || '도착지미지정'} ({d.driverName || '기사미배정'})
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 800, color: 'var(--primary)' }}>
                              ₩{cost.toLocaleString()}
                            </td>
                            <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>-</td>
                            <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '11.5px' }}>
                              상단 [엑셀 거래명세서 업로드] 시 1:1 대사가 진행됩니다.
                            </td>
                            <td style={{ textAlign: 'center', padding: '6px' }}>
                              <button onClick={(e) => handleOpenCostEdit(d, cost, e)} style={{ padding: '2px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', cursor: 'pointer' }}>
                                금액수정
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )
                  ) : (
                    reconPairs
                      .filter(p => {
                        if (reconStatusFilter === 'ALL') return true;
                        if (reconStatusFilter === 'MATCHED') return p.isReconciled && !p.isExcluded;
                        if (reconStatusFilter === 'MISMATCH') return p.matchStatus === 'MISMATCH';
                        if (reconStatusFilter === 'EXCEL_ONLY') return p.matchStatus === 'EXCEL_ONLY' && !p.isExcluded;
                        if (reconStatusFilter === 'SYSTEM_ONLY') return p.matchStatus === 'SYSTEM_ONLY';
                        if (reconStatusFilter === 'EXCLUDED') return p.isExcluded || p.matchStatus === 'EXCLUDED';
                        if (reconStatusFilter === 'PAYMENT_REQUESTED') return p.matchStatus === 'PAYMENT_REQUESTED';
                        return true;
                      })
                      .sort((a, b) => {
                        // 💡 [사장님 지시] 운송료 대사 결과 항상 날짜순(오름차순: 과거 ➔ 최신) 정렬 보장
                        const dateA = a.excelRow?.['정규일자'] || a.systemDelivery?.loadingDate || a.systemDelivery?.requestDate || '9999-99-99';
                        const dateB = b.excelRow?.['정규일자'] || b.systemDelivery?.loadingDate || b.systemDelivery?.requestDate || '9999-99-99';
                        if (dateA !== dateB) return dateA.localeCompare(dateB);
                        return (a.pairId || '').localeCompare(b.pairId || '');
                      })
                      .map((pair, pIdx) => {
                        const sys = pair.systemDelivery;
                        const excel = pair.excelRow;
                        const contract = sys ? contracts.find(c => c.id === sys.contractId) : null;
                        const customer = contract ? customers.find(c => c.id === contract.customerId) : null;
                        const memoCustomer = sys?.memo && sys.memo.includes('업체:') ? sys.memo.split('업체:')[1].split('|')[0].trim() : '';
                        const displayCustomer = customer?.name || memoCustomer || '고객사미지정';

                        const isMatched = pair.isReconciled && !pair.isExcluded;
                        const isMismatch = pair.matchStatus === 'MISMATCH';
                        const isExcelOnly = pair.matchStatus === 'EXCEL_ONLY' && !pair.isExcluded;
                        const isSysOnly = pair.matchStatus === 'SYSTEM_ONLY';
                        const isExcluded = pair.isExcluded || pair.matchStatus === 'EXCLUDED';

                        return (
                          <tr
                            key={pair.pairId || pIdx}
                            onDoubleClick={() => setSelectedReconDetailPair(pair)}
                            title="더블클릭 시 배차 상세 및 엑셀 청구 대조 모달이 열립니다."
                            style={{
                              borderBottom: '1px solid var(--border-color)',
                              backgroundColor: isExcluded ? 'rgba(100,116,139,0.06)' : isMismatch ? 'rgba(234,179,8,0.05)' : isMatched ? 'rgba(34,197,94,0.03)' : isExcelOnly ? 'rgba(239,68,68,0.04)' : 'transparent',
                              height: '42px',
                              cursor: 'pointer'
                            }}
                          >
                            {/* 상태 배지 */}
                            <td style={{ textAlign: 'center', padding: '6px', whiteSpace: 'nowrap' }}>
                              {isExcluded ? (
                                <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, backgroundColor: 'rgba(100,116,139,0.15)', color: '#64748b' }}>
                                  🚫 제외
                                </span>
                              ) : isMatched ? (
                                <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, backgroundColor: 'rgba(34,197,94,0.15)', color: '#16a34a' }}>
                                  🟢 일치
                                </span>
                              ) : isMismatch ? (
                                <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, backgroundColor: 'rgba(234,179,8,0.18)', color: '#a16207' }}>
                                  🟡 차액
                                </span>
                              ) : isExcelOnly ? (
                                <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, backgroundColor: 'rgba(239,68,68,0.15)', color: '#dc2626' }}>
                                  🔴 엑셀
                                </span>
                              ) : (
                                <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: 'var(--bg-body)', color: 'var(--text-muted)' }}>
                                  ⚪ 배차
                                </span>
                              )}
                            </td>

                            {/* [시스템] 일자 */}
                            <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: sys ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                              {sys ? (sys.loadingDate || sys.requestDate) : '(미기재)'}
                            </td>

                            {/* [시스템] 배차 정보 */}
                            <td style={{ padding: '6px 10px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {sys ? (
                                <>
                                  <strong style={{ color: 'var(--text-primary)' }}>{displayCustomer}</strong> | {sys.destinationAddress || '도착지미지정'}
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>({sys.driverName || '기사미배정'})</span>
                                </>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>-</span>
                              )}
                            </td>

                            {/* [시스템] 금액 */}
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 800, color: sys ? 'var(--primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {sys ? `₩${pair.systemCost.toLocaleString()}` : '-'}
                            </td>

                            {/* VS 기호 */}
                            <td style={{ textAlign: 'center', color: isMatched ? '#16a34a' : isMismatch ? '#ca8a04' : 'var(--text-muted)', fontWeight: 800 }}>
                              {isMatched ? '=' : isMismatch ? '≠' : 'VS'}
                            </td>

                            {/* [엑셀] 일자 */}
                            <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: excel ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                              {excel ? (excel['정규일자'] || excel['일자'] || excel['날짜'] || excel['운송일자']) : '(미기재)'}
                            </td>

                            {/* [엑셀] 청구 내역 */}
                            <td style={{ padding: '6px 10px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {excel ? (
                                <>
                                  <strong style={{ color: 'var(--text-primary)' }}>{excel['정규하차지'] || excel['현장명'] || excel['업체명'] || '현장미상'}</strong>
                                  {excel['비고'] && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>[{excel['비고']}]</span>}
                                </>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>-</span>
                              )}
                            </td>

                            {/* [엑셀] 청구액 */}
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 800, color: excel ? (isMismatch ? '#ca8a04' : '#16a34a') : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {excel ? `₩${pair.excelCost.toLocaleString()}` : '-'}
                            </td>

                            {/* 차액 및 할증 분석 */}
                            <td style={{ padding: '6px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              {isMismatch ? (
                                <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#ca8a04' }}>
                                  {pair.diffCost > 0 ? `+₩${pair.diffCost.toLocaleString()}` : `-₩${Math.abs(pair.diffCost).toLocaleString()}`}
                                  {pair.surchargeReason && <span style={{ fontSize: '10.5px', display: 'block', color: '#a16207' }}>({pair.surchargeReason})</span>}
                                </span>
                              ) : isExcelOnly ? (
                                <span style={{ fontSize: '11px', color: '#dc2626' }}>엑셀 단독 청구</span>
                              ) : isSysOnly ? (
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>배차 미청구</span>
                              ) : (
                                <span style={{ fontSize: '11px', color: '#16a34a' }}>₩0 (완전일치)</span>
                              )}
                            </td>

                            {/* 인라인 조치 버튼군 */}
                            <td style={{ padding: '6px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', alignItems: 'center' }}>
                                {isMismatch && (
                                  <button
                                    onClick={() => handleApproveMismatch(pair.pairId)}
                                    title="청구 금액으로 확정하고 대사 완료 처리"
                                    style={{ padding: '3px 8px', fontSize: '11px', fontWeight: 800, borderRadius: '4px', border: '1px solid #ca8a04', backgroundColor: 'rgba(234,179,8,0.15)', color: '#a16207', cursor: 'pointer' }}
                                  >
                                    ₩{pair.excelCost.toLocaleString()} 승인
                                  </button>
                                )}

                                {isExcelOnly && (
                                  <>
                                    <button
                                      onClick={() => handleCreateDeliveryFromExcel(pair.pairId)}
                                      title="이 엑셀 항목으로 신규 배차를 생성하고 대사 완료"
                                      style={{ padding: '3px 6px', fontSize: '10.5px', fontWeight: 700, borderRadius: '4px', border: '1px solid #2563eb', backgroundColor: 'rgba(37,99,235,0.1)', color: '#2563eb', cursor: 'pointer' }}
                                    >
                                      배차생성
                                    </button>
                                    <button
                                      onClick={() => handleExcludeExcelOnly(pair.pairId)}
                                      title="오청구 건으로 판단하여 지급요청 대상에서 제외"
                                      style={{ padding: '3px 6px', fontSize: '10.5px', fontWeight: 700, borderRadius: '4px', border: '1px solid #dc2626', backgroundColor: 'rgba(239,68,68,0.1)', color: '#dc2626', cursor: 'pointer' }}
                                    >
                                      반려제외
                                    </button>
                                  </>
                                )}

                                {isExcluded && (
                                  <button
                                    onClick={() => handleExcludeExcelOnly(pair.pairId)}
                                    style={{ padding: '3px 6px', fontSize: '10.5px', fontWeight: 700, borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                                  >
                                    제외취소
                                  </button>
                                )}

                                {isMatched && (
                                  <button
                                    onClick={() => handleTogglePairReconciled(pair.pairId)}
                                    title="대사 완료 취소 (대기 원복)"
                                    style={{ padding: '3px 6px', fontSize: '10.5px', fontWeight: 700, borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-muted)', cursor: 'pointer' }}
                                  >
                                    취소
                                  </button>
                                )}

                                <button
                                  onClick={() => setSelectedReconDetailPair(pair)}
                                  title="배차 상세 및 대사 검토 모달 열기"
                                  style={{ padding: '3px 6px', fontSize: '10.5px', fontWeight: 700, borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                                >
                                  상세
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ────────────── ④ 우하단 (Terminal Action): 대차대조 합계 검증 및 최종 완결 바 (화면 최하단 고정) ────────────── */}
          <div style={{
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
            backgroundColor: 'var(--bg-card)',
            border: '1.5px solid var(--border-color)',
            borderRadius: '10px',
            padding: '12px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.12)',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            {/* 좌측: 4대 대차대조 검증 합계식 (대사 전/후 분기) */}
            {!reconStats.isPairMode ? (
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12.5px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>배차 운송료 합계:</span>
                  <strong style={{ fontSize: '14px', color: 'var(--primary)' }}>₩{reconStats.totalCost.toLocaleString()}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({reconStats.totalCount}건)</span>
                </div>
                <div style={{ padding: '3px 10px', borderRadius: '4px', backgroundColor: 'rgba(100,116,139,0.1)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '11.5px', fontWeight: 600 }}>
                  대사 대기 (우상단 엑셀 거래명세서 업로드 시 1:1 대사 시작)
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12.5px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>청구총액:</span>
                  <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>₩{reconStats.totalCost.toLocaleString()}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({reconStats.totalCount}건)</span>
                </div>

                <span style={{ color: 'var(--text-muted)' }}>=</span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#16a34a', fontWeight: 700 }}>지급 확정:</span>
                  <strong style={{ fontSize: '14px', color: '#16a34a' }}>₩{reconStats.matchedCost.toLocaleString()}</strong>
                  <span style={{ fontSize: '11px', color: '#16a34a' }}>({reconStats.matchedCount}건)</span>
                </div>

                <span style={{ color: 'var(--text-muted)' }}>+</span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>반려·제외:</span>
                  <strong style={{ fontSize: '13px', color: 'var(--text-muted)' }}>₩{reconStats.excludedCost.toLocaleString()}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({reconStats.excludedCount}건)</span>
                </div>

                {(() => {
                  const balanceDiff = reconStats.totalCost - (reconStats.matchedCost + reconStats.excludedCost);
                  if (balanceDiff === 0) {
                    return (
                      <div style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#16a34a', fontSize: '11px', fontWeight: 800 }}>
                        대차 차액 ₩0 (완전 일치)
                      </div>
                    );
                  }
                  return (
                    <div style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#dc2626', fontSize: '11px', fontWeight: 800 }}>
                      대차 차액 ₩{Math.abs(balanceDiff).toLocaleString()} ({balanceDiff > 0 ? '미확정 잔액' : '초과 확정'})
                    </div>
                  );
                })()}
              </div>
            )}

            {/* 우측: ④ 최종 완결 버튼 (통합 매입 지급요청 생성) */}
            <button
              onClick={handleExecuteBundlePaymentRequest}
              disabled={reconStats.matchedCount === 0}
              style={{
                padding: '10px 22px',
                fontSize: '13.5px',
                fontWeight: 900,
                borderRadius: '8px',
                border: 'none',
                backgroundColor: reconStats.matchedCount > 0 ? '#2563eb' : '#94a3b8',
                color: '#fff',
                cursor: reconStats.matchedCount > 0 ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: reconStats.matchedCount > 0 ? '0 4px 14px rgba(37,99,235,0.35)' : 'none',
                whiteSpace: 'nowrap'
              }}
            >
              <Send size={15} /> 대사 완료 {reconStats.matchedCount}건 통합 지급요청 생성 ➔
            </button>
          </div>

        </div>
      )}

      {/* 수동 배차 모달 */}
      {showManualModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '24px', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 16px 0' }}>🚛 수동 배차 신규 생성</h3>
            
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: 700, marginBottom: '4px', display: 'block' }}>배차 구분의 유형</label>
              <select value={manualCategory} onChange={e => setManualCategory(e.target.value as any)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)' }}>
                <option value="출고">출고</option>
                <option value="입고">입고</option>
                <option value="교환">교환</option>
                <option value="반납">반납</option>
                <option value="정비">정비</option>
                <option value="이동">이동</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 700, marginBottom: '4px', display: 'block' }}>출발지 (상차지)</label>
                <input type="text" value={manualOrigin} onChange={e => setManualOrigin(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 700, marginBottom: '4px', display: 'block' }}>도착지 (하차지)</label>
                <input type="text" value={manualDestination} onChange={e => setManualDestination(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)' }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
              <button onClick={() => setShowManualModal(false)} className="btn-secondary">취소</button>
              <button onClick={handleSaveManualDispatch} className="btn-primary" style={{ fontWeight: 800 }}>배차 생성 저장</button>
            </div>
          </div>
        </div>
      )}

      {/* 💡 [사장님 지시] 배차 운송료 금액 수정 모달 (DB 실시간 동기화) */}
      {showCostEditModal && editingDelivery && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '24px', width: '100%', maxWidth: '420px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '17px', fontWeight: 900, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                💰 배차 운송료 금액 수정
              </h3>
              <button onClick={() => setShowCostEditModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ backgroundColor: 'var(--bg-body)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '16px', fontSize: '12.5px' }}>
              <div style={{ fontWeight: 800, color: 'var(--primary)', marginBottom: '4px' }}>📌 배차ID: {editingDelivery.id}</div>
              <div>📍 하차지: {editingDelivery.destinationAddress || '미지정'}</div>
              <div>🚛 기사명: {editingDelivery.driverName || '미지정'}</div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '13px', fontWeight: 800, marginBottom: '6px', display: 'block', color: 'var(--text-primary)' }}>
                변경할 운송료 금액 (원)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  value={editingCostInput}
                  onChange={e => setEditingCostInput(Number(e.target.value))}
                  placeholder="예: 0"
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 30px',
                    borderRadius: '8px',
                    border: '2px solid var(--primary)',
                    backgroundColor: 'var(--bg-body)',
                    color: 'var(--text-primary)',
                    fontSize: '15px',
                    fontWeight: 900,
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
                <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontWeight: 900, color: 'var(--primary)' }}>₩</span>
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px' }}>
                💡 변경 즉시 원격 DB(Supabase) `deliveries` 테이블의 `deliveryCost`에 저장되고 실시간 반영됩니다.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setShowCostEditModal(false)}
                style={{ padding: '8px 14px', borderRadius: '7px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700, fontSize: '12.5px' }}
              >
                취소
              </button>
              <button
                onClick={handleSaveDeliveryCost}
                style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', backgroundColor: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 900, fontSize: '13px', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}
              >
                💾 DB 금액 수정 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 💡 [사장님 지시] 운송료 대사 상세 및 불일치 검토 모달 (행 더블클릭 시 표출) */}
      {selectedReconDetailPair && (() => {
        const pair = selectedReconDetailPair;
        const sys = pair.systemDelivery;
        const excel = pair.excelRow;
        const contract = sys ? contracts.find(c => c.id === sys.contractId) : null;
        const customer = contract ? customers.find(c => c.id === contract.customerId) : null;
        const site = contract ? sites.find(s => s.id === contract.siteId) : null;
        const memoCustomer = sys?.memo && sys.memo.includes('업체:') ? sys.memo.split('업체:')[1].split('|')[0].trim() : '';
        const displayCustomer = customer?.name || memoCustomer || (excel ? excel['업체명'] : '고객사미지정');

        const isMatched = pair.isReconciled && !pair.isExcluded;
        const isMismatch = pair.matchStatus === 'MISMATCH';
        const isExcelOnly = pair.matchStatus === 'EXCEL_ONLY' && !pair.isExcluded;
        const isSysOnly = pair.matchStatus === 'SYSTEM_ONLY';

        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 99999, padding: '20px'
          }}>
            <div style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '14px',
              padding: '24px',
              width: '100%',
              maxWidth: '840px',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 12px 36px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px'
            }}>
              {/* 모달 헤더 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 900, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    🚚 배차 상세 및 운송료 대사 검토
                  </h3>
                  {isMismatch && (
                    <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 800, backgroundColor: 'rgba(234,179,8,0.18)', color: '#ca8a04' }}>
                      🟡 차액 불일치 ({pair.diffCost > 0 ? `+₩${pair.diffCost.toLocaleString()}` : `-₩${Math.abs(pair.diffCost).toLocaleString()}`})
                    </span>
                  )}
                  {isMatched && (
                    <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 800, backgroundColor: 'rgba(34,197,94,0.15)', color: '#16a34a' }}>
                      🟢 대사 일치 (₩0 완전일치)
                    </span>
                  )}
                  {isExcelOnly && (
                    <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 800, backgroundColor: 'rgba(239,68,68,0.15)', color: '#dc2626' }}>
                      🔴 엑셀 단독 청구 (배차 미발견)
                    </span>
                  )}
                  {isSysOnly && (
                    <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 800, backgroundColor: 'var(--bg-body)', color: 'var(--text-muted)' }}>
                      ⚪ 시스템 배차 단독 (청구 미도착)
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setSelectedReconDetailPair(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer', padding: '4px' }}
                >
                  ✕
                </button>
              </div>

              {/* 상단 대차대조 비교 바 */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                gap: '12px',
                alignItems: 'center',
                backgroundColor: 'var(--bg-body)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                padding: '14px 20px'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}>시스템 등록 배차 금액</span>
                  <span style={{ fontSize: '20px', fontWeight: 900, color: sys ? 'var(--primary)' : 'var(--text-muted)' }}>
                    {sys ? `₩${pair.systemCost.toLocaleString()}원` : '배차 없음'}
                  </span>
                </div>
                <div style={{ textAlign: 'center', padding: '0 16px' }}>
                  <span style={{ fontSize: '16px', fontWeight: 900, color: isMatched ? '#16a34a' : isMismatch ? '#ca8a04' : 'var(--text-muted)' }}>
                    {isMatched ? '=' : isMismatch ? '≠' : 'VS'}
                  </span>
                  {isMismatch && (
                    <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#ca8a04', marginTop: '2px' }}>
                      차액: {pair.diffCost > 0 ? `+₩${pair.diffCost.toLocaleString()}` : `-₩${Math.abs(pair.diffCost).toLocaleString()}`}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'right' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700 }}>운송사 엑셀 청구 운송비</span>
                  <span style={{ fontSize: '20px', fontWeight: 900, color: excel ? (isMismatch ? '#ca8a04' : '#16a34a') : 'var(--text-muted)' }}>
                    {excel ? `₩${pair.excelCost.toLocaleString()}원` : '청구 없음'}
                  </span>
                </div>
              </div>

              {pair.surchargeReason && (
                <div style={{
                  padding: '8px 14px',
                  backgroundColor: 'rgba(234,179,8,0.1)',
                  border: '1px solid rgba(234,179,8,0.3)',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  color: '#a16207',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <span>💡</span>
                  <span>할증 및 차액 사유 분석: <strong>{pair.surchargeReason}</strong></span>
                </div>
              )}

              {/* 2열 비교 본문 (좌측: 시스템 배차 원장 / 우측: 운송사 엑셀 청구 내역) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {/* 좌측: 시스템 배차 내역 */}
                <div style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '16px',
                  backgroundColor: 'var(--bg-body)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                    📋 시스템 배차 원장
                  </div>
                  {sys ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>배차 번호 / ID</span>
                        <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{sys.id}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>배차 일자</span>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          {sys.loadingDate || sys.requestDate} {sys.loadingTimeSlot ? `(${sys.loadingTimeSlot})` : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>배차 구분 / 상태</span>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          {sys.type === 'OUTBOUND' ? '출고' : sys.type === 'INBOUND' ? '회수' : sys.type === 'EXCHANGE' ? '교환' : sys.type} ({sys.status === 'DELIVERED' ? '운송완료' : sys.status})
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>고객사 (거래처)</span>
                        <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{displayCustomer}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>현장명</span>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{site?.name || sys.destinationAddress || '-'}</span>
                      </div>
                      <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '6px' }}>
                        <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>상차지 (출발)</div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{sys.originAddress || '본사 주기장'}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>하차지 (도착)</div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{sys.destinationAddress || '-'}</div>
                      </div>
                      {sys.viaDropoffAddress && (
                        <div>
                          <div style={{ color: '#a16207', fontWeight: 600, marginBottom: '2px' }}>경유지</div>
                          <div style={{ fontWeight: 700, color: '#ca8a04' }}>{sys.viaDropoffAddress} {sys.viaDropoffName ? `(${sys.viaDropoffName})` : ''}</div>
                        </div>
                      )}
                      <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '6px', display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>배정 기사 / 차량</span>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          {sys.driverName || '기사미배정'} {sys.driverContact ? `(${sys.driverContact})` : ''} | {sys.vehicleNo || '-'} ({sys.vehicleType || '-'})
                        </span>
                      </div>
                      {sys.memo && (
                        <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '6px' }}>
                          <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>배차 메모</div>
                          <div style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{sys.memo}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      시스템에 일치하는 배차 내역이 없습니다. (엑셀 단독 청구)
                    </div>
                  )}
                </div>

                {/* 우측: 운송사 엑셀 청구 내역 */}
                <div style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  padding: '16px',
                  backgroundColor: 'var(--bg-body)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{ fontSize: '14px', fontWeight: 900, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                    📄 운송사 엑셀 거래명세서 내역
                  </div>
                  {excel ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>명세서 일자</span>
                        <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                          {excel['정규일자'] || excel['일자'] || excel['날짜'] || excel['운송일자'] || '-'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>청구 업체명</span>
                        <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{excel['업체명'] || '-'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>청구 현장명</span>
                        <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{excel['현장명'] || '-'}</span>
                      </div>
                      <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '6px' }}>
                        <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>상차지 (출발)</div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{excel['상차지'] || '-'}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>하차지 (도착)</div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{excel['정규하차지'] || excel['하차지'] || '-'}</div>
                      </div>
                      <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '6px', display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>톤수 / 차종</span>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{excel['톤수'] || excel['차종'] || '-'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>엑셀 기재 운송비</span>
                        <span style={{ fontWeight: 900, color: '#16a34a', fontSize: '14px' }}>₩{pair.excelCost.toLocaleString()}원</span>
                      </div>
                      {excel['비고'] && (
                        <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '6px' }}>
                          <div style={{ color: '#ca8a04', fontWeight: 700, marginBottom: '2px' }}>명세서 비고 / 특이사항</div>
                          <div style={{ fontWeight: 700, color: '#a16207', backgroundColor: 'rgba(234,179,8,0.1)', padding: '6px 8px', borderRadius: '4px' }}>
                            {excel['비고']}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                      운송사 엑셀에 해당 건의 청구 내역이 없습니다. (배차 단독)
                    </div>
                  )}
                </div>
              </div>

              {/* 하단 액션 버튼군 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
                <button
                  onClick={() => setSelectedReconDetailPair(null)}
                  style={{
                    padding: '9px 18px',
                    borderRadius: '7px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-body)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: '13px'
                  }}
                >
                  닫기
                </button>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {isMismatch && (
                    <>
                      <button
                        onClick={async () => {
                          await handleApproveMismatch(pair.pairId);
                          setSelectedReconDetailPair(null);
                        }}
                        style={{
                          padding: '9px 18px',
                          borderRadius: '7px',
                          border: 'none',
                          backgroundColor: '#ca8a04',
                          color: '#fff',
                          cursor: 'pointer',
                          fontWeight: 800,
                          fontSize: '13px',
                          boxShadow: '0 2px 8px rgba(202,138,4,0.3)'
                        }}
                      >
                        ⚡ 엑셀 청구액 ₩{pair.excelCost.toLocaleString()} 승인 (대사 완료)
                      </button>
                    </>
                  )}

                  {isExcelOnly && (
                    <>
                      <button
                        onClick={async () => {
                          await handleCreateDeliveryFromExcel(pair.pairId);
                          setSelectedReconDetailPair(null);
                        }}
                        style={{
                          padding: '9px 16px',
                          borderRadius: '7px',
                          border: 'none',
                          backgroundColor: '#2563eb',
                          color: '#fff',
                          cursor: 'pointer',
                          fontWeight: 800,
                          fontSize: '13px'
                        }}
                      >
                        ➕ 이 내역으로 신규 배차 생성
                      </button>
                      <button
                        onClick={() => {
                          handleExcludeExcelOnly(pair.pairId);
                          setSelectedReconDetailPair(null);
                        }}
                        style={{
                          padding: '9px 16px',
                          borderRadius: '7px',
                          border: '1px solid #dc2626',
                          backgroundColor: 'rgba(239,68,68,0.1)',
                          color: '#dc2626',
                          cursor: 'pointer',
                          fontWeight: 800,
                          fontSize: '13px'
                        }}
                      >
                        🚫 오청구 반려 및 제외
                      </button>
                    </>
                  )}

                  {isMatched && (
                    <button
                      onClick={() => {
                        handleTogglePairReconciled(pair.pairId);
                        setSelectedReconDetailPair(null);
                      }}
                      style={{
                        padding: '9px 16px',
                        borderRadius: '7px',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--bg-body)',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontWeight: 700,
                        fontSize: '13px'
                      }}
                    >
                      대사 완료 취소 (대기 원복)
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ☀️ 운송 하차지 실시간 날씨 및 주간 예보 모달 */}
      <DestinationWeatherModal
        isOpen={showDestWeatherModal}
        onClose={() => setShowDestWeatherModal(false)}
        customerName={destWeatherParams.customerName}
        siteName={destWeatherParams.siteName}
        rawAddress={destWeatherParams.rawAddress}
      />
    </div>
  );
};
