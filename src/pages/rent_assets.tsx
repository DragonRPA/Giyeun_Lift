// src/pages/rent_assets.tsx
import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  Plus, CheckCircle, Search, AlertTriangle, Download, Clock, Layers, ShieldAlert, Upload, FileSpreadsheet, RefreshCw, FileText, Check, ArrowRight, XCircle, CreditCard, CheckCircle2, AlertCircle, X, ExternalLink, ShieldCheck, Building, Calendar
} from 'lucide-react';
import { Asset, db, PurchaseSettlement, PurchaseSettlementItem, Delivery, SubleaseNegotiation } from '../services/db';
import { exportToExcel } from '../services/excel';
import * as XLSX from 'xlsx';

import { VendorStatementRow, parseVendorStatementExcel } from '../services/vendorStatementParser';
import { parsePdfStatement } from '../services/pdfStatementParser';

// 5대 대사 결과 항목 인터페이스
export type ReconcileStatusKey = 'MATCHED' | 'PRICE_MISMATCH' | 'PERIOD_MISMATCH' | 'UNREGISTERED' | 'MISSING_BILLING';

export interface ReconcileResultItem {
  id: string;
  status: ReconcileStatusKey;
  statusLabel: string;
  badgeClass: string;
  statementRow?: VendorStatementRow; // 원사 청구 행
  matchedAsset?: Asset; // 자사 DB 매칭 자산
  priceDiff: number; // 원사청구액 - 자사약정액 (양수: 원사 과다청구, 음수: 원사 할인)
  expectedAmount: number; // 자사 DB 기준 약정 금액
  reason: string;
}

