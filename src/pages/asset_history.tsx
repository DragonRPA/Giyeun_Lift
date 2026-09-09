// src/pages/asset_history.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Search, Download, Calendar, Layers, Wrench, ArrowUpRight, ArrowDownLeft, 
  CheckCircle2, RotateCcw, AlertTriangle, ShieldCheck, Camera, FileText, 
  X, ChevronRight, User, DollarSign, Package, ExternalLink, MapPin, Building2, 
  Check, Clock, Eye
} from 'lucide-react';
import { exportToExcel } from '../services/excel';
import { InboundDefectDetail, formatContractEndDate, Repair } from '../services/db';
import { compressImageFile } from '../utils/imageCompressor';
import { uploadToSupabaseStorage } from '../services/supabaseStorage';
import { resolveSiteDetailedAddress } from '../utils/nativeLauncher';

// 🌟 [통합 정비 이력 레코드 인터페이스]
export interface UnifiedRepairRecord {
  id: string;                      // 고유 ID
  sourceTable: 'REPAIRS' | 'ASSET_LOGS';
  ticketNo?: string;               // 티켓/접수번호 (예: AS-260902-001, REP-260902-001, BAND-0042)
  eventDate: string;               // 정비일자 (YYYY-MM-DD)
  assetId: string;
  assetNo: string;
  modelName: string;               // 정밀 보정된 세부 기종 모델명 (GS-1930, SJ-3219 등)
  workCategory: 'FIELD_AS' | 'YARD_INTERNAL' | 'PREVENTIVE' | 'EXTERNAL_VENDOR';
  categoryLabel: string;           // '외근 현장AS' | '내근 주기장정비' | '외주 위탁정비' | '정기 예방점검'
  status: string;                  // 'COMPLETED' | 'IN_PROGRESS' | 'REQUESTED' | 'REVISIT' | 'GUIDED' | 'CANCELED'
  statusLabel: string;             // '완료' | '진행중' | '접수' | '재방문요구' | '안내종결' | '취소'
  customerId?: string;
  customerName: string;            // 거래처(고객사)명
  siteId?: string;
  siteName: string;                // 현장명
  siteAddress: string;             // 도로명 상세 주소
  locationDetail?: string;         // 현장 상세 위치
  isYardInternal: boolean;         // 자사 주기장 자체 정비 여부
  issueCategory?: string;          // 고장 카테고리
  issueDescription?: string;       // 고장 증상 원문
  actionTaken?: string;            // 조치 사항
  summaryAction: string;           // 고장 및 조치 요약
  memo?: string;                   // 비고 / 메모
  mechanicName: string;            // 담당 정비사 또는 외주업체명
  billableType: 'FREE' | 'BILLABLE';
  billableAmount: number;          // 유상 청구액
  totalCost: number;               // 외주 또는 자체 소요 비용
  isWaived?: boolean;              // 영업 면제 여부
  waivedAmount?: number;           // 면제 금액
  waivedReason?: string;           // 면제 사유
  partsUsed: { modelName: string; quantity: number; unitPrice?: number; totalPrice?: number }[];
  partsTotalCost: number;          // 투입 부품 총액
  collectedParts?: { partName: string; quantity: number; status: string }[];
  degradationScore?: number;       // 자산 노후도/정비점수
  evidenceImages?: string[];       // 첨부 증빙 사진들
  beforeImage?: string;            // 정비 전 사진
  afterImage?: string;             // 정비 후 사진
  customerSignature?: string;      // 고객 확인 서명 이미지
  customerConfirmName?: string;    // 확인자 성명
  rawRepair?: Repair;              // 원본 repair 레코드
}

