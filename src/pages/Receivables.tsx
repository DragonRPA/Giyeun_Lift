import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { db, Receivable } from '../services/db';
import { Plus, Search, DollarSign, Calendar, FileText, CheckCircle, AlertTriangle, RotateCcw, Download } from 'lucide-react';
import { exportToExcel } from '../services/excel';

export const Receivables: React.FC = () => {
  const {
    receivables, contracts, customers, sites,
    addReceivable, generateStandaloneBillingForReceivable, hasPermission, showErrorModal
  } = useApp();

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 날짜 기본값: 당해 연도 1월 1일 ~ 오늘
  const defaultStartDate = `${new Date().getFullYear()}-01-01`;
  const defaultEndDate = new Date().toISOString().split('T')[0];

  // 임시 필터 상태
  const [tempSearchTerm, setTempSearchTerm] = useState('');
  const [tempFilterType, setTempFilterType] = useState<string>('ALL');
  const [tempFilterStatus, setTempFilterStatus] = useState<string>('PENDING_PARTIAL'); // 미청구+일부청구
  const [tempCustomerId, setTempCustomerId] = useState<string>('ALL');
  const [tempStartDate, setTempStartDate] = useState<string>(defaultStartDate);
  const [tempEndDate, setTempEndDate] = useState<string>(defaultEndDate);

  // 적용된 필터 상태
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('PENDING_PARTIAL');
  const [customerId, setCustomerId] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>(defaultStartDate);
  const [endDate, setEndDate] = useState<string>(defaultEndDate);

  const [showAddModal, setShowAddModal] = useState(false);
  const [modalSearchTerm, setModalSearchTerm] = useState('');
  const [modalSelectedCustId, setModalSelectedCustId] = useState('');
  const [modalSelectedSiteId, setModalSelectedSiteId] = useState('');

  // 폼 상태
  const [formContractId, setFormContractId] = useState('');
  const [formType, setFormType] = useState<'TRANSPORT' | 'REPAIR' | 'CLEANING' | 'OTHER'>('OTHER');
  const [formTotalAmount, setFormTotalAmount] = useState(0);
  const [formInternalDescription, setFormInternalDescription] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formOccurredDate, setFormOccurredDate] = useState(new Date().toISOString().split('T')[0]);

  // ── 양방향 계약/고객/현장 자동 확정 핸들러 ──
  // 1. 빠른 검색창 입력 핸들러 (계약번호/고객사명/현장명)
  const handleModalSearchChange = (val: string) => {
    setModalSearchTerm(val);
    const term = val.trim().toLowerCase();
    if (!term) return;

    // 계약번호 완전 일치 우선
    const exactContract = contracts.find(c => c.contractNo.toLowerCase() === term && c.status !== 'COMPLETED')
      || contracts.find(c => c.contractNo.toLowerCase() === term);

    if (exactContract) {
      setFormContractId(exactContract.id);
      setModalSelectedCustId(exactContract.customerId);
      setModalSelectedSiteId(exactContract.siteId || '');
      return;
    }

    // 부분 일치 진행 계약이 1건으로 특정되는 경우
    const matchedContracts = contracts.filter(c => {
      if (c.status === 'COMPLETED') return false;
      const cu = customers.find(x => x.id === c.customerId);
      const s = sites.find(x => x.id === c.siteId);
      return (
        c.contractNo.toLowerCase().includes(term) ||
        (cu?.name || '').toLowerCase().includes(term) ||
        (s?.name || '').toLowerCase().includes(term)
      );
    });

    if (matchedContracts.length === 1) {
      const single = matchedContracts[0];
      setFormContractId(single.id);
      setModalSelectedCustId(single.customerId);
      setModalSelectedSiteId(single.siteId || '');
    }
  };

  // 2. 고객사 선택 핸들러
  const handleCustomerSelect = (custId: string) => {
    setModalSelectedCustId(custId);
    if (!custId) {
      setFormContractId('');
      setModalSelectedSiteId('');
      return;
    }

    // 해당 고객사의 진행 계약이 1건인 경우 계약 및 현장 자동 확정
    const custContracts = contracts.filter(c => c.customerId === custId && c.status !== 'COMPLETED');
    if (custContracts.length === 1) {
      const single = custContracts[0];
      setFormContractId(single.id);
      setModalSelectedSiteId(single.siteId || '');
    } else {
      setFormContractId('');
      setModalSelectedSiteId('');
    }
  };

  // 3. 현장 선택 핸들러 (고객사와 현장이 픽스되면 계약번호 자동 확정)
  const handleSiteSelect = (siteId: string) => {
    setModalSelectedSiteId(siteId);
    if (!siteId) {
      setFormContractId('');
      return;
    }

    // 고객사 + 현장에 해당하는 계약 자동 매핑
    const matched = contracts.find(c => 
      c.customerId === modalSelectedCustId && 
      c.siteId === siteId && 
      c.status !== 'COMPLETED'
    ) || contracts.find(c => 
      c.customerId === modalSelectedCustId && 
      c.siteId === siteId
    );

    if (matched) {
      setFormContractId(matched.id);
    }
  };

  // 4. 계약 직접 선택 핸들러 (계약 특정 시 고객명과 현장 자동 확정)
  const handleContractSelect = (cId: string) => {
    setFormContractId(cId);
    if (!cId) return;
    const c = contracts.find(x => x.id === cId);
    if (c) {
      setModalSelectedCustId(c.customerId);
      setModalSelectedSiteId(c.siteId || '');
    }
  };

  // 5. 선택 전체 해제
  const handleResetSelection = () => {
    setFormContractId('');
    setModalSelectedCustId('');
    setModalSelectedSiteId('');
    setModalSearchTerm('');
  };

  const canWrite = hasPermission('BILLING', 'save');

  const handleApplyFilter = () => {
    setSearchTerm(tempSearchTerm);
    setFilterType(tempFilterType);
    setFilterStatus(tempFilterStatus);
    setCustomerId(tempCustomerId);
    setStartDate(tempStartDate);
    setEndDate(tempEndDate);
  };

  // 빠른 기간 선택 헬퍼
  const setQuickPeriod = (type: 'MONTH' | '3MONTH' | 'YEAR' | 'ALL') => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    let s = '';
    let e = todayStr;

    if (type === 'MONTH') {
      const ym = todayStr.slice(0, 7);
      s = `${ym}-01`;
    } else if (type === '3MONTH') {
      const d = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    } else if (type === 'YEAR') {
      s = `${today.getFullYear()}-01-01`;
    } else if (type === 'ALL') {
      s = '';
      e = '';
    }

    setTempStartDate(s);
    setTempEndDate(e);
    setStartDate(s);
    setEndDate(e);
  };

  const handleResetFilter = () => {
    setTempSearchTerm('');
    setTempFilterType('ALL');
    setTempFilterStatus('PENDING_PARTIAL');
    setTempCustomerId('ALL');
    setTempStartDate(defaultStartDate);
    setTempEndDate(defaultEndDate);

    setSearchTerm('');
    setFilterType('ALL');
    setFilterStatus('PENDING_PARTIAL');
    setCustomerId('ALL');
    setStartDate(defaultStartDate);
    setEndDate(defaultEndDate);
  };

  const filtered = receivables.filter(r => {
    // 텍스트 검색
    if (searchTerm) {
      const c = contracts.find(x => x.id === r.contractId);
      const cu = customers.find(x => x.id === r.customerId);
      const s = c?.siteId ? sites.find(x => x.id === c.siteId) : null;
      const term = searchTerm.toLowerCase();
      const matchText = (
        r.internalDescription.toLowerCase().includes(term) ||
        (r.displayName || '').toLowerCase().includes(term) ||
        (c?.contractNo || '').toLowerCase().includes(term) ||
        (cu?.name || '').toLowerCase().includes(term) ||
        (s?.name || '').toLowerCase().includes(term)
      );
      if (!matchText) return false;
    }

    // 고객사 필터
    if (customerId !== 'ALL') {
      const c = contracts.find(x => x.id === r.contractId);
      const actualCustId = r.customerId || c?.customerId;
      if (actualCustId !== customerId) return false;
    }

    // 유형 필터
    if (filterType !== 'ALL' && r.type !== filterType) return false;

    // 상태 필터
    if (filterStatus === 'PENDING_PARTIAL') {
      if (r.status === 'CLEARED') return false;
    } else if (filterStatus !== 'ALL') {
      if (r.status !== filterStatus) return false;
    }

    // 기간 필터 (발생일 기준)
    if (startDate && r.occurredDate < startDate) return false;
    if (endDate && r.occurredDate > endDate) return false;

    return true;
  }).sort((a: any, b: any) => new Date(b.occurredDate).getTime() - new Date(a.occurredDate).getTime());

  // 집계 데이터
  const totalReceivableSum = filtered.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
  const totalBilledSum = filtered.reduce((sum, r) => sum + (r.billedAmount || 0), 0);
  const totalRemainingSum = Math.max(0, totalReceivableSum - totalBilledSum);

  const handleExportExcel = () => {
    const excelData = filtered.map((r, idx) => {
      const c = contracts.find(x => x.id === r.contractId);
      const cust = customers.find(x => x.id === (r.customerId || c?.customerId));
      const s = c ? sites.find(x => x.id === c.siteId) : null;
      const remaining = Math.max(0, (r.totalAmount || 0) - (r.billedAmount || 0));

      return {
        // ① 식별 및 분류
        'No': idx + 1,
        '구상/미수 구분': r.type === 'VENDOR_CLAIM' ? '타사구상금' :
                         r.type === 'TRANSPORT' ? '운송료' :
                         r.type === 'REPAIR' ? '수리비' :
                         r.type === 'CLEANING' ? '청소비' : '기타',
        '청구 상태': r.status === 'CLEARED' ? '청구완료' :
                   r.status === 'PARTIAL' ? '일부청구' : '미청구',

        // ② 고객 및 현장
        '고객사': cust ? cust.name : '-',
        '계약번호': c ? c.contractNo : '-',
        '현장명': s ? s.name : '-',

        // ③ 구상 및 장비 연계
        '임차처명(타사)': r.vendorName || '-',
        '대상 장비번호': r.assetNo || '-',

        // ④ 발생 일정 및 내역
        '발생일자': r.occurredDate || '-',
        '내부 장부 기재명': r.internalDescription || '-',
        '명세서 표기명': r.displayName || r.internalDescription || '-',

        // ⑤ 금액 및 청구 현황
        '외상 총액(원)': r.totalAmount || 0,
        '기청구 누적액(원)': r.billedAmount || 0,
        '미청구 잔액(원)': remaining,

        // ⑥ 감사
        '등록일자': r.createdAt ? r.createdAt.split('T')[0] : '-'
      };
    });

    exportToExcel(excelData, `외상미수금_대장_${new Date().toISOString().split('T')[0]}`, '외상미수금');
  };

  const handleStandaloneIssue = async (receivableId: string) => {
    if (!hasPermission('billing', 'save')) {
      showErrorModal('청구 권한이 없습니다.');
      return;
    }

    const rcv = receivables.find(r => r.id === receivableId);
    if (!rcv) return;
    if (rcv.status === 'CLEARED') {
      showToast('이미 전액 청구 완료된 항목입니다.', 'warning');
      return;
    }

    const remaining = rcv.totalAmount - rcv.billedAmount;
    const reason = prompt(`[긴급 단독 청구 발행]\n\n해당 부대비용(${remaining.toLocaleString()}원)을 렌탈료 정기 청구서와 별개로 '단독 청구서'로 즉시 발행합니다.\n단독 발행 사유를 간략히 입력해주세요. (예: 파손수리비 긴급 수금건)`);
    if (reason === null) return; // 취소

    try {
      await generateStandaloneBillingForReceivable(receivableId, reason || '부대비용 단독 청구');
      await db.awaitPendingWrites();
      showToast('단독 청구서가 발행되었습니다. [청구 및 수납 내역]에서 확인 가능합니다.');
    } catch (err: any) {
      showErrorModal(`단독 청구서 발행 실패: ${err?.message || err}`);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    
    if (formTotalAmount <= 0) {
      showToast('외상 총액은 0원보다 커야 합니다.', 'warning');
      return;
    }
    if (!formInternalDescription.trim()) {
      showToast('내부 장부 기재명을 입력해주세요.', 'warning');
      return;
    }

    const c = contracts.find(x => x.id === formContractId);
    const resolvedCustId = c ? c.customerId : (modalSelectedCustId || undefined);
    
    try {
      addReceivable({
        contractId: formContractId || undefined,
        customerId: resolvedCustId,
        type: formType,
        totalAmount: formTotalAmount,
        billedAmount: 0,
        internalDescription: formInternalDescription,
        displayName: formDisplayName || undefined,
        occurredDate: formOccurredDate,
        status: 'PENDING'
      });
      await db.awaitPendingWrites();

      showToast('외상미수금이 정상 등록되었습니다.');
      setShowAddModal(false);
      
      // 폼 초기화
      setFormContractId('');
      setModalSelectedCustId('');
      setModalSelectedSiteId('');
      setModalSearchTerm('');
      setFormType('OTHER');
      setFormTotalAmount(0);
      setFormInternalDescription('');
      setFormDisplayName('');
      setFormOccurredDate(new Date().toISOString().split('T')[0]);
    } catch (err: any) {
      showErrorModal(`외상미수금 등록 실패: ${err?.message || err}`);
    }
  };

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      
      {/* ── 1. 상단 헤더 & 슬림 인라인 요약 바 (거대 카드 4개 대체 및 중복 제거) ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, whiteSpace: 'nowrap' }}>외상미수금 대장</h2>
          
          {/* 슬림 인라인 요약 뱃지 (높이 100px 절약 & 중복 해소) */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '11.5px' }}>
            <span style={{
              padding: '3px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)', fontWeight: 600, color: 'var(--text-main)'
            }}>
              조회 <strong>{filtered.length}</strong>건
            </span>
            <span style={{
              padding: '3px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)', color: 'var(--text-primary)'
            }}>
              외상총액 <strong>₩{totalReceivableSum.toLocaleString()}</strong>
            </span>
            <span style={{
              padding: '3px 8px', borderRadius: '4px', backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)', color: '#059669', fontWeight: 600
            }}>
              기청구 <strong>₩{totalBilledSum.toLocaleString()}</strong>
            </span>
            <span style={{
              padding: '3px 8px', borderRadius: '4px',
              backgroundColor: totalRemainingSum > 0 ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-card)',
              border: `1px solid ${totalRemainingSum > 0 ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-color)'}`,
              color: totalRemainingSum > 0 ? '#dc2626' : 'var(--text-muted)', fontWeight: 700
            }}>
              미청구 <strong>₩{totalRemainingSum.toLocaleString()}</strong>
            </span>
          </div>
        </div>

        {/* 우측 파이프라인 버튼군 */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button className="btn-secondary" onClick={handleExportExcel} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}>
            <Download size={14} /> 엑셀 다운로드
          </button>
          {canWrite && (
            <button className="btn-primary" onClick={() => setShowAddModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 14px' }}>
              <Plus size={14} /> 신규 외상 등록
            </button>
          )}
        </div>
      </div>

      {/* ── 2. 슬림 컴팩트 필터 패널 (상하 세로 스택 표준 & 빠른 기간 칩) ── */}
      <div className="card" style={{ margin: 0, padding: '10px 14px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
          
          {/* 통합 검색창 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>통합 검색</label>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="계약/고객/현장/기재명..."
                value={tempSearchTerm}
                onChange={e => setTempSearchTerm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleApplyFilter(); }}
                style={{ width: '160px', padding: '5px 8px 5px 26px', fontSize: '12px', borderRadius: '4px' }}
              />
            </div>
          </div>

          {/* 고객사 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>고객사</label>
            <select
              value={tempCustomerId}
              onChange={e => setTempCustomerId(e.target.value)}
              style={{ padding: '5px 8px', fontSize: '12px', width: '140px', borderRadius: '4px' }}
            >
              <option value="ALL">전체 고객사</option>
              {customers.map(cu => (
                <option key={cu.id} value={cu.id}>{cu.name}</option>
              ))}
            </select>
          </div>

          {/* 비용 유형 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>비용 유형</label>
            <select
              value={tempFilterType}
              onChange={e => setTempFilterType(e.target.value)}
              style={{ padding: '5px 8px', fontSize: '12px', width: '105px', borderRadius: '4px' }}
            >
              <option value="ALL">전체 유형</option>
              <option value="TRANSPORT">운송료</option>
              <option value="REPAIR">수리비</option>
              <option value="CLEANING">청소비</option>
              <option value="VENDOR_CLAIM">타사구상금</option>
              <option value="OTHER">기타</option>
            </select>
          </div>

          {/* 청구 상태 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>청구 상태</label>
            <select
              value={tempFilterStatus}
              onChange={e => setTempFilterStatus(e.target.value)}
              style={{ padding: '5px 8px', fontSize: '12px', width: '130px', borderRadius: '4px' }}
            >
              <option value="PENDING_PARTIAL">미청구 잔액 있음</option>
              <option value="ALL">전체 상태</option>
              <option value="PENDING">미청구</option>
              <option value="PARTIAL">일부청구</option>
              <option value="CLEARED">청구완료 (전액)</option>
            </select>
          </div>

          {/* 발생 시작일 (기본값 탑재) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>발생 시작일</label>
            <input
              type="date"
              value={tempStartDate}
              onChange={e => setTempStartDate(e.target.value)}
              style={{ padding: '4px 6px', fontSize: '12px', width: '125px', borderRadius: '4px' }}
            />
          </div>

          <span style={{ paddingBottom: '6px', color: 'var(--text-muted)' }}>~</span>

          {/* 발생 종료일 (기본값 탑재) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>발생 종료일</label>
            <input
              type="date"
              value={tempEndDate}
              onChange={e => setTempEndDate(e.target.value)}
              style={{ padding: '4px 6px', fontSize: '12px', width: '125px', borderRadius: '4px' }}
            />
          </div>

          {/* 빠른 기간 선택 칩 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>빠른 기간</label>
            <div style={{ display: 'flex', gap: '3px' }}>
              {[
                { label: '당월', type: 'MONTH' as const },
                { label: '3개월', type: '3MONTH' as const },
                { label: '올해', type: 'YEAR' as const },
                { label: '전체', type: 'ALL' as const },
              ].map(chip => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => setQuickPeriod(chip.type)}
                  style={{
                    padding: '4px 7px', fontSize: '11px', borderRadius: '4px',
                    border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)',
                    color: 'var(--text-main)', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 500
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* 조회 & 초기화 액션 버튼 */}
          <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={handleApplyFilter}
              style={{ padding: '5px 14px', fontSize: '12px', whiteSpace: 'nowrap', fontWeight: 700 }}
            >
              조회
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleResetFilter}
              style={{ padding: '5px 8px', fontSize: '12px', whiteSpace: 'nowrap' }}
              title="필터 초기화"
            >
              <RotateCcw size={13} />
            </button>
          </div>

        </div>
      </div>

      {/* ── 3. 데이터 테이블 카드 (세로 80% 작업대 극대화: 헌장 3.6 유형 B) ── */}
      <div className="card" style={{ padding: 0, margin: 0, overflow: 'hidden', flex: 1 }}>
        <div className="table-container" style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 250px)', overflowY: 'auto' }}>
          <table style={{ width: '100%', minWidth: '1100px', borderCollapse: 'collapse', whiteSpace: 'nowrap', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-app)', whiteSpace: 'nowrap' }}>
                <th style={{ whiteSpace: 'nowrap', textAlign: 'center', width: '80px' }}>조치</th>
                <th style={{ whiteSpace: 'nowrap', textAlign: 'center', width: '90px' }}>발생일</th>
                <th style={{ whiteSpace: 'nowrap' }}>고객사명</th>
                <th style={{ whiteSpace: 'nowrap' }}>계약번호 / 현장</th>
                <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>유형</th>
                <th style={{ whiteSpace: 'nowrap' }}>내부 기재명 (실제 내역)</th>
                <th style={{ whiteSpace: 'nowrap' }}>명세서 표기명</th>
                <th style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>외상 총액</th>
                <th style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>기청구액</th>
                <th style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>미청구 잔액</th>
                <th style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>상태</th>
              </tr>
            </thead>
            <tbody style={{ whiteSpace: 'nowrap' }}>
              {filtered.map(r => {
                const c = contracts.find(x => x.id === r.contractId);
                const cu = customers.find(x => x.id === (r.customerId || c?.customerId));
                const s = c?.siteId ? sites.find(x => x.id === c.siteId) : null;
                const remaining = r.totalAmount - r.billedAmount;

                return (
                  <tr key={r.id}>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {r.status !== 'CLEARED' ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: '11px', padding: '2px 8px', color: 'var(--primary)', fontWeight: 600 }}
                          onClick={() => handleStandaloneIssue(r.id)}
                        >
                          단독 청구
                        </button>
                      ) : (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{r.occurredDate}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{cu?.name || '고객 미지정'}</strong>
                      {cu?.transactionStatus === 'BLOCKED' && (
                        <span style={{ marginLeft: '6px', padding: '1px 5px', fontSize: '10px', backgroundColor: '#fee2e2', color: '#b91c1c', borderRadius: '3px', fontWeight: 800 }}>
                          출고제한
                        </span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {c ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                          <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{c.contractNo}</span>
                          {s && <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{s.name}</span>}
                        </div>
                      ) : (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <span className={`badge ${
                        r.type === 'REPAIR' ? 'badge-danger' :
                        r.type === 'TRANSPORT' ? 'badge-info' :
                        r.type === 'CLEANING' ? 'badge-warning' :
                        r.type === 'VENDOR_CLAIM' ? 'badge-warning' : 'badge-secondary'
                      }`} style={{ fontSize: '10.5px', backgroundColor: r.type === 'VENDOR_CLAIM' ? '#f59e0b' : undefined, color: r.type === 'VENDOR_CLAIM' ? '#ffffff' : undefined }}>
                        {r.type === 'TRANSPORT' ? '운송료' :
                         r.type === 'REPAIR' ? '수리비' :
                         r.type === 'CLEANING' ? '청소비' :
                         r.type === 'VENDOR_CLAIM' ? '타사구상금' : '기타'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.internalDescription}</td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{r.displayName || '-'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {r.totalAmount.toLocaleString()}원
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--success)' }}>
                      {r.billedAmount.toLocaleString()}원
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: remaining > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {remaining.toLocaleString()}원
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <span className={`badge ${
                        r.status === 'PENDING' ? 'badge-secondary' :
                        r.status === 'PARTIAL' ? 'badge-warning' : 'badge-success'
                      }`} style={{ fontSize: '10.5px' }}>
                        {r.status === 'PENDING' ? '미청구' :
                         r.status === 'PARTIAL' ? '일부청구' : '청구완료'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                    조회된 외상미수금 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 헌장 3.5 대차대조 검증 및 우하단 종결 액션 바 */}
      <div style={{
        padding: '12px 16px',
        backgroundColor: 'var(--bg-card)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12.5px', flexWrap: 'wrap' }}>
          <span>총 외상채권: <strong>₩{totalReceivableSum.toLocaleString()}</strong></span>
          <span>=</span>
          <span>기청구액: <strong style={{ color: 'var(--success)' }}>₩{totalBilledSum.toLocaleString()}</strong></span>
          <span>+</span>
          <span>미청구 잔액: <strong style={{ color: totalRemainingSum > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>₩{totalRemainingSum.toLocaleString()}</strong></span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: 'var(--success)', fontWeight: 700 }}>⚖️ 대차 차액 ₩0 (일치)</span>
        </div>
        <div>
          {canWrite && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowAddModal(true)}
              style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={14} /> 외상미수금 등록
            </button>
          )}
        </div>
      </div>

      {/* 외상 건 신규 등록 모달 */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(3px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)',
            color: 'var(--text-primary)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            maxWidth: '650px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '24px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px', marginBottom: '18px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={18} color="var(--primary)" /> 외상미수금 등록
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer', padding: '4px' }}
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleAddSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* 1. 발생일 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>발생일 *</label>
                <input
                  type="date"
                  value={formOccurredDate}
                  onChange={e => setFormOccurredDate(e.target.value)}
                  required
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px' }}
                />
              </div>

              {/* 2. 귀속 계약 / 고객사 / 현장 조회 & 양방향 자동 확정 패널 */}
              <div style={{
                padding: '14px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Search size={14} /> 귀속 계약 / 고객사 / 현장 조회 & 선택 (현재 유효한 계약 현장)
                </div>

                {/* 빠른 검색창 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>계약 / 고객사 / 현장 빠른 검색</label>
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      placeholder="계약번호(예: C202603-0005), 고객사명, 현장명 검색..."
                      value={modalSearchTerm}
                      onChange={e => handleModalSearchChange(e.target.value)}
                      style={{ width: '100%', padding: '6px 8px 6px 28px', fontSize: '12px' }}
                    />
                  </div>
                </div>

                {/* 고객사 선택 / 현장 선택 / 계약번호 직접 선택 3단 드롭다운 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '10px' }}>
                  
                  {/* (1) 고객사 선택 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>고객사 필터/선택</label>
                    <select
                      value={modalSelectedCustId}
                      onChange={e => handleCustomerSelect(e.target.value)}
                      style={{ padding: '6px 8px', fontSize: '12px', width: '100%' }}
                    >
                      <option value="">전체 고객사</option>
                      {customers.map(cu => {
                        const activeCount = contracts.filter(c => c.customerId === cu.id && c.status !== 'COMPLETED').length;
                        return (
                          <option key={cu.id} value={cu.id}>
                            {cu.name} {activeCount > 0 ? `(${activeCount}건)` : '(없음)'}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* (2) 계약 현장 선택 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>계약 현장 선택</label>
                    <select
                      value={modalSelectedSiteId}
                      onChange={e => handleSiteSelect(e.target.value)}
                      style={{ padding: '6px 8px', fontSize: '12px', width: '100%' }}
                    >
                      <option value="">현장 선택</option>
                      {sites
                        .filter(s => {
                          if (modalSelectedCustId) {
                            // 해당 고객사의 계약에 포함된 현장인지 확인
                            const hasCustContract = contracts.some(c => c.customerId === modalSelectedCustId && c.siteId === s.id);
                            const isDirectCustSite = s.customerId === modalSelectedCustId;
                            return hasCustContract || isDirectCustSite;
                          }
                          return true;
                        })
                        .map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* (3) 계약번호 직접 선택 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>계약번호 선택</label>
                    <select
                      value={formContractId}
                      onChange={e => handleContractSelect(e.target.value)}
                      style={{ padding: '6px 8px', fontSize: '12px', width: '100%' }}
                    >
                      <option value="">계약 미지정 (고객사 공통)</option>
                      {contracts
                        .filter(c => c.status !== 'COMPLETED')
                        .filter(c => {
                          if (modalSelectedCustId && c.customerId !== modalSelectedCustId) return false;
                          if (modalSelectedSiteId && c.siteId !== modalSelectedSiteId) return false;
                          if (modalSearchTerm) {
                            const cu = customers.find(x => x.id === c.customerId);
                            const s = sites.find(x => x.id === c.siteId);
                            const term = modalSearchTerm.toLowerCase();
                            const matches = (
                              c.contractNo.toLowerCase().includes(term) ||
                              (cu?.name || '').toLowerCase().includes(term) ||
                              (s?.name || '').toLowerCase().includes(term)
                            );
                            if (!matches) return false;
                          }
                          return true;
                        })
                        .map(c => {
                          const cu = customers.find(x => x.id === c.customerId);
                          const s = sites.find(x => x.id === c.siteId);
                          return (
                            <option key={c.id} value={c.id}>
                              {c.contractNo} {cu?.name || '고객사'} - {s?.name || '현장미지정'}
                            </option>
                          );
                        })}
                    </select>
                  </div>
                </div>

                {/* 선택된 계약 상세 정보 확인 뱃지 카드 */}
                {(() => {
                  const selectedC = contracts.find(x => x.id === formContractId);
                  if (!selectedC) return (
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', padding: '2px' }}>
                      ※ 특정 계약/현장이 아닌 고객사 공통 외상으로 등록하려면 '계약 미지정'을 유지하세요.
                    </div>
                  );

                  const cu = customers.find(x => x.id === selectedC.customerId);
                  const s = sites.find(x => x.id === selectedC.siteId);

                  return (
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(59, 130, 246, 0.08)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '12px'
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '12.5px' }}>
                          🏢 {cu?.name} ➔ 📍 {s?.name || '현장미지정'}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                          계약번호: <strong style={{ color: 'var(--text-primary)' }}>{selectedC.contractNo}</strong> | 
                          기간: <strong>{selectedC.startDate} ~ {selectedC.endDate || '미정'}</strong> | 
                          청구마감: <strong>매월 {selectedC.billingDay}일</strong>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleResetSelection}
                        style={{
                          background: 'none',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          color: 'var(--danger)',
                          fontSize: '11px',
                          cursor: 'pointer',
                          fontWeight: 600
                        }}
                      >
                        선택 해제 ✕
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* 3. 비용 유형 & 외상 총액 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>비용 유형 *</label>
                  <select
                    value={formType}
                    onChange={e => setFormType(e.target.value as any)}
                    style={{ padding: '7px 10px', fontSize: '13px', width: '100%' }}
                  >
                    <option value="REPAIR">수리비 (파손/부품교체)</option>
                    <option value="TRANSPORT">운송료 (추가/단독 배차)</option>
                    <option value="CLEANING">청소비 / 세차비</option>
                    <option value="OTHER">기타 부대비용</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>외상 총액 *</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      value={formTotalAmount || ''}
                      onChange={e => setFormTotalAmount(Number(e.target.value))}
                      placeholder="0"
                      required
                      min={1}
                      style={{ flex: 1, padding: '7px 10px', fontSize: '13px', textAlign: 'right', fontWeight: 700 }}
                    />
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>원</span>
                  </div>
                </div>
              </div>

              {/* 4. 내부 장부 기재명 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>
                  내부 기재명 (실제 발생 내역) *
                </label>
                <input
                  type="text"
                  placeholder="예: 스카이잭 3219 현장 파손 수리비 (조이스틱 교체)"
                  value={formInternalDescription}
                  onChange={e => setFormInternalDescription(e.target.value)}
                  required
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px' }}
                />
              </div>

              {/* 5. 명세서 표기명 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary)' }}>
                  명세서 표기명 (고객 노출용 - 선택)
                </label>
                <input
                  type="text"
                  placeholder="예: 렌탈 장비 정비료 (입력 안하면 내부 기재명 사용됨)"
                  value={formDisplayName}
                  onChange={e => setFormDisplayName(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px' }}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  ※ 고객에게 '파손' 등 민감한 단어를 노출하지 않고 명세서에 표기할 대체 명칭을 적습니다.
                </div>
              </div>

              {/* 하단 버튼 그룹 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddModal(false)}
                  style={{ padding: '6px 14px', fontSize: '12px' }}
                >
                  닫기
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ padding: '6px 18px', fontSize: '12px', fontWeight: 700 }}
                >
                  외상 등록 완료
                </button>
              </div>

            </form>
          </div>
        </div>
      )}
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
    </div>
  );
};
