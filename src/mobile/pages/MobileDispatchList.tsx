// src/mobile/pages/MobileDispatchList.tsx
import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { db, Delivery } from '../../services/db';
import { 
  Truck, Phone, CheckCircle2, Mic, MicOff, FileText, 
  Sparkles, X, Check, UserCheck, AlertCircle, MessageSquare, Send, User 
} from 'lucide-react';
import { parseDispatchDriverCallTranscript } from '../../services/voiceOrderDraftService';
import { buildDispatchSmsText, launchDispatchSms } from '../../utils/nativeLauncher';
import { broadcastWorkNotification } from '../../utils/workNotificationService';

export const MobileDispatchList: React.FC = () => {
  const { 
    deliveries, contracts, customers, sites, users, currentTenant,
    refreshAllData, showErrorModal, completeDelivery, completeInboundDelivery 
  } = useApp();
  const [filter, setFilter] = useState<'PENDING' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED'>('PENDING');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // 기사 배정 모달 상태
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [targetDeliveryId, setTargetDeliveryId] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverContact, setDriverContact] = useState('');
  const [vehicleType, setVehicleType] = useState('5톤');
  const [finalCost, setFinalCost] = useState<number>(0);
  const [assignMemo, setAssignMemo] = useState('');
  const [recentModifiedFields, setRecentModifiedFields] = useState<string[]>([]);

  // 음성 및 텍스트 붙여넣기 상태
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [pastedTranscript, setPastedTranscript] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const recognitionRef = useRef<any>(null);

  const pendingDeliveries = deliveries.filter(d => d.status === 'PENDING' || d.status === 'REQUESTED');

  const filteredDeliveries = deliveries.filter((d) => {
    if (filter === 'PENDING') return d.status === 'PENDING' || d.status === 'REQUESTED';
    if (filter === 'DISPATCHED') return d.status === 'DISPATCHED';
    if (filter === 'DELIVERED') return d.status === 'DELIVERED' || d.status === 'COMPLETED';
    if (filter === 'CANCELLED') return d.status === 'CANCELLED';
    return true;
  });

  // 통화 텍스트 파싱 및 폼 자동 반영
  const applyDriverTranscript = (text: string) => {
    if (!text.trim()) return;
    const result = parseDispatchDriverCallTranscript(text, pendingDeliveries);

    if (result.matchedDeliveryId && !targetDeliveryId) {
      setTargetDeliveryId(result.matchedDeliveryId);
    }
    if (result.vehicleNo) setVehicleNo(result.vehicleNo);
    if (result.driverName) setDriverName(result.driverName);
    if (result.driverContact) setDriverContact(result.driverContact);
    if (result.vehicleType) setVehicleType(result.vehicleType);
    if (result.finalCost > 0) setFinalCost(result.finalCost);
    if (result.memo) setAssignMemo(result.memo);

    setRecentModifiedFields(result.modifiedFields);
  };

  // 음성 인식 토글
  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showErrorModal('이 브라우저는 음성 인식을 지원하지 않습니다. 최신 브라우저를 이용하세요.');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ko-KR';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
        setInterimText('음성 듣는 중...');
      };

      recognition.onresult = (event: any) => {
        let currentInterim = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalChunk += transcript;
          } else {
            currentInterim += transcript;
          }
        }

        if (finalChunk.trim()) {
          applyDriverTranscript(finalChunk.trim());
          setInterimText('');
        } else if (currentInterim.trim()) {
          setInterimText(currentInterim);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        setInterimText('');
      };

      recognition.onend = () => {
        setIsListening(false);
        setInterimText('');
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      showErrorModal('음성 인식 시작 실패: ' + err.message);
      setIsListening(false);
    }
  };

  const handleOpenAssignModal = (deliveryId?: string) => {
    if (deliveryId) {
      setTargetDeliveryId(deliveryId);
    } else if (pendingDeliveries.length > 0) {
      setTargetDeliveryId(pendingDeliveries[0].id);
    }
    setVehicleNo('');
    setDriverName('');
    setDriverContact('');
    setVehicleType('5톤');
    setFinalCost(0);
    setAssignMemo('');
    setRecentModifiedFields([]);
    setShowAssignModal(true);
  };

  // 🚚 기사 배차 안내 문자 발송 (핸드폰 기본 문자 앱 sms: 딥링크 연동)
  const handleSendDriverSms = (targetDelivery: Delivery, overrideFields?: Partial<Delivery>) => {
    const d = { ...targetDelivery, ...overrideFields };
    if (!d.driverContact || !d.driverContact.trim()) {
      showErrorModal('기사 연락처가 등록되지 않았습니다.');
      return;
    }

    const contract = contracts.find(c => c.id === d.contractId);
    const customer = customers.find(c => c.id === contract?.customerId || c.name === d.destinationAddress);
    const site = sites.find(s => s.id === contract?.siteId || s.name === d.destinationAddress);

    const defaultYard = currentTenant?.yards?.find((y: any) => y.isDefault) || currentTenant?.yards?.[0];
    const hqYardAddress = defaultYard?.address || currentTenant?.mainYardAddress || currentTenant?.businessAddress || '본사 주기장';
    const hqYardPhone = currentTenant?.tel || '배차/출고팀';
    const companyName = currentTenant?.displayName || currentTenant?.tradeName || currentTenant?.corporateName || '기연리프트';

    const smsBody = buildDispatchSmsText({
      delivery: d,
      siteName: site?.name || d.destinationAddress,
      siteAddress: d.destinationAddress || site?.address,
      siteContactName: site?.contactName,
      siteContactPhone: site?.contact,
      customerName: customer?.name,
      companyName,
      hqYardAddress,
      hqYardPhone,
    });

    launchDispatchSms({
      driverContact: d.driverContact,
      smsBody
    });
  };

  const handleSaveDriverAssignment = async (andSendSms = false) => {
    if (!targetDeliveryId) {
      showErrorModal('배정할 배차 건을 선택하세요.');
      return;
    }
    if (!driverName.trim() && !vehicleNo.trim()) {
      showErrorModal('기사명 또는 차량번호를 입력하세요.');
      return;
    }

    const targetDel = deliveries.find(d => d.id === targetDeliveryId);
    const curMemo = targetDel?.memo || '';
    const newMemo = assignMemo ? (curMemo ? `${curMemo} | [기사배정] ${assignMemo}` : `[기사배정] ${assignMemo}`) : curMemo;
    const resolvedTransportCompany = targetDel?.transportCompany || '자차(직영)';

    const updatedFields: Partial<Delivery> = {
      vehicleNo,
      driverName,
      driverContact,
      vehicleType,
      transportCompany: resolvedTransportCompany,
      finalCost: Math.max(0, Number(finalCost) || 0),
      deliveryCost: Math.max(0, Number(finalCost) || 0),
      status: 'DISPATCHED',
      memo: newMemo,
      vehicles: JSON.stringify([{
        id: 'v-' + Date.now(),
        transportCompany: resolvedTransportCompany,
        vehicleNo,
        driverName,
        driverContact,
        vehicleType,
        deliveryCost: Math.max(0, Number(finalCost) || 0)
      }]),
      updatedAt: new Date().toISOString(),
    };

    try {
      db.updateRow<Delivery>('deliveries', targetDeliveryId, updatedFields);

      await db.awaitPendingWrites();
      refreshAllData();

      const currentDelivery = deliveries.find(d => d.id === targetDeliveryId);

      // 📢 배차 완료 실시간 알림 브로드캐스트
      const curContract = currentDelivery?.contractId ? contracts.find(c => c.id === currentDelivery.contractId) : null;
      const curCust = curContract ? customers.find(c => c.id === curContract.customerId)?.name : '';
      const curSite = curContract ? sites.find(s => s.id === curContract.siteId)?.name : '';
      broadcastWorkNotification({
        type: 'DISPATCH',
        title: '배차 완료 안내',
        body: `${curCust || '현장'} (${curSite || '배차'}) ${driverName || '기사'} (${vehicleType}) 배정 완료`,
        url: '/admin/dispatch',
        targetDepts: ['SALES', 'YARD', 'ADMIN', 'EXECUTIVE']
      }).catch(console.warn);

      if (andSendSms && driverContact && currentDelivery) {
        handleSendDriverSms(currentDelivery, updatedFields);
      } else {
        showToast('기사 배정이 완료되어 운송중으로 전환되었습니다.');
      }
      setShowAssignModal(false);
    } catch (err: any) {
      showErrorModal('기사 배정 실패: ' + (err.message || ''));
    }
  };

  const handleUpdateStatus = async (deliveryId: string, nextStatus: any) => {
    try {
      const d = deliveries.find(x => x.id === deliveryId);
      if (nextStatus === 'DELIVERED') {
        if (d?.type === 'OUTBOUND') {
          await completeDelivery(deliveryId);
        } else if (d?.type === 'INBOUND' || d?.type === 'EXCHANGE') {
          const returnDate = new Date().toISOString().split('T')[0];
          let targetAssetIds: string[] = [];
          try {
            const cargos = d.cargoItems ? JSON.parse(d.cargoItems) : [];
            targetAssetIds = cargos.map((c: any) => c.assetId).filter(Boolean);
          } catch {}
          if (targetAssetIds.length === 0 && d.contractId) {
            const cas = db.contractAssets.filter(ca => ca.contractId === d.contractId && ca.status !== 'RETURNED');
            targetAssetIds = cas.map(ca => ca.assetId).filter(Boolean) as string[];
          }
          const reviews = targetAssetIds.map(aId => ({
            assetId: aId,
            status: 'AVAILABLE' as const,
            maintenanceScore: 10,
            memo: `[모바일 배차목록 운송완료 마감] ${d.dispatchCategory || '회수'} 운송 완료`,
          }));
          await completeInboundDelivery(deliveryId, returnDate, reviews);
        } else {
          db.updateRow<Delivery>('deliveries', deliveryId, {
            status: nextStatus,
            updatedAt: new Date().toISOString(),
          });
          await db.awaitPendingWrites();
          refreshAllData();
        }
      } else {
        db.updateRow<Delivery>('deliveries', deliveryId, {
          status: nextStatus,
          updatedAt: new Date().toISOString(),
        });
        await db.awaitPendingWrites();
        refreshAllData();
      }
      showToast('배차 상태가 업데이트되었습니다.');
    } catch (err: any) {
      showErrorModal('상태 업데이트 실패: ' + (err.message || ''));
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-24 p-4 bg-slate-950 min-h-screen">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black text-white flex items-center gap-2">
          <Truck className="w-5 h-5 text-blue-400" />
          배차 운송 지시 ({filteredDeliveries.length})
        </h2>
        {/* 통화 텍스트/음성 기사 배정 퀵 버튼 */}
        <button
          type="button"
          onClick={() => handleOpenAssignModal()}
          className="flex items-center gap-1.5 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black shadow-lg active:scale-95 transition-all"
        >
          <UserCheck className="w-4 h-4" />
          통화로 기사 배정
        </button>
      </div>

      {toastMessage && (
        <div className="bg-emerald-600 text-white text-xs font-bold py-2 px-3 rounded-xl text-center shadow-lg animate-in fade-in">
          {toastMessage}
        </div>
      )}

      {/* 상태 필터 */}
      <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => setFilter('PENDING')}
          className={`flex-1 py-2 px-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
            filter === 'PENDING'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          배차 대기 ({pendingDeliveries.length})
        </button>
        <button
          onClick={() => setFilter('DISPATCHED')}
          className={`flex-1 py-2 px-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
            filter === 'DISPATCHED'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          운송중
        </button>
        <button
          onClick={() => setFilter('DELIVERED')}
          className={`flex-1 py-2 px-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
            filter === 'DELIVERED'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          운송 완료
        </button>
        <button
          onClick={() => setFilter('CANCELLED')}
          className={`flex-1 py-2 px-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
            filter === 'CANCELLED'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          취소
        </button>
      </div>

      {/* 📋 영업 의뢰 배차 대기 ToDo 헤더 배너 */}
      {filter === 'PENDING' && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>영업 의뢰 배차 대기 할일 (ToDo): {pendingDeliveries.length}건</span>
          </div>
          <span className="text-[11px] font-normal text-amber-200/70">기사 배정 시 자동 완결</span>
        </div>
      )}

      {/* 배차 목록 피드 */}
      <div className="flex flex-col gap-3">
        {filteredDeliveries.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-xs bg-slate-900/50 rounded-2xl border border-slate-800 flex flex-col items-center justify-center gap-2">
            <CheckCircle2 className="w-7 h-7 text-emerald-500" />
            <span className="font-bold text-slate-300">
              {filter === 'PENDING' 
                ? '현재 대기 중인 배차 의뢰가 모두 완료되었습니다. (할일 0건)' 
                : '해당 상태의 배차 건이 없습니다.'}
            </span>
            {filter === 'PENDING' && (
              <span className="text-[11px] text-slate-500">영업사원의 출고/회수/교환 요청 등록 시 자동 인입됩니다.</span>
            )}
          </div>
        ) : (
          filteredDeliveries.map((delivery) => (
            <div
              key={delivery.id}
              className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-3 shadow-lg"
            >
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-lg bg-blue-500/20 text-blue-400 text-xs font-black border border-blue-500/30">
                  {delivery.type === 'EXCHANGE' ? '교환 EXCHANGE' : delivery.dispatchCategory || delivery.type}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {delivery.loadingDate || delivery.requestDate}
                </span>
              </div>

              {/* 영업 의뢰자 & 계약 정보 (영업-배차 연계) */}
              {(() => {
                const contract = contracts.find(c => c.id === delivery.contractId);
                const salesperson = users.find(u => u.id === contract?.salespersonId)?.name;
                if (!salesperson && !contract?.contractNo) return null;
                return (
                  <div className="flex items-center justify-between text-xs px-1 text-slate-400">
                    <span className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-blue-400" />
                      의뢰: <strong className="text-white">{salesperson || '영업부'}</strong>
                    </span>
                    {contract?.contractNo && (
                      <span className="text-[11px] text-slate-500 font-mono">
                        계약: {contract.contractNo}
                      </span>
                    )}
                  </div>
                );
              })()}

              {/* 상하차지 경로 */}
              <div className="flex flex-col gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 text-xs flex items-center justify-center font-bold">
                    상
                  </span>
                  <div className="text-xs text-slate-300">
                    <div className="font-bold text-white">
                      {delivery.pickupVendorName || delivery.originAddress || '본사 주기장'}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center font-bold">
                    하
                  </span>
                  <div className="text-xs text-slate-300">
                    <div className="font-bold text-white">
                      {delivery.destinationAddress || '고객사 현장'}
                    </div>
                    {delivery.cargoItems && (
                      <div className="text-slate-400 text-[11px] mt-0.5">
                        화물: {delivery.cargoItems}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 지시 메모 및 특이사항 (대차/교환 대상 등 - 과제 10 복원) */}
              {delivery.memo && (
                <div className="p-2.5 rounded-xl bg-slate-950 border border-blue-900/40 text-xs text-slate-300 flex items-start gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-sky-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 leading-relaxed">
                    <span className="text-sky-400 font-bold mr-1">[배차메모]</span>
                    <span>{delivery.memo}</span>
                  </div>
                </div>
              )}

              {/* 기사/차량 정보 */}
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  기사: <strong className="text-white">{delivery.driverName || '미지정'}</strong> ({delivery.vehicleNo || '차량번호미상'})
                </span>
                {delivery.driverContact && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSendDriverSms(delivery)}
                      className="flex items-center gap-1 text-sky-400 font-bold bg-sky-950/50 hover:bg-sky-900/60 py-1 px-2.5 rounded-lg border border-sky-800/60 active:scale-95 text-xs transition-all"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                      배차문자
                    </button>
                    <a
                      href={`tel:${delivery.driverContact}`}
                      className="flex items-center gap-1 text-emerald-400 font-bold bg-emerald-950/40 py-1 px-2.5 rounded-lg border border-emerald-900/50 text-xs"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      통화
                    </a>
                  </div>
                )}
              </div>

              {/* 운송료 표시 */}
              {delivery.finalCost ? (
                <div className="text-right text-xs font-bold text-slate-300">
                  운송료: <span className="text-emerald-400 font-mono">{delivery.finalCost.toLocaleString()}원</span>
                </div>
              ) : null}

              {/* 대기 상태일 때 기사 배정 액션 버튼 */}
              {(delivery.status === 'PENDING' || delivery.status === 'REQUESTED') && (
                <button
                  type="button"
                  onClick={() => handleOpenAssignModal(delivery.id)}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 active:scale-98 transition-transform shadow-md"
                >
                  <UserCheck className="w-4 h-4" />
                  기사/차량 배정하기
                </button>
              )}

              {/* 운송중일 때 하차 완료 액션 버튼 */}
              {delivery.status === 'DISPATCHED' && (
                <button
                  type="button"
                  onClick={() => handleUpdateStatus(delivery.id, 'DELIVERED')}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 active:scale-98 transition-transform shadow-md"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  하차 완료 1-Click 보고
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* 🚚 통화 텍스트/음성 기사 배정 모달 */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <Truck className="w-4 h-4 text-blue-400" />
                화물 기사 배정 (통화/음성 연동)
              </h3>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 통화 텍스트 및 음성 바 */}
            <div className="p-3 rounded-xl bg-slate-950 border border-blue-900/40 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-blue-300 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                  기사 통화 내용 자동 파싱
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowPasteBox(!showPasteBox)}
                    className="py-1 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-bold border border-slate-700"
                  >
                    <FileText className="w-3 h-3 inline mr-1" />
                    {showPasteBox ? '입력창 닫기' : '텍스트 붙여넣기'}
                  </button>
                  <button
                    type="button"
                    onClick={toggleListening}
                    className={`py-1 px-2.5 rounded-lg text-[11px] font-black flex items-center gap-1 transition-all ${
                      isListening
                        ? 'bg-rose-600 text-white animate-pulse'
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    {isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                    {isListening ? '듣는중...' : '음성입력'}
                  </button>
                </div>
              </div>

              {isListening && interimText && (
                <div className="p-2 rounded-lg bg-rose-950/30 border border-rose-800/40 text-rose-200 text-xs">
                  🎙️ {interimText}
                </div>
              )}

              {showPasteBox && (
                <div className="flex flex-col gap-2 pt-1 border-t border-slate-800">
                  <textarea
                    rows={3}
                    value={pastedTranscript}
                    onChange={(e) => setPastedTranscript(e.target.value)}
                    placeholder="기사 통화 내용 붙여넣기...\n예: 경기88바1234 이기사 010-1234-5678 5톤 축차 12만원 판교 현장"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        applyDriverTranscript(pastedTranscript);
                        setShowPasteBox(false);
                      }}
                      className="py-1 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
                    >
                      파싱 적용
                    </button>
                  </div>
                </div>
              )}

              {recentModifiedFields.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {recentModifiedFields.map((f, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-bold flex items-center gap-1"
                    >
                      <Check className="w-2.5 h-2.5 text-blue-400" />
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 대상 배차건 선택 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-300">
                대상 배차 건 <span className="text-red-400">*</span>
              </label>
              <select
                value={targetDeliveryId}
                onChange={(e) => setTargetDeliveryId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">-- 배차건 선택 --</option>
                {pendingDeliveries.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.dispatchCategory || d.type} {d.destinationAddress || '현장'} ({d.loadingDate || d.requestDate})
                  </option>
                ))}
              </select>
            </div>

            {/* 차량번호 & 차종 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300">
                  차량번호 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value)}
                  placeholder="예: 경기88바1234"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white uppercase focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300">차종</label>
                <input
                  type="text"
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  placeholder="예: 5톤 축차, 셀프로더"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* 기사명 & 연락처 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300">
                  기사 성함 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  placeholder="예: 이기사, 김철수"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300">기사 연락처</label>
                <input
                  type="tel"
                  value={driverContact}
                  onChange={(e) => setDriverContact(e.target.value)}
                  placeholder="010-0000-0000"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* 확정 운송료 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-300">확정 운송료 (원)</label>
              <input
                type="number"
                value={finalCost || ''}
                onChange={(e) => setFinalCost(Number(e.target.value))}
                placeholder="예: 120000"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveDriverAssignment(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold"
                >
                  배정 확정
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleSaveDriverAssignment(true)}
                className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black shadow-lg flex items-center justify-center gap-1.5 active:scale-98 transition-transform"
              >
                <Send className="w-4 h-4" />
                기사 배정 확정 + 배차문자 즉시 발송
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
