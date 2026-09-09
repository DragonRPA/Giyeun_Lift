// src/pages/ConsumableStockPage.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Boxes, Truck, Archive, CheckSquare, Plus, Search, Download, 
  CheckCircle2, XCircle, ArrowRightLeft, ArrowUpRight, ArrowDownLeft, 
  Edit, Trash2, X, AlertTriangle, ShieldCheck, FileCheck
} from 'lucide-react';
import { exportToExcel } from '../services/excel';
import { 
  Consumable, MechanicConsumableStock, StocktakingAudit, 
  StocktakingAuditItem, CollectedPart, db 
} from '../services/db';

export const ConsumableStockPage: React.FC = () => {
  const {
    consumables,
    consumableLogs,
    mechanicConsumableStocks,
    stocktakingAudits,
    stocktakingAuditItems,
    collectedParts,
    users,
    currentUser,
    addConsumable,
    updateConsumable,
    deleteConsumable,
    transferConsumableToMechanic,
    returnConsumableToHq,
    transferConsumableBetweenMechanics,
    createStocktakingAudit,
    updateStocktakingItem,
    confirmStocktakingAudit,
    cancelStocktakingAudit,
    processCollectedPart,
    hasPermission,
    showErrorModal
  } = useApp();

  const canSave = hasPermission('consumable_stock', 'save') || hasPermission('consumable', 'save');

  // 활성 탭: STOCK (주기장재고) | VEHICLE_STOCK (차량재고) | COLLECTED_PARTS (고품관리) | STOCKTAKING (재고실사)
  const [activeTab, setActiveTab] = useState<'STOCK' | 'VEHICLE_STOCK' | 'COLLECTED_PARTS' | 'STOCKTAKING'>('STOCK');

  // 토스트 알림 상태
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // --- [1] 주기장 재고 상태 ---
  const [stockSearch, setStockSearch] = useState('');
  const [showMasterModal, setShowMasterModal] = useState(false);
  const [masterEditingId, setMasterEditingId] = useState<string | null>(null);
  const [masterModelName, setMasterModelName] = useState('');
  const [masterUnit, setMasterUnit] = useState('개');
  const [masterUnitPrice, setMasterUnitPrice] = useState(0);
  const [masterSupplier, setMasterSupplier] = useState('');
  const [masterInitialStockQty, setMasterInitialStockQty] = useState(0);

  // --- [2] 차량 재고 상태 및 이동 모달 ---
  const [vehicleStockSearch, setVehicleStockSearch] = useState('');
  const [selectedMechanicFilter, setSelectedMechanicFilter] = useState('ALL');

  // 본사 ➔ 차량 불출 모달
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferMechanicId, setTransferMechanicId] = useState('');
  const [transferConsumableId, setTransferConsumableId] = useState('');
  const [transferQty, setTransferQty] = useState(1);
  const [transferMemo, setTransferMemo] = useState('');

  // 차량 ➔ 본사 반납 모달
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnMechanicId, setReturnMechanicId] = useState('');
  const [returnConsumableId, setReturnConsumableId] = useState('');
  const [returnQty, setReturnQty] = useState(1);
  const [returnMemo, setReturnMemo] = useState('');
  const [isReturnDefective, setIsReturnDefective] = useState(false);
  const [returnDisposition, setReturnDisposition] = useState<'REBUILD' | 'SCRAP' | 'VENDOR_WARRANTY'>('REBUILD');

  // 차량 간(P2P) 이동 모달
  const [showP2PModal, setShowP2PModal] = useState(false);
  const [p2pFromMechanicId, setP2pFromMechanicId] = useState('');
  const [p2pToMechanicId, setP2pToMechanicId] = useState('');
  const [p2pConsumableId, setP2pConsumableId] = useState('');
  const [p2pQty, setP2pQty] = useState(1);
  const [p2pMemo, setP2pMemo] = useState('');

  // --- [3] 고품 관리 상태 ---
  const [partDispositionFilter, setPartDispositionFilter] = useState<'ALL' | 'REBUILD' | 'SCRAP' | 'VENDOR_WARRANTY'>('ALL');
  const [partStatusFilter, setPartStatusFilter] = useState<'ALL' | 'RECEIVED' | 'IN_PROCESS' | 'COMPLETED'>('ALL');
  const [partSearch, setPartSearch] = useState('');

  // --- [4] 재고 실사 상태 ---
  const [selectedAuditId, setSelectedAuditId] = useState('');
  const [auditTargetFilter, setAuditTargetFilter] = useState<'ALL' | 'HQ' | 'VEHICLE'>('ALL');
  const [auditStatusFilter, setAuditStatusFilter] = useState<'ALL' | 'DRAFT' | 'CONFIRMED' | 'CANCELLED'>('ALL');
  const [showCreateAuditModal, setShowCreateAuditModal] = useState(false);
  const [newAuditTargetType, setNewAuditTargetType] = useState<'HQ' | 'VEHICLE'>('HQ');
  const [newAuditMechanicId, setNewAuditMechanicId] = useState('');
  const [newAuditMemo, setNewAuditMemo] = useState('');
  const [auditItemSearch, setAuditItemSearch] = useState('');

  const mechanics = useMemo(() => {
    return users.filter(u => u.role === 'MECHANIC' || u.role === 'ADMIN' || u.role === 'MANAGER');
  }, [users]);

  // 재고 통계 요약
  const stockSummary = useMemo(() => {
    const hqTotalQty = consumables.reduce((sum, c) => sum + (c.stockQty || 0), 0);
    const hqTotalValue = consumables.reduce((sum, c) => sum + (c.stockQty || 0) * (c.unitPrice || 0), 0);
    const vehicleTotalQty = (mechanicConsumableStocks || []).reduce((sum, s) => sum + (s.stockQty || 0), 0);
    const vehicleTotalValue = (mechanicConsumableStocks || []).reduce((sum, s) => {
      const c = consumables.find(item => item.id === s.consumableId);
      return sum + (s.stockQty || 0) * (c?.unitPrice || 0);
    }, 0);

    return {
      hqTotalKinds: consumables.length,
      hqTotalQty,
      hqTotalValue,
      vehicleTotalQty,
      vehicleTotalValue,
      grandTotalQty: hqTotalQty + vehicleTotalQty,
      grandTotalValue: hqTotalValue + vehicleTotalValue
    };
  }, [consumables, mechanicConsumableStocks]);

  // --- 엑셀 다운로드 핸들러 ---
  const handleExportStock = () => {
    const excelData = consumables.map((c, idx) => {
      const totalVehicleQty = (mechanicConsumableStocks || [])
        .filter(ms => ms.consumableId === c.id)
        .reduce((sum, ms) => sum + ms.stockQty, 0);

      return {
        'No': idx + 1,
        '자재 품목명': c.modelName,
        '주기장(본사) 재고': c.stockQty,
        '차량 이동 재고': totalVehicleQty,
        '전사 총 재고': c.stockQty + totalVehicleQty,
        '단위': c.unit || '개',
        '단가': `${(c.unitPrice || 0).toLocaleString()}원`,
        '주기장 재고평가액': `${((c.stockQty || 0) * (c.unitPrice || 0)).toLocaleString()}원`,
        '차량 재고평가액': `${(totalVehicleQty * (c.unitPrice || 0)).toLocaleString()}원`,
        '총 재고평가액': `${(((c.stockQty || 0) + totalVehicleQty) * (c.unitPrice || 0)).toLocaleString()}원`,
        '최근 구입처': c.supplier || '-'
      };
    });

    exportToExcel(excelData, `소모품_주기장재고대장_${new Date().toISOString().split('T')[0]}`, '주기장재고');
  };

  const handleExportVehicleStock = () => {
    const excelData = (mechanicConsumableStocks || []).map((ms, idx) => {
      const item = consumables.find(c => c.id === ms.consumableId);
      const mechanic = users.find(u => u.id === ms.mechanicId);
      return {
        'No': idx + 1,
        '담당 정비사': mechanic?.name || '정비사',
        '자재 품목명': item?.modelName || '-',
        '차량 적재 수량': ms.stockQty,
        '단위': item?.unit || '개',
        '단가': `${(item?.unitPrice || 0).toLocaleString()}원`,
        '평가액': `${(ms.stockQty * (item?.unitPrice || 0)).toLocaleString()}원`,
        '최종 변경일': ms.updatedAt
      };
    });

    exportToExcel(excelData, `소모품_차량재고대장_${new Date().toISOString().split('T')[0]}`, '차량재고');
  };

  // --- 품목 마스터 CUD 핸들러 ---
  const openCreateMaster = () => {
    setMasterEditingId(null);
    setMasterModelName('');
    setMasterUnit('개');
    setMasterUnitPrice(0);
    setMasterSupplier('');
    setMasterInitialStockQty(0);
    setShowMasterModal(true);
  };

  const openEditMaster = (item: Consumable) => {
    setMasterEditingId(item.id);
    setMasterModelName(item.modelName);
    setMasterUnit(item.unit || '개');
    setMasterUnitPrice(item.unitPrice || 0);
    setMasterSupplier(item.supplier || '');
    setMasterInitialStockQty(item.stockQty || 0);
    setShowMasterModal(true);
  };

  const handleSaveMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterModelName.trim()) {
      showToast('품목명을 입력해 주세요.', 'error');
      return;
    }
    try {
      if (masterEditingId) {
        await updateConsumable(masterEditingId, {
          modelName: masterModelName.trim(),
          unit: masterUnit.trim() || '개',
          unitPrice: masterUnitPrice,
          supplier: masterSupplier.trim()
        });
        showToast('품목 마스터 정보가 성공적으로 수정되었습니다.');
      } else {
        await addConsumable({
          modelName: masterModelName.trim(),
          unit: masterUnit.trim() || '개',
          unitPrice: masterUnitPrice,
          supplier: masterSupplier.trim(),
          stockQty: masterInitialStockQty
        });
        showToast('신규 품목 마스터가 성공적으로 등록되었습니다.');
      }
      setShowMasterModal(false);
    } catch (err: any) {
      showErrorModal(`⚠️ 품목 저장 실패:\n${err?.message || err}`);
    }
  };

  const handleDeleteMaster = async (id: string, modelName: string) => {
    if (!window.confirm(`[${modelName}] 품목을 정말 삭제하시겠습니까?`)) return;
    try {
      await deleteConsumable(id);
      showToast(`[${modelName}] 품목이 삭제되었습니다.`);
    } catch (err: any) {
      showErrorModal(`⚠️ 품목 삭제 실패:\n${err?.message || err}`);
    }
  };

  // --- 본사 ➔ 차량 불출 핸들러 ---
  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferMechanicId || !transferConsumableId || transferQty <= 0) {
      showToast('정비사와 소모품 품목, 불출 수량을 선택해 주세요.', 'error');
      return;
    }
    const targetItem = consumables.find(c => c.id === transferConsumableId);
    if (!targetItem) return;
    if (transferQty > targetItem.stockQty) {
      showErrorModal(`불출 요청 수량(${transferQty}개)이 본사 가용 재고(${targetItem.stockQty}개)를 초과할 수 없습니다.`);
      return;
    }

    try {
      await transferConsumableToMechanic(transferMechanicId, transferConsumableId, transferQty, transferMemo);
      await db.awaitPendingWrites();
      showToast('본사 창고에서 정비사 차량으로 소모품 불출 이동이 완료되었습니다.');
      setShowTransferModal(false);
      setTransferQty(1);
      setTransferMemo('');
    } catch (err: any) {
      showErrorModal(err?.message || '소모품 불출 이동 중 오류가 발생했습니다.');
    }
  };

  // --- 차량 ➔ 본사 반납 핸들러 ---
  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnMechanicId || !returnConsumableId || returnQty <= 0) {
      showToast('정비사와 반납 소모품 품목, 반납 수량을 선택해 주세요.', 'error');
      return;
    }
    const currentVehicleStock = (mechanicConsumableStocks || []).find(
      ms => ms.mechanicId === returnMechanicId && ms.consumableId === returnConsumableId
    )?.stockQty || 0;

    if (returnQty > currentVehicleStock) {
      showErrorModal(`반납 요청 수량(${returnQty}개)이 정비사 차량 보유 재고(${currentVehicleStock}개)를 초과할 수 없습니다.`);
      return;
    }

    try {
      await returnConsumableToHq(returnMechanicId, returnConsumableId, returnQty, returnMemo, isReturnDefective, returnDisposition);
      await db.awaitPendingWrites();
      showToast(isReturnDefective 
        ? `수거 고품(${returnDisposition === 'REBUILD' ? '재생' : returnDisposition === 'SCRAP' ? '폐기' : '무상보증'}) 반납 격리 처리가 완료되었습니다.`
        : '정비사 차량에서 본사 창고로 정상 소모품 반납이 완료되었습니다.');
      setShowReturnModal(false);
      setReturnQty(1);
      setReturnMemo('');
      setIsReturnDefective(false);
      setReturnDisposition('REBUILD');
    } catch (err: any) {
      showErrorModal(err?.message || '소모품 반납 중 오류가 발생했습니다.');
    }
  };

  // --- 차량 간(P2P) 이동 핸들러 ---
  const handleP2PSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!p2pFromMechanicId || !p2pToMechanicId || !p2pConsumableId || p2pQty <= 0) {
      showToast('양도/양수 정비사 및 부품, 수량을 올바르게 지정해 주세요.', 'error');
      return;
    }
    if (p2pFromMechanicId === p2pToMechanicId) {
      showToast('동일한 정비사 간에는 이동할 수 없습니다.', 'error');
      return;
    }
    const fromStock = (mechanicConsumableStocks || []).find(
      ms => ms.mechanicId === p2pFromMechanicId && ms.consumableId === p2pConsumableId
    )?.stockQty || 0;

    if (p2pQty > fromStock) {
      showErrorModal(`양도 정비사 차량의 보유 재고(${fromStock}개)를 초과할 수 없습니다.`);
      return;
    }

    try {
      await transferConsumableBetweenMechanics(p2pFromMechanicId, p2pToMechanicId, p2pConsumableId, p2pQty, p2pMemo);
      await db.awaitPendingWrites();
      showToast('정비사 차량 간 부품 융통 이동이 성공적으로 완료되었습니다.');
      setShowP2PModal(false);
      setP2pQty(1);
      setP2pMemo('');
    } catch (err: any) {
      showErrorModal(err?.message || '차량 간 부품 이동 중 오류가 발생했습니다.');
    }
  };

  // --- 신규 실사 전표 생성 핸들러 ---
  const handleCreateAuditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (newAuditTargetType === 'VEHICLE' && !newAuditMechanicId) {
      showToast('차량 실사의 경우 담당 정비사를 선택해 주세요.', 'error');
      return;
    }

    try {
      const newAudit = await createStocktakingAudit(
        newAuditTargetType, 
        newAuditTargetType === 'VEHICLE' ? newAuditMechanicId : undefined, 
        newAuditMemo
      );
      await db.awaitPendingWrites();
      showToast(`재고실사 전표(${newAudit.auditNo})가 성공적으로 생성되었습니다.`);
      setSelectedAuditId(newAudit.id);
      setShowCreateAuditModal(false);
      setNewAuditMemo('');
    } catch (err: any) {
      showErrorModal(`⚠️ 실사 전표 생성 실패:\n${err?.message || err}`);
    }
  };

  // --- 실사 품목 수량 인라인 수정 핸들러 ---
  const handleAuditItemQtyChange = async (itemId: string, newActualQty: number, diffReason?: StocktakingAuditItem['diffReason'], note?: string) => {
    if (!selectedAuditId) return;
    try {
      await updateStocktakingItem(selectedAuditId, itemId, newActualQty, diffReason, note);
    } catch (err: any) {
      showToast(err?.message || '수량 반영 실패', 'error');
    }
  };

  // --- 실사 확정 핸들러 ---
  const handleConfirmAudit = async (auditId: string) => {
    if (!canSave) return;
    try {
      await confirmStocktakingAudit(auditId);
      await db.awaitPendingWrites();
      showToast('재고 실사가 최종 확정되어 전산 재고가 강제 보정되었습니다.');
    } catch (err: any) {
      showErrorModal(`⚠️ 실사 확정 실패:\n${err?.message || err}`);
    }
  };

  // --- 실사 취소 핸들러 ---
  const handleCancelAudit = async (auditId: string) => {
    if (!canSave) return;
    try {
      await cancelStocktakingAudit(auditId);
      await db.awaitPendingWrites();
      showToast('실사 전표가 취소되었습니다.');
    } catch (err: any) {
      showErrorModal(`⚠️ 실사 취소 실패:\n${err?.message || err}`);
    }
  };

  // --- 수거 고품 처리 상태 변경 핸들러 ---
  const handleProcessCollectedPart = async (partId: string, actionStatus: 'IN_PROCESS' | 'COMPLETED', actionMemo?: string) => {
    if (!canSave) return;
    try {
      await processCollectedPart(partId, actionStatus, actionMemo);
      await db.awaitPendingWrites();
      showToast(`고품 상태가 '${actionStatus === 'COMPLETED' ? '완료' : '처리중'}'으로 갱신되었습니다.`);
    } catch (err: any) {
      showErrorModal(`⚠️ 고품 상태 갱신 실패:\n${err?.message || err}`);
    }
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
            소모품 재고 관리
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
            <ShieldCheck size={14} style={{ color: '#059669' }} />
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              주기장 창고 재고, 기사 차량 적재 재고, 고품 수거 격리 및 재고 실사 감사 스튜디오
            </span>
          </div>
        </div>

        {/* 탭 버튼군 (무수식어 건조 표준) */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={activeTab === 'STOCK' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveTab('STOCK')}
            style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          >
            <Boxes size={14} /> 주기장 재고
          </button>
          <button
            type="button"
            className={activeTab === 'VEHICLE_STOCK' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveTab('VEHICLE_STOCK')}
            style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          >
            <Truck size={14} /> 차량 재고
          </button>
          <button
            type="button"
            className={activeTab === 'COLLECTED_PARTS' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveTab('COLLECTED_PARTS')}
            style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          >
            <Archive size={14} /> 고품 관리
            {collectedParts.filter(p => p.status !== 'COMPLETED').length > 0 && (
              <span style={{
                backgroundColor: '#7c3aed', color: '#fff', fontSize: '11px',
                padding: '1px 6px', borderRadius: '10px', fontWeight: 700
              }}>
                {collectedParts.filter(p => p.status !== 'COMPLETED').length}
              </span>
            )}
          </button>
          <button
            type="button"
            className={activeTab === 'STOCKTAKING' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveTab('STOCKTAKING')}
            style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          >
            <CheckSquare size={14} /> 재고 실사
            {stocktakingAudits.filter(a => a.status === 'DRAFT').length > 0 && (
              <span style={{
                backgroundColor: '#d97706', color: '#fff', fontSize: '11px',
                padding: '1px 6px', borderRadius: '10px', fontWeight: 700
              }}>
                {stocktakingAudits.filter(a => a.status === 'DRAFT').length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [TAB 1] 주기장 재고 (본사 중앙 창고) */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'STOCK' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 상단 통계 카드 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            <div className="card" style={{ margin: 0, padding: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>총 관리 품목 수</div>
              <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', color: 'var(--primary)' }}>
                {stockSummary.hqTotalKinds}종
              </div>
            </div>
            <div className="card" style={{ margin: 0, padding: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>주기장 보유 수량</div>
              <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', color: '#059669' }}>
                {stockSummary.hqTotalQty.toLocaleString()}개
              </div>
            </div>
            <div className="card" style={{ margin: 0, padding: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>주기장 재고 평가액</div>
              <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', color: 'var(--text-primary)' }}>
                ₩{stockSummary.hqTotalValue.toLocaleString()}
              </div>
            </div>
            <div className="card" style={{ margin: 0, padding: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>전사 총 재고 (주기장+차량)</div>
              <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '4px', color: '#7c3aed' }}>
                ₩{stockSummary.grandTotalValue.toLocaleString()}
              </div>
            </div>
          </div>

          {/* 검색 및 액션 바 */}
          <div className="card" style={{ margin: 0, padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="text"
                  value={stockSearch}
                  onChange={e => setStockSearch(e.target.value)}
                  placeholder="품목명, 공급처 검색..."
                  style={{ padding: '6px 10px', fontSize: '12.5px', width: '220px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleExportStock}
                  style={{ padding: '7px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Download size={14} /> 엑셀 내보내기
                </button>
                {canSave && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={openCreateMaster}
                    style={{ padding: '7px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Plus size={14} /> 품목 마스터 등록
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 품목 마스터 목록 테이블 */}
          <div className="card" style={{ margin: 0 }}>
            <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>No</th>
                    <th>품목명</th>
                    <th style={{ textAlign: 'center' }}>주기장 재고</th>
                    <th style={{ textAlign: 'center' }}>차량 재고</th>
                    <th style={{ textAlign: 'center' }}>전사 총수량</th>
                    <th>단위</th>
                    <th>단가</th>
                    <th>주기장 평가액</th>
                    <th>공급처</th>
                    <th style={{ textAlign: 'center' }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filtered = consumables.filter(c => {
                      return !stockSearch || 
                        c.modelName.toLowerCase().includes(stockSearch.toLowerCase()) || 
                        (c.supplier || '').toLowerCase().includes(stockSearch.toLowerCase());
                    });

                    if (filtered.length === 0) {
                      return (
                        <tr>
                          <td colSpan={10} style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                            등록된 소모품 품목이 없습니다.
                          </td>
                        </tr>
                      );
                    }

                    return filtered.map((c, idx) => {
                      const totalVehicleQty = (mechanicConsumableStocks || [])
                        .filter(ms => ms.consumableId === c.id)
                        .reduce((sum, ms) => sum + ms.stockQty, 0);
                      const grandQty = c.stockQty + totalVehicleQty;
                      const hqValue = (c.stockQty || 0) * (c.unitPrice || 0);

                      return (
                        <tr key={c.id}>
                          <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{idx + 1}</td>
                          <td><strong style={{ color: 'var(--primary)' }}>{c.modelName}</strong></td>
                          <td style={{ textAlign: 'center', fontWeight: 700, color: c.stockQty > 0 ? '#059669' : '#dc2626' }}>
                            {c.stockQty}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>{totalVehicleQty}</td>
                          <td style={{ textAlign: 'center', fontWeight: 800, color: '#2563eb' }}>{grandQty}</td>
                          <td style={{ fontSize: '12px' }}>{c.unit || '개'}</td>
                          <td style={{ fontSize: '12px' }}>{(c.unitPrice || 0).toLocaleString()}원</td>
                          <td style={{ fontWeight: 600 }}>{hqValue.toLocaleString()}원</td>
                          <td style={{ fontSize: '12px' }}>{c.supplier || '-'}</td>
                          <td style={{ textAlign: 'center' }}>
                            {canSave && (
                              <div style={{ display: 'inline-flex', gap: '4px' }}>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => openEditMaster(c)}
                                  style={{ padding: '2px 6px', fontSize: '11px' }}
                                >
                                  <Edit size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => handleDeleteMaster(c.id, c.modelName)}
                                  style={{ padding: '2px 6px', fontSize: '11px', color: '#dc2626' }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            )}
                          </td>
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
      {/* [TAB 2] 차량 재고 (AS 정비사 차량 적재 이동재고) */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'VEHICLE_STOCK' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 상단 액션 바: 3대 이동 모달 호출 버튼군 */}
          <div className="card" style={{ margin: 0, padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <select
                  value={selectedMechanicFilter}
                  onChange={e => setSelectedMechanicFilter(e.target.value)}
                  style={{ padding: '6px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                >
                  <option value="ALL">전체 정비사 차량</option>
                  {mechanics.map(m => (
                    <option key={m.id} value={m.id}>{m.name} 차량</option>
                  ))}
                </select>

                <input
                  type="text"
                  value={vehicleStockSearch}
                  onChange={e => setVehicleStockSearch(e.target.value)}
                  placeholder="품목명 검색..."
                  style={{ padding: '6px 10px', fontSize: '12px', width: '160px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {canSave && (
                  <>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => {
                        setTransferMechanicId(mechanics[0]?.id || '');
                        setTransferConsumableId(consumables[0]?.id || '');
                        setTransferQty(1);
                        setShowTransferModal(true);
                      }}
                      style={{ padding: '7px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <ArrowUpRight size={14} /> 본사 ➔ 차량 불출
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setReturnMechanicId(mechanics[0]?.id || '');
                        setReturnConsumableId(consumables[0]?.id || '');
                        setReturnQty(1);
                        setShowReturnModal(true);
                      }}
                      style={{ padding: '7px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <ArrowDownLeft size={14} /> 차량 ➔ 본사 반납
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setP2pFromMechanicId(mechanics[0]?.id || '');
                        setP2pToMechanicId(mechanics[1]?.id || mechanics[0]?.id || '');
                        setP2pConsumableId(consumables[0]?.id || '');
                        setP2pQty(1);
                        setShowP2PModal(true);
                      }}
                      style={{ padding: '7px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <ArrowRightLeft size={14} /> 차량 간 P2P 이동
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleExportVehicleStock}
                  style={{ padding: '7px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Download size={14} /> 엑셀 내보내기
                </button>
              </div>
            </div>
          </div>

          {/* 차량 이동재고 테이블 */}
          <div className="card" style={{ margin: 0 }}>
            <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>담당 정비사</th>
                    <th>품목명</th>
                    <th style={{ textAlign: 'center' }}>차량 적재수량</th>
                    <th>단위</th>
                    <th>단가</th>
                    <th>평가 금액</th>
                    <th>최종 갱신일</th>
                    <th style={{ textAlign: 'center' }}>인라인 조치</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filteredList = (mechanicConsumableStocks || []).filter(ms => {
                      if (ms.stockQty <= 0) return false;
                      const matchMech = selectedMechanicFilter === 'ALL' || ms.mechanicId === selectedMechanicFilter;
                      const item = consumables.find(c => c.id === ms.consumableId);
                      const matchSearch = !vehicleStockSearch || (item?.modelName || '').toLowerCase().includes(vehicleStockSearch.toLowerCase());
                      return matchMech && matchSearch;
                    });

                    if (filteredList.length === 0) {
                      return (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                            차량에 적재된 이동 재고 내역이 없습니다.
                          </td>
                        </tr>
                      );
                    }

                    return filteredList.map(ms => {
                      const item = consumables.find(c => c.id === ms.consumableId);
                      const mech = users.find(u => u.id === ms.mechanicId);
                      const unitPrice = item?.unitPrice || 0;

                      return (
                        <tr key={ms.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
                              <Truck size={13} style={{ color: 'var(--primary)' }} /> {mech?.name || '정비사'}
                            </div>
                          </td>
                          <td><strong style={{ color: 'var(--primary)' }}>{item?.modelName || '-'}</strong></td>
                          <td style={{ textAlign: 'center', fontWeight: 800, color: '#059669' }}>
                            {ms.stockQty}
                          </td>
                          <td style={{ fontSize: '12px' }}>{item?.unit || '개'}</td>
                          <td style={{ fontSize: '12px' }}>{unitPrice.toLocaleString()}원</td>
                          <td style={{ fontWeight: 600 }}>{(ms.stockQty * unitPrice).toLocaleString()}원</td>
                          <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{ms.updatedAt}</td>
                          <td style={{ textAlign: 'center' }}>
                            {canSave && (
                              <div style={{ display: 'inline-flex', gap: '4px' }}>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => {
                                    setTransferMechanicId(ms.mechanicId);
                                    setTransferConsumableId(ms.consumableId);
                                    setShowTransferModal(true);
                                  }}
                                  style={{ padding: '2px 6px', fontSize: '11px' }}
                                >
                                  추가불출
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => {
                                    setReturnMechanicId(ms.mechanicId);
                                    setReturnConsumableId(ms.consumableId);
                                    setReturnQty(Math.min(ms.stockQty, 1));
                                    setShowReturnModal(true);
                                  }}
                                  style={{ padding: '2px 6px', fontSize: '11px' }}
                                >
                                  본사반납
                                </button>
                              </div>
                            )}
                          </td>
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
      {/* [TAB 3] 고품 관리 (폐부품/교체부품 격리 및 사후처리) */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'COLLECTED_PARTS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 상단 요약 카드 */}
          {(() => {
            const totalCount = collectedParts.length;
            const rebuildCount = collectedParts.filter(p => p.disposition === 'REBUILD').length;
            const scrapCount = collectedParts.filter(p => p.disposition === 'SCRAP').length;
            const warrantyCount = collectedParts.filter(p => p.disposition === 'VENDOR_WARRANTY').length;

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div className="card" style={{ margin: 0, padding: '14px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>총 수거 고품</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '2px' }}>{totalCount}건</div>
                </div>
                <div className="card" style={{ margin: 0, padding: '14px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>재생 대상 (REBUILD)</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '2px', color: '#7c3aed' }}>{rebuildCount}건</div>
                </div>
                <div className="card" style={{ margin: 0, padding: '14px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>폐기/고철 (SCRAP)</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '2px', color: '#ea580c' }}>{scrapCount}건</div>
                </div>
                <div className="card" style={{ margin: 0, padding: '14px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>제조사 무상보증 클레임</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, marginTop: '2px', color: '#2563eb' }}>{warrantyCount}건</div>
                </div>
              </div>
            );
          })()}

          {/* 필터 바 */}
          <div className="card" style={{ margin: 0, padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <select
                  value={partDispositionFilter}
                  onChange={e => setPartDispositionFilter(e.target.value as any)}
                  style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                >
                  <option value="ALL">전체 처분구분</option>
                  <option value="REBUILD">재생 대상 (REBUILD)</option>
                  <option value="SCRAP">폐기/고철 (SCRAP)</option>
                  <option value="VENDOR_WARRANTY">제조사 무상보증 (WARRANTY)</option>
                </select>

                <select
                  value={partStatusFilter}
                  onChange={e => setPartStatusFilter(e.target.value as any)}
                  style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                >
                  <option value="ALL">전체 처리상태</option>
                  <option value="RECEIVED">수거 접수 (RECEIVED)</option>
                  <option value="IN_PROCESS">처리 진행중 (IN_PROCESS)</option>
                  <option value="COMPLETED">조치 완료 (COMPLETED)</option>
                </select>

                <input
                  type="text"
                  value={partSearch}
                  onChange={e => setPartSearch(e.target.value)}
                  placeholder="부품명, 관리번호 검색..."
                  style={{ padding: '6px 10px', fontSize: '12px', width: '160px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                />
              </div>
            </div>
          </div>

          {/* 고품 목록 테이블 */}
          <div className="card" style={{ margin: 0 }}>
            <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>고품 번호</th>
                    <th>부품 품목명</th>
                    <th style={{ textAlign: 'center' }}>수량</th>
                    <th>수거 정비사</th>
                    <th style={{ textAlign: 'center' }}>처분 구분</th>
                    <th style={{ textAlign: 'center' }}>처리 상태</th>
                    <th>수거 일자</th>
                    <th>조치 일자</th>
                    <th>조치 메모</th>
                    <th style={{ textAlign: 'center' }}>조치 액션</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filtered = collectedParts.filter(p => {
                      const matchDisp = partDispositionFilter === 'ALL' || p.disposition === partDispositionFilter;
                      const matchStatus = partStatusFilter === 'ALL' || p.status === partStatusFilter;
                      const matchSearch = !partSearch || 
                        p.modelName.toLowerCase().includes(partSearch.toLowerCase()) || 
                        p.partNo.toLowerCase().includes(partSearch.toLowerCase());
                      return matchDisp && matchStatus && matchSearch;
                    });

                    if (filtered.length === 0) {
                      return (
                        <tr>
                          <td colSpan={10} style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                            수거된 고품 내역이 없습니다. (차량 반납 시 '고품' 체크 시 자동 등록됩니다)
                          </td>
                        </tr>
                      );
                    }

                    return filtered.map(p => {
                      const dispLabel = p.disposition === 'REBUILD' ? '재생 대상' : (p.disposition === 'SCRAP' ? '폐기/고철' : '제조사 보증');
                      const dispColor = p.disposition === 'REBUILD' ? '#7c3aed' : (p.disposition === 'SCRAP' ? '#ea580c' : '#2563eb');
                      const dispBg = p.disposition === 'REBUILD' ? 'rgba(124, 58, 237, 0.1)' : (p.disposition === 'SCRAP' ? 'rgba(234, 88, 12, 0.1)' : 'rgba(37, 99, 235, 0.1)');

                      const statusLabel = p.status === 'COMPLETED' ? '조치 완료' : (p.status === 'IN_PROCESS' ? '처리중' : '수거 접수');
                      const statusColor = p.status === 'COMPLETED' ? '#059669' : (p.status === 'IN_PROCESS' ? '#2563eb' : '#d97706');

                      return (
                        <tr key={p.id}>
                          <td><strong>{p.partNo}</strong></td>
                          <td><strong style={{ color: 'var(--primary)' }}>{p.modelName}</strong></td>
                          <td style={{ textAlign: 'center', fontWeight: 800 }}>{p.quantity}개</td>
                          <td>{p.mechanicName}</td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', color: dispColor, backgroundColor: dispBg }}>
                              {dispLabel}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{ fontSize: '11.5px', fontWeight: 700, color: statusColor }}>
                              {statusLabel}
                            </span>
                          </td>
                          <td style={{ fontSize: '12px' }}>{p.receivedDate}</td>
                          <td style={{ fontSize: '12px' }}>{p.actionDate || '-'}</td>
                          <td style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{p.actionMemo || p.memo || '-'}</td>
                          <td style={{ textAlign: 'center' }}>
                            {canSave && p.status !== 'COMPLETED' && (
                              <div style={{ display: 'inline-flex', gap: '4px' }}>
                                {p.status === 'RECEIVED' && (
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => handleProcessCollectedPart(p.id, 'IN_PROCESS', '재생/외주 정비 또는 폐기 착수')}
                                    style={{ padding: '2px 6px', fontSize: '11px' }}
                                  >
                                    착수
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn-primary"
                                  onClick={() => handleProcessCollectedPart(p.id, 'COMPLETED', `${dispLabel} 최종 조치 완료`)}
                                  style={{ padding: '2px 8px', fontSize: '11px' }}
                                >
                                  조치완료
                                </button>
                              </div>
                            )}
                          </td>
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
      {/* [TAB 4] 재고 실사 (Stocktaking Audit Studio) */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'STOCKTAKING' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 상단: 실사 전표 스코프 및 필터 바 */}
          <div className="card" style={{ margin: 0, padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>실사 대상 구분</label>
                  <select
                    value={auditTargetFilter}
                    onChange={e => setAuditTargetFilter(e.target.value as any)}
                    style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                  >
                    <option value="ALL">전체 대상</option>
                    <option value="HQ">주기장 창고</option>
                    <option value="VEHICLE">정비 차량</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>실사 상태</label>
                  <select
                    value={auditStatusFilter}
                    onChange={e => setAuditStatusFilter(e.target.value as any)}
                    style={{ padding: '6px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                  >
                    <option value="ALL">전체 상태</option>
                    <option value="DRAFT">작성중 (DRAFT)</option>
                    <option value="CONFIRMED">실사확정 (CONFIRMED)</option>
                    <option value="CANCELLED">취소 (CANCELLED)</option>
                  </select>
                </div>
              </div>

              {canSave && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setNewAuditTargetType('HQ');
                    setNewAuditMechanicId(mechanics[0]?.id || '');
                    setNewAuditMemo('');
                    setShowCreateAuditModal(true);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 14px', fontSize: '13px' }}
                >
                  <Plus size={14} /> 새 실사 전표 생성
                </button>
              )}
            </div>

            {/* 실사 전표 카드 목록 */}
            <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 700, marginBottom: '8px', color: 'var(--text-secondary)' }}>
                실사 전표 목록 ({stocktakingAudits.length}건)
              </div>
              <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '6px' }}>
                {(() => {
                  const filteredAudits = stocktakingAudits.filter(a => {
                    const matchTarget = auditTargetFilter === 'ALL' || a.targetType === auditTargetFilter;
                    const matchStatus = auditStatusFilter === 'ALL' || a.status === auditStatusFilter;
                    return matchTarget && matchStatus;
                  });

                  if (filteredAudits.length === 0) {
                    return (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '10px 0' }}>
                        조건에 맞는 실사 전표가 없습니다. [새 실사 전표 생성] 버튼을 눌러 실사를 시작하세요.
                      </div>
                    );
                  }

                  return filteredAudits.map(a => {
                    const isSelected = selectedAuditId === a.id;
                    const statusColor = a.status === 'CONFIRMED' ? '#059669' : (a.status === 'CANCELLED' ? '#dc2626' : '#d97706');
                    const statusBg = a.status === 'CONFIRMED' ? 'rgba(5, 150, 105, 0.1)' : (a.status === 'CANCELLED' ? 'rgba(220, 38, 38, 0.1)' : 'rgba(217, 119, 6, 0.1)');

                    return (
                      <div
                        key={a.id}
                        onClick={() => setSelectedAuditId(a.id)}
                        style={{
                          minWidth: '220px', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
                          backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-app)',
                          border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--primary)' }}>{a.auditNo}</span>
                          <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', color: statusColor, backgroundColor: statusBg }}>
                            {a.status === 'CONFIRMED' ? '확정' : a.status === 'CANCELLED' ? '취소' : '작성중'}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: 600, marginTop: '4px' }}>
                          {a.targetType === 'HQ' ? '주기장 본사창고' : `차량: ${a.mechanicName || '정비사'}`}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {a.auditDate} | {stocktakingAuditItems.filter(i => i.auditId === a.id).length}개 품목
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>

          {/* 선택 전표 상세 대사 스튜디오 */}
          {(() => {
            const currentAudit = stocktakingAudits.find(a => a.id === selectedAuditId);
            if (!currentAudit) {
              return (
                <div className="card" style={{ margin: 0, padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  상단에서 실사 전표를 선택하면 전산 재고 vs 실사 수량 대사 작업대가 표시됩니다.
                </div>
              );
            }

            const currentItems = stocktakingAuditItems.filter(item => {
              const matchAudit = item.auditId === currentAudit.id;
              const matchSearch = !auditItemSearch || item.modelName.toLowerCase().includes(auditItemSearch.toLowerCase());
              return matchAudit && matchSearch;
            });
            const isDraft = currentAudit.status === 'DRAFT';

            return (
              <div className="card" style={{ margin: 0 }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FileCheck size={16} style={{ color: 'var(--primary)' }} />
                      전표 [{currentAudit.auditNo}] 실사 검증 대장
                    </h3>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      전산재고 ↔ 실사수량 1:1 인라인 검증 및 차이 사유 확정
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={auditItemSearch}
                      onChange={e => setAuditItemSearch(e.target.value)}
                      placeholder="실사 품목 검색..."
                      style={{ padding: '5px 8px', fontSize: '12px', width: '150px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                    />
                    {isDraft && canSave && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleCancelAudit(currentAudit.id)}
                        style={{ padding: '5px 10px', fontSize: '12px', color: '#dc2626' }}
                      >
                        전표 취소
                      </button>
                    )}
                  </div>
                </div>

                <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'center' }}>No</th>
                        <th>품목명</th>
                        <th>단위</th>
                        <th style={{ textAlign: 'right' }}>단가</th>
                        <th style={{ textAlign: 'center' }}>전산 수량</th>
                        <th style={{ textAlign: 'center' }}>실사 수량</th>
                        <th style={{ textAlign: 'center' }}>차이 수량</th>
                        <th style={{ textAlign: 'right' }}>차이 금액</th>
                        <th>차이 사유 (횡령/감모 원인)</th>
                        <th>메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentItems.length === 0 ? (
                        <tr>
                          <td colSpan={10} style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                            실사 대상 품목이 없습니다.
                          </td>
                        </tr>
                      ) : (
                        currentItems.map((item, idx) => {
                          const hasDiff = item.diffQty !== 0;

                          return (
                            <tr key={item.id} style={{ backgroundColor: hasDiff ? 'rgba(239, 68, 68, 0.04)' : undefined }}>
                              <td style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>{idx + 1}</td>
                              <td><strong style={{ color: 'var(--primary)' }}>{item.modelName}</strong></td>
                              <td style={{ fontSize: '12px' }}>{item.unit}</td>
                              <td style={{ textAlign: 'right', fontSize: '12px' }}>₩{(item.unitPrice || 0).toLocaleString()}</td>
                              <td style={{ textAlign: 'center', fontWeight: 700 }}>{item.systemQty}</td>
                              <td style={{ textAlign: 'center' }}>
                                {isDraft ? (
                                  <input
                                    type="number"
                                    min={0}
                                    value={item.actualQty}
                                    onChange={e => {
                                      const val = parseInt(e.target.value) || 0;
                                      handleAuditItemQtyChange(item.id, val, item.diffReason, item.note);
                                    }}
                                    style={{
                                      width: '70px', padding: '4px', textAlign: 'center', fontWeight: 800,
                                      borderRadius: '4px',
                                      border: hasDiff ? '2px solid #dc2626' : '1px solid var(--border-color)',
                                      backgroundColor: hasDiff ? '#fff1f2' : 'inherit'
                                    }}
                                  />
                                ) : (
                                  <strong style={{ color: 'var(--primary)' }}>{item.actualQty}</strong>
                                )}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                {item.diffQty === 0 ? (
                                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>0</span>
                                ) : item.diffQty > 0 ? (
                                  <span className="badge badge-primary" style={{ fontWeight: 800 }}>+{item.diffQty} (잉여)</span>
                                ) : (
                                  <span className="badge badge-danger" style={{ fontWeight: 800 }}>{item.diffQty} (감모)</span>
                                )}
                              </td>
                              <td style={{
                                textAlign: 'right', fontWeight: 700, fontSize: '12px',
                                color: item.diffAmount === 0 ? 'inherit' : (item.diffAmount > 0 ? '#2563eb' : '#dc2626')
                              }}>
                                {item.diffAmount === 0 ? '-' : `₩${(item.diffAmount || 0).toLocaleString()}`}
                              </td>
                              <td>
                                {isDraft ? (
                                  <select
                                    value={item.diffReason || 'OTHER'}
                                    disabled={!hasDiff}
                                    onChange={e => handleAuditItemQtyChange(item.id, item.actualQty, e.target.value as any, item.note)}
                                    style={{ padding: '3px 6px', fontSize: '11px', width: '100%', opacity: hasDiff ? 1 : 0.4 }}
                                  >
                                    <option value="LOST">망실/도난</option>
                                    <option value="DAMAGED">파손/부식/폐기</option>
                                    <option value="UNRECORDED_USAGE">미기록 현장소모</option>
                                    <option value="SURPLUS">미등록 잉여수거</option>
                                    <option value="OTHER">기타 사유</option>
                                  </select>
                                ) : (
                                  <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                                    {item.diffReason === 'LOST' ? '망실/도난' :
                                     item.diffReason === 'DAMAGED' ? '파손/부식' :
                                     item.diffReason === 'UNRECORDED_USAGE' ? '미기록 현장소모' :
                                     item.diffReason === 'SURPLUS' ? '미등록 잉여' : (item.diffQty !== 0 ? '기타' : '-')}
                                  </span>
                                )}
                              </td>
                              <td>
                                {isDraft ? (
                                  <input
                                    type="text"
                                    value={item.note || ''}
                                    placeholder="특이사항 메모..."
                                    onChange={e => handleAuditItemQtyChange(item.id, item.actualQty, item.diffReason, e.target.value)}
                                    style={{ width: '100%', padding: '3px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                                  />
                                ) : (
                                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{item.note || '-'}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 하단 Gutenberg Z-패턴 대차대조식 터미널 바 */}
                <div style={{
                  padding: '14px 20px', backgroundColor: 'var(--bg-app)', borderTop: '1px solid var(--border-color)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px'
                }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span>📦 <strong>실물 총액:</strong> ₩{currentAudit.totalActualAmount.toLocaleString()}원</span>
                    <span>=</span>
                    <span>💻 <strong>전산 총액:</strong> ₩{currentAudit.totalSystemAmount.toLocaleString()}원</span>
                    <span>+</span>
                    <span>⚖️ <strong>실사 차액:</strong> ₩{currentAudit.totalDiffAmount.toLocaleString()}원</span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ color: '#059669', fontWeight: 800 }}>⚖️ 대차 차액 ₩0 무결 확정</span>
                  </div>

                  {isDraft && canSave && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleConfirmAudit(currentAudit.id)}
                      style={{ padding: '8px 18px', fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <CheckCircle2 size={16} /> 실사 확정 및 재고 강제 반영
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 본사 ➔ 차량 불출 모달 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showTransferModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <form onSubmit={handleTransferSubmit} className="card" style={{ width: '90%', maxWidth: '450px', backgroundColor: 'var(--bg-card)', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ArrowUpRight size={16} style={{ color: 'var(--primary)' }} /> 본사 창고 ➔ 차량 소모품 불출
              </h3>
              <button type="button" onClick={() => setShowTransferModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>수령 정비사 (차량) *</label>
                <select value={transferMechanicId} onChange={e => setTransferMechanicId(e.target.value)} required style={{ padding: '8px', fontSize: '13px' }}>
                  <option value="">-- 정비사 선택 --</option>
                  {mechanics.map(m => (
                    <option key={m.id} value={m.id}>{m.name} 차량</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>불출 소모품 품목 *</label>
                <select value={transferConsumableId} onChange={e => setTransferConsumableId(e.target.value)} required style={{ padding: '8px', fontSize: '13px' }}>
                  <option value="">-- 품목 선택 --</option>
                  {consumables.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.modelName} (본사재고: {c.stockQty}개 | ₩{c.unitPrice.toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>불출 수량 *</label>
                <input
                  type="number"
                  min={1}
                  value={transferQty}
                  onChange={e => setTransferQty(Math.max(1, parseInt(e.target.value) || 1))}
                  required
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>불출 목적 및 메모</label>
                <input
                  type="text"
                  value={transferMemo}
                  onChange={e => setTransferMemo(e.target.value)}
                  placeholder="예: 월간 정기 현장 AS 비상 비축용"
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowTransferModal(false)} style={{ flex: 1, padding: '10px' }}>
                  취소
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '10px' }}>
                  불출 완료
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 차량 ➔ 본사 반납 모달 (고품 격리 토글 포함) */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showReturnModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <form onSubmit={handleReturnSubmit} className="card" style={{ width: '90%', maxWidth: '450px', backgroundColor: 'var(--bg-card)', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ArrowDownLeft size={16} style={{ color: '#d97706' }} /> 차량 소모품 ➔ 본사 창고 반납
              </h3>
              <button type="button" onClick={() => setShowReturnModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>반납 정비사 (차량) *</label>
                <select value={returnMechanicId} onChange={e => setReturnMechanicId(e.target.value)} required style={{ padding: '8px', fontSize: '13px' }}>
                  <option value="">-- 정비사 선택 --</option>
                  {mechanics.map(m => (
                    <option key={m.id} value={m.id}>{m.name} 차량</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>반납 소모품 품목 *</label>
                <select value={returnConsumableId} onChange={e => setReturnConsumableId(e.target.value)} required style={{ padding: '8px', fontSize: '13px' }}>
                  <option value="">-- 품목 선택 --</option>
                  {consumables.map(c => (
                    <option key={c.id} value={c.id}>{c.modelName}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>반납 수량 *</label>
                <input
                  type="number"
                  min={1}
                  value={returnQty}
                  onChange={e => setReturnQty(Math.max(1, parseInt(e.target.value) || 1))}
                  required
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              {/* 고품 격리 체크 */}
              <div style={{ padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={isReturnDefective}
                    onChange={e => setIsReturnDefective(e.target.checked)}
                  />
                  <span>수거 고품(교체 폐부품/불량품) 반납 격리</span>
                </label>

                {isReturnDefective && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>사후 처분 구분 *</label>
                    <select
                      value={returnDisposition}
                      onChange={e => setReturnDisposition(e.target.value as any)}
                      style={{ padding: '6px', fontSize: '12px' }}
                    >
                      <option value="REBUILD">재생 대상 (공장 외주 수리/오버홀)</option>
                      <option value="SCRAP">폐기/고철 매각</option>
                      <option value="VENDOR_WARRANTY">제조사 무상보증 클레임 교환</option>
                    </select>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>반납 사유 및 메모</label>
                <input
                  type="text"
                  value={returnMemo}
                  onChange={e => setReturnMemo(e.target.value)}
                  placeholder="예: 잉여 부품 반납 또는 현장 교체 고품 회수"
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowReturnModal(false)} style={{ flex: 1, padding: '10px' }}>
                  취소
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '10px' }}>
                  반납 완료
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 차량 간(P2P) 이동 모달 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showP2PModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <form onSubmit={handleP2PSubmit} className="card" style={{ width: '90%', maxWidth: '450px', backgroundColor: 'var(--bg-card)', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ArrowRightLeft size={16} style={{ color: 'var(--primary)' }} /> 정비 차량 간(P2P) 부품 이동
              </h3>
              <button type="button" onClick={() => setShowP2PModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>양도 정비사 (출고) *</label>
                  <select value={p2pFromMechanicId} onChange={e => setP2pFromMechanicId(e.target.value)} required style={{ padding: '8px', fontSize: '12px' }}>
                    <option value="">-- 정비사 선택 --</option>
                    {mechanics.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>양수 정비사 (입고) *</label>
                  <select value={p2pToMechanicId} onChange={e => setP2pToMechanicId(e.target.value)} required style={{ padding: '8px', fontSize: '12px' }}>
                    <option value="">-- 정비사 선택 --</option>
                    {mechanics.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>이동 품목 *</label>
                <select value={p2pConsumableId} onChange={e => setP2pConsumableId(e.target.value)} required style={{ padding: '8px', fontSize: '13px' }}>
                  <option value="">-- 품목 선택 --</option>
                  {consumables.map(c => (
                    <option key={c.id} value={c.id}>{c.modelName}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>이동 수량 *</label>
                <input
                  type="number"
                  min={1}
                  value={p2pQty}
                  onChange={e => setP2pQty(Math.max(1, parseInt(e.target.value) || 1))}
                  required
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>이동 메모</label>
                <input
                  type="text"
                  value={p2pMemo}
                  onChange={e => setP2pMemo(e.target.value)}
                  placeholder="예: 현장 긴급 AS 부품 지원 융통"
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowP2PModal(false)} style={{ flex: 1, padding: '10px' }}>
                  취소
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '10px' }}>
                  이동 완료
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 품목 마스터 CUD 모달 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showMasterModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <form onSubmit={handleSaveMaster} className="card" style={{ width: '90%', maxWidth: '450px', backgroundColor: 'var(--bg-card)', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
                {masterEditingId ? '품목 마스터 정보 수정' : '신규 품목 마스터 등록'}
              </h3>
              <button type="button" onClick={() => setShowMasterModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>품목명 *</label>
                <input
                  type="text"
                  value={masterModelName}
                  onChange={e => setMasterModelName(e.target.value)}
                  placeholder="예: 엔진오일 15W-40, 유압호스 1/2"
                  required
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>단위</label>
                  <input
                    type="text"
                    value={masterUnit}
                    onChange={e => setMasterUnit(e.target.value)}
                    placeholder="개, L, 세트 등"
                    style={{ padding: '8px', fontSize: '13px' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>기본 단가 (원)</label>
                  <input
                    type="number"
                    min={0}
                    value={masterUnitPrice}
                    onChange={e => setMasterUnitPrice(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ padding: '8px', fontSize: '13px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>주요 공급처</label>
                <input
                  type="text"
                  value={masterSupplier}
                  onChange={e => setMasterSupplier(e.target.value)}
                  placeholder="예: 대한오일상사, 현대부품"
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              {!masterEditingId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>초기 주기장 보유 수량</label>
                  <input
                    type="number"
                    min={0}
                    value={masterInitialStockQty}
                    onChange={e => setMasterInitialStockQty(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ padding: '8px', fontSize: '13px' }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowMasterModal(false)} style={{ flex: 1, padding: '10px' }}>
                  취소
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '10px' }}>
                  {masterEditingId ? '수정 완료' : '등록 완료'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 신규 실사 전표 생성 모달 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showCreateAuditModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <form onSubmit={handleCreateAuditSubmit} className="card" style={{ width: '90%', maxWidth: '450px', backgroundColor: 'var(--bg-card)', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>새 재고 실사 전표 생성</h3>
              <button type="button" onClick={() => setShowCreateAuditModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>실사 대상 구분 *</label>
                <select
                  value={newAuditTargetType}
                  onChange={e => setNewAuditTargetType(e.target.value as any)}
                  style={{ padding: '8px', fontSize: '13px' }}
                >
                  <option value="HQ">주기장 본사 중앙창고</option>
                  <option value="VEHICLE">AS 기사 정비차량</option>
                </select>
              </div>

              {newAuditTargetType === 'VEHICLE' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>담당 정비사 *</label>
                  <select
                    value={newAuditMechanicId}
                    onChange={e => setNewAuditMechanicId(e.target.value)}
                    required
                    style={{ padding: '8px', fontSize: '13px' }}
                  >
                    <option value="">-- 정비사 선택 --</option>
                    {mechanics.map(m => (
                      <option key={m.id} value={m.id}>{m.name} 차량</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>실사 목적 및 메모</label>
                <input
                  type="text"
                  value={newAuditMemo}
                  onChange={e => setNewAuditMemo(e.target.value)}
                  placeholder="예: 2026년 상반기 정기 재고 실사"
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowCreateAuditModal(false)} style={{ flex: 1, padding: '10px' }}>
                  취소
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '10px' }}>
                  실사 전표 생성
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
