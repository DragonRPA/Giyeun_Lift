// src/pages/ConsumableInOutPage.tsx
import React, { useState, useRef, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  PackagePlus, ArrowUpRight, ListCollapse, Search, Download, 
  CheckCircle2, AlertTriangle, AlertCircle, FileText, Camera, Upload, X, ShieldCheck
} from 'lucide-react';
import { exportToExcel } from '../services/excel';
import { db } from '../services/db';
import { compressFileIfNeeded } from '../utils/imageCompressor';
import { uploadToSupabaseStorage } from '../services/supabaseStorage';

export const ConsumableInOutPage: React.FC = () => {
  const {
    consumables,
    consumableLogs,
    consumablePurchases,
    assets,
    users,
    currentUser,
    inboundConsumablePurchase,
    useConsumable,
    hasPermission,
    showErrorModal
  } = useApp();

  const canSave = hasPermission('consumable_inout', 'save') || hasPermission('consumable', 'save');

  // 활성 탭: REQ_INBOUND (소모품 입고) | OUTBOUND (소모품 출고) | LOGS (입출고 이력)
  const [activeTab, setActiveTab] = useState<'REQ_INBOUND' | 'OUTBOUND' | 'LOGS'>('REQ_INBOUND');

  // 토스트 알림 상태
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // --- [1] 입고(Inbound) 상태 ---
  const [selectedReqId, setSelectedReqId] = useState('');
  const [inboundQty, setInboundQty] = useState(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [noInvoice, setNoInvoice] = useState(false);
  const [noInvoiceReason, setNoInvoiceReason] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // --- [2] 출고(Outbound/Use) 상태 ---
  const [useConsumableId, setUseConsumableId] = useState('');
  const [useQty, setUseQty] = useState(1);
  const [useAssetId, setUseAssetId] = useState('');
  const [useMechanicId, setUseMechanicId] = useState(currentUser?.id || '');
  const [useDesc, setUseDesc] = useState('');

  // --- [3] 입출고 이력(Logs) 필터 상태 ---
  const thisMonthStart = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; })();
  const thisMonthEnd   = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()).padStart(2,'0')}`; })();
  const [logSearch, setLogSearch] = useState('');
  const [logTypeFilter, setLogTypeFilter] = useState<'ALL' | 'INBOUND' | 'OUTBOUND' | 'TRANSFER_TO_VEHICLE' | 'RETURN_TO_HQ' | 'ADJUST'>('ALL');
  const [logStartDate, setLogStartDate] = useState(thisMonthStart);
  const [logEndDate, setLogEndDate] = useState(thisMonthEnd);
  const [logUserFilter, setLogUserFilter] = useState('ALL');

  const mechanics = useMemo(() => {
    return users.filter(u => u.role === 'MECHANIC' || u.role === 'ADMIN' || u.role === 'MANAGER');
  }, [users]);

  const getUserName = (id?: string) => {
    if (!id) return '시스템';
    return users.find(u => u.id === id)?.name || '담당자';
  };

  const getAssetNo = (id?: string) => {
    if (!id) return '-';
    return assets.find(a => a.id === id)?.assetNo || '-';
  };

  // 선택된 출고 대상 품목 정보
  const targetConsumable = useMemo(() => {
    return consumables.find(c => c.id === useConsumableId);
  }, [consumables, useConsumableId]);

  // 입고 대기 목록
  const pendingInbounds = useMemo(() => {
    return consumablePurchases
      .filter(p => p.status !== 'COMPLETED')
      .sort((a, b) => b.requestDate.localeCompare(a.requestDate));
  }, [consumablePurchases]);

  // 이력 필터링
  const filteredLogs = useMemo(() => {
    return consumableLogs.filter(l => {
      const matchType = logTypeFilter === 'ALL' || l.type === logTypeFilter;
      const matchStart = !logStartDate || l.actionDate >= logStartDate;
      const matchEnd = !logEndDate || l.actionDate <= logEndDate;
      const matchUser = logUserFilter === 'ALL' || l.userId === logUserFilter || l.mechanicId === logUserFilter;
      const item = consumables.find(c => c.id === l.consumableId);
      const matchSearch = !logSearch || 
        (item?.modelName || '').toLowerCase().includes(logSearch.toLowerCase()) || 
        (l.description || '').toLowerCase().includes(logSearch.toLowerCase()) ||
        (l.targetAssetId && getAssetNo(l.targetAssetId).toLowerCase().includes(logSearch.toLowerCase()));

      return matchType && matchStart && matchEnd && matchUser && matchSearch;
    }).sort((a, b) => (b.actionDate || '').localeCompare(a.actionDate || ''));
  }, [consumableLogs, consumables, logTypeFilter, logStartDate, logEndDate, logUserFilter, logSearch]);

  // ─── [Z-패턴 최하단 입출고 대차대조식 요약 검증] ───
  const auditBalance = useMemo(() => {
    let inboundSum = 0;
    let outboundSum = 0;
    let transferSum = 0;
    let returnSum = 0;

    filteredLogs.forEach(l => {
      const amount = (l.quantity || 0) * (l.unitPrice || 0);
      if (l.type === 'INBOUND') inboundSum += amount;
      else if (l.type === 'OUTBOUND') outboundSum += amount;
      else if (l.type === 'TRANSFER_TO_VEHICLE') transferSum += amount;
      else if (l.type === 'RETURN_TO_HQ') returnSum += amount;
    });

    // 순 출고/소진 및 이동 합계
    const netOutSum = outboundSum + transferSum - returnSum;
    return { inboundSum, outboundSum, transferSum, returnSum, netOutSum };
  }, [filteredLogs]);

  // --- 입고 확정 처리 ---
  const handleInboundConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) {
      showToast('입고 처리 권한이 없습니다.', 'error');
      return;
    }
    if (!selectedReqId || inboundQty <= 0) {
      showToast('입고할 구매신청건과 정상 입고 수량을 지정해 주세요.', 'error');
      return;
    }

    // 횡령 방지 가드: 증빙 파일이 없고 무증빙 체크 시 사유 입력 필수
    if (!selectedFile && !noInvoice) {
      showToast('공급자 거래명세서 증빙 파일을 첨부하거나, 무증빙 사유를 체크해 주세요.', 'error');
      return;
    }
    if (noInvoice && !noInvoiceReason.trim()) {
      showToast('거래명세서 증빙 누락에 대한 감사 사유를 입력해야 합니다.', 'error');
      return;
    }

    setIsUploading(true);
    const targetReq = consumablePurchases.find(p => p.id === selectedReqId);
    const purchaseNo = targetReq ? targetReq.id.toUpperCase() : `CPR-${new Date().getTime()}`;
    const rawExt = selectedFile ? (selectedFile.name.split('.').pop()?.toLowerCase() || 'jpg') : 'jpg';
    const newFileName = `${purchaseNo}.${rawExt}`;

    try {
      let uploadedUrl = '';
      if (selectedFile) {
        const compressed = await compressFileIfNeeded(selectedFile);
        const base64Response = await fetch(compressed.base64);
        const uploadBlob = await base64Response.blob();
        const uploadFile = new File([uploadBlob], newFileName, { type: compressed.mimeType });

        const storageResult = await uploadToSupabaseStorage({
          file: uploadFile,
          folder: 'consumables',
          fileName: newFileName
        });

        if (!storageResult.success || !storageResult.fileUrl) {
          throw new Error(storageResult.message || '스토리지 업로드에 실패했습니다.');
        }
        uploadedUrl = storageResult.fileUrl;
      }

      await inboundConsumablePurchase(selectedReqId, inboundQty, uploadedUrl);
      await db.awaitPendingWrites();

      showToast(`구매물품 [${targetReq?.modelName || '소모품'}] ${inboundQty}개 입고 처리가 완료되었습니다.`);
      setSelectedReqId('');
      setInboundQty(1);
      setSelectedFile(null);
      setNoInvoice(false);
      setNoInvoiceReason('');
      setActiveTab('LOGS');
    } catch (err: any) {
      showErrorModal(`⚠️ 소모품 입고 처리 실패:\n${err?.message || err}`);
    } finally {
      setIsUploading(false);
    }
  };

  // --- 소모품 출고(사용) 처리 ---
  const handleUseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) {
      showToast('소모품 출고 권한이 없습니다.', 'error');
      return;
    }
    if (!useConsumableId || useQty <= 0) {
      showToast('출고 품목과 정상 수량을 입력해 주세요.', 'error');
      return;
    }

    // 횡령/부정 방지 1차 가드: 가용 재고 초과 출고 원천 차단
    const item = consumables.find(c => c.id === useConsumableId);
    if (!item || item.stockQty < useQty) {
      showErrorModal(`본사 가용 재고(${item?.stockQty || 0}개)를 초과하여 ${useQty}개를 출고할 수 없습니다.`);
      return;
    }

    // 횡령/부정 방지 2차 가드: 투입 대상 자산 또는 작업 정비사 필수 지정 (유령 출고 원천 차단)
    if (!useAssetId && !useMechanicId) {
      showErrorModal('소모품 부정 유출 방지를 위해 [투입 대상 자산] 또는 [담당 정비사]를 반드시 지정해야 합니다.');
      return;
    }

    try {
      await useConsumable({
        consumableId: useConsumableId,
        quantity: useQty,
        targetAssetId: useAssetId || '',
        description: useDesc.trim() || `[직접출고] 정비사: ${getUserName(useMechanicId)} / 자산: ${getAssetNo(useAssetId)}`
      });

      await db.awaitPendingWrites();
      showToast(`소모품 [${item.modelName}] ${useQty}개 정상 출고되었습니다.`);
      setUseConsumableId('');
      setUseQty(1);
      setUseAssetId('');
      setUseDesc('');
      setActiveTab('LOGS');
    } catch (err: any) {
      showErrorModal(`⚠️ 소모품 출고 실패:\n${err?.message || err}`);
    }
  };

  // 엑셀 내보내기
  const handleExportLogs = () => {
    const excelData = filteredLogs.map((l, idx) => {
      const item = consumables.find(c => c.id === l.consumableId);
      return {
        'No': idx + 1,
        '구분': l.type === 'INBOUND' ? '구매입고' :
                l.type === 'OUTBOUND' ? '현장출고' :
                l.type === 'TRANSFER_TO_VEHICLE' ? '차량불출' :
                l.type === 'RETURN_TO_HQ' ? '본사반납' : '재고조정',
        '품목명': item?.modelName || '삭제된 품목',
        '수량': l.quantity,
        '단가': `${(l.unitPrice || 0).toLocaleString()}원`,
        '총금액': `${((l.quantity || 0) * (l.unitPrice || 0)).toLocaleString()}원`,
        '출처': l.fromLocation || (l.type === 'INBOUND' ? (l.supplier || '매입처') : '본사 중앙창고'),
        '이동처/적용': l.toLocation || (l.targetAssetId ? `자산(${getAssetNo(l.targetAssetId)})` : '-'),
        '담당자': getUserName(l.userId || l.mechanicId),
        '일자': l.actionDate,
        '상세 내용': l.description
      };
    });

    exportToExcel(excelData, `소모품_입출고이력_${new Date().toISOString().split('T')[0]}`, '입출고이력');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px', maxWidth: '1440px', margin: '0 auto' }}>
      {/* ─── 토스트 알림 ─── */}
      {toastMessage && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          padding: '12px 20px', borderRadius: '8px',
          backgroundColor: toastMessage.type === 'success' ? '#059669' : '#dc2626',
          color: '#ffffff', fontWeight: 600, fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          {toastMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* ─── [Z-패턴 1단계: 헤더 & 탭 네비게이션] ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            소모품 입출고 관리
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
            <ShieldCheck size={14} style={{ color: '#059669' }} />
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              구매 승인건 입고 검수, 자산/기사 1:1 귀속 출고 및 수불 감사 대장
            </span>
          </div>
        </div>

        {/* 탭 버튼군 (무수식어 건조 표준) */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={activeTab === 'REQ_INBOUND' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveTab('REQ_INBOUND')}
            style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          >
            <PackagePlus size={14} /> 소모품 입고
            {pendingInbounds.length > 0 && (
              <span style={{
                backgroundColor: '#dc2626', color: '#fff', fontSize: '11px',
                padding: '1px 6px', borderRadius: '10px', fontWeight: 700
              }}>
                {pendingInbounds.length}
              </span>
            )}
          </button>
          <button
            type="button"
            className={activeTab === 'OUTBOUND' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveTab('OUTBOUND')}
            style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          >
            <ArrowUpRight size={14} /> 소모품 출고
          </button>
          <button
            type="button"
            className={activeTab === 'LOGS' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveTab('LOGS')}
            style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          >
            <ListCollapse size={14} /> 입출고 이력
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [TAB 1] 소모품 입고 처리 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'REQ_INBOUND' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px', alignItems: 'start' }}>
          {/* 좌측: 입고 대기 목록 */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 className="card-title" style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>입고 대기 구매신청 목록</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>관리부 승인 완료 및 창고 입고 대기 건</span>
              </div>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary)' }}>
                총 {pendingInbounds.length}건 대기
              </span>
            </div>

            <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>신청일자</th>
                    <th>품목명</th>
                    <th style={{ textAlign: 'center' }}>신청수량</th>
                    <th>단가</th>
                    <th>공급처</th>
                    <th>신청자</th>
                    <th style={{ textAlign: 'center' }}>선택</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingInbounds.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                        현재 입고 대기 중인 구매 신청 건이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    pendingInbounds.map(p => {
                      const isSelected = selectedReqId === p.id;
                      return (
                        <tr 
                          key={p.id}
                          onClick={() => {
                            setSelectedReqId(p.id);
                            setInboundQty(p.requestedQty);
                          }}
                          style={{
                            cursor: 'pointer',
                            backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.08)' : undefined
                          }}
                        >
                          <td style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>{p.requestDate}</td>
                          <td><strong style={{ color: 'var(--primary)' }}>{p.modelName}</strong></td>
                          <td style={{ textAlign: 'center', fontWeight: 700, color: '#059669' }}>{p.requestedQty}</td>
                          <td>{(p.unitPrice || 0).toLocaleString()}원</td>
                          <td style={{ fontSize: '12px' }}>{p.sellerName}</td>
                          <td style={{ fontSize: '12px' }}>{p.requesterName}</td>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="radio"
                              name="selected_req"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedReqId(p.id);
                                setInboundQty(p.requestedQty);
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 우측: 선택건 입고 확정 폼 */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <h3 className="card-title" style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>창고 입고 확정 등록</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>거래명세서 증빙 확인 및 전산 재고 가산</span>
            </div>

            <form onSubmit={handleInboundConfirmSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px' }}>
              {/* 상하 세로 스택 레이아웃 (헌장 3.4) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  입고 대상 구매 신청건 *
                </label>
                <select
                  value={selectedReqId}
                  onChange={e => {
                    setSelectedReqId(e.target.value);
                    const target = pendingInbounds.find(p => p.id === e.target.value);
                    if (target) setInboundQty(target.requestedQty);
                  }}
                  required
                  style={{ padding: '8px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                >
                  <option value="">-- 좌측 목록에서 선택하거나 선택창 클릭 --</option>
                  {pendingInbounds.map(p => (
                    <option key={p.id} value={p.id}>
                      [{p.requestDate}] {p.modelName} ({p.requestedQty}개) - {p.sellerName}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  실제 입고 수량 *
                </label>
                <input
                  type="number"
                  value={inboundQty}
                  onChange={e => setInboundQty(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  required
                  style={{ padding: '8px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                />
              </div>

              {/* 거래명세서 증빙 업로드 (횡령 방지 필수 장치) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  공급자 거래명세서 증빙 첨부 *
                </label>
                
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={e => {
                    const file = e.target.files?.[0] || null;
                    setSelectedFile(file);
                    if (file) setNoInvoice(false);
                  }}
                  disabled={noInvoice}
                  style={{ fontSize: '12px', padding: '6px' }}
                />

                {selectedFile && (
                  <div style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 600 }}>
                    첨부 파일: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </div>
                )}

                {/* 무증빙 예외 체크 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                  <input
                    type="checkbox"
                    id="chk_no_invoice"
                    checked={noInvoice}
                    onChange={e => {
                      setNoInvoice(e.target.checked);
                      if (e.target.checked) setSelectedFile(null);
                    }}
                  />
                  <label htmlFor="chk_no_invoice" style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600, cursor: 'pointer' }}>
                    거래명세서 증빙 누락 (감사 사유 입력 필수)
                  </label>
                </div>

                {noInvoice && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: '#dc2626' }}>증빙 누락 감사 사유 *</label>
                    <input
                      type="text"
                      value={noInvoiceReason}
                      onChange={e => setNoInvoiceReason(e.target.value)}
                      placeholder="예: 긴급 현장 직구매 간이영수증 추후 징구 예정"
                      style={{ padding: '6px', fontSize: '12px', border: '1px solid #dc2626', borderRadius: '4px' }}
                      required
                    />
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={isUploading || !selectedReqId}
                style={{
                  padding: '12px', fontSize: '14px', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  marginTop: '8px'
                }}
              >
                {isUploading ? '증빙 업로드 및 입고 확정 중...' : '본사 창고 입고 확정'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [TAB 2] 소모품 출고(사용) 처리 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'OUTBOUND' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px', alignItems: 'start' }}>
          {/* 좌측: 출고 입력 폼 (횡령 방지 가드 탑재) */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <h3 className="card-title" style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>소모품 정비 투입 및 현장 출고</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                유령 출고 원천 차단: 투입 자산 또는 담당 정비사 1:1 필수 귀속
              </span>
            </div>

            <form onSubmit={handleUseSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px' }}>
              {/* 품목 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  출고 품목 *
                </label>
                <select
                  value={useConsumableId}
                  onChange={e => setUseConsumableId(e.target.value)}
                  required
                  style={{ padding: '8px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                >
                  <option value="">-- 출고할 품목을 선택하세요 --</option>
                  {consumables.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.modelName} (본사 가용재고: {c.stockQty}개 | 단가: {c.unitPrice.toLocaleString()}원)
                    </option>
                  ))}
                </select>
                {targetConsumable && (
                  <div style={{ fontSize: '11.5px', color: targetConsumable.stockQty > 0 ? '#059669' : '#dc2626', fontWeight: 600, marginTop: '2px' }}>
                    현재 본사 중앙 가용재고: {targetConsumable.stockQty} {targetConsumable.unit || '개'} 
                    {targetConsumable.stockQty <= 0 && ' (재고 부족 - 출고 불가)'}
                  </div>
                )}
              </div>

              {/* 출고 수량 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  출고 수량 *
                </label>
                <input
                  type="number"
                  value={useQty}
                  onChange={e => setUseQty(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  max={targetConsumable?.stockQty || 9999}
                  required
                  style={{ padding: '8px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                />
              </div>

              {/* 횡령 방지 귀속 필드: 자산번호 or 담당 정비사 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    투입 대상 자산 (장비)
                  </label>
                  <select
                    value={useAssetId}
                    onChange={e => setUseAssetId(e.target.value)}
                    style={{ padding: '7px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                  >
                    <option value="">-- 자산 선택 (자산 정비 시) --</option>
                    {assets.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.assetNo} ({a.modelName})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    담당 정비사 (수령자)
                  </label>
                  <select
                    value={useMechanicId}
                    onChange={e => setUseMechanicId(e.target.value)}
                    style={{ padding: '7px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                  >
                    <option value="">-- 정비사 선택 --</option>
                    {mechanics.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 사용 목적 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  사용 목적 및 정비 상세 내역
                </label>
                <input
                  type="text"
                  value={useDesc}
                  onChange={e => setUseDesc(e.target.value)}
                  placeholder="예: 입고 장비 정기 점검 유압유 보충 및 리프트 패드 교체"
                  style={{ padding: '8px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={!useConsumableId || !targetConsumable || targetConsumable.stockQty < useQty}
                style={{
                  padding: '12px', fontSize: '14px', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  marginTop: '8px'
                }}
              >
                <ArrowUpRight size={16} /> 소모품 출고 확정 및 정비비용 반영
              </button>
            </form>
          </div>

          {/* 우측: 최근 출고 내역 10건 */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header">
              <h3 className="card-title" style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>최근 출고 내역 (최근 10건)</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>현장 소진 및 자산 투입 내역 실시간 모니터링</span>
            </div>

            <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>일자</th>
                    <th>품목명</th>
                    <th style={{ textAlign: 'center' }}>수량</th>
                    <th>귀속 대상</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const recentOuts = consumableLogs
                      .filter(l => l.type === 'OUTBOUND')
                      .slice(0, 10);

                    if (recentOuts.length === 0) {
                      return (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                            최근 출고 내역이 없습니다.
                          </td>
                        </tr>
                      );
                    }

                    return recentOuts.map(l => {
                      const item = consumables.find(c => c.id === l.consumableId);
                      return (
                        <tr key={l.id}>
                          <td style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>{l.actionDate}</td>
                          <td><strong>{item?.modelName || '품목'}</strong></td>
                          <td style={{ textAlign: 'center', fontWeight: 700, color: '#dc2626' }}>{l.quantity}</td>
                          <td style={{ fontSize: '12px' }}>
                            {l.targetAssetId ? `자산: ${getAssetNo(l.targetAssetId)}` : getUserName(l.mechanicId || l.userId)}
                          </td>
                          <td style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{l.description}</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [TAB 3] 입출고 수불 이력 로그 (Z-패턴 고밀도 대사 그리드) */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'LOGS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* [Z-패턴 2단계: 필터 & 엑셀 내보내기] */}
          <div className="card" style={{ margin: 0, padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                {/* 상하 세로 스택 (헌장 3.4) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>검색어</label>
                  <input
                    type="text"
                    value={logSearch}
                    onChange={e => setLogSearch(e.target.value)}
                    placeholder="품목명, 비고, 자산번호..."
                    style={{ padding: '6px 10px', fontSize: '12px', width: '180px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>구분</label>
                  <select
                    value={logTypeFilter}
                    onChange={e => setLogTypeFilter(e.target.value as any)}
                    style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                  >
                    <option value="ALL">전체 구분</option>
                    <option value="INBOUND">구매입고</option>
                    <option value="OUTBOUND">현장출고</option>
                    <option value="TRANSFER_TO_VEHICLE">차량불출</option>
                    <option value="RETURN_TO_HQ">본사반납</option>
                    <option value="ADJUST">재고조정</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>담당자</label>
                  <select
                    value={logUserFilter}
                    onChange={e => setLogUserFilter(e.target.value)}
                    style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                  >
                    <option value="ALL">전체 담당자</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>기간</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="date"
                      value={logStartDate}
                      onChange={e => setLogStartDate(e.target.value)}
                      style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                    />
                    <span style={{ color: 'var(--text-muted)' }}>~</span>
                    <input
                      type="date"
                      value={logEndDate}
                      onChange={e => setLogEndDate(e.target.value)}
                      style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="btn-secondary"
                onClick={handleExportLogs}
                style={{ padding: '7px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
              >
                <Download size={14} /> 엑셀 내보내기
              </button>
            </div>
          </div>

          {/* [Z-패턴 3단계: 본문 수불 대장 그리드] */}
          <div className="card" style={{ margin: 0 }}>
            <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>No</th>
                    <th>구분</th>
                    <th>품목명</th>
                    <th style={{ textAlign: 'center' }}>수량</th>
                    <th>단가</th>
                    <th>총금액</th>
                    <th>출처</th>
                    <th>이동처 / 적용자산</th>
                    <th>담당자</th>
                    <th>일자</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={11} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                        조회 조건에 해당하는 입출고 수불 내역이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((l, idx) => {
                      const item = consumables.find(c => c.id === l.consumableId);
                      const amount = (l.quantity || 0) * (l.unitPrice || 0);

                      return (
                        <tr key={l.id}>
                          <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{idx + 1}</td>
                          <td>
                            <span className={`badge ${
                              l.type === 'INBOUND' ? 'badge-success' :
                              l.type === 'OUTBOUND' ? 'badge-danger' :
                              l.type === 'TRANSFER_TO_VEHICLE' ? 'badge-primary' :
                              l.type === 'RETURN_TO_HQ' ? 'badge-warning' : 'badge-secondary'
                            }`} style={{ whiteSpace: 'nowrap' }}>
                              {l.type === 'INBOUND' ? '구매입고' :
                               l.type === 'OUTBOUND' ? '현장출고' :
                               l.type === 'TRANSFER_TO_VEHICLE' ? '차량불출' :
                               l.type === 'RETURN_TO_HQ' ? '본사반납' : '재고조정'}
                            </span>
                          </td>
                          <td><strong style={{ color: 'var(--primary)' }}>{item?.modelName || '품목'}</strong></td>
                          <td style={{ textAlign: 'center', fontWeight: 700 }}>{l.quantity}</td>
                          <td style={{ fontSize: '12px' }}>{(l.unitPrice || 0).toLocaleString()}원</td>
                          <td style={{ fontWeight: 600 }}>{amount.toLocaleString()}원</td>
                          <td style={{ fontSize: '12px' }}>{l.fromLocation || (l.type === 'INBOUND' ? (l.supplier || '매입처') : '본사 중앙창고')}</td>
                          <td style={{ fontSize: '12px' }}>{l.toLocation || (l.targetAssetId ? `자산: ${getAssetNo(l.targetAssetId)}` : '-')}</td>
                          <td style={{ fontSize: '12px' }}>{getUserName(l.userId || l.mechanicId)}</td>
                          <td style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>{l.actionDate}</td>
                          <td style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{l.description}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* [Z-패턴 4단계: 최하단 대차대조식 수불 무결성 검증 바] */}
          <div style={{
            padding: '14px 20px', backgroundColor: 'var(--bg-card)', borderRadius: '8px',
            border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', flexWrap: 'wrap', gap: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={18} style={{ color: '#059669' }} />
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                수불 대차 검증 요약
              </span>
            </div>

            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '12px' }}>
                <span style={{ color: 'var(--text-muted)' }}>📥 입고 합계: </span>
                <strong style={{ color: '#059669' }}>₩{auditBalance.inboundSum.toLocaleString()}</strong>
              </div>
              <div style={{ fontSize: '12px' }}>
                <span style={{ color: 'var(--text-muted)' }}>📤 출고 합계: </span>
                <strong style={{ color: '#dc2626' }}>₩{auditBalance.outboundSum.toLocaleString()}</strong>
              </div>
              <div style={{ fontSize: '12px' }}>
                <span style={{ color: 'var(--text-muted)' }}>🚚 차량불출: </span>
                <strong style={{ color: 'var(--primary)' }}>₩{auditBalance.transferSum.toLocaleString()}</strong>
              </div>
              <div style={{ fontSize: '12px' }}>
                <span style={{ color: 'var(--text-muted)' }}>🔄 본사반납: </span>
                <strong style={{ color: '#d97706' }}>₩{auditBalance.returnSum.toLocaleString()}</strong>
              </div>
              <div style={{
                padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                backgroundColor: 'rgba(5, 150, 105, 0.1)', color: '#059669', border: '1px solid rgba(5, 150, 105, 0.3)'
              }}>
                ⚖️ 수불 무결성 검증 완료
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