export const AssetHistory: React.FC = () => {
  const { 
    assetInOutLogs, assets, customers, sites, contractAssets, contracts, repairs, repairConsumables, consumables, 
    users, vendors, navigationPayload, setNavigationPayload,
    inspectionChecklistItems, registerInboundAsset, cancelInboundAsset, fullRefreshFromServer, googleConfigs, showErrorModal
  } = useApp();

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 1. 탭 상태: 'INBOUND_REGISTER' | 'INBOUND' | 'OUTBOUND' | 'REPAIR'
  const [activeTab, setActiveTab] = useState<'INBOUND_REGISTER' | 'INBOUND' | 'OUTBOUND' | 'REPAIR'>('INBOUND_REGISTER');

  const getTodayStr = () => new Date().toISOString().split('T')[0];
  const todayStr = getTodayStr();

  // 2. 검색 및 조회기간 입력 상태 (사용자 조작용)
  const [inputStartDate, setInputStartDate] = useState('');
  const [inputEndDate, setInputEndDate] = useState(todayStr);
  const [inputSearchTerm, setInputSearchTerm] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');

  // 3. 확정 조회 조건 (명시적 [조회] 버튼 클릭 시에만 갱신)
  const [activeSearchParams, setActiveSearchParams] = useState({
    startDate: '',
    endDate: todayStr,
    searchTerm: ''
  });

  // 4. 정비 이력 서브 필터 (정비 구분, 처리 상태, 청구 구분)
  const [repairCategoryFilter, setRepairCategoryFilter] = useState<'ALL' | 'FIELD_AS' | 'YARD_INTERNAL' | 'EXTERNAL_VENDOR' | 'PREVENTIVE'>('ALL');
  const [repairStatusFilter, setRepairStatusFilter] = useState<'ALL' | 'COMPLETED' | 'IN_PROGRESS' | 'REVISIT'>('ALL');
  const [repairBillableFilter, setRepairBillableFilter] = useState<'ALL' | 'BILLABLE' | 'FREE' | 'EXTERNAL_COST'>('ALL');

  // 5. 360도 정비 상세 Dossier 모달 상태
  const [selectedDetailRecord, setSelectedDetailRecord] = useState<UnifiedRepairRecord | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);

  // 💡 [입고 등록 폼 상태] (수동 점수 입력 제거 ➔ 정비 필요 항목 체크박스 선택 연동 + 사진 첨부)
  const [inboundAssetNoInput, setInboundAssetNoInput] = useState('');
  const [selectedInboundAssetId, setSelectedInboundAssetId] = useState('');
  const [inboundDate, setInboundDate] = useState(todayStr);
  const [selectedChecklistIds, setSelectedChecklistIds] = useState<string[]>([]);
  const [defectPhotos, setDefectPhotos] = useState<Record<string, string>>({}); // { checkitemId: photoUrlBase64 }
  const [inboundMemo, setInboundMemo] = useState('');
  const [isSubmittingInbound, setIsSubmittingInbound] = useState(false);

  // 💡 [사장님 지시] 사전 정의 정비 필요 항목 점수 100% 자동 합산 (수동 입력 휴먼에러 전면 제거)
  const selectedChecklistObjects = inspectionChecklistItems.filter(item => selectedChecklistIds.includes(item.id));
  const calculatedInboundScore = selectedChecklistObjects.reduce((sum, item) => sum + item.score, 0);
  const selectedChecklistSummary = selectedChecklistObjects.map(item => `${item.name}(+${item.score}점)`).join(', ');
  // 💡 [입고 취소 롤백] 전용 모달 상태 (window.prompt 퇴출)
  const [cancelModal, setCancelModal] = useState<{ isOpen: boolean; log: any; reason: string } | null>(null);

  // 💡 모바일 카메라 촬영 앱 전환 후 복귀 시 자동 복원 (SessionStorage Auto Recovery)
  useEffect(() => {
    try {
      const savedAssetNo = sessionStorage.getItem('inbound_draft_assetNo');
      const savedChecklist = sessionStorage.getItem('inbound_draft_checklist');
      const savedMemo = sessionStorage.getItem('inbound_draft_memo');
      const savedPhotos = sessionStorage.getItem('inbound_draft_photos');

      if (savedAssetNo) setInboundAssetNoInput(savedAssetNo);
      if (savedChecklist) setSelectedChecklistIds(JSON.parse(savedChecklist));
      if (savedMemo) setInboundMemo(savedMemo);
      if (savedPhotos) setDefectPhotos(JSON.parse(savedPhotos));
    } catch (e) {}
  }, []);

  // 💡 [사진 업로드 처리] (모바일 고해상도 카메라 10MB+ ➔ 100KB 경량화 압축)
  const handlePhotoFileChange = async (itemId: string, file: File | null) => {
    if (!file) return;
    try {
      const compressedDataUrl = await compressImageFile(file);
      if (compressedDataUrl) {
        setDefectPhotos(prev => ({ ...prev, [itemId]: compressedDataUrl }));
      }
    } catch (err: any) {
      const msg = err?.message || '사진 처리 중 오류가 발생했습니다.';
      showErrorModal(msg);
    }
  };

  // 0. 타 탭 이동 페이로드(특정 자산 이력 조회) 감지
  useEffect(() => {
    if (navigationPayload && navigationPayload.assetId) {
      setSelectedAssetId(navigationPayload.assetId);
      setNavigationPayload(null); // 페이로드 소비 후 소멸
    }
  }, [navigationPayload]);

  // 💡 명시적 [조회] 버튼 실행 헬퍼 (Supabase 클라우드 원격 DB 동기화 연동)
  const handleSearch = async (overrideStart?: string, overrideEnd?: string) => {
    if (fullRefreshFromServer) {
      try { await fullRefreshFromServer(); } catch (e) {}
    }
    setActiveSearchParams({
      startDate: overrideStart !== undefined ? overrideStart : inputStartDate,
      endDate: overrideEnd !== undefined ? overrideEnd : inputEndDate,
      searchTerm: inputSearchTerm
    });
  };

  // 💡 기간 빠른 선택 (오늘 / 1주 / 1개월 / 전체)
  const setQuickRange = (rangeType: 'TODAY' | 'WEEK' | 'MONTH' | 'ALL') => {
    const today = new Date();
    let newStart = '';
    let newEnd = todayStr;

    if (rangeType === 'TODAY') {
      newStart = todayStr;
    } else if (rangeType === 'WEEK') {
      const pastWeek = new Date(today);
      pastWeek.setDate(today.getDate() - 7);
      newStart = pastWeek.toISOString().split('T')[0];
    } else if (rangeType === 'MONTH') {
      const pastMonth = new Date(today);
      pastMonth.setMonth(today.getMonth() - 1);
      newStart = pastMonth.toISOString().split('T')[0];
    } else if (rangeType === 'ALL') {
      newStart = '';
    }

    setInputStartDate(newStart);
    setInputEndDate(newEnd);
    handleSearch(newStart, newEnd);
  };

  // =========================================================================
  // 🌟 [핵심 엔진 1: 정밀 모델명 보정 엔진 (100% Precision Matcher)]
  // =========================================================================
  const resolvePrecisionModelName = (assetId?: string, assetNo?: string, rawModel?: string): string => {
    // 1. assets 마스터 데이터 교차 검증 (자산 식별자 1:1 매칭)
    const matchedAsset = assets.find(a => 
      (assetId && a.id === assetId) || 
      (assetNo && a.assetNo && a.assetNo.trim().toLowerCase() === assetNo.trim().toLowerCase())
    );
    if (matchedAsset?.modelName && matchedAsset.modelName !== '고소작업대' && matchedAsset.modelName !== '전체장비') {
      return matchedAsset.modelName;
    }

    // 2. rawModel 검사 (이미 구체적 세부 기종인 경우)
    if (rawModel && rawModel !== '고소작업대' && rawModel !== '전체장비' && rawModel !== '기종확인필요' && rawModel !== '미지정') {
      return rawModel;
    }

    // 3. 자산번호 패턴 기반 세부 기종 정밀 추론
    if (assetNo) {
      const u = assetNo.toUpperCase().trim();
      if (u.startsWith('G19') || u.startsWith('GS19') || u.includes('1930')) return 'GS-1930';
      if (u.startsWith('S32') || u.startsWith('SJ32') || u.includes('3219')) return 'SJ-3219';
      if (u.startsWith('G26') || u.startsWith('GS26') || u.includes('2646')) return 'GS-2646';
      if (u.startsWith('S46') || u.startsWith('SJ46') || u.includes('4626')) return 'SJ-4626';
      if (u.startsWith('G32') || u.startsWith('GS32') || u.includes('3246')) return 'GS-3246';
      if (u.startsWith('Z34') || u.includes('3422')) return 'Z-34/22N';
      if (u.startsWith('Z45') || u.includes('4525')) return 'Z-45/25J';
      if (u.startsWith('S40') || u.startsWith('S-40')) return 'S-40';
      if (u.startsWith('S60') || u.startsWith('S-60')) return 'S-60';
    }

    return matchedAsset?.modelName || 'GS-1930';
  };

  // =========================================================================
  // 🌟 [핵심 엔진 2: 고객사 / 현장명 / 상세 주소 100% 역추적 엔진]
  // =========================================================================
  const resolveRepairCustomerAndSite = (params: {
    assetId?: string;
    assetNo?: string;
    customerId?: string;
    customerName?: string;
    siteId?: string;
    siteName?: string;
    siteAddress?: string;
    locationDetail?: string;
    contractId?: string;
    workCategory?: string;
    workLocation?: string;
  }): { customerName: string; siteName: string; siteAddress: string; isYardInternal: boolean } => {
    let custName = params.customerName?.trim() || '';
    let stName = params.siteName?.trim() || '';
    let stAddress = params.siteAddress?.trim() || '';

    const isInvalidSite = !stName || stName === '미지정현장' || stName === '미지정' || stName === '-' || stName === '현장확인';
    const isInvalidCust = !custName || custName === '고객사' || custName === '-' || custName === '현장 협력업체' || custName === '미지정';

    // 1. siteId 마스터 매핑
    if (params.siteId) {
      const siteObj = sites.find(s => s.id === params.siteId);
      if (siteObj) {
        if (isInvalidSite) stName = siteObj.name;
        if (!stAddress) stAddress = siteObj.address || '';
        if (isInvalidCust && siteObj.customerId) {
          const custObj = customers.find(c => c.id === siteObj.customerId);
          if (custObj) custName = custObj.name;
        }
      }
    }

    // 2. customerId 마스터 매핑
    if (params.customerId && isInvalidCust) {
      const custObj = customers.find(c => c.id === params.customerId);
      if (custObj) custName = custObj.name;
    }

    // 3. 자산 식별자(assetId/assetNo) 기준 대여 계약 역추적
    if ((isInvalidSite || isInvalidCust) && (params.assetId || params.assetNo)) {
      const targetAsset = assets.find(a => 
        (params.assetId && a.id === params.assetId) || 
        (params.assetNo && a.assetNo && a.assetNo.trim().toLowerCase() === params.assetNo.trim().toLowerCase())
      );
      if (targetAsset) {
        const relatedCAs = contractAssets.filter(ca => ca.assetId === targetAsset.id);
        if (relatedCAs.length > 0) {
          let ca = relatedCAs.find(c => c.status === 'RENTED');
          if (!ca) ca = relatedCAs[relatedCAs.length - 1]; // 최신 계약
          if (ca) {
            const cont = contracts.find(c => c.id === ca.contractId);
            if (cont) {
              if (isInvalidCust && cont.customerId) {
                const cust = customers.find(c => c.id === cont.customerId);
                if (cust) custName = cust.name;
              }
              if (isInvalidSite && cont.siteId) {
                const s = sites.find(item => item.id === cont.siteId);
                if (s) {
                  stName = s.name;
                  if (!stAddress) stAddress = s.address || '';
                }
              }
            }
          }
        }
      }
    }

    // 4. resolveSiteDetailedAddress 다단계 주소 역추적
    if (!stAddress) {
      stAddress = resolveSiteDetailedAddress({
        siteAddress: params.siteAddress,
        siteId: params.siteId,
        siteName: !isInvalidSite ? stName : undefined,
        contractId: params.contractId,
        assetNo: params.assetNo,
        assetId: params.assetId,
        customerName: !isInvalidCust ? custName : undefined,
        locationDetail: params.locationDetail,
        customerSites: sites,
        contracts,
        contractAssets,
        customers
      });
    }

    // 5. 내근 주기장 정비 판정
    const isYard = params.workLocation === 'YARD' || 
                   params.workCategory === 'YARD_INTERNAL' || 
                   (isInvalidCust && isInvalidSite);

    if (isYard) {
      if (isInvalidCust) custName = '기연리프트 본사';
      if (isInvalidSite) stName = '자사 주기장 (입고/사내정비)';
      if (!stAddress || stAddress === '현장') stAddress = '경기도 화성시 / 용인 본사 주기장';
    } else {
      if (isInvalidCust) custName = '현장 거래처 (계약참조)';
      if (isInvalidSite) stName = '공사현장 (주소확인)';
    }

    return { customerName: custName, siteName: stName, siteAddress: stAddress, isYardInternal: isYard };
  };

  // =========================================================================
  // 🌟 [핵심 엔진 3: 다채널 정비 데이터 통합 파이프라인 (Unified Repair Pipeline)]
  // =========================================================================
  const unifiedRepairRecords = useMemo<UnifiedRepairRecord[]>(() => {
    const list: UnifiedRepairRecord[] = [];
    const seenRepairIds = new Set<string>();

    // 1차 원천: repairs 테이블 (현장AS + 주기장정비 + 외주정비 + 예방정비)
    repairs.forEach(rep => {
      seenRepairIds.add(rep.id);

      // 모델명 정밀 보정
      const precisionModel = resolvePrecisionModelName(rep.assetId, rep.assetNo, rep.modelName);

      // 고객사 및 현장명 정밀 보정
      const { customerName, siteName, siteAddress, isYardInternal } = resolveRepairCustomerAndSite({
        assetId: rep.assetId,
        assetNo: rep.assetNo,
        customerId: rep.customerId,
        customerName: rep.customerName,
        siteId: rep.siteId,
        siteName: rep.siteName,
        siteAddress: rep.siteAddress,
        locationDetail: rep.locationDetail,
        contractId: rep.contractId,
        workCategory: rep.workCategory,
        workLocation: rep.workLocation
      });

      // 업무 카테고리 정규화
      let workCat: 'FIELD_AS' | 'YARD_INTERNAL' | 'PREVENTIVE' | 'EXTERNAL_VENDOR' = 'FIELD_AS';
      let catLabel = '외근 현장AS';
      if (rep.repairType === 'EXTERNAL' || rep.workCategory === 'EXTERNAL_VENDOR' || rep.vendorId) {
        workCat = 'EXTERNAL_VENDOR';
        catLabel = '외주 위탁정비';
      } else if (rep.workCategory === 'PREVENTIVE' || rep.maintenanceType === 'PREVENTIVE') {
        workCat = 'PREVENTIVE';
        catLabel = '정기 예방점검';
      } else if (rep.workCategory === 'YARD_INTERNAL' || rep.maintenanceType === 'INHOUSE_REPAIR' || rep.workLocation === 'YARD') {
        workCat = 'YARD_INTERNAL';
        catLabel = '내근 주기장정비';
      }

      // 상태 라벨
      let stLabel = '진행중';
      if (rep.status === 'COMPLETED') stLabel = '완료';
      else if (rep.status === 'REQUESTED') stLabel = '접수';
      else if (rep.status === 'REVISIT') stLabel = '재방문요구';
      else if (rep.status === 'GUIDED') stLabel = '안내종결';
      else if (rep.status === 'CANCELED') stLabel = '취소';

      // 정비자 성명
      let mechName = rep.mechanicName || '';
      if (!mechName && rep.mechanicId) {
        mechName = users.find(u => u.id === rep.mechanicId)?.name || '';
      }
      if (!mechName && rep.vendorId) {
        mechName = vendors.find(v => v.id === rep.vendorId)?.name || '외주정비업체';
      }
      if (!mechName) mechName = isYardInternal ? '본사 정비팀' : '현장 정비사';

      // 투입 소모품 집계
      const parts: { modelName: string; quantity: number; unitPrice?: number; totalPrice?: number }[] = [];
      let partsTotal = 0;

      // 1) repairConsumables 매핑
      const rcItems = repairConsumables.filter(rc => rc.repairId === rep.id);
      rcItems.forEach(rc => {
        const cItem = consumables.find(c => c.id === rc.consumableId);
        const name = cItem?.modelName || '소모품';
        const total = rc.cost || (rc.quantity * (rc.unitPrice || 0));
        parts.push({ modelName: name, quantity: rc.quantity, unitPrice: rc.unitPrice, totalPrice: total });
        partsTotal += total;
      });

      // 2) rep.partsUsed 매핑 (rcItems 없을 때)
      if (parts.length === 0 && rep.partsUsed && rep.partsUsed.length > 0) {
        rep.partsUsed.forEach(p => {
          const total = (p.quantity || 1) * (p.unitPrice || 0);
          parts.push({ modelName: p.modelName, quantity: p.quantity || 1, unitPrice: p.unitPrice, totalPrice: total });
          partsTotal += total;
        });
      }

      // 고장 증상 및 조치 요약
      const issue = rep.issueDescription || rep.details || '';
      const action = rep.actionTaken || '';
      let summary = '';
      if (issue && action) summary = `[증상] ${issue.slice(0, 30)} ➔ [조치] ${action.slice(0, 35)}`;
      else if (action) summary = action;
      else if (issue) summary = issue;
      else summary = rep.memo || '정비 작업 완료';

      const dateStr = rep.repairDate || rep.visitDate || rep.requestDate || rep.createdAt.split('T')[0];

      list.push({
        id: rep.id,
        sourceTable: 'REPAIRS',
        ticketNo: rep.ticketNo || `REP-${rep.id.slice(0, 8)}`,
        eventDate: dateStr,
        assetId: rep.assetId || '',
        assetNo: rep.assetNo || '관리번호확인',
        modelName: precisionModel,
        workCategory: workCat,
        categoryLabel: catLabel,
        status: rep.status,
        statusLabel: stLabel,
        customerId: rep.customerId,
        customerName,
        siteId: rep.siteId,
        siteName,
        siteAddress,
        locationDetail: rep.locationDetail,
        isYardInternal,
        issueCategory: rep.issueCategory,
        issueDescription: issue,
        actionTaken: action,
        summaryAction: summary,
        memo: rep.memo,
        mechanicName: mechName,
        billableType: rep.billableType || (rep.billableAmount && rep.billableAmount > 0 ? 'BILLABLE' : 'FREE'),
        billableAmount: rep.billableAmount || 0,
        totalCost: rep.totalCost || 0,
        isWaived: rep.isWaived,
        waivedAmount: rep.waivedAmount,
        waivedReason: rep.waivedReason,
        partsUsed: parts,
        partsTotalCost: partsTotal,
        collectedParts: rep.collectedParts,
        degradationScore: rep.degradationScore,
        evidenceImages: rep.evidenceImages,
        beforeImage: rep.beforeImage,
        afterImage: rep.afterImage,
        customerSignature: rep.customerSignature,
        customerConfirmName: rep.customerConfirmName,
        rawRepair: rep
      });
    });

    // 2차 원천: assetInOutLogs 중 type === 'REPAIR' (과거 밴드 임포트 및 독립 레코드 보완)
    assetInOutLogs.filter(l => l.type === 'REPAIR').forEach(log => {
      if (log.repairId && seenRepairIds.has(log.repairId)) return;
      if (seenRepairIds.has(log.id)) return;

      const precisionModel = resolvePrecisionModelName(log.assetId, log.assetNo, log.modelName);
      const { customerName, siteName, siteAddress, isYardInternal } = resolveRepairCustomerAndSite({
        assetId: log.assetId,
        assetNo: log.assetNo,
        customerId: log.customerId,
        customerName: log.customerName,
        siteId: log.siteId,
        siteName: log.siteName,
        workCategory: log.memo?.includes('현장AS') ? 'FIELD_AS' : 'YARD_INTERNAL'
      });

      const isFieldAs = log.memo?.includes('현장AS') || (!isYardInternal && customerName !== '기연리프트 본사');
      const workCat = isFieldAs ? 'FIELD_AS' : 'YARD_INTERNAL';
      const catLabel = isFieldAs ? '외근 현장AS' : '내근 주기장정비';

      list.push({
        id: log.id,
        sourceTable: 'ASSET_LOGS',
        ticketNo: log.inboundNo || `LOG-${log.id.slice(0, 8)}`,
        eventDate: log.eventDate,
        assetId: log.assetId,
        assetNo: log.assetNo,
        modelName: precisionModel,
        workCategory: workCat,
        categoryLabel: catLabel,
        status: 'COMPLETED',
        statusLabel: '완료',
        customerId: log.customerId,
        customerName,
        siteId: log.siteId,
        siteName,
        siteAddress,
        isYardInternal,
        summaryAction: log.memo || '과거 정비 이력 로그',
        memo: log.memo,
        mechanicName: isFieldAs ? '현장 정비사' : '본사 정비팀',
        billableType: 'FREE',
        billableAmount: 0,
        totalCost: 0,
        partsUsed: [],
        partsTotalCost: 0,
        degradationScore: log.maintenanceScore
      });
    });

    // 정비일자 내림차순 정렬 (최신순)
    return list.sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());
  }, [repairs, assetInOutLogs, assets, customers, sites, contractAssets, contracts, repairConsumables, consumables, users, vendors]);

  // 💡 정비 이력 필터링 결과
  const filteredRepairRecords = useMemo(() => {
    return unifiedRepairRecords.filter(item => {
      if (item.eventDate > todayStr) return false;
      if (selectedAssetId && item.assetId !== selectedAssetId) return false;
      if (activeSearchParams.startDate && item.eventDate < activeSearchParams.startDate) return false;
      if (activeSearchParams.endDate && item.eventDate > activeSearchParams.endDate) return false;

      if (repairCategoryFilter !== 'ALL' && item.workCategory !== repairCategoryFilter) return false;

      if (repairStatusFilter !== 'ALL') {
        if (repairStatusFilter === 'COMPLETED' && item.status !== 'COMPLETED') return false;
        if (repairStatusFilter === 'IN_PROGRESS' && item.status !== 'IN_PROGRESS' && item.status !== 'REQUESTED') return false;
        if (repairStatusFilter === 'REVISIT' && item.status !== 'REVISIT') return false;
      }

      if (repairBillableFilter !== 'ALL') {
        if (repairBillableFilter === 'BILLABLE' && (item.billableType !== 'BILLABLE' || item.billableAmount <= 0)) return false;
        if (repairBillableFilter === 'FREE' && item.billableType === 'BILLABLE' && item.billableAmount > 0) return false;
        if (repairBillableFilter === 'EXTERNAL_COST' && item.totalCost <= 0) return false;
      }

      if (activeSearchParams.searchTerm.trim()) {
        const rawTerm = activeSearchParams.searchTerm.toLowerCase();
        const cleanTerm = rawTerm.replace(/[\s\-_/]/g, '');

        const mAssetNo = item.assetNo.toLowerCase().includes(rawTerm) || (cleanTerm && item.assetNo.toLowerCase().replace(/[\s\-_/]/g, '').includes(cleanTerm));
        const mModel = item.modelName.toLowerCase().includes(rawTerm) || (cleanTerm && item.modelName.toLowerCase().replace(/[\s\-_/]/g, '').includes(cleanTerm));
        const mCust = item.customerName.toLowerCase().includes(rawTerm) || (cleanTerm && item.customerName.toLowerCase().replace(/[\s\-_/]/g, '').includes(cleanTerm));
        const mSite = item.siteName.toLowerCase().includes(rawTerm) || (cleanTerm && item.siteName.toLowerCase().replace(/[\s\-_/]/g, '').includes(cleanTerm));
        const mAddr = item.siteAddress.toLowerCase().includes(rawTerm) || (cleanTerm && item.siteAddress.toLowerCase().replace(/[\s\-_/]/g, '').includes(cleanTerm));
        const mAction = item.summaryAction.toLowerCase().includes(rawTerm) || (cleanTerm && item.summaryAction.toLowerCase().replace(/[\s\-_/]/g, '').includes(cleanTerm));
        const mMech = item.mechanicName.toLowerCase().includes(rawTerm) || (cleanTerm && item.mechanicName.toLowerCase().replace(/[\s\-_/]/g, '').includes(cleanTerm));
        const mTicket = (item.ticketNo || '').toLowerCase().includes(rawTerm) || (cleanTerm && (item.ticketNo || '').toLowerCase().replace(/[\s\-_/]/g, '').includes(cleanTerm));

        if (!mAssetNo && !mModel && !mCust && !mSite && !mAddr && !mAction && !mMech && !mTicket) {
          return false;
        }
      }

      return true;
    });
  }, [unifiedRepairRecords, selectedAssetId, activeSearchParams, repairCategoryFilter, repairStatusFilter, repairBillableFilter, todayStr]);

  // 💡 입출고 탭용 로그 필터링 (기존 INBOUND, OUTBOUND 호환)
  const filteredTabLogs = useMemo(() => {
    if (activeTab === 'REPAIR') return [];
    return assetInOutLogs.filter(log => {
      if (log.type !== activeTab) return false;
      if (log.eventDate > todayStr) return false;
      if (selectedAssetId && log.assetId !== selectedAssetId) return false;
      if (activeSearchParams.startDate && log.eventDate < activeSearchParams.startDate) return false;
      if (activeSearchParams.endDate && log.eventDate > activeSearchParams.endDate) return false;

      if (activeSearchParams.searchTerm.trim()) {
        const term = activeSearchParams.searchTerm.toLowerCase();
        const matchesAssetNo = log.assetNo.toLowerCase().includes(term);
        const matchesModel = log.modelName.toLowerCase().includes(term);
        const matchesCustomer = log.customerName && log.customerName.toLowerCase().includes(term);
        const matchesSite = log.siteName && log.siteName.toLowerCase().includes(term);
        const matchesMemo = log.memo && log.memo.toLowerCase().includes(term);

        if (!matchesAssetNo && !matchesModel && !matchesCustomer && !matchesSite && !matchesMemo) {
          return false;
        }
      }
      return true;
    }).sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());
  }, [assetInOutLogs, activeTab, selectedAssetId, activeSearchParams, todayStr]);

  // 💡 [오타방지 및 유연매칭] 입고 등록용 선택된 자산 정보 및 대여 계약 자동 매칭 탐색
  const inboundTargetAsset = assets.find(a => a.id === selectedInboundAssetId || a.assetNo.toLowerCase() === inboundAssetNoInput.trim().toLowerCase());
  const inboundContractAsset = inboundTargetAsset ? (
    contractAssets.find(ca => ca.assetId === inboundTargetAsset.id && ca.status === 'RENTED') ||
    contractAssets.find(ca => ca.assetId === inboundTargetAsset.id && ca.status !== 'RETURNED') ||
    contractAssets.find(ca => ca.assetId === inboundTargetAsset.id)
  ) : null;
  const inboundContract = inboundContractAsset ? contracts.find(c => c.id === inboundContractAsset.contractId) : null;
  const inboundCustomer = inboundContract ? customers.find(c => c.id === inboundContract.customerId) : null;
  const inboundSite = inboundContract ? sites.find(s => s.id === inboundContract.siteId) : null;

  // 입고 등록 전송 실행
  const handleSubmitInbound = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!inboundTargetAsset) {
      showErrorModal('입고 처리할 대상 자산의 정확한 관리번호를 입력해 주세요.');
      return;
    }

    try {
      setIsSubmittingInbound(true);
      const combinedMemo = selectedChecklistSummary 
        ? `[정비 필요 항목: ${selectedChecklistSummary}] ${inboundMemo}`.trim()
        : (inboundMemo.trim() || '입고 검수 이상 무');

      const uploadedPhotoUrls: Record<string, string> = {};
      const config = googleConfigs[0];
      const accountId = config?.r2AccountId || '35014a2514680107d74e1e68d96e6c32';
      const bucketName = config?.r2BucketName || 'kiyeun-storage';
      const accessKeyId = config?.r2AccessKeyId || '03cdb7560d37242de608a5db2a976030';
      const secretAccessKey = config?.r2SecretAccessKey || 'b2407ab4532e02317860bc3d63226fb7bc232e88083b150c15023906ed141986';

      for (const item of selectedChecklistObjects) {
        const base64 = defectPhotos[item.id];
        if (!base64) continue;
        try {
          const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const fileName = `inbound_${inboundTargetAsset.assetNo}_${item.id}_${dateStr}.jpg`;
          const key = `inbound/${inboundTargetAsset.assetNo}/${fileName}`;

          const res = await fetch('/api/r2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'upload',
              accountId,
              bucketName,
              accessKeyId,
              secretAccessKey,
              key,
              base64Content: base64,
              contentType: 'image/jpeg'
            })
          });

          const resJson = await res.json();
          if (resJson.success) {
            uploadedPhotoUrls[item.id] = resJson.publicUrl || `https://pub-drcf-bucket.r2.dev/${key}`;
          } else {
            showErrorModal(`사진 업로드 실패 (${item.name}): ${resJson.error}`);
          }
        } catch (uploadErr: any) {
          showErrorModal(`사진 네트워크 업로드 실패 (${item.name}): ${uploadErr.message || uploadErr}`);
        }
      }

      const defectPayloads: InboundDefectDetail[] = selectedChecklistObjects.map(item => ({
        subNo: '',
        checkitemId: item.id,
        checkitemName: item.name,
        score: item.score,
        photoUrl: uploadedPhotoUrls[item.id] || undefined
      }));

      await registerInboundAsset({
        assetId: inboundTargetAsset.id,
        returnDate: inboundDate,
        maintenanceScore: Math.max(0, calculatedInboundScore),
        defects: defectPayloads,
        photos: Object.values(uploadedPhotoUrls).filter(Boolean),
        memo: combinedMemo
      });

      showToast(`[입고 등록 완결] 자산 ${inboundTargetAsset.assetNo} 입고 등록 및 자산 상태 갱신이 완료되었습니다.`);
      
      setSelectedInboundAssetId('');
      setInboundAssetNoInput('');
      setSelectedChecklistIds([]);
      setDefectPhotos({});
      setInboundMemo('');
      try {
        sessionStorage.removeItem('inbound_draft_assetNo');
        sessionStorage.removeItem('inbound_draft_checklist');
        sessionStorage.removeItem('inbound_draft_memo');
        sessionStorage.removeItem('inbound_draft_photos');
      } catch (e) {}
      setActiveTab('INBOUND');
    } catch (err: any) {
      showErrorModal(`⚠️ 입고 등록 중 오류 발생: ${err?.message || err}`);
    } finally {
      setIsSubmittingInbound(false);
    }
  };

  // 💡 [입고 취소 롤백]
  const handleCancelInbound = (log: any) => {
    setCancelModal({
      isOpen: true,
      log,
      reason: '사용자 입력 오타로 인한 입고 취소 롤백'
    });
  };

  const handleConfirmCancelInbound = async () => {
    if (!cancelModal) return;
    const { log, reason } = cancelModal;
    setCancelModal(null);

    try {
      await cancelInboundAsset(log.id, reason || '사용자 입력 오타로 인한 입고 취소 롤백');
      showToast(`[입고 취소 롤백 성공] 자산 ${log.assetNo} 상태가 대여중(RENTED)으로 안전하게 원복 되었습니다.`);
    } catch (err: any) {
      showErrorModal(`⚠️ 입고 취소 롤백 실패: ${err?.message || err}`);
    }
  };

  // 5. 선택된 자산 정보 및 통합 타임라인
  const selectedAsset = assets.find(a => a.id === selectedAssetId);
  const selectedAssetTimeline = assetInOutLogs
    .filter(l => l.assetId === selectedAssetId)
    .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());

  // 6. 엑셀 다운로드 (정밀 모델명, 현장명, 상세 정비 정보 반영)
  const handleExport = () => {
    if (activeTab === 'REPAIR') {
      const excelData = filteredRepairRecords.map((item, idx) => ({
        'No': idx + 1,
        '정비일자': item.eventDate,
        '접수/티켓번호': item.ticketNo || '-',
        '관리번호': item.assetNo,
        '세부기종(모델명)': item.modelName,
        '정비구분': item.categoryLabel,
        '처리상태': item.statusLabel,
        '고객사(거래처)': item.customerName,
        '현장명': item.siteName,
        '도로명주소': item.siteAddress,
        '고장증상': item.issueDescription || '-',
        '조치내역': item.actionTaken || item.summaryAction,
        '투입소모품': item.partsUsed.length > 0 ? item.partsUsed.map(p => `${p.modelName} ${p.quantity}개`).join(', ') : '무투입',
        '소모품비용': item.partsTotalCost,
        '유무상구분': item.billableType === 'BILLABLE' ? '유상청구' : '무상',
        '유상청구액': item.billableAmount,
        '외주/소요비용': item.totalCost,
        '담당정비자': item.mechanicName,
        '비고': item.memo || '-'
      }));
      exportToExcel(excelData, `정비이력조회_${new Date().toISOString().split('T')[0]}`, '정비이력대장');
      return;
    }

    const tabName = activeTab === 'OUTBOUND' ? '출고이력' : '입고이력';
    const excelData = filteredTabLogs.map((log, idx) => ({
      'No': idx + 1,
      '발생일자': log.eventDate,
      '관리번호': log.assetNo,
      '모델명': resolvePrecisionModelName(log.assetId, log.assetNo, log.modelName),
      '거래처(고객사)': log.customerName || '-',
      '연관 현장': log.siteName || '-',
      '상태/점수': log.type === 'INBOUND' ? `${log.maintenanceScore || 0}점` : log.type,
      '메모 / 비고': log.memo || '-'
    }));

    exportToExcel(excelData, `자산_${tabName}_${new Date().toISOString().split('T')[0]}`, tabName);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 1. 페이지 헤더 (헌장 3.1: 무수식어 건조 표준) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontWeight: '700', marginBottom: '4px' }}>자산 입출고 및 정비 이력</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            장비의 출하, 반납 입고 및 검수, 주기장 정비 및 현장 AS 처리 결과를 조회 추적합니다.
          </p>
        </div>
        <button className="btn-secondary" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          <Download size={14} /> 엑셀 다운로드
        </button>
      </div>

      {/* 📊 자산 라이프사이클 이벤트 실시간 요약 바 */}
      {(() => {
        const inboundCount = assetInOutLogs.filter(l => l.type === 'INBOUND').length;
        const outboundCount = assetInOutLogs.filter(l => l.type === 'OUTBOUND').length;
        const repairCount = unifiedRepairRecords.length;

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>총 입고(반납) 이력</span>
              <strong style={{ fontSize: '15px', color: '#16a34a' }}>{inboundCount}건</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>총 출고(출하) 이력</span>
              <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>{outboundCount}건</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>총 정비/AS 이력</span>
              <strong style={{ fontSize: '15px', color: '#d97706' }}>{repairCount}건</strong>
            </div>
          </div>
        );
      })()}

      {/* 2. 4대 탭 메뉴 (입고등록, 입고조회, 출고조회, 정비이력조회) */}
      <div style={{ display: 'flex', gap: '10px', borderBottom: '2px solid var(--border-color)', paddingBottom: '10px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('INBOUND_REGISTER')}
          className={activeTab === 'INBOUND_REGISTER' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '8px 18px', fontSize: '13.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <CheckCircle2 size={16} /> 입고 등록 (반납)
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('INBOUND')}
          className={activeTab === 'INBOUND' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '8px 18px', fontSize: '13.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <ArrowDownLeft size={16} /> 입고 조회
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('OUTBOUND')}
          className={activeTab === 'OUTBOUND' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '8px 18px', fontSize: '13.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <ArrowUpRight size={16} /> 출고 조회
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('REPAIR')}
          className={activeTab === 'REPAIR' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '8px 18px', fontSize: '13.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <Wrench size={16} /> 정비 이력 조회
        </button>
      </div>

      {/* 3. [신설] 입고 등록 전용 워크보드 (activeTab === 'INBOUND_REGISTER') */}
      {activeTab === 'INBOUND_REGISTER' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
          
          {/* 왼쪽: 자산 관리번호 선택 및 폼 입력 */}
          <div className="card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ArrowDownLeft size={18} className="text-primary" /> 입고 자산 선택 및 검수 정보 입력
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 'bold' }}>입고 장비 관리번호 입력 / 검색 *</label>
                <input
                  type="text"
                  placeholder="예: G19004 또는 RENT-0001 관리번호 입력..."
                  value={inboundAssetNoInput}
                  onChange={e => {
                    const val = e.target.value;
                    setInboundAssetNoInput(val);
                    try { sessionStorage.setItem('inbound_draft_assetNo', val); } catch (err) {}
                    const matched = assets.find(a => a.assetNo.toLowerCase() === val.trim().toLowerCase());
                    if (matched) setSelectedInboundAssetId(matched.id);
                  }}
                  required
                  style={{ padding: '9px 12px', fontSize: '13.5px', fontWeight: 'bold' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 'bold' }}>입고 일자 *</label>
                <input
                  type="date"
                  max={todayStr}
                  value={inboundDate}
                  onChange={e => setInboundDate(e.target.value)}
                  required
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ShieldCheck size={15} className="text-primary" /> 정비 필요 항목 점검 선택 (자동 합산 연동)
                  </label>
                  <span className={`badge ${calculatedInboundScore === 0 ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '12px', fontWeight: 'bold', padding: '4px 8px' }}>
                    총 정비필요점수: {calculatedInboundScore}점 {calculatedInboundScore === 0 ? '(이상무: AVAILABLE)' : '(검수대기: RENTED_RETURNED)'}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginTop: '4px' }}>
                  {inspectionChecklistItems.map(item => {
                    const isChecked = selectedChecklistIds.includes(item.id);
                    const photo = defectPhotos[item.id];
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          padding: '10px 12px',
                          borderRadius: '6px',
                          backgroundColor: isChecked ? 'var(--primary-light)' : 'var(--bg-card)',
                          border: `1px solid ${isChecked ? 'var(--primary)' : 'var(--border-color)'}`,
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', margin: 0 }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={e => {
                                let newIds: string[];
                                if (e.target.checked) {
                                  newIds = [...selectedChecklistIds, item.id];
                                } else {
                                  newIds = selectedChecklistIds.filter(id => id !== item.id);
                                  setDefectPhotos(prev => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    try { sessionStorage.setItem('inbound_draft_photos', JSON.stringify(next)); } catch (err) {}
                                    return next;
                                  });
                                }
                                setSelectedChecklistIds(newIds);
                                try { sessionStorage.setItem('inbound_draft_checklist', JSON.stringify(newIds)); } catch (err) {}
                              }}
                              style={{ width: '16px', height: '16px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                            />
                            <span style={{ fontWeight: isChecked ? 'bold' : 'normal' }}>{item.name}</span>
                          </label>
                          <span style={{ fontSize: '12px', color: isChecked ? 'var(--primary)' : 'var(--warning)', fontWeight: 'bold' }}>
                            +{item.score}점
                          </span>
                        </div>

                        {isChecked && (
                          <div style={{ marginTop: '4px', paddingTop: '6px', borderTop: '1px dashed var(--border-color)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const fileInput = document.getElementById(`defect-camera-input-${item.id}`);
                                if (fileInput) fileInput.click();
                              }}
                              style={{ padding: '4px 8px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', margin: 0 }}
                            >
                              <Camera size={13} /> 📸 촬영
                            </button>
                            <input
                              id={`defect-camera-input-${item.id}`}
                              type="file"
                              accept="image/*"
                              capture="environment"
                              style={{ display: 'none' }}
                              onChange={e => handlePhotoFileChange(item.id, e.target.files?.[0] || null)}
                            />

                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const fileInput = document.getElementById(`defect-gallery-input-${item.id}`);
                                if (fileInput) fileInput.click();
                              }}
                              style={{ padding: '4px 8px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', margin: 0 }}
                            >
                              🖼 갤러리
                            </button>
                            <input
                              id={`defect-gallery-input-${item.id}`}
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={e => handlePhotoFileChange(item.id, e.target.files?.[0] || null)}
                            />

                            {photo ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <img src={photo} alt="파손 사진" style={{ width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-color)' }} />
                                <span style={{ fontSize: '11px', color: 'var(--success)', fontWeight: 'bold' }}>✅ 사진 첨부됨</span>
                                <button
                                  type="button"
                                  onClick={() => setDefectPhotos(prev => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    try { sessionStorage.setItem('inbound_draft_photos', JSON.stringify(next)); } catch (err) {}
                                    return next;
                                  })}
                                  style={{ border: 'none', background: 'none', color: 'var(--danger)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                                >
                                  삭제
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>(사진 선택 시 자동 저장)</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                  검수 및 입고 특이사항 메모 (선택사항)
                </label>
                <textarea
                  rows={2}
                  placeholder="추가적인 특이사항 또는 담당자 비고 입력 (선택)..."
                  value={inboundMemo}
                  onChange={e => {
                    const val = e.target.value;
                    setInboundMemo(val);
                    try { sessionStorage.setItem('inbound_draft_memo', val); } catch (err) {}
                  }}
                  style={{ padding: '8px', fontSize: '12.5px' }}
                />
              </div>

              <button
                type="button"
                onClick={() => handleSubmitInbound()}
                className="btn-primary"
                disabled={isSubmittingInbound || !inboundTargetAsset}
                style={{ width: '100%', padding: '10px', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '6px' }}
              >
                <CheckCircle2 size={16} /> 📥 반납 / 입고 등록 확정
              </button>

            </div>
          </div>

          {/* 오른쪽: 휴먼에러 오타 방지용 자동 매칭 교차 검증 정보 카드 */}
          <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--primary)' }}>
              <ShieldCheck size={18} /> 오타 방지 자산 및 대여 계약 자동 검증 정보
            </h3>

            {inboundTargetAsset ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
                
                <div style={{ padding: '12px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--primary)', marginBottom: '4px' }}>
                    {inboundTargetAsset.assetNo} {inboundTargetAsset.modelName}
                  </div>
                  <div><strong>시리얼번호(S/N):</strong> {inboundTargetAsset.serialNo || '-'}</div>
                  <div><strong>소유형태:</strong> {inboundTargetAsset.ownerType === 'OWNED' ? '당사 자산' : '외부 임차 장비'}</div>
                  <div><strong>현재 자산 상태:</strong> <span className="badge badge-info">{inboundTargetAsset.status}</span></div>
                </div>

                {inboundContractAsset ? (
                  <div style={{ padding: '12px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--primary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 'bold' }}>
                      ✓ 대여 계약 매칭 성공 (휴먼에러 방지 교차 확인)
                    </div>
                    <div><strong>계약번호:</strong> {inboundContract?.contractNo}</div>
                    <div><strong>고객사 (거래처):</strong> <strong style={{ fontSize: '14px' }}>{inboundCustomer?.name || '-'}</strong></div>
                    <div><strong>현장명:</strong> {inboundSite?.name || '-'} ({inboundSite?.address || '-'})</div>
                    <div><strong>약정 계약기간:</strong> {inboundContract?.startDate} ~ {formatContractEndDate(inboundContract?.endDate)}</div>
                  </div>
                ) : (
                  <div style={{ padding: '12px', backgroundColor: 'var(--warning-light)', borderRadius: '8px', border: '1px solid var(--warning)', color: '#c2410c' }}>
                    ⚠️ 현재 체결 대여 중인 계약(RENTED)을 찾을 수 없습니다. (입고 시 미할당 자산으로 자동 처리됩니다)
                  </div>
                )}

                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '8px', backgroundColor: 'var(--bg-card)', borderRadius: '6px' }}>
                  💡 <strong>입고 후 자동 자산 상태 전환:</strong><br />
                  - 검수점수 0점: <strong>`임대가능 (AVAILABLE)`</strong> 상태로 자동 즉시 전이<br />
                  - 검수점수 1점 이상: <strong>`입고반납/검수대기 (RENTED_RETURNED)`</strong> 상태로 자동 전이
                </div>

              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '240px', color: 'var(--text-muted)' }}>
                <AlertTriangle size={40} style={{ strokeWidth: 1.2, marginBottom: '10px' }} />
                <span>왼쪽 폼에서 입고할 자산의 관리번호를 선택하거나 입력해 주세요.</span>
              </div>
            )}
          </div>

        </div>
      ) : (

        /* 검색 & 필터 패널 */
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', alignItems: 'end' }}>
            
            {/* 1. 조회 기간 설정 필터 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                조회 기간 설정 (상한: 오늘)
              </label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="date"
                  value={inputStartDate}
                  max={todayStr}
                  onChange={e => setInputStartDate(e.target.value)}
                  style={{ flex: 1, padding: '7px', fontSize: '12.5px' }}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>~</span>
                <input
                  type="date"
                  value={inputEndDate}
                  max={todayStr}
                  onChange={e => {
                    const val = e.target.value;
                    setInputEndDate(val > todayStr ? todayStr : val);
                  }}
                  style={{ flex: 1, padding: '7px', fontSize: '12.5px' }}
                />
              </div>
            </div>

            {/* 2. 기간 빠른 선택 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                기간 선택
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setQuickRange('TODAY')}
                  style={{ flex: 1, padding: '6px 4px', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  오늘
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setQuickRange('WEEK')}
                  style={{ flex: 1, padding: '6px 4px', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  1주
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setQuickRange('MONTH')}
                  style={{ flex: 1, padding: '6px 4px', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  1개월
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setQuickRange('ALL')}
                  style={{ flex: 1, padding: '6px 4px', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  전체
                </button>
              </div>
            </div>

            {/* 3. 통합 검색 필터 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                통합 검색 (모델명 / 관리번호 / 고객사 / 현장 / 조치내역)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={inputSearchTerm}
                  onChange={e => setInputSearchTerm(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                  placeholder="모델명, 관리번호, 고객사명, 현장, 조치내용 (Enter)..."
                  style={{ width: '100%', padding: '7px 10px 7px 32px', fontSize: '12.5px' }}
                />
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              </div>
            </div>

            {/* 4. [조회] 실행 버튼 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'transparent', whiteSpace: 'nowrap', userSelect: 'none' }}>
                조회 실행
              </label>
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleSearch()}
                style={{
                  width: '100%',
                  padding: '7px 16px',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
                  height: '34px',
                  flexShrink: 0
                }}
              >
                <Search size={15} /> 조회
              </button>
            </div>

          </div>

          {/* 🌟 정비 이력 탭 전용 서브 필터 바 (헌장 3.1) */}
          {activeTab === 'REPAIR' && (
            <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 'bold', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>정비 구분:</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[
                    { id: 'ALL', label: '전체' },
                    { id: 'FIELD_AS', label: '외근 현장AS' },
                    { id: 'YARD_INTERNAL', label: '내근 주기장' },
                    { id: 'EXTERNAL_VENDOR', label: '외주 위탁' },
                    { id: 'PREVENTIVE', label: '예방 점검' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setRepairCategoryFilter(tab.id as any)}
                      className={repairCategoryFilter === tab.id ? 'btn-primary' : 'btn-secondary'}
                      style={{ padding: '3px 8px', fontSize: '11.5px', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 'bold', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>처리 상태:</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[
                    { id: 'ALL', label: '전체' },
                    { id: 'COMPLETED', label: '완료' },
                    { id: 'IN_PROGRESS', label: '진행중' },
                    { id: 'REVISIT', label: '재방문요구' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setRepairStatusFilter(tab.id as any)}
                      className={repairStatusFilter === tab.id ? 'btn-primary' : 'btn-secondary'}
                      style={{ padding: '3px 8px', fontSize: '11.5px', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 'bold', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>청구/비용:</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[
                    { id: 'ALL', label: '전체' },
                    { id: 'BILLABLE', label: '유상 청구' },
                    { id: 'FREE', label: '무상 정비' },
                    { id: 'EXTERNAL_COST', label: '외주 소요' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setRepairBillableFilter(tab.id as any)}
                      className={repairBillableFilter === tab.id ? 'btn-primary' : 'btn-secondary'}
                      style={{ padding: '3px 8px', fontSize: '11.5px', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>
      )}

      {/* 4. 자산 개별 선택 정보 및 연대기 타임라인 (선택된 자산이 있는 경우) */}
      {selectedAssetId && selectedAsset && (
        <div className="card" style={{ padding: '20px', border: '1px solid var(--primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontWeight: '700', fontSize: '15px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={18} />
              자산 통합 이력 연대기: {selectedAsset.assetNo} {selectedAsset.modelName}
            </h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className={`badge ${
                selectedAsset.status === 'AVAILABLE' ? 'badge-success' :
                selectedAsset.status === 'RENTED' ? 'badge-info' : 'badge-danger'
              }`}>
                현재상태: {
                  selectedAsset.status === 'AVAILABLE' ? '임대가능' :
                  selectedAsset.status === 'ASSIGNED' ? '출고대기' :
                  selectedAsset.status === 'RENTED' ? '대여중' :
                  selectedAsset.status === 'REPAIRING' ? '정비중' :
                  selectedAsset.status === 'RENTED_RETURNED' ? '반납완료' : selectedAsset.status
                }
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedAssetId('')}
                style={{ fontSize: '11px', padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                ✕ 전체 보기로 복귀
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.5fr', gap: '24px', alignItems: 'start' }}>
            <div style={{ backgroundColor: 'var(--bg-app)', padding: '14px', borderRadius: '8px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid var(--border-color)' }}>
              <div><strong>관리번호:</strong> <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{selectedAsset.assetNo}</span></div>
              <div><strong>모델명:</strong> {selectedAsset.modelName}</div>
              <div><strong>제조번호 (SN):</strong> {selectedAsset.serialNo || '-'}</div>
              <div><strong>소유 형태:</strong> {selectedAsset.ownerType === 'OWNED' ? '자사자산' : '외부임차장비'}</div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
              <div><strong>기여액 (누적):</strong> {(selectedAsset.cumRentalFee || 0).toLocaleString()}원</div>
              <div><strong>수리비 지출 (누적):</strong> {(selectedAsset.cumRepairCost || 0).toLocaleString()}원</div>
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px 0', fontSize: '13.5px', fontWeight: '700' }}>장비 생애주기 이력 로그 ({selectedAssetTimeline.length}건)</h4>
              {selectedAssetTimeline.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px' }}>
                  등록된 이력 로그가 없습니다.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderLeft: '2px solid var(--border-color)', paddingLeft: '14px', marginLeft: '6px' }}>
                  {selectedAssetTimeline.map(log => (
                    <div key={log.id} style={{ position: 'relative' }}>
                      <div style={{
                        position: 'absolute', left: '-21px', top: '3px', width: '12px', height: '12px', borderRadius: '50%',
                        backgroundColor: 
                          log.type === 'OUTBOUND' ? 'var(--primary)' : 
                          log.type === 'INBOUND' ? 'var(--success)' : 'var(--warning)',
                        border: '2px solid var(--bg-card)'
                      }} />
                      <div style={{ padding: '10px', fontSize: '12.5px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <strong style={{ color: log.type === 'OUTBOUND' ? 'var(--primary)' : log.type === 'INBOUND' ? 'var(--success)' : 'var(--warning)' }}>
                            {log.type === 'OUTBOUND' ? '📤 출고 (OUTBOUND)' : log.type === 'INBOUND' ? '📥 입고 (INBOUND)' : '🛠️ 정비 (REPAIR)'}
                          </strong>
                          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{log.eventDate}</span>
                        </div>
                        <div>고객사/거래처: <strong>{log.customerName || '-'}</strong> {log.siteName ? `(${log.siteName})` : ''}</div>
                        {log.memo && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>비고: {log.memo}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. 탭별 조회 결과 안내 & 데이터 테이블 (activeTab !== 'INBOUND_REGISTER') */}
      {activeTab !== 'INBOUND_REGISTER' && (
        <div className="card" style={{ padding: '16px' }}>
          
          {/* 결과 요약 헤더 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {activeTab === 'OUTBOUND' && <span>📤 출고 이력 목록</span>}
              {activeTab === 'INBOUND' && <span>📥 입고 이력 목록</span>}
              {activeTab === 'REPAIR' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Wrench size={16} className="text-primary" /> 정비 및 AS 통합 이력 대장
                  </span>
                  <span className="badge badge-secondary" style={{ fontSize: '11px', fontWeight: 600 }}>
                    현장AS: {unifiedRepairRecords.filter(r => r.workCategory === 'FIELD_AS').length}건
                  </span>
                  <span className="badge badge-secondary" style={{ fontSize: '11px', fontWeight: 600 }}>
                    주기장: {unifiedRepairRecords.filter(r => r.workCategory === 'YARD_INTERNAL').length}건
                  </span>
                  <span className="badge badge-secondary" style={{ fontSize: '11px', fontWeight: 600 }}>
                    외주: {unifiedRepairRecords.filter(r => r.workCategory === 'EXTERNAL_VENDOR').length}건
                  </span>
                  <span className="badge badge-success" style={{ fontSize: '11px', fontWeight: 600 }}>
                    유상청구: {unifiedRepairRecords.filter(r => r.billableAmount > 0).reduce((s, r) => s + r.billableAmount, 0).toLocaleString()}원
                  </span>
                </div>
              )}
            </div>

            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              총 <strong style={{ color: 'var(--primary)', fontSize: '15px' }}>
                {activeTab === 'REPAIR' ? filteredRepairRecords.length : filteredTabLogs.length}
              </strong>건 조회됨
            </div>
          </div>

          {/* 데이터 테이블 (헌장 3.2: 줄바꿈 방지 nowrap) */}
          <div className="table-container" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                {activeTab === 'OUTBOUND' && (
                  <tr>
                    <th style={{ whiteSpace: 'nowrap' }}>번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>출고일자</th>
                    <th style={{ whiteSpace: 'nowrap' }}>관리번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>모델명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>고객사 (거래처)</th>
                    <th style={{ whiteSpace: 'nowrap' }}>현장명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>비고 / 메모</th>
                  </tr>
                )}
                {activeTab === 'INBOUND' && (
                  <tr>
                    <th style={{ whiteSpace: 'nowrap' }}>번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>입고 고유번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>입고일자</th>
                    <th style={{ whiteSpace: 'nowrap' }}>관리번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>모델명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>고객사 (거래처)</th>
                    <th style={{ whiteSpace: 'nowrap' }}>현장명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>정비 점수</th>
                    <th style={{ whiteSpace: 'nowrap' }}>불량 증상 상세</th>
                    <th style={{ whiteSpace: 'nowrap' }}>작업</th>
                  </tr>
                )}
                {activeTab === 'REPAIR' && (
                  <tr>
                    <th style={{ whiteSpace: 'nowrap', width: '50px' }}>번호</th>
                    <th style={{ whiteSpace: 'nowrap', width: '60px' }}>상세</th>
                    <th style={{ whiteSpace: 'nowrap' }}>정비일자</th>
                    <th style={{ whiteSpace: 'nowrap' }}>관리번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>세부기종 (모델명)</th>
                    <th style={{ whiteSpace: 'nowrap' }}>정비 구분</th>
                    <th style={{ whiteSpace: 'nowrap' }}>처리 상태</th>
                    <th style={{ whiteSpace: 'nowrap' }}>고객사 / 현장 (도로명주소)</th>
                    <th style={{ whiteSpace: 'nowrap' }}>고장 증상 및 정비 조치 내역</th>
                    <th style={{ whiteSpace: 'nowrap' }}>투입 소모품 (부품)</th>
                    <th style={{ whiteSpace: 'nowrap' }}>유/무상 (청구/비용)</th>
                    <th style={{ whiteSpace: 'nowrap' }}>담당자</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {activeTab === 'REPAIR' ? (
                  filteredRepairRecords.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                        조회 조건에 부합하는 정비 및 AS 이력 데이터가 존재하지 않습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredRepairRecords.map((item, idx) => (
                      <tr
                        key={item.id}
                        style={{ cursor: 'pointer', transition: 'background-color 0.15s ease' }}
                        onClick={() => setSelectedDetailRecord(item)}
                        title="클릭 시 360도 정비 상세 정보(투입부품, 사진, 서명 등)를 확인합니다."
                      >
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                          {idx + 1}
                        </td>

                        <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }} onClick={e => { e.stopPropagation(); setSelectedDetailRecord(item); }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '3px 6px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap' }}
                            title="정비 상세 Dossier 열기"
                          >
                            <Eye size={12} /> 상세
                          </button>
                        </td>

                        <td style={{ whiteSpace: 'nowrap', fontSize: '12.5px', fontWeight: 600 }}>
                          {item.eventDate}
                        </td>

                        <td style={{ whiteSpace: 'nowrap' }}>
                          <strong style={{ color: 'var(--primary)', fontSize: '13px' }}>{item.assetNo}</strong>
                        </td>

                        {/* 🌟 100% 정밀 보정된 세부 모델명 */}
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 700, color: '#1e293b', backgroundColor: '#f1f5f9', padding: '2px 7px', borderRadius: '4px', fontSize: '12px', border: '1px solid #cbd5e1' }}>
                            {item.modelName}
                          </span>
                        </td>

                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className={`badge ${
                            item.workCategory === 'FIELD_AS' ? 'badge-primary' :
                            item.workCategory === 'EXTERNAL_VENDOR' ? 'badge-warning' :
                            item.workCategory === 'PREVENTIVE' ? 'badge-success' : 'badge-info'
                          }`} style={{ fontSize: '11px', padding: '3px 7px' }}>
                            {item.categoryLabel}
                          </span>
                        </td>

                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className={`badge ${
                            item.status === 'COMPLETED' ? 'badge-success' :
                            item.status === 'REVISIT' ? 'badge-danger' :
                            item.status === 'IN_PROGRESS' ? 'badge-warning' : 'badge-secondary'
                          }`} style={{ fontSize: '11px' }}>
                            {item.statusLabel}
                          </span>
                        </td>

                        {/* 🌟 100% 역추적 보정된 고객사 및 현장명 */}
                        <td style={{ whiteSpace: 'nowrap', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div>
                              <strong style={{ color: item.isYardInternal ? 'var(--primary)' : 'var(--text-primary)', fontSize: '12.5px' }}>
                                {item.customerName}
                              </strong>
                              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}> / {item.siteName}</span>
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              📍 {item.siteAddress}
                            </div>
                          </div>
                        </td>

                        <td style={{ maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' }}>
                            {item.issueCategory && (
                              <span className="badge badge-secondary" style={{ width: 'fit-content', fontSize: '10px', padding: '1px 5px' }}>
                                {item.issueCategory}
                              </span>
                            )}
                            <span style={{ color: 'var(--text-primary)', lineHeight: 1.3 }}>
                              {item.summaryAction}
                            </span>
                          </div>
                        </td>

                        <td style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
                          {item.partsUsed.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
                                {item.partsUsed[0].modelName} {item.partsUsed[0].quantity}개
                                {item.partsUsed.length > 1 && ` 외 ${item.partsUsed.length - 1}건`}
                              </span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                소모품 합계: {item.partsTotalCost.toLocaleString()}원
                              </span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>무투입</span>
                          )}
                        </td>

                        <td style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {item.billableType === 'BILLABLE' && item.billableAmount > 0 ? (
                              <span style={{ color: '#dc2626', fontWeight: 700 }}>
                                유상청구: {item.billableAmount.toLocaleString()}원
                              </span>
                            ) : item.isWaived ? (
                              <span style={{ color: '#ea580c', fontWeight: 600 }}>
                                영업면제: {(item.waivedAmount || 0).toLocaleString()}원
                              </span>
                            ) : item.totalCost > 0 ? (
                              <span style={{ color: '#d97706', fontWeight: 600 }}>
                                외주비용: {item.totalCost.toLocaleString()}원
                              </span>
                            ) : (
                              <span style={{ color: '#16a34a', fontWeight: 600 }}>
                                무상정비
                              </span>
                            )}
                          </div>
                        </td>

                        <td style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
                          {item.mechanicName}
                        </td>

                      </tr>
                    ))
                  )
                ) : (
                  /* 출고 및 입고 탭 테이블 */
                  filteredTabLogs.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                        선택한 탭 및 검색 조건에 부합하는 자산 이력 데이터가 존재하지 않습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredTabLogs.map((log, idx) => {
                      const parsedDefects: InboundDefectDetail[] = log.defectsJson ? JSON.parse(log.defectsJson) : [];
                      const precisionModel = resolvePrecisionModelName(log.assetId, log.assetNo, log.modelName);
                      return (
                        <tr
                          key={log.id}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelectedAssetId(log.assetId)}
                          title="클릭 시 자산별 생애주기 통합 연대기를 확인합니다."
                        >
                          <td style={{ whiteSpace: 'nowrap' }}>{idx + 1}</td>
                          
                          {activeTab === 'OUTBOUND' && (
                            <>
                              <td style={{ whiteSpace: 'nowrap' }}>{log.eventDate}</td>
                              <td style={{ whiteSpace: 'nowrap' }}><strong style={{ color: 'var(--primary)' }}>{log.assetNo}</strong></td>
                              <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{precisionModel}</td>
                              <td style={{ whiteSpace: 'nowrap' }}><strong>{log.customerName || '-'}</strong></td>
                              <td style={{ whiteSpace: 'nowrap' }}>{log.siteName || '-'}</td>
                              <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{log.memo || '-'}</td>
                            </>
                          )}

                          {activeTab === 'INBOUND' && (
                            <>
                              <td style={{ whiteSpace: 'nowrap', fontWeight: 'bold', color: 'var(--primary)', fontSize: '12px' }}>
                                {log.inboundNo || '-'}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>{log.eventDate}</td>
                              <td style={{ whiteSpace: 'nowrap' }}><strong style={{ color: 'var(--primary)' }}>{log.assetNo}</strong></td>
                              <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{precisionModel}</td>
                              <td style={{ whiteSpace: 'nowrap' }}><strong>{log.customerName || '-'}</strong></td>
                              <td style={{ whiteSpace: 'nowrap' }}>{log.siteName || '-'}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <span className={`badge ${(log.maintenanceScore || 0) === 0 ? 'badge-success' : 'badge-warning'}`}>
                                  {log.maintenanceScore || 0}점
                                </span>
                              </td>
                              <td style={{ fontSize: '12px' }}>
                                {parsedDefects.length > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {parsedDefects.map((d, dIdx) => (
                                      <div key={dIdx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span className="badge badge-secondary" style={{ fontSize: '10px' }}>{d.subNo}</span>
                                        <span>{d.checkitemName} (+{d.score}점)</span>
                                        {d.photoUrl && (
                                          <a href={d.photoUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                                            <img src={d.photoUrl} alt="사진" style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '3px', border: '1px solid var(--border-color)' }} />
                                          </a>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span>{log.memo || '-'}</span>
                                )}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => handleCancelInbound(log)}
                                  style={{ fontSize: '11px', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--danger)', border: '1px solid var(--danger-light)' }}
                                  title="사용자 휴먼에러 입고 오타 시 원래 대여중 상태로 롤백 복원합니다."
                                >
                                  <RotateCcw size={12} /> 입고 취소
                                </button>
                              </td>
                            </>
                          )}

                        </tr>
                      );
                    })
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 🌟 [신설: 360도 정비 상세 Dossier 모달 (헌장 3.1 & 3.4 & 3.6 유형 A 준수)] */}
      {/* ========================================================================= */}
      {selectedDetailRecord && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 12000, padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.35)',
            maxWidth: '900px',
            width: '100%',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            
            {/* 모달 헤더 */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--bg-app)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Wrench size={20} className="text-primary" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                  정비 이력 상세 정보 {selectedDetailRecord.assetNo}
                </h3>
                <span className={`badge ${
                  selectedDetailRecord.workCategory === 'FIELD_AS' ? 'badge-primary' :
                  selectedDetailRecord.workCategory === 'EXTERNAL_VENDOR' ? 'badge-warning' : 'badge-info'
                }`} style={{ fontSize: '11.5px', padding: '3px 8px' }}>
                  {selectedDetailRecord.categoryLabel}
                </span>
                <span className={`badge ${
                  selectedDetailRecord.status === 'COMPLETED' ? 'badge-success' : 'badge-secondary'
                }`} style={{ fontSize: '11.5px', padding: '3px 8px' }}>
                  {selectedDetailRecord.statusLabel}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDetailRecord(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* 모달 본문 (스크롤) */}
            <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* 1. 기본 장비 및 일정 정보 (헌장 3.4: 상하 세로 스택) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', padding: '14px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>장비 관리번호</span>
                  <strong style={{ fontSize: '14px', color: 'var(--primary)' }}>{selectedDetailRecord.assetNo}</strong>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>정밀 기종 (모델명)</span>
                  <strong style={{ fontSize: '14px' }}>{selectedDetailRecord.modelName}</strong>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>정비 완료 일자</span>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>{selectedDetailRecord.eventDate}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>접수/티켓번호</span>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{selectedDetailRecord.ticketNo || '-'}</span>
                </div>
              </div>

              {/* 2. 고객사 및 현장 위치 정보 */}
              <div style={{ padding: '14px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Building2 size={16} className="text-primary" /> 현장 및 거래처 정보
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '12.5px' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>거래처 (고객사): </span>
                    <strong>{selectedDetailRecord.customerName}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>현장명: </span>
                    <strong>{selectedDetailRecord.siteName}</strong>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>📍 도로명 상세주소: </span>
                    <span>{selectedDetailRecord.siteAddress}</span>
                    {selectedDetailRecord.locationDetail && (
                      <span style={{ color: 'var(--primary)', marginLeft: '8px', fontWeight: 600 }}>
                        (상세: {selectedDetailRecord.locationDetail})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. 고장 증상 및 실제 조치 사항 */}
              <div style={{ padding: '14px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Wrench size={16} className="text-primary" /> 고장 증상 및 정비 조치 사항
                </h4>
                
                {selectedDetailRecord.issueCategory && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>고장 분류:</span>
                    <span className="badge badge-warning" style={{ fontSize: '11px' }}>{selectedDetailRecord.issueCategory}</span>
                  </div>
                )}

                {selectedDetailRecord.issueDescription && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>접수된 고장 증상</span>
                    <div style={{ padding: '10px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', fontSize: '12.5px', border: '1px solid var(--border-color)' }}>
                      {selectedDetailRecord.issueDescription}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>실제 수행된 정비 조치 사항</span>
                  <div style={{ padding: '10px', backgroundColor: 'rgba(59, 130, 246, 0.05)', borderRadius: '6px', fontSize: '12.5px', border: '1px solid rgba(59, 130, 246, 0.2)', fontWeight: 600, color: '#1e40af' }}>
                    {selectedDetailRecord.actionTaken || selectedDetailRecord.summaryAction}
                  </div>
                </div>

                {selectedDetailRecord.memo && selectedDetailRecord.memo !== selectedDetailRecord.actionTaken && (
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', paddingTop: '4px' }}>
                    참고 비고: {selectedDetailRecord.memo}
                  </div>
                )}
              </div>

              {/* 4. 투입 소모품 및 부품 명세 */}
              <div style={{ padding: '14px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Package size={16} className="text-primary" /> 투입 소모품 및 부품 명세 ({selectedDetailRecord.partsUsed.length}건)
                  </h4>
                  <strong style={{ fontSize: '13px', color: 'var(--primary)' }}>
                    총 소모품 투입액: {selectedDetailRecord.partsTotalCost.toLocaleString()}원
                  </strong>
                </div>

                {selectedDetailRecord.partsUsed.length === 0 ? (
                  <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px' }}>
                    별도 부품 투입 없이 무투입으로 조치 완료되었습니다.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-app)' }}>
                          <th style={{ padding: '6px 10px', textAlign: 'left', whiteSpace: 'nowrap' }}>품목명</th>
                          <th style={{ padding: '6px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>수량</th>
                          <th style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>단가</th>
                          <th style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>금액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedDetailRecord.partsUsed.map((p, pIdx) => (
                          <tr key={pIdx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '6px 10px', fontWeight: 600 }}>{p.modelName}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'center' }}>{p.quantity}개</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right' }}>{(p.unitPrice || 0).toLocaleString()}원</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>
                              {((p.totalPrice !== undefined ? p.totalPrice : (p.quantity * (p.unitPrice || 0)))).toLocaleString()}원
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 5. 회계 정산 및 비용 귀속 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', padding: '14px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>유/무상 구분</span>
                  <strong style={{ fontSize: '14px', color: selectedDetailRecord.billableType === 'BILLABLE' ? '#dc2626' : '#16a34a' }}>
                    {selectedDetailRecord.billableType === 'BILLABLE' ? '유상 청구' : '무상 정비'}
                  </strong>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>고객 청구 확정액</span>
                  <strong style={{ fontSize: '14px', color: '#dc2626' }}>
                    {selectedDetailRecord.billableAmount.toLocaleString()}원
                  </strong>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>외주/자체 소요 비용</span>
                  <strong style={{ fontSize: '14px', color: '#d97706' }}>
                    {selectedDetailRecord.totalCost.toLocaleString()}원
                  </strong>
                </div>
                {selectedDetailRecord.isWaived && (
                  <div style={{ gridColumn: 'span 3', padding: '8px 10px', backgroundColor: 'rgba(234, 88, 12, 0.1)', borderRadius: '6px', fontSize: '12px', color: '#ea580c' }}>
                    ✓ 영업 면제 처리됨: 면제액 {(selectedDetailRecord.waivedAmount || 0).toLocaleString()}원 (사유: {selectedDetailRecord.waivedReason || '영업 판단'})
                  </div>
                )}
              </div>

              {/* 6. 정비 담당자 및 증빙 사진 */}
              <div style={{ padding: '14px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <User size={16} className="text-primary" /> 정비 담당자 및 현장 증빙
                  </h4>
                  <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
                    담당자: {selectedDetailRecord.mechanicName}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {selectedDetailRecord.beforeImage && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>정비 전 (클릭 확대)</span>
                      <img 
                        src={selectedDetailRecord.beforeImage} 
                        alt="정비 전" 
                        onClick={() => setZoomImageUrl(selectedDetailRecord.beforeImage || null)}
                        style={{ width: '90px', height: '90px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-color)', cursor: 'zoom-in' }} 
                      />
                    </div>
                  )}

                  {selectedDetailRecord.afterImage && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>정비 후 (클릭 확대)</span>
                      <img 
                        src={selectedDetailRecord.afterImage} 
                        alt="정비 후" 
                        onClick={() => setZoomImageUrl(selectedDetailRecord.afterImage || null)}
                        style={{ width: '90px', height: '90px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-color)', cursor: 'zoom-in' }} 
                      />
                    </div>
                  )}

                  {selectedDetailRecord.evidenceImages && selectedDetailRecord.evidenceImages.map((img, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>증빙 #{i + 1} (클릭 확대)</span>
                      <img 
                        src={img} 
                        alt={`증빙 #${i + 1}`} 
                        onClick={() => setZoomImageUrl(img)}
                        style={{ width: '90px', height: '90px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-color)', cursor: 'zoom-in' }} 
                      />
                    </div>
                  ))}

                  {selectedDetailRecord.customerSignature && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>고객 확인 서명 ({selectedDetailRecord.customerConfirmName || '담당자'})</span>
                      <img 
                        src={selectedDetailRecord.customerSignature} 
                        alt="서명" 
                        onClick={() => setZoomImageUrl(selectedDetailRecord.customerSignature || null)}
                        style={{ width: '120px', height: '70px', objectFit: 'contain', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: '#fff', cursor: 'zoom-in' }} 
                      />
                    </div>
                  )}

                  {!selectedDetailRecord.beforeImage && !selectedDetailRecord.afterImage && (!selectedDetailRecord.evidenceImages || selectedDetailRecord.evidenceImages.length === 0) && !selectedDetailRecord.customerSignature && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      첨부된 사진 증빙이 없습니다.
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* 모달 하단 닫기 바 */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              backgroundColor: 'var(--bg-app)'
            }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedDetailRecord(null)}
                style={{ padding: '7px 16px', fontSize: '13px' }}
              >
                닫기
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 📸 사진 원본 확대 라이트박스 모달 */}
      {zoomImageUrl && (
        <div 
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 13000, padding: '20px'
          }}
          onClick={() => setZoomImageUrl(null)}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setZoomImageUrl(null)}
              style={{
                position: 'absolute', top: '-40px', right: '0',
                backgroundColor: 'rgba(255, 255, 255, 0.2)', border: 'none',
                color: '#fff', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer',
                fontSize: '13px', fontWeight: 'bold'
              }}
            >
              닫기 ✕
            </button>
            <img 
              src={zoomImageUrl} 
              alt="확대 사진" 
              style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} 
              onClick={e => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          padding: '12px 20px',
          borderRadius: '8px',
          backgroundColor: toastMessage.type === 'error' ? '#ef4444' : toastMessage.type === 'warning' ? '#f59e0b' : '#10b981',
          color: '#fff',
          fontWeight: 700,
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {toastMessage.text}
        </div>
      )}

      {/* 입고 취소 롤백 모달 */}
      {cancelModal && cancelModal.isOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11000
        }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '10px', padding: '20px', maxWidth: '440px', width: '90%', border: '1px solid var(--border-color)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '15px', color: '#ef4444' }}>입고 취소 롤백</h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              자산번호 <strong>{cancelModal.log.assetNo}</strong> 입고 건을 취소하고 자산 상태를 대여중(RENTED)으로 복원하시겠습니까?
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>취소 사유</label>
              <input
                type="text"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: '12.5px' }}
                value={cancelModal.reason}
                onChange={e => setCancelModal({ ...cancelModal, reason: e.target.value })}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn-secondary" onClick={() => setCancelModal(null)}>닫기</button>
              <button
                className="btn-primary"
                style={{ backgroundColor: '#ef4444', borderColor: '#ef4444' }}
                onClick={handleConfirmCancelInbound}
              >
                입고 취소 롤백 실행
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
