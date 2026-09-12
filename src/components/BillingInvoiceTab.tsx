// @ts-nocheck
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FileText, Plus, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle, AlertCircle, Clock, XCircle, Download,
  Layers, CreditCard, RotateCcw, Printer, Filter, CheckSquare, Square,
  Building, Calendar, DollarSign, ArrowRight, ShieldAlert, Sparkles
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useApp } from '../context/AppContext';
import {
  generateInvoices,
  consolidateExistingBillings,
  consolidateSelectedBillings,
  cancelInvoice,
  fetchInvoices,
  fetchInvoiceDetail,
  type InvoiceGroupBy
} from '../services/invoiceEngine';
import {
  generateTransactionStatementExcel,
  generateTransactionStatementPdf,
  type TransactionStatementPdfData,
  type TransactionStatementItem
} from '../services/excelTemplateEngine';
import type { BillingInvoice, Billing, BillingDetail } from '../services/db';
import { matchHangul, sortCustomersByName } from '../utils/hangulSearch';

// ── 상태 배지 ──
function StatusBadge({ status }: { status: string }) {
  const badgeClass = status === 'PAID' ? 'badge-success'
    : status === 'PARTIAL' ? 'badge-warning'
    : status === 'ISSUED' ? 'badge-primary'
    : status === 'CANCELLED' ? 'badge-danger'
    : 'badge-secondary';
  const label = status === 'PAID' ? '수납완료'
    : status === 'PARTIAL' ? '부분수납'
    : status === 'ISSUED' ? '발행완료'
    : status === 'CANCELLED' ? '통합취소'
    : '초안';
  return (
    <span className={`badge ${badgeClass}`} style={{ whiteSpace: 'nowrap' }}>{label}</span>
  );
}

// ── 품목 구분 배지 ──
function CategoryBadge({ category }: { category: 'RENTAL' | 'REPAIR' | 'TRANSPORT' | 'OTHER' }) {
  if (category === 'REPAIR') {
    return (
      <span style={{
        padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
        backgroundColor: '#fed7aa', color: '#c2410c', whiteSpace: 'nowrap'
      }}>
        수리비
      </span>
    );
  }
  if (category === 'TRANSPORT') {
    return (
      <span style={{
        padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
        backgroundColor: '#e9d5ff', color: '#7e22ce', whiteSpace: 'nowrap'
      }}>
        운반비
      </span>
    );
  }
  if (category === 'OTHER') {
    return (
      <span style={{
        padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
        backgroundColor: '#e2e8f0', color: '#475569', whiteSpace: 'nowrap'
      }}>
        기타
      </span>
    );
  }
  return (
    <span style={{
      padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
      backgroundColor: '#bfdbfe', color: '#1d4ed8', whiteSpace: 'nowrap'
    }}>
      렌탈료
    </span>
  );
}

// ── 금액 포맷 ──
const fmtAmt = (n: number) => n == null ? '-' : `₩${Number(n).toLocaleString()}`;

// ── 숫자 to 한글 금액 ──
function numberToKoreanAmount(num: number): string {
  if (!num || isNaN(num) || num <= 0) return '영';
  const units = ['', '만', '억', '조'];
  const smallUnits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const digits = ['', '십', '백', '천'];

  let result = '';
  let unitIdx = 0;
  let temp = Math.floor(num);

  while (temp > 0) {
    const chunk = temp % 10000;
    if (chunk > 0) {
      let chunkStr = '';
      let cTemp = chunk;
      for (let i = 0; i < 4; i++) {
        const d = cTemp % 10;
        if (d > 0) {
          chunkStr = smallUnits[d] + digits[i] + chunkStr;
        }
        cTemp = Math.floor(cTemp / 10);
      }
      result = chunkStr + units[unitIdx] + ' ' + result;
    }
    temp = Math.floor(temp / 10000);
    unitIdx++;
  }
  return result.trim();
}

