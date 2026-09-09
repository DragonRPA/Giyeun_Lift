// src/pages/PurchaseSettlementPage.tsx
// 월말 매입 정산 (운송료 / 소모품 매입 / 임차료) 통합 관리 페이지

import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { PurchaseSettlement, PurchaseSettlementItem, PurchaseSettlementType, db } from '../services/db';
import { exportToExcel } from '../services/excel';
import {
  Truck, ShoppingBag, Building2, Plus, CheckCircle2, CreditCard,
  ChevronDown, ChevronUp, FileText, AlertCircle, RefreshCw, X, Download, ExternalLink, Eye, Wrench
} from 'lucide-react';

// 정산 유형 탭 정의
const SETTLEMENT_TYPES: { id: PurchaseSettlementType | 'ALL'; label: string; icon: React.ReactNode }[] = [
  { id: 'ALL',              label: '전체',            icon: <FileText size={15} /> },
  { id: 'TRANSPORT',        label: '운송료',           icon: <Truck size={15} /> },
  { id: 'CONSUMABLE',       label: '소모품 매입',       icon: <ShoppingBag size={15} /> },
  { id: 'EQUIPMENT_LEASE',  label: '임차료 (전대장비)', icon: <Building2 size={15} /> },
  { id: 'EXTERNAL_REPAIR',   label: '외주 정비비',      icon: <Wrench size={15} /> },
];

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING:   { label: '집계중',  color: '#F59E0B' },
  CONFIRMED: { label: '정산확정', color: '#3B82F6' },
  PAID:      { label: '지급완료', color: '#10B981' },
};

const TYPE_LABEL: Record<string, string> = {
  TRANSPORT:       '운송료',
  CONSUMABLE:      '소모품 매입',
  EQUIPMENT_LEASE: '임차료',
  EXTERNAL_REPAIR: '외주 정비비',
};

