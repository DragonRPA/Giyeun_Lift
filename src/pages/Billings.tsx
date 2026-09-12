// src/pages/Billings.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { db, Asset, Billing, BillingDetail, ContractHistory, normalizeEndDate, formatContractEndDate } from '../services/db';
import { Plus, Download, Mail, CheckCircle, Search, DollarSign, Calendar, FileText, Send, Edit3, RotateCcw, AlertTriangle, Check, Layers } from 'lucide-react';
import { emailService } from '../services/email';
import { exportToExcel, exportTransactionStatementExcel, exportTransactionStatementExcelBuffer, calcServicePeriod, formatStatementItemName } from '../services/excel';
import { generateTransactionStatementPdf, generateTransactionStatementExcel } from '../services/excelTemplateEngine';
import { BillingInvoiceTab } from '../components/BillingInvoiceTab';
import { matchHangul } from '../utils/hangulSearch';


export const Billings: React.FC = () => {
  const {
    billings, billingDetails, customers, contacts, contracts, contractAssets, assets, sites, users, googleConfigs,
    generateBillingsForMonth, getDueContractsForBilling, generateDueBillings, regenerateBilling, generateBillingForSingleContract,
    receivePayment, cancelPayment, cancelAllPaymentsForBilling, hasPermission, currentUser, approveBilling, cancelBilling,
    refreshAllData, showErrorModal, bankTransactions, paymentDepositLinks, payments,
    repairs, linkRepairToBilling, unlinkRepairFromBilling, waiveRepairBilling, cancelRepairWaiver,
    deliveries, linkDeliveryToBilling, unlinkDeliveryFromBilling, waiveDeliveryBilling, cancelDeliveryWaiver,
    applyPrepaidBalanceForBilling,
    receivables, linkReceivableToBilling,
    currentTenant
  } = useApp();


  const canSave = hasPermission('billing', 'save');
  const isAdmin = currentUser?.role === 'ADMIN';

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const [activeTab, setActiveTab] = useState<'LIST' | 'GENERATE' | 'WIZARD' | 'INVOICE' | 'WAIVER'>('LIST');

  // --- 청구 조회 필터 상태 ---
  const initialYm = new Date().toISOString().slice(0, 7);
  const [tempSearchTerm, setTempSearchTerm] = useState('');
  const [tempContractNoFilter, setTempContractNoFilter] = useState('');
  const [tempStartBillingYmFilter, setTempStartBillingYmFilter] = useState(initialYm);
  const [tempEndBillingYmFilter, setTempEndBillingYmFilter] = useState(initialYm);
  const [tempPaymentFilter, setTempPaymentFilter] = useState<'ALL' | 'PAID' | 'UNPAID_ANY'>('ALL');
  const [tempMailSentFilter, setTempMailSentFilter] = useState<'ALL' | 'SENT' | 'UNSENT'>('ALL');
  const [tempInvoiceFilter, setTempInvoiceFilter] = useState<'ALL' | 'STANDALONE' | 'INTEGRATED'>('ALL');

  const [searchTerm, setSearchTerm] = useState('');
  const [contractNoFilter, setContractNoFilter] = useState('');
  const [startBillingYmFilter, setStartBillingYmFilter] = useState(initialYm);
  const [endBillingYmFilter, setEndBillingYmFilter] = useState(initialYm);
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | 'PAID' | 'UNPAID_ANY'>('ALL');
  const [mailSentFilter, setMailSentFilter] = useState<'ALL' | 'SENT' | 'UNSENT'>('ALL');
  const [invoiceFilter, setInvoiceFilter] = useState<'ALL' | 'STANDALONE' | 'INTEGRATED'>('ALL');
  // --- 명시적 조회(Snapshot) 상태: [조회] 버튼을 누를 때만 목록 갱신 ---
  const [searchedBillingIds, setSearchedBillingIds] = useState<string[] | null>(null);

  // --- 청구 마법사 상태 ---
  const [wizardSearchStartDate, setWizardSearchStartDate] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  });
  const [wizardSearchEndDate, setWizardSearchEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  // ⚡ Z-구텐버그 좌상단 Scope 퀵버튼 기간 설정 핸들러 (전월/당월/익월/최근 3개월/연간)
  const handleSetWizardPeriod = (type: 'PREV_MONTH' | 'THIS_MONTH' | 'NEXT_MONTH' | 'LAST_3_MONTHS' | 'ALL_YEAR') => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();

    let sDate: string;
    let eDate: string;

    if (type === 'THIS_MONTH') {
      const end = new Date(y, m + 1, 0);
      sDate = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      eDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    } else if (type === 'PREV_MONTH') {
      const prevDate = new Date(y, m - 1, 1);
      const prevY = prevDate.getFullYear();
      const prevM = prevDate.getMonth();
      const end = new Date(prevY, prevM + 1, 0);
      sDate = `${prevY}-${String(prevM + 1).padStart(2, '0')}-01`;
      eDate = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    } else if (type === 'NEXT_MONTH') {
      const nextDate = new Date(y, m + 1, 1);
      const nextY = nextDate.getFullYear();
      const nextM = nextDate.getMonth();
      const end = new Date(nextY, nextM + 1, 0);
      sDate = `${nextY}-${String(nextM + 1).padStart(2, '0')}-01`;
      eDate = `${nextY}-${String(nextM + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    } else if (type === 'LAST_3_MONTHS') {
      const startDate = new Date(y, m - 2, 1);
      const startY = startDate.getFullYear();
      const startM = startDate.getMonth();
      const end = new Date(y, m + 1, 0);
      sDate = `${startY}-${String(startM + 1).padStart(2, '0')}-01`;
      eDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    } else {
      sDate = `${y}-01-01`;
      eDate = `${y}-12-31`;
    }

    setWizardSearchStartDate(sDate);
    setWizardSearchEndDate(eDate);
  };

  const activeQuickPeriod = useMemo<'PREV_MONTH' | 'THIS_MONTH' | 'NEXT_MONTH' | 'LAST_3_MONTHS' | 'ALL_YEAR' | null>(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();

    const check = (type: 'PREV_MONTH' | 'THIS_MONTH' | 'NEXT_MONTH' | 'LAST_3_MONTHS' | 'ALL_YEAR') => {
      let s: string;
      let e: string;
      if (type === 'THIS_MONTH') {
        const end = new Date(y, m + 1, 0);
        s = `${y}-${String(m + 1).padStart(2, '0')}-01`;
        e = `${y}-${String(m + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      } else if (type === 'PREV_MONTH') {
        const prevDate = new Date(y, m - 1, 1);
        const prevY = prevDate.getFullYear();
        const prevM = prevDate.getMonth();
        const end = new Date(prevY, prevM + 1, 0);
        s = `${prevY}-${String(prevM + 1).padStart(2, '0')}-01`;
        e = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      } else if (type === 'NEXT_MONTH') {
        const nextDate = new Date(y, m + 1, 1);
        const nextY = nextDate.getFullYear();
        const nextM = nextDate.getMonth();
        const end = new Date(nextY, nextM + 1, 0);
        s = `${nextY}-${String(nextM + 1).padStart(2, '0')}-01`;
        e = `${nextY}-${String(nextM + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      } else if (type === 'LAST_3_MONTHS') {
        const startDate = new Date(y, m - 2, 1);
        const startY = startDate.getFullYear();
        const startM = startDate.getMonth();
        const end = new Date(y, m + 1, 0);
        s = `${startY}-${String(startM + 1).padStart(2, '0')}-01`;
        e = `${y}-${String(m + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      } else {
        s = `${y}-01-01`;
        e = `${y}-12-31`;
      }
      return wizardSearchStartDate === s && wizardSearchEndDate === e;
    };

    if (check('THIS_MONTH')) return 'THIS_MONTH';
    if (check('PREV_MONTH')) return 'PREV_MONTH';
    if (check('NEXT_MONTH')) return 'NEXT_MONTH';
    if (check('LAST_3_MONTHS')) return 'LAST_3_MONTHS';
    if (check('ALL_YEAR')) return 'ALL_YEAR';
    return null;
  }, [wizardSearchStartDate, wizardSearchEndDate]);

  // 마법사 고객, 계약번호, 현장명 필터 상태
  const [wizardTempCustomerFilter, setWizardTempCustomerFilter] = useState('');
  const [wizardTempContractNoFilter, setWizardTempContractNoFilter] = useState('');
  const [wizardTempSiteFilter, setWizardTempSiteFilter] = useState('');

  const [wizardCustomerFilter, setWizardCustomerFilter] = useState('');
  const [wizardContractNoFilter, setWizardContractNoFilter] = useState('');
  const [wizardSiteFilter, setWizardSiteFilter] = useState('');

  const [selectedContractIdForWizard, setSelectedContractIdForWizard] = useState<string | null>(null);
  const [wizardStartDate, setWizardStartDate] = useState('');
  const [wizardEndDate, setWizardEndDate] = useState('');
  const [calcMethod, setCalcMethod] = useState<'MONTHLY' | 'PRORATED'>('MONTHLY');
  const [extraCharges, setExtraCharges] = useState<{ id: string; category: string; customName: string; quantity: number; unitPrice: number }[]>([]);

  // 마법사 청구귀속월 & 청구발행일자 수동 지정 상태 (기본값: 생성 연월/오늘)
  const [wizardBillingYm, setWizardBillingYm] = useState(() => new Date().toISOString().slice(0, 7));
  const [wizardBillingDate, setWizardBillingDate] = useState(() => new Date().toISOString().split('T')[0]);
  
  // 마법사 연동 수리비 ID 목록
  
  // 마법사 연동 미수금 목록
  const [selectedReceivablesForWizard, setSelectedReceivablesForWizard] = useState<{ receivableId: string; amount: number; displayName: string }[]>([]);
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);

  // 청구 생성 입력
  const [billingYm, setBillingYm] = useState(() => new Date().toISOString().slice(0, 7));
  const [billingDate, setBillingDate] = useState(() => new Date().toISOString().split('T')[0]);

  // 청구귀속월 수동 변경 핸들러
  const handleEditBillingYm = async (billingId: string, currentYmVal: string) => {
    const newYm = prompt('✏️ 변경할 청구귀속월을 입력해 주세요 (형식: YYYY-MM, 예: 2026-08):', currentYmVal);
    if (!newYm || !newYm.trim() || newYm.trim() === currentYmVal) return;
    
    if (!/^\d{4}-\d{2}$/.test(newYm.trim())) {
      showToast('입력 형식이 올바르지 않습니다. YYYY-MM 형식으로 입력해 주세요.', 'error');
      return;
    }

    try {
      db.updateRow<Billing>('billings', billingId, {
        billingYm: newYm.trim(),
        updatedAt: new Date().toISOString()
      });
      refreshAllData();
      await db.awaitPendingWrites();
      showToast(`청구귀속월이 [${newYm.trim()}]으로 성공적으로 변경되었습니다.`);
    } catch (err: any) {
      showErrorModal(`⚠️ 청구귀속월 변경 중 DB 저장 실패:\n\n${err?.message || err}`, '청구월 수정 오류');
    }
  };

  // 선택된 청구서 상세
  const [selectedBillingId, setSelectedBillingId] = useState<string | null>(null);

  // 수납 입력 모달
  const [showPayModal, setShowPayModal] = useState(false);
  const [payBillingId, setPayBillingId] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payMethod, setPayMethod] = useState('BANK_TRANSFER');
  const [payMemo, setPayMemo] = useState('');
  // 2대 전용 탭: 통장입금액 수납 / 카드결제
  const [payMode, setPayMode] = useState<'DEPOSIT' | 'CARD'>('DEPOSIT');
  const [depositLinkDraft, setDepositLinkDraft] = useState<Record<string, number>>({}); // txId -> usedAmount
  const [cardApprovalNo, setCardApprovalNo] = useState(''); // 카드전표번호(승인번호)
  const [cardAmount, setCardAmount] = useState(0); // 카드 결제금액
  // 마법사 연동 수리비 ID 목록
  const [selectedRepairIdsForWizard, setSelectedRepairIdsForWizard] = useState<string[]>([]);
  // 마법사 연동 운송료 ID 목록
  const [selectedDeliveryIdsForWizard, setSelectedDeliveryIdsForWizard] = useState<string[]>([]);

  // --- 청구 면제 대장 (WAIVER 탭) 상태 ---
  const [waiverStartMonth, setWaiverStartMonth] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return d.toISOString().slice(0, 7);
  });
  const [waiverEndMonth, setWaiverEndMonth] = useState(initialYm);
  const [waiverCategoryFilter, setWaiverCategoryFilter] = useState<'ALL' | 'FIELD_AS' | 'INBOUND_REPAIR' | 'DELIVERY'>('ALL');
  const [waiverSearchKeyword, setWaiverSearchKeyword] = useState('');

  // --- 영업 청구 면제 모달 상태 ---
  interface WaiverModalData {
    type: 'REPAIR' | 'DELIVERY';
    id: string;
    title: string;
    originalCost: number;
    customerName?: string;
    contractNo?: string;
    assetNo?: string;
    modelName?: string;
    date?: string;
  }
  const [waiverModalTarget, setWaiverModalTarget] = useState<WaiverModalData | null>(null);
  const [waiverInputAmount, setWaiverInputAmount] = useState<number>(0);
  const [waiverInputCategory, setWaiverInputCategory] = useState<string>('단골 고객 우대');
  const [waiverInputCustomReason, setWaiverInputCustomReason] = useState<string>('');
  const [isWaiverSubmitting, setIsWaiverSubmitting] = useState<boolean>(false);

  const handleOpenWaiverModal = (target: WaiverModalData) => {
    setWaiverModalTarget(target);
    setWaiverInputAmount(target.originalCost);
    setWaiverInputCategory('단골 고객 우대');
    setWaiverInputCustomReason('');
  };

  const handleConfirmWaiverModal = async () => {
    if (!waiverModalTarget) return;
    if (waiverInputAmount < 0) {
      showToast('면제 금액은 0원 이상이어야 합니다.', 'error');
      return;
    }
    const finalReason = waiverInputCategory === '기타'
      ? (waiverInputCustomReason.trim() || '기타 영업 사유')
      : (waiverInputCustomReason.trim() ? `[${waiverInputCategory}] ${waiverInputCustomReason.trim()}` : `[${waiverInputCategory}]`);

    const waverName = currentUser?.name || '영업담당';

    try {
      setIsWaiverSubmitting(true);
      if (waiverModalTarget.type === 'REPAIR') {
        await waiveRepairBilling(waiverModalTarget.id, waiverInputAmount, finalReason, waverName);
        showToast(`수리비 ₩${waiverInputAmount.toLocaleString()}원 영업 청구 면제 처리되었습니다.`);
      } else if (waiverModalTarget.type === 'DELIVERY') {
        await waiveDeliveryBilling(waiverModalTarget.id, waiverInputAmount, finalReason, waverName);
        showToast(`운송료 ₩${waiverInputAmount.toLocaleString()}원 영업 청구 면제 처리되었습니다.`);
      }
      setWaiverModalTarget(null);
    } catch (err: any) {
      showToast(`면제 처리 실패: ${err?.message || err}`, 'error');
    } finally {
      setIsWaiverSubmitting(false);
    }
  };
  // 통합 검색 필터 (고객명/입금자명/계좌번호/비고)
  const [depSearchQuery, setDepSearchQuery] = useState(''); // 통합 검색어

  // 🌟 수납 모달 완료 버튼 포커스 Ref 및 ESC 키 취소 이벤트
  const paySubmitBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!showPayModal) return;

    // 모달 렌더링 직후 완료처리 버튼으로 자동 포커스
    const timer = setTimeout(() => {
      paySubmitBtnRef.current?.focus();
    }, 60);

    // ESC 키 입력 시 취소(닫기) 이벤트
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowPayModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showPayModal]);

  // 메일 전송 모달 (거래명세서 메일 발송)
  const [showMailModal, setShowMailModal] = useState(false);
  const [mailBillingId, setMailBillingId] = useState('');
  const [mailTo, setMailTo] = useState(''); // 수신인 (기본값 자동입력 & 수동 수정/추가 지정 가능)
  const [mailCc, setMailCc] = useState(''); // 참조인 (CC 추가 지정 가능)
  const [mailSubject, setMailSubject] = useState(''); // 메일 제목
  const [isSending, setIsSending] = useState(false);


  const getCustName = (id: string) => customers.find(c => c.id === id)?.name || '-';

  // 고유 청구월 목록 추출
  const billingMonths = Array.from(new Set(billings.map(b => b.billingYm))).sort().reverse();

  // 필터 조건을 기반으로 일치하는 billingId 목록 계산 함수
  const computeMatchedBillingIds = (
    sTerm: string,
    cFilter: string,
    startYm: string,
    endYm: string,
    pFilter: 'ALL' | 'PAID' | 'UNPAID_ANY',
    mFilter: 'ALL' | 'SENT' | 'UNSENT',
    invFilter: 'ALL' | 'STANDALONE' | 'INTEGRATED' = 'ALL'
  ) => {
    return billings.filter(b => {
      if (b.status === 'REJECTED') return false;

      const custName = getCustName(b.customerId).toLowerCase();
      const contractObj = contracts.find(c => c.id === b.contractId);
      const contractNoStr = (contractObj?.contractNo || b.contractId || '').toLowerCase();

      if (sTerm && !matchHangul(getCustName(b.customerId), sTerm)) return false;
      if (cFilter && !contractNoStr.includes(cFilter.trim().toLowerCase())) return false;
      if (startYm && b.billingYm < startYm) return false;
      if (endYm && b.billingYm > endYm) return false;

      const supply = b.totalAmount || 0;
      const grand = supply + Math.round(supply * 0.1);
      const isPaid = b.status === 'PAID';
      const actualPaid = isPaid ? grand : (b.paidAmount || 0);
      const unpaid = isPaid ? 0 : Math.max(0, grand - actualPaid);
      const isFullyPaid = isPaid || unpaid <= 0;
      if (pFilter === 'PAID' && !isFullyPaid) return false;
      if (pFilter === 'UNPAID_ANY' && isFullyPaid) return false;

      const isMailSent = b.status !== 'UNPAID';
      if (mFilter === 'SENT' && !isMailSent) return false;
      if (mFilter === 'UNSENT' && isMailSent) return false;

      // 📑 통합 여부 필터 (단독 청구 vs 통합 인보이스 포함)
      if (invFilter === 'STANDALONE' && b.invoiceId && b.invoiceId.trim() !== '') return false;
      if (invFilter === 'INTEGRATED' && (!b.invoiceId || b.invoiceId.trim() === '')) return false;

      return true;
    }).map(b => b.id);
  };

  // 최초 1회 초기 필터 조건으로 조회 스냅샷 생성
  useEffect(() => {
    if (searchedBillingIds === null && billings.length > 0) {
      let effectiveStartYm = startBillingYmFilter;
      let effectiveEndYm = endBillingYmFilter;
      // 당월 청구 데이터가 없고 과거 청구 내역이 있는 경우 가장 최신 청구월로 자동 포커스
      if (!billings.some(b => b.billingYm === initialYm) && billingMonths.length > 0) {
        effectiveStartYm = billingMonths[0];
        effectiveEndYm = billingMonths[0];
        setTempStartBillingYmFilter(effectiveStartYm);
        setTempEndBillingYmFilter(effectiveEndYm);
        setStartBillingYmFilter(effectiveStartYm);
        setEndBillingYmFilter(effectiveEndYm);
      }
      const ids = computeMatchedBillingIds(searchTerm, contractNoFilter, effectiveStartYm, effectiveEndYm, paymentFilter, mailSentFilter, invoiceFilter);
      setSearchedBillingIds(ids);
    }
  }, [billings.length]);

  const handleSearchClick = () => {
    setSearchTerm(tempSearchTerm);
    setContractNoFilter(tempContractNoFilter);
    setStartBillingYmFilter(tempStartBillingYmFilter);
    setEndBillingYmFilter(tempEndBillingYmFilter);
    setPaymentFilter(tempPaymentFilter);
    setMailSentFilter(tempMailSentFilter);
    setInvoiceFilter(tempInvoiceFilter);

    // [조회] 버튼을 누를 때만 최신 조건으로 스냅샷 갱신
    const matched = computeMatchedBillingIds(
      tempSearchTerm,
      tempContractNoFilter,
      tempStartBillingYmFilter,
      tempEndBillingYmFilter,
      tempPaymentFilter,
      tempMailSentFilter,
      tempInvoiceFilter
    );
    setSearchedBillingIds(matched);
  };

  const handleResetFilters = () => {
    const defaultYm = billings.some(b => b.billingYm === initialYm) ? initialYm : (billingMonths[0] || initialYm);
    setTempSearchTerm('');
    setTempContractNoFilter('');
    setTempStartBillingYmFilter(defaultYm);
    setTempEndBillingYmFilter(defaultYm);
    setTempPaymentFilter('ALL');
    setTempMailSentFilter('ALL');
    setTempInvoiceFilter('ALL');

    setSearchTerm('');
    setContractNoFilter('');
    setStartBillingYmFilter(defaultYm);
    setEndBillingYmFilter(defaultYm);
    setPaymentFilter('ALL');
    setMailSentFilter('ALL');
    setInvoiceFilter('ALL');

    const matched = computeMatchedBillingIds('', '', defaultYm, defaultYm, 'ALL', 'ALL', 'ALL');
    setSearchedBillingIds(matched);
  };

  // ◀ 전월 / 당월 / 다음달 ▶ 기간 이동 핸들러
  const shiftMonth = (baseYm: string, deltaMonths: number): string => {
    const ym = baseYm || new Date().toISOString().slice(0, 7);
    const [yStr, mStr] = ym.split('-');
    const date = new Date(Number(yStr), Number(mStr) - 1 + deltaMonths, 1);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  };

  const handlePrevMonth = () => {
    const curYm = tempStartBillingYmFilter || tempEndBillingYmFilter || new Date().toISOString().slice(0, 7);
    const nextYm = shiftMonth(curYm, -1);
    setTempStartBillingYmFilter(nextYm);
    setTempEndBillingYmFilter(nextYm);
    setStartBillingYmFilter(nextYm);
    setEndBillingYmFilter(nextYm);
    setSearchTerm(tempSearchTerm);
    setContractNoFilter(tempContractNoFilter);
    setPaymentFilter(tempPaymentFilter);
    setMailSentFilter(tempMailSentFilter);
    const matched = computeMatchedBillingIds(tempSearchTerm, tempContractNoFilter, nextYm, nextYm, tempPaymentFilter, tempMailSentFilter);
    setSearchedBillingIds(matched);
  };

  const handleCurrentMonth = () => {
    const nowYm = new Date().toISOString().slice(0, 7);
    setTempStartBillingYmFilter(nowYm);
    setTempEndBillingYmFilter(nowYm);
    setStartBillingYmFilter(nowYm);
    setEndBillingYmFilter(nowYm);
    setSearchTerm(tempSearchTerm);
    setContractNoFilter(tempContractNoFilter);
    setPaymentFilter(tempPaymentFilter);
    setMailSentFilter(tempMailSentFilter);
    const matched = computeMatchedBillingIds(tempSearchTerm, tempContractNoFilter, nowYm, nowYm, tempPaymentFilter, tempMailSentFilter);
    setSearchedBillingIds(matched);
  };

  const handleNextMonth = () => {
    const curYm = tempEndBillingYmFilter || tempStartBillingYmFilter || new Date().toISOString().slice(0, 7);
    const nextYm = shiftMonth(curYm, 1);
    setTempStartBillingYmFilter(nextYm);
    setTempEndBillingYmFilter(nextYm);
    setStartBillingYmFilter(nextYm);
    setEndBillingYmFilter(nextYm);
    setSearchTerm(tempSearchTerm);
    setContractNoFilter(tempContractNoFilter);
    setPaymentFilter(tempPaymentFilter);
    setMailSentFilter(tempMailSentFilter);
    const matched = computeMatchedBillingIds(tempSearchTerm, tempContractNoFilter, nextYm, nextYm, tempPaymentFilter, tempMailSentFilter);
    setSearchedBillingIds(matched);
  };

  // 🌟 조회 버튼으로 고정된 스냅샷에 해당하는 청구서만 렌더링 (수납 처리 시 자동 재조회/행 삭제 없이 안정적으로 유지)
  const filteredBillings = useMemo(() => {
    if (searchedBillingIds === null) {
      return billings.filter(b => b.status !== 'REJECTED');
    }
    const billingMap = new Map(billings.map(b => [b.id, b]));
    return searchedBillingIds
      .map(id => billingMap.get(id))
      .filter((b): b is Billing => !!b && b.status !== 'REJECTED');
  }, [searchedBillingIds, billings]);

  const handleExportExcel = () => {
    const excelData = filteredBillings.map((b, idx) => {
      const supply = b.totalAmount || 0;
      const vat = Math.round(supply * 0.1);
      const grand = supply + vat;
      const isPaid = b.status === 'PAID';
      const actualPaid = isPaid ? grand : (b.paidAmount || 0);
      const unpaid = isPaid ? 0 : Math.max(0, grand - actualPaid);
      return {
        // ① 식별 및 기준정보
        'No': idx + 1,
        '청구ID': b.id,
        '청구연월': b.billingYm,
        '고객사명': getCustName(b.customerId),
        '청구 일자': b.billingDate || '-',

        // ② 금액 및 세무
        '공급가액(원)': supply,
        '부가세(원)': vat,
        '청구총액(VAT포함, 원)': grand,
        '수납 누적액(원)': actualPaid,
        '미납 잔액(원)': unpaid,

        // ③ 상태 및 일정
        '결제/발송 상태': b.status === 'UNPAID'    ? '미발송' :
                         b.status === 'REQUESTED' ? '발송완료(미납)' :
                         b.status === 'REJECTED'  ? '이의제기(취소)' :
                         b.status === 'PAID'      ? '완납' :
                         b.status === 'PARTIAL'   ? '일부납' : b.status,
        '수납 최종일': b.status === 'PAID' && b.updatedAt ? b.updatedAt.split('T')[0] : '-',
        '등록일시': b.createdAt ? b.createdAt.split('T')[0] : '-'
      };
    });

    exportToExcel(excelData, `청구수납대장_${new Date().toISOString().split('T')[0]}`, '청구목록');
  };

  const activeBilling = billings.find(b => b.id === selectedBillingId);
  const activeBillingDetails = selectedBillingId 
    ? [...billingDetails.filter(bd => bd.billingId === selectedBillingId)].sort((a, b) => {
        const aIsAsset = Boolean(a.contractAssetId);
        const bIsAsset = Boolean(b.contractAssetId);
        if (aIsAsset && !bIsAsset) return -1;
        if (!aIsAsset && bIsAsset) return 1;
        return 0;
      })
    : [];

  const handleGenerateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    
    // 청구 생성 호출
    generateBillingsForMonth(billingYm, billingDate);
    
    showToast(`${billingYm} 마감일 기준 청구 데이터가 성공적으로 생성되었습니다.`);
    setActiveTab('LIST');
  };

  // 도래 계약 청구 일괄 생성 상태 & 핸들러
  const [isGeneratingDue, setIsGeneratingDue] = useState(false);
  const [skippedContracts, setSkippedContracts] = useState<{ contractId: string; customerId: string; reason: string }[]>([]);

  const handleGenerateDue = async () => {
    if (isGeneratingDue) return;
    setIsGeneratingDue(true);
    try {
      const result = await generateDueBillings();
      setSkippedContracts(result.skippedContracts || []);

      if (result.successCount > 0) {
        showToast(`${result.successCount}건의 도래 계약 기본 청구서가 성공적으로 생성되었습니다.`);
      } else if (result.skippedContracts.length === 0) {
        showToast('생성할 도래 계약이 없거나 이미 모두 생성되었습니다.', 'warning');
      }

      if (result.skippedContracts.length > 0) {
        showToast(`외상미수금 존재 등으로 ${result.skippedContracts.length}건의 청구가 보류되었습니다.`, 'warning');
      }
    } catch (err: any) {
      showErrorModal(`⚠️ 일괄 생성 오류:\n\n${err?.message || err}`, '도래 계약 청구 생성 실패');
    } finally {
      setIsGeneratingDue(false);
    }
  };

  // 청구 수정 재생성 모달 상태 & 핸들러
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [regenBillingId, setRegenBillingId] = useState('');
  const [regenBillingYm, setRegenBillingYm] = useState('');
  const [regenBillingDate, setRegenBillingDate] = useState('');
  const [regenMemo, setRegenMemo] = useState('');
  const [regenDetails, setRegenDetails] = useState<Omit<BillingDetail, 'id' | 'billingId' | 'createdAt'>[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleOpenRegenerate = (billingId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const targetB = billings.find(b => b.id === billingId);
    if (!targetB) return;
    const targetDetails = billingDetails.filter(bd => bd.billingId === billingId);
    setRegenBillingId(billingId);
    setRegenBillingYm(targetB.billingYm);
    setRegenBillingDate(targetB.billingDate || new Date().toISOString().split('T')[0]);
    setRegenMemo('담당자 검토 후 단가/항목 수정 재생성');
    setRegenDetails(targetDetails.map(td => ({
      contractAssetId: td.contractAssetId,
      itemName: td.itemName,
      quantity: td.quantity || 1,
      unitPrice: td.unitPrice || 0,
      amount: td.amount || ((td.quantity || 1) * (td.unitPrice || 0)),
      description: td.description || ''
    })));
    setShowRegenerateModal(true);
  };

  const handleRegenerateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regenBillingId || regenDetails.length === 0) return;
    setIsRegenerating(true);
    try {
      const newId = await regenerateBilling(regenBillingId, regenDetails, {
        billingYm: regenBillingYm,
        billingDate: regenBillingDate,
        memo: regenMemo
      });
      setShowRegenerateModal(false);
      setSelectedBillingId(newId);
      showToast('새 청구서가 발행되었습니다. (기존 건 취소 마감)');
    } catch (err: any) {
      showErrorModal(`⚠️ 청구서 수정 재생성 실패:\n\n${err?.message || err}`, '재생성 오류');
    } finally {
      setIsRegenerating(false);
    }
  };

  // 거래명세서 발송: UNPAID → REQUESTED (F-2 원칙)
  const handleApprove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await approveBilling(id);
      showToast('거래명세서가 발송되었습니다.');
    } catch (err: any) {
      showErrorModal(`발송 실패: ${err?.message || err}`);
    }
  };

  // 청구 취소: 환불/비환불 2-path (J-2 원칙)
  const handleCancel = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const billing = billings.find(b => b.id === id);
    const hasPaid = billing && billing.paidAmount > 0;

    showToast('청구서를 취소(REJECTED) 마감합니다.');

    try {
      if (hasPaid) {
        const refund = true;
        await cancelBilling(id, refund);
      } else {
        await cancelBilling(id, false);
      }
    } catch (err: any) {
      showErrorModal(`청구 취소 실패: ${err?.message || err}`);
    }
  };

  // 🌟 수납 내역 1건 취소 (개별 롤백)
  const handleCancelPayment = async (paymentId: string, amount: number) => {
showToast('수납 내역 취소 및 통장 잔액을 복원합니다.');
    try {
      await cancelPayment(paymentId);
      showToast('수납이 정상적으로 취소(롤백)되었습니다.');
    } catch (err: any) {
      showErrorModal(`⚠️ 수납 취소 실패:\n${err?.message || err}`);
    }
  };

  // 🌟 청구서 전체 수납 일괄 취소 (일괄 롤백)
  const handleCancelAllPayments = async (billingId: string, totalPaid: number) => {
showToast('모든 수납 내역 일괄 취소 및 통장 잔액을 복원합니다.');
    try {
      await cancelAllPaymentsForBilling(billingId);
      showToast('모든 수납 내역이 취소(롤백)되었습니다.');
    } catch (err: any) {
      showErrorModal(`⚠️ 수납 일괄 취소 실패:\n${err?.message || err}`);
    }
  };

  // v2: 미납액 기준으로 입금잔액 자동 할당 (음수 방지 및 통일)
  const getDepositBalance = (txId: string) => {
    const tx = bankTransactions.find(t => t.id === txId);
    if (!tx) return 0;
    const linkedPaymentIds = new Set(
      (paymentDepositLinks || []).filter(l => l.bankTransactionId === txId).map(l => l.paymentId)
    );
    const linkUsed = (paymentDepositLinks || [])
      .filter(l => l.bankTransactionId === txId)
      .reduce((s, l) => s + l.usedAmount, 0);
    const legacyUsed = (payments || [])
      .filter(p => p.id.startsWith(`pay-matching-${txId}`) && !linkedPaymentIds.has(p.id))
      .reduce((s, p) => s + p.amount, 0);
    return Math.max(0, (tx.depositAmount || 0) - (linkUsed + legacyUsed));
  };

  const handleOpenPay = (bId: string, unpaidAmount: number) => {
    const billing = billings.find(b => b.id === bId);
    const custId = billing?.customerId;
    const custName = customers.find(c => c.id === custId)?.name || '';

    // 검색어 초기값: 고객명 → 고객명으로 매핑된 입금내역 자동 표시
    setDepSearchQuery(custName);
    setPayBillingId(bId);
    setPayDate(new Date().toISOString().split('T')[0]);
    setPayMethod('BANK_TRANSFER');
    setPayMemo('');
    setPayMode('DEPOSIT');
    setCardApprovalNo('');
    setCardAmount(unpaidAmount);

    // 고객명 기준 검색 및 등록 계좌 일치 건 매핑 후 오래된 것부터 자동 할당 (선입선출)
    const targetCust = customers.find(c => c.id === custId);
    const regAccounts = targetCust?.bankAccounts || [];
    const query = custName.trim().toLowerCase();

    const matchedDeposits = bankTransactions
      .filter(t => {
        if (!t.isDeposit) return false;

        // 1) 고객사 등록 계좌번호와 일치 여부 검사
        const senderAccNorm = (t.senderAccount || '').replace(/[^0-9]/g, '');
        const isRegAccMatch = senderAccNorm && regAccounts.some(a => {
          const norm = a.accountNumber.replace(/[^0-9]/g, '');
          return norm && (norm === senderAccNorm || senderAccNorm.includes(norm) || norm.includes(senderAccNorm));
        });
        if (isRegAccMatch) return true;

        // 2) 고객명, 입금자명, 계좌번호, 비고 검색어 기준
        const mappedCustName = customers.find(c => c.id === t.customerId)?.name || '';
        return (
          (query && t.senderName.toLowerCase().includes(query)) ||
          (query && mappedCustName.toLowerCase().includes(query)) ||
          (query && (t.senderAccount || '').toLowerCase().includes(query)) ||
          (query && (t.memo || '').toLowerCase().includes(query))
        );
      })
      .map(t => ({ ...t, balance: getDepositBalance(t.id) }))
      .filter(t => t.balance > 0)
      .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

    const draft: Record<string, number> = {};
    let remaining = unpaidAmount;
    for (const dep of matchedDeposits) {
      if (remaining <= 0) break;
      const use = Math.min(dep.balance, remaining);
      draft[dep.id] = use;
      remaining -= use;
    }
    setDepositLinkDraft(draft);
    setShowPayModal(true);
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !payBillingId) return;

    if (payMode === 'DEPOSIT') {
      const links = Object.entries(depositLinkDraft)
        .filter(([, amt]) => amt > 0)
        .map(([txId, amt]) => ({ bankTransactionId: txId, usedAmount: amt }));

      if (links.length === 0) {
        showErrorModal('수납할 입금건을 선택하고 금액을 입력하세요.', '수납 오류');
        return;
      }

      // 각 입금건 잔액 초과 검증
      for (const link of links) {
        const bal = getDepositBalance(link.bankTransactionId);
        if (link.usedAmount > bal) {
          const tx = bankTransactions.find(t => t.id === link.bankTransactionId);
          showErrorModal(
            `[${tx?.senderName}] 입금잔액 부족\n잔액: ${bal.toLocaleString()}원 / 입력 금액: ${link.usedAmount.toLocaleString()}원`,
            '수납 오류'
          );
          return;
        }
      }

      const totalAmount = links.reduce((s, l) => s + l.usedAmount, 0);
      receivePayment(payBillingId, {
        paymentDate: payDate,
        amount: totalAmount,
        method: 'BANK_TRANSFER',
        memo: payMemo || `통장입금 연동 ${links.length}건 합산`,
        depositLinks: links
      });
    } else if (payMode === 'CARD') {
      if (!cardApprovalNo.trim()) {
        showErrorModal('카드전표번호(승인번호)를 입력해 주십시오.', '수납 오류');
        return;
      }
      if (cardAmount <= 0) {
        showErrorModal('결제금액을 1원 이상 입력해 주십시오.', '수납 오류');
        return;
      }
      receivePayment(payBillingId, {
        paymentDate: payDate,
        amount: cardAmount,
        method: 'CARD',
        memo: payMemo ? `${payMemo} (카드승인: ${cardApprovalNo.trim()})` : `카드결제 (승인번호: ${cardApprovalNo.trim()})`
      });
    }

    setShowPayModal(false);
    setPayBillingId('');
  };

  const handleOpenMail = (billingId: string) => {
    setMailBillingId(billingId);
    const billing = billings.find(b => b.id === billingId);
    if (!billing) return;

    const customer = customers.find(c => c.id === billing.customerId);
    const contract = contracts.find(c => c.id === billing.contractId);
    const site = sites.find(s => s.id === contract?.siteId);
    
    // 💡 수신인 후보군 자동 추출 (고객사 대표 이메일 + 해당 고객사 담당자 이메일 목록)
    const emails: string[] = [];
    if (customer?.repEmail && customer.repEmail !== '미상') {
      emails.push(customer.repEmail.trim());
    }

    const custContacts = contacts.filter(cc => cc.customerId === billing.customerId && cc.email && cc.email !== '미상' && cc.isActive !== false);
    custContacts.forEach(cc => {
      if (!emails.includes(cc.email.trim())) {
        emails.push(cc.email.trim());
      }
    });

    const custName = customer?.name || '고객명';
    const siteName = site?.name || '현장명';
    const contractNo = contract?.contractNo || billing.contractId || '계약번호';
    const ym = billing.billingYm || '';

    setMailTo(emails.join(', '));
    setMailCc('');
    setMailSubject(`[${currentTenant?.displayName || '거래명세서'}] 거래명세서_${ym}_${contractNo}_${custName}_${siteName}`);
    setShowMailModal(true);
  };

  // 거래명세서 정품 A4 PDF 생성 및 다운로드
  const downloadStatementPdf = async (billingId?: string) => {
    const targetBillingId = billingId || mailBillingId || selectedBillingId;
    const billing = billings.find(b => b.id === targetBillingId);
    const rawDetails = [...billingDetails.filter(d => d.billingId === targetBillingId)].sort((a, b) => {
      const aIsAsset = Boolean(a.contractAssetId);
      const bIsAsset = Boolean(b.contractAssetId);
      if (aIsAsset && !bIsAsset) return -1;
      if (!aIsAsset && bIsAsset) return 1;
      return 0;
    });
    const customer = customers.find(c => c.id === billing?.customerId);
    const contract = contracts.find(c => c.id === billing?.contractId);
    const site = sites.find(s => s.id === contract?.siteId);
    const salesperson = users.find((u: any) => u.id === contract?.salespersonId);
    const custName = customer?.name || '고객사';
    const sName = site?.name || '현장';
    const contractNo = contract?.contractNo || billing?.contractId || '계약번호';
    const ym = billing?.billingYm || '';
    const fileName = `[${currentTenant?.displayName || '거래명세서'}]_거래명세서_${ym}_${contractNo}_${custName}_${sName}.pdf`;

    const details = rawDetails.map(d => {
      const ca = contractAssets.find(cAsset => cAsset.id === d.contractAssetId);
      const asset = ca?.assetId 
        ? assets.find(a => a.id === ca.assetId) 
        : (d.assetId ? assets.find(a => a.id === d.assetId) : null);
      return {
        ...d,
        modelName: asset?.modelName || ca?.expectedModel || d.itemName,
        assetNo: asset?.assetNo ? asset.assetNo : (ca?.assetId ? ca.assetId : ((d as any).assetNo || ''))
      };
    });

    const billingDate = billing?.billingDate || new Date().toISOString().split('T')[0];
    const parts = billingDate.split('-');
    const dateM = parts[1] ? Number(parts[1]) : 0;
    const dateD = parts[2] ? Number(parts[2]) : 0;

    let totalSupply = 0;
    let totalVat = 0;

    const items = details.map(d => {
      let unitPrice = d.unitPrice || 0;
      let quantity = d.quantity || 1;
      const supplyAmount = d.amount || (unitPrice * quantity);
      const isRental = Boolean(d.contractAssetId || d.assetId);
      if (isRental && quantity >= 28 && supplyAmount > 0) {
        quantity = 1;
        unitPrice = supplyAmount;
      }
      const vatAmount = Math.round(supplyAmount * 0.1);
      totalSupply += supplyAmount;
      totalVat += vatAmount;

      return {
        month: dateM,
        day: dateD,
        itemDescription: formatStatementItemName(d, billing, contract),
        quantity,
        unitPrice,
        supplyAmount,
        vatAmount,
        notes: (d as any).memo || (d as any).notes || ''
      };
    });

    try {
      const pdfBytes = await generateTransactionStatementPdf({
        billingDate,
        billingYm: ym,
        contractNo: contract?.contractNo,
        lessorBizNo: currentTenant?.businessNumber || '138-81-83251',
        lessorName: currentTenant?.tradeName || currentTenant?.corporateName || '(주)임대인',
        lessorCeo: currentTenant?.representativeName || '대표자',
        lessorAddress: currentTenant?.businessAddress || '',
        salespersonName: salesperson?.name || (contract as any)?.salespersonName || '-',
        salespersonPhone: (salesperson as any)?.mobile || salesperson?.phone || '-',
        billingManagerName: currentTenant?.workplaces?.[0]?.managerName || '경영지원팀',
        billingManagerPhone: currentTenant?.tel || '031-334-5295',
        lessorEmail: currentTenant?.taxEmail || currentTenant?.email || 'tax@ebro.com',

        customerBizNo: customer?.bizRegNo || '-',
        customerName: customer?.name || '-',
        customerCeo: customer?.representative || '-',
        customerAddress: customer?.address || '-',
        customerBizType: customer?.bizType || '-',
        customerBizItem: customer?.bizItem || '-',
        siteManagerName: (site as any)?.managerName || (site as any)?.contactPerson || (customer as any)?.managerName || '-',
        siteManagerPhone: (site as any)?.managerPhone || (site as any)?.contactPhone || (customer as any)?.phone || '-',
        custBillingManagerName: (customer as any)?.billingManagerName || (customer as any)?.managerName || '-',
        custBillingManagerPhone: (customer as any)?.billingManagerPhone || (customer as any)?.phone || '-',
        custBillingEmail: (customer as any)?.billingEmail || (customer as any)?.email || '-',
        siteName: site?.name || '-',
        bankAccount: currentTenant?.bankAccounts?.[0] ? `${currentTenant.bankAccounts[0].bankName} ${currentTenant.bankAccounts[0].accountNumber} , ${currentTenant.bankAccounts[0].accountHolder}` : '',

        items,
        totalSupply,
        totalVat,
        totalGrand: totalSupply + totalVat
      });

      const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showErrorModal('거래명세서 PDF 생성 및 다운로드 실패:\n\n' + (err?.message || String(err)));
    }
  };

  const downloadStatementExcel = async (billingId?: string) => {
    const targetBillingId = billingId || mailBillingId || selectedBillingId;
    const billing = billings.find(b => b.id === targetBillingId);
    const rawDetails = [...billingDetails.filter(d => d.billingId === targetBillingId)].sort((a, b) => {
      const aIsAsset = Boolean(a.contractAssetId);
      const bIsAsset = Boolean(b.contractAssetId);
      if (aIsAsset && !bIsAsset) return -1;
      if (!aIsAsset && bIsAsset) return 1;
      return 0;
    });
    const customer = customers.find(c => c.id === billing?.customerId);
    const contract = contracts.find(c => c.id === billing?.contractId);
    const site = sites.find(s => s.id === contract?.siteId);
    const salesperson = users.find((u: any) => u.id === contract?.salespersonId);
    const custName = customer?.name || '고객사';
    const sName = site?.name || '현장';
    const contractNo = contract?.contractNo || billing?.contractId || '계약번호';
    const ym = billing?.billingYm || '';
    const fileName = `[${currentTenant?.displayName || '거래명세서'}]_거래명세서_${ym}_${contractNo}_${custName}_${sName}.xlsx`;

    const details = rawDetails.map(d => {
      const ca = contractAssets.find(cAsset => cAsset.id === d.contractAssetId);
      const asset = ca?.assetId 
        ? assets.find(a => a.id === ca.assetId) 
        : (d.assetId ? assets.find(a => a.id === d.assetId) : null);
      return {
        ...d,
        modelName: asset?.modelName || ca?.expectedModel || d.itemName,
        assetNo: asset?.assetNo ? asset.assetNo : (ca?.assetId ? ca.assetId : ((d as any).assetNo || ''))
      };
    });

    const billingDate = billing?.billingDate || new Date().toISOString().split('T')[0];
    const parts = billingDate.split('-');
    const dateM = parts[1] ? Number(parts[1]) : 0;
    const dateD = parts[2] ? Number(parts[2]) : 0;

    let totalSupply = 0;
    let totalVat = 0;

    const items = details.map(d => {
      let unitPrice = d.unitPrice || 0;
      let quantity = d.quantity || 1;
      const supplyAmount = d.amount || (unitPrice * quantity);
      const isRental = Boolean(d.contractAssetId || d.assetId);
      if (isRental && quantity >= 28 && supplyAmount > 0) {
        quantity = 1;
        unitPrice = supplyAmount;
      }
      const vatAmount = Math.round(supplyAmount * 0.1);
      totalSupply += supplyAmount;
      totalVat += vatAmount;

      return {
        month: dateM,
        day: dateD,
        itemDescription: formatStatementItemName(d, billing, contract),
        quantity,
        unitPrice,
        supplyAmount,
        vatAmount,
        notes: (d as any).memo || (d as any).notes || ''
      };
    });

    try {
      const excelBuffer = await generateTransactionStatementExcel({
        billingDate,
        billingYm: ym,
        contractNo: contract?.contractNo,
        lessorBizNo: currentTenant?.businessNumber || '138-81-83251',
        lessorName: currentTenant?.tradeName || currentTenant?.corporateName || '(주)임대인',
        lessorCeo: currentTenant?.representativeName || '대표자',
        lessorAddress: currentTenant?.businessAddress || '',
        salespersonName: salesperson?.name || (contract as any)?.salespersonName || '-',
        salespersonPhone: (salesperson as any)?.mobile || salesperson?.phone || '-',
        billingManagerName: currentTenant?.workplaces?.[0]?.managerName || '경영지원팀',
        billingManagerPhone: currentTenant?.tel || '031-334-5295',
        lessorEmail: currentTenant?.taxEmail || currentTenant?.email || 'tax@ebro.com',

        customerBizNo: customer?.bizRegNo || '-',
        customerName: customer?.name || '-',
        customerCeo: customer?.representative || '-',
        customerAddress: customer?.address || '-',
        customerBizType: customer?.bizType || '-',
        customerBizItem: customer?.bizItem || '-',
        siteManagerName: (site as any)?.managerName || (site as any)?.contactPerson || (customer as any)?.managerName || '-',
        siteManagerPhone: (site as any)?.managerPhone || (site as any)?.contactPhone || (customer as any)?.phone || '-',
        custBillingManagerName: (customer as any)?.billingManagerName || (customer as any)?.managerName || '-',
        custBillingManagerPhone: (customer as any)?.billingManagerPhone || (customer as any)?.phone || '-',
        custBillingEmail: (customer as any)?.billingEmail || (customer as any)?.email || '-',
        siteName: site?.name || '-',
        bankAccount: currentTenant?.bankAccounts?.[0] ? `${currentTenant.bankAccounts[0].bankName} ${currentTenant.bankAccounts[0].accountNumber} , ${currentTenant.bankAccounts[0].accountHolder}` : '',

        items,
        totalSupply,
        totalVat,
        totalGrand: totalSupply + totalVat
      });

      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showErrorModal('거래명세서 엑셀 원본 생성 실패:\n\n' + (err?.message || String(err)));
    }
  };

  const handleSendStatementSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mailTo) {
      showToast('수신인 메일을 지정해 주세요.', 'error');
      return;
    }

    const config = googleConfigs[0];
    const isDev = config?.isDevMode !== false;
    if (isDev) {
      const confirmSend = true;
      if (!confirmSend) return;
    }

    setIsSending(true);
    const billing = billings.find(b => b.id === mailBillingId);
    const rawDetails = billingDetails.filter(d => d.billingId === mailBillingId);
    const customer = customers.find(c => c.id === billing?.customerId);
    const contract = contracts.find(c => c.id === billing?.contractId);
    const site = sites.find(s => s.id === contract?.siteId);
    const salesperson = users.find((u: any) => u.id === contract?.salespersonId);

    const details = rawDetails.map(d => {
      const ca = contractAssets.find(cAsset => cAsset.id === d.contractAssetId);
      const asset = ca?.assetId 
        ? assets.find(a => a.id === ca.assetId) 
        : (d.assetId ? assets.find(a => a.id === d.assetId) : null);
      return {
        ...d,
        modelName: asset?.modelName || ca?.expectedModel || d.itemName,
        assetNo: asset?.assetNo ? asset.assetNo : (ca?.assetId ? ca.assetId : ((d as any).assetNo || ''))
      };
    });

    const billingDate = billing?.billingDate || new Date().toISOString().split('T')[0];
    const parts = billingDate.split('-');
    const dateM = parts[1] ? Number(parts[1]) : 0;
    const dateD = parts[2] ? Number(parts[2]) : 0;

    let totalSupply = 0;
    let totalVat = 0;

    const items = details.map(d => {
      let unitPrice = d.unitPrice || 0;
      let quantity = d.quantity || 1;
      const supplyAmount = d.amount || (unitPrice * quantity);
      const isRental = Boolean(d.contractAssetId || d.assetId);
      if (isRental && quantity >= 28 && supplyAmount > 0) {
        quantity = 1;
        unitPrice = supplyAmount;
      }
      const vatAmount = Math.round(supplyAmount * 0.1);
      totalSupply += supplyAmount;
      totalVat += vatAmount;

      return {
        month: dateM,
        day: dateD,
        itemDescription: formatStatementItemName(d, billing, contract),
        quantity,
        unitPrice,
        supplyAmount,
        vatAmount,
        notes: (d as any).memo || (d as any).notes || ''
      };
    });

    const spName = salesperson?.name || (contract as any)?.salespersonName || '-';
    const spPhone = (salesperson as any)?.mobile || salesperson?.phone || '-';
    const siteManagerName = (site as any)?.managerName || (site as any)?.contactPerson || (customer as any)?.managerName || (customer as any)?.contactPerson || '-';
    const siteManagerPhone = (site as any)?.managerPhone || (site as any)?.contactPhone || (customer as any)?.phone || (customer as any)?.contactPhone || '-';
    const billingManagerName = (customer as any)?.billingManagerName || (customer as any)?.managerName || (customer as any)?.contactPerson || '-';
    const billingManagerPhone = (customer as any)?.billingManagerPhone || (customer as any)?.phone || (customer as any)?.contactPhone || '-';
    const billingEmail = (customer as any)?.billingEmail || (customer as any)?.email || '-';

    const body =
