import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { CameraUploader } from '../components/CameraUploader';
import { db, OutboundInspection, Asset, AssetInOutLog, STANDARD_SPECS } from '../../services/db';
import { CheckSquare, Check, ShieldCheck, CheckCircle2, ChevronDown, ChevronUp, AlertTriangle, ArrowLeft } from 'lucide-react';

function getInspectionCheckpoints(
  oin: OutboundInspection,
  contracts: any[],
  contractAssets: any[],
  sites: any[],
  customers: any[],
  assets: any[]
) {
  const contract = contracts.find(c => c.id === oin.contractId);
  const contractAsset = contractAssets.find(ca => ca.id === oin.contractAssetId);
  const site = contract?.siteId ? sites.find(s => s.id === contract.siteId) : undefined;
  const customer = contract?.customerId ? customers.find(c => c.id === contract.customerId) : undefined;
  const asset = assets.find(a => a.id === oin.assetId);

  const checkpoints: { id: string; label: string; type: 'MODEL' | 'SPEC' | 'OPTION' | 'NOTE' }[] = [];

  // 1. 모델 일치 확인 (항상 포함)
  if (contractAsset?.expectedModel) {
    checkpoints.push({
      id: 'model_match',
      label: `장비 모델 확인: 계약 요구 [${contractAsset.expectedModel}] ↔ 실출고 [${asset?.modelName || '미배정'}]`,
      type: 'MODEL'
    });
  }

  // 2. 현장 또는 고객사의 요구 사양 중 true인 항목만 추가
  const specMap: Record<string, boolean> = {
    ...(customer?.defaultCheckedSpecs || {}),
    ...(site?.checkedSpecs || {})  // 현장이 고객사 기본값을 override
  };
  STANDARD_SPECS.forEach(spec => {
    if (specMap[spec.id] === true) {
      checkpoints.push({ id: spec.id, label: spec.label, type: 'SPEC' });
    }
  });

  // 3. 유상 옵션 (텍스트 기반, 항목당 1개 체크)
  const paidOpts = site?.paidOptions || customer?.defaultPaidOptions || '';
  if (paidOpts.trim()) {
    paidOpts.split(/[,，、\n]/).map((o: string) => o.trim()).filter(Boolean).forEach((opt: string, i: number) => {
      checkpoints.push({ id: `paid_${i}`, label: `[옵션] ${opt} 장착 확인`, type: 'OPTION' });
    });
  }

  // 4. 특이사항 메모가 있으면 참고 표시
  const specialNote = site?.memo || customer?.specialNotes || '';

  return { checkpoints, specialNote, asset, contract, contractAsset, site, customer };
}

