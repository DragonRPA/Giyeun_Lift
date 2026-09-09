// src/mobile/pages/MobileInboundRegister.tsx
import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { CameraUploader } from '../components/CameraUploader';
import { InboundDefectDetail, Asset, InspectionChecklistItem } from '../../services/db';
import { 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  X, 
  ArrowLeft, 
  Check, 
  Building2, 
  MapPin, 
  Wrench,
  ChevronDown,
  RotateCcw
} from 'lucide-react';

interface DefectOption {
  id: string;
  name: string;
  score: number;
  category: string;
}

// 🛡️ [안전 폴백] DB 점검항목 미등록 시 비상 대비 기본 시드
const FALLBACK_DEFECT_PRESETS: DefectOption[] = [
  { id: 'CHK-001', name: '외관 파손 및 도색 불량', score: 10, category: '외관/바디' },
  { id: 'CHK-002', name: '안전 난간 및 확장 데크 변형', score: 20, category: '외관/바디' },
  { id: 'CHK-003', name: '상하강 및 주행 리미트 오작동', score: 25, category: '조작계통' },
  { id: 'CHK-004', name: '과상승 감지봉 파손', score: 15, category: '안전장치' },
  { id: 'CHK-005', name: '협착 방지봉 센서 파손', score: 15, category: '안전장치' },
  { id: 'CHK-006', name: '조작부 비상정지 스위치 불량', score: 20, category: '조작계통' },
  { id: 'CHK-007', name: '조종기 리모컨 및 케이블 불량', score: 25, category: '조작계통' },
  { id: 'CHK-008', name: '배터리 방전 및 셀 불량', score: 30, category: '전기/배터리' },
  { id: 'CHK-009', name: '유압 라인 누유 및 실린더 결함', score: 30, category: '유압/동력' },
  { id: 'CHK-010', name: '타이어 파손 및 휠 볼트 풀림', score: 20, category: '주행/섀시' },
  { id: 'CHK-011', name: '충전선 파손 및 전원 플러그 불량', score: 15, category: '전기/배터리' },
  { id: 'CHK-012', name: '하부 컨트롤러 수동 하강 불량', score: 25, category: '조작계통' },
];

interface MobileInboundRegisterProps {
  onSuccess?: () => void;
  onBack?: () => void;
}