`========================================================================================
                        ${currentTenant?.tradeName || currentTenant?.corporateName || 'e-Bro LIFT'}   거 래 명 세 서
========================================================================================

안녕하세요, ${getCustName(billing?.customerId || '')} 귀하.
당사 리프트 임대 계약(계약번호: ${contract?.contractNo || '-'})에 따른 ${billing?.billingYm} 거래명세서 및 청구 내역을 아래와 같이 송부해 드립니다.

[1. 공급자 정보]
- 사업자등록번호: ${currentTenant?.businessNumber || '-'} | 상호: ${currentTenant?.tradeName || currentTenant?.corporateName || '-'} | 대표자: ${currentTenant?.representativeName || '-'}
- 계약담당자(영업): ${spName} (연락처: ${spPhone})
- 계산서담당자(경영): ${currentTenant?.workplaces?.[0]?.managerName || '경영지원팀'} (연락처: ${currentTenant?.tel || '-'})
- 이메일: ${currentTenant?.taxEmail || currentTenant?.email || '-'}

[2. 공급받는 자 정보]
- 상호(법인명): ${customer?.name || '-'} | 대표자명: ${customer?.representative || '-'}
- 사업자등록번호: ${customer?.bizRegNo || '-'} | 사업장주소: ${customer?.address || '-'}
- 현장명: ${site?.name || '-'}
- 현장담당자: ${siteManagerName} (연락처: ${siteManagerPhone})
- 계산서담당자: ${billingManagerName} (연락처: ${billingManagerPhone})
- 계산서메일: ${billingEmail}

[3. 거래 세부 내역]
----------------------------------------------------------------------------------------
${items.map((item, idx) => {
  return `${idx + 1}. ${item.itemDescription}
   - 수량: ${item.quantity}대 | 단가: ${item.unitPrice.toLocaleString()}원 | 공급가액: ${item.supplyAmount.toLocaleString()}원 | 부가세: ${item.vatAmount.toLocaleString()}원 | 합계: ${(item.supplyAmount + item.vatAmount).toLocaleString()}원`;
}).join('\n----------------------------------------------------------------------------------------\n')}
----------------------------------------------------------------------------------------

[4. 청구 합계 금액]
- 공급가액: ${totalSupply.toLocaleString()}원
- 부가가치세(10%): ${totalVat.toLocaleString()}원
- 최종 청구 총액: ${(totalSupply + totalVat).toLocaleString()}원 (기수금: ${(billing?.paidAmount || 0).toLocaleString()}원 / 미수잔액: ${(totalSupply + totalVat - (billing?.paidAmount || 0)).toLocaleString()}원)

[5. 입금 계좌 안내]
- ${currentTenant?.bankAccounts?.[0] ? `${currentTenant.bankAccounts[0].bankName} ${currentTenant.bankAccounts[0].accountNumber} ${currentTenant.bankAccounts[0].accountHolder}` : '-'}

[6. 첨부 파일 안내]
- 본 이메일에는 공식 전자 거래명세서(.pdf) 파일이 자동 첨부되었습니다.

감사합니다.
${currentTenant?.tradeName || currentTenant?.corporateName || '임대인'} 올림
========================================================================================`;

    try {
      const toList = mailTo.split(',').map(e => e.trim()).filter(Boolean);
      const ccList = mailCc ? mailCc.split(',').map(e => e.trim()).filter(Boolean) : [];

      // 1. 거래명세서 정품 PDF 생성
      let attachments: { filename: string; content: string }[] = [];
      try {
        const custName = customer?.name || '고객사';
        const sName = site?.name || '현장';
        const ym = billing?.billingYm || '';
        const pdfBytes = await generateTransactionStatementPdf({
          billingDate,
          billingYm: ym,
          contractNo: contract?.contractNo,
          lessorBizNo: currentTenant?.businessNumber || '138-81-83251',
          lessorName: currentTenant?.tradeName || currentTenant?.corporateName || '(주)임대인',
          lessorCeo: currentTenant?.representativeName || '대표자',
          lessorAddress: currentTenant?.businessAddress || '',
          salespersonName: spName,
          salespersonPhone: spPhone,
          billingManagerName: currentTenant?.workplaces?.[0]?.managerName || '경영지원팀',
          billingManagerPhone: currentTenant?.tel || '031-334-5295',
          lessorEmail: currentTenant?.taxEmail || currentTenant?.email || 'tax@ebro.com',

          customerBizNo: customer?.bizRegNo || '-',
          customerName: customer?.name || '-',
          customerCeo: customer?.representative || '-',
          customerAddress: customer?.address || '-',
          customerBizType: customer?.bizType || '-',
          customerBizItem: customer?.bizItem || '-',
          siteManagerName,
          siteManagerPhone,
          custBillingManagerName: billingManagerName,
          custBillingManagerPhone: billingManagerPhone,
          custBillingEmail: billingEmail,
          siteName: site?.name || '-',
          bankAccount: currentTenant?.bankAccounts?.[0] ? `${currentTenant.bankAccounts[0].bankName} ${currentTenant.bankAccounts[0].accountNumber} , ${currentTenant.bankAccounts[0].accountHolder}` : '',

          items,
          totalSupply,
          totalVat,
          totalGrand: totalSupply + totalVat
        });

        // Uint8Array -> Base64 변환
        let binary = '';
        for (let i = 0; i < pdfBytes.byteLength; i++) {
          binary += String.fromCharCode(pdfBytes[i]);
        }
        const base64Content = window.btoa(binary);
        const contractNo = contract?.contractNo || billing?.contractId || '계약번호';
        attachments.push({
          filename: `[${currentTenant?.displayName || '거래명세서'}]_거래명세서_${ym}_${contractNo}_${custName}_${sName}.pdf`,
          content: base64Content
        });
      } catch (attachErr) {
        console.warn('[Billings] PDF 거래명세서 첨부파일 생성 실패 (본문만 발송):', attachErr);
      }

      // 2. 이메일 발송
      await emailService.sendEmail(
        toList.join(', '),
        mailSubject,
        body,
        attachments,
        ccList.join(', ')
      );

      // 3. 청구 상태 및 이력 업데이트
      if (billing && billing.status === 'UNPAID') {
        db.updateRow<Billing>('billings', billing.id, {
          status: 'REQUESTED',
          updatedAt: new Date().toISOString()
        });
      }

      if (billing?.contractId) {
        db.insertRow<ContractHistory>('contractHistory', {
          contractId: billing.contractId,
          changeType: 'TERMINATE',
          changeDate: new Date().toISOString().split('T')[0],
          description: `[거래명세서 발송] ${billing.billingYm} PDF 거래명세서 및 청구서 이메일 발송 완료 (수신: ${mailTo})`,
          createdAt: new Date().toISOString()
        });
      }

      refreshAllData();
      await db.awaitPendingWrites();

      showToast(`PDF 거래명세서 및 청구서 이메일이 발송되었습니다. (수신: ${mailTo})`);
      setShowMailModal(false);

    } catch (err: any) {
      showErrorModal(`⚠️ 이메일 발송 실패:\n\n${err?.message || err}`, '메일 발송 오류');
    } finally {
      setIsSending(false);
    }
  };

  // --- 청구 마법사 비즈니스 로직 ---
  
  const getTodayDay = () => new Date().getDate();
  const getTodayStr = () => new Date().toISOString().split('T')[0];
  const getCurrentYm = () => new Date().toISOString().substring(0, 7);

  const getSiteName = (id?: string) => {
    const s = sites.find(site => site.id === id);
    return s ? s.name : '직납(현장없음)';
  };

  const getLatestBillingPeriod = () => {
    if (!selectedContractIdForWizard) return '이전 청구 내역 없음';
    
    const contractBillings = billings
      .filter(b => b.contractId === selectedContractIdForWizard)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      
    if (contractBillings.length === 0) return '이전 청구 내역이 없습니다.';
    
    const latest = contractBillings[0];
    const details = billingDetails.filter(bd => bd.billingId === latest.id);
    const descriptions = details.map(d => d.description).filter(Boolean);
    
    const periodDesc = descriptions[0] || '상세 내용 없음';
    return `[${latest.billingYm} 청구분] ${periodDesc} (합계: ${latest.totalAmount.toLocaleString()}원)`;
  };

  const todayStr = getTodayStr();
  const currentYm = getCurrentYm();
  
  // 💡 사용자가 선택한 마감일 검색 기간 기준 대상 귀속월 (예: 전월 선택 시 2026-08)
  const targetYm = useMemo(() => {
    return (wizardSearchEndDate || wizardSearchStartDate || getTodayStr()).substring(0, 7);
  }, [wizardSearchStartDate, wizardSearchEndDate]);

  const activeContractsForWizard = useMemo(() => {
    return contracts.filter(c => {
      // 1. 계약 유형: 정기 렌탈(RENTAL) 계약만 청구 대상 (자산 매각 SALE 등 제외)
      if ((c.contractType || 'RENTAL') !== 'RENTAL') return false;

      // 2. 계약 유효 기간 검증: 검색 기간 내에 계약이 유효한 상태였는지 (기간 겹침)
      const normalEnd = normalizeEndDate(c.endDate);
      const isOverlapping = c.startDate <= (wizardSearchEndDate || todayStr) && normalEnd >= (wizardSearchStartDate || '2000-01-01');
      if (!isOverlapping) return false;

      // 3. 해당 대상 귀속월(targetYm)에 유효한 청구서가 이미 존재하는지 검사 (취소 REJECTED 제외)
      const hasBillingForTargetMonth = billings.some(
        b => b.contractId === c.id && b.billingYm === targetYm && b.status !== 'REJECTED'
      );
      if (hasBillingForTargetMonth) return false;

      // 4. 계약의 직전 청구 마감일이 이미 검색 기간 종료일 이상인지 검사 (이미 해당 기간까지 정산 마감 완료)
      if (c.lastBilledPeriodEnd && wizardSearchEndDate && c.lastBilledPeriodEnd >= wizardSearchEndDate) {
        return false;
      }

      // 5. 계약이 이미 종료되었고, 직전 청구 마감일이 계약 종료일 이상으로 전액 정산 완료된 경우 제외
      if (c.lastBilledPeriodEnd && c.lastBilledPeriodEnd >= normalEnd) {
        return false;
      }

      return true;
    });
  }, [contracts, billings, targetYm, wizardSearchStartDate, wizardSearchEndDate, todayStr]);

  const isDuePeriod = (c: any) => {
    if (!wizardSearchStartDate || !wizardSearchEndDate) return true;
    
    const startDateObj = new Date(wizardSearchStartDate);
    const endDateObj = new Date(wizardSearchEndDate);
    const startDay = startDateObj.getDate();
    const endDay = endDateObj.getDate();
    
    // 💡 31일(말일) 지정 건을 해당 월의 실제 마지막 날(30일/28일 등)로 동적 보정
    const getEffectiveDay = (targetDay: number | undefined) => {
      if (!targetDay) return undefined;
      const lastDayOfMonth = new Date(startDateObj.getFullYear(), startDateObj.getMonth() + 1, 0).getDate();
      return Math.min(targetDay, lastDayOfMonth);
    };

    const effectiveBillingDay = getEffectiveDay(c.billingDay);
    const effectiveStatementDay = getEffectiveDay(c.statementClosingDay);

    // 💡 계약 시작일(c.startDate)이 이번 달 마감일보다 뒤에 있는 경우 (예: 8/31 시작 > 8/30 마감)
    // 당월 마감 기준으로는 가동일이 0일이므로 당월 청구 대상에서 제외 (익월 청구로 이관)
    const targetClosingDay = effectiveBillingDay || effectiveStatementDay || 31;
    const yStr = startDateObj.getFullYear();
    const mStr = String(startDateObj.getMonth() + 1).padStart(2, '0');
    const dStr = String(targetClosingDay).padStart(2, '0');
    const closingDateStr = `${yStr}-${mStr}-${dStr}`;

    if (c.startDate > closingDateStr) {
      return false;
    }

    // 만약 계약 종료일이 검색 기간 내에 있다면 (예: 8/20 반납), 마감일과 상관없이 정산 대상!
    const normalEnd = normalizeEndDate(c.endDate);
    if (normalEnd >= wizardSearchStartDate && normalEnd <= wizardSearchEndDate) {
      return true;
    }

    const isDayInRange = (day: number | undefined) => {
      if (!day) return false;
      if (startDay <= endDay) {
        return day >= startDay && day <= endDay;
      } else {
        return day >= startDay || day <= endDay;
      }
    };
    
    const defaultDay = new Date(startDateObj.getFullYear(), startDateObj.getMonth() + 1, 0).getDate();
    const bDay = effectiveBillingDay !== undefined ? effectiveBillingDay : defaultDay;
    const sDay = effectiveStatementDay;
    
    const billingDayMatch = isDayInRange(bDay);
    const statementDayMatch = sDay !== undefined ? isDayInRange(sDay) : false;
    
    return billingDayMatch || statementDayMatch;
  };

  const handleWizardSearchClick = () => {
    setWizardCustomerFilter(wizardTempCustomerFilter);
    setWizardContractNoFilter(wizardTempContractNoFilter);
    setWizardSiteFilter(wizardTempSiteFilter);
  };

  const filteredWizardContracts = activeContractsForWizard.filter(c => {
    const custName = getCustName(c.customerId).toLowerCase();
    const siteName = getSiteName(c.siteId).toLowerCase();
    const contractNoStr = c.contractNo.toLowerCase();

    const matchesDue = isDuePeriod(c);
    const matchesCustomer = !wizardCustomerFilter || matchHangul(getCustName(c.customerId), wizardCustomerFilter);
    const matchesContractNo = !wizardContractNoFilter || contractNoStr.includes(wizardContractNoFilter.trim().toLowerCase());
    const matchesSite = !wizardSiteFilter || matchHangul(getSiteName(c.siteId), wizardSiteFilter);

    return matchesDue && matchesCustomer && matchesContractNo && matchesSite;
  });

  // 특정 계약에 연동 가능한 미청구 외상미수금 목록 조회
  const getUnbilledReceivablesForContract = (c: any) => {
    if (!c) return [];
    return receivables.filter(r => 
      r.status !== 'CLEARED' &&
      ((r.totalAmount || 0) - (r.billedAmount || 0)) > 0 &&
      r.customerId === c.customerId &&
      (r.contractId === c.id || !r.contractId)
    );
  };

  // 일괄 생성 가능 계약(외상미수금 없는 일반 계약) vs 수동 검토 계약(외상미수금 보유 계약) 분리
  const contractsWithoutReceivables = filteredWizardContracts.filter(c => getUnbilledReceivablesForContract(c).length === 0);
  const contractsWithReceivables = filteredWizardContracts.filter(c => getUnbilledReceivablesForContract(c).length > 0);

  const handleBulkGenerateWizard = async () => {
    if (filteredWizardContracts.length === 0) {
      showToast('정산 대상 계약이 없습니다.', 'error');
      return;
    }

    if (contractsWithoutReceivables.length === 0) {
      showErrorModal(
        `현재 조회된 정산 대상 계약(${contractsWithReceivables.length}건)은 모두 미청구 외상미수금(수리비/운송비 등)이 존재합니다.\n\n` +
        `외상미수금 포함 여부를 검토/반영하기 위해 개별 카드를 클릭하여 수동으로 청구를 생성해 주세요.`,
        '일괄 청구 불가'
      );
      return;
    }

    const targetBillingDate = wizardSearchEndDate <= todayStr ? wizardSearchEndDate : todayStr;
    const hasExcluded = contractsWithReceivables.length > 0;
    const confirmMessage = hasExcluded
      ? `현재 조회된 정산 대상 계약 총 ${filteredWizardContracts.length}건 중,\n\n` +
        `✅ 일괄 생성 대상: ${contractsWithoutReceivables.length}건 (외상미수금 없음)\n` +
        `⚠️ 일괄 생성 제외: ${contractsWithReceivables.length}건 (외상미수금 존재 → 수동 검토 필요)\n\n` +
        `외상미수금이 없는 ${contractsWithoutReceivables.length}건에 대해 청구서를 일괄 생성하시겠습니까?\n` +
        `(제외된 ${contractsWithReceivables.length}건은 담당자가 직접 카드를 클릭하여 외상미수금을 선택 후 생성하실 수 있습니다.)`
      : `현재 조회된 정산 대상 계약 총 ${contractsWithoutReceivables.length}건에 대해 청구서를 일괄 생성하시겠습니까?\n\n` +
        `- 청구일자: ${targetBillingDate}\n` +
        `- 청구귀속월: ${targetYm}\n\n` +
        `생성된 청구서는 [청구 및 수납내역] 탭에서 확인 및 출력하실 수 있습니다.`;

    if (!window.confirm(confirmMessage)) return;

    setIsBulkGenerating(true);
    let successCount = 0;
    let failCount = 0;
    const errorDetails: string[] = [];

    try {
      for (const c of contractsWithoutReceivables) {
        try {
          await generateBillingForSingleContract(c.id, targetYm, targetBillingDate);
          successCount++;
        } catch (err: any) {
          failCount++;
          errorDetails.push(`${c.contractNo} (${getCustName(c.customerId)}): ${err?.message || err}`);
        }
      }

      refreshAllData();
      await db.awaitPendingWrites();

      let resultMsg = `✅ 외상미수금이 없는 ${successCount}건의 계약에 대해 청구서가 성공적으로 일괄 생성되었습니다!`;
      if (hasExcluded) {
        resultMsg += `\n\n⚠️ 외상미수금이 있는 ${contractsWithReceivables.length}건은 수동 검토를 위해 남아있습니다. 개별 카드를 확인해 주세요.`;
      }

      if (failCount === 0) {
        showToast(resultMsg);
        if (contractsWithReceivables.length === 0) {
          setActiveTab('LIST');
        }
      } else {
        showErrorModal(
          `일괄 생성 결과:\n- 성공: ${successCount}건\n- 실패: ${failCount}건\n\n[실패 내역]\n${errorDetails.join('\n')}`,
          '일괄 청구 생성 알림'
        );
      }
    } catch (err: any) {
      showErrorModal('일괄 청구 생성 중 오류가 발생했습니다: ' + (err?.message || String(err)));
    } finally {
      setIsBulkGenerating(false);
    }
  };

  const handleSelectContractForWizard = (c: any) => {
    setSelectedContractIdForWizard(c.id);
    setExtraCharges([]);
    setSelectedRepairIdsForWizard([]);
    setSelectedDeliveryIdsForWizard([]);
    setWizardBillingYm(targetYm);
    const targetBillingDate = wizardSearchEndDate <= todayStr ? wizardSearchEndDate : todayStr;
    setWizardBillingDate(targetBillingDate);
    
    const [targetY, targetM] = targetYm.split('-').map(Number);
    const firstOfM = new Date(targetY, targetM - 1, 1);
    const lastOfM = new Date(targetY, targetM, 0);
    
    const startStr = firstOfM.toISOString().split('T')[0];
    const endStr = lastOfM.toISOString().split('T')[0];
    
    // 💡 직전 청구 종료일이 있으면 익일부터 시작, 없으면 계약시작일 또는 당월 1일 적용
    let calcStart = startStr;
    if (c.lastBilledPeriodEnd) {
      const prevEndObj = new Date(c.lastBilledPeriodEnd);
      prevEndObj.setDate(prevEndObj.getDate() + 1);
      calcStart = prevEndObj.toISOString().split('T')[0];
    } else if (c.startDate > startStr) {
      calcStart = c.startDate;
    }

    const normalEnd = normalizeEndDate(c.endDate);
    let calcEnd = normalEnd < endStr ? normalEnd : endStr;

    // 만약 calcStart가 calcEnd보다 미래인 경우 (예: 시작일 8/31 > 8/30 마감)
    // 비정상적인 0일 정산 기간이 되지 않도록 calcEnd를 계약 종료일 또는 월말일로 자동 보정
    if (calcStart > calcEnd) {
      calcEnd = normalEnd < endStr ? normalEnd : endStr;
      if (calcStart > calcEnd) {
        calcEnd = calcStart;
      }
    }
    
    setWizardStartDate(calcStart);
    setWizardEndDate(calcEnd);
    
    if (calcStart > startStr || normalEnd < endStr) {
      setCalcMethod('PRORATED');
    } else {
      setCalcMethod('MONTHLY');
    }
  };

  const selectedContractForWizard = contracts.find(c => c.id === selectedContractIdForWizard);
  const wizardContractAssets = contractAssets.filter(ca => ca.contractId === selectedContractIdForWizard);
  
  const getDiffDays = () => {
    if (!wizardStartDate || !wizardEndDate) return 0;
    const d1 = new Date(wizardStartDate);
    const d2 = new Date(wizardEndDate);
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    return isNaN(diffTime) ? 0 : Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };

  const diffDaysForWizard = getDiffDays();

  // 💡 헌장 4.1 준수: 계약 내 개별 자산의 대차/회수/투입 기간을 반영한 정밀 일할/월정액 계산
  const calculateAssetFeeForWizard = (ca: any) => {
    if (!wizardStartDate || !wizardEndDate) return { amount: 0, days: 0, desc: '', active: false, isExchangeProRata: false };

    // 계약 내 자산의 개별 유효 기간
    const caStart = ca.startDate || wizardStartDate;
    const caEnd = ca.endDate && ca.endDate !== '미정' ? ca.endDate : wizardEndDate;

    // 청구 대상 기간과 자산 유효 기간의 교집합(실제 가동 기간) 계산
    const effectiveStart = caStart > wizardStartDate ? caStart : wizardStartDate;
    const effectiveEnd = caEnd < wizardEndDate ? caEnd : wizardEndDate;

    // 만약 청구 기간 외인 경우 (예: 이미 이전 달에 종료된 자산이 이번 청구에 걸린 경우 등)
    if (effectiveStart > effectiveEnd) {
      return { amount: 0, days: 0, desc: '청구 기간 외 (가동 없음)', active: false, isExchangeProRata: false };
    }

    const d1 = new Date(effectiveStart);
    const d2 = new Date(effectiveEnd);
    const diff = Math.abs(d2.getTime() - d1.getTime());
    const days = isNaN(diff) ? 0 : Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;

    // 청구 기간 전체와 100% 일치하고 월정액 방식인 경우
    const isFullPeriod = (effectiveStart === wizardStartDate && effectiveEnd === wizardEndDate);
    if (calcMethod === 'MONTHLY' && isFullPeriod) {
      return {
        amount: ca.monthlyRentalFee,
        days,
        desc: `${wizardStartDate.substring(0, 7)} 정기 월렌탈료 (월단가 기준)`,
        active: true,
        isExchangeProRata: false
      };
    } else {
      // 대차 교체로 중도 회수/투입되었거나 일할 정산인 경우
      const daily = ca.dailyRentalFee > 0 ? ca.dailyRentalFee : Math.round(ca.monthlyRentalFee / 30);
      const amount = daily * days;
      return {
        amount,
        days,
        desc: `${effectiveStart} ~ ${effectiveEnd} 일할 청구 (${days}일)`,
        active: true,
        isExchangeProRata: !isFullPeriod
      };
    }
  };

  const totalAmountForWizard = wizardContractAssets.reduce((sum, ca) => {
    const feeInfo = calculateAssetFeeForWizard(ca);
    return sum + feeInfo.amount;
  }, 0);

  const [isWizardGenerating, setIsWizardGenerating] = useState(false);

  const handleGenerateWizardBilling = async () => {
    if (isWizardGenerating) return;
    if (!selectedContractForWizard || !wizardStartDate || !wizardEndDate) return;

    // 순수 추가 청구 항목 (외상미수금 연동분 제외)
    const pureExtraCharges = extraCharges.filter(ec => !ec.id.startsWith('EXTRA-RCV-'));
    const pureExtraChargesTotal = pureExtraCharges.reduce((sum, ec) => sum + (ec.quantity * ec.unitPrice), 0);

    // 연동된 외상미수금 총액 계산
    const receivablesTotal = selectedReceivablesForWizard.reduce((sum, r) => {
      const ec = extraCharges.find(c => c.id === `EXTRA-RCV-${r.receivableId}`);
      return sum + (ec ? (ec.unitPrice * ec.quantity) : r.amount);
    }, 0);

    const overallTotal = totalAmountForWizard + pureExtraChargesTotal + receivablesTotal;

    if (overallTotal <= 0) {
      showToast('청구 금액이 0원 이하이므로 발행할 수 없습니다.', 'error');
      return;
    }

    setIsWizardGenerating(true);

    // 중복 청구 경고
    const existing = billings.find(b => 
      b.contractId === selectedContractForWizard.id && 
      b.billingYm === wizardBillingYm && 
      b.status !== 'REJECTED'
    );
    if (existing) {
      if (!window.confirm(`선택한 계약(${selectedContractForWizard.contractNo})의 ${wizardBillingYm}월 청구서가 이미 존재합니다(미반려 상태).\n\n그래도 중복으로 청구서를 생성하시겠습니까?`)) {
        setIsWizardGenerating(false);
        return;
      }
    }

    const detailsList: any[] = [];
    
    // 1. 기본 장비 렌탈료 정산 (자산별 가동 기간 및 대차 교체 일할 계산 정밀 적용)
    wizardContractAssets.forEach(ca => {
      const feeInfo = calculateAssetFeeForWizard(ca);
      if (!feeInfo.active || feeInfo.amount <= 0) return; // 청구 대상 외 자산 제외

      const assetInfo = assets.find(a => a.id === ca.assetId);
      const assetName = assetInfo ? `${assetInfo.modelName} (관리번호: ${assetInfo.assetNo})` : '렌탈 장비';

      detailsList.push({
        contractAssetId: ca.id,
        itemName: `${assetName} 렌탈료`,
        quantity: 1,
        unitPrice: feeInfo.amount,
        amount: feeInfo.amount,
        description: feeInfo.desc
      });

      if (assetInfo) {
        db.updateRow<Asset>('assets', assetInfo.id, {
          cumRentalFee: (assetInfo.cumRentalFee || 0) + feeInfo.amount,
          updatedAt: new Date().toISOString()
        });
      }
    });

    // 2. 순수 추가 청구 항목 정산 (수기 추가분 - 외상미수금은 linkReceivableToBilling이 전담)
    pureExtraCharges.forEach(ec => {
      let itemName = '';
      if (ec.category === 'TRANSPORT_ONEWAY') itemName = '운송료 (편도)';
      else if (ec.category === 'TRANSPORT_ROUNDTRIP') itemName = '운송료 (왕복)';
      else if (ec.category === 'REPAIR') itemName = '수리비';
      else itemName = ec.customName || '기타 추가청구';

      const amount = ec.quantity * ec.unitPrice;

      detailsList.push({
        contractAssetId: undefined,
        itemName: itemName,
        quantity: ec.quantity,
        unitPrice: ec.unitPrice,
        amount: amount,
        description: '추가 청구 항목 (수기 지정)'
      });
    });

    // 선수금(예치금) 차감 연동
    const customerInfo = customers.find(c => c.id === selectedContractForWizard.customerId);
    const baseTotalBeforeReceivables = totalAmountForWizard + pureExtraChargesTotal;
    let initialBillingAmount = baseTotalBeforeReceivables;
    
    if (customerInfo && (customerInfo.prepaidBalance || 0) > 0) {
      const prepaid = customerInfo.prepaidBalance || 0;
      const appliedPrepaid = Math.min(baseTotalBeforeReceivables, prepaid);
      
      if (appliedPrepaid > 0) {
        detailsList.push({
          contractAssetId: undefined,
          itemName: '선수금(예치금) 차감 반영',
          quantity: 1,
          unitPrice: -appliedPrepaid,
          amount: -appliedPrepaid,
          description: `보유 선수금 중 ${appliedPrepaid.toLocaleString()}원 차감 반영`
        });
        
        db.updateRow<any>('customers', customerInfo.id, {
          prepaidBalance: prepaid - appliedPrepaid,
          updatedAt: new Date().toISOString()
        });
        
        initialBillingAmount = baseTotalBeforeReceivables - appliedPrepaid;
      }
    }

    try {
      const targetYm = wizardBillingYm.trim() || currentYm;
      const targetDate = wizardBillingDate.trim() || todayStr;

      // 1) 기본 청구서 생성 (초기 금액: 렌탈료 + 순수 추가청구 - 선수금)
      const billing = db.insertRow<Billing>('billings', {
        customerId: selectedContractForWizard.customerId,
        contractId: selectedContractForWizard.id,
        billingYm: targetYm,
        billingDate: targetDate,
        totalAmount: initialBillingAmount,
        paidAmount: 0,
        status: 'REQUESTED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // 2) 기본 세부내역 저장
      detailsList.forEach(det => {
        db.insertRow<BillingDetail>('billingDetails', {
          ...det,
          billingId: billing.id,
          createdAt: new Date().toISOString()
        });
      });

      // 3) 연동된 수리비가 있다면 billingId 바인딩
      for (const rId of selectedRepairIdsForWizard) {
        await linkRepairToBilling(rId, billing.id);
      }

      // 3-1) 연동된 운송료가 있다면 billingId 바인딩
      for (const dId of selectedDeliveryIdsForWizard) {
        await linkDeliveryToBilling(dId, billing.id);
      }

      // 4) 외상미수금 정식 바인딩 (linkReceivableToBilling이 billingDetails 생성 및 totalAmount 누적을 단일 전담)
      for (const r of selectedReceivablesForWizard) {
        const ec = extraCharges.find(c => c.id === `EXTRA-RCV-${r.receivableId}`);
        const finalAmount = ec ? (ec.unitPrice * ec.quantity) : r.amount;
        await linkReceivableToBilling(billing.id, r.receivableId, finalAmount, r.displayName);
      }

      // 💡 헌장 5.2 준수: 원격 DB 저장을 동기로 대기하여 데이터 누락 및 무음 실패 100% 방지
      await db.awaitPendingWrites();

      // 계약이력 기록
      db.insertRow<ContractHistory>('contractHistory', {
        contractId: selectedContractForWizard.id,
        changeType: 'BILLING_CREATED',
        changeDate: targetDate,
        description: `청구 생성: ${targetYm} / ${overallTotal.toLocaleString()}원 (청구번호: ${billing.id})`,
        createdAt: new Date().toISOString()
      });
      await db.awaitPendingWrites();

      refreshAllData();
      setSelectedContractIdForWizard(null);
      setExtraCharges([]);
      setSelectedRepairIdsForWizard([]);
      setSelectedDeliveryIdsForWizard([]);
      setSelectedReceivablesForWizard([]);
      showToast(`[${getCustName(selectedContractForWizard.customerId)}] 청구귀속월(${targetYm}) 총 ${overallTotal.toLocaleString()}원 청구 생성이 저장되었습니다.`);
    } catch (err: any) {
      showErrorModal(`⚠️ 청구서 DB 저장 실패:\n\n${err?.message || err}`, '청구 생성 오류');
    } finally {
      setIsWizardGenerating(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: '18px', fontWeight: '700' }}>매출 청구 관리</h2>

      {/* 탭 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {canSave && (
          <button className={activeTab === 'WIZARD' ? 'btn-primary' : 'btn-secondary'} onClick={() => setActiveTab('WIZARD')}>
            <Calendar size={14} /> 미청구 정산
          </button>
        )}
        <button className={activeTab === 'LIST' ? 'btn-primary' : 'btn-secondary'} onClick={() => setActiveTab('LIST')}>
          청구 대장
        </button>
        <button
          className={activeTab === 'INVOICE' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('INVOICE')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Layers size={14} /> 청구서통합
        </button>
        <button
          className={activeTab === 'WAIVER' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('WAIVER')}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <AlertTriangle size={14} /> 청구 면제 대장
        </button>
      </div>

      {/* 청구서통합 탭 */}
      {activeTab === 'INVOICE' && <BillingInvoiceTab />}

      {activeTab === 'LIST' && (() => {
        const dueContracts = getDueContractsForBilling();

        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* ⚠️ K-1: 일괄 청구 보류(SKIP) 대시보드 (1행 1건 컴팩트 테이블 형태) */}
          {skippedContracts.length > 0 && (
            <div style={{
              padding: '14px 18px',
              borderRadius: '8px',
              backgroundColor: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>⚠️</span>
                <strong style={{ color: '#d97706', fontSize: '14px' }}>
                  일괄 청구 보류 (Action Required) - {skippedContracts.length}건
                </strong>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  미수금 존재 등 수동 확인이 필요하여 일괄 생성에서 제외된 계약입니다.
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary ms-auto"
                  style={{ fontSize: '11px', padding: '2px 8px' }}
                  onClick={() => setSkippedContracts([])}
                >
                  닫기
                </button>
              </div>
              <table className="table table-sm table-bordered mb-0 align-middle" style={{ backgroundColor: 'var(--bg-card)', fontSize: '12.5px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '20%' }}>고객사</th>
                    <th style={{ width: '25%' }}>계약명(현장)</th>
                    <th style={{ width: '40%' }}>보류 사유</th>
                    <th style={{ width: '15%', textAlign: 'center' }}>조치</th>
                  </tr>
                </thead>
                <tbody>
                  {skippedContracts.map((skip, idx) => {
                    const c = contracts.find(ct => ct.id === skip.contractId);
                    if (!c) return null;
                    return (
                      <tr key={idx}>
                        <td className="fw-bold text-primary">{getCustName(skip.customerId)}</td>
                        <td>{c.contractNo}</td>
                        <td className="text-danger fw-bold">{skip.reason}</td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm py-0"
                            style={{ fontSize: '11px', height: '24px' }}
                            onClick={() => {
                              setSelectedContractIdForWizard(skip.contractId);
                              setActiveTab('WIZARD');
                            }}
                          >
                            수동 병합 발행 ➔
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}



          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', alignItems: 'flex-start' }}>
          
          {/* 청구 목록 (좌측 독립 스크롤) */}
          <div className="card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="card-title" style={{ margin: 0 }}>청구 목록</h3>
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={handleExportExcel}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '5px 10px' }}
              >
                <Download size={12} /> 엑셀 다운로드
              </button>
            </div>

            {/* 필터 바 (1줄 고밀도 컴팩트 수평 정렬) */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', backgroundColor: 'var(--bg-app)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: '120px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>고객사 검색</label>
                <input 
                  type="text" 
                  value={tempSearchTerm} 
                  onChange={e => setTempSearchTerm(e.target.value)} 
                  onKeyDown={e => { if (e.key === 'Enter') handleSearchClick(); }}
                  placeholder="고객사명 / 초성 (예: ㅅㅅ, ㅎㄷ)..."
                  style={{ width: '100%', padding: '5px 8px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: '100px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>계약번호</label>
                <input 
                  type="text" 
                  value={tempContractNoFilter} 
                  onChange={e => setTempContractNoFilter(e.target.value)} 
                  onKeyDown={e => { if (e.key === 'Enter') handleSearchClick(); }}
                  placeholder="계약번호..."
                  style={{ width: '100%', padding: '5px 8px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                />
              </div>

              {/* 📅 청구 귀속월 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>청구 귀속월</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <input 
                    type="month"
                    value={tempStartBillingYmFilter} 
                    onChange={e => setTempStartBillingYmFilter(e.target.value)} 
                    style={{ width: '110px', padding: '5px 6px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>~</span>
                  <input 
                    type="month"
                    value={tempEndBillingYmFilter} 
                    onChange={e => setTempEndBillingYmFilter(e.target.value)} 
                    style={{ width: '110px', padding: '5px 6px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                  />
                </div>
              </div>

              {/* ◀ 당월 ▶ 이동 */}
              <div style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0, paddingBottom: '1px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handlePrevMonth}
                  style={{ padding: '4px 7px', height: '28px', fontSize: '11px', fontWeight: 'bold' }}
                  title="전월"
                >
                  &lt;
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCurrentMonth}
                  style={{ padding: '4px 8px', height: '28px', fontSize: '11px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                  title="당월"
                >
                  당월
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleNextMonth}
                  style={{ padding: '4px 7px', height: '28px', fontSize: '11px', fontWeight: 'bold' }}
                  title="익월"
                >
                  &gt;
                </button>
              </div>

              {/* 💰 수납 상태 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>수납 상태</label>
                <select 
                  value={tempPaymentFilter} 
                  onChange={e => setTempPaymentFilter(e.target.value as any)} 
                  style={{ width: '90px', padding: '5px 6px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                >
                  <option value="ALL">전체</option>
                  <option value="PAID">수납완료</option>
                  <option value="UNPAID_ANY">미완료</option>
                </select>
              </div>

              {/* ✉️ 메일 발송 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>메일 발송</label>
                <select 
                  value={tempMailSentFilter} 
                  onChange={e => setTempMailSentFilter(e.target.value as any)} 
                  style={{ width: '85px', padding: '5px 6px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                >
                  <option value="ALL">전체</option>
                  <option value="SENT">발송</option>
                  <option value="UNSENT">미발송</option>
                </select>
              </div>

              {/* 📑 통합 여부 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>통합 구분</label>
                <select 
                  value={tempInvoiceFilter} 
                  onChange={e => setTempInvoiceFilter(e.target.value as any)} 
                  style={{ width: '90px', padding: '5px 6px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                >
                  <option value="ALL">전체</option>
                  <option value="STANDALONE">단독 청구</option>
                  <option value="INTEGRATED">통합 포함</option>
                </select>
              </div>

              {/* 버튼 그룹 */}
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0, paddingBottom: '1px' }}>
                <button 
                  type="button" 
                  className="btn-primary" 
                  onClick={handleSearchClick}
                  style={{ padding: '5px 12px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '12px', whiteSpace: 'nowrap' }}
                >
                  조회
                </button>
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={handleResetFilters}
                  style={{ padding: '5px 8px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '12px', whiteSpace: 'nowrap' }}
                >
                  초기화
                </button>
              </div>
            </div>

            {/* 📊 청구 및 수납 실시간 종합 집계 (1줄 고밀도 압축 스트립) */}
            {(() => {
              const totalSupply = filteredBillings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
              const totalVat = Math.round(totalSupply * 0.1);
              const totalGrand = totalSupply + totalVat;
              const totalPaid = filteredBillings.reduce((sum, b) => {
                const g = (b.totalAmount || 0) + Math.round((b.totalAmount || 0) * 0.1);
                return sum + (b.status === 'PAID' ? g : (b.paidAmount || 0));
              }, 0);
              const totalUnpaid = Math.max(0, totalGrand - totalPaid);

              // 💰 미수납 통장잔액 (검색된 고객사 기준, 전체 검색 시 전사 미사용 입금 잔액 총합)
              const searchedCustName = searchTerm.trim().toLowerCase();
              const relevantDeposits = bankTransactions.filter(t => {
                if (!t.isDeposit) return false;
                if (!searchedCustName) return true;
                const mappedCustName = customers.find(c => c.id === t.customerId)?.name || '';
                return t.senderName.toLowerCase().includes(searchedCustName) || mappedCustName.toLowerCase().includes(searchedCustName);
              });
              const totalUnappliedDeposit = relevantDeposits.reduce((sum, t) => sum + getDepositBalance(t.id), 0);

              return (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '8px 14px',
                  backgroundColor: 'var(--bg-app)',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  flexWrap: 'wrap',
                  fontSize: '12.5px',
                  whiteSpace: 'nowrap'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>조회:</span>
                    <strong style={{ color: 'var(--primary)', fontSize: '13.5px' }}>{filteredBillings.length}건</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>공급가액:</span>
                    <strong>₩{totalSupply.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>총 청구(VAT포함):</span>
                    <strong style={{ color: '#0070C0', fontSize: '13.5px' }}>₩{totalGrand.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>수납완료:</span>
                    <strong style={{ color: 'var(--success)' }}>₩{totalPaid.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>미수채권:</span>
                    <strong style={{ color: totalUnpaid > 0 ? '#dc2626' : 'var(--text-muted)' }}>₩{totalUnpaid.toLocaleString()}</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>통장잔액:</span>
                    <strong style={{ color: totalUnappliedDeposit > 0 ? '#10B981' : 'var(--text-muted)' }}>₩{totalUnappliedDeposit.toLocaleString()}</strong>
                  </div>
                </div>
              );
            })()}

            <div className="table-container" style={{ border: 'none', boxShadow: 'none', overflowX: 'auto' }}>
              <table style={{ minWidth: '650px', whiteSpace: 'nowrap' }}>
                <thead>
                  <tr>
                    <th style={{ whiteSpace: 'nowrap', width: '190px' }}>관리</th>
                    <th style={{ whiteSpace: 'nowrap' }}>청구월</th>
                    <th style={{ whiteSpace: 'nowrap' }}>고객사</th>
                    <th style={{ whiteSpace: 'nowrap', textAlign: 'right', paddingRight: '12px' }}>공급가액</th>
                    <th style={{ whiteSpace: 'nowrap', textAlign: 'right', paddingRight: '12px' }}>청구합계(VAT포함)</th>
                    <th style={{ whiteSpace: 'nowrap', textAlign: 'right', paddingRight: '12px' }}>미납액</th>
                    <th style={{ whiteSpace: 'nowrap' }}>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBillings.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                        조회 결과가 없습니다.
                      </td>
                    </tr>
                  ) : filteredBillings.map(b => {
                    const supply = b.totalAmount || 0;
                    const vat = Math.round(supply * 0.1);
                    const grandTotal = supply + vat;
                    const isPaid = b.status === 'PAID';
                    const actualPaid = isPaid ? grandTotal : (b.paidAmount || 0);
                    const unpaid = isPaid ? 0 : Math.max(0, grandTotal - actualPaid);
                    const isSelected = selectedBillingId === b.id;

                    return (
                      <tr 
                        key={b.id} 
                        style={{ 
                          cursor: 'pointer',
                          backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.08)' : undefined,
                          fontWeight: isSelected ? 600 : undefined
                        }} 
                        onClick={() => setSelectedBillingId(b.id)}
                      >
                        <td onClick={e => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            {/* 1. 수납 버튼: 미납 잔액이 있는 상태 (UNPAID, REQUESTED, PARTIAL) */}
                            {canSave && !isPaid && unpaid > 0 && b.status !== 'REJECTED' && (
                              <button 
                                type="button"
                                className="btn-success" 
                                onClick={() => handleOpenPay(b.id, unpaid)} 
                                style={{ padding: '3px 6px', fontSize: '11px', whiteSpace: 'nowrap', fontWeight: 'bold' }}
                                title="수납 등록"
                              >
                                수납
                              </button>
                            )}

                            {/* 2. 발송 버튼: REJECTED가 아닌 모든 청구서에서 거래명세서 메일 발송 */}
                            {b.status !== 'REJECTED' && (
                              <button 
                                type="button" 
                                className="btn-secondary" 
                                onClick={() => handleOpenMail(b.id)} 
                                style={{ padding: '3px 6px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '2px', whiteSpace: 'nowrap' }}
                                title={b.invoiceId ? `통합 청구서(${b.invoiceId})에 포함됨 - 개별 명세서 발송` : "거래명세서 이메일 발송"}
                              >
                                <Mail size={10} /> {b.invoiceId ? '개별발송' : '발송'}
                              </button>
                            )}

                            {/* 3. 취소/재생성 버튼: 완납(PAID)이 아닌 상태에서 수정/재생성 */}
                            {canSave && b.status !== 'PAID' && (
                              <button 
                                type="button" 
                                className="btn-secondary" 
                                onClick={(e) => handleOpenRegenerate(b.id, e)} 
                                style={{ padding: '3px 6px', fontSize: '11px', color: 'var(--primary)', fontWeight: '600', whiteSpace: 'nowrap' }}
                                title="내역 수정 및 재생성"
                              >
                                {b.status === 'REJECTED' ? '재생성' : '취소/재생성'}
                              </button>
                            )}

                            {/* 4. 청구 취소 버튼: 완납(PAID) 또는 이미 취소(REJECTED)가 아닌 상태 */}
                            {isAdmin && b.status !== 'PAID' && b.status !== 'REJECTED' && (
                              <button 
                                type="button" 
                                className="btn-danger" 
                                onClick={(e) => handleCancel(b.id, e)} 
                                style={{ padding: '3px 6px', fontSize: '11px', whiteSpace: 'nowrap' }}
                                title="청구 취소"
                              >
                                취소
                              </button>
                            )}
                          </div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}><strong>{b.billingYm}</strong></td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span>{getCustName(b.customerId)}</span>
                          {customers.find(c => c.id === b.customerId)?.transactionStatus === 'BLOCKED' && (
                            <span style={{ marginLeft: '6px', padding: '1px 5px', fontSize: '10px', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '3px', fontWeight: 800 }}>
                              출고제한
                            </span>
                          )}
                          {b.invoiceId && (
                            <span
                              style={{
                                marginLeft: '6px',
                                padding: '1px 6px',
                                fontSize: '10px',
                                backgroundColor: '#e0e7ff',
                                color: '#3730a3',
                                border: '1px solid #c7d2fe',
                                borderRadius: '3px',
                                fontWeight: 700,
                                whiteSpace: 'nowrap'
                              }}
                              title={`통합 인보이스: ${b.invoiceId}`}
                            >
                              통합: {b.invoiceId}
                            </span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right', paddingRight: '12px' }}>₩{supply.toLocaleString()}</td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right', paddingRight: '12px', fontWeight: 700, color: 'var(--primary)' }}>₩{grandTotal.toLocaleString()}</td>
                        <td style={{ whiteSpace: 'nowrap', textAlign: 'right', paddingRight: '12px', color: unpaid > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                          ₩{unpaid.toLocaleString()}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span className={`badge ${
                              b.status === 'UNPAID'    ? 'badge-secondary' :
                              b.status === 'REQUESTED' ? 'badge-warning' :
                              b.status === 'REJECTED'  ? 'badge-danger' :
                              b.status === 'PAID'      ? 'badge-success' :
                              b.status === 'PARTIAL'   ? 'badge-info' : 'badge-secondary'
                            }`}>
                              {b.status === 'UNPAID'    ? '미발송' :
                               b.status === 'REQUESTED' ? '발송완료' :
                               b.status === 'REJECTED'  ? '이의제기' :
                               b.status === 'PAID'      ? '완납' :
                               b.status === 'PARTIAL'   ? '일부납' : b.status}
                            </span>

                            {/* 🌟 완납/일부납 배지 오른쪽 바로 옆 수납취소 버튼 */}
                            {canSave && (b.paidAmount > 0 || isPaid) && b.status !== 'REJECTED' && (
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelAllPayments(b.id, isPaid ? grandTotal : (b.paidAmount || 0));
                                }}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: '10.5px',
                                  fontWeight: '600',
                                  backgroundColor: '#fee2e2',
                                  color: '#b91c1c',
                                  border: '1px solid #fca5a5',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                                title="수납 취소 및 롤백 (통장 잔액/미수금 복원)"
                              >
                                수납취소
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
          </div>

          {/* 청구 상세 정보 (우측 독립 스크롤 & 고정) */}
          <div style={{ position: 'sticky', top: '16px', maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
            {activeBilling ? (() => {
              const contractObj = contracts.find(c => c.id === activeBilling.contractId);
              const siteObj = sites.find(s => s.id === contractObj?.siteId);
              const custObj = customers.find(cu => cu.id === activeBilling.customerId);

              const totalSupply = activeBillingDetails.reduce((sum, bd) => sum + (bd.amount || 0), 0);
              const totalVat = Math.round(totalSupply * 0.1);
              const totalGrand = totalSupply + totalVat;
              const isPaid = activeBilling.status === 'PAID';
              const paidAmt = isPaid ? totalGrand : (activeBilling.paidAmount || 0);
              const unpaidAmt = isPaid ? 0 : Math.max(0, totalGrand - paidAmt);

              return (
                <div className="card" style={{ margin: 0, padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* 상단 헤더: 타이틀, 발행일자, 버튼 */}
                  <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h3 className="card-title" style={{ margin: 0, fontSize: '16px' }}>청구 명세서 ({activeBilling.billingYm})</h3>
                      {canSave && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => handleEditBillingYm(activeBilling.id, activeBilling.billingYm)}
                          style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                          title="청구귀속월 변경"
                        >
                          <Edit3 size={11} /> 청구월 수정
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>발행일자: {activeBilling.billingDate}</span>
                      {canSave && activeBilling.status !== 'REJECTED' && (
                        <button 
                          type="button" 
                          className="btn-danger"
                          onClick={(e) => handleCancel(activeBilling.id, e)}
                          style={{ padding: '5px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'bold' }}
                          title="이 청구서를 취소하고 계약의 최근 청구 정보를 직전 유효 상태로 롤백합니다."
                        >
                          <RotateCcw size={13} /> 청구 취소
                        </button>
                      )}
                      <button 
                        type="button" 
                        className="btn-secondary"
                        onClick={() => downloadStatementExcel(activeBilling.id)}
                        style={{ padding: '5px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'bold' }}
                        title="00.거래명세서양식.xlsx 정품 엑셀 원본 파일 다운로드"
                      >
                        <FileText size={13} /> 엑셀 다운로드
                      </button>
                      <button 
                        type="button" 
                        className="btn-secondary"
                        onClick={() => downloadStatementPdf(activeBilling.id)}
                        style={{ padding: '5px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'bold' }}
                        title="로컬 에이전트 MS Excel COM 엔진 기반 정품 A4 PDF 다운로드"
                      >
                        <Download size={13} /> PDF 다운로드
                      </button>
                      <button 
                        type="button" 
                        className="btn-primary"
                        onClick={() => handleOpenMail(activeBilling.id)}
                        style={{ padding: '5px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'bold' }}
                      >
                        <Mail size={13} /> 거래명세서 메일 발송
                      </button>
                    </div>
                  </div>

                  {/* 반려/취소 사유 알림 */}
                  {activeBilling.status === 'REJECTED' && (
                    <div style={{ padding: '10px 12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid var(--danger)', borderRadius: '4px' }}>
                      <strong style={{ color: 'var(--danger)', fontSize: '13px', display: 'block', marginBottom: '2px' }}>[취소/이의제기 사유]</strong>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{activeBilling.rejectReason || '사유 미기재'}</span>
                    </div>
                  )}

                  {/* 통합 인보이스 연결 알림 배너 */}
                  {activeBilling.invoiceId && (
                    <div style={{
                      padding: '8px 12px',
                      backgroundColor: 'rgba(99, 102, 241, 0.08)',
                      border: '1px solid rgba(99, 102, 241, 0.25)',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '12px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Layers size={14} style={{ color: '#4f46e5' }} />
                        <span>통합 인보이스: <strong style={{ color: '#4f46e5' }}>{activeBilling.invoiceId}</strong> (묶음 청구됨)</span>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setActiveTab('INVOICE')}
                        style={{ padding: '2px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}
                      >
                        청구서통합 탭 이동 ➔
                      </button>
                    </div>
                  )}

                  {/* 기본 계약/고객 정보 프로필 */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', padding: '10px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', fontSize: '12px' }}>
                    <div>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block' }}>고객사명</span>
                      <strong style={{ fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {custObj?.name || getCustName(activeBilling.customerId)}
                        {custObj?.transactionStatus === 'BLOCKED' && (
                          <span style={{ padding: '1px 5px', fontSize: '10px', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '3px', fontWeight: 800 }}>
                            출고제한
                          </span>
                        )}
                      </strong>
                    </div>
                    <div>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block' }}>현장명</span>
                      <strong style={{ fontSize: '12.5px' }}>{siteObj?.name || '-'}</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block' }}>계약번호</span>
                      <strong style={{ fontSize: '12.5px' }}>{contractObj?.contractNo || activeBilling.contractId || '-'}</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block' }}>사업자번호</span>
                      <strong style={{ fontSize: '12.5px' }}>{custObj?.bizRegNo || (custObj as any)?.businessNo || '-'}</strong>
                    </div>
                  </div>

                  {/* 4분할 회계 지표 바 */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                    <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>공급가액 계</div>
                      <div style={{ fontSize: '14px', fontWeight: 800 }}>₩{totalSupply.toLocaleString()}</div>
                    </div>
                    <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>부가세 (10%)</div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: '#0070C0' }}>₩{totalVat.toLocaleString()}</div>
                    </div>
                    <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>총 청구금액 (VAT포함)</div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--primary)' }}>₩{totalGrand.toLocaleString()}</div>
                    </div>
                    <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>미수 잔액 (미납액)</div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: unpaidAmt > 0 ? '#dc2626' : 'var(--success)' }}>
                        ₩{unpaidAmt.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* 명세서 본문 테이블 (거래명세서 고밀도 그리드) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      {(() => {
                        const rentalCount = activeBillingDetails.filter(bd => Boolean(bd.contractAssetId)).length;
                        const extraCount = activeBillingDetails.length - rentalCount;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h4 style={{ fontSize: '13px', fontWeight: '700', margin: 0 }}>세부 청구 명세 (총 {activeBillingDetails.length}건)</h4>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>
                              [장비 렌탈료: {rentalCount}대{extraCount > 0 ? ` / 부대·미수금: ${extraCount}건` : ''}]
                            </span>
                          </div>
                        );
                      })()}
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>단위: 원 / VAT별도 기준 산출</span>
                    </div>

                    <div className="table-container" style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflowX: 'auto', margin: 0, maxHeight: '420px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', fontSize: '11.5px', whiteSpace: 'nowrap', borderCollapse: 'collapse' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: 'var(--bg-app)' }}>
                          <tr>
                            <th style={{ padding: '6px 8px', textAlign: 'center', width: '36px', whiteSpace: 'nowrap' }}>순번</th>
                            <th style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>구분</th>
                            <th style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>모델명/관리번호</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>월렌탈료</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>일렌탈료</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>수량</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>세액</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>합계</th>
                            <th style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>적용기간(산출근거)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeBillingDetails.length === 0 ? (
                            <tr>
                              <td colSpan={9} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
                                등록된 세부 청구 내역이 없습니다.
                              </td>
                            </tr>
                          ) : (
                            activeBillingDetails.map((bd, idx) => {
                              const ca = contractAssets.find(cAsset => cAsset.id === bd.contractAssetId);
                              const asset = ca?.assetId 
                                ? assets.find(a => a.id === ca.assetId) 
                                : (bd.assetId ? assets.find(a => a.id === bd.assetId) : null);
                              
                              const modelName = asset?.modelName || ca?.expectedModel || (bd.displayName || bd.itemName || '추가청구');
                              const assetNo = asset?.assetNo ? asset.assetNo : (ca?.assetId ? ca.assetId : '-');
                              const isAssetRental = Boolean(bd.contractAssetId || bd.assetId);
                              const category = isAssetRental ? '렌탈료' : (bd.displayName || bd.itemName || '추가청구');
                              
                              const supply = bd.amount || 0;
                              const vat = Math.round(supply * 0.1);
                              const lineTotal = supply + vat;

                              // 1. 기간 및 일수 산출
                              const periodText = isAssetRental ? calcServicePeriod(bd, activeBilling, contractObj) : '';
                              const baseMonthlyRental = ca?.monthlyRentalFee || (isAssetRental && (bd.quantity >= 28 || !ca?.dailyRentalFee) ? (supply || bd.unitPrice) : (ca?.dailyRentalFee ? ca.dailyRentalFee * 30 : supply));

                              let isPartialMonth = false;
                              let calcDays = 0;

                              if (isAssetRental) {
                                const periodMatch = periodText.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
                                if (periodMatch) {
                                  const sDate = new Date(periodMatch[1]);
                                  const eDate = new Date(periodMatch[2]);
                                  if (!isNaN(sDate.getTime()) && !isNaN(eDate.getTime())) {
                                    const diff = Math.round((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                                    calcDays = Math.max(1, diff);

                                    const isStartFirst = periodMatch[1].endsWith('-01');
                                    const lastDayOfMonth = new Date(sDate.getFullYear(), sDate.getMonth() + 1, 0).getDate();
                                    const isEndLast = sDate.getMonth() === eDate.getMonth() && eDate.getDate() === lastDayOfMonth;

                                    if (isStartFirst && isEndLast) {
                                      isPartialMonth = false;
                                    } else if (diff >= 30) {
                                      isPartialMonth = false;
                                    } else if (baseMonthlyRental > 0 && supply < baseMonthlyRental * 0.95) {
                                      isPartialMonth = true;
                                    } else if (diff < 28) {
                                      isPartialMonth = true;
                                    } else {
                                      isPartialMonth = false;
                                    }
                                  }
                                }

                                // 만약 bd.quantity가 1~27일로 명시되고 금액이 월렌탈료보다 적을 경우 일할로 확정
                                if (bd.quantity && bd.quantity > 0 && bd.quantity < 28 && baseMonthlyRental > 0 && supply < baseMonthlyRental * 0.95) {
                                  isPartialMonth = true;
                                  calcDays = bd.quantity;
                                }
                              }

                              // 2. 일렌탈료 산출 (1개월이 안 되는 경우만)
                              let dailyFee: number | null = null;
                              if (isAssetRental && isPartialMonth) {
                                if (ca?.dailyRentalFee && ca.dailyRentalFee > 0) {
                                  dailyFee = ca.dailyRentalFee;
                                } else if (baseMonthlyRental > 0) {
                                  dailyFee = Math.round(baseMonthlyRental / 30);
                                } else if (calcDays > 0) {
                                  dailyFee = Math.round(supply / calcDays);
                                } else if (bd.unitPrice > 0) {
                                  dailyFee = bd.unitPrice;
                                }
                              }

                              // 3. 수량 산출 (월렌탈료 적용의 경우는 1, 일렌탈료 적용의 경우는 날짜수)
                              let displayQuantity: number = 1;
                              if (isAssetRental) {
                                displayQuantity = isPartialMonth ? (calcDays || bd.quantity || 1) : 1;
                              } else {
                                displayQuantity = bd.quantity || 1;
                              }

                              return (
                                <tr key={bd.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                  <td style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>{idx + 1}</td>
                                  <td style={{ padding: '6px 8px' }}>
                                    <span style={{ 
                                      padding: '2px 6px', 
                                      borderRadius: '4px', 
                                      fontSize: '10.5px', 
                                      fontWeight: 600,
                                      backgroundColor: isAssetRental ? 'rgba(59, 130, 246, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                                      color: isAssetRental ? '#2563eb' : '#d97706'
                                    }}>
                                      {category}
                                    </span>
                                  </td>
                                  <td style={{ padding: '6px 8px' }}>
                                    <strong>{modelName}</strong>
                                    {assetNo !== '-' && (
                                      <span style={{ marginLeft: '6px', color: 'var(--text-muted)', fontSize: '11px' }}>
                                        ({assetNo})
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                    {isAssetRental 
                                      ? (baseMonthlyRental > 0 ? `${baseMonthlyRental.toLocaleString()}원` : `${supply.toLocaleString()}원`)
                                      : '-'}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', color: dailyFee ? 'var(--text-main)' : 'var(--text-muted)' }}>
                                    {dailyFee ? `${dailyFee.toLocaleString()}원` : '-'}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>
                                    {displayQuantity}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>
                                    {vat.toLocaleString()}원
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                                    {lineTotal.toLocaleString()}원
                                  </td>
                                  <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>
                                    {isAssetRental ? (
                                      <span>
                                        <strong style={{ color: 'var(--text-primary)' }}>{periodText}</strong>
                                        {isPartialMonth ? (
                                          <span style={{ marginLeft: '6px', fontSize: '11px', color: '#d97706', fontWeight: 600 }}>
                                            (일할 {displayQuantity}일)
                                          </span>
                                        ) : (
                                          bd.description && !bd.description.includes('정기') && !bd.description.includes('30일') ? (
                                            <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>({bd.description})</span>
                                          ) : null
                                        )}
                                      </span>
                                    ) : (
                                      bd.description || bd.itemName
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                        <tfoot style={{ position: 'sticky', bottom: 0, backgroundColor: 'var(--bg-app)', borderTop: '2px solid var(--border-color)', fontWeight: 800 }}>
                          <tr>
                            <td colSpan={3} style={{ padding: '8px', textAlign: 'center' }}>합계 ({activeBillingDetails.length}건)</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>-</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>-</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>
                              {activeBillingDetails.reduce((sum, bd) => {
                                const isRental = Boolean(bd.contractAssetId || bd.assetId);
                                if (!isRental) return sum + (bd.quantity || 1);
                                const pText = calcServicePeriod(bd, activeBilling, contractObj);
                                const ca = contractAssets.find(cAsset => cAsset.id === bd.contractAssetId);
                                const baseM = ca?.monthlyRentalFee || bd.amount || 0;
                                const pMatch = pText.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
                                let isPart = false;
                                let days = 1;
                                if (pMatch) {
                                  const s = new Date(pMatch[1]);
                                  const e = new Date(pMatch[2]);
                                  if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
                                    const d = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                                    days = Math.max(1, d);
                                    if (d < 28 || (baseM > 0 && (bd.amount || 0) < baseM * 0.95)) {
                                      isPart = true;
                                    }
                                  }
                                }
                                return sum + (isPart ? days : 1);
                              }, 0)}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right', color: '#0070C0' }}>₩{totalVat.toLocaleString()}</td>
                            <td style={{ padding: '8px', textAlign: 'right', color: 'var(--primary)' }}>₩{totalGrand.toLocaleString()}</td>
                            <td style={{ padding: '8px' }}>-</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* 💰 수납 및 결제 이력 (Payment History & 수납 취소) */}
                  {(() => {
                    const billingPayments = payments.filter(p => p.billingId === activeBilling.id);
                    if (billingPayments.length === 0) return null;

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <h4 style={{ fontSize: '13px', fontWeight: '700', margin: 0, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            💰 수납 및 결제 이력 ({billingPayments.length}건)
                          </h4>
                          {canSave && (
                            <button
                              type="button"
                              onClick={() => handleCancelAllPayments(activeBilling.id, paidAmt)}
                              style={{
                                padding: '3px 8px',
                                fontSize: '11px',
                                fontWeight: '700',
                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                color: '#dc2626',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: '4px',
                                cursor: 'pointer'
                              }}
                              title="모든 수납 내역 일괄 취소 및 통장 잔액/청구서 롤백"
                            >
                              전체 수납 취소 (롤백)
                            </button>
                          )}
                        </div>

                        <div className="table-container" style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflowX: 'auto', margin: 0 }}>
                          <table style={{ width: '100%', fontSize: '11.5px', whiteSpace: 'nowrap', borderCollapse: 'collapse' }}>
                            <thead style={{ backgroundColor: 'var(--bg-app)' }}>
                              <tr>
                                <th style={{ padding: '6px 8px', textAlign: 'center', width: '32px' }}>No</th>
                                <th style={{ padding: '6px 8px' }}>수납일자</th>
                                <th style={{ padding: '6px 8px' }}>수납방식</th>
                                <th style={{ padding: '6px 8px', textAlign: 'right' }}>수납금액</th>
                                <th style={{ padding: '6px 8px' }}>메모 / 승인정보</th>
                                <th style={{ padding: '6px 8px', textAlign: 'center' }}>취소</th>
                              </tr>
                            </thead>
                            <tbody>
                              {billingPayments.map((p, pIdx) => {
                                const methodLabel = 
                                  p.method === 'BANK_TRANSFER' ? '통장입금' :
                                  p.method === 'CARD' ? '카드결제' :
                                  p.method === 'PREPAID' ? '선수금상계' : p.method;

                                return (
                                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>{pIdx + 1}</td>
                                    <td style={{ padding: '6px 8px' }}>{p.paymentDate || p.createdAt?.slice(0, 10)}</td>
                                    <td style={{ padding: '6px 8px' }}>
                                      <span style={{
                                        padding: '2px 6px',
                                        borderRadius: '4px',
                                        fontSize: '10px',
                                        fontWeight: 600,
                                        backgroundColor: p.method === 'BANK_TRANSFER' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                                        color: p.method === 'BANK_TRANSFER' ? '#059669' : '#2563eb'
                                      }}>
                                        {methodLabel}
                                      </span>
                                    </td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                                      ₩{p.amount.toLocaleString()}
                                    </td>
                                    <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>
                                      {p.memo || '-'}
                                    </td>
                                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                      {canSave && (
                                        <button
                                          type="button"
                                          onClick={() => handleCancelPayment(p.id, p.amount)}
                                          style={{
                                            padding: '2px 6px',
                                            fontSize: '10.5px',
                                            fontWeight: '600',
                                            backgroundColor: '#fee2e2',
                                            color: '#b91c1c',
                                            border: '1px solid #fca5a5',
                                            borderRadius: '4px',
                                            cursor: 'pointer'
                                          }}
                                          title="이 수납 건 취소 및 통장 잔액/청구서 롤백"
                                        >
                                          수납취소
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })() : (
              <div className="card" style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', margin: 0 }}>
                상세 청구 항목을 조회할 청구서를 왼쪽 목록에서 선택해 주세요.
              </div>
            )}
          </div>

        {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 회계 대차대조식 검증 바 (헌장 3.5) */}
        {(() => {
          let sumTotal = 0;
          let sumPaid = 0;
          let sumUnpaid = 0;
          filteredBillings.forEach(b => {
            const grand = b.totalAmount || 0;
            const isP = b.status === 'PAID';
            const pAmt = isP ? grand : (b.paidAmount || 0);
            const uAmt = isP ? 0 : Math.max(0, grand - pAmt);
            sumTotal += grand;
            sumPaid += pAmt;
            sumUnpaid += uAmt;
          });
          return (
            <div style={{
              gridColumn: '1 / -1',
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
              marginTop: '10px',
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <span>조회 청구: <strong style={{ color: 'var(--primary)' }}>총 {filteredBillings.length}건</strong></span>
                <span>|</span>
                <span>청구 총액: <strong style={{ color: 'var(--text-primary)' }}>₩{sumTotal.toLocaleString()}원</strong></span>
                <span>|</span>
                <span>기수납액: <strong style={{ color: 'var(--success)' }}>₩{sumPaid.toLocaleString()}원</strong></span>
                <span>|</span>
                <span>미수 잔액: <strong style={{ color: 'var(--danger)' }}>₩{sumUnpaid.toLocaleString()}원</strong></span>
              </div>
              <span style={{
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: 'var(--success-light)',
                color: 'var(--success)',
                fontWeight: 700,
                fontSize: '11px'
              }}>
                ⚖️ 대차 정상 (청구총액 = 수납액 + 미수잔액 100% 무결)
              </span>
            </div>
          );
        })()}
        </div>
        </div>
        );
      })()}



      {activeTab === 'WIZARD' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '24px', alignItems: 'flex-start' }}>
          {/* 왼쪽: 계약 카드 목록 */}
          <div>
            <div className="card" style={{ margin: 0, marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h3 className="card-title" style={{ margin: 0 }}>정산 대상 계약 목록</h3>
              
              {/* 1행: 마감일 기준 검색 기간 (Z-구텐버그 좌상단 Scope 퀵버튼 탑재) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    마감일 기준 검색 기간
                  </label>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'nowrap' }}>
                    {[
                      { id: 'PREV_MONTH', label: '전월' },
                      { id: 'THIS_MONTH', label: '당월' },
                      { id: 'NEXT_MONTH', label: '익월' },
                      { id: 'LAST_3_MONTHS', label: '최근 3개월' },
                      { id: 'ALL_YEAR', label: '연간' }
                    ].map(btn => {
                      const isActive = activeQuickPeriod === btn.id;
                      return (
                        <button
                          key={btn.id}
                          type="button"
                          onClick={() => handleSetWizardPeriod(btn.id as any)}
                          style={{
                            padding: '2px 7px',
                            fontSize: '11px',
                            fontWeight: isActive ? 700 : 500,
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            borderRadius: '4px',
                            border: isActive ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                            backgroundColor: isActive ? 'var(--primary)' : 'var(--bg-app)',
                            color: isActive ? '#ffffff' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {btn.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="date"
                    value={wizardSearchStartDate}
                    onChange={e => setWizardSearchStartDate(e.target.value)}
                    style={{ flex: 1, padding: '5px 8px', fontSize: '12.5px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                  />
                  <span style={{ color: 'var(--text-muted)' }}>~</span>
                  <input
                    type="date"
                    value={wizardSearchEndDate}
                    onChange={e => setWizardSearchEndDate(e.target.value)}
                    style={{ flex: 1, padding: '5px 8px', fontSize: '12.5px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                  />
                </div>
              </div>

              {/* 2행: 고객사, 계약번호, 현장명 세부 필터 & [조회] & [일괄청구생성] 버튼 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto auto', gap: '8px', alignItems: 'end', backgroundColor: 'var(--bg-app)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', overflowX: 'auto' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>고객사 검색</label>
                  <input
                    type="text"
                    value={wizardTempCustomerFilter}
                    onChange={e => setWizardTempCustomerFilter(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleWizardSearchClick(); }}
                    placeholder="고객사명..."
                    style={{ width: '100%', padding: '5px 8px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>계약번호 검색</label>
                  <input
                    type="text"
                    value={wizardTempContractNoFilter}
                    onChange={e => setWizardTempContractNoFilter(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleWizardSearchClick(); }}
                    placeholder="계약번호..."
                    style={{ width: '100%', padding: '5px 8px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>현장명 검색</label>
                  <input
                    type="text"
                    value={wizardTempSiteFilter}
                    onChange={e => setWizardTempSiteFilter(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleWizardSearchClick(); }}
                    placeholder="현장명..."
                    style={{ width: '100%', padding: '5px 8px', fontSize: '12px', borderRadius: '5px', border: '1px solid var(--border-color)' }}
                  />
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleWizardSearchClick}
                  style={{ padding: '5px 12px', height: '30px', fontWeight: 'bold', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  조회
                </button>

                {canSave && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleBulkGenerateWizard}
                    disabled={isBulkGenerating || contractsWithoutReceivables.length === 0}
                    style={{
                      padding: '5px 14px',
                      height: '30px',
                      fontWeight: 'bold',
                      fontSize: '12px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      backgroundColor: contractsWithoutReceivables.length === 0 ? 'var(--text-muted)' : 'var(--primary)'
                    }}
                    title={
                      contractsWithoutReceivables.length === 0
                        ? '조회된 계약 중 외상미수금이 없는 일반 계약이 없습니다. (외상미수금 계약은 수동 검토 필요)'
                        : `외상미수금이 없는 일반 계약 ${contractsWithoutReceivables.length}건을 일괄 생성합니다.`
                    }
                  >
                    <Plus size={13} />
                    {isBulkGenerating ? '생성 중...' : `일괄청구생성 (${contractsWithoutReceivables.length}건)`}
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filteredWizardContracts.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', margin: 0 }}>
                  해당 조건의 정산 대상 계약이 없습니다.
                </div>
              ) : (
                filteredWizardContracts.map(c => {
                  const customerName = getCustName(c.customerId);
                  const siteName = getSiteName(c.siteId);
                  const isSelected = selectedContractIdForWizard === c.id;
                  const due = isDuePeriod(c);
                  const unbilledRcvList = getUnbilledReceivablesForContract(c);

                  return (
                    <div
                      key={c.id}
                      onClick={() => handleSelectContractForWizard(c)}
                      className="card"
                      style={{
                        margin: 0,
                        cursor: 'pointer',
                        border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: isSelected ? 'var(--bg-active)' : 'var(--bg-card)',
                        transition: 'all 0.2s',
                        position: 'relative'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: '700' }}>계약번호: {c.contractNo}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                          {unbilledRcvList.length > 0 && (
                            <span className="badge" style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.3)', fontWeight: 'bold' }}>
                              ⚠️ 외상미수금 {unbilledRcvList.length}건 (수동정산)
                            </span>
                          )}
                          {due && (
                            <span className="badge badge-danger">
                              🔥 마감 도래
                            </span>
                          )}
                        </div>
                      </div>
                      <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{customerName}</span>
                        {customers.find(cu => cu.id === c.customerId)?.transactionStatus === 'BLOCKED' && (
                          <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', backgroundColor: '#fee2e2', color: '#dc2626', fontWeight: 800, border: '1px solid #fca5a5' }}>
                            출고제한
                          </span>
                        )}
                      </h4>
                      <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        현장: {siteName}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                        <div>계약시작: <strong>{c.startDate}</strong></div>
                        <div>계약만료: <strong>{formatContractEndDate(c.endDate)}</strong></div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '8px', color: 'var(--text-muted)' }}>
                        <div>청구 마감: <strong>매월 {c.billingDay}일</strong></div>
                        <div>명세서 마감: <strong>매월 {c.statementClosingDay || '-'}일</strong></div>
                      </div>

                      {/* 💡 직전 청구 마일스톤 뱃지 바 */}
                      <div style={{ padding: '6px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px', fontSize: '11.5px', marginTop: '8px', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-muted)' }}>직전 청구:</span>
                          {c.lastBilledPeriodStart && c.lastBilledPeriodEnd ? (
                            <strong style={{ color: 'var(--primary)' }}>
                              {c.lastBilledPeriodStart} ~ {c.lastBilledPeriodEnd}
                            </strong>
                          ) : (
                            <span className="badge badge-secondary" style={{ fontSize: '10px' }}>최초 청구 대상</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '3px', fontSize: '10.5px', color: 'var(--text-muted)' }}>
                          <span>발행 이력: <strong>{c.billingCount ? `총 ${c.billingCount}회` : '미발행'}</strong></span>
                          <span>{c.lastBillingDate ? `최근발행: ${c.lastBillingDate}` : ''}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 오른쪽: 정산 계산기 */}
          <div>
            {selectedContractForWizard ? (
              <div className="card" style={{ margin: 0, borderTop: '4px solid var(--primary)' }}>
                <h3 className="card-title" style={{ marginBottom: '8px' }}>
                  [{getCustName(selectedContractForWizard.customerId)}] 청구 요금 계산기
                </h3>
                <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', flexWrap: 'wrap' }}>
                  <span>계약번호: <strong>{selectedContractForWizard.contractNo}</strong></span>
                  <span>계약 기간: <strong>{selectedContractForWizard.startDate} ~ {formatContractEndDate(selectedContractForWizard.endDate)}</strong></span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                  {/* 정산 기간 입력 (퀵버튼 탑재) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)' }}>
                        정산 대상 기간 설정
                      </span>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedContractForWizard.lastBilledPeriodEnd) {
                              const nextStart = new Date(selectedContractForWizard.lastBilledPeriodEnd);
                              nextStart.setDate(nextStart.getDate() + 1);
                              setWizardStartDate(nextStart.toISOString().split('T')[0]);
                            } else {
                              setWizardStartDate(selectedContractForWizard.startDate);
                            }
                          }}
                          className="btn-secondary"
                          style={{ padding: '2px 7px', fontSize: '11px', fontWeight: 600, borderRadius: '4px' }}
                        >
                          권장 시작일
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const now = new Date();
                            const y = now.getFullYear();
                            const m = now.getMonth();
                            const end = new Date(y, m + 1, 0);
                            setWizardStartDate(`${y}-${String(m + 1).padStart(2, '0')}-01`);
                            setWizardEndDate(`${y}-${String(m + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`);
                          }}
                          className="btn-secondary"
                          style={{ padding: '2px 7px', fontSize: '11px', fontWeight: 600, borderRadius: '4px' }}
                        >
                          당월
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const now = new Date();
                            const y = now.getFullYear();
                            const m = now.getMonth();
                            const prevDate = new Date(y, m - 1, 1);
                            const prevY = prevDate.getFullYear();
                            const prevM = prevDate.getMonth();
                            const end = new Date(prevY, prevM + 1, 0);
                            setWizardStartDate(`${prevY}-${String(prevM + 1).padStart(2, '0')}-01`);
                            setWizardEndDate(`${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`);
                          }}
                          className="btn-secondary"
                          style={{ padding: '2px 7px', fontSize: '11px', fontWeight: 600, borderRadius: '4px' }}
                        >
                          전월
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setWizardStartDate(selectedContractForWizard.startDate);
                            const endStr = formatContractEndDate(selectedContractForWizard.endDate);
                            if (endStr && endStr !== '미정') {
                              setWizardEndDate(selectedContractForWizard.endDate || '');
                            }
                          }}
                          className="btn-secondary"
                          style={{ padding: '2px 7px', fontSize: '11px', fontWeight: 600, borderRadius: '4px' }}
                        >
                          계약 전체
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>정산 시작일</label>
                        <input
                          type="date"
                          value={wizardStartDate}
                          onChange={e => setWizardStartDate(e.target.value)}
                          style={{ width: '100%', padding: '7px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>정산 종료일</label>
                        <input
                          type="date"
                          value={wizardEndDate}
                          onChange={e => setWizardEndDate(e.target.value)}
                          style={{ width: '100%', padding: '7px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 청구귀속월 & 청구 발행일자 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        청구 귀속월
                      </label>
                      <input
                        type="month"
                        value={wizardBillingYm}
                        onChange={e => setWizardBillingYm(e.target.value)}
                        style={{ width: '100%', padding: '7px 10px', fontSize: '13px', fontWeight: 700, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        청구 발행 일자
                      </label>
                      <input
                        type="date"
                        value={wizardBillingDate}
                        onChange={e => setWizardBillingDate(e.target.value)}
                        style={{ width: '100%', padding: '7px 10px', fontSize: '13px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '6px' }}
                      />
                    </div>
                  </div>

                  {/* 💡 직전 청구 마일스톤 및 권장 청구 기간 안내 박스 */}
                  <div style={{
                    padding: '12px 14px',
                    backgroundColor: 'var(--bg-app)',
                    borderLeft: '4px solid var(--primary)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginTop: '4px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>ℹ️ <strong>직전 청구 마일스톤:</strong></span>
                      <span className="badge badge-info" style={{ fontSize: '10.5px' }}>
                        누적 발행: {selectedContractForWizard.billingCount ? `총 ${selectedContractForWizard.billingCount}회` : '최초 청구'}
                      </span>
                    </div>
                    <div>
                      {selectedContractForWizard.lastBilledPeriodStart && selectedContractForWizard.lastBilledPeriodEnd ? (
                        <>
                          • 직전 청구 기간: <strong style={{ color: 'var(--text-primary)' }}>{selectedContractForWizard.lastBilledPeriodStart} ~ {selectedContractForWizard.lastBilledPeriodEnd}</strong> ({selectedContractForWizard.lastBilledYm || ''}월분 / {selectedContractForWizard.lastBillingDate || ''} 발행)<br />
                          • 💡 <strong>권장 당월 시작일:</strong> 직전 청구 종료 익일인 <strong style={{ color: 'var(--primary)' }}>{wizardStartDate}</strong>부터 자동 산정됨.
                        </>
                      ) : (
                        <>
                          • 직전 청구 이력이 없는 <strong>최초 청구 계약</strong>입니다.<br />
                          • 계약 시작일인 <strong style={{ color: 'var(--primary)' }}>{selectedContractForWizard.startDate}</strong>부터 자동 산정됨.
                        </>
                      )}
                    </div>
                  </div>

                  {/* 계산 방식 라디오 버튼 */}
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>정산 방식 선택</label>
                    <div style={{ display: 'flex', gap: '20px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 'normal' }}>
                        <input
                          type="radio"
                          name="calcMethod"
                          checked={calcMethod === 'MONTHLY'}
                          onChange={() => setCalcMethod('MONTHLY')}
                          style={{ width: '16px', height: '16px' }}
                        />
                        월단가 계산 (월렌탈료 전액 적용)
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 'normal' }}>
                        <input
                          type="radio"
                          name="calcMethod"
                          checked={calcMethod === 'PRORATED'}
                          onChange={() => setCalcMethod('PRORATED')}
                          style={{ width: '16px', height: '16px' }}
                        />
                        일할청구 계산 (일단가 * 사용일수)
                      </label>
                    </div>
                  </div>

                  {calcMethod === 'PRORATED' && (
                    <div style={{ padding: '8px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', fontSize: '13px', color: 'var(--primary)', fontWeight: '600' }}>
                      💡 계산된 대여 기간: {diffDaysForWizard}일
                    </div>
                  )}
                </div>

                <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '10px' }}>장비별 예상 요금 상세</h4>
                <div className="table-container" style={{ border: 'none', boxShadow: 'none', marginBottom: '24px' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>모델명</th>
                        <th>월단가</th>
                        <th>일단가</th>
                        <th>정산 방식/기간</th>
                        <th style={{ textAlign: 'right' }}>요금</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wizardContractAssets.map(ca => {
                        const assetInfo = assets.find(a => a.id === ca.assetId);
                        const feeInfo = calculateAssetFeeForWizard(ca);

                        return (
                          <tr key={ca.id} style={{ opacity: feeInfo.active ? 1 : 0.45 }}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>{assetInfo ? `${assetInfo.modelName} (${assetInfo.assetNo})` : ca.expectedModel}</span>
                                {feeInfo.isExchangeProRata && (
                                  <span className="badge badge-warning" style={{ fontSize: '10px', padding: '1px 5px' }}>
                                    대차/일할
                                  </span>
                                )}
                                {!feeInfo.active && (
                                  <span className="badge badge-secondary" style={{ fontSize: '10px', padding: '1px 5px' }}>
                                    제외
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>{ca.monthlyRentalFee.toLocaleString()}원</td>
                            <td>{ca.dailyRentalFee.toLocaleString()}원</td>
                            <td>
                              <span style={{ fontSize: '11.5px', color: feeInfo.isExchangeProRata ? 'var(--primary)' : undefined, fontWeight: feeInfo.isExchangeProRata ? 600 : undefined }}>
                                {feeInfo.desc}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: '700', color: feeInfo.active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                              {feeInfo.amount.toLocaleString()}원
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 추가 청구 항목 입력 섹션 */}
                <div style={{ marginTop: '24px', borderTop: '1px dashed var(--border-color)', paddingTop: '16px', marginBottom: '20px' }}>
                  
                  {/* 💡 미청구 고객 과실 수리비 자동 추천 패널 */}
                  {(() => {
                    const contractAssetIds = wizardContractAssets.map(ca => ca.assetId).filter(Boolean);
                    const unbilledRepairs = repairs.filter(r => 
                      r.billableToCustomer && 
                      !r.billingId && 
                      !r.isWaived &&
                      contractAssetIds.includes(r.assetId) &&
                      !selectedRepairIdsForWizard.includes(r.id)
                    );

                    if (unbilledRepairs.length === 0) return null;

                    return (
                      <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', marginBottom: '14px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '12.5px', color: '#dc2626', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>⚠️ 고객 부담 미청구 정비/수리비 {unbilledRepairs.length}건 발견</span>
                          {unbilledRepairs.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              style={{ fontSize: '11px', padding: '2px 8px', backgroundColor: '#dc2626', borderColor: '#dc2626' }}
                              onClick={() => {
                                const newRepairIds = unbilledRepairs.map(r => r.id);
                                const newCharges = unbilledRepairs.map(rep => {
                                  const ast = assets.find(a => a.id === rep.assetId);
                                  const cost = rep.totalCost || rep.billableAmount || 0;
                                  return {
                                    id: `EXTRA-REP-${rep.id}`,
                                    category: 'REPAIR',
                                    customName: `[고객부담 수리비] ${ast?.assetNo || ''} ${rep.details || ''}`,
                                    quantity: 1,
                                    unitPrice: cost
                                  };
                                });
                                setSelectedRepairIdsForWizard([...selectedRepairIdsForWizard, ...newRepairIds]);
                                setExtraCharges([...extraCharges, ...newCharges]);
                              }}
                            >
                              전체 일괄 추가
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {unbilledRepairs.map(rep => {
                            const ast = assets.find(a => a.id === rep.assetId);
                            const cost = rep.totalCost || rep.billableAmount || 0;
                            return (
                              <div key={rep.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', backgroundColor: 'var(--bg-card)', padding: '6px 10px', borderRadius: '6px' }}>
                                <div>
                                  <strong>{ast?.modelName || '장비'} ({ast?.assetNo})</strong> — {rep.details || '현장 수리'} ({cost.toLocaleString()}원)
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => {
                                      setSelectedRepairIdsForWizard([...selectedRepairIdsForWizard, rep.id]);
                                      setExtraCharges([...extraCharges, {
                                        id: `EXTRA-REP-${rep.id}`,
                                        category: 'REPAIR',
                                        customName: `[고객부담 수리비] ${ast?.assetNo || ''} ${rep.details || ''}`,
                                        quantity: 1,
                                        unitPrice: cost
                                      }]);
                                    }}
                                    style={{ fontSize: '11.5px', padding: '3px 8px', color: 'var(--primary)', fontWeight: 'bold' }}
                                  >
                                    + 청구 추가
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => {
                                      handleOpenWaiverModal({
                                        type: 'REPAIR',
                                        id: rep.id,
                                        title: `[고객부담 수리비] ${ast?.assetNo || ''} ${rep.details || '현장 수리'}`,
                                        originalCost: cost,
                                        customerName: selectedContractForWizard ? getCustName(selectedContractForWizard.customerId) : undefined,
                                        contractNo: selectedContractForWizard?.contractNo,
                                        assetNo: ast?.assetNo,
                                        modelName: ast?.modelName,
                                        date: rep.requestDate || rep.repairDate
                                      });
                                    }}
                                    style={{ fontSize: '11.5px', padding: '3px 8px', color: '#dc2626', borderColor: '#fca5a5', fontWeight: 'bold' }}
                                  >
                                    🚫 영업 면제
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 💡 미청구 고객부담 운송료 자동 추천 패널 */}
                  {(() => {
                    const unbilledDeliveries = deliveries.filter(d =>
                      d.billableToCustomer &&
                      !d.billingId &&
                      !d.isWaived &&
                      (d.contractId === selectedContractForWizard?.id || (d.billableCustomerId && d.billableCustomerId === selectedContractForWizard?.customerId)) &&
                      !selectedDeliveryIdsForWizard.includes(d.id)
                    );

                    if (unbilledDeliveries.length === 0) return null;

                    return (
                      <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.25)', marginBottom: '14px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '12.5px', color: '#ea580c', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>⚠️ 고객 부담 미청구 운송료 {unbilledDeliveries.length}건 발견</span>
                          {unbilledDeliveries.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              style={{ fontSize: '11px', padding: '2px 8px', backgroundColor: '#ea580c', borderColor: '#ea580c' }}
                              onClick={() => {
                                const newDelIds = unbilledDeliveries.map(d => d.id);
                                const newCharges = unbilledDeliveries.map(d => {
                                  const cost = d.billableAmount || d.finalCost || d.deliveryCostConfirmed || d.deliveryCost || 0;
                                  return {
                                    id: `EXTRA-DEL-${d.id}`,
                                    category: 'TRANSPORT',
                                    customName: `[고객부담 운송료] ${d.dispatchCategory || d.type} (${d.originAddress || '주기장'} ➔ ${d.destinationAddress || '현장'})`,
                                    quantity: 1,
                                    unitPrice: cost
                                  };
                                });
                                setSelectedDeliveryIdsForWizard([...selectedDeliveryIdsForWizard, ...newDelIds]);
                                setExtraCharges([...extraCharges, ...newCharges]);
                              }}
                            >
                              전체 일괄 추가
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {unbilledDeliveries.map(d => {
                            const cost = d.billableAmount || d.finalCost || d.deliveryCostConfirmed || d.deliveryCost || 0;
                            return (
                              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', backgroundColor: 'var(--bg-card)', padding: '6px 10px', borderRadius: '6px' }}>
                                <div>
                                  <strong>운송 {d.dispatchCategory || d.type}</strong> {d.originAddress || '주기장'} ➔ {d.destinationAddress || '현장'} ({cost.toLocaleString()}원)
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => {
                                      setSelectedDeliveryIdsForWizard([...selectedDeliveryIdsForWizard, d.id]);
                                      setExtraCharges([...extraCharges, {
                                        id: `EXTRA-DEL-${d.id}`,
                                        category: 'TRANSPORT',
                                        customName: `[고객부담 운송료] ${d.dispatchCategory || d.type} (${d.originAddress || '주기장'} ➔ ${d.destinationAddress || '현장'})`,
                                        quantity: 1,
                                        unitPrice: cost
                                      }]);
                                    }}
                                    style={{ fontSize: '11.5px', padding: '3px 8px', color: 'var(--primary)', fontWeight: 'bold' }}
                                  >
                                    + 청구 추가
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => {
                                      handleOpenWaiverModal({
                                        type: 'DELIVERY',
                                        id: d.id,
                                        title: `[고객부담 운송료] ${d.dispatchCategory || d.type} (${d.originAddress || '주기장'} ➔ ${d.destinationAddress || '현장'})`,
                                        originalCost: cost,
                                        customerName: selectedContractForWizard ? getCustName(selectedContractForWizard.customerId) : undefined,
                                        contractNo: selectedContractForWizard?.contractNo,
                                        date: d.unloadingDate || d.loadingDate || d.requestDate
                                      });
                                    }}
                                    style={{ fontSize: '11.5px', padding: '3px 8px', color: '#dc2626', borderColor: '#fca5a5', fontWeight: 'bold' }}
                                  >
                                    🚫 영업 면제
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 💡 미청구 외상미수금 대장 자동 추천 패널 */}
                  {(() => {
                    const unbilledReceivables = receivables.filter(r => 
                      r.status !== 'CLEARED' &&
                      (r.contractId === selectedContractForWizard.id || r.contractId === undefined) &&
                      r.customerId === selectedContractForWizard.customerId &&
                      !selectedReceivablesForWizard.find(sr => sr.receivableId === r.id)
                    );

                    if (unbilledReceivables.length === 0) return null;

                    return (
                      <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)', marginBottom: '14px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '12.5px', color: '#2563eb', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>ℹ️ 이 계약/고객사의 미청구 외상미수금 {unbilledReceivables.length}건 발견</span>
                          {unbilledReceivables.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              style={{ fontSize: '11px', padding: '2px 8px' }}
                              onClick={() => {
                                const newReceivables = unbilledReceivables.map(rcv => {
                                  const remaining = rcv.totalAmount - rcv.billedAmount;
                                  return {
                                    receivableId: rcv.id,
                                    amount: remaining,
                                    displayName: rcv.displayName || rcv.internalDescription
                                  };
                                });
                                const newCharges = unbilledReceivables.map(rcv => {
                                  const remaining = rcv.totalAmount - rcv.billedAmount;
                                  return {
                                    id: `EXTRA-RCV-${rcv.id}`,
                                    category: rcv.type === 'TRANSPORT' ? 'TRANSPORT_ONEWAY' : rcv.type === 'REPAIR' ? 'REPAIR' : 'OTHER',
                                    customName: `[외상청구] ${rcv.displayName || rcv.internalDescription}`,
                                    quantity: 1,
                                    unitPrice: remaining
                                  };
                                });
                                setSelectedReceivablesForWizard([...selectedReceivablesForWizard, ...newReceivables]);
                                setExtraCharges([...extraCharges, ...newCharges]);
                              }}
                            >
                              전체 일괄 추가
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {unbilledReceivables.map(rcv => {
                            const remaining = rcv.totalAmount - rcv.billedAmount;
                            return (
                              <div key={rcv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', backgroundColor: 'var(--bg-card)', padding: '6px 10px', borderRadius: '6px' }}>
                                <div>
                                  <strong>[{rcv.type}]</strong> {rcv.internalDescription} <span className="text-muted">(잔액: {remaining.toLocaleString()}원)</span>
                                </div>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => {
                                    setSelectedReceivablesForWizard([...selectedReceivablesForWizard, {
                                      receivableId: rcv.id,
                                      amount: remaining,
                                      displayName: rcv.displayName || rcv.internalDescription
                                    }]);
                                    setExtraCharges([...extraCharges, {
                                      id: `EXTRA-RCV-${rcv.id}`,
                                      category: rcv.type === 'TRANSPORT' ? 'TRANSPORT_ONEWAY' : rcv.type === 'REPAIR' ? 'REPAIR' : 'OTHER',
                                      customName: `[외상청구] ${rcv.displayName || rcv.internalDescription}`,
                                      quantity: 1,
                                      unitPrice: remaining
                                    }]);
                                  }}
                                  style={{ fontSize: '11.5px', padding: '3px 8px', color: 'var(--primary)', fontWeight: 'bold' }}
                                >
                                  + 청구 항목에 추가
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                      ➕ 추가 청구 등록 (운송료, 수리비 등)
                    </h4>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setExtraCharges([...extraCharges, {
                        id: `EXTRA-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                        category: 'TRANSPORT_ONEWAY',
                        customName: '',
                        quantity: 1,
                        unitPrice: 0
                      }])}
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                    >
                      + 추가항목 생성
                    </button>
                  </div>

                  {extraCharges.length === 0 ? (
                    <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                      등록된 추가 청구 항목이 없습니다.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {extraCharges.map((ec, idx) => (
                        <div key={ec.id} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {/* 카테고리 */}
                          <select
                            value={ec.category}
                            onChange={e => {
                              const updated = [...extraCharges];
                              updated[idx].category = e.target.value;
                              if (e.target.value !== 'OTHER') {
                                updated[idx].customName = '';
                              }
                              setExtraCharges(updated);
                            }}
                            style={{ width: '130px', padding: '6px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                          >
                            <option value="TRANSPORT_ONEWAY">운송료(편도)</option>
                            <option value="TRANSPORT_ROUNDTRIP">운송료(왕복)</option>
                            <option value="REPAIR">수리비</option>
                            <option value="OTHER">기타(수기입력)</option>
                          </select>

                          {/* 기타 수기입력명 */}
                          {ec.category === 'OTHER' && (
                            <input
                              type="text"
                              placeholder="기타 항목명"
                              value={ec.customName}
                              onChange={e => {
                                const updated = [...extraCharges];
                                updated[idx].customName = e.target.value;
                                setExtraCharges(updated);
                              }}
                              style={{ width: '110px', padding: '6px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                            />
                          )}

                          {/* 수량 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>수량:</span>
                            <input
                              type="number"
                              min="1"
                              value={ec.quantity}
                              onChange={e => {
                                const updated = [...extraCharges];
                                updated[idx].quantity = Math.max(1, parseInt(e.target.value) || 1);
                                setExtraCharges(updated);
                              }}
                              style={{ width: '50px', padding: '6px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                            />
                          </div>
                          {/* 단가 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>단가:</span>
                            <input
                              type="number"
                              placeholder="단가(원)"
                              value={ec.unitPrice || ''}
                              onChange={e => {
                                const updated = [...extraCharges];
                                updated[idx].unitPrice = parseInt(e.target.value) || 0;
                                setExtraCharges(updated);
                              }}
                              style={{ width: '100%', minWidth: '70px', padding: '6px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', textAlign: 'right' }}
                            />
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>원</span>
                          </div>

                          {/* 금액 표시 */}
                          <span style={{ fontSize: '13px', fontWeight: '600', minWidth: '80px', textAlign: 'right', color: 'var(--text-primary)' }}>
                            {(ec.quantity * ec.unitPrice).toLocaleString()}원
                          </span>

                          {/* 삭제 버튼 */}
                          <button
                            type="button"
                            onClick={() => {
                              const newCharges = extraCharges.filter(item => item.id !== ec.id);
                              setExtraCharges(newCharges);
                              
                              if (ec.id.startsWith('EXTRA-REP-')) {
                                const rId = ec.id.replace('EXTRA-REP-', '');
                                setSelectedRepairIdsForWizard(selectedRepairIdsForWizard.filter(id => id !== rId));
                              } else if (ec.id.startsWith('EXTRA-RCV-')) {
                                const rcvId = ec.id.replace('EXTRA-RCV-', '');
                                setSelectedReceivablesForWizard(selectedReceivablesForWizard.filter(r => r.receivableId !== rcvId));
                              } else if (ec.id.startsWith('EXTRA-DEL-')) {
                                const dId = ec.id.replace('EXTRA-DEL-', '');
                                setSelectedDeliveryIdsForWizard(selectedDeliveryIdsForWizard.filter(id => id !== dId));
                              }
                            }}
                            style={{
                              padding: '2px 8px',
                              backgroundColor: 'transparent',
                              border: 'none',
                              color: 'var(--text-secondary)',
                              fontSize: '16px',
                              cursor: 'pointer'
                            }}
                            title="항목 삭제"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', marginBottom: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <span>기본 장비 렌탈료 합계</span>
                    <span>{totalAmountForWizard.toLocaleString()}원</span>
                  </div>
                  {extraCharges.length > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: 'var(--text-secondary)', borderBottom: '1px dashed var(--border-color)', paddingBottom: '6px', marginBottom: '4px' }}>
                      <span>추가 청구 항목 합계</span>
                      <span>{extraCharges.reduce((sum, ec) => sum + ec.quantity * ec.unitPrice, 0).toLocaleString()}원</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px' }}>
                    <span style={{ fontWeight: '700', fontSize: '14px', color: 'var(--text-primary)' }}>총 정산 예상 금액</span>
                    <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--primary)' }}>
                      {(totalAmountForWizard + extraCharges.reduce((sum, ec) => sum + ec.quantity * ec.unitPrice, 0)).toLocaleString()}원
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button type="button" className="btn-secondary" onClick={() => setSelectedContractIdForWizard(null)}>
                    취소
                  </button>
                  <button type="button" className="btn-primary" onClick={handleGenerateWizardBilling} disabled={(totalAmountForWizard + extraCharges.reduce((sum, ec) => sum + ec.quantity * ec.unitPrice, 0)) <= 0}>
                    청구 생성
                  </button>
                </div>
              </div>
            ) : (
              <div className="card" style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)', margin: 0 }}>
                왼쪽 계약 목록에서 청구를 진행할 카드를 선택해 주세요.
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. 청구 면제 대장 (WAIVER) 탭 */}
      {activeTab === 'WAIVER' && (() => {
        // 1) 면제된 모든 수리/정비 및 운송 건 수집
        const waivedRepairsList = repairs.filter(r => r.isWaived);
        const waivedDeliveriesList = deliveries.filter(d => d.isWaived);

        // 2) 통합 구조로 표준화
        const allWaivedItems: {
          id: string;
          itemType: 'FIELD_AS' | 'INBOUND_REPAIR' | 'DELIVERY';
          typeLabel: string;
          badgeColor: string;
          badgeBg: string;
          waivedAt: string;
          requestDate: string;
          contractNo: string;
          customerName: string;
          siteName: string;
          assetInfo: string;
          originalCost: number;
          waivedAmount: number;
          waivedReason: string;
          waivedBy: string;
          memo?: string;
        }[] = [
          ...waivedRepairsList.map(r => {
            const isFieldAs = r.workCategory === 'FIELD_AS' || r.source === 'SALES_REQUEST' || r.source === 'BAND_IMPORT';
            const ast = assets.find(a => a.id === r.assetId);
            const cntr = contracts.find(c => c.id === r.contractId);
            const cust = customers.find(c => c.id === r.customerId || c.id === cntr?.customerId);
            const st = sites.find(s => s.id === r.siteId || s.id === cntr?.siteId);
            const orig = r.totalCost || r.billableAmount || r.waivedAmount || 0;

            return {
              id: r.id,
              itemType: isFieldAs ? ('FIELD_AS' as const) : ('INBOUND_REPAIR' as const),
              typeLabel: isFieldAs ? '현장 AS' : '입고 정비',
              badgeColor: isFieldAs ? '#1d4ed8' : '#6d28d9',
              badgeBg: isFieldAs ? 'rgba(59, 130, 246, 0.1)' : 'rgba(147, 51, 234, 0.1)',
              waivedAt: r.waivedAt || r.updatedAt || '',
              requestDate: r.requestDate || r.repairDate || '',
              contractNo: cntr?.contractNo || '-',
              customerName: cust?.name || r.customerName || '-',
              siteName: st?.name || r.siteName || (cntr?.siteId ? getSiteName(cntr.siteId) : '-'),
              assetInfo: ast ? `${ast.assetNo} (${ast.modelName})` : (r.assetNo || '-'),
              originalCost: orig,
              waivedAmount: r.waivedAmount || orig,
              waivedReason: r.waivedReason || '영업 사유 면제',
              waivedBy: r.waivedBy || '영업담당',
              memo: r.details || r.memo
            };
          }),
          ...waivedDeliveriesList.map(d => {
            const cntr = contracts.find(c => c.id === d.contractId);
            const cust = customers.find(c => c.id === d.billableCustomerId || c.id === cntr?.customerId);
            const st = sites.find(s => s.id === cntr?.siteId);
            const orig = d.billableAmount || d.finalCost || d.deliveryCostConfirmed || d.deliveryCost || d.waivedAmount || 0;

            return {
              id: d.id,
              itemType: 'DELIVERY' as const,
              typeLabel: `운송 (${d.dispatchCategory || d.type})`,
              badgeColor: '#c2410c',
              badgeBg: 'rgba(234, 88, 12, 0.1)',
              waivedAt: d.waivedAt || d.updatedAt || '',
              requestDate: d.unloadingDate || d.loadingDate || d.requestDate || '',
              contractNo: cntr?.contractNo || '-',
              customerName: cust?.name || '-',
              siteName: st?.name || (cntr?.siteId ? getSiteName(cntr.siteId) : '-'),
              assetInfo: `${d.originAddress || '주기장'} ➔ ${d.destinationAddress || '현장'}`,
              originalCost: orig,
              waivedAmount: d.waivedAmount || orig,
              waivedReason: d.waivedReason || '영업 사유 면제',
              waivedBy: d.waivedBy || '영업담당',
              memo: d.memo || d.costAdjustmentReason
            };
          })
        ];

        // 3) 필터 적용 (기간, 구분, 검색어)
        const filteredWaived = allWaivedItems.filter(item => {
          const itemYm = (item.waivedAt || item.requestDate).slice(0, 7);
          if (waiverStartMonth && itemYm < waiverStartMonth) return false;
          if (waiverEndMonth && itemYm > waiverEndMonth) return false;

          if (waiverCategoryFilter !== 'ALL') {
            if (waiverCategoryFilter === 'FIELD_AS' && item.itemType !== 'FIELD_AS') return false;
            if (waiverCategoryFilter === 'INBOUND_REPAIR' && item.itemType !== 'INBOUND_REPAIR') return false;
            if (waiverCategoryFilter === 'DELIVERY' && item.itemType !== 'DELIVERY') return false;
          }

          if (waiverSearchKeyword.trim()) {
            const q = waiverSearchKeyword.trim().toLowerCase();
            const match =
              matchHangul(item.customerName, q) ||
              item.contractNo.toLowerCase().includes(q) ||
              matchHangul(item.siteName, q) ||
              matchHangul(item.waivedBy, q) ||
              matchHangul(item.waivedReason, q) ||
              item.assetInfo.toLowerCase().includes(q);
            if (!match) return false;
          }

          return true;
        });

        // 최신순 정렬
        filteredWaived.sort((a, b) => (b.waivedAt || b.requestDate).localeCompare(a.waivedAt || a.requestDate));

        // 4) KPI 집계
        const totalWaivedCount = filteredWaived.length;
        const totalWaivedAmount = filteredWaived.reduce((sum, it) => sum + it.waivedAmount, 0);

        const fieldAsWaived = filteredWaived.filter(it => it.itemType === 'FIELD_AS');
        const fieldAsAmount = fieldAsWaived.reduce((sum, it) => sum + it.waivedAmount, 0);

        const inboundWaived = filteredWaived.filter(it => it.itemType === 'INBOUND_REPAIR');
        const inboundAmount = inboundWaived.reduce((sum, it) => sum + it.waivedAmount, 0);

        const deliveryWaived = filteredWaived.filter(it => it.itemType === 'DELIVERY');
        const deliveryAmount = deliveryWaived.reduce((sum, it) => sum + it.waivedAmount, 0);

        // 사유별 집계
        const reasonMap: Record<string, { count: number; amount: number }> = {};
        filteredWaived.forEach(it => {
          const rawReason = it.waivedReason || '기타';
          const rKey = rawReason.startsWith('[') ? (rawReason.split(']')[0].replace('[', '').trim()) : rawReason;
          if (!reasonMap[rKey]) reasonMap[rKey] = { count: 0, amount: 0 };
          reasonMap[rKey].count++;
          reasonMap[rKey].amount += it.waivedAmount;
        });
        const topReasons = Object.entries(reasonMap).sort((a, b) => b[1].amount - a[1].amount);

        // 영업담당자별 집계
        const salespersonMap: Record<string, { count: number; amount: number }> = {};
        filteredWaived.forEach(it => {
          const spKey = it.waivedBy || '미지정';
          if (!salespersonMap[spKey]) salespersonMap[spKey] = { count: 0, amount: 0 };
          salespersonMap[spKey].count++;
          salespersonMap[spKey].amount += it.waivedAmount;
        });
        const topSalespeople = Object.entries(salespersonMap).sort((a, b) => b[1].amount - a[1].amount);

        // 대차대조식 검증 계산
        const billedRepairsAmount = repairs
          .filter(r => r.billableToCustomer && r.billingId && !r.isWaived)
          .reduce((sum, r) => sum + (r.totalCost || r.billableAmount || 0), 0);
        const billedDeliveriesAmount = deliveries
          .filter(d => d.billableToCustomer && d.billingId && !d.isWaived)
          .reduce((sum, d) => sum + (d.billableAmount || d.finalCost || d.deliveryCostConfirmed || d.deliveryCost || 0), 0);
        const totalBilledBillableCosts = billedRepairsAmount + billedDeliveriesAmount;
        const grandTotalDiscoveredCosts = totalBilledBillableCosts + totalWaivedAmount;

        // 엑셀 내보내기 핸들러
        const handleExportWaiverExcel = () => {
          const excelRows = filteredWaived.map((it, idx) => ({
            'No': idx + 1,
            '면제일자': it.waivedAt ? it.waivedAt.slice(0, 10) : '-',
            '구분': it.typeLabel,
            '고객사': it.customerName,
            '계약번호': it.contractNo,
            '현장명': it.siteName,
            '장비/경로': it.assetInfo,
            '원발생비용(원)': it.originalCost,
            '면제금액(원)': it.waivedAmount,
            '면제사유': it.waivedReason,
            '면제처리자': it.waivedBy,
            '발생일자': it.requestDate,
            '비고': it.memo || ''
          }));
          exportToExcel(excelRows, `청구면제대장_${waiverStartMonth}_${waiverEndMonth}`);
        };

        // 면제 취소 핸들러
        const handleCancelWaiverClick = async (item: typeof allWaivedItems[0]) => {
          if (!window.confirm(`[${item.typeLabel}] ${item.customerName} 건의 영업 면제를 취소하고 미청구 상태로 복원하시겠습니까?\n\n- 면제금액: ₩${item.waivedAmount.toLocaleString()}원\n- 면제사유: ${item.waivedReason}`)) {
            return;
          }
          try {
            if (item.itemType === 'DELIVERY') {
              await cancelDeliveryWaiver(item.id);
            } else {
              await cancelRepairWaiver(item.id);
            }
            showToast(`[${item.customerName}] ${item.typeLabel} 면제가 취소되어 미청구 대장으로 복원되었습니다.`);
          } catch (err: any) {
            showToast(`면제 취소 실패: ${err?.message || err}`, 'error');
          }
        };

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* ① 상단 필터 & 액션 바 (헌장 3.5 Z-패턴 1, 2단계) */}
            <div className="card" style={{ margin: 0, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                {/* 기간 필터 (헌장 3.4 세로 스택) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    면제 연월 범위
                  </label>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      type="month"
                      value={waiverStartMonth}
                      onChange={e => setWaiverStartMonth(e.target.value)}
                      style={{ padding: '6px 10px', fontSize: '12.5px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                    />
                    <span style={{ color: 'var(--text-muted)' }}>~</span>
                    <input
                      type="month"
                      value={waiverEndMonth}
                      onChange={e => setWaiverEndMonth(e.target.value)}
                      style={{ padding: '6px 10px', fontSize: '12.5px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                    />
                  </div>
                </div>

                {/* 구분 필터 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    항목 구분
                  </label>
                  <select
                    value={waiverCategoryFilter}
                    onChange={e => setWaiverCategoryFilter(e.target.value as any)}
                    style={{ padding: '6px 10px', fontSize: '12.5px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                  >
                    <option value="ALL">전체 구분 ({allWaivedItems.length}건)</option>
                    <option value="FIELD_AS">현장 AS</option>
                    <option value="INBOUND_REPAIR">입고 정비</option>
                    <option value="DELIVERY">화물 운송료</option>
                  </select>
                </div>

                {/* 통합 검색어 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '220px', flexShrink: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    검색 (고객사 / 계약 / 담당자 / 사유)
                  </label>
                  <input
                    type="text"
                    placeholder="검색어 입력..."
                    value={waiverSearchKeyword}
                    onChange={e => setWaiverSearchKeyword(e.target.value)}
                    style={{ padding: '6px 10px', fontSize: '12.5px', borderRadius: '5px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>

              {/* 우상단 엑셀 내보내기 (헌장 3.1 명사 표준) */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleExportWaiverExcel}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px', fontWeight: 700 }}
                >
                  <Download size={14} /> 엑셀 내보내기
                </button>
              </div>
            </div>

            {/* ② KPI 요약 카드 그리드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <div className="card" style={{ margin: 0, padding: '14px', borderLeft: '4px solid #dc2626' }}>
                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '4px' }}>총 영업 면제 손실액</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626' }}>
                  ₩{totalWaivedAmount.toLocaleString()}원
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  총 {totalWaivedCount}건 면제 승인
                </div>
              </div>

              <div className="card" style={{ margin: 0, padding: '14px', borderLeft: '4px solid #2563eb' }}>
                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '4px' }}>현장 AS 비용 면제</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#2563eb' }}>
                  ₩{fieldAsAmount.toLocaleString()}원
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {fieldAsWaived.length}건 (고객 과실 현장 출동)
                </div>
              </div>

              <div className="card" style={{ margin: 0, padding: '14px', borderLeft: '4px solid #7c3aed' }}>
                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '4px' }}>반납 입고 정비비 면제</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#7c3aed' }}>
                  ₩{inboundAmount.toLocaleString()}원
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {inboundWaived.length}건 (입고 검수 결함 파손)
                </div>
              </div>

              <div className="card" style={{ margin: 0, padding: '14px', borderLeft: '4px solid #ea580c' }}>
                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '4px' }}>고객부담 운송료 면제</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#ea580c' }}>
                  ₩{deliveryAmount.toLocaleString()}원
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {deliveryWaived.length}건 (배차 및 추가 운송비)
                </div>
              </div>
            </div>

            {/* 사유 분석 및 영업사원별 현황 칩 바 */}
            {(topReasons.length > 0 || topSalespeople.length > 0) && (
              <div className="card" style={{ margin: 0, padding: '10px 14px', backgroundColor: 'var(--bg-app)', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>📊 사유별 비중:</span>
                  {topReasons.slice(0, 4).map(([rs, data]) => (
                    <span key={rs} style={{ backgroundColor: 'var(--bg-card)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                      <strong>{rs}</strong>: {data.count}건 (₩{data.amount.toLocaleString()})
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>👤 담당자별 면제:</span>
                  {topSalespeople.slice(0, 4).map(([sp, data]) => (
                    <span key={sp} style={{ backgroundColor: 'var(--bg-card)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>
                      <strong>{sp}</strong>: ₩{data.amount.toLocaleString()} ({data.count}건)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ③ 본문 고밀도 슬림 그리드 (헌장 3.6 유형 B, 행 높이 38~40px) */}
            <div className="card" style={{ margin: 0, padding: 0, overflow: 'hidden' }}>
              <div style={{ maxHeight: 'calc(100vh - 430px)', minHeight: '350px', overflowY: 'auto', overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)', height: '38px', position: 'sticky', top: 0, zIndex: 10 }}>
                      <th style={{ width: '80px', textAlign: 'center', padding: '6px 8px', whiteSpace: 'nowrap', position: 'sticky', left: 0, backgroundColor: 'var(--bg-app)', zIndex: 11 }}>관리</th>
                      <th style={{ width: '95px', textAlign: 'center', padding: '6px 10px', whiteSpace: 'nowrap' }}>면제일자</th>
                      <th style={{ width: '90px', textAlign: 'center', padding: '6px 10px', whiteSpace: 'nowrap' }}>구분</th>
                      <th style={{ width: '150px', textAlign: 'left', padding: '6px 10px', whiteSpace: 'nowrap' }}>고객사</th>
                      <th style={{ width: '120px', textAlign: 'center', padding: '6px 10px', whiteSpace: 'nowrap' }}>계약번호</th>
                      <th style={{ width: '140px', textAlign: 'left', padding: '6px 10px', whiteSpace: 'nowrap' }}>현장명</th>
                      <th style={{ minWidth: '180px', textAlign: 'left', padding: '6px 10px', whiteSpace: 'nowrap' }}>대상 장비 / 운송 경로</th>
                      <th style={{ width: '110px', textAlign: 'right', padding: '6px 10px', whiteSpace: 'nowrap' }}>원 발생비용</th>
                      <th style={{ width: '120px', textAlign: 'right', padding: '6px 10px', whiteSpace: 'nowrap', color: '#dc2626' }}>면제 금액</th>
                      <th style={{ minWidth: '160px', textAlign: 'left', padding: '6px 10px', whiteSpace: 'nowrap' }}>면제 사유</th>
                      <th style={{ width: '90px', textAlign: 'center', padding: '6px 10px', whiteSpace: 'nowrap' }}>처리자</th>
                      <th style={{ width: '95px', textAlign: 'center', padding: '6px 10px', whiteSpace: 'nowrap' }}>원발생일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWaived.length === 0 ? (
                      <tr>
                        <td colSpan={12} style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                          조회 조건에 부합하는 영업 청구 면제 내역이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredWaived.map(it => (
                        <tr key={it.id} style={{ height: '38px', borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.15s' }}>
                          <td style={{ textAlign: 'center', padding: '4px 8px', whiteSpace: 'nowrap', position: 'sticky', left: 0, backgroundColor: 'var(--bg-card)', zIndex: 5 }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => handleCancelWaiverClick(it)}
                              style={{ fontSize: '11px', padding: '2px 8px', color: '#d97706', borderColor: '#fcd34d', fontWeight: 700 }}
                              title="면제를 취소하고 미청구 정산 대장으로 복원합니다."
                            >
                              면제 취소
                            </button>
                          </td>
                          <td style={{ textAlign: 'center', padding: '4px 10px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                            {it.waivedAt ? it.waivedAt.slice(0, 10) : '-'}
                          </td>
                          <td style={{ textAlign: 'center', padding: '4px 10px', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', fontWeight: 700, color: it.badgeColor, backgroundColor: it.badgeBg, border: `1px solid ${it.badgeColor}33` }}>
                              {it.typeLabel}
                            </span>
                          </td>
                          <td style={{ textAlign: 'left', padding: '4px 10px', whiteSpace: 'nowrap', fontWeight: 700 }}>
                            {it.customerName}
                          </td>
                          <td style={{ textAlign: 'center', padding: '4px 10px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                            {it.contractNo}
                          </td>
                          <td style={{ textAlign: 'left', padding: '4px 10px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                            {it.siteName}
                          </td>
                          <td style={{ textAlign: 'left', padding: '4px 10px', whiteSpace: 'nowrap' }}>
                            {it.assetInfo}
                          </td>
                          <td style={{ textAlign: 'right', padding: '4px 10px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                            {it.originalCost.toLocaleString()}원
                          </td>
                          <td style={{ textAlign: 'right', padding: '4px 10px', whiteSpace: 'nowrap', fontWeight: 800, color: '#dc2626' }}>
                            ₩{it.waivedAmount.toLocaleString()}원
                          </td>
                          <td style={{ textAlign: 'left', padding: '4px 10px', whiteSpace: 'nowrap', fontWeight: 600 }}>
                            {it.waivedReason}
                          </td>
                          <td style={{ textAlign: 'center', padding: '4px 10px', whiteSpace: 'nowrap' }}>
                            {it.waivedBy}
                          </td>
                          <td style={{ textAlign: 'center', padding: '4px 10px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                            {it.requestDate ? it.requestDate.slice(0, 10) : '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ④ 우하단 Gutenberg Z-패턴 대차대조식 검증 바 (헌장 3.5 Z-패턴 4단계) */}
            <div className="card" style={{ margin: 0, padding: '12px 18px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                  📄 총 유료비용 발생: <span style={{ color: 'var(--text-primary)' }}>₩{grandTotalDiscoveredCosts.toLocaleString()}원</span>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>=</span>
                <span style={{ color: '#16a34a', fontWeight: 700 }}>
                  🟢 정상 청구액: ₩{totalBilledBillableCosts.toLocaleString()}원
                </span>
                <span style={{ color: 'var(--text-muted)' }}>+</span>
                <span style={{ color: '#dc2626', fontWeight: 700 }}>
                  🚫 영업 면제액: ₩{totalWaivedAmount.toLocaleString()}원
                </span>
                <span style={{ color: 'var(--text-muted)' }}>|</span>
                <span style={{ color: '#2563eb', fontWeight: 800, backgroundColor: 'rgba(37, 99, 235, 0.08)', padding: '2px 8px', borderRadius: '4px' }}>
                  ⚖️ 대차 차액 ₩0 (정합)
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  대장 {filteredWaived.length}건 표시
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleExportWaiverExcel}
                  style={{ fontSize: '12px', padding: '4px 10px', fontWeight: 700 }}
                >
                  대장 다운로드
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 수납 입력 모달 */}
      {showPayModal && (() => {
        const payBilling = billings.find(b => b.id === payBillingId);
        const custId = payBilling?.customerId;
        const billingSupply = payBilling?.totalAmount || 0;
        const billingVat = Math.round(billingSupply * 0.1);
        const billingGrandTotal = billingSupply + billingVat; // 당월 청구 총액 (VAT포함)
        const unpaid = payBilling ? Math.max(0, billingGrandTotal - (payBilling.paidAmount || 0)) : 0; // 이번 청구서 미납액
        const billingNo = payBillingId;

        // 고객사 전체 미수납 잔액 (해당 고객사의 모든 청구서 미수잔액 합계)
        const customerTotalUnpaid = billings
          .filter(b => b.customerId === custId && b.status !== 'REJECTED')
          .reduce((sum, b) => {
            const s = b.totalAmount || 0;
            const grand = s + Math.round(s * 0.1);
            return sum + Math.max(0, grand - (b.paidAmount || 0));
          }, 0);

        // ── 통합 검색 필터: 고객명 / 입금자명 / 계좌번호 / 비고 ──
        const searchQ = depSearchQuery.trim();
        const filteredDeposits = bankTransactions
          .filter(t => {
            if (!t.isDeposit) return false;
            if (!searchQ) return true;
            const mappedCustName = customers.find(c => c.id === t.customerId)?.name || '';
            return (
              matchHangul(t.senderName, searchQ) ||
              matchHangul(mappedCustName, searchQ) ||
              (t.senderAccount || '').toLowerCase().includes(searchQ.toLowerCase()) ||
              matchHangul(t.memo, searchQ)
            );
          })
          .map(dep => ({ ...dep, balance: getDepositBalance(dep.id) }))
          .filter(dep => dep.balance > 0) // 0원이 된 입금 항목은 표시에서 제외
          .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate)); // 오래된 입금 우선 (FIFO)

        // 이번 수납 합계 계산
        let payAmount = 0;
        if (payMode === 'DEPOSIT') {
          payAmount = Object.values(depositLinkDraft).reduce((s, v) => s + (Number(v) || 0), 0);
        } else {
          payAmount = Number(cardAmount) || 0;
        }

        // 수납 후 계산 수치들
        const remainingBilling = Math.max(0, unpaid - payAmount); // 수납후 청구잔액
        const remainingCustUnpaid = Math.max(0, customerTotalUnpaid - payAmount); // 수납 후 미수납 잔액
        const isOverMatch = payAmount > unpaid;
        const isExactMatch = payAmount === unpaid && unpaid > 0;
        const isPartialMatch = payAmount > 0 && payAmount < unpaid;

        // 통장 가용 잔액 합계 및 수납 후 잔액 합계
        const availableTotal = filteredDeposits.filter(d => d.balance > 0).reduce((s, d) => s + d.balance, 0);
        const totalPostDepositBalance = filteredDeposits.reduce((s, d) => {
          const alloc = depositLinkDraft[d.id] || 0;
          return s + Math.max(0, d.balance - alloc);
        }, 0);

        // 카드 결제 공급가 / 부가세 자동 분리 계산
        const cardSupply = Math.round(payAmount / 1.1);
        const cardVat = payAmount - cardSupply;

        // 개별 입금건 [전액] 적용 핸들러 (남은 청구 필요액 또는 해당 건 잔액 한도 자동 채움)
        const applyFullDeposit = (depId: string, depBalance: number) => {
          if (depBalance <= 0) return;
          const otherAlloc = Object.entries(depositLinkDraft)
            .filter(([k]) => k !== depId)
            .reduce((s, [, v]) => s + (Number(v) || 0), 0);
          const needed = Math.max(0, unpaid - otherAlloc);
          const alloc = needed > 0 ? Math.min(depBalance, needed) : depBalance;
          setDepositLinkDraft(prev => ({ ...prev, [depId]: alloc }));
        };

        // 개별 입금건 [0원] 핸들러
        const removeDeposit = (depId: string) => {
          setDepositLinkDraft(prev => {
            const next = { ...prev };
            delete next[depId];
            return next;
          });
        };

        // 오래된 순 선입선출(FIFO) 자동 완납 배분
        const autoDistributeFifo = () => {
          const next: Record<string, number> = {};
          let rem = unpaid;
          for (const d of filteredDeposits) {
            if (d.balance <= 0 || rem <= 0) continue;
            const use = Math.min(d.balance, rem);
            next[d.id] = use;
            rem -= use;
          }
          setDepositLinkDraft(next);
        };

        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px'
          }}>
            <form onSubmit={handlePaySubmit} className="card" style={{ width: '100%', maxWidth: '820px', backgroundColor: 'var(--bg-card)', maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0', padding: '20px' }}>

              {/* 헤더 */}
              <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 className="card-title" style={{ marginBottom: '4px', fontSize: '18px' }}>수납 처리</h3>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    고객사: <strong style={{ color: 'var(--text-primary)' }}>{getCustName(custId || '')}</strong> — 청구번호: <strong>{billingNo}</strong>
                  </div>
                </div>
              </div>

              {/* 🌟 2개 탭 버튼 단일화: 통장입금액 수납 / 카드결제 */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '16px' }}>
                <button type="button" onClick={() => setPayMode('DEPOSIT')}
                  style={{
                    padding: '8px 20px', fontSize: '13px', fontWeight: '700', border: 'none', background: 'none', cursor: 'pointer',
                    borderBottom: payMode === 'DEPOSIT' ? '3px solid var(--primary)' : '3px solid transparent',
                    color: payMode === 'DEPOSIT' ? 'var(--primary)' : 'var(--text-secondary)'
                  }}>
                  통장입금액 수납 (Tab)
                </button>
                <button type="button" onClick={() => {
                  setPayMode('CARD');
                  setCardAmount(unpaid);
                }}
                  style={{
                    padding: '8px 20px', fontSize: '13px', fontWeight: '700', border: 'none', background: 'none', cursor: 'pointer',
                    borderBottom: payMode === 'CARD' ? '3px solid var(--primary)' : '3px solid transparent',
                    color: payMode === 'CARD' ? 'var(--primary)' : 'var(--text-secondary)'
                  }}>
                  카드결제 (Tab)
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>

                {/* ═══════════════ [탭 1: 통장입금액 수납] ═══════════════ */}
                {payMode === 'DEPOSIT' && (
                  <>
                    {/* 🌟 1. 상단 5단 실시간 정산 서머리 테이블 (이미지 1 표준) */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', border: '1px solid var(--border)', background: 'var(--bg-app)', borderRadius: '6px', overflow: 'hidden' }}>
                      <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '8px 6px', fontSize: '12px', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)' }}>미수납 잔액</th>
                          <th style={{ padding: '8px 6px', fontSize: '12px', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)' }}>청구액</th>
                          <th style={{ padding: '8px 6px', fontSize: '12px', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)', color: 'var(--primary)' }}>이번 수납액</th>
                          <th style={{ padding: '8px 6px', fontSize: '12px', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)' }}>수납후 청구잔액</th>
                          <th style={{ padding: '8px 6px', fontSize: '12px', whiteSpace: 'nowrap' }}>수납 후 미수납 잔액</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ fontWeight: '700', fontSize: '14px' }}>
                          <td style={{ padding: '10px 6px', borderRight: '1px solid var(--border)' }}>{availableTotal.toLocaleString()} 원</td>
                          <td style={{ padding: '10px 6px', borderRight: '1px solid var(--border)' }}>{billingGrandTotal.toLocaleString()} 원</td>
                          <td style={{ padding: '10px 6px', borderRight: '1px solid var(--border)', color: isOverMatch ? '#EF4444' : 'var(--primary)' }}>
                            {payAmount.toLocaleString()} 원
                          </td>
                          <td style={{ padding: '10px 6px', borderRight: '1px solid var(--border)', color: remainingBilling === 0 ? '#10B981' : isOverMatch ? '#EF4444' : 'var(--text-primary)' }}>
                            {isOverMatch ? `+${(payAmount - unpaid).toLocaleString()}원 초과` : `${remainingBilling.toLocaleString()} 원`}
                            {remainingBilling === 0 && !isOverMatch && <span style={{ fontSize: '11px', color: '#10B981', marginLeft: '4px' }}> (0 원)</span>}
                          </td>
                          <td style={{ padding: '10px 6px', color: '#10B981' }}>{totalPostDepositBalance.toLocaleString()} 원</td>
                        </tr>
                      </tbody>
                    </table>

                    {/* ── 검색 필터 & 선입선출 자동수납 ── */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div style={{ display: 'flex', gap: '8px', flex: 1, maxWidth: '450px' }}>
                        <input type="text" value={depSearchQuery} onChange={e => {
                          setDepSearchQuery(e.target.value);
                          setDepositLinkDraft({});
                        }}
                          placeholder="고객명 · 입금자명 · 계좌번호 · 비고 검색"
                          style={{ flex: 1, padding: '6px 10px', fontSize: '12px' }} />
                        <button type="button" onClick={() => { setDepSearchQuery(''); setDepositLinkDraft({}); }}
                          style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}>
                          초기화
                        </button>
                      </div>

                      {filteredDeposits.filter(d => d.balance > 0).length > 0 && (
                        <button type="button" onClick={autoDistributeFifo}
                          style={{ padding: '6px 12px', borderRadius: '6px', background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap' }}>
                          ⚡ 선입선출 자동수납
                        </button>
                      )}
                    </div>

                    {/* 🌟 2. 입금 내역 대사 그리드 테이블 (이미지 1 표준) */}
                    {filteredDeposits.length === 0 ? (
                      <div style={{ padding: '24px', borderRadius: '8px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#EF4444', fontSize: '13px', textAlign: 'center' }}>
                        조회된 통장 입금 내역이 없습니다.<br />
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>검색어를 초기화하거나 카드결제 탭을 이용해 주십시오.</span>
                      </div>
                    ) : (
                      <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                        <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                            <thead>
                              <tr style={{ background: 'var(--bg-app)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                                <th style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)', width: '95px' }}>입금일</th>
                                <th style={{ padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)' }}>비고</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)', width: '110px' }}>입금액</th>
                                <th style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)', width: '90px' }}>버튼배치</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)', width: '120px' }}>수납액</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', width: '110px' }}>수납후잔액</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredDeposits.map(dep => {
                                const allocatedAmt = depositLinkDraft[dep.id] || 0;
                                const postBal = Math.max(0, dep.balance - allocatedAmt);
                                const isAllocated = allocatedAmt > 0;

                                return (
                                  <tr key={dep.id} style={{ borderBottom: '1px solid var(--border)', background: isAllocated ? 'rgba(99,102,241,0.06)' : undefined }}>
                                    {/* 입금일 */}
                                    <td style={{ padding: '7px 10px', textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)' }}>
                                      {dep.transactionDate.split(' ')[0]}
                                    </td>
                                    {/* 비고 */}
                                    <td style={{ padding: '7px 10px', textAlign: 'left', borderRight: '1px solid var(--border)' }}>
                                      <span style={{ fontWeight: '600' }}>{dep.senderName}</span>
                                      {dep.memo && <span style={{ color: 'var(--text-secondary)', marginLeft: '6px', fontSize: '11px' }}>({dep.memo})</span>}
                                    </td>
                                    {/* 입금액 (가용잔액) */}
                                    <td style={{ padding: '7px 10px', textAlign: 'right', borderRight: '1px solid var(--border)', fontWeight: '600', whiteSpace: 'nowrap' }}>
                                      {dep.balance.toLocaleString()} 원
                                    </td>
                                    {/* 버튼배치 (전액 / 0원) */}
                                    <td style={{ padding: '7px 10px', textAlign: 'center', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                                      <div style={{ display: 'inline-flex', gap: '4px' }}>
                                        <button type="button"
                                          onClick={() => applyFullDeposit(dep.id, dep.balance)}
                                          disabled={dep.balance <= 0}
                                          style={{ padding: '2px 6px', fontSize: '11px', borderRadius: '4px', background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: '600' }}>
                                          전액
                                        </button>
                                        <button type="button"
                                          onClick={() => removeDeposit(dep.id)}
                                          style={{ padding: '2px 6px', fontSize: '11px', borderRadius: '4px', background: 'var(--bg-app)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                                          0원
                                        </button>
                                      </div>
                                    </td>
                                    {/* 수납액 인풋 */}
                                    <td style={{ padding: '4px 8px', textAlign: 'right', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                                      <input type="number"
                                        value={allocatedAmt || ''}
                                        max={dep.balance}
                                        min={0}
                                        onChange={e => {
                                          const v = Math.min(parseInt(e.target.value) || 0, dep.balance);
                                          if (v <= 0) removeDeposit(dep.id);
                                          else setDepositLinkDraft(prev => ({ ...prev, [dep.id]: v }));
                                        }}
                                        style={{ width: '100px', padding: '3px 6px', fontSize: '12px', textAlign: 'right', borderRadius: '4px', border: `1px solid ${isAllocated ? 'var(--primary)' : 'var(--border)'}` }}
                                        placeholder="0"
                                      />
                                    </td>
                                    {/* 수납후잔액 */}
                                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: '600', color: postBal === 0 ? 'var(--text-secondary)' : '#10B981', whiteSpace: 'nowrap' }}>
                                      {postBal.toLocaleString()} 원
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr style={{ background: 'var(--bg-app)', borderTop: '2px solid var(--border)', fontWeight: '700' }}>
                                <td colSpan={2} style={{ padding: '8px 10px', textAlign: 'center', borderRight: '1px solid var(--border)' }}>합계</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', borderRight: '1px solid var(--border)' }}>{availableTotal.toLocaleString()} 원</td>
                                <td style={{ borderRight: '1px solid var(--border)' }}></td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', borderRight: '1px solid var(--border)', color: 'var(--primary)' }}>{payAmount.toLocaleString()} 원</td>
                                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#10B981' }}>{totalPostDepositBalance.toLocaleString()} 원</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ═══════════════ [탭 2: 카드결제] ═══════════════ */}
                {payMode === 'CARD' && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '10px 14px', background: 'var(--bg-app)', width: '170px', textAlign: 'left', fontSize: '13px', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            결제일
                          </th>
                          <td style={{ padding: '8px 14px' }}>
                            <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} required style={{ padding: '6px 10px', fontSize: '13px' }} />
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '10px 14px', background: 'var(--bg-app)', textAlign: 'left', fontSize: '13px', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            카드전표번호(승인번호) *
                          </th>
                          <td style={{ padding: '8px 14px' }}>
                            <input type="text" value={cardApprovalNo} onChange={e => setCardApprovalNo(e.target.value)} placeholder="승인번호 8자리 입력 (예: 30012345)" required style={{ width: '100%', maxWidth: '320px', padding: '6px 10px', fontSize: '13px' }} />
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '10px 14px', background: 'var(--bg-app)', textAlign: 'left', fontSize: '13px', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            결제금액 *
                          </th>
                          <td style={{ padding: '8px 14px' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', maxWidth: '320px' }}>
                              <input type="number" value={cardAmount || ''} onChange={e => setCardAmount(parseInt(e.target.value) || 0)} required style={{ flex: 1, padding: '6px 10px', fontSize: '14px', fontWeight: '700' }} />
                              <button type="button" onClick={() => setCardAmount(unpaid)} style={{ padding: '6px 10px', fontSize: '11px', borderRadius: '4px', background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: '600' }}>
                                전액
                              </button>
                              <button type="button" onClick={() => setCardAmount(0)} style={{ padding: '6px 10px', fontSize: '11px', borderRadius: '4px', background: 'var(--bg-app)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                0원
                              </button>
                            </div>
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '10px 14px', background: 'var(--bg-app)', textAlign: 'left', fontSize: '13px', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            공급가 (자동)
                          </th>
                          <td style={{ padding: '10px 14px', fontSize: '14px', fontWeight: '600' }}>
                            {cardSupply.toLocaleString()} 원
                          </td>
                        </tr>
                        <tr>
                          <th style={{ padding: '10px 14px', background: 'var(--bg-app)', textAlign: 'left', fontSize: '13px', borderRight: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            부가세 (자동)
                          </th>
                          <td style={{ padding: '10px 14px', fontSize: '14px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                            {cardVat.toLocaleString()} 원
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 공통 비고 */}
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>비고</label>
                  <input type="text" value={payMemo} onChange={e => setPayMemo(e.target.value)}
                    placeholder={payMode === 'DEPOSIT' ? '(통장입금 연동 자동 기록)' : '예: 법인카드 결제'} />
                </div>
              </div>

              {/* 푸터 액션 버튼 */}
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowPayModal(false)}>취소 (ESC)</button>
                <button 
                  ref={paySubmitBtnRef}
                  type="submit" 
                  className="btn-primary"
                  disabled={payAmount <= 0 || (payMode === 'DEPOSIT' && isOverMatch) || (payMode === 'CARD' && !cardApprovalNo.trim())}
                  style={{ fontWeight: 'bold' }}
                >
                  {isExactMatch ? '완납 처리 완료' : isPartialMatch ? '부분 수납 처리' : '수납 완료 처리'}
                </button>
              </div>
            </form>
          </div>
        );
      })()}




      {/* ERP 표준 거래명세서 메일 발송 모달 */}
      {showMailModal && (() => {
        const targetBilling = billings.find(b => b.id === mailBillingId);
        const targetDetails = billingDetails.filter(d => d.billingId === mailBillingId);
        const targetCust = customers.find(c => c.id === targetBilling?.customerId);
        const targetContract = contracts.find(c => c.id === targetBilling?.contractId);
        
        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px'
          }}>
            <form onSubmit={handleSendStatementSubmit} className="card" style={{ width: '100%', maxWidth: '680px', backgroundColor: 'var(--bg-card)', padding: '24px', borderRadius: '12px', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <h3 className="card-title" style={{ margin: 0, fontSize: '17px', fontWeight: '700' }}>
                  📄 {currentTenant?.tradeName || '표준'} 거래명세서 이메일 발송
                </h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>메일 제목 *</label>
                  <input
                    type="text"
                    value={mailSubject}
                    onChange={e => setMailSubject(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                    수신인 이메일 (To) * <span style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 'normal' }}>(고객대표 및 담당자 이메일 자동 채움 / 자유 수정 및 쉼표 추가 가능)</span>
                  </label>
                  <input
                    type="text"
                    value={mailTo}
                    onChange={e => setMailTo(e.target.value)}
                    placeholder="email1@company.com, email2@company.com"
                    required
                    style={{ width: '100%', padding: '8px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                    참조인 이메일 (CC) <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 'normal' }}>(선택 입력 / 쉼표로 다수 지정 가능)</span>
                  </label>
                  <input
                    type="text"
                    value={mailCc}
                    onChange={e => setMailCc(e.target.value)}
                    placeholder="cc1@company.com, cc2@company.com"
                    style={{ width: '100%', padding: '8px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}
                  />
                </div>

                <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', border: '1px dashed var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontWeight: '600' }}>💡 거래명세서 메일 자동 생성 안내</span>
                  <span>- 발송 시 표준 거래명세서 양식(공급자/공급받는자 정보, 세부 품목별 날짜/적용단가/공급가액/부가세)이 메일 본문에 100% 자동 생성되어 전달됩니다.</span>
                </div>
              </div>


              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowMailModal(false)}>취소</button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    const site = sites.find(s => s.id === targetContract?.siteId);
                    const salesperson = users.find((u: any) => u.id === targetContract?.salespersonId);
                    const custName = targetCust?.name || '고객사';
                    const sName = site?.name || '현장';
                    const ym = targetBilling?.billingYm || '';
                    const fileName = `${custName}_${sName}_${ym}`;
                    const enrichedDetails = targetDetails.map(d => {
                      const ca = contractAssets.find(cAsset => cAsset.id === d.contractAssetId);
                      const asset = ca?.assetId 
                        ? assets.find(a => a.id === ca.assetId) 
                        : (d.assetId ? assets.find(a => a.id === d.assetId) : null);
                      return {
                        ...d,
                        modelName: asset?.modelName || ca?.expectedModel || d.itemName,
                        assetNo: asset?.assetNo ? asset.assetNo : (ca?.assetId ? ca.assetId : ((d as any).assetNo || ''))
                      };
                    });

                    try {
                      await exportTransactionStatementExcel(
                        targetBilling,
                        enrichedDetails,
                        targetCust,
                        targetContract,
                        site,
                        salesperson,
                        fileName,
                        );
                    } catch (e: any) {
                      showErrorModal('엑셀 거래명세서 생성 실패: ' + (e?.message || String(e)));
                    }
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'bold' }}
                >
                  <FileText size={14} /> 엑셀 다운로드 (.xlsx)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => downloadStatementPdf()}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 'bold' }}
                >
                  <Download size={14} /> PDF 거래명세서 다운로드
                </button>
                <button type="submit" className="btn-success" disabled={isSending} style={{ fontWeight: 'bold' }}>
                  {isSending ? '발송 중...' : <><Send size={14} /> PDF 거래명세서 이메일 전송</>}
                </button>
              </div>
            </form>
          </div>
        );
      })()}

      {/* 🔄 청구 수정 및 재생성 모달 (Regenerate Modal) */}
      {showRegenerateModal && (() => {
        const targetB = billings.find(b => b.id === regenBillingId);
        const targetCust = customers.find(c => c.id === targetB?.customerId);
        const totalCalcAmount = regenDetails.reduce((sum, d) => sum + (d.amount || ((d.quantity || 1) * (d.unitPrice || 0))), 0);

        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px'
          }}>
            <form onSubmit={handleRegenerateSubmit} className="card" style={{ width: '100%', maxWidth: '780px', backgroundColor: 'var(--bg-card)', maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', borderRadius: '12px' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <div>
                  <h3 className="card-title" style={{ margin: 0, fontSize: '17px', fontWeight: '700' }}>
                    🔄 청구서 내역 수정 및 재생성
                  </h3>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    고객사: <strong>{targetCust?.name || '고객사'}</strong> | 기존 청구: <strong style={{ color: 'var(--text-muted)' }}>{targetB?.id}</strong> ({targetB?.billingYm})
                  </div>
                </div>
                <span className="badge badge-warning">기존 건 자동 취소 후 재발행</span>
              </div>

              {/* 청구 연월 및 발행일자 수정 패널 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: '12px', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)' }}>청구귀속월 (YYYY-MM)</label>
                  <input
                    type="month"
                    value={regenBillingYm}
                    onChange={e => setRegenBillingYm(e.target.value)}
                    required
                    style={{ width: '100%', padding: '6px 8px', fontSize: '12.5px', borderRadius: '5px', border: '1px solid var(--border-color)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)' }}>청구 발행일자</label>
                  <input
                    type="date"
                    value={regenBillingDate}
                    onChange={e => setRegenBillingDate(e.target.value)}
                    required
                    style={{ width: '100%', padding: '6px 8px', fontSize: '12.5px', borderRadius: '5px', border: '1px solid var(--border-color)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)' }}>수정 재생성 사유</label>
                  <input
                    type="text"
                    value={regenMemo}
                    onChange={e => setRegenMemo(e.target.value)}
                    placeholder="예: 고객 요청에 따른 운송료 할인 조정"
                    style={{ width: '100%', padding: '6px 8px', fontSize: '12.5px', borderRadius: '5px', border: '1px solid var(--border-color)' }}
                  />
                </div>
              </div>

              {/* 세부 청구 품목 리스트 & 수정 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '13px', fontWeight: '700', margin: 0 }}>
                    📋 청구 항목 목록 ({regenDetails.length}건)
                  </label>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setRegenDetails([...regenDetails, {
                        contractAssetId: undefined,
                        itemName: '기타 추가/할인 항목',
                        quantity: 1,
                        unitPrice: 0,
                        amount: 0,
                        description: '수동 추가 항목'
                      }]);
                    }}
                    style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Plus size={12} /> + 항목 추가
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '280px', overflowY: 'auto', paddingRight: '4px' }}>
                  {regenDetails.map((det, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '8px', alignItems: 'center', padding: '10px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <input
                          type="text"
                          value={det.itemName}
                          onChange={e => {
                            const updated = [...regenDetails];
                            updated[idx].itemName = e.target.value;
                            setRegenDetails(updated);
                          }}
                          placeholder="항목명"
                          style={{ padding: '4px 8px', fontSize: '12px', fontWeight: '600', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                        />
                        <input
                          type="text"
                          value={det.description || ''}
                          onChange={e => {
                            const updated = [...regenDetails];
                            updated[idx].description = e.target.value;
                            setRegenDetails(updated);
                          }}
                          placeholder="적용 기간/상세 설명"
                          style={{ padding: '3px 6px', fontSize: '11px', color: 'var(--text-secondary)', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block' }}>수량</label>
                        <input
                          type="number"
                          value={det.quantity || 1}
                          onChange={e => {
                            const q = parseInt(e.target.value) || 1;
                            const updated = [...regenDetails];
                            updated[idx].quantity = q;
                            updated[idx].amount = q * (updated[idx].unitPrice || 0);
                            setRegenDetails(updated);
                          }}
                          style={{ width: '100%', padding: '4px 6px', fontSize: '12px', textAlign: 'right', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block' }}>단가(원)</label>
                        <input
                          type="number"
                          value={det.unitPrice ?? 0}
                          onChange={e => {
                            const p = parseInt(e.target.value) || 0;
                            const updated = [...regenDetails];
                            updated[idx].unitPrice = p;
                            updated[idx].amount = (updated[idx].quantity || 1) * p;
                            setRegenDetails(updated);
                          }}
                          style={{ width: '100%', padding: '4px 6px', fontSize: '12px', textAlign: 'right', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                        />
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block' }}>금액</label>
                        <strong style={{ fontSize: '13px', color: (det.amount || 0) < 0 ? '#dc2626' : 'var(--text-primary)' }}>
                          {(det.amount || ((det.quantity || 1) * (det.unitPrice || 0))).toLocaleString()}원
                        </strong>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setRegenDetails(regenDetails.filter((_, i) => i !== idx));
                        }}
                        style={{ padding: '4px 8px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}
                        title="항목 삭제"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 총액 요약 바 */}
              <div style={{ padding: '14px 18px', backgroundColor: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>재생성 최종 청구 합계</span>
                  <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>(VAT 별도 공급가액 기준)</span>
                </div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--primary)' }}>
                  {totalCalcAmount.toLocaleString()}원
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowRegenerateModal(false)}>
                  취소
                </button>
                <button type="submit" className="btn-primary" disabled={isRegenerating || regenDetails.length === 0} style={{ fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <RotateCcw size={14} />
                  {isRegenerating ? '재생성 처리 중...' : '수정사항 반영 청구서 재생성'}
                </button>
              </div>

            </form>
          </div>
        );
      })()}

      {/* 🌟 유료 비용 영업 청구 면제 승인 모달 */}
      {waiverModalTarget && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1100,
          padding: '20px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '520px',
            margin: 0,
            padding: '24px',
            backgroundColor: 'var(--bg-card)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
            borderRadius: '12px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>🚫</span>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#dc2626' }}>
                  유료 비용 영업 청구 면제 승인
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setWaiverModalTarget(null)}
                style={{ background: 'transparent', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>

            {/* 대상 항목 요약 카드 */}
            <div style={{ backgroundColor: 'var(--bg-app)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>면제 대상 구분:</span>
                <strong style={{ color: waiverModalTarget.type === 'REPAIR' ? '#2563eb' : '#ea580c' }}>
                  {waiverModalTarget.type === 'REPAIR' ? '정비 / 현장 AS' : '화물 운송료'}
                </strong>
              </div>
              {waiverModalTarget.customerName && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>고객사명:</span>
                  <strong>{waiverModalTarget.customerName}</strong>
                </div>
              )}
              {waiverModalTarget.contractNo && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>계약번호:</span>
                  <span>{waiverModalTarget.contractNo}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>항목 상세:</span>
                <span style={{ fontWeight: 600 }}>{waiverModalTarget.title}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', borderTop: '1px dashed var(--border-color)', paddingTop: '6px', marginTop: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>원 발생 비용 (청구 대상액):</span>
                <strong style={{ color: 'var(--text-primary)' }}>₩{waiverModalTarget.originalCost.toLocaleString()}원</strong>
              </div>
            </div>

            {/* 면제 정보 입력 폼 (헌장 3.4 세로 스택) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
              {/* 면제 금액 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  면제 금액 (원)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="number"
                    value={waiverInputAmount}
                    onChange={e => setWaiverInputAmount(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ flex: 1, padding: '8px 12px', fontSize: '14px', fontWeight: 800, border: '1px solid var(--border-color)', borderRadius: '6px', textAlign: 'right', color: '#dc2626' }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>원</span>
                  {waiverInputAmount !== waiverModalTarget.originalCost && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setWaiverInputAmount(waiverModalTarget.originalCost)}
                      style={{ fontSize: '11px', padding: '6px 10px', whiteSpace: 'nowrap' }}
                    >
                      전액 복원
                    </button>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  * 전액 면제 또는 고객 협의에 따른 일부 감면 금액을 입력하십시오.
                </div>
              </div>

              {/* 면제 사유 카테고리 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  면제 사유 구분
                </label>
                <select
                  value={waiverInputCategory}
                  onChange={e => setWaiverInputCategory(e.target.value)}
                  style={{ padding: '8px 10px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                >
                  <option value="단골 고객 우대">단골 고객 우대</option>
                  <option value="영업 관계 유지 협의">영업 관계 유지 협의</option>
                  <option value="장비 초기 클레임 보상">장비 초기 클레임 보상</option>
                  <option value="경미 파손 자체 흡수">경미 파손 자체 흡수</option>
                  <option value="신규 계약 유치 프로모션">신규 계약 유치 프로모션</option>
                  <option value="현장 사정 참작 감면">현장 사정 참작 감면</option>
                  <option value="기타">기타 (직접 입력)</option>
                </select>
              </div>

              {/* 세부 사유 메모 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  상세 사유 및 비고
                </label>
                <input
                  type="text"
                  placeholder="예: 발주사 현장소장 요청 합의, 차월 계약 연장 조건 등..."
                  value={waiverInputCustomReason}
                  onChange={e => setWaiverInputCustomReason(e.target.value)}
                  style={{ padding: '8px 10px', fontSize: '13px', border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* 면제 처리자 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  면제 처리 승인자
                </label>
                <input
                  type="text"
                  disabled
                  value={`${currentUser?.name || '영업담당'} (${currentUser?.department || '영업부'})`}
                  style={{ padding: '7px 10px', fontSize: '12px', border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-app)', color: 'var(--text-secondary)' }}
                />
              </div>
            </div>

            {/* 하단 버튼 바 (헌장 3.5 Z-패턴 4단계) */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setWaiverModalTarget(null)}
                disabled={isWaiverSubmitting}
              >
                취소
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleConfirmWaiverModal}
                disabled={isWaiverSubmitting || waiverInputAmount <= 0}
                style={{ backgroundColor: '#dc2626', borderColor: '#dc2626', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {isWaiverSubmitting ? '면제 처리 중...' : `🚫 ₩${waiverInputAmount.toLocaleString()}원 영업 면제 확정`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