export const RentAssets: React.FC = () => {
  const { 
    assets, products, customers, vendors, contracts, sites, billings, billingDetails,
    purchaseSettlements, purchaseSettlementItems, deliveries, receivables, assetInOutLogs,
    subleaseNegotiations, registerRentedAsset, returnRentedAsset, createVendorClaimReceivable,
    hasPermission, refreshAllData, setActiveTab: setGlobalActiveTab
  } = useApp();
  
  const canSave = hasPermission('rent_asset', 'save');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 대사 상세 모달 상태 (임차처 거래명세서 원본 vs 자사 DB 1:1 대비)
  const [selectedReconcileDetail, setSelectedReconcileDetail] = useState<ReconcileResultItem | null>(null);

  // 💳 [실무 1:1 대조 & 지급 요청] 모달 상태
  const [showPaymentRequestModal, setShowPaymentRequestModal] = useState<boolean>(false);
  const [paymentBankAccount, setPaymentBankAccount] = useState<string>('');
  const [paymentDueDate, setPaymentDueDate] = useState<string>('');
  const [paymentMemo, setPaymentMemo] = useState<string>('');
  const [createdSettlementId, setCreatedSettlementId] = useState<string | null>(null);

  // 🚨 [고객사 구상 미수금 등록 모달] 상태
  const [showClaimModal, setShowClaimModal] = useState<boolean>(false);
  const [claimVendorName, setClaimVendorName] = useState<string>('');
  const [claimAssetNo, setClaimAssetNo] = useState<string>('');
  const [claimAmount, setClaimAmount] = useState<number>(0);
  const [claimCustomerId, setClaimCustomerId] = useState<string>('');
  const [claimContractId, setClaimContractId] = useState<string>('');
  const [claimInternalDescription, setClaimInternalDescription] = useState<string>('');
  const [claimDisplayName, setClaimDisplayName] = useState<string>('');
  const [claimOccurredDate, setClaimOccurredDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // 활성화 탭 상태: CURRENT (임차자산 대장 & 반납 관리), NEGOTIATION (전대 임차 협의), PROFIT_LEDGER (전대 손익 원장), RECONCILIATION (임차처 거래명세서 대사)
  const [activeTab, setActiveTab] = useState<'CURRENT' | 'NEGOTIATION' | 'PROFIT_LEDGER' | 'RECONCILIATION'>('CURRENT');
  const [profitLedgerSubTab, setProfitLedgerSubTab] = useState<'CONTRACT' | 'ASSET'>('CONTRACT');

  // ==========================================
  // [탭 2] 임차처 거래명세서 대사 (Reconciliation) 관련 상태
  // ==========================================
  const [selectedVendor, setSelectedVendor] = useState<string>('');
  const [selectedYm, setSelectedYm] = useState<string>(new Date().toISOString().slice(0, 7));
  const [statementRows, setStatementRows] = useState<VendorStatementRow[]>([]);
  const [selectedReconcileIds, setSelectedReconcileIds] = useState<string[]>([]);
  const [isSettling, setIsSettling] = useState<boolean>(false);
  const [reconcileStatusFilter, setReconcileStatusFilter] = useState('ALL');
  const [reconcileSearch, setReconcileSearch] = useState('');

  // 임차 자산(ownerType === 'RENTED') 전체 리스트
  const rentedAssets = assets.filter(a => a.ownerType === 'RENTED');

  // ── [전대 임차 협의] 전용 로컬 상태 ──
  const [selectedSubleaseId, setSelectedSubleaseId] = useState<string | null>(null);
  const [subleaseVendorId, setSubleaseVendorId] = useState<string>('');
  const [subleaseModelName, setSubleaseModelName] = useState<string>('');
  const [subleaseQuantity, setSubleaseQuantity] = useState<number>(1);
  const [subleaseMonthlyRate, setSubleaseMonthlyRate] = useState<number>(0);
  const [subleaseDailyRate, setSubleaseDailyRate] = useState<number>(0);
  const [subleaseStartDate, setSubleaseStartDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [subleaseEndDate, setSubleaseEndDate] = useState<string>('');
  const [subleaseTransportPayer, setSubleaseTransportPayer] = useState<'VENDOR' | 'OURS' | 'SPLIT'>('OURS');
  const [subleaseCustomerId, setSubleaseCustomerId] = useState<string>('');
  const [subleaseSiteName, setSubleaseSiteName] = useState<string>('');
  const [subleaseMemo, setSubleaseMemo] = useState<string>('');
  const [subleaseFilterStatus, setSubleaseFilterStatus] = useState<'ALL' | 'INQUIRY' | 'NEGOTIATING' | 'CONTRACTED' | 'CANCELLED'>('ALL');
  const [subleaseSearchQuery, setSubleaseSearchQuery] = useState<string>('');

  // 신규 전대 임차 협의 저장 핸들러
  const handleSaveSubleaseNegotiation = async () => {
    if (!subleaseVendorId) {
      showToast('원사(협력사)를 선택하십시오.', 'error');
      return;
    }
    if (!subleaseModelName) {
      showToast('요청 장비 모델을 선택 또는 입력하십시오.', 'error');
      return;
    }
    const vendor = vendors.find(v => v.id === subleaseVendorId);
    const newNego: SubleaseNegotiation = {
      id: `SN-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      vendorId: subleaseVendorId,
      vendorName: vendor?.name || '협력사',
      modelName: subleaseModelName,
      quantity: Number(subleaseQuantity) || 1,
      monthlyRate: Number(subleaseMonthlyRate) || 0,
      dailyRate: Number(subleaseDailyRate) || 0,
      startDate: subleaseStartDate,
      endDate: subleaseEndDate,
      transportPayer: subleaseTransportPayer,
      status: 'NEGOTIATING',
      targetCustomerId: subleaseCustomerId || undefined,
      targetSiteName: subleaseSiteName || undefined,
      memo: subleaseMemo,
      createdAt: new Date().toISOString()
    };

    const currentList = db.subleaseNegotiations || [];
    db.subleaseNegotiations = [newNego, ...currentList];
    await db.awaitPendingWrites();
    refreshAllData();
    showToast(`[${vendor?.name || '원사'}] 전대 임차 협의 건이 등록되었습니다.`);
    setSubleaseMemo('');
    setSubleaseSiteName('');
  };

  // 협의 완료 건을 임차 자산 대장으로 원클릭 등록
  const handleConvertSubleaseToAsset = async (nego: SubleaseNegotiation) => {
    if (!nego.modelName) return;
    const vendor = vendors.find(v => v.id === nego.vendorId);
    const product = products.find(p => p.modelName === nego.modelName);

    // 자산 대장에 임차 자산 등록
    const newAsset: Partial<Asset> = {
      assetNo: `R-${Math.floor(1000 + Math.random() * 9000)}`,
      modelName: nego.modelName,
      ownerType: 'RENTED',
      vendorId: nego.vendorId,
      renter: nego.vendorName,
      monthlyRentFee: nego.monthlyRate,
      dailyRentFee: nego.dailyRate,
      rentStart: nego.startDate,
      rentEnd: nego.endDate,
      status: 'AVAILABLE',
      manufactureYear: String(new Date().getFullYear())
    };

    await registerRentedAsset(newAsset as any);

    // 협의 상태를 CONTRACTED(계약체결)로 변경
    const updatedNegos = (db.subleaseNegotiations || []).map(n => {
      if (n.id === nego.id) {
        return {
          ...n,
          status: 'CONTRACTED' as const,
          registeredAssetId: newAsset.assetNo,
          updatedAt: new Date().toISOString()
        };
      }
      return n;
    });
    db.subleaseNegotiations = updatedNegos;
    await db.awaitPendingWrites();
    refreshAllData();
    showToast(`임차 자산 대장에 [${newAsset.assetNo} / ${nego.modelName}] 장비가 등록되었습니다.`);
  };

  // 토스트 알림 상태
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // 우측 슬라이드오버 Dossier 패널 상태
  const [selectedAssetForDossier, setSelectedAssetForDossier] = useState<Asset | null>(null);

  // 헬퍼: 자산의 임차처(원사) 상호명 추출 (vendorId 외래키 우선 매핑)
  const getAssetRenterName = (a: Asset): string => {
    if (a.vendorId) {
      const v = vendors.find(item => item.id === a.vendorId);
      if (v?.name) return v.name;
    }
    return a.renter || '미지정';
  };

  // 등록된 임차처(임차거래처) 목록 (알파벳/한글 오름차순 정렬)
  const renterVendors = React.useMemo(() => {
    const rentalVendorNames = vendors
      .filter(v => v.type === 'RENTAL' || (v.types && v.types.includes('RENTAL')))
      .map(v => v.name)
      .filter(Boolean);

    const existingRenters = rentedAssets
      .map(a => getAssetRenterName(a))
      .filter(name => Boolean(name) && name !== '미지정');
    const combined = Array.from(new Set([...rentalVendorNames, ...existingRenters]));
    return combined.sort((a, b) => a.localeCompare(b));
  }, [vendors, rentedAssets]);

  // 1:1 대사 계산 엔진 (3단계 스마트 매칭 & 5대 교차 검증)
  const reconcileResults: ReconcileResultItem[] = React.useMemo(() => {
    const results: ReconcileResultItem[] = [];
    const matchedAssetIds = new Set<string>();

    // 문자열 공백/하이픈/소문자 통일 정화 헬퍼
    const cleanStr = (s?: string) => (s || '').replace(/[\s\-_]/g, '').toLowerCase();

    // A. 임차처 거래명세서 행 기준으로 자사 DB 자산 대조 (오직 관리번호 기준 1:1 매칭)
    statementRows.forEach((row, idx) => {
      // 이미지 2 지원: 장비 임대료가 아닌 기타 수리비/세척비/도색비/운송비 등 항목
      if (row.itemType === 'REPAIR' || row.itemType === 'OTHER_FEE') {
        results.push({
          id: `recon-fee-${idx}`,
          status: 'UNREGISTERED',
          statusLabel: row.itemType === 'REPAIR' ? '🛠️ 기타/수리비' : '📦 기타 청구비',
          badgeClass: 'badge-info',
          statementRow: row,
          priceDiff: row.billedAmount,
          expectedAmount: 0,
          reason: row.memo || '장비 임대료 외 기타 청구 항목입니다 (수리비/세척비/도색비/운송비 등).'
        });
        return;
      }

      // 1단계: 관리번호(assetNo) 정밀 매칭 (시리얼번호/제조번호 일절 무시)
      let matched = rentedAssets.find(a => 
        a.assetNo && cleanStr(a.assetNo) === cleanStr(row.assetNo)
      );

      // 2단계: 관리번호 불일치 시 [모델명 + 임차처] 조합 2차 보조 추적
      if (!matched && row.modelName) {
        matched = rentedAssets.find(a => 
          cleanStr(a.modelName) === cleanStr(row.modelName) &&
          (!selectedVendor || cleanStr(getAssetRenterName(a)) === cleanStr(selectedVendor)) &&
          !matchedAssetIds.has(a.id)
        );
      }

      if (!matched) {
        // 🔴 미등록 청구 (자사 DB에 없는 장비)
        results.push({
          id: `recon-unreg-${idx}`,
          status: 'UNREGISTERED',
          statusLabel: '미등록 청구',
          badgeClass: 'badge-danger',
          statementRow: row,
          priceDiff: row.billedAmount,
          expectedAmount: 0,
          reason: '자사 DB 자산대장에 존재하지 않는 장비입니다. (유령 청구 위험)'
        });
      } else {
        matchedAssetIds.add(matched.id);

        // 일할/월할 약정 금액 계산 (자사 DB 기준)
        const expected = matched.monthlyRentFee || 0;
        const diff = row.billedAmount - expected;

        // 기간 대조
        const isPeriodMismatch = (matched.rentStart && matched.rentStart !== row.rentStart) ||
                                 (matched.rentEnd && matched.rentEnd !== row.rentEnd);

        if (isPeriodMismatch) {
          // 🟠 기간 불일치
          results.push({
            id: `recon-period-${idx}`,
            status: 'PERIOD_MISMATCH',
            statusLabel: '기간 불일치',
            badgeClass: 'badge-warning',
            statementRow: row,
            matchedAsset: matched,
            priceDiff: diff,
            expectedAmount: expected,
            reason: `자사 계약기간(${matched.rentStart || '~'}~${matched.rentEnd || '~'})과 임차처 청구기간이 다릅니다.`
          });
        } else if (Math.abs(diff) > 1000) {
          // 🟡 단가/금액 오차
          results.push({
            id: `recon-price-${idx}`,
            status: 'PRICE_MISMATCH',
            statusLabel: '금액 오차',
            badgeClass: 'badge-info',
            statementRow: row,
            matchedAsset: matched,
            priceDiff: diff,
            expectedAmount: expected,
            reason: diff > 0 ? `임차처 청구가 자사 약정액보다 ${diff.toLocaleString()}원 과다 청구됨.` : `임차처 임의 할인 적용 (${Math.abs(diff).toLocaleString()}원 차감).`
          });
        } else {
          // 🟢 완벽 일치
          results.push({
            id: `recon-match-${idx}`,
            status: 'MATCHED',
            statusLabel: '완벽 일치',
            badgeClass: 'badge-success',
            statementRow: row,
            matchedAsset: matched,
            priceDiff: 0,
            expectedAmount: expected,
            reason: '임차처 청구 금액 및 임차 기간이 자사 등록 정보와 100% 일치합니다.'
          });
        }
      }
    });

    // B. 선택된 임차처의 자사 임차 자산 중 당월 1일 이상 존재했으나 청구 누락된 장비 추출
    const [yearStr, monthStr] = selectedYm.split('-');
    const yearNum = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    const monthStart = `${selectedYm}-01`;
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
    const monthEnd = `${selectedYm}-${String(daysInMonth).padStart(2, '0')}`;

    const targetRented = rentedAssets.filter(a => {
      const matchesVendor = !selectedVendor || getAssetRenterName(a) === selectedVendor;
      const assetStart = a.rentStart || '1900-01-01';
      const assetEnd = a.actualRentReturnDate || a.rentEnd || '9999-12-31';
      const isOverlapped = (assetStart <= monthEnd) && (assetEnd >= monthStart);
      return matchesVendor && isOverlapped;
    });

    targetRented.forEach(asset => {
      if (!matchedAssetIds.has(asset.id)) {
        // 🔵 청구 누락 자산
        results.push({
          id: `recon-missing-${asset.id}`,
          status: 'MISSING_BILLING',
          statusLabel: '청구 누락',
          badgeClass: 'badge-secondary',
          matchedAsset: asset,
          priceDiff: -(asset.monthlyRentFee || 0),
          expectedAmount: asset.monthlyRentFee || 0,
          reason: '자사 대장에는 임차 가동 중이나, 임차처 거래명세서 청구 항목에서 누락되었습니다.'
        });
      }
    });

    return results;
  }, [statementRows, rentedAssets, selectedVendor]);

  const filteredReconcileResults = React.useMemo(() => {
    return reconcileResults.filter(item => {
      const matchStatus = reconcileStatusFilter === 'ALL' || item.status === reconcileStatusFilter;
      const term = reconcileSearch.toLowerCase();
      const assetNo = (item.statementRow?.assetNo || item.matchedAsset?.assetNo || '').toLowerCase();
      const modelName = (item.statementRow?.modelName || item.matchedAsset?.modelName || '').toLowerCase();
      const matchSearch = !term || assetNo.includes(term) || modelName.includes(term);
      return matchStatus && matchSearch;
    });
  }, [reconcileResults, reconcileStatusFilter, reconcileSearch]);

  // 대사 통계 KPI
  const statsRecon = React.useMemo(() => {
    const totalCount = statementRows.length;
    const totalBilled = statementRows.reduce((sum, r) => sum + r.billedAmount, 0);
    const matchedCount = reconcileResults.filter(r => r.status === 'MATCHED').length;
    const priceMismatchCount = reconcileResults.filter(r => r.status === 'PRICE_MISMATCH').length;
    const periodMismatchCount = reconcileResults.filter(r => r.status === 'PERIOD_MISMATCH').length;
    const unregisteredCount = reconcileResults.filter(r => r.status === 'UNREGISTERED').length;
    const missingCount = reconcileResults.filter(r => r.status === 'MISSING_BILLING').length;
    const totalDiffAmount = reconcileResults.reduce((sum, r) => sum + r.priceDiff, 0);

    return { totalCount, totalBilled, matchedCount, priceMismatchCount, periodMismatchCount, unregisteredCount, missingCount, totalDiffAmount };
  }, [statementRows, reconcileResults]);

  // ==========================================
  // 💰 [원천정보 기반 대차대조 전대 손익 원장] 계산 엔진
  // ==========================================
  // 1. 계약별 전대 손익 원장 (확정 청구서 매출 vs 매입세금계산서 원가 + 운송비)
  const subleaseContracts = React.useMemo(() => {
    const rentedAssetIds = new Set(rentedAssets.map(a => a.id));
    const rentedAssetNos = new Set(rentedAssets.map(a => a.assetNo));
    
    return contracts.map(c => {
      // 이 계약에 속한 임차 자산들 매핑
      const assignedRentedAssets = (c.assets || [])
        .filter(ca => ca.assetId && rentedAssetIds.has(ca.assetId))
        .map(ca => {
          const match = rentedAssets.find(a => a.id === ca.assetId);
          return { ca, match };
        });

      if (assignedRentedAssets.length === 0) return null;

      const customer = customers.find(cust => cust.id === c.customerId);
      const site = sites.find(s => s.id === c.siteId);

      // 확정 매출 청구액 (billings 중 이 contractId)
      const contractBillings = billings.filter(b => b.contractId === c.id && b.status !== 'REJECTED');
      const confirmedRevenue = contractBillings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);

      // 매입세금계산서 원가 (purchaseSettlementItems 중 이 임차자산들 대상)
      const assetIds = new Set(assignedRentedAssets.map(a => a.match?.id).filter(Boolean));
      const assetNos = new Set(assignedRentedAssets.map(a => a.match?.assetNo).filter(Boolean));
      let confirmedCost = 0;
      purchaseSettlementItems.forEach(item => {
        if (item.sourceId && (assetIds.has(item.sourceId) || assetNos.has(item.sourceId))) {
          confirmedCost += (item.amount || 0);
        }
      });
      // 만약 purchaseSettlementItems에 아직 매칭 전이면 약정 임차료로 보조 산출
      if (confirmedCost === 0) {
        assignedRentedAssets.forEach(a => {
          if (a.match?.monthlyRentFee) {
            confirmedCost += (a.match.monthlyRentFee || 0);
          }
        });
      }

      // 직송/회수 운송비 원가 (deliveries 중 이 contractId)
      const contractDeliveries = deliveries.filter(d => d.contractId === c.id && d.status !== 'CANCELLED');
      const freightCost = contractDeliveries.reduce((sum, d) => sum + (d.finalCost || d.deliveryCostConfirmed || d.deliveryCost || 0), 0);

      const netProfit = confirmedRevenue - (confirmedCost + freightCost);
      const marginRate = confirmedRevenue > 0 ? (netProfit / confirmedRevenue) * 100 : 0;

      return {
        contract: c,
        customer,
        site,
        assignedRentedAssets,
        confirmedRevenue,
        confirmedCost,
        freightCost,
        netProfit,
        marginRate
      };
    }).filter(Boolean) as {
      contract: any;
      customer: any;
      site: any;
      assignedRentedAssets: any[];
      confirmedRevenue: number;
      confirmedCost: number;
      freightCost: number;
      netProfit: number;
      marginRate: number;
    }[];
  }, [contracts, rentedAssets, customers, sites, billings, purchaseSettlementItems, deliveries]);

  // 2. 자산별 누적 손익 원장 (자산별 누적 청구액 vs 누적 매입원가)
  const assetProfitLedgers = React.useMemo(() => {
    return rentedAssets.map(a => {
      // 매출: billingDetails 중 assetId === a.id 또는 assetNo === a.assetNo
      const relatedBillingDetails = billingDetails.filter(bd => bd.assetId === a.id || bd.itemName?.includes(a.assetNo));
      const cumRevenue = relatedBillingDetails.reduce((sum, bd) => sum + (bd.amount || 0), 0) || (a.cumRentalFee || 0);

      // 매입원가: purchaseSettlementItems 중 sourceId === a.id || sourceId === a.assetNo
      const relatedPurchaseItems = purchaseSettlementItems.filter(pi => pi.sourceId === a.id || pi.sourceId === a.assetNo);
      const cumCost = relatedPurchaseItems.reduce((sum, pi) => sum + (pi.amount || 0), 0) || (a.monthlyRentFee || 0);

      // 운송비
      const relatedDeliveries = deliveries.filter(d => (d.assetIds && d.assetIds.includes(a.id)) || d.memo?.includes(a.assetNo));
      const freightCost = relatedDeliveries.reduce((sum, d) => sum + (d.finalCost || d.deliveryCostConfirmed || d.deliveryCost || 0), 0);

      const cumNetProfit = cumRevenue - (cumCost + freightCost);
      const marginRate = cumRevenue > 0 ? (cumNetProfit / cumRevenue) * 100 : 0;

      return {
        asset: a,
        cumRevenue,
        cumCost,
        freightCost,
        cumNetProfit,
        marginRate
      };
    });
  }, [rentedAssets, billingDetails, purchaseSettlementItems, deliveries]);

  // 거래명세서 파일 업로드 처리 핸들러 (엑셀 .xlsx / .xls 및 PDF .pdf 통합 범용 파서 연동)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const data = event.target?.result as ArrayBuffer;

        if (isPdf) {
          // PDF 파일 텍스트 정밀 파싱 서비스 연동 (현대렌탈 등 지원)
          const parseResult = await parsePdfStatement(data, selectedYm);

          if (parseResult.detectedVendor) {
            setSelectedVendor(parseResult.detectedVendor);
          }

          setStatementRows(parseResult.rows);
          setSelectedReconcileIds(parseResult.rows.map(r => r.id));

          const vendorNotice = parseResult.detectedVendor ? `[${parseResult.detectedVendor}]` : 'PDF 거래명세서';
          showToast(`${vendorNotice} PDF 파싱 완료 (${parseResult.totalParsedCount}건, ₩${parseResult.totalParsedAmount.toLocaleString()}원)`);
        } else {
          // 엑셀 파일 (.xlsx / .xls) 스마트 범용 파서 연동
          const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          const parseResult = parseVendorStatementExcel(worksheet, selectedYm);

          if (parseResult.detectedVendor) {
            setSelectedVendor(parseResult.detectedVendor);
          }

          setStatementRows(parseResult.rows);
          setSelectedReconcileIds(parseResult.rows.map(r => r.id));

          const vendorNotice = parseResult.detectedVendor ? `[${parseResult.detectedVendor}]` : '거래명세서';
          const headerNotice = parseResult.headerRowIndex >= 0 ? ` (헤더 ${parseResult.headerRowIndex + 1}행 인식)` : '';
          showToast(`${vendorNotice} 엑셀 업로드 완료${headerNotice} (${parseResult.totalParsedCount}건, ₩${parseResult.totalParsedAmount.toLocaleString()}원)`);
        }
      } catch (err: any) {
        showToast(`명세서 파일 파싱 오류: ${err?.message || err}`, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 샘플 거래명세서 빠른 생성 (데모 시연용 - 선택된 임차처 우선 반영)
  const handleLoadSampleStatement = () => {
    const targetAssets = selectedVendor 
      ? rentedAssets.filter(a => a.renter === selectedVendor)
      : rentedAssets;

    if (targetAssets.length === 0 && rentedAssets.length === 0) {
      showToast('등록된 자사 임차자산이 없습니다.', 'error');
      return;
    }

    const assetsToUse = targetAssets.length > 0 ? targetAssets : rentedAssets;

    const samples: VendorStatementRow[] = assetsToUse.slice(0, 5).map((a, idx) => {
      // 데모를 위해 의도적으로 금액 오차 1건 생성
      const billed = idx === 1 ? (a.monthlyRentFee || 300000) + 50000 : (a.monthlyRentFee || 300000);
      return {
        id: `sample-${idx}`,
        assetNo: a.assetNo,
        serialNo: a.serialNo,
        modelName: a.modelName,
        rentStart: a.rentStart || `${selectedYm}-01`,
        rentEnd: a.rentEnd || `${selectedYm}-28`,
        billedAmount: billed,
        memo: idx === 1 ? '원사 청구 단가 인상분 반영' : '정상 월 임차료',
        itemType: 'EQUIPMENT'
      };
    });

    // 🔴 1건의 유령 청구 미등록 자산 추가
    samples.push({
      id: `sample-ghost`,
      assetNo: 'R-GHOST-99',
      serialNo: 'SN-UNKNOWN-999',
      modelName: 'S-1212 (유령장비)',
      rentStart: `${selectedYm}-01`,
      rentEnd: `${selectedYm}-28`,
      billedAmount: 450000,
      memo: '자사 대장에 없는 원사 단독 청구 건',
      itemType: 'EQUIPMENT'
    });

    // 🛠️ 이미지 2 스타일: 장비 렌탈 외 중간 기타 수리비/세척비 샘플 항목 추가
    samples.push({
      id: `sample-repair`,
      assetNo: '기타/수리비',
      modelName: '기타비용',
      rentStart: `${selectedYm}-01`,
      rentEnd: `${selectedYm}-28`,
      billedAmount: 350000,
      taxAmount: 35000,
      totalAmount: 385000,
      memo: '수리비(외관오염 세척/도색비)',
      itemType: 'REPAIR',
      seq: 115,
      contractNo: '2612002530'
    });

    // 🧹 하이로드 이미지 2 스타일: 중간 청소비 렌탈료 외 청구 샘플 항목 추가
    samples.push({
      id: `sample-cleaning`,
      assetNo: '기타/청소비',
      modelName: '청소비',
      rentStart: `${selectedYm}-05-26`,
      rentEnd: `${selectedYm}-05-26`,
      billedAmount: 1200000,
      taxAmount: 120000,
      totalAmount: 1320000,
      memo: '청소비 (4건 × ₩300,000)',
      itemType: 'OTHER_FEE',
      seq: 61
    });

    // 🏢 하은(주) 양식 스타일: 고소작업대 10M 샘플 항목 추가
    samples.push({
      id: `sample-haeun`,
      assetNo: 'J6100',
      modelName: '고소작업대 10M',
      rentStart: `${selectedYm}-01`,
      rentEnd: `${selectedYm}-31`,
      billedAmount: 360000,
      taxAmount: 36000,
      totalAmount: 396000,
      memo: '하은(주) 정기 임대료',
      itemType: 'EQUIPMENT'
    });

    setStatementRows(samples);
    setSelectedReconcileIds(samples.map(s => s.id));
  };

  // 대사 양식 다운로드
  const handleDownloadTemplate = () => {
    const templateData = [
      { 관리번호: 'R-001', 제조번호: 'SN-12345', 모델명: 'S-1212', 임차시작일: '2026-08-01', 임차종료일: '2026-08-31', 청구금액: 350000, 비고: '월 정기 임차료' },
      { 관리번호: 'R-002', 제조번호: 'SN-67890', 모델명: 'Z-3422', 임차시작일: '2026-08-01', 임차종료일: '2026-08-31', 청구금액: 400000, 비고: '월 정기 임차료' }
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '원사_거래명세서_양식');
    XLSX.writeFile(wb, '원사_임차료_거래명세서_대사양식.xlsx');
  };

  // 💳 선택된 대사 항목에 대한 [매입 정산 생성 & 지급 요청] 모달 열기
  const handleOpenPaymentRequestModal = () => {
    if (!canSave) {
      showToast('매입 정산 승인 권한이 없습니다.', 'error');
      return;
    }

    const targetRows = statementRows.filter(r => selectedReconcileIds.includes(r.id));
    if (targetRows.length === 0) {
      showToast('지급 요청할 대사 항목을 선택해 주세요.', 'error');
      return;
    }

    const vendorName = selectedVendor || (targetRows[0]?.assetNo ? (rentedAssets.find(a => a.assetNo === targetRows[0].assetNo)?.renter || '기타 원사') : '기타 원사');
    const matchedVendorMaster = vendors.find(v => v.name === vendorName);

    // 계좌번호 자동 세팅
    const defaultBank = matchedVendorMaster?.bankAccount || '기업은행 258-060890-01-011';
    setPaymentBankAccount(defaultBank);

    // 당월 말일 계산
    const [y, m] = selectedYm.split('-');
    const lastDay = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
    setPaymentDueDate(`${selectedYm}-${String(lastDay).padStart(2, '0')}`);

    setPaymentMemo(`[임차료 대사 완결] ${selectedYm} ${vendorName} 매입 정산 ${targetRows.length}건 지급 요청`);
    setCreatedSettlementId(null);
    setShowPaymentRequestModal(true);
  };

  // 🚀 매입 정산 생성 및 지급 요청 실제 실행
  const handleExecutePaymentRequest = async () => {
    const targetRows = statementRows.filter(r => selectedReconcileIds.includes(r.id));
    if (targetRows.length === 0) return;

    const partialTotalBilled = targetRows.reduce((sum, r) => sum + r.billedAmount, 0);
    const vendorName = selectedVendor || (targetRows[0]?.assetNo ? (rentedAssets.find(a => a.assetNo === targetRows[0].assetNo)?.renter || '기타 원사') : '기타 원사');
    const nowStr = new Date().toISOString();

    setIsSettling(true);
    try {
      // 1. PurchaseSettlement 정산서 생성 (status: 'CONFIRMED' -> 지급 결제 요청 상태)
      const settlement = db.insertRow<PurchaseSettlement>('purchaseSettlements', {
        settlementYm: selectedYm,
        settlementType: 'EQUIPMENT_LEASE',
        vendorName: vendorName,
        totalAmount: partialTotalBilled,
        paidAmount: 0,
        status: 'CONFIRMED',
        confirmedAt: nowStr,
        memo: paymentMemo || `[임차료 대사 완결] ${targetRows.length}건 승인 (입금계좌: ${paymentBankAccount})`,
        createdAt: nowStr,
        updatedAt: nowStr
      });

      // 2. 1:1 매칭 상세 항목 생성
      targetRows.forEach(row => {
        const matched = rentedAssets.find(a => a.assetNo === row.assetNo);
        db.insertRow<PurchaseSettlementItem>('purchaseSettlementItems', {
          settlementId: settlement.id,
          sourceType: 'EQUIPMENT_LEASE',
          sourceId: matched ? matched.id : row.assetNo,
          itemDescription: `[1:1 매칭] ${row.modelName || row.assetNo} (관리번호: ${row.assetNo}, 기간: ${row.rentStart}~${row.rentEnd})`,
          quantity: 1,
          unitPrice: row.billedAmount,
          amount: row.billedAmount,
          createdAt: nowStr
        });
      });

      await db.awaitPendingWrites();

      setCreatedSettlementId(settlement.id);

      // 승인 완료된 행 제거
      const remainingRows = statementRows.filter(r => !selectedReconcileIds.includes(r.id));
      setStatementRows(remainingRows);
      setSelectedReconcileIds([]);
    } catch (err: any) {
      showToast(`매입 정산 오류: ${err?.message || err}`, 'error');
    } finally {
      setIsSettling(false);
    }
  };

  // ==========================================
  // [탭 2] 임차자산 대장 현황 (Current Assets) 관련 상태
  // ==========================================
  const [searchQuery, setSearchQuery] = useState('');
  const [renterQuery, setRenterQuery] = useState('');
  const [startDateQuery, setStartDateQuery] = useState('');
  const [endDateQuery, setEndDateQuery] = useState('');
  const [returnQuery, setReturnQuery] = useState('ALL');

  const [showModal, setShowModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Partial<Asset> | null>(null);

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnAssetId, setReturnAssetId] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);

  // 반납 배차 옵션 상태
  const [isDispatchRequested, setIsDispatchRequested] = useState(false);
  const [returnOrigin, setReturnOrigin] = useState('');
  const [returnDestination, setReturnDestination] = useState('');
  const [returnVehicleType, setReturnVehicleType] = useState('3.5T');
  const [returnCost, setReturnCost] = useState(70000);

  const filteredAssets = rentedAssets.filter(a => {
    const rName = getAssetRenterName(a);
    const matchesSearch = a.assetNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          a.modelName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          rName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRenter = !renterQuery || rName.toLowerCase().includes(renterQuery.toLowerCase());
    const matchesStartDate = !startDateQuery || (a.rentEnd && a.rentEnd >= startDateQuery);
    const matchesEndDate = !endDateQuery || (a.rentStart && a.rentStart <= endDateQuery);
    const isReturned = Boolean(a.actualRentReturnDate) || a.status === 'RENTED_RETURNED';
    const matchesReturn = returnQuery === 'ALL' ? true :
                          returnQuery === 'RETURNED' ? isReturned :
                          !isReturned;

    return matchesSearch && matchesRenter && matchesStartDate && matchesEndDate && matchesReturn;
  });

  // 모델명 알파벳/한글 오름차순 정렬
  const sortedProducts = React.useMemo(() => {
    return [...products].sort((a, b) => (a.modelName || '').localeCompare(b.modelName || ''));
  }, [products]);

  // 임차 만료예정일 자동 계산 헬퍼 (시작일로부터 30일 뒤)
  const calcRentEnd = (startStr: string): string => {
    if (!startStr) return '';
    const d = new Date(startStr);
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  };

  // 반납 지연일 및 초과 검사 헬퍼 (반납 완료 장비는 지연 및 경보 대상에서 100% 제외)
  const calculateDelayDays = (asset: Asset): number => {
    if (!asset.rentEnd) return 0;
    if (asset.actualRentReturnDate || asset.status === 'RENTED_RETURNED') return 0;
    const plannedEnd = new Date(asset.rentEnd);
    const actualEnd = new Date();
    plannedEnd.setHours(0,0,0,0);
    actualEnd.setHours(0,0,0,0);
    const diffTime = actualEnd.getTime() - plannedEnd.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  const isSubleaseOverdue = (asset: Asset): boolean => {
    if (asset.actualRentReturnDate || asset.status === 'RENTED_RETURNED') return false;
    if (!asset.rentEnd || !asset.contractEnd) return false;
    const leaseEnd = new Date(asset.rentEnd);
    const subleaseEnd = new Date(asset.contractEnd);
    leaseEnd.setHours(0,0,0,0);
    subleaseEnd.setHours(0,0,0,0);
    return subleaseEnd.getTime() > leaseEnd.getTime();
  };

  const handleOpenAdd = () => {
    const today = new Date().toISOString().split('T')[0];
    setEditingAsset({
      modelName: sortedProducts[0]?.modelName || '',
      assetNo: '',
      serialNo: '',
      manufacturer: '',
      renter: renterVendors[0] || '',
      rentStart: today,
      rentEnd: calcRentEnd(today),
      monthlyRentFee: 0,
      dailyRentFee: 0,
      memo1: ''
    });
    setShowModal(true);
  };

  const handleOpenEdit = (a: Asset) => {
    setEditingAsset(a);
    setShowModal(true);
  };

  const handleOpenReturn = (asset: Asset) => {
    if (asset.status === 'RENTED') {
      showToast(`자산 [${asset.assetNo}]은 현재 고객사에 대여중(RENTED)입니다. 회수 입고 전에는 원사 반납이 불가합니다.`, 'error');
      return;
    }
    setReturnAssetId(asset.id);
    setReturnDate(new Date().toISOString().split('T')[0]);
    const cust = customers.find(c => c.id === asset.currentCustomerId);
    setReturnOrigin(cust ? `${cust.name} 현장` : '당사 보관소');
    setReturnDestination(asset.renter ? `${asset.renter} (소유원사)` : '원사 보관소');
    setIsDispatchRequested(false);
    setShowReturnModal(true);
  };

  const handleSubmitAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !editingAsset || !editingAsset.assetNo || !editingAsset.modelName) {
      showToast('필수 입력을 확인해 주세요.', 'error');
      return;
    }
    if (editingAsset.rentStart && editingAsset.rentEnd && editingAsset.rentStart > editingAsset.rentEnd) {
      showToast('임차 시작일이 만료예정일보다 늦을 수 없습니다.', 'error');
      return;
    }
    if (!editingAsset.renter) {
      showToast('소유 원사를 선택해 주세요.', 'error');
      return;
    }
    try {
      const calculatedDailyFee = editingAsset.dailyRentFee || Math.floor((editingAsset.monthlyRentFee || 0) / 30);
      await registerRentedAsset({
        ...editingAsset,
        dailyRentFee: calculatedDailyFee
      });
      showToast(`임차 자산 [${editingAsset.assetNo}] 등록/수정이 완료되었습니다.`);
      setShowModal(false);
      setEditingAsset(null);
    } catch (err: any) {
      showToast(`처리 오류: ${err?.message || err}`, 'error');
    }
  };

  const handleConfirmReturn = async () => {
    if (!returnAssetId || !returnDate) {
      showToast('반납 일자를 입력해주세요.', 'error');
      return;
    }
    const target = assets.find(a => a.id === returnAssetId);
    if (!target) return;
    if (target.status === 'RENTED') {
      showToast(`자산 [${target.assetNo}]은 현재 고객사에 대여중(RENTED)입니다. 원사 반납이 불가합니다.`, 'error');
      return;
    }

    if (isDispatchRequested) {
      db.insertRow<Delivery>('deliveries', {
        contractId: target.currentCustomerId || '',
        type: 'RETURN',
        status: 'PENDING',
        requestDate: new Date().toISOString().split('T')[0],
        vehicleType: returnVehicleType,
        deliveryCost: returnCost,
        originAddress: returnOrigin,
        destinationAddress: returnDestination,
        memo: `[임차자산 반납 배차] 장비번호: ${target.assetNo} (${target.modelName}) / 원사: ${target.renter || '미지정'}`,
        isCostSettled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    await returnRentedAsset(returnAssetId, returnDate);
    await db.awaitPendingWrites();
    showToast(`임차 자산 [${target.assetNo}] 반납 처리가 완결되었습니다.`);
    setShowReturnModal(false);
  };

  // 🔄 재임차 활성화 핸들러 (과거 반납 자산 재활용 - 신규 채번 방지)
  const handleOpenReactivate = (a: Asset) => {
    const today = new Date().toISOString().split('T')[0];
    setEditingAsset({
      ...a,
      rentStart: today,
      rentEnd: calcRentEnd(today),
      actualRentReturnDate: '',
      status: 'AVAILABLE'
    });
    setShowModal(true);
  };

  // 🚨 고객사 구상 미수금 등록 모달 오픈
  const handleOpenClaimModal = (item: ReconcileResultItem) => {
    const row = item.statementRow;
    const vendor = selectedVendor || item.matchedAsset?.renter || '기타 원사';
    const assetNo = row?.assetNo || item.matchedAsset?.assetNo || '';
    const amount = row?.billedAmount || Math.abs(item.priceDiff) || 0;

    // 장비번호 기반 매칭되는 최근 활성 계약 자동 탐색
    const matchedContract = contracts.find(c => 
      c.status !== 'COMPLETED' && (c.assets || []).some(ca => (item.matchedAsset && ca.assetId === item.matchedAsset.id))
    );

    setClaimVendorName(vendor);
    setClaimAssetNo(assetNo);
    setClaimAmount(amount);
    setClaimContractId(matchedContract?.id || '');
    setClaimCustomerId(matchedContract?.customerId || '');
    setClaimInternalDescription(`[타사 구상금] ${vendor} ${assetNo} ${row?.memo || '파손/세척/부대비용'}`);
    setClaimDisplayName(`현장 장비 정비 및 세척 비용 (${assetNo})`);
    setClaimOccurredDate(new Date().toISOString().split('T')[0]);
    setShowClaimModal(true);
  };

  // 🚨 고객사 구상 미수금 등록 확정
  const handleSubmitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimCustomerId) {
      showToast('귀책 고객사를 선택해 주세요.', 'error');
      return;
    }
    if (claimAmount <= 0) {
      showToast('구상 금액은 0원보다 커야 합니다.', 'error');
      return;
    }

    try {
      await createVendorClaimReceivable({
        contractId: claimContractId || undefined,
        customerId: claimCustomerId,
        vendorName: claimVendorName,
        assetNo: claimAssetNo,
        totalAmount: claimAmount,
        internalDescription: claimInternalDescription,
        displayName: claimDisplayName || claimInternalDescription,
        occurredDate: claimOccurredDate
      });

      showToast(`외상미수금 대장에 타사 구상채권(₩${claimAmount.toLocaleString()}원)이 등록되었습니다.`);
      setShowClaimModal(false);
    } catch (err: any) {
      showToast(`구상 미수금 등록 실패: ${err?.message || err}`, 'error');
    }
  };

  // 📥 임차자산 대장 엑셀 내보내기
  const handleExportRentedAssetsExcel = () => {
    const data = filteredAssets.map((a, idx) => ({
      'No': idx + 1,
      '관리번호': a.assetNo || '-',
      '원사 원래번호': a.vendorAssetNo || '-',
      '모델명': a.modelName || '-',
      '임차처(원사)': a.renter || '-',
      '임차 시작일': a.rentStart || '-',
      '임차 만료예정일': a.rentEnd || '-',
      '월 임차료(원)': a.monthlyRentFee || 0,
      '실제 반납일': a.actualRentReturnDate || '-',
      '현재 가동상태': a.actualRentReturnDate ? '반납완료' : (a.status === 'RENTED' || a.currentCustomerId ? '대여중(현장가동)' : '입고보관중')
    }));
    exportToExcel(data, `임차자산_대장_목록_${new Date().toISOString().split('T')[0]}`, '임차자산대장');
  };

  // 📥 전대 손익 원장 엑셀 내보내기
  const handleExportProfitLedgerExcel = () => {
    if (profitLedgerSubTab === 'CONTRACT') {
      const data = subleaseContracts.map((sc, idx) => ({
        'No': idx + 1,
        '계약번호': sc.contract.contractNo,
        '고객사명': sc.customer?.name || '고객 미지정',
        '현장명': sc.site?.name || '현장 미지정',
        '투입 전대장비': sc.assignedRentedAssets.map(ara => `${ara.ca.assetId ? ara.match?.assetNo : ''} (${ara.match?.renter || '원사'})`).join(', '),
        '확정 청구액(매출, 원)': sc.confirmedRevenue,
        '매입 임차료 원가(원)': sc.confirmedCost,
        '직송 운송비 원가(원)': sc.freightCost,
        '순마진(스프레드, 원)': sc.netProfit,
        '마진율(%)': `${sc.marginRate.toFixed(1)}%`,
        '대차대조 상태': '무결성 일치'
      }));
      exportToExcel(data, `계약별_전대손익원장_${new Date().toISOString().split('T')[0]}`, '계약별전대손익');
    } else {
      const data = assetProfitLedgers.map((apl, idx) => ({
        'No': idx + 1,
        '관리번호': apl.asset.assetNo,
        '원사 원래번호': apl.asset.vendorAssetNo || '-',
        '모델명': apl.asset.modelName,
        '임차처(원사)': apl.asset.renter || '미지정',
        '누적 렌탈 청구액(매출, 원)': apl.cumRevenue,
        '누적 지급 임차료(원가, 원)': apl.cumCost,
        '누적 운송비(원)': apl.freightCost,
        '누적 공헌이익(원)': apl.cumNetProfit,
        '수익 기여율(%)': `${apl.marginRate.toFixed(1)}%`
      }));
      exportToExcel(data, `자산별_전대손익원장_${new Date().toISOString().split('T')[0]}`, '자산별전대손익');
    }
  };

  // 📥 원사 거래명세서 대사 결과 엑셀 내보내기
  const handleExportReconcileExcel = () => {
    const data = filteredReconcileResults.map((r, idx) => ({
      'No': idx + 1,
      '대사상태': r.statusLabel,
      '관리번호': r.statementRow?.assetNo || r.matchedAsset?.assetNo || '-',
      '원사 원래번호': r.matchedAsset?.vendorAssetNo || '-',
      '모델명': r.statementRow?.modelName || r.matchedAsset?.modelName || '-',
      '원사 청구금액': r.statementRow?.billedAmount || 0,
      '자사 약정금액': r.expectedAmount || 0,
      '대차 차액': r.priceDiff,
      '소유 원사': selectedVendor || (r.matchedAsset ? getAssetRenterName(r.matchedAsset) : '-'),
      '원사 청구기간': r.statementRow ? `${r.statementRow.rentStart} ~ ${r.statementRow.rentEnd}` : '-',
      '자사 가동기간': r.matchedAsset ? `${r.matchedAsset.rentStart || '~'} ~ ${r.matchedAsset.rentEnd || '~'}` : '-',
      '불일치 사유': r.reason
    }));
    exportToExcel(data, `임차처_명세서_대사결과_${selectedYm}_${new Date().toISOString().split('T')[0]}`, '대사결과');
    showToast('대사 결과 엑셀 파일이 다운로드되었습니다.');
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1600px', margin: '0 auto' }}>
      
      {/* 1. 상단 메뉴 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
            <Layers className="text-primary" size={22} /> 임차 자산 관리 및 전대 손익 정산
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            외부 원사 임차 장비 라이프사이클, 대차대조 손익 원장 및 거래명세서 1:1 대사 승인 시스템
          </p>
        </div>

        {activeTab === 'CURRENT' && canSave && (
          <button className="btn-primary" onClick={handleOpenAdd} style={{ padding: '8px 14px', fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={15} /> 임차자산 신규 등록
          </button>
        )}
      </div>

      {/* 2. 상단 4대 메인 탭 (헌장 3.1 무수식어 건조 표준 준수) */}
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', marginBottom: '20px', gap: '8px' }}>
        <button
          onClick={() => setActiveTab('CURRENT')}
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: '700',
            border: 'none',
            borderBottom: activeTab === 'CURRENT' ? '3px solid var(--primary)' : '3px solid transparent',
            backgroundColor: activeTab === 'CURRENT' ? 'var(--primary-light)' : 'transparent',
            color: activeTab === 'CURRENT' ? 'var(--primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            borderRadius: '8px 8px 0 0',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap'
          }}
        >
          <Layers size={15} /> 임차자산 대장
        </button>

        <button
          onClick={() => setActiveTab('NEGOTIATION')}
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: '700',
            border: 'none',
            borderBottom: activeTab === 'NEGOTIATION' ? '3px solid var(--primary)' : '3px solid transparent',
            backgroundColor: activeTab === 'NEGOTIATION' ? 'var(--primary-light)' : 'transparent',
            color: activeTab === 'NEGOTIATION' ? 'var(--primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            borderRadius: '8px 8px 0 0',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap'
          }}
        >
          <Building size={15} /> 전대 임차 협의
          {(subleaseNegotiations || []).filter(s => s.status === 'NEGOTIATING').length > 0 && (
            <span style={{
              backgroundColor: '#3b82f6', color: '#fff', fontSize: '11px', fontWeight: 800,
              padding: '1px 6px', borderRadius: '10px', marginLeft: '2px'
            }}>
              {(subleaseNegotiations || []).filter(s => s.status === 'NEGOTIATING').length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('PROFIT_LEDGER')}
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: '700',
            border: 'none',
            borderBottom: activeTab === 'PROFIT_LEDGER' ? '3px solid var(--primary)' : '3px solid transparent',
            backgroundColor: activeTab === 'PROFIT_LEDGER' ? 'var(--primary-light)' : 'transparent',
            color: activeTab === 'PROFIT_LEDGER' ? 'var(--primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            borderRadius: '8px 8px 0 0',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap'
          }}
        >
          <CreditCard size={15} /> 전대 손익 원장
        </button>

        <button
          onClick={() => setActiveTab('RECONCILIATION')}
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: '700',
            border: 'none',
            borderBottom: activeTab === 'RECONCILIATION' ? '3px solid var(--primary)' : '3px solid transparent',
            backgroundColor: activeTab === 'RECONCILIATION' ? 'var(--primary-light)' : 'transparent',
            color: activeTab === 'RECONCILIATION' ? 'var(--primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            borderRadius: '8px 8px 0 0',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap'
          }}
        >
          <FileSpreadsheet size={15} /> 거래명세서 대사
        </button>
      </div>

      {/* 📊 전대/임차 장비 보유 및 월 임차료 실시간 요약 바 */}
      {(() => {
        const activeRentedList = rentedAssets.filter(a => !a.actualRentReturnDate && a.status !== 'RENTED_RETURNED');
        const returnedList = rentedAssets.filter(a => Boolean(a.actualRentReturnDate) || a.status === 'RENTED_RETURNED');
        const totalMonthlyRentCost = activeRentedList.reduce((sum, a) => sum + (a.monthlyRentFee || 0), 0);

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '16px' }}>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>가동중인 전대장비</span>
              <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>{activeRentedList.length}대</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>월 총 임차료 지출</span>
              <strong style={{ fontSize: '15px', color: '#EF4444' }}>₩{totalMonthlyRentCost.toLocaleString()}원</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>반납 완료 장비</span>
              <strong style={{ fontSize: '15px', color: 'var(--text-muted)' }}>{returnedList.length}대</strong>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* 탭 1: 임차처 거래명세서 대사 & 매입 정산 (Reconciliation) */}
      {/* ========================================================================= */}
      {activeTab === 'RECONCILIATION' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* A. 툴바 & 엑셀 업로드 제어 패널 */}
          <div className="card" style={{ padding: '16px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              
              {/* 좌측: 임차처 & 청구월 필터 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>임차처 선택</label>
                  <select
                    value={selectedVendor}
                    onChange={e => setSelectedVendor(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', fontWeight: '600', minWidth: '160px' }}
                  >
                    <option value="">전체 임차처 대조</option>
                    {renterVendors.map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>청구 정산년월</label>
                  <input
                    type="month"
                    value={selectedYm}
                    onChange={e => setSelectedYm(e.target.value)}
                    style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', fontWeight: '600' }}
                  />
                </div>
              </div>

              {/* 우측: 엑셀 파일 업로드 & 양식 다운로드 & 샘플 버튼 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".xlsx, .xls, .pdf"
                  style={{ display: 'none' }}
                />

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-primary"
                  style={{ padding: '8px 14px', fontSize: '12px', fontWeight: '700', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Upload size={14} /> 📄 임차처 거래명세서 업로드 (엑셀 / PDF)
                </button>

                <button
                  onClick={handleLoadSampleStatement}
                  style={{ padding: '8px 12px', fontSize: '12px', fontWeight: '700', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                  title="등록된 자산 기반 테스트 명세서 자동 생성"
                >
                  <RefreshCw size={13} /> ✨ 샘플 명세서 빠른 대사 시연
                </button>

                <button
                  onClick={handleDownloadTemplate}
                  style={{ padding: '8px 12px', fontSize: '12px', fontWeight: '600', borderRadius: '6px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  <Download size={13} /> 양식 다운로드
                </button>
              </div>

            </div>
          </div>

          {/* B. 대사 결산 요약 KPI 카드뉴스 (다크/라이트 테마 완벽 응응) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            
            <div style={{ backgroundColor: 'var(--bg-card)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '700', marginBottom: '4px' }}>총 임차처 청구 명세</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)' }}>{statsRecon.totalCount} 건</div>
              <div style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: '700', marginTop: '2px' }}>청구액: ₩{statsRecon.totalBilled.toLocaleString()}</div>
            </div>

            <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              <div style={{ fontSize: '11px', color: '#10b981', fontWeight: '700', marginBottom: '4px' }}>🟢 완벽 일치</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#10b981' }}>{statsRecon.matchedCount} 건</div>
              <div style={{ fontSize: '11px', color: '#10b981', marginTop: '2px' }}>단가·기간 100% 검증 통과</div>
            </div>

            <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
              <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: '700', marginBottom: '4px' }}>🟡 단가/금액 오차</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#f59e0b' }}>{statsRecon.priceMismatchCount} 건</div>
              <div style={{ fontSize: '11px', color: statsRecon.totalDiffAmount > 0 ? '#ef4444' : '#10b981', fontWeight: '700', marginTop: '2px' }}>
                차액: {statsRecon.totalDiffAmount > 0 ? `+${statsRecon.totalDiffAmount.toLocaleString()}` : statsRecon.totalDiffAmount.toLocaleString()}원
              </div>
            </div>

            <div style={{ backgroundColor: 'rgba(249, 115, 22, 0.1)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(249, 115, 22, 0.3)' }}>
              <div style={{ fontSize: '11px', color: '#f97316', fontWeight: '700', marginBottom: '4px' }}>🟠 기간 불일치</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#f97316' }}>{statsRecon.periodMismatchCount} 건</div>
              <div style={{ fontSize: '11px', color: '#f97316', marginTop: '2px' }}>계약/반납 기간 미스매치</div>
            </div>

            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
              <div style={{ fontSize: '11px', color: '#ef4444', fontWeight: '700', marginBottom: '4px' }}>🔴 미등록 청구</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#ef4444' }}>{statsRecon.unregisteredCount} 건</div>
              <div style={{ fontSize: '11px', color: '#ef4444', fontWeight: '700', marginTop: '2px' }}>유령 장비 청구 주의</div>
            </div>

            <div style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
              <div style={{ fontSize: '11px', color: '#3b82f6', fontWeight: '700', marginBottom: '4px' }}>🔵 청구 누락 자산</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#3b82f6' }}>{statsRecon.missingCount} 건</div>
              <div style={{ fontSize: '11px', color: '#3b82f6', marginTop: '2px' }}>자사 임차 중 청구 누락</div>
            </div>

          </div>
          
          {/* 필터 UI */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', backgroundColor: 'var(--bg-card)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>대사 결과</label>
              <select value={reconcileStatusFilter} onChange={e => setReconcileStatusFilter(e.target.value)} style={{ padding: '5px', fontSize: '12px' }}>
                <option value="ALL">전체</option>
                <option value="MATCHED">완벽 일치</option>
                <option value="PRICE_MISMATCH">금액 오차</option>
                <option value="PERIOD_MISMATCH">기간 불일치</option>
                <option value="UNREGISTERED">미등록 청구</option>
                <option value="MISSING_BILLING">청구 누락</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>검색</label>
              <input type="text" value={reconcileSearch} onChange={e => setReconcileSearch(e.target.value)}
                placeholder="관리번호 / 모델명" style={{ padding: '5px 8px', fontSize: '12px', width: '160px' }} />
            </div>
            {(reconcileStatusFilter !== 'ALL' || reconcileSearch) && (
              <button type="button" onClick={() => { setReconcileStatusFilter('ALL'); setReconcileSearch(''); }}
                style={{ padding: '5px 10px', fontSize: '11px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', alignSelf: 'flex-end' }}>초기화</button>
            )}
          </div>

          {/* C. 1:1 대사 교차 대조 테이블 (Reconciliation Table) */}
          <div className="card" style={{ border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden', backgroundColor: 'var(--bg-card)' }}>
            <div style={{ padding: '12px 16px', backgroundColor: 'var(--bg-card-header)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-main)' }}>
                  <CheckCircle size={15} className="text-success" /> 임차처 명세서 ↔ 자사 DB 대조 결과 ({filteredReconcileResults.length}건)
                </h3>
                
                {statementRows.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => {
                        const matchedIds = filteredReconcileResults.filter(r => r.status === 'MATCHED' && r.statementRow).map(r => r.statementRow!.id);
                        setSelectedReconcileIds(matchedIds);
                      }}
                      style={{ padding: '3px 8px', fontSize: '11px', fontWeight: 'bold', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '4px', cursor: 'pointer' }}
                      title="🟢 일치 건 선택"
                    >
                      🟢 일치 건만 빠른 선택 ({statsRecon.matchedCount}건)
                    </button>
                    <button
                      onClick={() => {
                        if (selectedReconcileIds.length === statementRows.length) {
                          setSelectedReconcileIds([]);
                        } else {
                          setSelectedReconcileIds(statementRows.map(r => r.id));
                        }
                      }}
                      style={{ padding: '3px 8px', fontSize: '11px', fontWeight: 'bold', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      {selectedReconcileIds.length === statementRows.length ? '전체 해제' : '전체 선택'}
                    </button>
                  </div>
                )}
              </div>

              {statementRows.length > 0 && canSave && (
                <button
                  onClick={handleOpenPaymentRequestModal}
                  disabled={isSettling || selectedReconcileIds.length === 0}
                  className="btn-primary"
                  style={{ padding: '7px 16px', fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '6px', backgroundColor: '#10b981', borderColor: '#10b981' }}
                >
                  <CreditCard size={14} /> 💳 선택한 {selectedReconcileIds.length}건 1:1 매칭 & 지급 요청 전송
                </button>
              )}
            </div>

            {filteredReconcileResults.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                상단 [📄 임차처 거래명세서 엑셀 업로드] 또는 [✨ 샘플 명세서 시연] 버튼을 눌러 교차 대사를 실행해 주세요.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-card-header)', borderBottom: '2px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={statementRows.length > 0 && selectedReconcileIds.length === statementRows.length}
                          onChange={e => {
                            if (e.target.checked) setSelectedReconcileIds(statementRows.map(r => r.id));
                            else setSelectedReconcileIds([]);
                          }}
                        />
                      </th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'center' }}>상세 뷰</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'center' }}>대사 상태</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>관리번호 / 시리얼</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>모델명</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>📄 임차처 청구 기간</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>🏠 자사 등록/반납 기간</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right' }}>📄 임차처 청구금액</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right' }}>🏠 자사 약정금액</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right' }}>오차 차액</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>대사 검증 소견</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReconcileResults.map(item => {
                      const stmt = item.statementRow;
                      const matched = item.matchedAsset;
                      
                      let rowBg = 'transparent';
                      if (item.status === 'PRICE_MISMATCH') rowBg = 'rgba(245, 158, 11, 0.12)';
                      if (item.status === 'PERIOD_MISMATCH') rowBg = 'rgba(249, 115, 22, 0.12)';
                      if (item.status === 'UNREGISTERED') rowBg = 'rgba(239, 68, 68, 0.12)';
                      if (item.status === 'MISSING_BILLING') rowBg = 'rgba(59, 130, 246, 0.12)';

                      const isChecked = stmt ? selectedReconcileIds.includes(stmt.id) : false;

                      return (
                        <tr key={item.id} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: rowBg, color: 'var(--text-main)' }}>
                          {/* 선택 체크박스 */}
                          <td style={{ padding: '10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {stmt && (
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedReconcileIds([...selectedReconcileIds, stmt.id]);
                                  } else {
                                    setSelectedReconcileIds(selectedReconcileIds.filter(id => id !== stmt.id));
                                  }
                                }}
                              />
                            )}
                          </td>

                          {/* 상세 뷰 버튼 */}
                          <td style={{ padding: '10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button
                              onClick={() => setSelectedReconcileDetail(item)}
                              style={{ padding: '3px 8px', fontSize: '11px', fontWeight: 'bold', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                              상세 🔍
                            </button>
                          </td>

                          {/* 대사 상태 배지 */}
                          <td style={{ padding: '10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <span className={`badge ${item.badgeClass}`} style={{ fontSize: '11px', padding: '3px 7px' }}>
                              {item.statusLabel}
                            </span>
                          </td>

                          {/* 관리번호 */}
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', fontWeight: '800', color: 'var(--text-main)' }}>
                            {stmt?.assetNo || matched?.assetNo}
                          </td>

                          {/* 모델명 */}
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', color: 'var(--text-main)' }}>
                            {stmt?.modelName || matched?.modelName || '미지정'}
                          </td>

                          {/* 임차처 청구 기간 */}
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', color: 'var(--text-main)' }}>
                            {stmt ? `${stmt.rentStart} ~ ${stmt.rentEnd}` : '-'}
                          </td>

                          {/* 자사 등록/반납 기간 */}
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                            {matched ? (
                              matched.actualRentReturnDate ? (
                                <span style={{ color: '#059669', fontWeight: '600' }}>반납: {matched.actualRentReturnDate}</span>
                              ) : (
                                `${matched.rentStart || '~'} ~ ${matched.rentEnd || '~'}`
                              )
                            ) : (
                              <span style={{ color: '#dc2626' }}>자사 대장 미등록</span>
                            )}
                          </td>

                          {/* 원사 청구금액 */}
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: '700' }}>
                            {stmt ? `₩${stmt.billedAmount.toLocaleString()}` : '-'}
                          </td>

                          {/* 자사 약정금액 */}
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            ₩{item.expectedAmount.toLocaleString()}
                          </td>

                          {/* 오차 차액 */}
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: '800', color: item.priceDiff > 0 ? '#dc2626' : (item.priceDiff < 0 ? '#059669' : 'var(--text-main)') }}>
                            {item.priceDiff > 0 ? `+₩${item.priceDiff.toLocaleString()}` : item.priceDiff < 0 ? `-₩${Math.abs(item.priceDiff).toLocaleString()}` : '0원'}
                          </td>

                          {/* 대사 분석 소견 및 구상 조치 */}
                          <td style={{ padding: '10px', fontSize: '11px', color: 'var(--text-secondary)', maxWidth: '300px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <span>{item.reason}</span>
                              {canSave && (item.statementRow?.itemType === 'REPAIR' || item.statementRow?.itemType === 'OTHER_FEE' || item.status === 'UNREGISTERED' || item.priceDiff > 0) && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenClaimModal(item)}
                                  style={{
                                    alignSelf: 'flex-start',
                                    padding: '3px 8px',
                                    fontSize: '10.5px',
                                    fontWeight: 700,
                                    borderRadius: '4px',
                                    backgroundColor: '#fef3c7',
                                    border: '1px solid #fde047',
                                    color: '#92400e',
                                    cursor: 'pointer'
                                  }}
                                >
                                  🚨 고객사 구상 미수금 등록
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 최하단 회계 대차대조 검증 바 (헌장 3.5 Z-패턴 4단계) */}
            <div style={{
              padding: '8px 14px',
              backgroundColor: 'var(--bg-app)',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              fontSize: '11.5px',
              borderRadius: '0 0 6px 6px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <span>원사 청구총액: <strong style={{ color: 'var(--primary)' }}>₩{statsRecon.totalBilled.toLocaleString()}</strong></span>
                <span>=</span>
                <span>일치 확정액: <strong style={{ color: 'var(--success)' }}>₩{(statsRecon.totalBilled - statsRecon.totalDiffAmount).toLocaleString()}</strong></span>
                <span>+</span>
                <span>차액/이의액: <strong style={{ color: statsRecon.totalDiffAmount !== 0 ? 'var(--danger)' : 'var(--text-muted)' }}>₩{statsRecon.totalDiffAmount.toLocaleString()}</strong></span>
              </div>
              <span style={{
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: statsRecon.totalDiffAmount === 0 ? 'var(--success-light)' : 'var(--danger-light)',
                color: statsRecon.totalDiffAmount === 0 ? 'var(--success)' : 'var(--danger)',
                fontWeight: 700,
                fontSize: '11px'
              }}>
                {statsRecon.totalDiffAmount === 0 ? '⚖️ 대차 차액 ₩0 (완결)' : `⚠️ 차액 발생 ₩${Math.abs(statsRecon.totalDiffAmount).toLocaleString()}`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 탭 2: 전대 임차 협의 (마스터-디테일 조달 스튜디오, 헌장 3.1, 3.2, 3.4, 3.6 준수) */}
      {/* ========================================================================= */}
      {activeTab === 'NEGOTIATION' && (
        <div style={{ display: 'flex', gap: '16px', minHeight: '650px', alignItems: 'flex-start' }}>
          {/* ── 좌측 Master: 원사별 조달 협의 목록 (너비 420px 고정) ── */}
          <div style={{
            width: '420px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '10px',
            backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px',
            padding: '14px', boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                <Building size={16} /> 전대 임차 협의 목록
              </h3>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                총 {(subleaseNegotiations || []).length}건
              </span>
            </div>

            {/* 필터 & 검색 */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <select
                value={subleaseFilterStatus}
                onChange={e => setSubleaseFilterStatus(e.target.value as any)}
                style={{
                  padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700
                }}
              >
                <option value="ALL">전체 상태</option>
                <option value="INQUIRY">문의/견적</option>
                <option value="NEGOTIATING">단가조율중</option>
                <option value="CONTRACTED">계약체결</option>
                <option value="CANCELLED">취소</option>
              </select>
              <input
                type="text"
                value={subleaseSearchQuery}
                onChange={e => setSubleaseSearchQuery(e.target.value)}
                placeholder="원사/모델/현장 검색..."
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: '12px'
                }}
              />
            </div>

            {/* 협의 건 리스트 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '580px', overflowY: 'auto' }}>
              {(() => {
                const filtered = (subleaseNegotiations || []).filter(s => {
                  if (subleaseFilterStatus !== 'ALL' && s.status !== subleaseFilterStatus) return false;
                  if (subleaseSearchQuery) {
                    const q = subleaseSearchQuery.toLowerCase();
                    const match = s.vendorName.toLowerCase().includes(q) ||
                                  s.modelName.toLowerCase().includes(q) ||
                                  (s.targetSiteName || '').toLowerCase().includes(q);
                    if (!match) return false;
                  }
                  return true;
                });

                if (filtered.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)', fontSize: '12px' }}>
                      등록된 전대 임차 협의 건이 없습니다.
                    </div>
                  );
                }

                return filtered.map(item => {
                  const isSelected = selectedSubleaseId === item.id;
                  const statusLabel = item.status === 'INQUIRY' ? '문의접수' : item.status === 'NEGOTIATING' ? '단가조율중' : item.status === 'CONTRACTED' ? '계약체결' : '취소';
                  const statusColor = item.status === 'INQUIRY' ? '#d97706' : item.status === 'NEGOTIATING' ? '#2563eb' : item.status === 'CONTRACTED' ? '#10b981' : '#ef4444';

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedSubleaseId(item.id)}
                      style={{
                        padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s ease',
                        backgroundColor: isSelected ? 'rgba(59,130,246,0.12)' : 'var(--bg-body)',
                        border: isSelected ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                        display: 'flex', flexDirection: 'column', gap: '5px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>
                          {item.vendorName}
                        </span>
                        <span style={{
                          padding: '2px 6px', borderRadius: '4px', fontSize: '10.5px', fontWeight: 800,
                          backgroundColor: `${statusColor}20`, color: statusColor, border: `1px solid ${statusColor}40`, whiteSpace: 'nowrap'
                        }}>
                          {statusLabel}
                        </span>
                      </div>

                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>모델: <strong style={{ color: 'var(--text-primary)' }}>{item.modelName}</strong> ({item.quantity}대)</span>
                        <span style={{ color: '#10b981', fontWeight: 800 }}>월 ₩{item.monthlyRate.toLocaleString()}</span>
                      </div>

                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        기간: {item.startDate} ~ {item.endDate || '미정'} {item.targetSiteName ? `| 투입: ${item.targetSiteName}` : ''}
                      </div>

                      {item.registeredAssetId && (
                        <div style={{ fontSize: '10.5px', color: '#10b981', fontWeight: 700 }}>
                          ✓ 자산등록 완료: #{item.registeredAssetId}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* ── 우측 Detail: 선택 협의 상세 및 신규 등록 패널 ── */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', gap: '14px',
            backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px',
            padding: '16px', boxSizing: 'border-box', minWidth: 0
          }}>
            {/* 1. 선택된 협의 건 상세 카드 (선택된 경우만) */}
            {(() => {
              const selectedItem = (subleaseNegotiations || []).find(s => s.id === selectedSubleaseId);
              if (!selectedItem) return null;
              const isContracted = selectedItem.status === 'CONTRACTED';

              return (
                <div style={{
                  backgroundColor: 'var(--bg-body)', border: '1.5px solid var(--primary)', borderRadius: '8px',
                  padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>
                      협의 번호 #{selectedItem.id.slice(-6)} · {selectedItem.createdAt.slice(0, 10)}
                    </div>
                    <span style={{
                      fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 800,
                      backgroundColor: isContracted ? '#10b981' : '#2563eb', color: '#ffffff'
                    }}>
                      {isContracted ? '계약 체결 완료' : '협의 진행 중'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {selectedItem.vendorName} — {selectedItem.modelName} ({selectedItem.quantity}대)
                    </div>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#10b981' }}>
                      월 ₩{selectedItem.monthlyRate.toLocaleString()} (일할 ₩{selectedItem.dailyRate ? selectedItem.dailyRate.toLocaleString() : '0'})
                    </div>
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <span><strong>임차 기간:</strong> {selectedItem.startDate} ~ {selectedItem.endDate || '미정'}</span>
                    <span><strong>운송비 부담:</strong> {selectedItem.transportPayer === 'VENDOR' ? '원사부담' : selectedItem.transportPayer === 'OURS' ? '당사부담' : '반반분담'}</span>
                    {selectedItem.targetSiteName && <span><strong>투입 예정:</strong> {selectedItem.targetSiteName}</span>}
                  </div>

                  {selectedItem.memo && (
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-card)', padding: '6px 10px', borderRadius: '4px' }}>
                      메모: {selectedItem.memo}
                    </div>
                  )}

                  {!isContracted && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                      <button
                        className="btn-primary"
                        onClick={() => handleConvertSubleaseToAsset(selectedItem)}
                        style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        <Check size={14} /> 협의 완료 및 임차자산 대장에 등록
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 2. 신규 전대 임차 협의 등록 폼 (헌장 3.4 상하 세로 스택) */}
            <div style={{
              backgroundColor: 'var(--bg-body)', border: '1px solid var(--border-color)', borderRadius: '8px',
              padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px'
            }}>
              <h4 style={{ fontSize: '14px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Plus size={15} /> 신규 전대 임차 협의 등록
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                {/* 원사(협력사) 선택 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>임차 원사(협력사) *</label>
                  <select
                    value={subleaseVendorId}
                    onChange={e => setSubleaseVendorId(e.target.value)}
                    style={{
                      padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700
                    }}
                  >
                    <option value="">협력사 선택</option>
                    {vendors.map(v => (
                      <option key={v.id} value={v.id}>{v.name} ({v.representative || '대표미상'})</option>
                    ))}
                  </select>
                </div>

                {/* 요청 장비 모델 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>요청 장비 모델 *</label>
                  <select
                    value={subleaseModelName}
                    onChange={e => setSubleaseModelName(e.target.value)}
                    style={{
                      padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700
                    }}
                  >
                    <option value="">장비 모델 선택</option>
                    {products.map(p => (
                      <option key={p.id} value={p.modelName}>{p.modelName} ({p.feet ? `${p.feet}ft` : ''})</option>
                    ))}
                  </select>
                </div>

                {/* 필요 대수 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>필요 수량 (대)</label>
                  <input
                    type="number"
                    min={1}
                    value={subleaseQuantity}
                    onChange={e => setSubleaseQuantity(Number(e.target.value))}
                    style={{
                      padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                {/* 월 임차료 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>협의 월 임차료 (원) *</label>
                  <input
                    type="number"
                    value={subleaseMonthlyRate || ''}
                    onChange={e => setSubleaseMonthlyRate(Number(e.target.value))}
                    placeholder="예: 450000"
                    style={{
                      padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700
                    }}
                  />
                </div>

                {/* 일할 단가 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>일할 임차 단가 (원)</label>
                  <input
                    type="number"
                    value={subleaseDailyRate || ''}
                    onChange={e => setSubleaseDailyRate(Number(e.target.value))}
                    placeholder="예: 15000"
                    style={{
                      padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px'
                    }}
                  />
                </div>

                {/* 운송비 부담 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>운송비 부담 조건</label>
                  <select
                    value={subleaseTransportPayer}
                    onChange={e => setSubleaseTransportPayer(e.target.value as any)}
                    style={{
                      padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700
                    }}
                  >
                    <option value="OURS">당사 부담</option>
                    <option value="VENDOR">원사(협력사) 부담</option>
                    <option value="SPLIT">편도 분담(반반)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
                {/* 개시일 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>임차 개시 희망일 *</label>
                  <input
                    type="date"
                    value={subleaseStartDate}
                    onChange={e => setSubleaseStartDate(e.target.value)}
                    style={{
                      padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px'
                    }}
                  />
                </div>

                {/* 종료일 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>임차 종료 예정일</label>
                  <input
                    type="date"
                    value={subleaseEndDate}
                    onChange={e => setSubleaseEndDate(e.target.value)}
                    style={{
                      padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px'
                    }}
                  />
                </div>

                {/* 투입 예정 고객사 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>투입 예정 고객사</label>
                  <select
                    value={subleaseCustomerId}
                    onChange={e => setSubleaseCustomerId(e.target.value)}
                    style={{
                      padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px'
                    }}
                  >
                    <option value="">고객사 선택 (선택사항)</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* 투입 현장명 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>투입 현장명</label>
                  <input
                    type="text"
                    value={subleaseSiteName}
                    onChange={e => setSubleaseSiteName(e.target.value)}
                    placeholder="예: 평택 고덕 P3 현장"
                    style={{
                      padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px'
                    }}
                  />
                </div>
              </div>

              {/* 협의 메모 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>장비 상태 및 협의 메모</label>
                <textarea
                  value={subleaseMemo}
                  onChange={e => setSubleaseMemo(e.target.value)}
                  placeholder="예: 2022년식 이상 요구, 협착방지봉 부착 상태로 상차 요망..."
                  style={{
                    height: '65px', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '12px', boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* 완결 버튼 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                <button
                  className="btn-primary"
                  onClick={handleSaveSubleaseNegotiation}
                  style={{ padding: '8px 20px', fontSize: '12.5px', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Check size={14} /> 전대 임차 협의 등록
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 탭 3: 전대 손익 원장 (대차대조) */}
      {/* ========================================================================= */}
      {activeTab === 'PROFIT_LEDGER' && (() => {
        const totalRev = subleaseContracts.reduce((sum, sc) => sum + sc.confirmedRevenue, 0);
        const totalCost = subleaseContracts.reduce((sum, sc) => sum + sc.confirmedCost, 0);
        const totalFreight = subleaseContracts.reduce((sum, sc) => sum + sc.freightCost, 0);
        const totalExpense = totalCost + totalFreight;
        const netProfit = totalRev - totalExpense;
        const marginRate = totalRev > 0 ? (netProfit / totalRev) * 100 : 0;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* 대차대조 손익 KPI 카드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
              <div style={{ padding: '12px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>전대 확정 청구액 (매출)</span>
                <strong style={{ fontSize: '17px', color: 'var(--primary)' }}>₩{totalRev.toLocaleString()}</strong>
                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>확정 매출 세금계산서 기준</span>
              </div>

              <div style={{ padding: '12px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>매입 임차료 원가 (매입)</span>
                <strong style={{ fontSize: '17px', color: 'var(--danger)' }}>₩{totalCost.toLocaleString()}</strong>
                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>원사 매입세금계산서 기준</span>
              </div>

              <div style={{ padding: '12px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>직송 운송비 원가</span>
                <strong style={{ fontSize: '17px', color: '#d97706' }}>₩{totalFreight.toLocaleString()}</strong>
                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>화물 배차 대장 확정액</span>
              </div>

              <div style={{ padding: '12px 14px', backgroundColor: 'var(--success-light)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-main)', fontWeight: 700 }}>전대 순마진 (대차대조)</span>
                <strong style={{ fontSize: '17px', color: 'var(--success)' }}>₩{netProfit.toLocaleString()}</strong>
                <span style={{ fontSize: '10.5px', fontWeight: 700, color: marginRate >= 20 ? 'var(--success)' : '#d97706' }}>
                  마진율: {marginRate.toFixed(1)}% ({marginRate >= 0 ? '흑자' : '적자'})
                </span>
              </div>
            </div>

          {/* 서브 세그먼트 스위처 & 엑셀 내보내기 버튼 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '6px', backgroundColor: 'var(--bg-app)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <button
                type="button"
                onClick={() => setProfitLedgerSubTab('CONTRACT')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: profitLedgerSubTab === 'CONTRACT' ? 'var(--primary)' : 'transparent',
                  color: profitLedgerSubTab === 'CONTRACT' ? '#ffffff' : 'var(--text-secondary)'
                }}
              >
                🏢 계약별 전대 손익 원장 ({subleaseContracts.length}건)
              </button>
              <button
                type="button"
                onClick={() => setProfitLedgerSubTab('ASSET')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: profitLedgerSubTab === 'ASSET' ? 'var(--primary)' : 'transparent',
                  color: profitLedgerSubTab === 'ASSET' ? '#ffffff' : 'var(--text-secondary)'
                }}
              >
                🚜 자산별 누적 손익 원장 ({assetProfitLedgers.length}대)
              </button>
            </div>

            <button
              type="button"
              onClick={handleExportProfitLedgerExcel}
              style={{
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: '700',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-main)',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Download size={13} /> 전대 손익 원장 엑셀 다운로드
            </button>
          </div>

          {/* 1. 계약별 전대 손익 원장 그리드 */}
          {profitLedgerSubTab === 'CONTRACT' && (
            <div className="card" style={{ border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden', backgroundColor: 'var(--bg-card)' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-card-header)', borderBottom: '2px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>계약번호 / 현장</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>고객사명</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>투입 전대장비</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right' }}>📄 확정 청구액(매출)</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right' }}>🏢 매입원가(임차료)</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right' }}>🚚 직송 운송비</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right' }}>🟢 순마진</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'center' }}>마진율</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'center' }}>대차대조 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subleaseContracts.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          현재 진행 중인 전대(임차) 계약이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      subleaseContracts.map(sc => (
                        <tr key={sc.contract.id} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                          <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <strong style={{ color: '#2563eb' }}>{sc.contract.contractNo}</strong>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{sc.site?.name || '현장 미지정'}</span>
                            </div>
                          </td>
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', fontWeight: 600 }}>
                            {sc.customer?.name || '고객 미지정'}
                          </td>
                          <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              {sc.assignedRentedAssets.map((ara, idx) => (
                                <span key={idx} style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                                  • {ara.ca.assetNo} ({ara.match?.renter || '원사'})
                                </span>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>
                            ₩{sc.confirmedRevenue.toLocaleString()}
                          </td>
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 600, color: '#dc2626' }}>
                            ₩{sc.confirmedCost.toLocaleString()}
                          </td>
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right', color: '#d97706' }}>
                            ₩{sc.freightCost.toLocaleString()}
                          </td>
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 800, color: sc.netProfit >= 0 ? '#16a34a' : '#dc2626' }}>
                            ₩{sc.netProfit.toLocaleString()}
                          </td>
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'center', fontWeight: 700 }}>
                            <span style={{ color: sc.marginRate >= 20 ? '#16a34a' : (sc.marginRate >= 0 ? '#d97706' : '#dc2626') }}>
                              {sc.marginRate.toFixed(1)}%
                            </span>
                          </td>
                          <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                            <span className="badge badge-success" style={{ fontSize: '10px' }}>
                              무결성 일치 ⚖️
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 2. 자산별 누적 손익 원장 그리드 */}
          {profitLedgerSubTab === 'ASSET' && (
            <div className="card" style={{ border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden', backgroundColor: 'var(--bg-card)' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-card-header)', borderBottom: '2px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>관리번호</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>원사 관리번호</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>모델명</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap' }}>임차처(원사)</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right' }}>누적 렌탈 청구액</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right' }}>누적 지급 임차료</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right' }}>누적 운송비</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right' }}>🟢 누적 공헌이익</th>
                      <th style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'center' }}>수익 기여율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetProfitLedgers.map(apl => (
                      <tr key={apl.asset.id} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap', fontWeight: 800, color: 'var(--text-main)' }}>
                          {apl.asset.assetNo}
                        </td>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                          {apl.asset.vendorAssetNo || '-'}
                        </td>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>{apl.asset.modelName}</td>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap', fontWeight: 600 }}>{apl.asset.renter || '미지정'}</td>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>
                          ₩{apl.cumRevenue.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 600, color: '#dc2626' }}>
                          ₩{apl.cumCost.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right', color: '#d97706' }}>
                          ₩{apl.freightCost.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 800, color: apl.cumNetProfit >= 0 ? '#16a34a' : '#dc2626' }}>
                          ₩{apl.cumNetProfit.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap', textAlign: 'center', fontWeight: 700 }}>
                          <span style={{ color: apl.marginRate >= 20 ? '#16a34a' : '#d97706' }}>
                            {apl.marginRate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 최하단 회계 대차대조 검증 바 (헌장 3.5 Z-패턴 4단계) */}
          <div style={{
            padding: '8px 14px',
            backgroundColor: 'var(--bg-app)',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            fontSize: '11.5px',
            borderRadius: '0 0 6px 6px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <span>전대 매출총액: <strong style={{ color: 'var(--primary)' }}>₩{totalRev.toLocaleString()}</strong></span>
              <span>=</span>
              <span>매입 임차료: <strong style={{ color: 'var(--danger)' }}>₩{totalCost.toLocaleString()}</strong></span>
              <span>+</span>
              <span>직송 운송비: <strong style={{ color: '#d97706' }}>₩{totalFreight.toLocaleString()}</strong></span>
              <span>+</span>
              <span>순마진(공헌이익): <strong style={{ color: netProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>₩{netProfit.toLocaleString()}</strong></span>
            </div>
            <span style={{
              padding: '2px 8px',
              borderRadius: '4px',
              backgroundColor: 'var(--success-light)',
              color: 'var(--success)',
              fontWeight: 700,
              fontSize: '11px'
            }}>
              ⚖️ 대차 차액 ₩0 (손익 무결성 확정)
            </span>
          </div>

        </div>
      );
    })()}

      {/* ========================================================================= */}
      {/* 탭 1: 임차자산 대장 현황 (Current Assets) - 헌장 3.6 유형 B 고밀도 대장 */}
      {/* ========================================================================= */}
      {activeTab === 'CURRENT' && (() => {
        const activeRentedList = rentedAssets.filter(a => !a.actualRentReturnDate && a.status !== 'RENTED_RETURNED');
        const returnedList = rentedAssets.filter(a => Boolean(a.actualRentReturnDate) || a.status === 'RENTED_RETURNED');
        const totalMonthlyRentCost = activeRentedList.reduce((sum, a) => sum + (a.monthlyRentFee || 0), 0);

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>

            {/* 필터 컨트롤 바 (Vertical Header-Label Layout: 헌장 3.4) */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 12px',
              backgroundColor: 'var(--bg-card)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '1', minWidth: '180px' }}>
                <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>자산 검색</label>
                <div style={{ position: 'relative' }}>
                  <Search size={13} style={{ position: 'absolute', left: '8px', top: '7px', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="관리번호, 모델명, 임차처 검색"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 8px 4px 26px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-app)',
                      color: 'var(--text-main)',
                      fontSize: '12px'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>소유 원사 (임차처)</label>
                <select
                  value={renterQuery}
                  onChange={e => setRenterQuery(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', minWidth: '140px' }}
                >
                  <option value="">전체 임차처</option>
                  {renterVendors.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>반납 상태</label>
                <select
                  value={returnQuery}
                  onChange={e => setReturnQuery(e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', minWidth: '130px' }}
                >
                  <option value="ALL">전체 반납 상태</option>
                  <option value="ACTIVE">미반납 (임차 가동 중)</option>
                  <option value="RETURNED">반납 완료</option>
                </select>
              </div>

              {(searchQuery || renterQuery || returnQuery !== 'ALL') && (
                <button
                  onClick={() => { setSearchQuery(''); setRenterQuery(''); setReturnQuery('ALL'); }}
                  style={{
                    marginTop: '16px',
                    padding: '4px 8px',
                    fontSize: '11.5px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    backgroundColor: 'transparent',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <RefreshCw size={11} /> 초기화
                </button>
              )}
            </div>

            {/* 고밀도 임차자산 대장 그리드 작업대 (Body / Inspection - 헌장 3.6 유형 B) */}
            <div style={{
              flex: 1,
              backgroundColor: 'var(--bg-card)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div style={{ flex: 1, overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '11.5px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      <th style={{ padding: '7px 8px', width: '50px', textAlign: 'center', whiteSpace: 'nowrap' }}>상세</th>
                      <th style={{ padding: '7px 8px', width: '90px', textAlign: 'center', whiteSpace: 'nowrap' }}>관리</th>
                      <th style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>관리번호</th>
                      <th style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>모델명</th>
                      <th style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>소유 원사 (임차처)</th>
                      <th style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>임차 계약기간</th>
                      <th style={{ padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>월 임차료</th>
                      <th style={{ padding: '7px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>실제 반납일</th>
                      <th style={{ padding: '7px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>운용 상태</th>
                      <th style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>투입 현장 / 고객사</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssets.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ padding: '36px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                          조회 조건에 해당하는 임차 자산이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredAssets.map(a => {
                        const isReturned = Boolean(a.actualRentReturnDate) || a.status === 'RENTED_RETURNED';
                        const isOverdue = isSubleaseOverdue(a);
                        const delayDays = calculateDelayDays(a);
                        const renterName = getAssetRenterName(a);
                        const cust = customers.find(c => c.id === a.currentCustomerId);
                        const site = sites.find(s => s.id === a.currentSiteId);

                        // 날짜 역전 방어 포맷
                        let periodText = '-';
                        if (a.rentStart && a.rentEnd) {
                          if (a.rentStart > a.rentEnd) {
                            periodText = `~ ${a.rentEnd}`;
                          } else {
                            periodText = `${a.rentStart} ~ ${a.rentEnd}`;
                          }
                        } else if (a.rentStart) {
                          periodText = `${a.rentStart} ~`;
                        } else if (a.rentEnd) {
                          periodText = `~ ${a.rentEnd}`;
                        }

                        return (
                          <tr
                            key={a.id}
                            onClick={() => setSelectedAssetForDossier(a)}
                            style={{
                              borderBottom: '1px solid var(--border-color)',
                              cursor: 'pointer',
                              transition: 'background-color 0.15s',
                              opacity: isReturned ? 0.75 : 1
                            }}
                            className="hover-row"
                          >
                            {/* 상세 버튼 */}
                            <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); setSelectedAssetForDossier(a); }}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: '11px',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: '3px',
                                  backgroundColor: 'transparent',
                                  cursor: 'pointer',
                                  color: 'var(--primary)',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                보기
                              </button>
                            </td>

                            {/* 관리 액션 버튼 */}
                            <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
                                {canSave && (
                                  <button
                                    onClick={() => handleOpenEdit(a)}
                                    style={{ padding: '2px 5px', fontSize: '10.5px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: '3px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                                  >
                                    수정
                                  </button>
                                )}
                                {canSave && !isReturned && (
                                  <button
                                    onClick={() => handleOpenReturn(a)}
                                    disabled={a.status === 'RENTED'}
                                    title={a.status === 'RENTED' ? '대여중인 자산은 원사 반납이 불가합니다' : '원사 반납'}
                                    style={{ padding: '2px 5px', fontSize: '10.5px', backgroundColor: a.status === 'RENTED' ? 'var(--bg-card)' : 'var(--danger)', color: a.status === 'RENTED' ? 'var(--text-muted)' : '#fff', border: a.status === 'RENTED' ? '1px solid var(--border-color)' : 'none', borderRadius: '3px', cursor: a.status === 'RENTED' ? 'not-allowed' : 'pointer', opacity: a.status === 'RENTED' ? 0.6 : 1, whiteSpace: 'nowrap' }}
                                  >
                                    반납
                                  </button>
                                )}
                                {canSave && isReturned && (
                                  <button
                                    onClick={() => handleOpenReactivate(a)}
                                    style={{ padding: '2px 5px', fontSize: '10.5px', backgroundColor: 'var(--success)', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                  >
                                    재임차
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* 관리번호 & 원사번호 */}
                            <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span>{a.assetNo}</span>
                                <span className="badge badge-info" style={{ fontSize: '9.5px', padding: '1px 4px' }}>임차</span>
                              </div>
                              {a.vendorAssetNo && (
                                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                  원사: {a.vendorAssetNo}
                                </div>
                              )}
                            </td>

                            {/* 모델명 */}
                            <td style={{ padding: '6px 8px', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>{a.modelName}</td>

                            {/* 임차처 상호명 */}
                            <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                              {renterName}
                            </td>

                            {/* 임차 계약기간 */}
                            <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                              {periodText}
                            </td>

                            {/* 월 임차료 */}
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                              ₩{(a.monthlyRentFee || 0).toLocaleString()}
                            </td>

                            {/* 실제 반납일 */}
                            <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              {a.actualRentReturnDate ? (
                                <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '11px' }}>
                                  {a.actualRentReturnDate} (반납)
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '10.5px' }}>미반납</span>
                              )}
                            </td>

                            {/* 운용 상태 및 경보 */}
                            <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
                                {isReturned ? (
                                  <span className="badge badge-secondary" style={{ fontSize: '10px' }}>임차처 반납완료</span>
                                ) : (a.status === 'RENTED' || a.currentCustomerId) ? (
                                  <span className="badge badge-primary" style={{ fontSize: '10px' }}>대여중</span>
                                ) : a.status === 'ASSIGNED' ? (
                                  <span className="badge badge-warning" style={{ fontSize: '10px' }}>출고대기</span>
                                ) : a.status === 'REPAIRING' ? (
                                  <span className="badge badge-danger" style={{ fontSize: '10px' }}>수리중</span>
                                ) : (
                                  <span className="badge badge-success" style={{ fontSize: '10px' }}>임대가능 (보관중)</span>
                                )}

                                {isOverdue && !isReturned && (
                                  <span className="badge badge-danger" style={{ fontSize: '9.5px', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                    <AlertTriangle size={9} /> 전대 기간 초과
                                  </span>
                                )}

                                {delayDays > 0 && !isReturned && (
                                  <span style={{ fontSize: '9.5px', color: 'var(--danger)', fontWeight: 700 }}>
                                    지연 +{delayDays}일
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* 투입 고객사 / 현장 */}
                            <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                              {cust ? (
                                <div>
                                  <strong style={{ color: 'var(--text-main)' }}>{cust.name}</strong>
                                  {site && <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}> ({site.name})</span>}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* 우하단 Terminal Action: 회계 대차대조 무결성 검증 바 (헌장 3.5 Z-패턴 4단계) */}
              <div style={{
                padding: '8px 14px',
                backgroundColor: 'var(--bg-app)',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
                fontSize: '11.5px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                  <span>가동중 전대장비: <strong style={{ color: 'var(--primary)' }}>{activeRentedList.length}대</strong></span>
                  <span>|</span>
                  <span>월 총 임차료 지출: <strong style={{ color: 'var(--danger)' }}>₩{totalMonthlyRentCost.toLocaleString()}원</strong></span>
                  <span>|</span>
                  <span>반납 완료 장비: <strong style={{ color: 'var(--text-muted)' }}>{returnedList.length}대</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'var(--success-light)',
                    color: 'var(--success)',
                    fontWeight: 700,
                    fontSize: '11px'
                  }}>
                    ⚖️ 대차 정상 (FSM 동기화 완결)
                  </span>
                </div>
              </div>
            </div>

          </div>
        );
      })()}

{/* ========================================================================= */}
      {/* 3. 모달: 임차 자산 등록 / 수정 모달 */}
      {/* ========================================================================= */}
      {showModal && editingAsset && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', padding: '24px', borderRadius: '12px', width: '500px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border-color)' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '16px', color: 'var(--text-main)' }}>
              {editingAsset.id ? '임차 자산 수정' : '임차 자산 신규/재임차 등록'}
            </h2>

            {/* 과거 반납 자산 재임차 1초 선택기 (신규 등록 시에만 노출) */}
            {!editingAsset.id && rentedAssets.some(a => a.status === 'RENTED_RETURNED') && (
              <div style={{ backgroundColor: 'var(--bg-app)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  🔄 과거 반납된 자산 재임차 선택 (기존 관리번호 재활용):
                </span>
                <select
                  onChange={e => {
                    const found = rentedAssets.find(a => a.id === e.target.value);
                    if (found) {
                      const today = new Date().toISOString().split('T')[0];
                      setEditingAsset({
                        ...found,
                        rentStart: today,
                        rentEnd: calcRentEnd(today),
                        actualRentReturnDate: '',
                        status: 'AVAILABLE'
                      });
                    }
                  }}
                  style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid #94a3b8' }}
                >
                  <option value="">-- 신규 채번 (직접 입력) --</option>
                  {rentedAssets.filter(a => a.status === 'RENTED_RETURNED').map(a => (
                    <option key={a.id} value={a.id}>
                      {a.assetNo} ({a.modelName} | 원사: {a.renter || '미지정'} | {a.vendorAssetNo ? `원사번호:${a.vendorAssetNo}` : '원사번호없음'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <form onSubmit={handleSubmitAsset} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>자사 관리번호 (필수)</label>
                  <input
                    type="text"
                    required
                    placeholder="예: R-001"
                    value={editingAsset.assetNo || ''}
                    onChange={e => setEditingAsset({ ...editingAsset, assetNo: e.target.value })}
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>원사 원래번호 (선택)</label>
                  <input
                    type="text"
                    placeholder="예: 대한-101, AJ-502"
                    value={editingAsset.vendorAssetNo || ''}
                    onChange={e => setEditingAsset({ ...editingAsset, vendorAssetNo: e.target.value })}
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>모델명 (필수)</label>
                <select
                  value={editingAsset.modelName || ''}
                  onChange={e => setEditingAsset({ ...editingAsset, modelName: e.target.value })}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                >
                  {sortedProducts.map(p => (
                    <option key={p.id} value={p.modelName}>{p.modelName}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>소유 원사(임차처) (필수)</label>
                <select
                  required
                  value={editingAsset.renter || ''}
                  onChange={e => {
                    const selectedName = e.target.value;
                    const matchedVendor = vendors.find(v => v.name === selectedName);
                    setEditingAsset({
                      ...editingAsset,
                      renter: selectedName,
                      vendorId: matchedVendor?.id || editingAsset.vendorId
                    });
                  }}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                >
                  <option value="">-- 소유 원사 선택 --</option>
                  {renterVendors.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>임차 시작일</label>
                  <input
                    type="date"
                    value={editingAsset.rentStart || ''}
                    onChange={e => {
                      const newStart = e.target.value;
                      setEditingAsset({
                        ...editingAsset,
                        rentStart: newStart,
                        rentEnd: calcRentEnd(newStart)
                      });
                    }}
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>임차 만료예정일</label>
                  <input
                    type="date"
                    value={editingAsset.rentEnd || ''}
                    onChange={e => setEditingAsset({ ...editingAsset, rentEnd: e.target.value })}
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>월 임차료 (원)</label>
                <input
                  type="number"
                  placeholder="300000"
                  value={editingAsset.monthlyRentFee || 0}
                  onChange={e => setEditingAsset({ ...editingAsset, monthlyRentFee: Number(e.target.value) })}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '12px', cursor: 'pointer' }}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. 모달: 임차 자산 반납 및 회수 배차 동시 신청 모달 */}
      {/* ========================================================================= */}
      {showReturnModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', padding: '24px', borderRadius: '12px', width: '480px', maxWidth: '90%', border: '1px solid var(--border-color)' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '14px', color: '#ef4444' }}>
              임차 자산 반납 처리
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>실제 임차처 반납일자</label>
                <input
                  type="date"
                  value={returnDate}
                  onChange={e => setReturnDate(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                />
              </div>

              {/* 반납 회수 배차 동시 신청 옵션 */}
              <div style={{ padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '6px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', color: 'var(--text-main)' }}>
                  <input
                    type="checkbox"
                    checked={isDispatchRequested}
                    onChange={e => setIsDispatchRequested(e.target.checked)}
                  />
                  🚚 반납/회수 운송 배차 신청 동시 접수
                </label>

                {isDispatchRequested && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>상차지 (출발)</label>
                      <input type="text" value={returnOrigin} onChange={e => setReturnOrigin(e.target.value)} style={{ padding: '4px 8px', fontSize: '11px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', borderRadius: '4px' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>하차지 (임차처 반납 장소)</label>
                      <input type="text" value={returnDestination} onChange={e => setReturnDestination(e.target.value)} style={{ padding: '4px 8px', fontSize: '11px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', borderRadius: '4px' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>차량 톤수</label>
                        <select value={returnVehicleType} onChange={e => setReturnVehicleType(e.target.value)} style={{ padding: '4px 8px', fontSize: '11px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', borderRadius: '4px' }}>
                          <option value="1T">1톤</option>
                          <option value="3.5T">3.5톤 셀프로더</option>
                          <option value="5T">5톤 셀프로더</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>예상 운송료 (원)</label>
                        <input type="number" value={returnCost} onChange={e => setReturnCost(Number(e.target.value))} style={{ padding: '4px 8px', fontSize: '11px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', borderRadius: '4px' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  onClick={() => setShowReturnModal(false)}
                  style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '12px', cursor: 'pointer' }}
                >
                  취소
                </button>
                <button
                  onClick={handleConfirmReturn}
                  style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: '#ef4444', color: '#fff', border: 'none', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  반납 완결 처리
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. 모달: 임차처 거래명세서 수신 내용 ↔ 자사 DB 대장 1:1 원본 대조 상세 모달 */}
      {/* ========================================================================= */}
      {selectedReconcileDetail && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', padding: '24px', borderRadius: '12px', width: '700px', maxWidth: '95%', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border-color)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '2px solid var(--border-color)', paddingBottom: '12px' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
                  📄 임차처 거래명세서 ↔ 🏠 자사 DB 자산대장 1:1 원본 대조
                </h2>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                  임차처 청구 내용과 자사 등록 정보를 1:1로 원본 비교 검증합니다.
                </p>
              </div>
              <span className={`badge ${selectedReconcileDetail.badgeClass}`} style={{ fontSize: '12px', padding: '4px 10px' }}>
                {selectedReconcileDetail.statusLabel}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              
              {/* 좌측: 📄 임차처 거래명세서 수신 내용 */}
              <div style={{ backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: '800', margin: '0 0 12px 0', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  📄 임차처 거래명세서 수신 내용
                </h3>
                {selectedReconcileDetail.statementRow ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: 'var(--text-main)' }}>
                    <div><strong>관리번호:</strong> {selectedReconcileDetail.statementRow.assetNo}</div>
                    <div><strong>시리얼/제조번호:</strong> {selectedReconcileDetail.statementRow.serialNo || '미기재'}</div>
                    <div><strong>임차처 표기 모델명:</strong> {selectedReconcileDetail.statementRow.modelName || '미기재'}</div>
                    <div><strong>임차처 청구 기간:</strong> <span style={{ color: '#3b82f6', fontWeight: '700' }}>{selectedReconcileDetail.statementRow.rentStart} ~ {selectedReconcileDetail.statementRow.rentEnd}</span></div>
                    <div><strong>임차처 청구 금액:</strong> <span style={{ color: '#ef4444', fontWeight: '800', fontSize: '14px' }}>₩{selectedReconcileDetail.statementRow.billedAmount.toLocaleString()}원</span></div>
                    <div><strong>임차처 비고/메모:</strong> {selectedReconcileDetail.statementRow.memo || '없음'}</div>
                  </div>
                ) : (
                  <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
                    임차처 거래명세서에 해당 항목 청구가 존재하지 않음 (청구 누락)
                  </div>
                )}
              </div>

              {/* 우측: 🏠 자사 DB 자산대장 등록 내용 */}
              <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.08)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: '800', margin: '0 0 12px 0', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🏠 자사 DB 자산대장 약정 내용
                </h3>
                {selectedReconcileDetail.matchedAsset ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: 'var(--text-main)' }}>
                    <div><strong>자사 관리번호:</strong> {selectedReconcileDetail.matchedAsset.assetNo}</div>
                    <div><strong>등록 제조번호:</strong> {selectedReconcileDetail.matchedAsset.serialNo || '미기재'}</div>
                    <div><strong>등록 모델명:</strong> {selectedReconcileDetail.matchedAsset.modelName}</div>
                    <div><strong>소유 임차처:</strong> {selectedReconcileDetail.matchedAsset.renter || '미지정'}</div>
                    <div><strong>약정/가동 기간:</strong> <span style={{ color: '#10b981', fontWeight: '700' }}>{selectedReconcileDetail.matchedAsset.rentStart || '~'} ~ {selectedReconcileDetail.matchedAsset.rentEnd || '~'}</span></div>
                    <div><strong>실제 반납일:</strong> {selectedReconcileDetail.matchedAsset.actualRentReturnDate || '미반납 (가동중)'}</div>
                    <div><strong>약정 월 임차료:</strong> <span style={{ color: '#10b981', fontWeight: '800', fontSize: '14px' }}>₩{(selectedReconcileDetail.matchedAsset.monthlyRentFee || 0).toLocaleString()}원</span></div>
                  </div>
                ) : (
                  <div style={{ padding: '20px', color: '#ef4444', fontSize: '12px', textAlign: 'center', fontWeight: '700' }}>
                    ⚠️ 자사 DB 자산대장에 존재하지 않는 미등록 장비 (유령 청구 위험)
                  </div>
                )}
              </div>

            </div>

            {/* 검증 소견 카드 */}
            <div style={{ padding: '14px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
              <div style={{ fontWeight: '800', fontSize: '12px', color: 'var(--text-main)', marginBottom: '4px' }}>🔍 시스템 자동 대사 검증 소견:</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{selectedReconcileDetail.reason}</div>
              <div style={{ fontSize: '12px', fontWeight: '700', marginTop: '6px', color: selectedReconcileDetail.priceDiff > 0 ? '#ef4444' : (selectedReconcileDetail.priceDiff < 0 ? '#10b981' : 'var(--text-main)') }}>
                오차 차액: {selectedReconcileDetail.priceDiff > 0 ? `+₩${selectedReconcileDetail.priceDiff.toLocaleString()}원 (임차처 과다 청구)` : selectedReconcileDetail.priceDiff < 0 ? `-₩${Math.abs(selectedReconcileDetail.priceDiff).toLocaleString()}원 (임차처 임의 할인)` : '0원 (정상 일치)'}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setSelectedReconcileDetail(null)}
                style={{ padding: '8px 18px', backgroundColor: 'var(--primary)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                닫기
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 💳 2. [실무 1:1 대조 & 지급 요청] 전송 모달 */}
      {showPaymentRequestModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', padding: '24px', borderRadius: '12px', width: '780px', maxWidth: '95%', maxHeight: '92vh', overflowY: 'auto', border: '1px solid var(--border-color)', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '2px solid var(--border-color)', paddingBottom: '12px' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
                  💳 [1:1 매칭 완결] 임차료 매입 정산 확정 & 지급 요청
                </h2>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                  실무 기록과 원사 청구 명세서 교차 검증 결과를 바탕으로 매입 정산 대장에 [정산확정]을 등록하고 지급을 요청합니다.
                </p>
              </div>
              <button onClick={() => setShowPaymentRequestModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <XCircle size={20} />
              </button>
            </div>

            {/* 정산 요약 카드 */}
            {(() => {
              const targetRows = statementRows.filter(r => selectedReconcileIds.includes(r.id));
              const totalBilled = targetRows.reduce((sum, r) => sum + r.billedAmount, 0);
              const totalTax = targetRows.reduce((sum, r) => sum + (r.taxAmount || Math.round(r.billedAmount * 0.1)), 0);
              const totalSum = totalBilled + totalTax;
              const vendorName = selectedVendor || (targetRows[0]?.assetNo ? (rentedAssets.find(a => a.assetNo === targetRows[0].assetNo)?.renter || '기타 원사') : '기타 원사');

              return (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px', marginBottom: '16px', backgroundColor: 'var(--bg-app)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>임차처 (원사)</div>
                      <div style={{ fontSize: '13px', fontWeight: '800', color: '#3b82f6', marginTop: '2px' }}>{vendorName}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>청구 정산년월</div>
                      <div style={{ fontSize: '13px', fontWeight: '800', color: 'var(--text-main)', marginTop: '2px' }}>{selectedYm}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>승인 선택건수</div>
                      <div style={{ fontSize: '13px', fontWeight: '800', color: '#10b981', marginTop: '2px' }}>{targetRows.length}건</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>총 지급 요청액</div>
                      <div style={{ fontSize: '14px', fontWeight: '800', color: '#ef4444', marginTop: '2px' }}>₩{totalSum.toLocaleString()}원</div>
                    </div>
                  </div>

                  {/* 실무 1:1 대조 항목 상세 리스트 */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--text-main)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <CheckCircle size={14} color="#10b981" /> 1:1 실무 이력 교차 검증 대상 목록 ({targetRows.length}건)
                    </div>
                    <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ backgroundColor: 'var(--bg-card-header)', borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                            <th style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>관리번호</th>
                            <th style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>모델명</th>
                            <th style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>자사 DB 약정 정보</th>
                            <th style={{ padding: '6px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>원사 청구액</th>
                            <th style={{ padding: '6px 10px', whiteSpace: 'nowrap', textAlign: 'center' }}>대사 상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {targetRows.map((r, idx) => {
                            const matched = rentedAssets.find(a => a.assetNo === r.assetNo);
                            const recItem = reconcileResults.find(res => res.id === r.id);
                            return (
                              <tr key={r.id} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: idx % 2 === 1 ? 'var(--bg-app)' : 'transparent' }}>
                                <td style={{ padding: '6px 10px', fontWeight: '700', whiteSpace: 'nowrap' }}>{r.assetNo}</td>
                                <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{r.modelName}</td>
                                <td style={{ padding: '6px 10px' }}>
                                  {matched ? (
                                    <span style={{ color: '#10b981', fontWeight: '600' }}>
                                      약정 ₩{(matched.monthlyRentFee || 0).toLocaleString()}원 (반납: {matched.actualRentReturnDate || '가동중'})
                                    </span>
                                  ) : (
                                    <span style={{ color: r.itemType === 'EQUIPMENT' ? '#ef4444' : '#3b82f6', fontWeight: '600' }}>
                                      {r.itemType === 'EQUIPMENT' ? '⚠️ 자사 미등록 유령장비' : `📦 기타비용 (${r.memo || '비장비 항목'})`}
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '700', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                                  ₩{r.billedAmount.toLocaleString()}원
                                </td>
                                <td style={{ padding: '6px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  <span className={`badge ${recItem?.badgeClass || 'badge-success'}`} style={{ fontSize: '10px', padding: '2px 6px' }}>
                                    {recItem?.statusLabel || '정상'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 결재 & 지급 요청 정보 입력 폼 (전사 표준 상하 세로 스택 레이아웃) */}
                  {createdSettlementId ? (
                    <div style={{ padding: '16px', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', borderRadius: '8px', marginBottom: '16px', textAlign: 'center' }}>
                      <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#10b981', margin: '0 0 6px 0' }}>
                        🎉 [지급 요청 완료] 매입 정산이 성공적으로 확정 승인되었습니다!
                      </h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-main)', margin: '0 0 12px 0' }}>
                        정산서 번호: <strong>{createdSettlementId}</strong> | 재무팀 지급 대장에 <strong>[정산확정]</strong> 상태로 등록되었습니다.
                      </p>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                        <button
                          onClick={() => {
                            setShowPaymentRequestModal(false);
                            setGlobalActiveTab('purchase_settlement');
                          }}
                          style={{ padding: '8px 16px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                          <CreditCard size={14} /> 💳 [월말 매입 정산 대장]으로 즉시 이동하여 계좌이체 지급
                        </button>
                        <button
                          onClick={() => setShowPaymentRequestModal(false)}
                          style={{ padding: '8px 14px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                        >
                          닫기
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px', backgroundColor: 'var(--bg-app)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '12px', fontWeight: '800', color: 'var(--text-main)', marginBottom: '4px' }}>
                        📝 결재 & 지급 요청 정보
                      </div>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            원사 입금 계좌번호 (Bank Account)
                          </label>
                          <input
                            type="text"
                            value={paymentBankAccount}
                            onChange={e => setPaymentBankAccount(e.target.value)}
                            placeholder="예: 기업은행 258-060890-01-011 (원사명)"
                            style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '12px' }}
                          />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            지급 희망 예정일 (Payment Due Date)
                          </label>
                          <input
                            type="date"
                            value={paymentDueDate}
                            onChange={e => setPaymentDueDate(e.target.value)}
                            style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '12px' }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          결재 및 지급 요청 메모 (Memo)
                        </label>
                        <input
                          type="text"
                          value={paymentMemo}
                          onChange={e => setPaymentMemo(e.target.value)}
                          placeholder="지급 요청 관련 사유 또는 부서 전달 사항"
                          style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '12px' }}
                        />
                      </div>
                    </div>
                  )}

                  {!createdSettlementId && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                      <button
                        onClick={() => setShowPaymentRequestModal(false)}
                        style={{ padding: '8px 16px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}
                      >
                        취소
                      </button>
                      <button
                        onClick={handleExecutePaymentRequest}
                        disabled={isSettling}
                        className="btn-primary"
                        style={{ padding: '8px 20px', backgroundColor: '#10b981', borderColor: '#10b981', fontSize: '12px', fontWeight: 'bold', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <CreditCard size={14} /> 🚀 매입 정산 확정 & 재무팀 지급 요청 전송
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────
          🚨 [고객사 구상 미수금 등록 모달] (타사 파손/세척/부대비용 구상 채권화)
      ────────────────────────────────────────────────────────────────────────── */}
      {showClaimModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', padding: '24px', borderRadius: '12px', width: '520px', maxWidth: '95%', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border-color)', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '6px', color: '#b45309' }}>
                🚨 타사 청구 부대비용 ➔ 고객사 구상 미수금 등록
              </h3>
              <button
                type="button"
                onClick={() => setShowClaimModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <XCircle size={18} />
              </button>
            </div>

            <div style={{ backgroundColor: '#fef3c7', padding: '10px 12px', borderRadius: '8px', border: '1px solid #fde047', fontSize: '12px', color: '#92400e', marginBottom: '14px', lineHeight: '1.4' }}>
              • 타사(원사)에 지급할 매입채무는 즉시 100% 확정 지급되며,<br/>
              • 고객 귀책 비용은 <strong>외상미수금 대장(구상채권)</strong>에 등록되어 향후 1회 또는 수회에 걸쳐 매출 청구서 반영 및 입금 상계됩니다.
            </div>

            <form onSubmit={handleSubmitClaim} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>청구 원사명</label>
                  <input
                    type="text"
                    readOnly
                    value={claimVendorName}
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>대상 장비번호</label>
                  <input
                    type="text"
                    value={claimAssetNo}
                    onChange={e => setClaimAssetNo(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>구상 청구 대상 고객사 (필수)</label>
                <select
                  required
                  value={claimCustomerId}
                  onChange={e => {
                    const custId = e.target.value;
                    setClaimCustomerId(custId);
                    const custContracts = contracts.filter(c => c.customerId === custId && c.status !== 'COMPLETED');
                    if (custContracts.length > 0) {
                      setClaimContractId(custContracts[0].id);
                    } else {
                      setClaimContractId('');
                    }
                  }}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                >
                  <option value="">-- 귀책 고객사 선택 --</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>연결 계약 (선택)</label>
                <select
                  value={claimContractId}
                  onChange={e => setClaimContractId(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                >
                  <option value="">-- 계약 선택 (미지정 시 고객사 일반 미수금) --</option>
                  {contracts.filter(c => !claimCustomerId || c.customerId === claimCustomerId).map(c => {
                    const s = sites.find(site => site.id === c.siteId);
                    return (
                      <option key={c.id} value={c.id}>
                        {c.contractNo} ({s?.name || '현장미지정'})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>구상 청구액 (원)</label>
                  <input
                    type="number"
                    required
                    value={claimAmount}
                    onChange={e => setClaimAmount(Number(e.target.value))}
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', fontWeight: 700 }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>구상 발생일</label>
                  <input
                    type="date"
                    required
                    value={claimOccurredDate}
                    onChange={e => setClaimOccurredDate(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>내부 장부 기재명 (실제 발생 원인)</label>
                <input
                  type="text"
                  required
                  value={claimInternalDescription}
                  onChange={e => setClaimInternalDescription(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)' }}>명세서 표기명 (고객 청구서 인쇄용)</label>
                <input
                  type="text"
                  value={claimDisplayName}
                  onChange={e => setClaimDisplayName(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
                <button
                  type="button"
                  onClick={() => setShowClaimModal(false)}
                  style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)', fontSize: '12px', cursor: 'pointer' }}
                >
                  취소
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', backgroundColor: '#d97706', color: '#ffffff', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  🚨 외상미수금 대장 등록 확정
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    
      {/* ========================================================================= */}
      {/* 서랍형 상세 Dossier 슬라이드오버 (선택 임차 자산 제원, 전대 마진 및 감사 타임라인) */}
      {/* ========================================================================= */}
      {selectedAssetForDossier && (() => {
        const a = selectedAssetForDossier;
        const renterName = getAssetRenterName(a);
        const cust = customers.find(c => c.id === a.currentCustomerId);
        const site = sites.find(s => s.id === a.currentSiteId);
        const assetLogs = assetInOutLogs.filter(l => l.assetId === a.id);
        const isReturned = Boolean(a.actualRentReturnDate) || a.status === 'RENTED_RETURNED';

        // 전대 마진 계산
        const custMonthlyFee = a.monthlyRentalFee || 0;
        const vendorMonthlyFee = a.monthlyRentFee || 0;
        const monthlyMargin = custMonthlyFee - vendorMonthlyFee;

        return (
          <div style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: '460px',
            backgroundColor: 'var(--bg-card)',
            borderLeft: '1px solid var(--border-color)',
            boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideLeft 0.2s ease-in-out'
          }}>
            {/* 헤더 */}
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--bg-app)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)' }}>
                  [{a.assetNo}] 임차 자산 상세 원장
                </span>
                {isReturned ? (
                  <span className="badge badge-secondary" style={{ fontSize: '10px' }}>반납완료</span>
                ) : (
                  <span className="badge badge-primary" style={{ fontSize: '10px' }}>가동중</span>
                )}
              </div>
              <button
                onClick={() => setSelectedAssetForDossier(null)}
                style={{ border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* 본문 스크롤 */}
            <div style={{ padding: '16px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '12px' }}>
              
              {/* 기본 제원 */}
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>장비 물리 제원 정보</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11.5px' }}>
                  <div><span style={{ color: 'var(--text-secondary)' }}>모델명:</span> <strong>{a.modelName}</strong></div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>제조사:</span> {a.manufacturer || '-'}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>시리얼번호:</span> {a.serialNo || '-'}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>원사번호:</span> {a.vendorAssetNo || '-'}</div>
                </div>
              </div>

              {/* 원사 임차 계약 정보 */}
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>소유 원사 임차 약정 조건</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11.5px' }}>
                  <div><span style={{ color: 'var(--text-secondary)' }}>소유 원사:</span> <strong>{renterName}</strong></div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>월 임차료:</span> <strong style={{ color: 'var(--danger)' }}>₩{(a.monthlyRentFee || 0).toLocaleString()}</strong></div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>임차 시작일:</span> {a.rentStart || '-'}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>만료예정일:</span> {a.rentEnd || '-'}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>원사 반납일:</span> {a.actualRentReturnDate ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>{a.actualRentReturnDate} (반납)</span> : '미반납'}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>일할 단가:</span> ₩{(a.dailyRentFee || 0).toLocaleString()}</div>
                </div>
              </div>

              {/* 고객사 전대 가동 및 마진 분석 */}
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>고객사 전대 운용 및 손익 마진</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11.5px' }}>
                  <div><span style={{ color: 'var(--text-secondary)' }}>투입 고객사:</span> {cust ? <strong>{cust.name}</strong> : '미투입'}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>투입 현장:</span> {site ? site.name : '-'}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>고객 렌탈료:</span> <strong style={{ color: 'var(--primary)' }}>₩{custMonthlyFee.toLocaleString()}</strong></div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>전대 월 순마진:</span>{' '}
                    <strong style={{ color: monthlyMargin >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {monthlyMargin >= 0 ? `+₩${monthlyMargin.toLocaleString()}` : `-₩${Math.abs(monthlyMargin).toLocaleString()}`}
                    </strong>
                  </div>
                </div>
                {monthlyMargin < 0 && (
                  <div style={{ marginTop: '6px', padding: '4px 8px', borderRadius: '4px', backgroundColor: 'var(--danger-light)', color: 'var(--danger)', fontSize: '11px', fontWeight: 600 }}>
                    ⚠️ 역마진 경고: 고객 대여료가 원사 임차료보다 낮아 대당 월 ₩{Math.abs(monthlyMargin).toLocaleString()} 손실 발생 중
                  </div>
                )}
              </div>

              {/* 자산 라이프사이클 감사 로그 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>자산 라이프사이클 감사 로그 ({assetLogs.length}건)</div>
                <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {assetLogs.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', padding: '10px 0', textAlign: 'center' }}>기록된 이벤트 로그가 없습니다.</div>
                  ) : (
                    assetLogs.map(log => (
                      <div
                        key={log.id}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '4px',
                          backgroundColor: 'var(--bg-app)',
                          border: '1px solid var(--border-color)',
                          fontSize: '11px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className={`badge ${log.type === 'ACQUISITION' ? 'badge-info' : log.type === 'OUTBOUND' ? 'badge-primary' : log.type === 'INBOUND' ? 'badge-success' : log.type === 'DISPOSAL' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '10px' }}>
                            {log.type}
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>{log.eventDate || log.createdAt?.slice(0, 10)}</span>
                        </div>
                        <div style={{ color: 'var(--text-main)', marginTop: '2px' }}>{log.memo || '-'}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* 푸터 */}
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedAssetForDossier(null)}
                style={{ padding: '5px 14px', fontSize: '12px' }}
              >
                닫기
              </button>
            </div>
          </div>
        );
      })()}
</div>
  );
};