export const MobileInboundRegister: React.FC<MobileInboundRegisterProps> = ({
  onSuccess,
  onBack,
}) => {
  const { 
    assets, 
    contractAssets, 
    contracts, 
    customers, 
    sites, 
    inspectionChecklistItems,
    registerInboundAsset, 
    showErrorModal 
  } = useApp();

  // 기본 상태값
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [returnDate, setReturnDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [isInboundGood, setIsInboundGood] = useState<boolean>(true); // true: 정상, false: 불량/정비필요
  const [selectedDefects, setSelectedDefects] = useState<string[]>([]); // CHK-001 등 id 리스트
  const [selectedCategory, setSelectedCategory] = useState<string>('전체');
  const [defectSearchQuery, setDefectSearchQuery] = useState<string>('');
  const [otherDefectText, setOtherDefectText] = useState<string>('');
  const [memo, setMemo] = useState<string>('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // 자산 선택 바텀시트
  const [isAssetSheetOpen, setIsAssetSheetOpen] = useState<boolean>(false);
  const [assetSearchQuery, setAssetSearchQuery] = useState<string>('');

  // 1. 점검 마스터 항목 (SSOT 연동: inspectionChecklistItems 우선 구독)
  const availableDefects: DefectOption[] = useMemo(() => {
    if (inspectionChecklistItems && inspectionChecklistItems.length > 0) {
      return inspectionChecklistItems.map((item: InspectionChecklistItem) => ({
        id: item.id,
        name: item.name,
        score: item.score || 10,
        category: item.category || '기타'
      }));
    }
    return FALLBACK_DEFECT_PRESETS;
  }, [inspectionChecklistItems]);

  // 카테고리 목록 도출
  const categories = useMemo(() => {
    const cats = Array.from(new Set(availableDefects.map(d => d.category)));
    return ['전체', ...cats];
  }, [availableDefects]);

  // 필터링된 불량 항목 목록
  const displayedDefects = useMemo(() => {
    let list = availableDefects;
    if (selectedCategory !== '전체') {
      list = list.filter(d => d.category === selectedCategory);
    }
    if (defectSearchQuery.trim()) {
      const q = defectSearchQuery.trim().toLowerCase();
      list = list.filter(d => 
        d.name.toLowerCase().includes(q) || 
        d.category.toLowerCase().includes(q)
      );
    }
    return list;
  }, [availableDefects, selectedCategory, defectSearchQuery]);

  // 2. 대여중 / 회수 대상 자산 목록 (RENTED 우선, 그 외 전체)
  const candidateAssets = useMemo(() => {
    return assets.map(a => {
      const ca = contractAssets.find(c => c.assetId === a.id && c.status === 'RENTED') ||
                 contractAssets.find(c => c.assetId === a.id && c.status !== 'RETURNED');
      const contract = ca ? contracts.find(ct => ct.id === ca.contractId) : null;
      const customer = contract ? customers.find(cu => cu.id === contract.customerId) : null;
      const site = contract ? sites.find(s => s.id === contract.siteId) : null;

      return {
        ...a,
        isRented: a.status === 'RENTED' || !!ca,
        isSublease: a.ownerType === 'RENTED',
        customerName: customer?.name || '미등록 거래처',
        siteName: site?.name || '미등록 현장',
      };
    });
  }, [assets, contractAssets, contracts, customers, sites]);

  // 필터링된 자산 목록 (대여중 우선 정렬)
  const filteredAssets = useMemo(() => {
    let list = candidateAssets;
    if (assetSearchQuery.trim()) {
      const q = assetSearchQuery.trim().toLowerCase();
      list = list.filter(a => 
        a.assetNo.toLowerCase().includes(q) ||
        a.modelName.toLowerCase().includes(q) ||
        a.customerName.toLowerCase().includes(q) ||
        a.siteName.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => {
      if (a.isRented && !b.isRented) return -1;
      if (!a.isRented && b.isRented) return 1;
      return a.assetNo.localeCompare(b.assetNo);
    });
  }, [candidateAssets, assetSearchQuery]);

  // 현재 선택된 자산 정보
  const currentAsset = useMemo(() => {
    return candidateAssets.find(a => a.id === selectedAssetId);
  }, [candidateAssets, selectedAssetId]);

  // 불량 증상 다중 선택 토글
  const handleToggleDefect = (defectId: string) => {
    setSelectedDefects(prev => 
      prev.includes(defectId) ? prev.filter(id => id !== defectId) : [...prev, defectId]
    );
  };

  // 선택 초기화
  const handleClearDefects = () => {
    setSelectedDefects([]);
    setOtherDefectText('');
  };

  // 총 정비점수 계산
  const totalDegradationScore = useMemo(() => {
    if (isInboundGood) return 0;
    let score = selectedDefects.reduce((sum, id) => {
      const p = availableDefects.find(d => d.id === id);
      return sum + (p ? p.score : 0);
    }, 0);
    if (otherDefectText.trim() && score === 0) {
      score = 10; // 기타 불량 증상만 입력된 경우 기본 10점 부여
    }
    return score;
  }, [isInboundGood, selectedDefects, availableDefects, otherDefectText]);

  // 등록 제출
  const handleSubmit = async () => {
    if (!selectedAssetId) {
      showErrorModal('입고 대상 자산을 먼저 선택해 주십시오.');
      return;
    }

    if (!returnDate) {
      showErrorModal('입고 일자를 입력해 주십시오.');
      return;
    }

    setIsSubmitting(true);
    try {
      // 불량 디테일 구조 생성 (SSOT 마스터 데이터 연동)
      const defectDetails: InboundDefectDetail[] = isInboundGood ? [] : selectedDefects.map(id => {
        const item = availableDefects.find(d => d.id === id);
        return {
          checkitemId: id,
          checkitemName: item?.name || id,
          score: item?.score || 10,
        };
      });

      await registerInboundAsset({
        assetId: selectedAssetId,
        returnDate: returnDate,
        maintenanceScore: isInboundGood ? 0 : totalDegradationScore,
        memo: memo.trim() || undefined,
        defects: defectDetails,
        photos: photos,
        otherDefectText: isInboundGood ? undefined : otherDefectText.trim(),
        targetAssetStatus: isInboundGood ? 'AVAILABLE' : 'REPAIRING',
      });

      setSuccessToast(`[${currentAsset?.assetNo}] 입고 등록이 완료되었습니다. (${isInboundGood ? '임대가능 전환' : '정비중 전환 및 정비티켓 발행'})`);
      
      setTimeout(() => {
        setSuccessToast(null);
        if (onSuccess) {
          onSuccess();
        } else {
          // 폼 리셋
          setSelectedAssetId('');
          setIsInboundGood(true);
          setSelectedDefects([]);
          setOtherDefectText('');
          setMemo('');
          setPhotos([]);
        }
      }, 1500);
    } catch (err: any) {
      showErrorModal(err?.message || '입고 등록 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-28 p-3 sm:p-4 font-sans text-slate-100 max-w-full">
      {/* 성공 피드백 토스트 */}
      {successToast && (
        <div 
          style={{
            position: 'fixed',
            top: '70px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            padding: '12px 20px',
            borderRadius: '12px',
            backgroundColor: '#059669',
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: '700',
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            whiteSpace: 'nowrap'
          }}
        >
          {successToast}
        </div>
      )}

      {/* 헤더 바 */}
      <div className="flex items-center justify-between py-1 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h1 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
              <span>장비 입고 등록</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                출고팀
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">회수 장비 기능 점검 및 정비 자동 연동</p>
          </div>
        </div>
      </div>

      {/* ── 1. 대상 자산 선택 카드 ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
            입고 대상 장비
          </label>
          {currentAsset && (
            <div className="flex items-center gap-1.5">
              {currentAsset.isSublease && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-900/80 text-purple-300 border border-purple-700 whitespace-nowrap">
                  타사전대
                </span>
              )}
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border whitespace-nowrap ${
                currentAsset.isRented
                  ? 'bg-sky-950/80 border-sky-800 text-sky-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}>
                {currentAsset.isRented ? '대여중' : currentAsset.status}
              </span>
            </div>
          )}
        </div>

        {/* 자산 선택 버튼 */}
        <button
          type="button"
          onClick={() => setIsAssetSheetOpen(true)}
          className="w-full py-3 px-3.5 rounded-xl bg-slate-950 border border-slate-700 hover:border-slate-500 text-left flex items-center justify-between text-sm active:scale-98 transition-all"
        >
          {currentAsset ? (
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono font-black text-emerald-400 text-base">
                  #{currentAsset.assetNo}
                </span>
                <span className="font-bold text-slate-200 text-xs">
                  {currentAsset.modelName}
                </span>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5 truncate">
                <span className="truncate">{currentAsset.customerName}</span>
                <span>•</span>
                <span className="truncate">{currentAsset.siteName}</span>
              </div>
            </div>
          ) : (
            <span className="text-slate-500 text-xs">터치하여 입고할 장비를 검색·선택하십시오</span>
          )}
          <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2" />
        </button>

        {/* 입고 일자 */}
        <div className="flex flex-col gap-1 pt-1">
          <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
            입고 일자
          </label>
          <input
            type="date"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* ── 2. 상태 판정 2단 세그먼트 ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
        <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
          외관 및 기능 상태 판정
        </label>
        
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setIsInboundGood(true)}
            className={`py-3 px-3 rounded-xl border font-bold text-xs sm:text-sm flex flex-col items-center justify-center gap-1.5 transition-all ${
              isInboundGood 
                ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/30' 
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className={`w-4 h-4 ${isInboundGood ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span className="whitespace-nowrap flex-shrink-0">정상 입고</span>
            </div>
            <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0">이상 없음 (임대가능 전환)</span>
          </button>

          <button
            type="button"
            onClick={() => setIsInboundGood(false)}
            className={`py-3 px-3 rounded-xl border font-bold text-xs sm:text-sm flex flex-col items-center justify-center gap-1.5 transition-all ${
              !isInboundGood 
                ? 'bg-rose-600/20 border-rose-500 text-rose-300 ring-2 ring-rose-500/30' 
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <AlertTriangle className={`w-4 h-4 ${!isInboundGood ? 'text-rose-400' : 'text-slate-500'}`} />
              <span className="whitespace-nowrap flex-shrink-0">불량 / 정비필요</span>
            </div>
            <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0">정비중 전환 및 티켓 발행</span>
          </button>
        </div>
      </div>

      {/* ── 3. 불량 증상 선택 (정비항목관리 SSOT 연동) ── */}
      {!isInboundGood && (
        <div className="bg-slate-900 border border-rose-500/30 rounded-2xl p-4 flex flex-col gap-3 shadow-xl">
          {/* 점수 요약 & 초기화 헤더 */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-rose-400" />
              <span className="text-xs font-bold text-white whitespace-nowrap flex-shrink-0">
                정비 불량 증상 선택
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800">
                SSOT
              </span>
            </div>
            <div className="flex items-center gap-2">
              {selectedDefects.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearDefects}
                  className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-[11px] flex items-center gap-1 active:scale-95"
                >
                  <RotateCcw className="w-3 h-3" />
                  초기화
                </button>
              )}
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">누적:</span>
                <span className="font-mono font-black text-rose-400 text-sm px-2 py-0.5 rounded bg-rose-950/80 border border-rose-800">
                  +{totalDegradationScore}점
                </span>
              </div>
            </div>
          </div>

          {/* 카테고리 퀵 필터 칩 */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {categories.map(cat => {
              const isActive = selectedCategory === cat;
              // 해당 카테고리에 선택된 항목 수
              const countInCat = selectedDefects.filter(id => {
                const item = availableDefects.find(d => d.id === id);
                return cat === '전체' || item?.category === cat;
              }).length;

              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-rose-600 text-white shadow-md shadow-rose-900/40'
                      : 'bg-slate-950 text-slate-400 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  <span>{cat}</span>
                  {countInCat > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-white text-rose-600 text-[10px] font-black">
                      {countInCat}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 키워드 검색창 */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={defectSearchQuery}
              onChange={(e) => setDefectSearchQuery(e.target.value)}
              placeholder="불량 증상 키워드 검색 (예: 누유, 배터리, 센서, 파손 등)"
              className="w-full py-2 pl-8 pr-3 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-rose-500"
            />
            {defectSearchQuery && (
              <button
                type="button"
                onClick={() => setDefectSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 동적 불량 항목 칩 목록 (SSOT) */}
          <div className="flex flex-wrap gap-2 max-h-[300px] overflow-y-auto pr-0.5">
            {displayedDefects.length === 0 ? (
              <div className="w-full py-6 text-center text-xs text-slate-500">
                검색된 정비 점검 항목이 없습니다.
              </div>
            ) : (
              displayedDefects.map((preset) => {
                const isChecked = selectedDefects.includes(preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleToggleDefect(preset.id)}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium flex items-center gap-2 transition-all whitespace-nowrap flex-shrink-0 active:scale-95 ${
                      isChecked
                        ? 'bg-rose-600/30 border-rose-500 text-white font-bold shadow-md shadow-rose-950 ring-1 ring-rose-500/50'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800/80'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${isChecked ? 'bg-rose-500 text-white' : 'border border-slate-600'}`}>
                      {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                    <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 font-normal">
                      {preset.category}
                    </span>
                    <span>{preset.name}</span>
                    <span className={`text-[11px] font-mono font-bold shrink-0 ${isChecked ? 'text-rose-300' : 'text-slate-500'}`}>
                      +{preset.score}점
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* 기타 불량 증상 직접 입력 */}
          <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800">
            <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
              기타 특이 불량 내용 (자유 텍스트 입력)
            </label>
            <textarea
              value={otherDefectText}
              onChange={(e) => setOtherDefectText(e.target.value)}
              placeholder="점검 항목 외 현장 특이 파손이나 고장 증상을 상세히 입력하십시오."
              rows={2}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-rose-500"
            />
          </div>
        </div>
      )}

      {/* ── 4. 사진 촬영 및 증빙 첨부 ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-lg">
        <CameraUploader
          label="입고 외관 및 결함 증빙 사진"
          images={photos}
          onChange={setPhotos}
          maxImages={4}
          required={!isInboundGood && selectedDefects.length > 0}
        />
      </div>

      {/* ── 5. 입고 비고 메모 ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-1.5 shadow-lg">
        <label className="text-xs font-bold text-slate-300 whitespace-nowrap flex-shrink-0">
          입고 비고
        </label>
        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="운송 기사명, 회수 특이사항 등 메모 입력"
          className="w-full py-2.5 px-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* ── 6. 최종 등록 실행 버튼 ── */}
      <div className="pt-2">
        <button
          type="button"
          disabled={isSubmitting || !selectedAssetId}
          onClick={handleSubmit}
          className={`w-full py-4 px-5 rounded-2xl font-black text-base flex items-center justify-center gap-2 shadow-xl active:scale-98 transition-all ${
            !selectedAssetId
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              : isInboundGood
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
          }`}
        >
          <Check className="w-5 h-5 stroke-[2.5]" />
          <span>
            {isSubmitting 
              ? '입고 저장 처리 중...' 
              : isInboundGood 
                ? '정상 입고 등록 완료 (임대가능 전환)' 
                : `불량 입고 등록 완료 (+${totalDegradationScore}점 정비의뢰 연동)`}
          </span>
        </button>
      </div>

      {/* ── 7. 자산 선택 다크 커스텀 바텀시트 ── */}
      {isAssetSheetOpen && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            animation: 'fadeIn 0.2s ease-out'
          }}
          onClick={() => setIsAssetSheetOpen(false)}
        >
          <div 
            style={{
              backgroundColor: '#0f172a',
              borderTopLeftRadius: '24px',
              borderTopRightRadius: '24px',
              borderTop: '1px solid #334155',
              padding: '20px 16px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.6)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 상단 드래그 바 & 타이틀 */}
            <div className="flex items-center justify-between pb-1 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-white whitespace-nowrap flex-shrink-0">
                  입고 대상 자산 선택
                </span>
                <span className="text-xs font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                  {filteredAssets.length}대
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsAssetSheetOpen(false)}
                className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 검색창 */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={assetSearchQuery}
                onChange={(e) => setAssetSearchQuery(e.target.value)}
                placeholder="관리번호, 모델명, 거래처, 현장 검색"
                className="w-full py-2.5 pl-9 pr-3 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                autoFocus
              />
            </div>

            {/* 자산 목록 */}
            <div className="flex flex-col gap-2 overflow-y-auto max-h-[50vh] pr-0.5">
              {filteredAssets.map((asset) => {
                const isSelected = asset.id === selectedAssetId;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      setSelectedAssetId(asset.id);
                      setIsAssetSheetOpen(false);
                    }}
                    className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all active:scale-98 ${
                      isSelected
                        ? 'bg-emerald-950/50 border-emerald-500 ring-1 ring-emerald-500'
                        : 'bg-slate-950 border-slate-800/80 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-white text-sm">
                          #{asset.assetNo}
                        </span>
                        <span className="text-xs font-bold text-slate-300">
                          {asset.modelName}
                        </span>
                        {asset.isSublease && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-900/80 text-purple-300 border border-purple-700 whitespace-nowrap flex-shrink-0">
                            타사전대
                          </span>
                        )}
                        {asset.isRented ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-900/80 text-sky-300 border border-sky-700 whitespace-nowrap flex-shrink-0">
                            대여중
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 whitespace-nowrap flex-shrink-0">
                            {asset.status}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5 truncate">
                        <Building2 className="w-3 h-3 text-slate-500 flex-shrink-0" />
                        <span className="truncate">{asset.customerName}</span>
                        <span>•</span>
                        <MapPin className="w-3 h-3 text-slate-500 flex-shrink-0" />
                        <span className="truncate">{asset.siteName}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pl-2">
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