export const MobileInspectionList: React.FC = () => {
  const { 
    outboundInspections, 
    assets, 
    contracts, 
    customers, 
    sites, 
    contractAssets, 
    deliveries, 
    currentUser, 
    refreshAllData, 
    showErrorModal 
  } = useApp();
  
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  
  const [assetCheckedList, setAssetCheckedList] = useState<Record<string, Record<string, boolean>>>({});
  const [assetPhotos, setAssetPhotos] = useState<Record<string, string[]>>({});
  const [expandedAssetIds, setExpandedAssetIds] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState('');

  const pendingInspections = useMemo(() => outboundInspections.filter((ins) => ins.status === 'PENDING'), [outboundInspections]);
  
  const groups = useMemo(() => pendingInspections.reduce((acc, ins) => {
    const key = ins.deliveryId || `no-delivery-${ins.contractId || 'unknown'}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(ins);
    return acc;
  }, {} as Record<string, OutboundInspection[]>), [pendingInspections]);

  const activeGroup = groups[selectedGroupId] || [];

  const handleToggleCheck = (oinId: string, itemId: string) => {
    setAssetCheckedList((prev) => {
      const prevAssetChecks = prev[oinId] || {};
      return {
        ...prev,
        [oinId]: { ...prevAssetChecks, [itemId]: !prevAssetChecks[itemId] }
      };
    });
  };

  const handleToggleAccordion = (oinId: string) => {
    setExpandedAssetIds(prev => ({ ...prev, [oinId]: !prev[oinId] }));
  };

  const handleApproveSingle = async (oin: OutboundInspection) => {
    const { checkpoints, asset, contract, site, customer } = getInspectionCheckpoints(
      oin, contracts, contractAssets, sites, customers, assets
    );

    if (customer && (customer as any).transactionStatus === 'BLOCKED') {
      showErrorModal(`[출고제한 가드] 연체 및 거래차단(BLOCKED) 상태인 고객사(${customer.name})의 장비는 출고 승인할 수 없습니다.`);
      return;
    }

    const checked = assetCheckedList[oin.id] || {};
    const checkedCount = Object.values(checked).filter(Boolean).length;
    
    if (checkpoints.length > 0 && checkedCount === 0) {
      showErrorModal('요구 사양 항목을 최소 1개 이상 확인해야 출고 승인이 가능합니다.');
      return;
    }

    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const photos = assetPhotos[oin.id] || [];

      db.updateRow<OutboundInspection>('outboundInspections', oin.id, {
        status: 'COMPLETED', 
        inspectorId: currentUser?.name || '담당기사',
        inspectedAt: nowIso, 
        approvedAt: nowIso,
        specsJson: JSON.stringify({
          checkpoints: checkpoints.map(cp => ({ ...cp, checked: !!checked[cp.id] })),
          photos,
          checkedCount,
          totalCheckpoints: checkpoints.length,
          completedAt: nowIso,
        }),
        note: `[출고검수 완료] 요구사항 ${checkedCount}/${checkpoints.length}개소 확인 (사진 ${photos.length}매)`,
        updatedAt: nowIso
      });
      
      if (oin.assetId) {
        db.updateRow<Asset>('assets', oin.assetId, { status: 'RENTED', updatedAt: nowIso });
        
        db.insertRow<AssetInOutLog>('assetInOutLogs', {
          assetId: oin.assetId, 
          assetNo: asset?.assetNo || '', 
          modelName: asset?.modelName || '',
          deliveryId: oin.deliveryId, 
          type: 'OUTBOUND',
          eventDate: nowIso.split('T')[0],
          customerId: contract?.customerId, 
          customerName: customer?.name || '',
          siteId: contract?.siteId, 
          siteName: site?.name || '',
          memo: `[출고검수 승인] 계약(${contract?.contractNo || ''}) 현장(${site?.name || ''}) (대여중 전환)`,
          createdAt: nowIso,
        });
      }

      await db.awaitPendingWrites();
      refreshAllData();
      
      setSuccessToast(`자산 #${asset?.assetNo || '미배정'} 검수 완료`);
      setTimeout(() => setSuccessToast(''), 3000);
      
      const remainingInGroup = activeGroup.filter(i => i.id !== oin.id);
      if (remainingInGroup.length === 0) {
        setSelectedGroupId('');
      }
    } catch (err: any) {
      showErrorModal('검수 승인 실패: ' + (err.message || ''));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveAll = async () => {
    const readyToApprove = activeGroup.filter(oin => {
      const { checkpoints } = getInspectionCheckpoints(
        oin, contracts, contractAssets, sites, customers, assets
      );
      const checked = assetCheckedList[oin.id] || {};
      const checkedCount = Object.values(checked).filter(Boolean).length;
      return checkpoints.length === 0 || checkedCount > 0;
    });

    if (readyToApprove.length === 0) {
      showErrorModal('검수 완료 조건을 충족한 자산이 없습니다.');
      return;
    }

    const first = activeGroup[0];
    const contract = contracts.find((c) => c.id === first.contractId);
    const customer = contract ? customers.find((c) => c.id === contract.customerId) : undefined;
    
    if (customer && (customer as any).transactionStatus === 'BLOCKED') {
      showErrorModal(`[출고제한 가드] 연체 및 거래차단(BLOCKED) 상태인 고객사(${customer.name})의 장비는 일괄 승인할 수 없습니다.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const site = contract ? sites.find((s) => s.id === contract.siteId) : undefined;
      
      for (const oin of readyToApprove) {
        const { checkpoints, asset } = getInspectionCheckpoints(
          oin, contracts, contractAssets, sites, customers, assets
        );
        const checked = assetCheckedList[oin.id] || {};
        const checkedCount = Object.values(checked).filter(Boolean).length;
        const photos = assetPhotos[oin.id] || [];

        db.updateRow<OutboundInspection>('outboundInspections', oin.id, {
          status: 'COMPLETED', 
          inspectorId: currentUser?.name || '담당기사',
          inspectedAt: nowIso, 
          approvedAt: nowIso,
          specsJson: JSON.stringify({
            checkpoints: checkpoints.map(cp => ({ ...cp, checked: !!checked[cp.id] })),
            photos,
            checkedCount,
            totalCheckpoints: checkpoints.length,
            completedAt: nowIso,
          }),
          note: `[출고검수 일괄 완료] 요구사항 ${checkedCount}/${checkpoints.length}개소 확인 (사진 ${photos.length}매)`,
          updatedAt: nowIso
        });
        
        if (oin.assetId) {
          db.updateRow<Asset>('assets', oin.assetId, { status: 'RENTED', updatedAt: nowIso });
          
          db.insertRow<AssetInOutLog>('assetInOutLogs', {
            assetId: oin.assetId, 
            assetNo: asset?.assetNo || '', 
            modelName: asset?.modelName || '',
            deliveryId: oin.deliveryId, 
            type: 'OUTBOUND',
            eventDate: nowIso.split('T')[0],
            customerId: contract?.customerId, 
            customerName: customer?.name || '',
            siteId: contract?.siteId, 
            siteName: site?.name || '',
            memo: `[출고검수 일괄 승인] 계약(${contract?.contractNo || ''}) 현장(${site?.name || ''}) (대여중 전환)`,
            createdAt: nowIso,
          });
        }
      }

      await db.awaitPendingWrites();
      refreshAllData();
      
      setSuccessToast(`${readyToApprove.length}대 일괄 승인 완료`);
      setTimeout(() => setSuccessToast(''), 3000);
      
      setSelectedGroupId('');
    } catch (err: any) {
      showErrorModal('일괄 검수 승인 실패: ' + (err.message || ''));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col pb-32 p-4 h-full bg-slate-950 min-h-screen">
      {successToast && (
        <div className="p-3 mb-4 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {!selectedGroupId ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-black text-white flex items-center gap-2 whitespace-nowrap shrink-0">
              <CheckSquare className="w-5 h-5 text-emerald-400" />
              출고 검수 대기 ({Object.keys(groups).length}건)
            </h2>
          </div>
          
          {Object.entries(groups).length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm bg-slate-900/50 rounded-2xl border border-slate-800">
              대기 중인 출고 검수 의뢰가 없습니다.
            </div>
          ) : (
            Object.entries(groups).map(([groupId, insList]) => {
              const first = insList[0];
              const contract = contracts.find((c) => c.id === first.contractId);
              const customer = contract ? customers.find((c) => c.id === contract.customerId) : undefined;
              const site = contract ? sites.find((s) => s.id === contract.siteId) : undefined;
              const isBlocked = (customer as any)?.transactionStatus === 'BLOCKED';

              return (
                <div
                  key={groupId}
                  onClick={() => setSelectedGroupId(groupId)}
                  className="p-4 rounded-2xl bg-slate-900 border border-slate-800 active:scale-[0.98] transition-transform cursor-pointer flex flex-col gap-2 shadow-lg relative overflow-hidden"
                >
                  {isBlocked && (
                    <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-sm font-black text-white flex items-center gap-1.5 whitespace-nowrap">
                        {customer?.name || '직출고'}
                        {isBlocked && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 font-bold border border-red-500/30 shrink-0">
                            거래차단
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-slate-400 whitespace-nowrap">{site?.name || '현장 미지정'}</span>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-black font-mono border border-emerald-500/30 whitespace-nowrap shrink-0">
                      {insList.length}대 대기
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400 font-mono pt-2 border-t border-slate-800/60 mt-1">
                    <span className="whitespace-nowrap shrink-0">계약: {contract?.contractNo || first.contractId || '-'}</span>
                    <span className="whitespace-nowrap shrink-0">배차: {first.deliveryId || '-'}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setSelectedGroupId('')} className="p-2 -ml-2 rounded-xl text-slate-400 hover:text-white shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex flex-col">
              <span className="text-white font-black text-sm whitespace-nowrap">{
                (() => {
                  const first = activeGroup[0];
                  const c = contracts.find(x => x.id === first?.contractId);
                  return c ? customers.find(x => x.id === c.customerId)?.name || '직출고' : '직출고';
                })()
              }</span>
              <span className="text-slate-400 text-xs whitespace-nowrap">{
                (() => {
                  const first = activeGroup[0];
                  const c = contracts.find(x => x.id === first?.contractId);
                  return c ? sites.find(x => x.id === c.siteId)?.name || '현장' : '현장';
                })()
              }</span>
            </div>
          </div>

          {(() => {
            const first = activeGroup[0];
            const c = contracts.find(x => x.id === first?.contractId);
            const customer = c ? customers.find(x => x.id === c.customerId) : undefined;
            const isBlocked = (customer as any)?.transactionStatus === 'BLOCKED';
            const { specialNote } = getInspectionCheckpoints(first, contracts, contractAssets, sites, customers, assets);
            
            return (
              <div className="flex flex-col gap-2">
                {isBlocked && (
                  <div className="p-3 rounded-xl bg-red-950/40 border border-red-900/50 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <span className="text-xs text-red-300 leading-relaxed break-keep">
                      거래차단(BLOCKED) 고객사입니다. 관리부 채권 확인 및 거래 제한 해제 후 출고 승인이 가능합니다.
                    </span>
                  </div>
                )}
                {specialNote && (
                  <div className="p-3 rounded-xl bg-amber-900/30 border border-amber-700/50 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <span className="text-xs text-amber-200 leading-relaxed break-keep">
                      [특이사항] {specialNote}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="flex flex-col gap-3">
            {activeGroup.map(oin => {
              const { checkpoints, asset } = getInspectionCheckpoints(
                oin, contracts, contractAssets, sites, customers, assets
              );
              
              const isExpanded = !!expandedAssetIds[oin.id];
              const checked = assetCheckedList[oin.id] || {};
              const checkedCount = Object.values(checked).filter(Boolean).length;
              const photos = assetPhotos[oin.id] || [];

              const hasNoRequirements = checkpoints.length === 1 && checkpoints[0].type === 'MODEL';

              return (
                <div key={oin.id} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-3">
                  <div className="flex items-center justify-between cursor-pointer" onClick={() => handleToggleAccordion(oin.id)}>
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-mono text-xs font-black whitespace-nowrap shrink-0">
                        {asset?.assetNo || '미지정'}
                      </span>
                      <span className="text-white font-bold text-sm whitespace-nowrap overflow-hidden text-ellipsis">
                        {asset?.modelName || '모델 미상'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {checkedCount > 0 && (
                        <span className="text-xs text-emerald-400 font-bold bg-emerald-950/50 px-1.5 py-0.5 rounded whitespace-nowrap">
                          {checkedCount}/{checkpoints.length}
                        </span>
                      )}
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="flex flex-col gap-4 mt-2 pt-3 border-t border-slate-800">
                      
                      {checkpoints.length === 0 ? (
                         <div className="text-xs text-emerald-400 bg-emerald-950/20 border border-emerald-900/50 p-3 rounded-xl break-keep">
                           이 자산에 대한 요구 사양 없음 — 모델 일치 확인 후 즉시 승인 가능
                         </div>
                      ) : (
                        hasNoRequirements && (
                          <div className="text-xs text-emerald-400 bg-emerald-950/20 border border-emerald-900/50 p-3 rounded-xl break-keep">
                            이 자산에 대한 요구 사양 없음 — 모델 일치 확인 후 즉시 승인 가능
                          </div>
                        )
                      )}

                      <div className="flex flex-col gap-1.5">
                        {checkpoints.map((cp, idx) => {
                          const isChecked = !!checked[cp.id];
                          let colorClasses = 'bg-slate-950 border-slate-800 text-slate-400';
                          let checkColor = 'border-slate-700';
                          
                          if (isChecked) {
                            if (cp.type === 'MODEL') {
                              colorClasses = 'bg-blue-950/40 border-blue-700 text-blue-200';
                              checkColor = 'bg-blue-500 border-blue-400 text-white';
                            } else if (cp.type === 'SPEC') {
                              colorClasses = 'bg-emerald-950/40 border-emerald-700 text-emerald-200';
                              checkColor = 'bg-emerald-500 border-emerald-400 text-white';
                            } else if (cp.type === 'OPTION') {
                              colorClasses = 'bg-amber-950/40 border-amber-700 text-amber-200';
                              checkColor = 'bg-amber-500 border-amber-400 text-white';
                            } else {
                              colorClasses = 'bg-slate-800 border-slate-600 text-slate-200';
                              checkColor = 'bg-slate-500 border-slate-400 text-white';
                            }
                          }

                          return (
                            <button
                              key={cp.id}
                              type="button"
                              onClick={() => handleToggleCheck(oin.id, cp.id)}
                              className={`flex items-center justify-between p-3 rounded-xl border text-xs font-semibold transition-all ${colorClasses}`}
                            >
                              <span className="whitespace-nowrap shrink-0">{idx + 1}.</span>
                              <span className="ml-2 text-left flex-1 break-keep">{cp.label}</span>
                              <div
                                className={`w-5 h-5 rounded-lg flex items-center justify-center border shrink-0 ${checkColor}`}
                              >
                                {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-2">
                        <CameraUploader
                          label="외관 사진 (최대 4매)"
                          images={photos}
                          onChange={(newPhotos) => setAssetPhotos(prev => ({ ...prev, [oin.id]: newPhotos }))}
                          maxImages={4}
                        />
                      </div>

                      <div className="mt-2">
                        <button
                          type="button"
                          disabled={isSubmitting || (checkpoints.length > 0 && checkedCount === 0) || (() => {
                            const c = contracts.find(x => x.id === oin.contractId);
                            const customer = c ? customers.find(x => x.id === c.customerId) : undefined;
                            return (customer as any)?.transactionStatus === 'BLOCKED';
                          })()}
                          onClick={() => handleApproveSingle(oin)}
                          className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          이 장비 검수 완료
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="fixed bottom-20 left-0 right-0 z-10 p-4 bg-slate-900 border-t border-slate-800 shadow-2xl">
            <div className="max-w-md mx-auto flex items-center gap-3">
              <div className="flex flex-col shrink-0">
                <span className="text-[10px] text-slate-400 font-bold whitespace-nowrap">검수 상태</span>
                <span className="text-sm font-black text-emerald-400 whitespace-nowrap">
                  {activeGroup.length}대 중 {activeGroup.filter(oin => {
                    const { checkpoints } = getInspectionCheckpoints(oin, contracts, contractAssets, sites, customers, assets);
                    const c = assetCheckedList[oin.id] || {};
                    const cCount = Object.values(c).filter(Boolean).length;
                    return checkpoints.length === 0 || cCount > 0;
                  }).length}대 완료
                </span>
              </div>
              <button
                type="button"
                disabled={isSubmitting || activeGroup.filter(oin => {
                  const { checkpoints } = getInspectionCheckpoints(oin, contracts, contractAssets, sites, customers, assets);
                  const c = assetCheckedList[oin.id] || {};
                  return checkpoints.length === 0 || Object.values(c).filter(Boolean).length > 0;
                }).length !== activeGroup.length || (() => {
                  const first = activeGroup[0];
                  const c = contracts.find(x => x.id === first?.contractId);
                  const customer = c ? customers.find(x => x.id === c.customerId) : undefined;
                  return (customer as any)?.transactionStatus === 'BLOCKED';
                })()}
                onClick={handleApproveAll}
                className="flex-1 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-xs shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                {isSubmitting ? '승인 중' : '전체 일괄 승인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