export const BillingInvoiceTab: React.FC = () => {
  const {
    showSuccessToast, showErrorModal, customers, billings, billingDetails,
    contracts, sites, receivables
  } = useApp();

  // ── 뷰 모드: STUDIO(2분할 워크벤치) vs HISTORY(발행 이력 대장) ──
  const [viewMode, setViewMode] = useState<'STUDIO' | 'HISTORY'>('STUDIO');

  // ── 조회 조건 (Scope) ──
  const initialYm = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [selectedYm, setSelectedYm] = useState<string>(initialYm);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [groupBy, setGroupBy] = useState<InvoiceGroupBy>('CUSTOMER');
  const [customerSearchQuery, setCustomerSearchQuery] = useState<string>('');

  // ── 스튜디오 작업대 상태 ──
  const [itemCategoryFilter, setItemCategoryFilter] = useState<'ALL' | 'RENTAL' | 'REPAIR' | 'TRANSPORT'>('ALL');
  const [selectedBillingIds, setSelectedBillingIds] = useState<string[]>([]);
  const [invoiceDueDate, setInvoiceDueDate] = useState<string>('');
  const [invoiceMemo, setInvoiceMemo] = useState<string>('');
  const [isIssuing, setIsIssuing] = useState<boolean>(false);

  // ── 발행 이력 상태 ──
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('ALL');
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<BillingInvoice | null>(null);
  const [isConsolidating, setIsConsolidating] = useState(false);

  // A4 거래명세서 캔버스 인쇄 참조
  const printableCanvasRef = useRef<HTMLDivElement>(null);

  // ── 청구서통합 목록 로드 (DB/Supabase) ──
  const loadInvoices = useCallback(async () => {
    setIsLoadingInvoices(true);
    try {
      const data = await fetchInvoices(selectedYm || undefined);
      setInvoices(data);
    } catch (e: any) {
      showErrorModal?.(`청구서통합 조회 실패: ${e.message}`);
    } finally {
      setIsLoadingInvoices(false);
    }
  }, [selectedYm, showErrorModal]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  // 고객사 목록 검색 필터링 (초성검색 지원 및 가나다 오름차순 정렬)
  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    if (!customerSearchQuery.trim()) return sortCustomersByName(customers);
    const q = customerSearchQuery.trim();
    const list = customers.filter(c =>
      matchHangul(c.name || '', q) ||
      matchHangul(c.businessNumber || '', q) ||
      matchHangul(c.code || '', q) ||
      matchHangul(c.representativeName || (c as any).representative || '', q)
    );
    return sortCustomersByName(list);
  }, [customers, customerSearchQuery]);

  // 검색 시 또는 첫 진입 시 선택된 고객사 자동 동기화
  useEffect(() => {
    if (filteredCustomers.length > 0) {
      const exists = filteredCustomers.some(c => c.id === selectedCustomerId);
      if (!exists) {
        setSelectedCustomerId(filteredCustomers[0].id);
      }
    } else if (customerSearchQuery.trim()) {
      setSelectedCustomerId('');
    }
  }, [filteredCustomers, selectedCustomerId, customerSearchQuery]);

  // 고객사 변경 시 납기일 기본값 자동 세팅
  useEffect(() => {
    if (!selectedCustomerId || !customers) return;
    const cust = customers.find(c => c.id === selectedCustomerId);
    if (cust) {
      const dueDay = cust.paymentDueDay || 25;
      const today = new Date();
      const yr = selectedYm ? parseInt(selectedYm.slice(0, 4), 10) : today.getFullYear();
      const mo = selectedYm ? parseInt(selectedYm.slice(5, 7), 10) : today.getMonth() + 1;
      const dStr = String(Math.min(dueDay, 28)).padStart(2, '0');
      setInvoiceDueDate(`${yr}-${String(mo).padStart(2, '0')}-${dStr}`);
    }
    // 고객사 변경 시 선택 초기화
    setSelectedBillingIds([]);
  }, [selectedCustomerId, selectedYm, customers]);

  // ── 미통합 청구서(unconsolidated billings) 집계 ──
  // invoiceId가 없거나 null/빈값인 청구서 중 현재 고객사 및 귀속월 일치 대상
  const unconsolidatedBillings = useMemo(() => {
    if (!billings) return [];
    return billings.filter(b => {
      // 이미 인보이스에 묶인 건 배제
      if (b.invoiceId && b.invoiceId.trim() !== '') return false;
      // 고객사 일치
      if (selectedCustomerId && b.customerId !== selectedCustomerId) return false;
      // 귀속월 일치 (지정된 경우)
      if (selectedYm && b.billingYm !== selectedYm) return false;
      // 취소된 청구 제외
      if (b.status === 'CANCELLED') return false;
      return true;
    }).map(b => {
      // 품목 카테고리 분석
      const details = (billingDetails || []).filter(d => d.billingId === b.id);
      let category: 'RENTAL' | 'REPAIR' | 'TRANSPORT' | 'OTHER' = 'RENTAL';
      if (details.some(d => d.itemCategory === 'REPAIR') || b.memo?.includes('수리')) {
        category = 'REPAIR';
      } else if (details.some(d => d.itemCategory === 'TRANSPORT') || b.memo?.includes('운반') || b.memo?.includes('배차')) {
        category = 'TRANSPORT';
      } else if (details.some(d => d.itemCategory === 'OTHER')) {
        category = 'OTHER';
      }

      // 계약 및 현장 정보 매핑
      const contract = contracts?.find(c => c.id === b.contractId);
      const site = sites?.find(s => s.id === contract?.siteId);
      const siteName = site?.name || (b as any).siteName || contract?.siteName || '-';

      // 품목 요약 텍스트
      let itemSummary = '';
      if (details.length > 0) {
        itemSummary = details
          .map(d => (d.itemName || d.description || '품목').replace(/\(가상\)/g, '').replace(/\s+/g, ' ').trim())
          .join(', ');
        if (itemSummary.length > 28) itemSummary = itemSummary.slice(0, 28) + '...';
      } else {
        itemSummary = category === 'REPAIR' ? '장비 파손 수리비'
          : category === 'TRANSPORT' ? '장비 배차 운반비'
          : contract ? `렌탈료 (${contract.contractNo || contract.id})` : '렌탈료 청구';
      }

      const totalAmt = b.totalAmount || 0;
      const vatAmt = b.vatAmount != null ? b.vatAmount : Math.floor(totalAmt * 0.1);
      const grandAmt = totalAmt + vatAmt;

      return {
        ...b,
        category,
        contract,
        siteName,
        itemSummary,
        calculatedVat: vatAmt,
        calculatedGrand: grandAmt,
        details
      };
    });
  }, [billings, billingDetails, contracts, sites, selectedCustomerId, selectedYm]);

  // 카테고리별 건수 및 미청구 부가비용 감지
  const categoryCounts = useMemo(() => {
    const counts = { ALL: unconsolidatedBillings.length, RENTAL: 0, REPAIR: 0, TRANSPORT: 0, OTHER: 0 };
    unconsolidatedBillings.forEach(b => {
      counts[b.category] = (counts[b.category] || 0) + 1;
    });
    return counts;
  }, [unconsolidatedBillings]);

  // 부가비용 청구서 목록 (수리비 + 운반비)
  const pendingExtraBillings = useMemo(() => {
    return unconsolidatedBillings.filter(b => b.category === 'REPAIR' || b.category === 'TRANSPORT');
  }, [unconsolidatedBillings]);

  // 카테고리 필터링된 미통합 청구 목록
  const displayedBillings = useMemo(() => {
    if (itemCategoryFilter === 'ALL') return unconsolidatedBillings;
    return unconsolidatedBillings.filter(b => b.category === itemCategoryFilter);
  }, [unconsolidatedBillings, itemCategoryFilter]);

  // ── 체크박스 조작 ──
  const isAllSelected = displayedBillings.length > 0 &&
    displayedBillings.every(b => selectedBillingIds.includes(b.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      const displayedIds = new Set(displayedBillings.map(b => b.id));
      setSelectedBillingIds(prev => prev.filter(id => !displayedIds.has(id)));
    } else {
      const newIds = new Set([...selectedBillingIds, ...displayedBillings.map(b => b.id)]);
      setSelectedBillingIds(Array.from(newIds));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedBillingIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // 원클릭 부가비용 동반선택 핸들러
  const handleSelectAllExtraCharges = () => {
    const extraIds = pendingExtraBillings.map(b => b.id);
    setSelectedBillingIds(prev => Array.from(new Set([...prev, ...extraIds])));
    showSuccessToast?.(`부가비용 청구 ${extraIds.length}건이 동반 선택되었습니다.`);
  };

  // ── 선택된 청구서 집계 및 실시간 A4 거래명세서 품목 조립 ──
  const selectedBillingsData = useMemo(() => {
    return unconsolidatedBillings.filter(b => selectedBillingIds.includes(b.id));
  }, [unconsolidatedBillings, selectedBillingIds]);

  // 대차대조 집계
  const accountingSummary = useMemo(() => {
    const supplyAmount = selectedBillingsData.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
    const vatAmount = Math.floor(supplyAmount * 0.1);
    const grandTotal = supplyAmount + vatAmount;

    // 카테고리별 소계
    const rentalAmount = selectedBillingsData.filter(b => b.category === 'RENTAL').reduce((sum, b) => sum + (b.totalAmount || 0), 0);
    const repairAmount = selectedBillingsData.filter(b => b.category === 'REPAIR').reduce((sum, b) => sum + (b.totalAmount || 0), 0);
    const transportAmount = selectedBillingsData.filter(b => b.category === 'TRANSPORT').reduce((sum, b) => sum + (b.totalAmount || 0), 0);

    // 대차 차액 검증 (수학적 항등식: 공급가 - (렌탈+수리+운반) == 0)
    const categorySum = rentalAmount + repairAmount + transportAmount;
    const balanceDifference = supplyAmount - categorySum;

    return {
      count: selectedBillingsData.length,
      supplyAmount,
      vatAmount,
      grandTotal,
      rentalAmount,
      repairAmount,
      transportAmount,
      balanceDifference
    };
  }, [selectedBillingsData]);

  // A4 명세서 11행 그리드 데이터 구성
  const statementItems = useMemo(() => {
    const items: Array<{
      date: string;
      itemName: string;
      spec: string;
      qty: number;
      unitPrice: number;
      amount: number;
      vat: number;
      memo: string;
    }> = [];

    selectedBillingsData.forEach(b => {
      if (b.details && b.details.length > 0) {
        b.details.forEach(d => {
          const supply = d.amount || (d.unitPrice * d.quantity) || 0;
          const vat = d.vatAmount != null ? d.vatAmount : Math.floor(supply * 0.1);
          const cleanItemName = (d.itemName || d.description || '품목').replace(/\(가상\)/g, '').replace(/\s+/g, ' ').trim();
          items.push({
            date: b.billingDate ? b.billingDate.slice(5) : '-',
            itemName: cleanItemName,
            spec: d.spec || d.assetNo || b.siteName || '-',
            qty: d.quantity || 1,
            unitPrice: d.unitPrice || supply,
            amount: supply,
            vat: vat,
            memo: d.memo || b.contract?.contractNo || ''
          });
        });
      } else {
        const supply = b.totalAmount || 0;
        const vat = Math.floor(supply * 0.1);
        const name = b.category === 'REPAIR' ? '장비 파손 수리비'
          : b.category === 'TRANSPORT' ? '장비 배차 운반비'
          : `렌탈료 (${b.siteName || b.billingYm})`;
        items.push({
          date: b.billingDate ? b.billingDate.slice(5) : '-',
          itemName: name.replace(/\(가상\)/g, '').replace(/\s+/g, ' ').trim(),
          spec: b.contract?.contractNo || b.siteName || '-',
          qty: 1,
          unitPrice: supply,
          amount: supply,
          vat: vat,
          memo: b.memo || ''
        });
      }
    });

    return items;
  }, [selectedBillingsData]);

  // 고객 정보 객체
  const selectedCustomer = useMemo(() => {
    return customers?.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  // ── 통합 인보이스 발행 핸들러 ──
  const handleIssueInvoice = async () => {
    if (selectedBillingIds.length === 0) {
      showErrorModal?.('통합 발행할 청구서를 1건 이상 선택해 주세요.');
      return;
    }
    if (!selectedCustomerId) {
      showErrorModal?.('고객사를 선택해 주세요.');
      return;
    }
    if (accountingSummary.balanceDifference !== 0) {
      showErrorModal?.(`대차 차액 오류 발생 (차액: ₩${accountingSummary.balanceDifference.toLocaleString()}). 합계를 재검증해 주세요.`);
      return;
    }

    setIsIssuing(true);
    try {
      const res = await consolidateSelectedBillings({
        billingIds: selectedBillingIds,
        customerId: selectedCustomerId,
        billingYm: selectedYm || initialYm,
        dueDate: invoiceDueDate || undefined,
        memo: invoiceMemo.trim() || undefined
      });

      if (res.success) {
        showSuccessToast?.(res.message);
        // 선택 해제 및 이력 갱신
        setSelectedBillingIds([]);
        setInvoiceMemo('');
        await loadInvoices();
      } else {
        showErrorModal?.(res.message);
      }
    } catch (e: any) {
      showErrorModal?.(`통합 발행 중 오류 발생: ${e.message}`);
    } finally {
      setIsIssuing(false);
    }
  };

  // ── 인보이스 취소 핸들러 ──
  const handleCancelInvoice = async (invoiceId: string) => {
    const target = invoices.find(i => i.id === invoiceId);
    if (!target) return;

    // 안전 가드: 수납 발생 건 취소 차단
    if (target.status === 'PAID' || target.status === 'PARTIAL') {
      showErrorModal?.('수납이 진행된 통합 청구서는 취소할 수 없습니다. 수납 내역을 먼저 취소 처리해 주십시오.');
      return;
    }

    if (!window.confirm(`통합 청구서 ${invoiceId}를 취소하시겠습니까?\n포함된 원본 청구서들의 통합 연결이 해제되어 미통합 목록으로 환원됩니다.`)) {
      return;
    }

    try {
      const res = await cancelInvoice(invoiceId);
      if (res.success) {
        showSuccessToast?.(res.message);
        if (expandedHistoryId === invoiceId) {
          setExpandedHistoryId(null);
          setHistoryDetail(null);
        }
        await loadInvoices();
      } else {
        showErrorModal?.(res.message);
      }
    } catch (e: any) {
      showErrorModal?.(`취소 처리 실패: ${e.message}`);
    }
  };

  // ── 상세 이력 펼치기 ──
  const handleToggleHistoryDetail = async (id: string) => {
    if (expandedHistoryId === id) {
      setExpandedHistoryId(null);
      setHistoryDetail(null);
      return;
    }
    setExpandedHistoryId(id);
    try {
      const d = await fetchInvoiceDetail(id);
      setHistoryDetail(d);
    } catch (e: any) {
      showErrorModal?.(`상세 조회 실패: ${e.message}`);
    }
  };

  // ── 기존 청구 일괄 소급 묶기 핸들러 ──
  const handleConsolidateBatch = async () => {
    if (!window.confirm('기존의 미통합 청구서들을 고객사/귀속월 단위로 일괄 소급 묶기합니다. 계속하시겠습니까?')) return;
    setIsConsolidating(true);
    try {
      const r = await consolidateExistingBillings(groupBy);
      showSuccessToast?.(`소급 완료: 총 ${r.totalCreated}건 통합 인보이스 생성`);
      await loadInvoices();
    } catch (e: any) {
      showErrorModal?.(`소급 실패: ${e.message}`);
    } finally {
      setIsConsolidating(false);
    }
  };

  // ── 거래명세서 인쇄 (Window Print) ──
  const handlePrintStatement = () => {
    if (selectedBillingIds.length === 0) {
      showErrorModal?.('인쇄할 청구서를 선택해 주세요.');
      return;
    }
    window.print();
  };

  // ── 공통 거래명세서 주입 데이터 생성 헬퍼 ──
  const buildStatementData = (): TransactionStatementPdfData => {
    const custName = selectedCustomer?.name || '고객사';
    const firstSiteName = selectedBillingsData[0]?.siteName || '';

    const items: TransactionStatementItem[] = statementItems.map(item => {
      const parts = (item.date || '').split('-');
      const m = parts.length >= 2 ? parseInt(parts[0], 10) : parseInt(selectedYm.split('-')[1], 10);
      const d = parts.length >= 2 ? parseInt(parts[1], 10) : 1;
      return {
        month: isNaN(m) ? (parseInt(selectedYm.split('-')[1], 10) || 8) : m,
        day: isNaN(d) ? 1 : d,
        itemDescription: item.itemName,
        quantity: item.qty || 1,
        unitPrice: item.unitPrice || 0,
        supplyAmount: item.amount || 0,
        vatAmount: item.vat || 0,
        notes: item.memo || item.spec || ''
      };
    });

    return {
      billingDate: new Date().toISOString().split('T')[0],
      billingYm: selectedYm || initialYm,
      contractNo: selectedBillingsData[0]?.contract?.contractNo || '',
      lessorBizNo: '138-81-83251',
      lessorName: '주식회사 기연리프트',
      lessorCeo: '이수용',
      lessorAddress: '경기도 용인시 처인구 포곡읍 곡현로 254-3',
      salespersonName: '영업부',
      salespersonPhone: '031-334-5296',
      billingManagerName: '정수아',
      billingManagerPhone: '031-334-5295',
      lessorEmail: 'giyeonlift@naver.com',
      customerBizNo: selectedCustomer?.businessNumber || '',
      customerName: selectedCustomer?.name || '',
      customerCeo: selectedCustomer?.representativeName || '',
      customerAddress: selectedCustomer?.address || '',
      customerBizType: selectedCustomer?.bizType || '',
      customerBizItem: selectedCustomer?.bizItem || '',
      siteName: firstSiteName,
      bankAccount: '신한은행 140-010-007060 (주식회사 기연리프트)',
      items,
      totalSupply: accountingSummary.supplyAmount,
      totalVat: accountingSummary.vatAmount,
      totalGrand: accountingSummary.grandTotal
    };
  };

  // ── 정품 거래명세서 엑셀 다운로드 (00.거래명세서양식.xlsx 정품 서식 주입) ──
  const handleExportExcel = async () => {
    if (statementItems.length === 0) {
      showErrorModal?.('엑셀로 내보낼 항목이 없습니다. 청구서를 1건 이상 선택해 주세요.');
      return;
    }

    try {
      const data = buildStatementData();
      const buffer = await generateTransactionStatementExcel(data);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const custName = selectedCustomer?.name || '통합청구';
      const fileName = `거래명세서_${custName}_${selectedYm}_정품.xlsx`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccessToast?.(`정품 거래명세서 엑셀 파일이 다운로드되었습니다: ${fileName}`);
    } catch (err: any) {
      console.error('엑셀 생성 실패:', err);
      showErrorModal?.(`거래명세서 엑셀 서식 생성 실패: ${err.message || err}`);
    }
  };

  // ── 정품 거래명세서 PDF 변환 다운로드 (COM 에이전트 연동) ──
  const handleDownloadPdf = async () => {
    if (statementItems.length === 0) {
      showErrorModal?.('PDF로 변환할 항목이 없습니다. 청구서를 1건 이상 선택해 주세요.');
      return;
    }

    try {
      const data = buildStatementData();
      const pdfBytes = await generateTransactionStatementPdf(data);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const custName = selectedCustomer?.name || '통합청구';
      const fileName = `거래명세서_${custName}_${selectedYm}.pdf`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccessToast?.(`거래명세서 PDF 파일이 생성 및 다운로드되었습니다: ${fileName}`);
    } catch (err: any) {
      console.warn('PDF 에이전트 연결 불가 안내:', err);
      showErrorModal?.(
        `${err.message || err}\n\n` +
        `💡 [대안]: [정품 엑셀 다운로드]를 통해 엑셀 파일을 다운로드하신 후, 엑셀에서 바로 PDF로 저장하시거나 [인쇄] 기능을 사용하실 수 있습니다.`
      );
    }
  };

  // ── 발행 이력 인보이스 대상 거래명세서 데이터 생성 ──
  const buildStatementDataForHistory = async (inv: BillingInvoice): Promise<TransactionStatementPdfData> => {
    let detail = await fetchInvoiceDetail(inv.id);
    const childBillings = detail?.billings || [];
    const cust = customers?.find(c => c.id === inv.customerId);
    const firstSite = childBillings[0]?.siteName || '';

    const items: TransactionStatementItem[] = [];
    childBillings.forEach(b => {
      if (b.details && b.details.length > 0) {
        b.details.forEach(d => {
          const supply = d.amount || (d.unitPrice * d.quantity) || 0;
          const vat = d.vatAmount != null ? d.vatAmount : Math.floor(supply * 0.1);
          const cleanItemName = (d.itemName || d.description || '품목').replace(/\(가상\)/g, '').replace(/\s+/g, ' ').trim();
          items.push({
            month: parseInt((b.billingDate || '').split('-')[1] || inv.billingYm.split('-')[1] || '8', 10),
            day: parseInt((b.billingDate || '').split('-')[2] || '1', 10),
            itemDescription: cleanItemName,
            quantity: d.quantity || 1,
            unitPrice: d.unitPrice || supply,
            supplyAmount: supply,
            vatAmount: vat,
            notes: d.memo || d.spec || b.contract?.contractNo || ''
          });
        });
      } else {
        const supply = b.totalAmount || 0;
        const vat = Math.floor(supply * 0.1);
        const name = b.category === 'REPAIR' ? '장비 파손 수리비'
          : b.category === 'TRANSPORT' ? '장비 배차 운반비'
          : `렌탈료 (${b.siteName || inv.billingYm})`;
        items.push({
          month: parseInt((b.billingDate || '').split('-')[1] || inv.billingYm.split('-')[1] || '8', 10),
          day: parseInt((b.billingDate || '').split('-')[2] || '1', 10),
          itemDescription: name.replace(/\(가상\)/g, '').trim(),
          quantity: 1,
          unitPrice: supply,
          supplyAmount: supply,
          vatAmount: vat,
          notes: b.contract?.contractNo || ''
        });
      }
    });

    return {
      billingDate: inv.createdAt ? inv.createdAt.slice(0, 10) : new Date().toISOString().split('T')[0],
      billingYm: inv.billingYm,
      contractNo: childBillings[0]?.contract?.contractNo || '',
      lessorBizNo: '138-81-83251',
      lessorName: '주식회사 기연리프트',
      lessorCeo: '이수용',
      lessorAddress: '경기도 용인시 처인구 포곡읍 곡현로 254-3',
      salespersonName: '영업부',
      salespersonPhone: '031-334-5296',
      billingManagerName: '정수아',
      billingManagerPhone: '031-334-5295',
      lessorEmail: 'giyeonlift@naver.com',
      customerBizNo: cust?.businessNumber || '',
      customerName: cust?.name || '',
      customerCeo: cust?.representativeName || '',
      customerAddress: cust?.address || '',
      customerBizType: cust?.bizType || '',
      customerBizItem: cust?.bizItem || '',
      siteName: firstSite,
      bankAccount: '신한은행 140-010-007060 (주식회사 기연리프트)',
      items,
      totalSupply: inv.totalAmount,
      totalVat: inv.vatAmount,
      totalGrand: inv.grandTotal || (inv.totalAmount + inv.vatAmount)
    };
  };

  const handleDownloadHistoryPdf = async (inv: BillingInvoice) => {
    try {
      const data = await buildStatementDataForHistory(inv);
      const pdfBytes = await generateTransactionStatementPdf(data);
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const custName = customerName(inv.customerId) || '통합청구';
      const fileName = `거래명세서_${custName}_${inv.billingYm}_${inv.id}.pdf`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccessToast?.(`통합 거래명세서 PDF가 다운로드되었습니다: ${fileName}`);
    } catch (err: any) {
      showErrorModal?.(`PDF 다운로드 실패: ${err.message || err}`);
    }
  };

  const handleExportHistoryExcel = async (inv: BillingInvoice) => {
    try {
      const data = await buildStatementDataForHistory(inv);
      const buffer = await generateTransactionStatementExcel(data);
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const custName = customerName(inv.customerId) || '통합청구';
      const fileName = `거래명세서_${custName}_${inv.billingYm}_${inv.id}.xlsx`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showSuccessToast?.(`정품 거래명세서 엑셀 파일이 다운로드되었습니다: ${fileName}`);
    } catch (err: any) {
      showErrorModal?.(`엑셀 다운로드 실패: ${err.message || err}`);
    }
  };

  // 고객사명 도우미
  const customerName = (id: string) => customers?.find(c => c.id === id)?.name ?? id;

  // 발행 이력 필터링
  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      if (historyStatusFilter !== 'ALL' && inv.status !== historyStatusFilter) return false;
      if (selectedCustomerId && inv.customerId !== selectedCustomerId) return false;
      return true;
    });
  }, [invoices, historyStatusFilter, selectedCustomerId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>

      {/* ── 거래명세서 캔버스 및 인쇄 스타일 ── */}
      <style>{`
        /* 캔버스 화면 및 인쇄 공통: 흰 배경 위 모든 텍스트 검은색 강제 (다크모드 전역 스타일 상속 완전 차단) */
        #printable-invoice-canvas {
          background-color: #ffffff !important;
          color: #111827 !important;
        }
        #printable-invoice-canvas table {
          background-color: #ffffff !important;
          border-color: #9ca3af !important;
        }
        #printable-invoice-canvas thead th {
          background-color: #e5e7eb !important;
          color: #111827 !important;
          border-color: #d1d5db !important;
        }
        #printable-invoice-canvas td {
          color: #111827 !important;
          border-color: #e5e7eb !important;
        }
        #printable-invoice-canvas tr:hover td {
          background-color: transparent !important;
        }
        #printable-invoice-canvas tfoot tr,
        #printable-invoice-canvas tfoot td {
          background-color: #f3f4f6 !important;
          color: #111827 !important;
        }

        @media print {
          body * {
            visibility: hidden;
          }
          #printable-invoice-canvas, #printable-invoice-canvas * {
            visibility: visible;
          }
          #printable-invoice-canvas {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 20px;
            box-shadow: none !important;
            border: 1px solid #000 !important;
          }
        }
      `}</style>

      {/* ── 1. 상단 컨트롤 바 (Scope & Pipeline) ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        flexWrap: 'wrap', gap: '12px', padding: '14px 16px',
        backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)'
      }}>

        {/* 좌상단 Scope (조회 범위) */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>

          {/* 귀속연월 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              귀속연월
            </span>
            <input
              type="month"
              value={selectedYm}
              onChange={e => setSelectedYm(e.target.value)}
              style={{
                padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
                fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)',
                minWidth: '130px'
              }}
            />
          </div>

          {/* 1. 고객명 검색 인풋 (초성검색 지원) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              고객명 검색
            </span>
            <input
              type="text"
              placeholder="고객명/초성 (예: ㄷㅇ)..."
              value={customerSearchQuery}
              onChange={e => setCustomerSearchQuery(e.target.value)}
              style={{
                padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
                fontSize: '13px', width: '150px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)'
              }}
            />
          </div>

          {/* 2. 고객사 선택 드롭다운 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              고객사 선택 ({filteredCustomers.length}개사)
            </span>
            <select
              value={selectedCustomerId}
              onChange={e => setSelectedCustomerId(e.target.value)}
              style={{
                padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
                fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)',
                minWidth: '220px', fontWeight: 600
              }}
            >
              <option value="">고객사 전체 (선택 필요)</option>
              {filteredCustomers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.businessNumber ? `(${c.businessNumber})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* 통합 단위 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              통합 단위
            </span>
            <select
              value={groupBy}
              onChange={e => setGroupBy(e.target.value as InvoiceGroupBy)}
              style={{
                padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
                fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)'
              }}
            >
              <option value="CUSTOMER">고객 단위 (본사 1세금계산서)</option>
              <option value="SITE">현장 단위 (현장별 독립 묶기)</option>
            </select>
          </div>
        </div>

        {/* 우상단 Pipeline & 뷰 모드 토글 */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>

          {/* 뷰 모드 전환 버튼군 */}
          <div style={{
            display: 'flex', backgroundColor: 'var(--bg-app)', padding: '3px',
            borderRadius: '6px', border: '1px solid var(--border-color)'
          }}>
            <button
              onClick={() => setViewMode('STUDIO')}
              style={{
                padding: '6px 14px', borderRadius: '4px', border: 'none',
                background: viewMode === 'STUDIO' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'STUDIO' ? 'var(--text-on-primary)' : 'var(--text-muted)',
                fontWeight: 700, fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap'
              }}
            >
              통합 발행 스튜디오
            </button>
            <button
              onClick={() => setViewMode('HISTORY')}
              style={{
                padding: '6px 14px', borderRadius: '4px', border: 'none',
                background: viewMode === 'HISTORY' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'HISTORY' ? 'var(--text-on-primary)' : 'var(--text-muted)',
                fontWeight: 700, fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap'
              }}
            >
              발행 이력 대장 ({invoices.length})
            </button>
          </div>

          {/* 소급 묶기 버튼 */}
          <button
            onClick={handleConsolidateBatch}
            disabled={isConsolidating}
            title="기존 미통합 청구 일괄 소급 통합"
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '7px 12px', borderRadius: '6px', border: '1px solid var(--border-color)',
              background: 'var(--bg-app)', color: 'var(--text-main)',
              fontWeight: 600, fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap'
            }}
          >
            <Layers size={13} />
            {isConsolidating ? '처리 중...' : '기존 청구 소급 묶기'}
          </button>

          {/* 새로고침 */}
          <button
            onClick={loadInvoices}
            disabled={isLoadingInvoices}
            title="새로고침"
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
              background: 'var(--bg-app)', color: 'var(--text-muted)', cursor: 'pointer'
            }}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* ── 2. 메인 작업 화면 ── */}
      {viewMode === 'STUDIO' ? (
        /* ── [모드 A] 좌우 52:48 2분할 워크벤치 스튜디오 ── */
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(480px, 52%) minmax(440px, 48%)',
          gap: '16px',
          alignItems: 'start'
        }}>

          {/* ── [좌측 52%] 미통합 개별 청구서 바구니 ── */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '12px',
            backgroundColor: 'var(--bg-card)', borderRadius: '8px',
            border: '1px solid var(--border-color)', padding: '16px'
          }}>

            {/* 바구니 헤더 & 품목 카테고리 필터 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FileText size={16} color="var(--primary)" />
                  미통합 청구 목록
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                    ({displayedBillings.length}건 / 선택 {selectedBillingIds.length}건)
                  </span>
                </div>
              </div>

              {/* 품목 필터 탭 */}
              <div style={{
                display: 'flex', gap: '4px', backgroundColor: 'var(--bg-app)',
                padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)'
              }}>
                {(['ALL', 'RENTAL', 'REPAIR', 'TRANSPORT'] as const).map(cat => {
                  const label = cat === 'ALL' ? `전체 (${categoryCounts.ALL})`
                    : cat === 'RENTAL' ? `렌탈 (${categoryCounts.RENTAL})`
                    : cat === 'REPAIR' ? `수리 (${categoryCounts.REPAIR})`
                    : `운반 (${categoryCounts.TRANSPORT})`;
                  const isActive = itemCategoryFilter === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => setItemCategoryFilter(cat)}
                      style={{
                        padding: '4px 8px', borderRadius: '4px', border: 'none',
                        fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                        background: isActive ? 'var(--primary)' : 'transparent',
                        color: isActive ? 'var(--text-on-primary)' : 'var(--text-muted)',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ⚠️ 미청구 부가비용 동반선택 배너 */}
            {pendingExtraBillings.length > 0 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', borderRadius: '6px',
                backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#92400e',
                fontSize: '12px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldAlert size={16} color="#d97706" />
                  <span>
                    <strong>미청구 부가비용 감지:</strong> 수리비 {categoryCounts.REPAIR}건, 운반비 {categoryCounts.TRANSPORT}건이 대기 중입니다.
                  </span>
                </div>
                <button
                  onClick={handleSelectAllExtraCharges}
                  style={{
                    padding: '4px 10px', borderRadius: '4px', border: 'none',
                    backgroundColor: '#d97706', color: '#ffffff', fontSize: '11px',
                    fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap'
                  }}
                >
                  원클릭 동반 선택
                </button>
              </div>
            )}

            {/* 고객사 미선택 안내 */}
            {!selectedCustomerId ? (
              <div style={{
                padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)',
                backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px dashed var(--border-color)'
              }}>
                <Building size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                <div style={{ fontWeight: 600 }}>고객사를 먼저 선택해 주세요.</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>상단에서 고객사를 지정하면 해당 고객사의 미통합 청구 목록이 노출됩니다.</div>
              </div>
            ) : displayedBillings.length === 0 ? (
              <div style={{
                padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)',
                backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px dashed var(--border-color)'
              }}>
                <CheckCircle size={32} color="#10b981" style={{ margin: '0 auto 8px', opacity: 0.8 }} />
                <div style={{ fontWeight: 600 }}>해당 조건의 미통합 청구서가 없습니다.</div>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>모든 청구가 이미 통합되었거나 해당 월에 청구 데이터가 없습니다.</div>
              </div>
            ) : (
              /* 고밀도 체크리스트 테이블 (행 높이 38px, white-space: nowrap) */
              <div style={{
                overflowX: 'auto', maxHeight: '540px', overflowY: 'auto',
                border: '1px solid var(--border-color)', borderRadius: '6px'
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                    <tr style={{ background: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'center', width: '36px' }}>
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={handleToggleSelectAll}
                          style={{ cursor: 'pointer' }}
                        />
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>구분</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>청구일</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>현장/계약</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>품목 요약</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>공급가액</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>합계금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedBillings.map(b => {
                      const isChecked = selectedBillingIds.includes(b.id);
                      return (
                        <tr
                          key={b.id}
                          onClick={() => handleToggleSelect(b.id)}
                          style={{
                            height: '38px',
                            borderBottom: '1px solid var(--border-color)',
                            backgroundColor: isChecked ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s'
                          }}
                        >
                          <td style={{ padding: '6px 10px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleSelect(b.id)}
                              style={{ cursor: 'pointer' }}
                            />
                          </td>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                            <CategoryBadge category={b.category} />
                          </td>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                            {b.billingDate}
                          </td>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--text-main)', fontWeight: 600 }}>
                            {b.siteName}
                          </td>
                          <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--text-main)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {b.itemSummary}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--text-main)' }}>
                            {fmtAmt(b.totalAmount)}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--primary)' }}>
                            {fmtAmt(b.calculatedGrand)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 바구니 하단 상태 바 */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              paddingTop: '8px', borderTop: '1px solid var(--border-color)', fontSize: '12px'
            }}>
              <span style={{ color: 'var(--text-muted)' }}>
                선택 항목: <strong>{selectedBillingIds.length}</strong>건 / 총 {displayedBillings.length}건
              </span>
              <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>
                선택 공급가계: <strong>{fmtAmt(accountingSummary.supplyAmount)}</strong>
              </span>
            </div>
          </div>

          {/* ── [우측 48%] 통합 인보이스 작업대 & A4 11행 실시간 싱크 캔버스 ── */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '12px',
            backgroundColor: 'var(--bg-card)', borderRadius: '8px',
            border: '1px solid var(--border-color)', padding: '16px'
          }}>

            {/* 작업대 헤더 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Printer size={16} color="var(--primary)" />
                통합 인보이스 작업대
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                공식 거래명세서 실시간 싱크
              </span>
            </div>

            {/* 인보이스 기본 정보 폼 (상하 세로 스택) */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px',
              padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px'
            }}>
              {/* 인보이스 식별자 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  발행 예정 인보이스 번호
                </span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary)', fontFamily: 'monospace' }}>
                  INV-{selectedYm.replace('-', '')}-AUTO
                </span>
              </div>

              {/* 납기일자 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  납기일자 (입금 마감일)
                </span>
                <input
                  type="date"
                  value={invoiceDueDate}
                  onChange={e => setInvoiceDueDate(e.target.value)}
                  style={{
                    padding: '5px 8px', borderRadius: '4px', border: '1px solid var(--border-color)',
                    fontSize: '12px', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)'
                  }}
                />
              </div>

              {/* 특이사항/메모 */}
              <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  통합 비고 / 전달사항
                </span>
                <input
                  type="text"
                  placeholder="예: 2026년 8월 정기 렌탈료 및 현장 부대비용 통합 청구"
                  value={invoiceMemo}
                  onChange={e => setInvoiceMemo(e.target.value)}
                  style={{
                    padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border-color)',
                    fontSize: '12px', backgroundColor: 'var(--bg-card)', color: 'var(--text-main)'
                  }}
                />
              </div>
            </div>

            {/* ── 공식 거래명세서 A4 11행 실시간 싱크 캔버스 ── */}
            <div
              id="printable-invoice-canvas"
              ref={printableCanvasRef}
              style={{
                backgroundColor: '#ffffff',
                color: '#111827',
                padding: '16px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                fontSize: '11px',
                fontFamily: 'sans-serif'
              }}
            >
              {/* 명세서 헤더 */}
              <div style={{ textAlign: 'center', borderBottom: '2px solid #111827', paddingBottom: '8px', marginBottom: '10px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, letterSpacing: '4px', color: '#111827' }}>
                  거 래 명 세 서
                </h2>
                <div style={{ fontSize: '11px', color: '#374151', marginTop: '2px' }}>
                  (공급받는자 보관용) | 발행일자: {new Date().toISOString().slice(0, 10)}
                </div>
              </div>

              {/* 공급자 & 공급받는자 2열 테이블 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                {/* 공급자 (주식회사 기연리프트 SSOT) */}
                <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #9ca3af', fontSize: '10px', backgroundColor: '#ffffff' }}>
                  <tbody>
                    <tr>
                      <td rowSpan={4} style={{ width: '20px', backgroundColor: '#f3f4f6', color: '#111827', textAlign: 'center', fontWeight: 700, borderRight: '1px solid #9ca3af', padding: '4px' }}>
                        공<br/>급<br/>자
                      </td>
                      <td style={{ backgroundColor: '#f9fafb', color: '#374151', padding: '3px 4px', borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', width: '55px', fontWeight: 600 }}>등록번호</td>
                      <td colSpan={3} style={{ padding: '3px 4px', borderBottom: '1px solid #e5e7eb', fontWeight: 700, color: '#111827' }}>138-81-83251</td>
                    </tr>
                    <tr>
                      <td style={{ backgroundColor: '#f9fafb', color: '#374151', padding: '3px 4px', borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>상호</td>
                      <td style={{ padding: '3px 4px', borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', fontWeight: 700, color: '#111827' }}>주식회사 기연리프트</td>
                      <td style={{ backgroundColor: '#f9fafb', color: '#374151', padding: '3px 4px', borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', width: '35px', fontWeight: 600 }}>성명</td>
                      <td style={{ padding: '3px 4px', borderBottom: '1px solid #e5e7eb', color: '#111827' }}>이수용</td>
                    </tr>
                    <tr>
                      <td style={{ backgroundColor: '#f9fafb', color: '#374151', padding: '3px 4px', borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>사업장</td>
                      <td colSpan={3} style={{ padding: '3px 4px', borderBottom: '1px solid #e5e7eb', color: '#111827' }}>경기도 용인시 처인구 포곡읍 곡현로 254-3</td>
                    </tr>
                    <tr>
                      <td style={{ backgroundColor: '#f9fafb', color: '#374151', padding: '3px 4px', borderRight: '1px solid #e5e7eb', fontWeight: 600 }}>업태/종목</td>
                      <td style={{ padding: '3px 4px', borderRight: '1px solid #e5e7eb', color: '#111827' }}>임대업</td>
                      <td colSpan={2} style={{ padding: '3px 4px', color: '#111827' }}>건설기계임대</td>
                    </tr>
                  </tbody>
                </table>

                {/* 공급받는자 (고객사) */}
                <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #9ca3af', fontSize: '10px', backgroundColor: '#ffffff' }}>
                  <tbody>
                    <tr>
                      <td rowSpan={4} style={{ width: '20px', backgroundColor: '#f3f4f6', color: '#111827', textAlign: 'center', fontWeight: 700, borderRight: '1px solid #9ca3af', padding: '4px' }}>
                        공<br/>급<br/>받<br/>는<br/>자
                      </td>
                      <td style={{ backgroundColor: '#f9fafb', color: '#374151', padding: '3px 4px', borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', width: '55px', fontWeight: 600 }}>등록번호</td>
                      <td colSpan={3} style={{ padding: '3px 4px', borderBottom: '1px solid #e5e7eb', fontWeight: 700, color: '#111827' }}>
                        {selectedCustomer?.businessNumber || '-'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ backgroundColor: '#f9fafb', color: '#374151', padding: '3px 4px', borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>상호</td>
                      <td style={{ padding: '3px 4px', borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', fontWeight: 700, color: '#111827' }}>
                        {selectedCustomer?.name || '고객사 미선택'}
                      </td>
                      <td style={{ backgroundColor: '#f9fafb', color: '#374151', padding: '3px 4px', borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', width: '35px', fontWeight: 600 }}>성명</td>
                      <td style={{ padding: '3px 4px', borderBottom: '1px solid #e5e7eb', color: '#111827' }}>
                        {selectedCustomer?.representativeName || '-'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ backgroundColor: '#f9fafb', color: '#374151', padding: '3px 4px', borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>사업장</td>
                      <td colSpan={3} style={{ padding: '3px 4px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px', color: '#111827' }}>
                        {selectedCustomer?.address || '-'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ backgroundColor: '#f9fafb', color: '#374151', padding: '3px 4px', borderRight: '1px solid #e5e7eb', fontWeight: 600 }}>업태/종목</td>
                      <td style={{ padding: '3px 4px', borderRight: '1px solid #e5e7eb', color: '#111827' }}>{selectedCustomer?.bizType || '-'}</td>
                      <td colSpan={2} style={{ padding: '3px 4px', color: '#111827' }}>{selectedCustomer?.bizItem || '-'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 총액 요약 바 */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                backgroundColor: '#f3f4f6', padding: '6px 10px', border: '1px solid #d1d5db',
                marginBottom: '8px', fontWeight: 700, color: '#111827'
              }}>
                <div>
                  합계금액: <span style={{ color: '#1d4ed8', fontSize: '13px', fontWeight: 800 }}>일금 {numberToKoreanAmount(accountingSummary.grandTotal)} 원정</span>
                </div>
                <div style={{ fontSize: '13px', color: '#111827', fontWeight: 800 }}>
                  ₩{accountingSummary.grandTotal.toLocaleString()} (VAT포함)
                </div>
              </div>

              {/* ── 11행 정규 규격 그리드 (table-layout fixed, no-wrap 방어) ── */}
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', border: '1px solid #9ca3af', fontSize: '10px', backgroundColor: '#ffffff' }}>
                <thead>
                  <tr style={{ backgroundColor: '#e5e7eb', borderBottom: '1px solid #9ca3af' }}>
                    <th style={{ padding: '4px 2px', borderRight: '1px solid #d1d5db', width: '34px', textAlign: 'center', whiteSpace: 'nowrap', color: '#111827', backgroundColor: '#e5e7eb' }}>월/일</th>
                    <th style={{ padding: '4px 4px', borderRight: '1px solid #d1d5db', textAlign: 'left', whiteSpace: 'nowrap', color: '#111827', backgroundColor: '#e5e7eb' }}>품목명</th>
                    <th style={{ padding: '4px 3px', borderRight: '1px solid #d1d5db', width: '65px', textAlign: 'left', whiteSpace: 'nowrap', color: '#111827', backgroundColor: '#e5e7eb' }}>규격/현장</th>
                    <th style={{ padding: '4px 2px', borderRight: '1px solid #d1d5db', width: '28px', textAlign: 'center', whiteSpace: 'nowrap', color: '#111827', backgroundColor: '#e5e7eb' }}>수량</th>
                    <th style={{ padding: '4px 3px', borderRight: '1px solid #d1d5db', width: '56px', textAlign: 'right', whiteSpace: 'nowrap', color: '#111827', backgroundColor: '#e5e7eb' }}>단가</th>
                    <th style={{ padding: '4px 3px', borderRight: '1px solid #d1d5db', width: '66px', textAlign: 'right', whiteSpace: 'nowrap', color: '#111827', backgroundColor: '#e5e7eb' }}>공급가액</th>
                    <th style={{ padding: '4px 3px', borderRight: '1px solid #d1d5db', width: '56px', textAlign: 'right', whiteSpace: 'nowrap', color: '#111827', backgroundColor: '#e5e7eb' }}>세액</th>
                    <th style={{ padding: '4px 3px', width: '50px', textAlign: 'left', whiteSpace: 'nowrap', color: '#111827', backgroundColor: '#e5e7eb' }}>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 실제 품목행 렌더링 (최대 11행 또는 채우기) */}
                  {Array.from({ length: 11 }).map((_, idx) => {
                    const item = statementItems[idx];
                    return (
                      <tr key={idx} style={{ height: '22px', borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '2px 2px', borderRight: '1px solid #e5e7eb', textAlign: 'center', color: '#374151', whiteSpace: 'nowrap' }}>
                          {item ? item.date : ''}
                        </td>
                        <td style={{ padding: '2px 4px', borderRight: '1px solid #e5e7eb', fontWeight: item ? 600 : 400, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item?.itemName}>
                          {item ? item.itemName : ''}
                        </td>
                        <td style={{ padding: '2px 3px', borderRight: '1px solid #e5e7eb', color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item?.spec}>
                          {item ? item.spec : ''}
                        </td>
                        <td style={{ padding: '2px 2px', borderRight: '1px solid #e5e7eb', textAlign: 'center', color: '#111827', whiteSpace: 'nowrap' }}>
                          {item ? item.qty : ''}
                        </td>
                        <td style={{ padding: '2px 3px', borderRight: '1px solid #e5e7eb', textAlign: 'right', color: '#374151', whiteSpace: 'nowrap' }}>
                          {item ? item.unitPrice.toLocaleString() : ''}
                        </td>
                        <td style={{ padding: '2px 3px', borderRight: '1px solid #e5e7eb', textAlign: 'right', fontWeight: 600, color: '#111827', whiteSpace: 'nowrap' }}>
                          {item ? item.amount.toLocaleString() : ''}
                        </td>
                        <td style={{ padding: '2px 3px', borderRight: '1px solid #e5e7eb', textAlign: 'right', color: '#374151', whiteSpace: 'nowrap' }}>
                          {item ? item.vat.toLocaleString() : ''}
                        </td>
                        <td style={{ padding: '2px 3px', color: '#4b5563', fontSize: '9px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item ? item.memo : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ backgroundColor: '#f3f4f6', borderTop: '2px solid #9ca3af', fontWeight: 700 }}>
                    <td colSpan={5} style={{ padding: '4px 6px', borderRight: '1px solid #d1d5db', textAlign: 'center', whiteSpace: 'nowrap', color: '#111827', fontWeight: 800 }}>
                      소계 및 합계
                    </td>
                    <td style={{ padding: '4px 3px', borderRight: '1px solid #d1d5db', textAlign: 'right', color: '#111827', whiteSpace: 'nowrap', fontWeight: 700 }}>
                      {accountingSummary.supplyAmount.toLocaleString()}
                    </td>
                    <td style={{ padding: '4px 3px', borderRight: '1px solid #d1d5db', textAlign: 'right', color: '#111827', whiteSpace: 'nowrap', fontWeight: 700 }}>
                      {accountingSummary.vatAmount.toLocaleString()}
                    </td>
                    <td style={{ padding: '4px 3px', textAlign: 'right', color: '#111827', whiteSpace: 'nowrap', fontWeight: 800 }}>
                      {accountingSummary.grandTotal.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* 하단 입금계좌 및 안내 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '10px', color: '#111827' }}>
                <div><strong>입금계좌:</strong> 신한은행 140-010-007060 (예금주: 주식회사 기연리프트)</div>
                <div><strong>납기일:</strong> {invoiceDueDate || '협의 (당월말)'}</div>
              </div>
            </div>

            {/* ── 우하단 터미널 액션 바 (Gutenberg Z-Pattern) ── */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 14px',
              backgroundColor: 'var(--bg-app)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              {/* 좌측: 대차대조식 무결성 확정 요약 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  청구 대상: <strong>{selectedBillingIds.length}</strong>건 선택됨
                </span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                  공급가: {fmtAmt(accountingSummary.supplyAmount)} + 세액: {fmtAmt(accountingSummary.vatAmount)} = <span style={{ color: 'var(--primary)' }}>{fmtAmt(accountingSummary.grandTotal)}</span>
                </span>
              </div>

              {/* 우측: 4대 액션 버튼군 */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* 1. 정품 엑셀 서식 다운로드 */}
                <button
                  type="button"
                  onClick={handleExportExcel}
                  disabled={selectedBillingIds.length === 0}
                  title="00.거래명세서양식.xlsx 정품 서식에 데이터 주입 엑셀 파일 다운로드"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '8px 12px', borderRadius: '6px',
                    backgroundColor: '#10b981', color: '#ffffff',
                    border: 'none', fontSize: '12px', fontWeight: 700,
                    cursor: selectedBillingIds.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: selectedBillingIds.length === 0 ? 0.5 : 1,
                    whiteSpace: 'nowrap'
                  }}
                >
                  <Download size={14} />
                  정품 엑셀 다운로드
                </button>

                {/* 2. PDF 변환 / 다운로드 */}
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={selectedBillingIds.length === 0}
                  title="MS Excel COM 에이전트 연동 정품 PDF 변환 다운로드"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '8px 12px', borderRadius: '6px',
                    backgroundColor: '#4f46e5', color: '#ffffff',
                    border: 'none', fontSize: '12px', fontWeight: 700,
                    cursor: selectedBillingIds.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: selectedBillingIds.length === 0 ? 0.5 : 1,
                    whiteSpace: 'nowrap'
                  }}
                >
                  <FileText size={14} />
                  PDF 다운로드
                </button>

                {/* 3. 브라우저 인쇄 */}
                <button
                  type="button"
                  onClick={handlePrintStatement}
                  disabled={selectedBillingIds.length === 0}
                  title="거래명세서 캔버스 브라우저 인쇄"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '8px 12px', borderRadius: '6px',
                    backgroundColor: 'var(--bg-card)', color: 'var(--text-main)',
                    border: '1px solid var(--border-color)', fontSize: '12px', fontWeight: 600,
                    cursor: selectedBillingIds.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: selectedBillingIds.length === 0 ? 0.5 : 1,
                    whiteSpace: 'nowrap'
                  }}
                >
                  <Printer size={14} />
                  인쇄
                </button>

                {/* 4. 최종 완결 액션: 통합 인보이스 발행 확정 */}
                <button
                  type="button"
                  onClick={handleIssueInvoice}
                  disabled={isIssuing || selectedBillingIds.length === 0 || !selectedCustomerId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '8px 16px', borderRadius: '6px',
                    backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)',
                    border: 'none', fontSize: '12.5px', fontWeight: 700,
                    cursor: (isIssuing || selectedBillingIds.length === 0 || !selectedCustomerId) ? 'not-allowed' : 'pointer',
                    opacity: (isIssuing || selectedBillingIds.length === 0 || !selectedCustomerId) ? 0.5 : 1,
                    whiteSpace: 'nowrap'
                  }}
                >
                  <CheckCircle size={14} />
                  {isIssuing ? '발행 처리 중...' : '통합 청구서 발행'}
                </button>
              </div>
            </div>

          </div>
        </div>
      ) : (
        /* ── [모드 B] 발행 이력 대장 (HISTORY) ── */
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '12px',
          backgroundColor: 'var(--bg-card)', borderRadius: '8px',
          border: '1px solid var(--border-color)', padding: '16px'
        }}>
          {/* 필터 및 요약 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-main)' }}>
                기발행 통합 청구서 이력
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                (총 {filteredInvoices.length}건)
              </span>
            </div>

            {/* 상태 필터 */}
            <div style={{ display: 'flex', gap: '6px' }}>
              {['ALL', 'ISSUED', 'PARTIAL', 'PAID', 'CANCELLED'].map(st => {
                const label = st === 'ALL' ? '전체'
                  : st === 'ISSUED' ? '발행완료'
                  : st === 'PARTIAL' ? '부분수납'
                  : st === 'PAID' ? '수납완료' : '통합취소';
                const isActive = historyStatusFilter === st;
                return (
                  <button
                    key={st}
                    onClick={() => setHistoryStatusFilter(st)}
                    style={{
                      padding: '4px 10px', borderRadius: '4px', border: 'none',
                      fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                      background: isActive ? 'var(--primary)' : 'var(--bg-app)',
                      color: isActive ? 'var(--text-on-primary)' : 'var(--text-muted)'
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 발행 이력 그리드 테이블 */}
          <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '8px 10px', width: '32px' }} />
                  {['통합인보이스번호', '고객사', '귀속월', '공급가액', '부가세', '청구총액', '수납액', '납기일', '상태', '발행일시', '액션'].map(h => (
                    <th key={h} style={{
                      padding: '8px 10px', textAlign: h.includes('액') ? 'right' : 'left',
                      fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoadingInvoices ? (
                  <tr><td colSpan={12} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>로딩 중...</td></tr>
                ) : filteredInvoices.length === 0 ? (
                  <tr><td colSpan={12} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>발행된 청구서통합 내역이 없습니다.</td></tr>
                ) : filteredInvoices.map(inv => {
                  const isExpanded = expandedHistoryId === inv.id;
                  return (
                    <React.Fragment key={inv.id}>
                      <tr style={{ height: '38px', borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <button
                            onClick={() => handleToggleHistoryDetail(inv.id)}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                          >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                        <td style={{ padding: '6px 10px', fontWeight: 700, color: 'var(--primary)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                          {inv.id}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--text-main)', fontWeight: 600 }}>
                          {customerName(inv.customerId)}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--text-main)' }}>
                          {inv.billingYm}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', textAlign: 'right', color: 'var(--text-main)' }}>
                          {fmtAmt(inv.totalAmount)}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', textAlign: 'right', color: 'var(--text-muted)' }}>
                          {fmtAmt(inv.vatAmount)}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 700, color: 'var(--text-main)' }}>
                          {fmtAmt(inv.grandTotal || (inv.totalAmount + (inv.vatAmount || 0)))}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', textAlign: 'right', color: '#059669' }}>
                          {fmtAmt(inv.paidAmount || 0)}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                          {inv.dueDate || '-'}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                          <StatusBadge status={inv.status} />
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                          {inv.createdAt ? inv.createdAt.slice(0, 10) : '-'}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleDownloadHistoryPdf(inv)}
                              style={{
                                padding: '2px 7px', borderRadius: '4px', border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-secondary)', color: 'var(--text-main)', fontSize: '11px',
                                cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '3px'
                              }}
                              title="정품 거래명세서 PDF 다운로드"
                            >
                              <Download size={11} /> PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExportHistoryExcel(inv)}
                              style={{
                                padding: '2px 7px', borderRadius: '4px', border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-secondary)', color: 'var(--text-main)', fontSize: '11px',
                                cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '3px'
                              }}
                              title="정품 거래명세서 엑셀 다운로드"
                            >
                              <FileText size={11} /> 엑셀
                            </button>
                            {inv.status !== 'CANCELLED' && (
                              <button
                                onClick={() => handleCancelInvoice(inv.id)}
                                style={{
                                  padding: '2px 7px', borderRadius: '4px', border: '1px solid #fca5a5',
                                  backgroundColor: 'transparent', color: '#dc2626', fontSize: '11px',
                                  cursor: 'pointer', whiteSpace: 'nowrap'
                                }}
                              >
                                취소
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* 확장 상세 행 */}
                      {isExpanded && (
                        <tr style={{ backgroundColor: 'var(--bg-app)' }}>
                          <td colSpan={12} style={{ padding: '12px 16px 16px 36px' }}>
                            {!historyDetail ? (
                              <div style={{ color: 'var(--text-muted)', padding: '12px' }}>로딩 중...</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)' }}>
                                  포함된 원천 청구 내역 ({historyDetail.billings?.length || 0}건)
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
                                  <thead>
                                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                                      {['청구ID', '계약ID', '청구일자', '공급가액', '수납액', '상태', '비고'].map(h => (
                                        <th key={h} style={{ padding: '6px 8px', textAlign: h.includes('액') ? 'right' : 'left', color: 'var(--text-secondary)' }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(historyDetail.billings || []).map(b => (
                                      <tr key={b.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <td style={{ padding: '6px 8px', fontFamily: 'monospace', color: 'var(--primary)' }}>{b.id}</td>
                                        <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{b.contractId || '-'}</td>
                                        <td style={{ padding: '6px 8px', color: 'var(--text-main)' }}>{b.billingDate}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{fmtAmt(b.totalAmount)}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', color: '#059669' }}>{fmtAmt(b.paidAmount || 0)}</td>
                                        <td style={{ padding: '6px 8px' }}><StatusBadge status={b.status} /></td>
                                        <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{b.memo || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 3. 최하단 Gutenberg Z-패턴 터미널 액션 바 ── */}
      {viewMode === 'STUDIO' && (
        <div style={{
          position: 'sticky', bottom: 0, zIndex: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: '12px', padding: '12px 20px',
          backgroundColor: 'var(--bg-card)', borderRadius: '8px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.08)'
        }}>

          {/* 좌측: 대차대조식 검증 바 (헌장 3.5 Gutenberg Z-패턴 4대 질문 반영) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '13px' }}>
            <span style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              fontWeight: 700, color: 'var(--text-main)'
            }}>
              <CheckSquare size={16} color="var(--primary)" />
              선택 {accountingSummary.count}건
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{ color: 'var(--text-main)' }}>
              공급가: <strong>{fmtAmt(accountingSummary.supplyAmount)}</strong>
            </span>
            <span>+</span>
            <span style={{ color: 'var(--text-muted)' }}>
              부가세(10%): <strong>{fmtAmt(accountingSummary.vatAmount)}</strong>
            </span>
            <span>=</span>
            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--primary)' }}>
              청구총액: {fmtAmt(accountingSummary.grandTotal)}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>|</span>
            <span style={{
              padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
              backgroundColor: accountingSummary.balanceDifference === 0 ? '#dcfce7' : '#fee2e2',
              color: accountingSummary.balanceDifference === 0 ? '#15803d' : '#b91c1c'
            }}>
              대차 차액: ₩{accountingSummary.balanceDifference.toLocaleString()}
            </span>
          </div>

          {/* 우측: Terminal Actions 버튼군 */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* 거래명세서 A4 인쇄 */}
            <button
              onClick={handlePrintStatement}
              disabled={selectedBillingIds.length === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', borderRadius: '6px', border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-app)', color: 'var(--text-main)',
                fontSize: '13px', fontWeight: 600, cursor: selectedBillingIds.length === 0 ? 'not-allowed' : 'pointer',
                opacity: selectedBillingIds.length === 0 ? 0.6 : 1, whiteSpace: 'nowrap'
              }}
            >
              <Printer size={14} />
              A4 명세서 인쇄
            </button>

            {/* 거래명세서 엑셀 다운로드 */}
            <button
              onClick={handleExportExcel}
              disabled={statementItems.length === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', borderRadius: '6px', border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-app)', color: 'var(--text-main)',
                fontSize: '13px', fontWeight: 600, cursor: statementItems.length === 0 ? 'not-allowed' : 'pointer',
                opacity: statementItems.length === 0 ? 0.6 : 1, whiteSpace: 'nowrap'
              }}
            >
              <Download size={14} />
              엑셀 다운로드
            </button>

            {/* 통합 인보이스 발행 (주 터미널 액션) */}
            <button
              onClick={handleIssueInvoice}
              disabled={isIssuing || selectedBillingIds.length === 0 || accountingSummary.balanceDifference !== 0}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 20px', borderRadius: '6px', border: 'none',
                backgroundColor: selectedBillingIds.length === 0 ? 'var(--text-muted)' : 'var(--primary)',
                color: 'var(--text-on-primary)', fontSize: '13px', fontWeight: 700,
                cursor: selectedBillingIds.length === 0 ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              <Plus size={14} />
              {isIssuing ? '발행 처리 중...' : '통합 인보이스 발행'}
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

