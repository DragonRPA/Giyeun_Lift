// src/pages/ConsumablePurchasesPage.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  ShoppingCart, Plus, ClipboardList, Download, Search, RefreshCw, 
  CheckCircle2, XCircle, Clock, FileText, Check, AlertCircle, AlertTriangle,
  ExternalLink
} from 'lucide-react';
import { exportToExcel } from '../services/excel';
import { ConsumablePurchaseRequest, db } from '../services/db';

export const ConsumablePurchasesPage: React.FC = () => {
  const {
    consumables,
    consumablePurchases,
    requestConsumablePurchase,
    acceptConsumablePurchase,
    completeConsumablePurchase,
    hasPermission,
    currentUser,
    showErrorModal
  } = useApp();

  const canSave = hasPermission('consumable_purchase', 'save') || hasPermission('consumable', 'save');

  // 활성 탭: REQ_WRITE (구매신청등록) | REQ_LIST (구매신청대장)
  const [activeTab, setActiveTab] = useState<'REQ_WRITE' | 'REQ_LIST'>('REQ_LIST');

  // 토스트 알림 상태
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // --- 1. 구매신청 작성 폼 상태 ---
  const [reqConsumableId, setReqConsumableId] = useState('NEW');
  const [reqModelName, setReqModelName] = useState('');
  const [reqQty, setReqQty] = useState(1);
  const [reqUnitPrice, setReqUnitPrice] = useState(0);
  const [reqDate, setReqDate] = useState(new Date().toISOString().split('T')[0]);
  const [reqSellerName, setReqSellerName] = useState('');
  const [reqUrgency, setReqUrgency] = useState<'NORMAL' | 'URGENT'>('NORMAL');
  const [reqPurpose, setReqPurpose] = useState('');

  // --- 2. 구매신청 대장 필터 상태 ---
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'REQUESTED' | 'ACCEPTED' | 'COMPLETED'>('ALL');
  const thisMonthStart = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; })();
  const thisMonthEnd = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()).padStart(2,'0')}`; })();
  const [startDate, setStartDate] = useState(thisMonthStart);
  const [endDate, setEndDate] = useState(thisMonthEnd);

  // 구매 신청 통계 요약 (Z-패턴 상단 Scope)
  const purchaseSummary = useMemo(() => {
    const ym = new Date().toISOString().substring(0, 7);
    const thisMonth = consumablePurchases.filter(p => p.requestDate?.startsWith(ym));
    const totalRequested = thisMonth.length;
    const pendingCount = thisMonth.filter(p => p.status === 'REQUESTED').length;
    const completedCount = thisMonth.filter(p => p.status === 'COMPLETED').length;
    const totalAmount = thisMonth.reduce((sum, p) => sum + (p.requestedQty * (p.unitPrice || 0)), 0);
    return { totalRequested, pendingCount, completedCount, totalAmount };
  }, [consumablePurchases]);

  // 필터링된 구매신청 목록
  const filteredPurchases = useMemo(() => {
    return consumablePurchases.filter(p => {
      const matchSearch = !searchTerm || 
        (p.modelName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
        (p.sellerName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.requesterName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.id || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchStatus = statusFilter === 'ALL' || p.status === statusFilter;
      const matchDate = (!startDate || p.requestDate >= startDate) && (!endDate || p.requestDate <= endDate);

      return matchSearch && matchStatus && matchDate;
    }).sort((a, b) => b.requestDate.localeCompare(a.requestDate));
  }, [consumablePurchases, searchTerm, statusFilter, startDate, endDate]);

  // 구매신청서 제출 핸들러
  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqModelName.trim()) {
      showToast('품목명을 입력해 주세요.', 'error');
      return;
    }
    if (reqQty <= 0) {
      showToast('수량은 1개 이상이어야 합니다.', 'error');
      return;
    }
    if (!reqSellerName.trim()) {
      showToast('공급처/구매처를 입력해 주세요.', 'error');
      return;
    }

    try {
      await requestConsumablePurchase({
        consumableId: reqConsumableId === 'NEW' ? undefined : reqConsumableId,
        modelName: reqModelName.trim(),
        qty: reqQty,
        unitPrice: reqUnitPrice,
        requestDate: reqDate,
        sellerName: reqSellerName.trim()
      });
      await db.awaitPendingWrites();

      showToast(`구매 신청서가 제출되었습니다. (${reqModelName}, ${reqQty}개)`);
      setActiveTab('REQ_LIST');
      
      // 폼 초기화
      setReqConsumableId('NEW');
      setReqModelName('');
      setReqQty(1);
      setReqUnitPrice(0);
      setReqSellerName('');
      setReqPurpose('');
    } catch (err: any) {
      showErrorModal(`⚠️ 구매 신청 등록 실패:\n${err?.message || err}`);
    }
  };

  // 구매신청 접수/승인 핸들러
  const handleAccept = async (id: string, modelName: string) => {
    if (!canSave) return;
    try {
      await acceptConsumablePurchase(id);
      await db.awaitPendingWrites();
      showToast(`[${modelName}] 구매 신청이 승인/접수 처리되었습니다.`);
    } catch (err: any) {
      showErrorModal(`⚠️ 승인 처리 실패:\n${err?.message || err}`);
    }
  };

  // 구매완결 및 대금 지급요청 실행 핸들러
  const handleCompleteAndRequestPayment = async (p: ConsumablePurchaseRequest) => {
    try {
      await completeConsumablePurchase(p.id);
      await db.awaitPendingWrites();
      showToast(`[${p.modelName}] 구매완결 및 월말 매입정산 대장에 지급요청이 등록되었습니다.`);
    } catch (err: any) {
      showErrorModal(`⚠️ 구매 완결 및 지급요청 처리 실패:\n${err?.message || err}`);
    }
  };

  // 엑셀 내보내기
  const handleExportExcel = () => {
    const excelData = filteredPurchases.map((p, idx) => ({
      'No': idx + 1,
      '신청번호': p.id,
      '신청일자': p.requestDate,
      '품목명': p.modelName,
      '신청수량': p.requestedQty,
      '예상단가': `${(p.unitPrice || 0).toLocaleString()}원`,
      '합계금액': `${((p.requestedQty || 0) * (p.unitPrice || 0)).toLocaleString()}원`,
      '공급처/구매URL': p.sellerName,
      '신청자': p.requesterName || '-',
      '진행상태': p.status === 'COMPLETED' ? '구매완결(지급요청)' : (p.status === 'ACCEPTED' && (p.receivedQty || 0) > 0) ? '실물입고됨' : p.status === 'ACCEPTED' ? '승인접수' : '신청대기',
      '입고수량': p.receivedQty || 0,
      '완결일자': p.completedDate || '-',
      '증빙링크': p.statementFileUrl || '-'
    }));

    exportToExcel(excelData, `소모품구매신청대장_${new Date().toISOString().split('T')[0]}`, '구매신청대장');
  };

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 🔔 인앱 토스트 알림 */}
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

      {/* ── 1. 화면 헤더 (무수식어 건조 표준 3.1) ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ fontWeight: '800', margin: 0, fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShoppingCart size={22} color="var(--primary)" />
            <span>소모품 구매</span>
          </h2>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            소모품 구매 신청 등록 및 구매 신청 대장
          </div>
        </div>

        {activeTab === 'REQ_LIST' && (
          <button 
            className="btn-secondary" 
            onClick={handleExportExcel} 
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
          >
            <Download size={14} />
            <span>구매대장 엑셀</span>
          </button>
        )}
      </div>

      {/* ── 2. 핵심 지표 카드 (Gutenberg Scope) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <div className="card" style={{ padding: '14px', margin: 0, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>당월 총 구매신청</div>
          <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '4px', color: 'var(--text-main)' }}>
            {purchaseSummary.totalRequested}건
          </div>
        </div>

        <div className="card" style={{ padding: '14px', margin: 0, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>승인 대기 건수</div>
          <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '4px', color: purchaseSummary.pendingCount > 0 ? '#f59e0b' : 'var(--text-main)' }}>
            {purchaseSummary.pendingCount}건
          </div>
        </div>

        <div className="card" style={{ padding: '14px', margin: 0, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>입고 완료 건수</div>
          <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '4px', color: '#10b981' }}>
            {purchaseSummary.completedCount}건
          </div>
        </div>

        <div className="card" style={{ padding: '14px', margin: 0, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>당월 예상 총 구매액</div>
          <div style={{ fontSize: '18px', fontWeight: '800', marginTop: '4px', color: 'var(--primary)' }}>
            ₩{purchaseSummary.totalAmount.toLocaleString()}원
          </div>
        </div>
      </div>

      {/* ── 3. 상단 2대 탭 바 (규격 3.1 명칭) ── */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '2px' }}>
        <button
          className={activeTab === 'REQ_LIST' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('REQ_LIST')}
          style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700' }}
        >
          <ClipboardList size={15} />
          <span>구매신청대장</span>
          <span style={{ fontSize: '11px', backgroundColor: 'rgba(255,255,255,0.2)', padding: '1px 6px', borderRadius: '10px' }}>
            {consumablePurchases.length}
          </span>
        </button>

        {canSave && (
          <button
            className={activeTab === 'REQ_WRITE' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveTab('REQ_WRITE')}
            style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700' }}
          >
            <Plus size={15} />
            <span>구매신청등록</span>
          </button>
        )}
      </div>

      {/* ── 4. 탭 1: 구매신청대장 ── */}
      {activeTab === 'REQ_LIST' && (
        <div className="card" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* 필터 바 (3.4 상하 세로 스택 & 3.2 줄바꿈 방지) */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '8px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', whiteSpace: 'nowrap' }}>검색어</label>
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="품목명, 공급처, 신청자, 신청번호"
                style={{ padding: '6px 10px', fontSize: '12px', width: '220px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', whiteSpace: 'nowrap' }}>진행 상태</label>
              <select 
                value={statusFilter} 
                onChange={e => setStatusFilter(e.target.value as any)} 
                style={{ padding: '6px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', whiteSpace: 'nowrap' }}
              >
                <option value="ALL">전체 상태</option>
                <option value="REQUESTED">신청대기</option>
                <option value="ACCEPTED">승인접수</option>
                <option value="COMPLETED">입고완료</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', whiteSpace: 'nowrap' }}>신청 기간</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input 
                  type="date" 
                  value={startDate} 
                  onChange={e => setStartDate(e.target.value)} 
                  style={{ padding: '5px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }} 
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>~</span>
                <input 
                  type="date" 
                  value={endDate} 
                  onChange={e => setEndDate(e.target.value)} 
                  style={{ padding: '5px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }} 
                />
              </div>
            </div>

            {(searchTerm || statusFilter !== 'ALL' || startDate !== thisMonthStart || endDate !== thisMonthEnd) && (
              <button
                className="btn-secondary"
                onClick={() => { setSearchTerm(''); setStatusFilter('ALL'); setStartDate(thisMonthStart); setEndDate(thisMonthEnd); }}
                style={{ padding: '6px 10px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
              >
                <RefreshCw size={12} />
                <span>필터 초기화</span>
              </button>
            )}
          </div>

          {/* 고밀도 대사 그리드 (3.6 유형 B) */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>신청번호</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>신청일자</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>품목명</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>수량</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>예상단가</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>합계금액</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>공급처 / 구매 URL</th>
                  <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>신청자</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>증빙</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>진행상태</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>관리 / 조치</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                      조회 조건에 해당하는 구매 신청 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredPurchases.map(p => {
                    const isUrl = (p.sellerName || '').toLowerCase().startsWith('http://') || 
                                  (p.sellerName || '').toLowerCase().startsWith('https://') || 
                                  (p.sellerName || '').toLowerCase().startsWith('www.');
                    const isInbounded = (p.receivedQty || 0) > 0;
                    const isFullyInbounded = isInbounded && (p.receivedQty >= p.requestedQty);

                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {p.id}
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{p.requestDate}</td>
                        <td style={{ padding: '8px 10px', fontWeight: '700', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                          {p.modelName}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: '800', whiteSpace: 'nowrap' }}>
                          <span>{p.requestedQty}개</span>
                          {isInbounded && (
                            <span style={{ fontSize: '11px', color: isFullyInbounded ? '#059669' : '#0284c7', marginLeft: '4px', fontWeight: '600' }}>
                              ({isFullyInbounded ? `입고: ${p.receivedQty}개` : `부분: ${p.receivedQty}/${p.requestedQty}`})
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          ₩{(p.unitPrice || 0).toLocaleString()}원
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: '800', color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                          ₩{((p.requestedQty || 0) * (p.unitPrice || 0)).toLocaleString()}원
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                          {isUrl ? (
                            <a 
                              href={p.sellerName.startsWith('http') ? p.sellerName : `https://${p.sellerName}`} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              style={{ 
                                color: 'var(--primary)', 
                                textDecoration: 'underline', 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '3px', 
                                fontWeight: 700,
                                fontSize: '11.5px'
                              }}
                            >
                              <span>온라인 구매 바로가기</span>
                              <ExternalLink size={12} />
                            </a>
                          ) : (
                            <span>{p.sellerName || '-'}</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{p.requesterName || '-'}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {p.statementFileUrl ? (
                            <a 
                              href={p.statementFileUrl} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="btn-secondary" 
                              style={{ padding: '2px 6px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                              title="거래명세서 / 영수증 증빙 열기"
                            >
                              <FileText size={11} />
                              <span>명세서</span>
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>-</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: p.status === 'COMPLETED' ? 'rgba(16, 185, 129, 0.12)' : 
                                             (p.status === 'ACCEPTED' && isInbounded) ? 'rgba(6, 182, 212, 0.12)' :
                                             p.status === 'ACCEPTED' ? 'rgba(59, 130, 246, 0.12)' : 
                                             'rgba(245, 158, 11, 0.12)',
                            color: p.status === 'COMPLETED' ? '#059669' : 
                                   (p.status === 'ACCEPTED' && isInbounded) ? '#0891b2' :
                                   p.status === 'ACCEPTED' ? '#2563eb' : 
                                   '#d97706'
                          }}>
                            {p.status === 'COMPLETED' ? '구매완결' : 
                             (p.status === 'ACCEPTED' && isFullyInbounded) ? `실물입고됨` :
                             (p.status === 'ACCEPTED' && isInbounded) ? `부분입고(${p.receivedQty})` :
                             p.status === 'ACCEPTED' ? '승인접수' : '신청대기'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {/* 1. 신청대기: 승인 버튼 */}
                          {p.status === 'REQUESTED' && canSave && (
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => handleAccept(p.id, p.modelName)}
                              style={{ padding: '3px 8px', fontSize: '11px', whiteSpace: 'nowrap' }}
                            >
                              승인
                            </button>
                          )}

                          {/* 2. 승인접수 및 실물입고됨: 구매신청자의 최종 완결 및 지급요청 버튼 */}
                          {p.status === 'ACCEPTED' && isInbounded && (
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={() => handleCompleteAndRequestPayment(p)}
                              style={{ 
                                padding: '3px 9px', 
                                fontSize: '11px', 
                                fontWeight: 700, 
                                backgroundColor: '#059669', 
                                borderColor: '#059669', 
                                color: '#ffffff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                whiteSpace: 'nowrap'
                              }}
                              title="실물 입고 확인 후 구매완결 및 월말 매입정산에 지급요청 생성"
                            >
                              <CheckCircle2 size={12} />
                              <span>구매완결 및 지급요청</span>
                            </button>
                          )}

                          {/* 3. 승인접수 후 아직 실물 미입고: 입고대기 안내 (관리자는 즉시완결 가능) */}
                          {p.status === 'ACCEPTED' && !isInbounded && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' }}>
                              <span style={{ fontSize: '11px', color: '#2563eb', fontWeight: '600' }}>입고대기</span>
                              {canSave && (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => handleCompleteAndRequestPayment(p)}
                                  style={{ padding: '2px 5px', fontSize: '10px', whiteSpace: 'nowrap' }}
                                  title="실물 입고 없이 즉시 구매완결 및 지급요청"
                                >
                                  즉시완결
                                </button>
                              )}
                            </div>
                          )}

                          {/* 4. 구매완결: 완료 및 지급요청됨 표시 */}
                          {p.status === 'COMPLETED' && (
                            <span style={{ fontSize: '11px', color: '#059669', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                              <Check size={12} />
                              <span>지급요청완료</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 우하단 대차대조식 요약 (Gutenberg Z-패턴 4단계) */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '10px', fontSize: '12px' }}>
            <div style={{ display: 'flex', gap: '16px', fontWeight: '600' }}>
              <span>조회 합계: <strong>{filteredPurchases.length}건</strong></span>
              <span>총 수량: <strong>{filteredPurchases.reduce((sum, p) => sum + p.requestedQty, 0)}개</strong></span>
              <span style={{ color: 'var(--primary)' }}>
                총 예상 금액: <strong>₩{filteredPurchases.reduce((sum, p) => sum + (p.requestedQty * p.unitPrice), 0).toLocaleString()}원</strong>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. 탭 2: 구매신청등록 ── */}
      {activeTab === 'REQ_WRITE' && (
        <div className="card" style={{ maxWidth: '640px', margin: '0 auto', width: '100%', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '800', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            소모품 구매 신청서 작성
          </h3>

          <form onSubmit={handleRequestSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* 기존 품목 선택 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                소모품 품목 마스터 연동
              </label>
              <select
                value={reqConsumableId}
                onChange={e => {
                  const val = e.target.value;
                  setReqConsumableId(val);
                  if (val !== 'NEW') {
                    const found = consumables.find(c => c.id === val);
                    if (found) {
                      setReqModelName(found.modelName);
                      setReqUnitPrice(found.unitPrice);
                      setReqSellerName(found.supplier || '');
                    }
                  } else {
                    setReqModelName('');
                    setReqUnitPrice(0);
                    setReqSellerName('');
                  }
                }}
                style={{ padding: '8px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}
              >
                <option value="NEW">-- 신규 품목 직접 입력 --</option>
                {consumables.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.modelName} (현재고: {c.stockQty}개, 단가: ₩{c.unitPrice.toLocaleString()}원, 공급처: {c.supplier || '-'})
                  </option>
                ))}
              </select>
            </div>

            {/* 품목명 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                품목명 *
              </label>
              <input
                type="text"
                value={reqModelName}
                onChange={e => setReqModelName(e.target.value)}
                placeholder="예: 스카이잭 조이스틱 컨트롤러"
                required
                style={{ padding: '8px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}
              />
            </div>

            {/* 수량 & 단가 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)' }}>신청 수량 *</label>
                <input
                  type="number"
                  value={reqQty}
                  onChange={e => setReqQty(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  required
                  style={{ padding: '8px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)' }}>예상 단가 (원) *</label>
                <input
                  type="number"
                  value={reqUnitPrice}
                  onChange={e => setReqUnitPrice(Math.max(0, parseInt(e.target.value) || 0))}
                  min={0}
                  required
                  style={{ padding: '8px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}
                />
              </div>
            </div>

            {/* 공급처 & 신청일자 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)' }}>판매처 또는 구매 URL *</label>
                <input
                  type="text"
                  value={reqSellerName}
                  onChange={e => setReqSellerName(e.target.value)}
                  placeholder="예: 세방상사 또는 온라인 구매 링크(https://...)"
                  required
                  style={{ padding: '8px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  * 거래처명을 입력하거나 온라인 판매의 경우 상품 상세 URL을 입력해 주세요.
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)' }}>신청 일자 *</label>
                <input
                  type="date"
                  value={reqDate}
                  onChange={e => setReqDate(e.target.value)}
                  required
                  style={{ padding: '8px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}
                />
              </div>
            </div>

            {/* 총 예상 비용 요약 카드 */}
            <div style={{ padding: '14px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '600' }}>예상 총 구매비용:</span>
              <strong style={{ fontSize: '16px', color: 'var(--primary)' }}>
                ₩{(reqQty * reqUnitPrice).toLocaleString()}원
              </strong>
            </div>

            {/* 하단 액션 버튼 */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '10px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setActiveTab('REQ_LIST')}
                style={{ padding: '8px 16px', fontSize: '12.5px' }}
              >
                취소
              </button>
              <button
                type="submit"
                className="btn-primary"
                style={{ padding: '8px 20px', fontSize: '12.5px', fontWeight: '700' }}
              >
                구매 신청서 제출
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