export const PurchaseSettlementPage: React.FC = () => {
  const {
    purchaseSettlements,
    purchaseSettlementItems,
    settlementPaymentLogs,
    consumablePurchases,
    deliveries,
    bankTransactions,
    generateMonthlyPurchaseSettlements,
    confirmPurchaseSettlement,
    recordPurchaseSettlementPayment,
    savePurchaseSettlement,
    showErrorModal
  } = useApp();

  // 현재 연월 기본 선택
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [selectedYm, setSelectedYm]               = useState(currentYm);
  const [typeFilter, setTypeFilter]                = useState<PurchaseSettlementType | 'ALL'>('ALL');
  const [payStatusFilter, setPayStatusFilter]      = useState('ALL');
  const [vendorSearch, setVendorSearch]            = useState('');
  const [expandedId, setExpandedId]                = useState<string | null>(null);
  const [isGenerating, setIsGenerating]            = useState(false);
  const [generateResult, setGenerateResult]        = useState<string | null>(null);
  const [paymentModal, setPaymentModal]            = useState<{ id: string; totalAmount: number; paidAmount: number; vendorName: string } | null>(null);
  const [paymentForm, setPaymentForm]              = useState({ paidAmount: '', paymentDate: currentYm.slice(0,7) + '-' + String(now.getDate()).padStart(2,'0'), paymentMethod: '계좌이체', bankAccount: '', memo: '' });
  const [selectedBankTxId, setSelectedBankTxId]    = useState<string | null>(null);

  // 🔍 지급 대사 상세 명세서 모달 상태 (Audit 1:N 이력)
  const [detailModalSettlementId, setDetailModalSettlementId] = useState<string | null>(null);

  const [memoEditId, setMemoEditId]                = useState<string | null>(null);
  const [memoText, setMemoText]                    = useState('');

  // 증빙 파일 미리보기 모달 상태
  const [previewEvidence, setPreviewEvidence]      = useState<{ url: string; title: string } | null>(null);
  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // ─── [Gutenberg Z-패턴 4단계 최하단 매입 대차대조식 검증] ───
  const settlementAuditSummary = useMemo(() => {
    const monthSettlements = purchaseSettlements.filter(s => s.settlementYm === selectedYm);
    const totalCount = monthSettlements.length;
    const totalAmount = monthSettlements.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
    const totalPaid = monthSettlements.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
    const balance = totalAmount - totalPaid;
    const confirmedCount = monthSettlements.filter(s => s.status === 'CONFIRMED' || s.status === 'PAID').length;
    const paidCount = monthSettlements.filter(s => s.status === 'PAID').length;

    return { totalCount, totalAmount, totalPaid, balance, confirmedCount, paidCount };
  }, [purchaseSettlements, selectedYm]);


  // 동적 원천 레코드 증빙 조회 (정산 항목에 없다면 원천 레코드에서 파악)
  const getItemEvidenceUrl = (item: PurchaseSettlementItem): string | undefined => {
    if (item.evidenceFileUrl && item.evidenceFileUrl !== '-' && item.evidenceFileUrl.trim() !== '') {
      return item.evidenceFileUrl;
    }
    if (item.sourceType === 'CONSUMABLE_PURCHASE') {
      const cp = consumablePurchases.find(p => p.id === item.sourceId);
      if (cp?.statementFileUrl && cp.statementFileUrl !== '-' && cp.statementFileUrl.trim() !== '') {
        return cp.statementFileUrl;
      }
    } else if (item.sourceType === 'DELIVERY') {
      const d = deliveries.find(d => d.id === item.sourceId);
      if (d?.statementFileUrl && d.statementFileUrl !== '-' && d.statementFileUrl.trim() !== '') {
        return d.statementFileUrl;
      }
    }
    return undefined;
  };

  // 증빙 열람 / 미리보기 핸들러
  const handleOpenEvidence = (url?: string, title?: string) => {
    if (!url || url === '-' || url.trim() === '') {
      showToast('첨부된 증빙 파일이 없습니다.', 'error');
      return;
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    if (url.startsWith('data:')) {
      setPreviewEvidence({ url, title: title || '거래명세서 증빙' });
      return;
    }

    showToast(`증빙 정보: ${url}`);
  };

  // 필터링된 정산 목록
  const filtered = useMemo(() => {
    return purchaseSettlements
      .filter(p => p.settlementYm === selectedYm && (typeFilter === 'ALL' || p.settlementType === typeFilter))
      .filter(p => payStatusFilter === 'ALL' || p.status === payStatusFilter)
      .filter(p => !vendorSearch || (p.vendorName || '').toLowerCase().includes(vendorSearch.toLowerCase()))
      .sort((a, b) => a.settlementType.localeCompare(b.settlementType) || a.vendorName.localeCompare(b.vendorName));
  }, [purchaseSettlements, selectedYm, typeFilter, payStatusFilter, vendorSearch]);

  // 연월 선택지 (최근 12개월)
  const ymOptions = useMemo(() => {
    const opts = [];
    const d = new Date();
    for (let i = 0; i < 12; i++) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      opts.push(`${y}-${m}`);
      d.setMonth(d.getMonth() - 1);
    }
    return opts;
  }, []);

  // 요약 집계
  const summary = useMemo(() => {
    const total = filtered.reduce((s, p) => s + p.totalAmount, 0);
    const paid  = filtered.reduce((s, p) => s + p.paidAmount, 0);
    return { total, paid, remaining: total - paid, count: filtered.length };
  }, [filtered]);

  const handleExportSettlementExcel = () => {
    if (filtered.length === 0) {
      showToast('내보낼 매입 정산 데이터가 없습니다.', 'error');
      return;
    }
    const rows = filtered.map((p, idx) => {
      const typeStr = TYPE_LABEL[p.settlementType] || p.settlementType;
      const statusStr = STATUS_LABEL[p.status]?.label || p.status;
      const itemsCount = purchaseSettlementItems.filter(item => item.settlementId === p.id).length;
      const supplyAmt = Math.round((p.totalAmount || 0) / 1.1);
      const taxAmt = (p.totalAmount || 0) - supplyAmt;
      return {
        'No': idx + 1,
        '정산ID': p.id,
        '정산연월': p.settlementYm,
        '매입유형': typeStr,
        '거래처(매입처)': p.vendorName,
        '품목수': itemsCount,
        '공급가액': supplyAmt,
        '세액': taxAmt,
        '총정산액': p.totalAmount || 0,
        '지급완료액': p.paidAmount || 0,
        '미지급잔액': (p.totalAmount || 0) - (p.paidAmount || 0),
        '지급상태': statusStr,
        '지급수단': p.paymentMethod || '-',
        '지급계좌': p.bankAccount || '-',
        '확정자': p.confirmedBy || '-',
        '확정일시': p.confirmedAt ? p.confirmedAt.replace('T', ' ').substring(0, 19) : '-',
        '비고/메모': p.memo || ''
      };
    });

    exportToExcel(rows, `매입정산대장_${selectedYm}`, '매입정산');
    showToast(`매입 정산 대장 ${rows.length}건 엑셀 내보내기 완료`);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerateResult(null);
    try {
      const result = await generateMonthlyPurchaseSettlements(selectedYm);
      const totalCount = result.transport + result.consumable + result.lease;
      if (totalCount === 0) {
        setGenerateResult('ℹ️ 집계할 신규 정산 건이 없습니다. (이미 집계되었거나 해당 월 데이터 없음)');
      } else {
        setGenerateResult(`✅ 자동 집계 완료 — 운송료 ${result.transport}건 / 소모품 ${result.consumable}건 / 임차료(전대장비) ${result.lease}건 생성`);
      }
    } catch (err: any) {
      setGenerateResult(`❌ 집계 실패: ${err?.message || err}`);
    }
    setIsGenerating(false);
  };

  const handleConfirm = async (id: string) => {
    await confirmPurchaseSettlement(id);
  };

  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  const handlePaymentSubmit = async () => {
    if (!paymentModal) return;
    const amt = parseFloat(paymentForm.paidAmount);
    if (!amt || amt <= 0) {
      showToast('지급 금액을 올바르게 입력해주세요.', 'error');
      return;
    }

    setIsSubmittingPayment(true);
    try {
      await recordPurchaseSettlementPayment(paymentModal.id, {
        paidAmount: amt,
        paymentDate: paymentForm.paymentDate,
        paymentMethod: paymentForm.paymentMethod,
        bankAccount: paymentForm.bankAccount || undefined,
        bankTransactionId: selectedBankTxId || undefined,
        memo: paymentForm.memo || undefined,
      });

      await db.awaitPendingWrites();
      showToast(`[${paymentModal.vendorName}] 매입처 ${amt.toLocaleString()}원 지급 대사 승인이 완결되었습니다.`);
      setPaymentModal(null);
      setSelectedBankTxId(null);
    } catch (err: any) {
      showErrorModal(`지급 처리 실패: ${err?.message || err}`);
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handleMemoSave = async (id: string) => {
    await savePurchaseSettlement({ id, memo: memoText });
    setMemoEditId(null);
  };

  return (
    <div style={{ padding: '20px 24px', maxWidth: '1100px', position: 'relative' }}>
      {/* 🔔 인앱 토스트 알림 (헌장 5.2) */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 9999,
          padding: '10px 18px',
          borderRadius: '6px',
          backgroundColor: toastMessage.type === 'error' ? '#ef4444' : '#10b981',
          color: '#ffffff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          fontWeight: 600,
          fontSize: '13px'
        }}>
          {toastMessage.text}
        </div>
      )}
      <h2 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '6px' }}>매입 정산 대장</h2>
      <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
        운송료·소모품·전대임차·외주정비 월별 매입처별 집계 및 통장 출금 1:1 대사
      </p>

      {/* 상단 컨트롤 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end', marginBottom: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>정산 연월</label>
          <select
            value={selectedYm}
            onChange={e => setSelectedYm(e.target.value)}
            style={{ height: '36px', fontSize: '14px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', minWidth: '130px' }}
          >
            {ymOptions.map(ym => <option key={ym} value={ym}>{ym}</option>)}
          </select>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 16px', background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '700', fontSize: '13.5px', cursor: isGenerating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
        >
          {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
          {selectedYm} 자동 집계
        </button>

        <button
          onClick={handleExportSettlementExcel}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            height: '36px',
            padding: '0 14px',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            fontWeight: '700',
            fontSize: '13px',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          <Download size={14} />
          엑셀 내보내기
        </button>

        {generateResult && (
          <div style={{ padding: '8px 14px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text-primary)' }}>
            {generateResult}
          </div>
        )}
      </div>

      {/* 유형 탭 */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {SETTLEMENT_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => setTypeFilter(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
              background: typeFilter === t.id ? 'var(--primary)' : 'var(--bg-card)',
              color: typeFilter === t.id ? '#fff' : 'var(--text-secondary)',
              border: typeFilter === t.id ? 'none' : '1px solid var(--border)',
              whiteSpace: 'nowrap',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>지급 상태</label>
          <select value={payStatusFilter} onChange={e => setPayStatusFilter(e.target.value)} style={{ padding: '5px', fontSize: '12px' }}>
            <option value="ALL">전체</option>
            <option value="PENDING">집계중</option>
            <option value="CONFIRMED">정산확정</option>
            <option value="PAID">지급완료</option>
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap' }}>매입처</label>
          <input type="text" value={vendorSearch} onChange={e => setVendorSearch(e.target.value)}
            placeholder="매입처명 검색" style={{ padding: '5px 8px', fontSize: '12px', width: '160px' }} />
        </div>
        {(payStatusFilter !== 'ALL' || vendorSearch) && (
          <button type="button" onClick={() => { setPayStatusFilter('ALL'); setVendorSearch(''); }}
            style={{ padding: '5px 10px', fontSize: '11px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', alignSelf: 'flex-end' }}>초기화</button>
        )}
      </div>

      {/* 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: '총 정산 건수',  value: `${summary.count}건`,                    color: 'var(--primary)' },
          { label: '총 청구액',     value: `${summary.total.toLocaleString()}원`,    color: '#F59E0B' },
          { label: '지급 완료액',   value: `${summary.paid.toLocaleString()}원`,     color: '#10B981' },
          { label: '미지급 잔액',   value: `${summary.remaining.toLocaleString()}원`, color: '#EF4444' },
        ].map(card => (
          <div key={card.label} className="card" style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '4px', whiteSpace: 'nowrap' }}>{card.label}</div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* 정산 목록 */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
          <AlertCircle size={32} style={{ marginBottom: '12px', opacity: 0.4 }} />
          <div>{selectedYm} 정산 데이터가 없습니다.</div>
          <div style={{ fontSize: '12.5px', marginTop: '6px' }}>위 [자동 집계] 버튼을 눌러 당월 데이터를 집계하세요.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(p => {
            const items = purchaseSettlementItems.filter(i => i.settlementId === p.id);
            const isExpanded = expandedId === p.id;
            const statusInfo = STATUS_LABEL[p.status] || { label: p.status, color: '#888' };
            const remaining = p.totalAmount - p.paidAmount;

            return (
              <div key={p.id} className="card" style={{ padding: '0', overflow: 'hidden' }}>
                {/* 헤더 행 */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', cursor: 'pointer', flexWrap: 'wrap' }}
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}
                >
                  {/* 유형 배지 */}
                  <span style={{ fontSize: '11.5px', fontWeight: '700', padding: '3px 8px', borderRadius: '12px', background: 'var(--bg-app)', color: 'var(--text-secondary)', whiteSpace: 'nowrap', border: '1px solid var(--border)' }}>
                    {TYPE_LABEL[p.settlementType] || p.settlementType}
                  </span>

                  {/* 매입처명 */}
                  <span style={{ fontWeight: '800', fontSize: '15px', flexGrow: 1, minWidth: '120px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    {p.vendorName.startsWith('http://') || p.vendorName.startsWith('https://') ? (
                      <a
                        href={p.vendorName}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ color: 'var(--primary)', textDecoration: 'underline', wordBreak: 'break-all', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        {p.vendorName} <ExternalLink size={13} />
                      </a>
                    ) : (
                      p.vendorName
                    )}
                  </span>

                  {/* 상태 뱃지 */}
                  <span style={{ fontSize: '12px', fontWeight: '700', padding: '3px 10px', borderRadius: '12px', background: statusInfo.color + '22', color: statusInfo.color, whiteSpace: 'nowrap' }}>
                    {statusInfo.label}
                  </span>

                  {/* 카드 헤더 증빙 보기 직결 버튼 */}
                  {(() => {
                    const evidences = items.map(item => ({ item, url: getItemEvidenceUrl(item) })).filter(x => !!x.url) as { item: PurchaseSettlementItem; url: string }[];
                    if (evidences.length === 0) return null;
                    return (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEvidence(evidences[0].url, evidences[0].item.itemDescription);
                        }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--primary)',
                          background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)',
                          fontSize: '12.5px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap'
                        }}
                      >
                        <Eye size={13} /> 증빙 보기 ({evidences.length}건)
                      </button>
                    );
                  })()}

                  {/* 금액 */}
                  <div style={{ textAlign: 'right', minWidth: '120px' }}>
                    <div style={{ fontSize: '16px', fontWeight: '800' }}>{p.totalAmount.toLocaleString()}원</div>
                    {p.paidAmount > 0 && (
                      <div style={{ fontSize: '11.5px', color: p.paidAmount > p.totalAmount ? 'var(--danger)' : '#10B981', fontWeight: p.paidAmount > p.totalAmount ? 'bold' : 'normal' }}>
                        {p.paidAmount > p.totalAmount ? `과지급 ${p.paidAmount.toLocaleString()}원 (+${(p.paidAmount - p.totalAmount).toLocaleString()}원)` : `지급 ${p.paidAmount.toLocaleString()}원`}
                      </div>
                    )}
                  </div>

                  {/* 아이템 수 */}
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{items.length}건</span>

                  {/* 펼치기 */}
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>

                {/* 상세 영역 */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '16px 18px', background: 'var(--bg-app)' }}>
                    {/* 라인 아이템 테이블 */}
                    {items.length > 0 && (
                      <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                          <thead>
                            <tr style={{ background: 'var(--bg-card)' }}>
                              <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: '700', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>내역</th>
                              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: '700', whiteSpace: 'nowrap', width: '80px', borderBottom: '1px solid var(--border)' }}>수량</th>
                              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: '700', whiteSpace: 'nowrap', width: '110px', borderBottom: '1px solid var(--border)' }}>단가</th>
                              <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: '700', whiteSpace: 'nowrap', width: '130px', borderBottom: '1px solid var(--border)' }}>금액</th>
                              <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: '700', whiteSpace: 'nowrap', width: '120px', borderBottom: '1px solid var(--border)' }}>증빙</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map(item => {
                              const evidenceUrl = getItemEvidenceUrl(item);
                              return (
                                <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                  <td style={{ padding: '8px 12px', textAlign: 'left' }}>{item.itemDescription}</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{item.quantity.toLocaleString()}</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{item.unitPrice.toLocaleString()}원</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: '700', whiteSpace: 'nowrap', color: 'var(--primary)' }}>{item.amount.toLocaleString()}원</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                    {evidenceUrl ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenEvidence(evidenceUrl, item.itemDescription);
                                        }}
                                        style={{
                                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                                          padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--primary)',
                                          background: 'rgba(99, 102, 241, 0.08)', color: 'var(--primary)',
                                          fontSize: '12px', fontWeight: '600', cursor: 'pointer'
                                        }}
                                      >
                                        {evidenceUrl.startsWith('http') ? <ExternalLink size={13} /> : <Eye size={13} />}
                                        증빙 보기
                                      </button>
                                    ) : (
                                      <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>없음</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* 비고 편집 */}
                    <div style={{ marginBottom: '14px' }}>
                      {memoEditId === p.id ? (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={memoText}
                            onChange={e => setMemoText(e.target.value)}
                            placeholder="비고 입력"
                            style={{ flex: 1, height: '34px', fontSize: '13px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                          />
                          <button onClick={() => handleMemoSave(p.id)} style={{ padding: '6px 12px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>저장</button>
                          <button onClick={() => setMemoEditId(null)} style={{ padding: '6px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer' }}><X size={14} /></button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', color: 'var(--text-secondary)' }}>
                          <span>비고: {p.memo || '—'}</span>
                          <button onClick={() => { setMemoEditId(p.id); setMemoText(p.memo || ''); }} style={{ fontSize: '12px', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>수정</button>
                        </div>
                      )}
                    </div>

                    {/* 액션 버튼 */}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {p.status === 'PENDING' && (
                        <button
                          onClick={() => handleConfirm(p.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', background: '#3B82F6', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13.5px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          <CheckCircle2 size={15} /> 정산 확정
                        </button>
                      )}
                      {(p.status === 'CONFIRMED' || (p.status === 'PAID' && p.paidAmount < p.totalAmount)) && remaining > 0 && (
                        <button
                          onClick={() => {
                            setSelectedBankTxId(null);
                            setPaymentModal({ id: p.id, totalAmount: p.totalAmount, paidAmount: p.paidAmount, vendorName: p.vendorName });
                            setPaymentForm(prev => ({ ...prev, paidAmount: (p.totalAmount - p.paidAmount).toString() }));
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13.5px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          <CreditCard size={15} /> 지급 처리 ({remaining.toLocaleString()}원 잔여)
                        </button>
                      )}
                      {p.status === 'PAID' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10B981', fontWeight: '700', fontSize: '13.5px' }}>
                            <CheckCircle2 size={16} /> 지급 완료 ({p.paymentDate})
                          </div>
                          {p.bankTransactionId && (
                            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10B981', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 'bold' }}>
                              🏦 통장 출금 증빙 연결됨 (Audit)
                            </span>
                          )}
                        </div>
                      )}

                      {/* 🔍 지급 대사 이력 상세 명세서 버튼 */}
                      {(p.paidAmount > 0 || p.bankTransactionId) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailModalSettlementId(p.id);
                          }}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--primary)',
                            background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)',
                            fontSize: '12.5px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap'
                          }}
                        >
                          <FileText size={14} /> 🔍 지급 대사 이력 명세서
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 통장 출금 내역 매칭 지급 대사 모달 (Audit Trail 지원) */}
      {paymentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '620px', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <h3 style={{ fontWeight: '800', fontSize: '17px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
                <CreditCard size={18} style={{ color: 'var(--primary)' }} />
                월말 매입 정산 지급 처리 & 통장 출금 대사 (Audit)
              </h3>
              <button onClick={() => { setPaymentModal(null); setSelectedBankTxId(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ backgroundColor: 'var(--bg-app)', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>매입처: </span>
                <strong style={{ fontSize: '14px', color: 'var(--primary)' }}>{paymentModal.vendorName}</strong>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>총 정산: {paymentModal.totalAmount.toLocaleString()}원 | 기지급: {paymentModal.paidAmount.toLocaleString()}원</span><br />
                <strong style={{ fontSize: '14px', color: 'var(--danger)' }}>잔여 미지급액: {(paymentModal.totalAmount - paymentModal.paidAmount).toLocaleString()}원</strong>
              </div>
            </div>

            {/* 통장 출금 내역 매칭 섹션 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12.5px', fontWeight: '800', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>🏦 등록된 통장 출금 내역 대사 매칭 (Audit 증빙):</span>
              </label>

              {(() => {
                const withdrawTxs = bankTransactions.filter(tx => (tx.withdrawAmount || 0) > 0);
                const remainingAmt = paymentModal.totalAmount - paymentModal.paidAmount;

                if (withdrawTxs.length === 0) {
                  return (
                    <div style={{ padding: '12px', borderRadius: '6px', border: '1px dashed var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
                      등록된 통장 출금 내역이 없습니다. (아래 폼에 직조 수동 입력 가능)
                    </div>
                  );
                }

                return (
                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-app)' }}>
                    {withdrawTxs.map(tx => {
                      const isSelected = selectedBankTxId === tx.id;
                      const senderText = (tx.counterparty || tx.senderName || tx.summary || '') + (tx.memo || '');
                      const isMatchVendor = senderText.includes(paymentModal.vendorName) || paymentModal.vendorName.includes(senderText);
                      const isMatchAmount = tx.withdrawAmount === remainingAmt;
                      const isPerfect = isMatchVendor && isMatchAmount;

                      return (
                        <div
                          key={tx.id}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedBankTxId(null);
                            } else {
                              setSelectedBankTxId(tx.id);
                              // 지급 금액은 기본 정산 미지급 잔액으로 추천하되, 통장 정보 자동 채움
                              setPaymentForm(prev => ({
                                ...prev,
                                paidAmount: (remainingAmt > 0 ? remainingAmt : tx.withdrawAmount).toString(),
                                paymentDate: (tx.transactionDate || '').substring(0, 10),
                                paymentMethod: '계좌이체',
                                bankAccount: (tx.bankName || '통장출금') + ' ' + (tx.counterparty || tx.senderName || ''),
                                memo: `[통장출금대사] ${tx.summary || tx.senderName || ''}`
                              }));
                            }
                          }}
                          style={{
                            padding: '8px 12px', borderRadius: '6px', cursor: 'pointer',
                            backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-card)',
                            border: isSelected ? '1px solid #10B981' : '1px solid var(--border-color)',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                              type="radio"
                              name="bankTxSelect"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedBankTxId(isSelected ? null : tx.id);
                              }}
                            />
                            <div>
                              <div style={{ fontWeight: 'bold', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>[{tx.bankName || '은행'}] {tx.counterparty || tx.senderName || '출금내역'}</span>
                                {isPerfect && (
                                  <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', backgroundColor: 'rgba(16, 185, 129, 0.2)', color: '#10B981', fontWeight: 'bold' }}>
                                    일치
                                  </span>
                                )}
                                {isMatchVendor && !isPerfect && (
                                  <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#3B82F6', fontWeight: 'bold' }}>
                                    상호 일치
                                  </span>
                                )}
                                {isMatchAmount && !isPerfect && (
                                  <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', backgroundColor: 'rgba(139, 92, 246, 0.2)', color: '#8B5CF6', fontWeight: 'bold' }}>
                                    금액 일치
                                  </span>
                                )}
                              </div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
                                출금일시: {tx.transactionDate} | 적요: {tx.summary || '-'}
                              </div>
                            </div>
                          </div>

                          <div style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--danger)', fontSize: '13px' }}>
                            -{tx.withdrawAmount.toLocaleString()}원
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* 세부 지급 정보 입력 폼 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>지급 금액 *</label>
                <input
                  type="number"
                  value={paymentForm.paidAmount}
                  onChange={e => setPaymentForm(prev => ({ ...prev, paidAmount: e.target.value }))}
                  placeholder="지급할 금액 입력"
                  style={{ height: '36px', fontSize: '13px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-primary)', fontWeight: 'bold' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>지급일 *</label>
                <input
                  type="date"
                  value={paymentForm.paymentDate}
                  onChange={e => setPaymentForm(prev => ({ ...prev, paymentDate: e.target.value }))}
                  style={{ height: '36px', fontSize: '13px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>지급 수단</label>
                <input
                  type="text"
                  value={paymentForm.paymentMethod}
                  onChange={e => setPaymentForm(prev => ({ ...prev, paymentMethod: e.target.value }))}
                  placeholder="계좌이체 / 현금 등"
                  style={{ height: '36px', fontSize: '13px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>지급 계좌 / 은행</label>
                <input
                  type="text"
                  value={paymentForm.bankAccount}
                  onChange={e => setPaymentForm(prev => ({ ...prev, bankAccount: e.target.value }))}
                  placeholder="은행명 계좌번호"
                  style={{ height: '36px', fontSize: '13px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>지급 메모</label>
              <input
                type="text"
                value={paymentForm.memo}
                onChange={e => setPaymentForm(prev => ({ ...prev, memo: e.target.value }))}
                placeholder="지급 관련 비고"
                style={{ height: '36px', fontSize: '13px', padding: '0 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-primary)' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button
                onClick={handlePaymentSubmit}
                disabled={isSubmittingPayment}
                style={{ flex: 1, height: '40px', background: isSubmittingPayment ? 'var(--text-muted)' : 'linear-gradient(135deg, #10B981 0%, #059669 100%)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', fontSize: '14px', cursor: isSubmittingPayment ? 'not-allowed' : 'pointer' }}
              >
                {isSubmittingPayment ? '⏳ 지급 대사 승인 중...' : '지급 대사 완료 승인'}
              </button>
              <button
                onClick={() => { setPaymentModal(null); setSelectedBankTxId(null); }}
                style={{ flex: 1, height: '40px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '8px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', color: 'var(--text-primary)' }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 증빙 파일 미리보기/다운로드 모달 */}
      {previewEvidence && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '20px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '12px', width: '100%', maxWidth: '900px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={18} color="var(--primary)" />
                {previewEvidence.title} 증빙 파일
              </h3>
              <button onClick={() => setPreviewEvidence(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
            </div>

            <div style={{ padding: '20px', overflowY: 'auto', flex: 1, textAlign: 'center' }}>
              {previewEvidence.url.startsWith('data:image/') || previewEvidence.url.match(/\.(jpeg|jpg|png|gif|webp)(\?.*)?$/i) ? (
                <div style={{ textAlign: 'center' }}>
                  <img src={previewEvidence.url} alt="증빙 이미지" style={{ maxWidth: '100%', maxHeight: '580px', borderRadius: '6px', border: '1px solid var(--border)', marginBottom: '16px' }} />
                  <div>
                    <a
                      href={previewEvidence.url}
                      download={`${(previewEvidence.title || '매입증빙').replace(/[^a-zA-Z0-9가-힣_-]/g, '_')}.jpg`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 18px', background: 'var(--primary)', color: '#fff', borderRadius: '6px', fontWeight: '700', textDecoration: 'none', fontSize: '13.5px' }}
                    >
                      <Download size={15} /> 원본 사진 파일 저장 (내PC/스마트폰 다운로드)
                    </a>
                  </div>
                </div>
              ) : previewEvidence.url.startsWith('data:') || previewEvidence.url.includes('pdf') ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <FileText size={16} color="var(--primary)" />
                      PDF 증빙 문서 실물 미리보기
                    </span>
                    <a
                      href={previewEvidence.url}
                      download={`${(previewEvidence.title || '매입증빙').replace(/[^a-zA-Z0-9가-힣_-]/g, '_')}.pdf`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', background: 'var(--primary)', color: '#fff', borderRadius: '6px', fontWeight: '700', textDecoration: 'none', fontSize: '12.5px' }}
                    >
                      <Download size={14} /> PDF 원본 저장
                    </a>
                  </div>
                  <div style={{ height: '600px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', background: '#525659' }}>
                    <object
                      data={previewEvidence.url}
                      type="application/pdf"
                      width="100%"
                      height="100%"
                    >
                      <iframe
                        src={previewEvidence.url}
                        title="PDF 증빙 문서 미리보기"
                        style={{ width: '100%', height: '100%', border: 'none' }}
                      />
                    </object>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '30px' }}>
                  <a
                    href={previewEvidence.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 18px', background: 'var(--primary)', color: '#fff', borderRadius: '6px', fontWeight: '700', textDecoration: 'none', fontSize: '14px' }}
                  >
                    <ExternalLink size={15} /> 증빙 URL 원본 열기
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* 🔍 지급 대사 이력 상세 명세서 모달 (1:N 구성 내역 Audit) */}
      {detailModalSettlementId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '20px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '12px', width: '100%', maxWidth: '750px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid var(--border-color)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
            {(() => {
              const targetSettlement = purchaseSettlements.find(s => s.id === detailModalSettlementId);
              if (!targetSettlement) return null;

              const targetItems = purchaseSettlementItems.filter(i => i.settlementId === targetSettlement.id);
              const targetLogs = settlementPaymentLogs.filter(l => l.settlementId === targetSettlement.id);
              const bankTx = targetSettlement.bankTransactionId ? bankTransactions.find(bt => bt.id === targetSettlement.bankTransactionId) : undefined;

              return (
                <>
                  <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--bg-app)' }}>
                    <div>
                      <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
                        <FileText size={18} color="var(--primary)" />
                        지급 대사 이력 상세 명세서 (Audit Trail)
                      </h3>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        매입처: <strong>{targetSettlement.vendorName}</strong> | 정산 연월: {targetSettlement.settlementYm}
                      </span>
                    </div>
                    <button onClick={() => setDetailModalSettlementId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
                  </div>

                  <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {/* 상단 요약 카드 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', backgroundColor: 'var(--bg-app)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>총 정산 확정액</div>
                        <div style={{ fontSize: '16px', fontWeight: '800', color: 'var(--text-main)' }}>{targetSettlement.totalAmount.toLocaleString()}원</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>누적 지급액</div>
                        <div style={{ fontSize: '16px', fontWeight: '800', color: '#10B981' }}>{targetSettlement.paidAmount.toLocaleString()}원</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>미지급 잔액</div>
                        <div style={{ fontSize: '16px', fontWeight: '800', color: 'var(--danger)' }}>{(targetSettlement.totalAmount - targetSettlement.paidAmount).toLocaleString()}원</div>
                      </div>
                    </div>

                    {/* 통장 출금 증빙 연결 이력 */}
                    {bankTx && (
                      <div style={{ padding: '12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)', fontSize: '13px' }}>
                        <div style={{ fontWeight: 'bold', color: '#10B981', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🏦 연결된 통장 출금 증빙 (Audit Log)</span>
                        </div>
                        <div><strong>출금 은행/상호:</strong> [{bankTx.bankName || '은행'}] {bankTx.counterparty || bankTx.senderName || '-'}</div>
                        <div><strong>출금 일시:</strong> {bankTx.transactionDate} | <strong>출금액:</strong> -{bankTx.withdrawAmount.toLocaleString()}원</div>
                        {bankTx.summary && <div><strong>적요/기재사항:</strong> {bankTx.summary}</div>}
                      </div>
                    )}

                    {/* 1:N 지급 분할 이력 로그 */}
                    <div>
                      <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-main)' }}>
                        💳 지급 수납 차감 이력 (분할 지급 Log)
                      </h4>
                      {targetLogs.length === 0 ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '10px', backgroundColor: 'var(--bg-app)', borderRadius: '6px' }}>
                          지급 일자: {targetSettlement.paymentDate || '-'} | 수단: {targetSettlement.paymentMethod || '계좌이체'} | 계좌: {targetSettlement.bankAccount || '-'}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {targetLogs.map((log, idx) => (
                            <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', fontSize: '12px', border: '1px solid var(--border-color)' }}>
                              <div>
                                <strong>#{idx + 1} 차수 지급:</strong> {log.paymentDate} ({log.paymentMethod}) {log.bankAccount ? `[${log.bankAccount}]` : ''}
                                {log.memo && <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>메모: {log.memo}</div>}
                              </div>
                              <div style={{ fontWeight: 'bold', color: '#10B981' }}>
                                +{log.paidAmount.toLocaleString()}원
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 📦 지급 출금액을 구성하는 1:N 라인 아이템 명세 */}
                    <div>
                      <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-main)' }}>
                        📦 이 출금액을 구성하는 매입 정산 세부 내역 (1:N 라인 항목)
                      </h4>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                        <thead>
                          <tr style={{ backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)' }}>
                            <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 'bold' }}>구분</th>
                            <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 'bold' }}>내역 설명</th>
                            <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 'bold' }}>수량/가동일</th>
                            <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 'bold' }}>단가</th>
                            <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 'bold' }}>금액</th>
                          </tr>
                        </thead>
                        <tbody>
                          {targetItems.map(item => (
                            <tr key={item.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                                <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)' }}>
                                  {item.sourceType === 'DELIVERY' ? '운송료' : item.sourceType === 'CONSUMABLE_PURCHASE' ? '소모품' : item.sourceType === 'REPAIR' ? '외주정비' : '임차료'}
                                </span>
                              </td>
                              <td style={{ padding: '8px 10px' }}>{item.itemDescription}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{item.quantity.toLocaleString()}</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{item.unitPrice.toLocaleString()}원</td>
                              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 'bold', color: 'var(--primary)' }}>{item.amount.toLocaleString()}원</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* 임차료 정산 연동 안내 */}
      {(typeFilter === 'ALL' || typeFilter === 'EQUIPMENT_LEASE') && (
        <div style={{ marginTop: '28px', padding: '16px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--text-main)', fontSize: '13px', lineHeight: '1.6' }}>
          <strong>🏢 임차(전대)장비 임차료 매입 정산 프로세스</strong><br />
          배차 관리 및 소모품 매입과 동일하게, 임차자산 관리 메뉴의 <strong>[임차처 거래명세서 대사 & 매입 정산]</strong>에서 1:1 대사를 완벽하게 검증하고 <strong>승인 확정한 내역만</strong> 본 월말 매입 정산 대장으로 전달되어 확정/지급 처리됩니다.
        </div>
      )}

      {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 회계/매입 대차대조식 검증 바 (헌장 3.5) */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 'var(--sidebar-width, 240px)',
        right: 0,
        height: '42px',
        backgroundColor: 'var(--bg-card)',
        borderTop: '2px solid var(--primary)',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        zIndex: 99,
        fontSize: '11.5px',
        fontWeight: 600
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          <span>🏢 <strong>[{selectedYm} 매입정산]:</strong> {settlementAuditSummary.totalCount}개사</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span>📄 <strong>총 청구액:</strong> ₩{settlementAuditSummary.totalAmount.toLocaleString()}원</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: 'var(--success)' }}>🟢 <strong>지급완료:</strong> ₩{settlementAuditSummary.totalPaid.toLocaleString()}원 ({settlementAuditSummary.paidCount}건)</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: settlementAuditSummary.balance > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
            ⏳ <strong>지급잔액:</strong> ₩{settlementAuditSummary.balance.toLocaleString()}원
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: settlementAuditSummary.balance === 0 && settlementAuditSummary.totalCount > 0 ? 'var(--success-light)' : 'var(--bg-app)',
            color: settlementAuditSummary.balance === 0 && settlementAuditSummary.totalCount > 0 ? 'var(--success)' : 'var(--text-main)',
            fontWeight: 700,
            fontSize: '11px'
          }}>
            ⚖️ 청구총액 = 지급완료 + 지급잔액 (대차 무결)
          </span>
        </div>
      </div>

      <div style={{ height: '80px' }} aria-hidden="true" />
    </div>
  );
};
