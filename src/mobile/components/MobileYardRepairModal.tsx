// src/mobile/components/MobileYardRepairModal.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Asset, Repair, InboundDefectDetail, db } from '../../services/db';
import { 
  Wrench, X, AlertTriangle, Check, Package, Plus, Trash2, 
  Clock, CheckCircle, Image as ImageIcon 
} from 'lucide-react';
import { CameraUploader } from './CameraUploader';

export interface MobileYardRepairModalProps {
  isOpen: boolean;
  asset: Asset | null;
  pendingRepair: Repair | null;
  onClose: () => void;
  onCompleted: () => void;
}


export const MobileYardRepairModal: React.FC<MobileYardRepairModalProps> = ({
  isOpen,
  asset,
  pendingRepair,
  onClose,
  onCompleted
}) => {
  const { 
    consumables, registerRepair, currentUser, 
    showErrorModal, inspectionChecklistItems 
  } = useApp();

  const [repairDetails, setRepairDetails] = useState('');
  const [billableType, setBillableType] = useState<'FREE' | 'BILLABLE'>('FREE');
  const [billableAmount, setBillableAmount] = useState<number>(0);
  const [usedConsumables, setUsedConsumables] = useState<{ consumableId: string; quantity: number }[]>([]);
  const [selectedConsumableId, setSelectedConsumableId] = useState('');
  const [selectedQty, setSelectedQty] = useState(1);
  const [beforeImages, setBeforeImages] = useState<string[]>([]);
  const [afterImages, setAfterImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHoldInput, setShowHoldInput] = useState(false);
  const [holdReason, setHoldReason] = useState('소모품 수급 대기');
  const [durationMinutes, setDurationMinutes] = useState<number>(30); // 정비 소요시간 (기본값: 30분)
  const [selectedInspectionItemId, setSelectedInspectionItemId] = useState<string>('');
  const [selectedInspectionItemCode, setSelectedInspectionItemCode] = useState<string>('');
  const [selectedInspectionItemActionGuide, setSelectedInspectionItemActionGuide] = useState<string>('');

  // 입고 결함 파싱
  const inboundDefects = useMemo<InboundDefectDetail[]>(() => {
    if (!pendingRepair?.defectsJson) return [];
    try {
      const parsed = JSON.parse(pendingRepair.defectsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }, [pendingRepair?.defectsJson]);

  // 입고 시 촬영된 사진 목록
  const inboundPhotos = useMemo<string[]>(() => {
    return pendingRepair?.evidenceImages || [];
  }, [pendingRepair?.evidenceImages]);

  // 자산/티켓 변경 시 초기화
  useEffect(() => {
    if (asset) {
      const defectSummary = inboundDefects.length > 0
        ? inboundDefects.map(d => `• [${d.checkitemName}] 점검 및 부품 교체/수리 조치 완료`).join('\n')
        : '• 입고 결함 항목 점검 및 정상 작동 확인 완료';
      setRepairDetails(
        `입고결함 정비: ${pendingRepair?.inboundNo || '주기장검수'}\n${defectSummary}\n• 시운전 및 안전장치 점검 완료`
      );
      setBillableType('FREE');
      setBillableAmount(0);
      setUsedConsumables([]);
      setBeforeImages([]);
      setAfterImages([]);
      setShowHoldInput(false);
      setHoldReason('부품 수급 대기');
    }
  }, [asset, pendingRepair, inboundDefects]);

  if (!isOpen || !asset) return null;

  // 투입 소모품 총액 계산
  const totalConsumablesCost = usedConsumables.reduce((sum, item) => {
    const c = consumables.find(con => con.id === item.consumableId);
    return sum + ((c?.unitPrice || 0) * item.quantity);
  }, 0);

  // 정비 항목 마스터 동적 선택 핸들러
  const handleSelectInspectionItem = (item: (typeof inspectionChecklistItems)[0]) => {
    setSelectedInspectionItemId(item.id);
    setSelectedInspectionItemCode(item.code);
    if (item.standardManHours) {
      setDurationMinutes(Math.round(item.standardManHours * 60));
    }
    if (item.actionGuide) {
      setSelectedInspectionItemActionGuide(item.actionGuide);
    }
    setRepairDetails(prev => {
      const tagText = `[${item.category}] ${item.name} (${item.code})`;
      const trimmed = prev.trim();
      if (!trimmed) return `• ${tagText}`;
      if (trimmed.includes(item.name)) return prev;
      return `${trimmed}\n• ${tagText}`;
    });
  };

  // 조치내용 자동 반영
  const handleAutoFillDetails = () => {
    if (inboundDefects.length === 0) return;
    const lines = inboundDefects.map(d => {
      const chk = (inspectionChecklistItems || []).find(c => c.id === d.checkitemId || c.code === d.checkitemId);
      const sop = chk?.actionGuide ? ` (SOP: ${chk.actionGuide})` : '';
      return `• [${d.checkitemName}] 수리 및 교체 완료${sop}`;
    });
    setRepairDetails(
      `입고결함 정비: ${pendingRepair?.inboundNo || '검수'}\n` +
      lines.join('\n') +
      '\n• 이상 부위 시운전 및 안전 기능 검증 완료'
    );
  };

  // 추천 소모품 일괄 담기
  const handleAutoAddRecommended = () => {
    if (inboundDefects.length === 0) return;
    const recIds = new Set<string>();

    inboundDefects.forEach(d => {
      const chk = (inspectionChecklistItems || []).find(c => c.id === d.checkitemId || c.code === d.checkitemId);
      if (chk?.recommendedConsumableIds && Array.isArray(chk.recommendedConsumableIds)) {
        chk.recommendedConsumableIds.forEach(cId => recIds.add(cId));
      }
    });

    if (recIds.size === 0) {
      inboundDefects.forEach(d => {
        const name = d.checkitemName.toLowerCase();
        consumables.forEach(c => {
          const cName = c.modelName.toLowerCase();
          if (
            (name.includes('유압') && cName.includes('유압')) ||
            (name.includes('배터리') && (cName.includes('증류수') || cName.includes('단자'))) ||
            (name.includes('조이스틱') && cName.includes('조이스틱')) ||
            (name.includes('센서') && cName.includes('센서')) ||
            (name.includes('스위치') && cName.includes('스위치')) ||
            (name.includes('그리스') && cName.includes('그리스'))
          ) {
            recIds.add(c.id);
          }
        });
      });
    }

    if (recIds.size === 0) {
      showErrorModal('해당 결함 항목에 매핑된 추천 소모품이 없습니다. 아래 소모품 선택창에서 직접 선택하십시오.');
      return;
    }

    let addedCount = 0;
    setUsedConsumables(prev => {
      const next = [...prev];
      recIds.forEach(cId => {
        const con = consumables.find(c => c.id === cId);
        if (con && (con.stockQty || 0) > 0) {
          const existIdx = next.findIndex(item => item.consumableId === cId);
          if (existIdx >= 0) {
            if (next[existIdx].quantity < (con.stockQty || 0)) {
              next[existIdx] = { ...next[existIdx], quantity: next[existIdx].quantity + 1 };
              addedCount++;
            }
          } else {
            next.push({ consumableId: cId, quantity: 1 });
            addedCount++;
          }
        }
      });
      return next;
    });
  };

  // 소모품 수동 추가
  const handleAddConsumable = () => {
    if (!selectedConsumableId) return;
    const con = consumables.find(c => c.id === selectedConsumableId);
    if (!con) return;
    const qty = Math.max(1, selectedQty);
    const existing = usedConsumables.find(item => item.consumableId === selectedConsumableId)?.quantity || 0;
    if (existing + qty > (con.stockQty || 0)) {
      showErrorModal(`소모품 [${con.modelName}] 본사 재고(${con.stockQty || 0}개)를 초과할 수 없습니다.`);
      return;
    }
    setUsedConsumables(prev => {
      const idx = prev.findIndex(item => item.consumableId === selectedConsumableId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
        return next;
      }
      return [...prev, { consumableId: selectedConsumableId, quantity: qty }];
    });
    setSelectedConsumableId('');
    setSelectedQty(1);
  };

  const handleRemoveConsumable = (cId: string) => {
    setUsedConsumables(prev => prev.filter(item => item.consumableId !== cId));
  };

  // ✅ 최종 정비 완료 승인 (AVAILABLE 복원)
  const handleComplete = async () => {
    if (!repairDetails.trim()) {
      showErrorModal('정비 상세 조치 내용을 입력해 주십시오.');
      return;
    }
    setIsSubmitting(true);
    try {
      const nowIsoDate = new Date().toISOString().split('T')[0];
      const payload: Partial<Repair> = {
        id: pendingRepair?.id || undefined,
        assetId: asset.id,
        assetNo: asset.assetNo,
        modelName: asset.modelName,
        workLocation: 'YARD',
        stockSource: 'YARD_STOCK',
        maintenanceType: 'INHOUSE_REPAIR',
        repairType: 'INTERNAL',
        status: 'COMPLETED',
        targetAssetStatus: 'AVAILABLE',
        mechanicId: currentUser?.id,
        repairDate: nowIsoDate,
        requestDate: nowIsoDate,
        details: repairDetails,
        totalCost: totalConsumablesCost,
        beforeImage: beforeImages[0] || '',
        afterImage: afterImages[0] || '',
        evidenceImages: [...beforeImages, ...afterImages],
        billableType,
        billableAmount: billableType === 'BILLABLE' ? billableAmount : 0,
        billableToCustomer: billableType === 'BILLABLE',
        durationMinutes: Number(durationMinutes) || 30,
        spentManHours: (Number(durationMinutes) || 30) / 60,
        inspectionItemId: selectedInspectionItemId || undefined,
        inspectionItemCode: selectedInspectionItemCode || pendingRepair?.inspectionItemCode,
        degradationScore: pendingRepair?.degradationScore,
        inboundNo: pendingRepair?.inboundNo
      };

      await registerRepair(payload, usedConsumables);
      await db.awaitPendingWrites();
      onCompleted();
    } catch (err: any) {
      showErrorModal(`정비 완료 처리 실패: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ⏸️ 소모품 수급 대기 보류
  const handleHold = async () => {
    if (!holdReason.trim()) {
      showErrorModal('보류 사유를 입력해 주십시오.');
      return;
    }
    setIsSubmitting(true);
    try {
      const nowIsoDate = new Date().toISOString().split('T')[0];
      const payload: Partial<Repair> = {
        id: pendingRepair?.id || undefined,
        assetId: asset.id,
        assetNo: asset.assetNo,
        modelName: asset.modelName,
        workLocation: 'YARD',
        stockSource: 'YARD_STOCK',
        maintenanceType: 'INHOUSE_REPAIR',
        repairType: 'INTERNAL',
        status: 'UNRESOLVED',
        targetAssetStatus: 'REPAIRING',
        unresolvedReason: holdReason,
        nextAction: 'NONE',
        mechanicId: currentUser?.id,
        repairDate: nowIsoDate,
        requestDate: nowIsoDate,
        details: (repairDetails ? repairDetails + '\n' : '') + `[소모품대기 사유: ${holdReason}]`,
        totalCost: totalConsumablesCost,
        beforeImage: beforeImages[0] || '',
        afterImage: afterImages[0] || '',
        evidenceImages: [...beforeImages, ...afterImages],
        billableType,
        billableAmount: billableType === 'BILLABLE' ? billableAmount : 0,
        billableToCustomer: billableType === 'BILLABLE',
        inspectionItemCode: selectedInspectionItemCode || pendingRepair?.inspectionItemCode,
        degradationScore: pendingRepair?.degradationScore,
        inboundNo: pendingRepair?.inboundNo
      };

      await registerRepair(payload, usedConsumables);
      await db.awaitPendingWrites();
      onCompleted();
    } catch (err: any) {
      showErrorModal(`보류 처리 실패: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col justify-end sm:justify-center p-0 sm:p-4 overflow-hidden">
      <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl max-h-[92vh] flex flex-col w-full max-w-lg mx-auto shadow-2xl overflow-hidden">
        {/* 상단 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-black text-white">{asset.assetNo}</span>
                <span className="text-sm font-bold text-slate-200">{asset.modelName}</span>
              </div>
              <div className="text-[11px] text-slate-400">
                {asset.ownerType === 'RENTED' ? '타사임차' : '자사보유'} · 주기장 정비 스튜디오
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center active:scale-95 transition-transform"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 본문 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5 text-xs">
          {/* 🚨 1. 입고 결함 리포트 카드 */}
          {inboundDefects.length > 0 ? (
            <div className="p-3.5 rounded-2xl bg-red-950/30 border border-red-500/40 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-red-300">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span>입고 검수 결함 리포트</span>
                  {pendingRepair?.inboundNo && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-red-900/60 text-red-200 border border-red-700/50">
                      {pendingRepair.inboundNo}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                  {inboundDefects.length}건 (+{pendingRepair?.degradationScore || 0}점)
                </span>
              </div>

              {/* 결함 항목 배지들 */}
              <div className="flex flex-wrap gap-1.5">
                {inboundDefects.map((d, idx) => (
                  <div key={idx} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-red-500/30 text-white font-medium text-[11px]">
                    <span>{d.checkitemName}</span>
                    <span className="text-red-400 font-bold font-mono">+{d.score}점</span>
                  </div>
                ))}
              </div>

              {/* 입고 사진 미리보기 */}
              {inboundPhotos.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto pt-1">
                  <span className="text-[10px] text-slate-400 shrink-0 flex items-center gap-1">
                    <ImageIcon className="w-3 h-3 text-red-400" /> 입고증빙 ({inboundPhotos.length}장):
                  </span>
                  {inboundPhotos.map((photo, pIdx) => (
                    <img
                      key={pIdx}
                      src={photo}
                      alt={`입고 ${pIdx}`}
                      className="w-11 h-11 rounded-lg object-cover border border-red-500/30 shrink-0 cursor-pointer"
                      onClick={() => window.open(photo, '_blank')}
                    />
                  ))}
                </div>
              )}

              {/* 원터치 액션 버튼군 */}
              <div className="flex items-center gap-2 pt-1 border-t border-red-500/20">
                <button
                  type="button"
                  onClick={handleAutoFillDetails}
                  className="flex-1 py-1.5 px-2 rounded-xl bg-red-900/40 hover:bg-red-900/60 text-red-200 border border-red-500/30 font-bold flex items-center justify-center gap-1 active:scale-95 transition-all text-[11px]"
                >
                  <Check className="w-3.5 h-3.5" /> 조치내용 자동입력
                </button>
                <button
                  type="button"
                  onClick={handleAutoAddRecommended}
                  className="flex-1 py-1.5 px-2 rounded-xl bg-red-900/40 hover:bg-red-900/60 text-red-200 border border-red-500/30 font-bold flex items-center justify-center gap-1 active:scale-95 transition-all text-[11px]"
                >
                  <Package className="w-3.5 h-3.5" /> 추천부품 일괄담기
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 text-slate-400">
              입고 시 명시된 결함이 없는 일반 주기장 정비 점검 대상입니다.
            </div>
          )}

          {/* 2. 정비 항목 마스터 연동 (정비항목관리 DB) */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300">정비 항목 선택</span>
              {selectedInspectionItemCode && (
                <span className="text-[11px] font-mono text-blue-400 font-bold">
                  선택: {selectedInspectionItemCode}
                </span>
              )}
            </div>

            {inspectionChecklistItems && inspectionChecklistItems.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 rounded-xl bg-slate-950 border border-slate-800">
                {inspectionChecklistItems.map(item => {
                  const isSelected = selectedInspectionItemId === item.id || selectedInspectionItemCode === item.code;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectInspectionItem(item)}
                      className={`px-2 py-1 rounded-lg text-[11px] border active:scale-95 transition-all flex items-center gap-1 ${
                        isSelected
                          ? 'bg-blue-600/30 text-blue-300 border-blue-500 font-bold'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                      }`}
                    >
                      <span>+</span> [{item.category}] {item.name} ({item.standardManHours || 0.5}M/H)
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                등록된 정비 항목 마스터가 없습니다. (정비 항목 관리 메뉴 연동)
              </div>
            )}

            {selectedInspectionItemActionGuide && (
              <div className="p-2 rounded-lg bg-blue-950/40 border border-blue-800/60 text-blue-300 text-[11px]">
                📘 <strong>SOP:</strong> {selectedInspectionItemActionGuide}
              </div>
            )}
          </div>

          {/* 2-1. 정비 소요시간 (분) */}
          <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 text-xs">정비 소요시간 *</span>
              <span className="text-xs font-mono font-bold text-blue-400">
                {(durationMinutes / 60).toFixed(1)} M/H ({durationMinutes}분)
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              {[15, 30, 45, 60, 90, 120].map(mins => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setDurationMinutes(mins)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                    durationMinutes === mins
                      ? 'bg-blue-600 text-white border-blue-500 font-bold'
                      : 'bg-slate-900 text-slate-300 border-slate-700'
                  }`}
                >
                  {mins}분
                </button>
              ))}
              <div className="flex items-center gap-1 ml-auto">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={durationMinutes || ''}
                  onChange={e => setDurationMinutes(Math.max(1, Number(e.target.value) || 0))}
                  className="w-14 rounded-lg bg-slate-900 border border-slate-700 py-1 px-1.5 text-white text-xs text-right focus:outline-none"
                />
                <span className="text-[11px] text-slate-400">분</span>
              </div>
            </div>
          </div>

          {/* 3. 정비 상세 조치 내용 (Textarea) */}
          <div className="flex flex-col gap-1.5">
            <span className="font-bold text-slate-300">정비 상세 조치 내용 *</span>
            <textarea
              rows={3}
              value={repairDetails}
              onChange={e => setRepairDetails(e.target.value)}
              placeholder="수리 조치 사항, 교체 부품, 상태 점검 결과 입력..."
              className="w-full rounded-xl bg-slate-950 border border-slate-700 p-2.5 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* 4. 주기장 재고 소모품 투입 차감 그리드 */}
          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-blue-400" />
                주기장 재고 소모품 투입
              </span>
              <span className="text-[11px] font-bold text-blue-400 font-mono">
                소모품 합계: {totalConsumablesCost.toLocaleString()}원
              </span>
            </div>

            {/* 품목 선택 & 수량 & 투입 */}
            <div className="flex items-center gap-1.5">
              <select
                value={selectedConsumableId}
                onChange={e => setSelectedConsumableId(e.target.value)}
                className="flex-1 rounded-xl bg-slate-900 border border-slate-700 py-2 px-2 text-white text-[11px] focus:outline-none"
              >
                <option value="">주기장 재고 소모품 선택...</option>
                {consumables.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.modelName} (재고: {c.stockQty || 0} | ₩{c.unitPrice.toLocaleString()})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={selectedQty}
                onChange={e => setSelectedQty(Math.max(1, Number(e.target.value) || 1))}
                className="w-14 rounded-xl bg-slate-900 border border-slate-700 py-2 px-1 text-center text-white text-[11px]"
              />
              <button
                type="button"
                onClick={handleAddConsumable}
                className="py-2 px-3 rounded-xl bg-blue-600 text-white font-bold text-[11px] shrink-0 active:scale-95 transition-all"
              >
                투입
              </button>
            </div>

            {/* 투입된 목록 */}
            {usedConsumables.length > 0 && (
              <div className="flex flex-col gap-1 pt-1 border-t border-slate-800">
                {usedConsumables.map(uc => {
                  const item = consumables.find(c => c.id === uc.consumableId);
                  const subtotal = (item?.unitPrice || 0) * uc.quantity;
                  return (
                    <div key={uc.consumableId} className="flex items-center justify-between text-[11px] py-1 px-2 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="font-medium text-white truncate mr-2">
                        {item?.modelName || uc.consumableId} ({uc.quantity}{item?.unit || '개'})
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-slate-300">{subtotal.toLocaleString()}원</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveConsumable(uc.consumableId)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 5. 사진 증빙 (정비 전 / 정비 후) */}
          <div className="grid grid-cols-2 gap-2">
            <CameraUploader
              label="정비 전 사진"
              images={beforeImages}
              onChange={setBeforeImages}
              maxImages={1}
            />
            <CameraUploader
              label="정비 후 사진"
              images={afterImages}
              onChange={setAfterImages}
              maxImages={1}
            />
          </div>

          {/* 6. 유무상 청구 설정 */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-300">청구 구분:</span>
              <button
                type="button"
                onClick={() => setBillableType('FREE')}
                className={`py-1 px-2.5 rounded-lg font-bold text-[11px] border transition-all ${
                  billableType === 'FREE'
                    ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-900 text-slate-400 border-slate-700'
                }`}
              >
                무상 (회사부담)
              </button>
              <button
                type="button"
                onClick={() => setBillableType('BILLABLE')}
                className={`py-1 px-2.5 rounded-lg font-bold text-[11px] border transition-all ${
                  billableType === 'BILLABLE'
                    ? 'bg-amber-600/30 text-amber-300 border-amber-500/50'
                    : 'bg-slate-900 text-slate-400 border-slate-700'
                }`}
              >
                유상 (고객청구)
              </button>
            </div>
            {billableType === 'BILLABLE' && (
              <input
                type="number"
                step={1000}
                placeholder="청구금액"
                value={billableAmount || ''}
                onChange={e => setBillableAmount(Number(e.target.value) || 0)}
                className="w-24 rounded-xl bg-slate-900 border border-amber-500/50 py-1 px-2 text-right text-amber-300 text-xs font-mono"
              />
            )}
          </div>

          {/* 7. 보류 모드 입력줄 (펼침 상태) */}
          {showHoldInput && (
            <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-500/40 flex flex-col gap-2">
              <span className="font-bold text-amber-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                부품 수급 대기 보류 사유
              </span>
              <input
                type="text"
                value={holdReason}
                onChange={e => setHoldReason(e.target.value)}
                placeholder="보류 사유 (예: 19FT 상승실린더 씰킷 발주 대기)"
                className="rounded-xl bg-slate-950 border border-amber-500/40 p-2 text-white text-xs"
              />
              <button
                type="button"
                onClick={handleHold}
                disabled={isSubmitting}
                className="w-full py-2 rounded-xl bg-amber-600 text-white font-bold text-xs active:scale-95 transition-all"
              >
                {isSubmitting ? '처리 중...' : '보류 저장 (정비중 REPAIRING 유지)'}
              </button>
            </div>
          )}
        </div>

        {/* 최하단 고정 액션 바 */}
        <div className="p-3.5 border-t border-slate-800 bg-slate-950 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHoldInput(!showHoldInput)}
            className={`py-3 px-3 rounded-2xl font-bold text-xs border transition-all shrink-0 active:scale-95 ${
              showHoldInput
                ? 'bg-amber-600/30 text-amber-300 border-amber-500'
                : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
            title="부품대기 보류"
          >
            <Clock className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleComplete}
            disabled={isSubmitting}
            className="flex-1 py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm flex items-center justify-center gap-2 shadow-xl shadow-emerald-600/30 active:scale-98 transition-all"
          >
            <CheckCircle className="w-4 h-4 stroke-[3]" />
            <span>{isSubmitting ? '처리 중...' : '정비 완료 (임대가능 AVAILABLE 전환)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
