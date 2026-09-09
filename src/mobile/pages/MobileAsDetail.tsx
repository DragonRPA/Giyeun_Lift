// src/mobile/pages/MobileAsDetail.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { CameraUploader } from '../components/CameraUploader';
import { SignatureCanvas } from '../components/SignatureCanvas';
import { ArrowLeft, Navigation, Phone, CheckCircle2, Wrench, Plus, Trash2, ChevronDown, MapPin } from 'lucide-react';
import { db, RepairPartUsed } from '../../services/db';
import { launchNavigation, safePhoneCall, resolveSiteDetailedAddress, copyToClipboard, NavAppType } from '../../utils/nativeLauncher';

interface MobileAsDetailProps {
  ticketId: string;
  onBack: () => void;
}

const QUICK_TAGS = [
  '협착 방지봉 교체',
  '과상승 감지봉 보수',
  '충전선/220V 수리',
  '협착 센서 리셋',
  '키박스/키스위치 교체',
  '유압 오일 보충/조임',
  '상하강 리미트 스위치 교체',
  '메인보드 리셋',
  '정기 순회 점검 완료',
];

export const MobileAsDetail: React.FC<MobileAsDetailProps> = ({ ticketId, onBack }) => {
  const {
    fieldAsTickets,
    completeFieldAsTicket,
    mechanicConsumableStocks,
    consumables,
    currentUser,
    showErrorModal,
  } = useApp();

  const ticket = fieldAsTickets.find((t) => t.id === ticketId);

  const [actionTaken, setActionTaken] = useState(ticket?.actionTaken || '');
  const [resolutionType, setResolutionType] = useState<'REPAIR_DONE' | 'REVISIT_NEEDED' | 'GUIDED_END'>('REPAIR_DONE');
  const [isExchangeNeeded, setIsExchangeNeeded] = useState(ticket?.exchangeSuggested || false);
  const [revisitReason, setRevisitReason] = useState(ticket?.revisitReason || '');
  const [revisitDate, setRevisitDate] = useState(ticket?.revisitDate || new Date(Date.now() + 86400000).toISOString().split('T')[0]);
  const [beforeImages, setBeforeImages] = useState<string[]>(
    ticket?.beforeImage ? [ticket.beforeImage] : ticket?.faultImageUrl ? [ticket.faultImageUrl] : []
  );
  const [afterImages, setAfterImages] = useState<string[]>(
    ticket?.afterImage ? [ticket.afterImage] : []
  );
  const [customerSignature, setCustomerSignature] = useState<string>(ticket?.customerSignature || '');
  const [customerConfirmName, setCustomerConfirmName] = useState<string>(ticket?.customerConfirmName || '');
  const [partsUsed, setPartsUsed] = useState<RepairPartUsed[]>(ticket?.partsUsed || []);
  const [selectedStockId, setSelectedStockId] = useState('');
  const [selectedQty, setSelectedQty] = useState(1);
  const [billableType, setBillableType] = useState<'FREE' | 'BILLABLE'>(ticket?.billableType === 'BILLABLE' ? 'BILLABLE' : 'FREE');
  const [billableAmount, setBillableAmount] = useState<number>(ticket?.billableAmount || 0);
  const [inspectionItemCode, setInspectionItemCode] = useState<string>(ticket?.inspectionItemCode || '');
  const [degradationScore, setDegradationScore] = useState<number>(ticket?.degradationScore || 0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 내비게이션 앱 선택 상태 (로컬스토리지 기억)
  const [selectedNavApp, setSelectedNavApp] = useState<NavAppType>(() => {
    return (localStorage.getItem('preferred_nav_app') as NavAppType) || 'TMAP';
  });
  const [showNavOptions, setShowNavOptions] = useState(false);

  if (!ticket) {
    return (
      <div className="p-8 text-center text-slate-400">
        티켓을 찾을 수 없습니다.
        <button onClick={onBack} className="block mt-4 text-blue-400 underline mx-auto">
          목록으로 돌아가기
        </button>
      </div>
    );
  }

  // 🌟 정밀 도로명 주소 다단계 역추적 (siteId -> siteName -> contract -> asset 계약 -> 고객사 현장)
  const resolvedAddress = useMemo(() => {
    if (!ticket) return '';
    return resolveSiteDetailedAddress({
      siteAddress: ticket.siteAddress,
      siteId: ticket.siteId,
      siteName: ticket.siteName,
      contractId: ticket.contractId,
      assetNo: ticket.assetNo,
      assetId: ticket.assetId,
      customerName: ticket.customerName,
      locationDetail: ticket.locationDetail,
      customerSites: db.customerSites,
      contracts: db.contracts,
      contractAssets: db.contractAssets,
      customers: db.customers,
    });
  }, [ticket, db.customerSites, db.contracts, db.contractAssets, db.customers]);

  // 안전한 길안내 열기 (현장명 대신 실제 상세 도로명 주소 우선 전송)
  const handleOpenNav = (app: NavAppType = selectedNavApp) => {
    const destination = ticket.siteAddress || resolvedAddress || ticket.siteName || ticket.locationDetail || ticket.customerName || '현장';
    launchNavigation(destination, app);
  };

  // 안전한 전화 걸기 (DOM <a> 클릭 방식으로 PWA 세션 보존)
  const handleCall = () => {
    safePhoneCall(ticket.reporterContact);
  };

  // 부품 추가
  const handleAddPart = () => {
    if (!selectedStockId) return;
    const stock = mechanicConsumableStocks.find((s) => s.id === selectedStockId);
    if (!stock) return;
    const consumable = consumables.find((c) => c.id === stock.consumableId);

    const safeQty = Math.max(1, Math.floor(selectedQty || 1));
    if (safeQty > (stock.stockQty || 0)) {
      showErrorModal(`차량 적재 수량(${stock.stockQty || 0}개)을 초과할 수 없습니다.`);
      return;
    }

    const newPart: RepairPartUsed = {
      consumableId: stock.consumableId,
      modelName: consumable?.modelName || '소모부품',
      quantity: safeQty,
      unitPrice: consumable?.unitPrice || 0,
      stockSource: 'VEHICLE_VAN',
    };

    setPartsUsed([...partsUsed, newPart]);
    setSelectedStockId('');
    setSelectedQty(1);
  };

  // 부품 제거
  const handleRemovePart = (idx: number) => {
    setPartsUsed(partsUsed.filter((_, i) => i !== idx));
  };

  // 최종 조치 완료 승인
  const handleComplete = async () => {
    if (!actionTaken.trim()) {
      showErrorModal('조치 내용을 입력해 주세요.');
      return;
    }

    if (resolutionType === 'REVISIT_NEEDED' && !revisitReason.trim()) {
      showErrorModal('재방문 사유를 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      await completeFieldAsTicket(ticket.id, {
        mechanicId: currentUser?.id || ticket.mechanicId || '',
        actionTaken,
        resolutionType,
        billableType,
        billableAmount: billableType === 'BILLABLE' ? Math.max(0, Number(billableAmount) || 0) : 0,
        beforeImage: beforeImages[0] || '',
        afterImage: afterImages[0] || '',
        customerSignature: customerSignature || '', // 🟢 [누락 복구] 서명 데이터 무누락 DB 전달
        customerConfirmName: customerConfirmName || ticket.reporterName || '현장확인자',
        partsUsed,
        inspectionItemCode,
        degradationScore,
        exchangeSuggested: resolutionType === 'REVISIT_NEEDED' && isExchangeNeeded,
        revisitReason: resolutionType === 'REVISIT_NEEDED' ? revisitReason.trim() : undefined,
        revisitDate: resolutionType === 'REVISIT_NEEDED' ? revisitDate : undefined,
      });
      onBack();
    } catch (err: any) {
      showErrorModal('완료 처리 중 오류가 발생했습니다: ' + (err.message || ''));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-28 p-4 bg-slate-950 min-h-screen">
      {/* 상단 네비게이션 헤더 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-300 py-2 px-3 rounded-xl bg-slate-900 border border-slate-800 active:scale-95 transition-transform"
        >
          <ArrowLeft className="w-4 h-4" />
          목록으로
        </button>
        <span className="text-xs font-mono text-slate-400 font-bold">
          티켓 #{ticket.ticketNo || ticket.id.slice(0, 8)}
        </span>
      </div>

      {/* 장비 및 현장 요약 카드 */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-3 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-xl bg-blue-500/20 text-blue-400 text-sm font-black font-mono border border-blue-500/30">
              {ticket.assetNo || '장비번호미상'}
            </span>
            <span className="text-sm font-bold text-white">{ticket.modelName || ''}</span>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
            {ticket.status}
          </span>
        </div>

        <div>
          <div className="text-base font-black text-white">{ticket.customerName}</div>
          <div className="text-xs text-slate-300 mt-1 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-400 font-bold">현장:</span>
              <span className="text-white font-semibold">{ticket.siteName || '현장위치미상'}</span>
              {ticket.locationDetail && (
                <span className="text-slate-400 font-mono text-[11px]">({ticket.locationDetail})</span>
              )}
            </div>
            {(ticket.siteAddress || resolvedAddress) ? (
              <div className="flex items-center justify-between text-sky-300 font-medium bg-sky-950/40 border border-sky-800/40 rounded-lg px-2 py-1">
                <div className="flex items-center gap-1 min-w-0">
                  <MapPin className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                  <span className="text-[11.5px] truncate">{ticket.siteAddress || resolvedAddress}</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(ticket.siteAddress || resolvedAddress)}
                  className="text-[10px] text-sky-400 hover:text-white px-1.5 py-0.5 rounded bg-sky-900/60 flex-shrink-0 ml-1 whitespace-nowrap"
                >
                  복사
                </button>
              </div>
            ) : (
              <div className="text-slate-500 text-[11px]">
                (상세 도로명 주소 미등록)
              </div>
            )}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300">
          <div className="font-bold text-slate-400 mb-0.5">접수 고장 증상:</div>
          <div>{ticket.issueDescription || ticket.issueCategory || '고장 점검 요청'}</div>
        </div>

        {/* 1-Click 안전 길안내 & 전화 버튼 */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => handleOpenNav(selectedNavApp)}
              className="flex-1 py-3 px-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-transform shadow-md"
              title={`${selectedNavApp === 'TMAP' ? 'T맵' : selectedNavApp === 'KAKAO' ? '카카오내비' : '네이버지도'} 실행`}
            >
              <Navigation className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{selectedNavApp === 'TMAP' ? 'T맵 길안내' : selectedNavApp === 'KAKAO' ? '카카오내비' : '네이버지도'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowNavOptions(!showNavOptions)}
              className="px-2.5 rounded-xl bg-sky-700 hover:bg-sky-600 text-white text-xs flex items-center justify-center active:scale-95"
              title="내비 앱 선택"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleCall}
            disabled={!ticket.reporterContact}
            className="py-3 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-md"
          >
            <Phone className="w-4 h-4 flex-shrink-0" />
            <span>담당자 통화</span>
          </button>
        </div>

        {/* 내비게이션 앱 선택 패널 */}
        {showNavOptions && (
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-2 animate-fade-in text-xs">
            <div className="flex items-center justify-between font-bold text-slate-300">
              <span>내비게이션 선택:</span>
              <button type="button" onClick={() => setShowNavOptions(false)} className="text-slate-500 text-[11px]">닫기</button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedNavApp('TMAP');
                  localStorage.setItem('preferred_nav_app', 'TMAP');
                  setShowNavOptions(false);
                  handleOpenNav('TMAP');
                }}
                className={`py-2 px-1 rounded-lg border font-bold text-center ${selectedNavApp === 'TMAP' ? 'bg-sky-600 border-sky-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-300'}`}
              >
                🔴 T맵
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedNavApp('KAKAO');
                  localStorage.setItem('preferred_nav_app', 'KAKAO');
                  setShowNavOptions(false);
                  handleOpenNav('KAKAO');
                }}
                className={`py-2 px-1 rounded-lg border font-bold text-center ${selectedNavApp === 'KAKAO' ? 'bg-yellow-600 border-yellow-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-300'}`}
              >
                🟡 카카오
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedNavApp('NAVER');
                  localStorage.setItem('preferred_nav_app', 'NAVER');
                  setShowNavOptions(false);
                  handleOpenNav('NAVER');
                }}
                className={`py-2 px-1 rounded-lg border font-bold text-center ${selectedNavApp === 'NAVER' ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-300'}`}
              >
                🟢 네이버
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 조치 내용 입력 섹션 */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-3 shadow-lg">
        <label className="text-sm font-bold text-white flex items-center gap-1.5">
          <Wrench className="w-4 h-4 text-blue-400" />
          현장 조치 내용 입력
        </label>

        {/* 빠른 입력 태그 */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_TAGS.map((tag, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActionTaken((prev) => (prev ? `${prev}, ${tag}` : tag))}
              className="text-[11px] font-medium py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 active:scale-95 transition-transform whitespace-nowrap shrink-0 flex-shrink-0"
            >
              + {tag}
            </button>
          ))}
        </div>

        <textarea
          rows={3}
          value={actionTaken}
          onChange={(e) => setActionTaken(e.target.value)}
          placeholder="조치 내용 입력"
          className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />

        <div className="flex flex-col gap-1.5 mt-2">
          <label className="text-xs font-bold text-slate-300 whitespace-nowrap">정비 항목 분류 코드</label>
          <select
            value={inspectionItemCode}
            onChange={(e) => setInspectionItemCode(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">분류 선택</option>
            <option value="CHK-000001">외관/바디 (CHK-000001)</option>
            <option value="CHK-000002">유압/동력 (CHK-000002)</option>
            <option value="CHK-000003">전기/배터리 (CHK-000003)</option>
            <option value="CHK-000004">주행/타이어 (CHK-000004)</option>
            <option value="CHK-000005">기타/접수 (CHK-000005)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5 mt-2">
          <label className="text-xs font-bold text-slate-300 whitespace-nowrap">정비점수 (+)</label>
          <input
            type="number"
            min={0}
            value={degradationScore}
            onChange={(e) => setDegradationScore(parseInt(e.target.value) || 0)}
            placeholder="정비점수"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* 조치 종결 유형 3단 세그먼트 */}
        <div className="flex flex-col gap-1.5 mt-2 pt-3 border-t border-slate-800">
          <label className="text-xs font-bold text-slate-300 whitespace-nowrap">조치 종결 유형</label>
          <div className="grid grid-cols-3 gap-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setResolutionType('REPAIR_DONE')}
              className={`py-2 rounded-lg text-xs font-bold transition-all ${
                resolutionType === 'REPAIR_DONE'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              수리 완료
            </button>
            <button
              type="button"
              onClick={() => setResolutionType('REVISIT_NEEDED')}
              className={`py-2 rounded-lg text-xs font-bold transition-all ${
                resolutionType === 'REVISIT_NEEDED'
                  ? 'bg-rose-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              재방문 필요
            </button>
            <button
              type="button"
              onClick={() => setResolutionType('GUIDED_END')}
              className={`py-2 rounded-lg text-xs font-bold transition-all ${
                resolutionType === 'GUIDED_END'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              유선 안내
            </button>
          </div>
        </div>

        {/* 재방문 필요 시 세부 설정 */}
        {resolutionType === 'REVISIT_NEEDED' && (
          <div className="flex flex-col gap-3 p-3 rounded-xl bg-rose-950/20 border border-rose-500/30 animate-in fade-in">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-rose-300">재방문 사유 <span className="text-rose-400">*</span></label>
              <input
                type="text"
                value={revisitReason}
                onChange={(e) => setRevisitReason(e.target.value)}
                placeholder="예: 특수부품 수급 필요, 모터 소손 공장입고"
                className="w-full bg-slate-950 border border-rose-900/50 rounded-lg p-2 text-xs text-white placeholder-slate-500"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300">재방문 예정일</label>
              <input
                type="date"
                value={revisitDate}
                onChange={(e) => setRevisitDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white"
              />
            </div>

            {/* 대차(EXCHANGE) 제안 토글 */}
            <label className="flex items-center gap-2 p-2 rounded-lg bg-purple-950/30 border border-purple-800/40 cursor-pointer">
              <input
                type="checkbox"
                checked={isExchangeNeeded}
                onChange={(e) => setIsExchangeNeeded(e.target.checked)}
                className="w-4 h-4 rounded text-purple-600"
              />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-purple-300">동급 장비 대차(교환) 필요</span>
                <span className="text-[10px] text-slate-400">체크 시 본사 배차실에 단일 교환 배차 연계</span>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* 부품 사용 차감 섹션 (탑차 재고 연동) */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-3 shadow-lg">
        <label className="text-sm font-bold text-white flex items-center justify-between">
          <span>차량 탑차 부품 사용 차감</span>
          <span className="text-xs text-slate-400 font-normal">사용 부품 {partsUsed.length}건</span>
        </label>

        <div className="flex gap-2">
          <select
            value={selectedStockId}
            onChange={(e) => setSelectedStockId(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">탑차 부품 선택...</option>
            {(() => {
              const targetMechanicId = currentUser?.id || ticket?.mechanicId;
              const displayList = mechanicConsumableStocks.filter(
                (s) => (!targetMechanicId || s.mechanicId === targetMechanicId) && s.stockQty > 0
              );
              return displayList.map((stock) => {
                const consumable = consumables.find((c) => c.id === stock.consumableId);
                return (
                  <option key={stock.id} value={stock.id}>
                    {consumable?.modelName || '부품'} (보유: {stock.stockQty}개)
                  </option>
                );
              });
            })()}
          </select>
          <input
            type="number"
            min={1}
            value={selectedQty}
            onChange={(e) => setSelectedQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-16 bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white text-center"
          />
          <button
            type="button"
            onClick={handleAddPart}
            className="p-2.5 rounded-xl bg-blue-600 text-white font-bold text-xs flex items-center justify-center active:scale-95 transition-transform"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {partsUsed.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-2">
            {partsUsed.map((part, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs"
              >
                <div className="text-white font-medium">
                  {part.modelName} × {part.quantity}개
                </div>
                <button
                  type="button"
                  onClick={() => handleRemovePart(idx)}
                  className="p-1 text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 수리 전/후 사진 촬영 */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-4 shadow-lg">
        <CameraUploader
          label="수리 전(고장) 사진"
          images={beforeImages}
          onChange={setBeforeImages}
          maxImages={2}
        />
        <CameraUploader
          label="수리 완료 사진"
          images={afterImages}
          onChange={setAfterImages}
          maxImages={2}
        />
      </div>

      {/* 💰 유상/무상 수리 비용 청구 구분 */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-3 shadow-lg">
        <label className="text-xs font-bold text-slate-300">수리 비용 청구 구분</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setBillableType('FREE')}
            className={`py-2.5 rounded-xl font-bold text-xs transition-all ${
              billableType === 'FREE'
                ? 'bg-emerald-600 text-white shadow'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            무상 수리 (임대보증)
          </button>
          <button
            type="button"
            onClick={() => setBillableType('BILLABLE')}
            className={`py-2.5 rounded-xl font-bold text-xs transition-all ${
              billableType === 'BILLABLE'
                ? 'bg-amber-600 text-white shadow'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            유상 수리 (사용자과실)
          </button>
        </div>

        {billableType === 'BILLABLE' && (
          <div className="flex flex-col gap-1 pt-1">
            <label className="text-[11px] font-bold text-slate-400">유상 수리 청구 금액 (원)</label>
            <input
              type="number"
              min="0"
              value={billableAmount || ''}
              onChange={(e) => setBillableAmount(Math.max(0, parseInt(e.target.value) || 0))}
              placeholder="청구 금액 입력 (예: 150000)"
              className="w-full bg-slate-950 border border-amber-600/50 rounded-xl p-2.5 text-xs text-amber-400 font-mono font-bold"
            />
          </div>
        )}
      </div>

      {/* 고객 서명 섹션 */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-3 shadow-lg">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={customerConfirmName}
            onChange={(e) => setCustomerConfirmName(e.target.value)}
            placeholder="서명자 성함 (예: 홍길동 소장)"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white placeholder-slate-500"
          />
        </div>
        <SignatureCanvas
          label="현장 고객 확인 서명"
          initialSignature={customerSignature}
          onSave={setCustomerSignature}
        />
      </div>

      {/* 최종 완결 버튼 */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-slate-950/95 border-t border-slate-800 backdrop-blur-md safe-area-bottom z-30">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleComplete}
          className="w-full py-4 px-6 rounded-2xl bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-black text-base flex items-center justify-center gap-2 shadow-2xl shadow-blue-600/50 transition-all"
        >
          <CheckCircle2 className="w-5 h-5" />
          {isSubmitting ? '완료 등록 중...' : 'AS 조치 완료 승인'}
        </button>
      </div>
    </div>
  );
};
