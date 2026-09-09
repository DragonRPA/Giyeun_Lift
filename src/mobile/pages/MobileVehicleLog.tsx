// src/mobile/pages/MobileVehicleLog.tsx
// 전사 임직원 공용 모바일 법인 차량운행일지 및 주유 영수증 촬영 기록 앱

import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { CameraUploader } from '../components/CameraUploader';
import {
  CorporateVehicle,
  VehicleOperationLog,
  VehicleFuelLog,
  OperationPurposeType
} from '../../services/db';
import {
  Car,
  Fuel,
  FileText,
  Calendar,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Eye,
  History,
  X,
  PlusCircle,
  Check,
  Building2,
  MapPin,
  Sparkles,
  Loader2,
  RotateCw
} from 'lucide-react';
import { analyzeOdometerPhoto, analyzeFuelReceiptPhoto } from '../../services/visionOcrService';

interface MobileVehicleLogProps {
  onBack?: () => void;
}

type MobileTab = 'FUEL_LOG' | 'OPERATION_LOG' | 'HISTORY';

const PURPOSE_OPTIONS: { type: OperationPurposeType; label: string }[] = [
  { type: 'BUSINESS_GENERAL',   label: '일반 업무' },
  { type: 'SITE_AS',            label: '현장 AS' },
  { type: 'CLIENT_MEETING',     label: '고객사 미팅' },
  { type: 'COMMUTE',            label: '출퇴근' },
  { type: 'LOGISTICS_DELIVERY', label: '장비 탁송' },
  { type: 'OTHER',              label: '기타' }
];

const FUEL_TYPES = ['경유', '휘발유', 'LPG', '전기'];

export const MobileVehicleLog: React.FC<MobileVehicleLogProps> = ({ onBack }) => {
  const {
    corporateVehicles,
    vehicleOperationLogs,
    vehicleFuelLogs,
    currentUser,
    registerVehicleFuelLog,
    registerVehicleOperationLog,
    loadTablesForMenu,
    refreshAllData,
    showErrorModal
  } = useApp();

  const [activeTab, setActiveTab] = useState<MobileTab>('FUEL_LOG');

  // 모바일 화면 진입 시 최신 법인 차량 및 운행/주유 로그 동기화
  useEffect(() => {
    if (loadTablesForMenu) {
      loadTablesForMenu('vehicle_log');
    }
  }, [loadTablesForMenu]);

  // 가용성 및 본인 배정 우선 정렬된 법인 차량 목록
  const sortedCorporateVehicles = useMemo(() => {
    return [...(corporateVehicles || [])].sort((a, b) => {
      // 1. 로그인 사용자 본인 전담 배정 차량 최우선
      const aMine = a.primaryDriverId && a.primaryDriverId === currentUser?.id ? 1 : 0;
      const bMine = b.primaryDriverId && b.primaryDriverId === currentUser?.id ? 1 : 0;
      if (aMine !== bMine) return bMine - aMine;
      // 2. 가용(Active) 차량 우선
      const aActive = a.isActive !== false ? 1 : 0;
      const bActive = b.isActive !== false ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      // 3. 차량번호 오름차순
      return (a.vehicleNo || '').localeCompare(b.vehicleNo || '');
    });
  }, [corporateVehicles, currentUser]);

  // 운행자 본인 배정 차량 또는 최초 가용 차량 자동 감지 (비동기 지연 로드 방어)
  const defaultVehicleId = useMemo(() => {
    if (sortedCorporateVehicles.length === 0) return '';
    const firstActive = sortedCorporateVehicles.find(v => v.isActive !== false);
    return firstActive?.id || sortedCorporateVehicles[0]?.id || '';
  }, [sortedCorporateVehicles]);

  // ─────────────────────────────────────────────────────────────
  // 1. 주유 기록 폼 상태
  // ─────────────────────────────────────────────────────────────
  const [fuelVehicleId, setFuelVehicleId] = useState<string>(defaultVehicleId);
  const [fuelDate, setFuelDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [fuelType, setFuelType] = useState<string>('경유');
  const [fuelVolumeStr, setFuelVolumeStr] = useState<string>('');
  const [fuelAmountStr, setFuelAmountStr] = useState<string>('');
  const [fuelMileageStr, setFuelMileageStr] = useState<string>('');
  const [gasStationName, setGasStationName] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'CORPORATE_CARD' | 'PERSONAL_EXPENSE'>('CORPORATE_CARD');
  const [fuelMemo, setFuelMemo] = useState<string>('');
  const [receiptPhotos, setReceiptPhotos] = useState<string[]>([]);
  const [dashboardPhotos, setDashboardPhotos] = useState<string[]>([]);
  const [isSubmittingFuel, setIsSubmittingFuel] = useState<boolean>(false);

  // ─────────────────────────────────────────────────────────────
  // 2. 운행일지 폼 상태
  // ─────────────────────────────────────────────────────────────
  const [opVehicleId, setOpVehicleId] = useState<string>(defaultVehicleId);

  const [hasManuallySelectedFuel, setHasManuallySelectedFuel] = useState<boolean>(false);
  const [hasManuallySelectedOp, setHasManuallySelectedOp] = useState<boolean>(false);

  // ─────────────────────────────────────────────────────────────
  // 3. 비동기 로딩 및 신규 차량 등록 시 자동 차량 선택 동기화 (핵심 결함 방어)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (sortedCorporateVehicles.length > 0) {
      // 주유 차량: 수동 미선택이거나 비어있거나 목록에 없으면 기본 차량으로 자동 할당
      if (!hasManuallySelectedFuel || !fuelVehicleId || !sortedCorporateVehicles.some(v => v.id === fuelVehicleId)) {
        setFuelVehicleId(defaultVehicleId);
      }
      // 운행일지 차량: 수동 미선택이거나 비어있거나 목록에 없으면 기본 차량으로 자동 할당
      if (!hasManuallySelectedOp || !opVehicleId || !sortedCorporateVehicles.some(v => v.id === opVehicleId)) {
        setOpVehicleId(defaultVehicleId);
      }
    }
  }, [sortedCorporateVehicles, defaultVehicleId, fuelVehicleId, opVehicleId, hasManuallySelectedFuel, hasManuallySelectedOp]);

  // 선택 차량 변경 시 유종 & 현재거리 자동 동기화
  useEffect(() => {
    const selectedVeh = sortedCorporateVehicles.find(v => v.id === fuelVehicleId);
    if (selectedVeh) {
      if (selectedVeh.fuelType === 'DIESEL') setFuelType('경유');
      else if (selectedVeh.fuelType === 'GASOLINE') setFuelType('휘발유');
      else if (selectedVeh.fuelType === 'LPG') setFuelType('LPG');
      else if (selectedVeh.fuelType === 'ELECTRIC') setFuelType('전기');
      
      if (selectedVeh.currentMileage > 0) {
        setFuelMileageStr(String(selectedVeh.currentMileage));
      }
    }
  }, [fuelVehicleId, sortedCorporateVehicles]);
  const [operationDate, setOperationDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [purposeType, setPurposeType] = useState<OperationPurposeType>('BUSINESS_GENERAL');
  const [purposeDetail, setPurposeDetail] = useState<string>('');
  const [departureLocation, setDepartureLocation] = useState<string>('본사 주기장');
  const [arrivalLocation, setArrivalLocation] = useState<string>('');
  const [startMileageStr, setStartMileageStr] = useState<string>('');
  const [endMileageStr, setEndMileageStr] = useState<string>('');
  const [opMemo, setOpMemo] = useState<string>('');
  const [startDashboardPhotos, setStartDashboardPhotos] = useState<string[]>([]);
  const [endDashboardPhotos, setEndDashboardPhotos] = useState<string[]>([]);
  const [isSubmittingOp, setIsSubmittingOp] = useState<boolean>(false);

  // ─────────────────────────────────────────────────────────────
  // Vision AI 자동 인식 상태 관리
  // ─────────────────────────────────────────────────────────────
  const [isAnalyzingFuelReceipt, setIsAnalyzingFuelReceipt] = useState(false);
  const [isAnalyzingFuelOdo, setIsAnalyzingFuelOdo] = useState(false);
  const [isAnalyzingStartOdo, setIsAnalyzingStartOdo] = useState(false);
  const [isAnalyzingEndOdo, setIsAnalyzingEndOdo] = useState(false);

  const [fuelOdoAiBadge, setFuelOdoAiBadge] = useState<string | null>(null);
  const [fuelReceiptAiBadge, setFuelReceiptAiBadge] = useState<string | null>(null);
  const [startOdoAiBadge, setStartOdoAiBadge] = useState<string | null>(null);
  const [endOdoAiBadge, setEndOdoAiBadge] = useState<string | null>(null);

  // 1-1. 주유 시 계기판 사진 업로드 시 AI 자동인식
  const handleFuelDashboardPhotosChange = async (photos: string[]) => {
    setDashboardPhotos(photos);
    if (photos.length > 0 && photos[0] && !isAnalyzingFuelOdo) {
      setIsAnalyzingFuelOdo(true);
      const selectedVeh = corporateVehicles.find(v => v.id === fuelVehicleId);
      const res = await analyzeOdometerPhoto(photos[0], {
        vehicleNo: selectedVeh?.vehicleNo,
        modelName: selectedVeh?.modelName,
        currentMileage: selectedVeh?.currentMileage
      });
      setIsAnalyzingFuelOdo(false);
      if (res.success && res.mileage) {
        setFuelMileageStr(String(res.mileage));
        setFuelOdoAiBadge(`⚡ AI 계기판 인식: ${res.mileage.toLocaleString()} km`);
        setTimeout(() => setFuelOdoAiBadge(null), 6000);
      }
    }
  };

  // 1-2. 주유 영수증 사진 업로드 시 AI 자동인식
  const handleReceiptPhotosChange = async (photos: string[]) => {
    setReceiptPhotos(photos);
    if (photos.length > 0 && photos[0] && !isAnalyzingFuelReceipt) {
      setIsAnalyzingFuelReceipt(true);
      const selectedVeh = corporateVehicles.find(v => v.id === fuelVehicleId);
      const res = await analyzeFuelReceiptPhoto(photos[0], {
        vehicleNo: selectedVeh?.vehicleNo,
        fuelType
      });
      setIsAnalyzingFuelReceipt(false);
      if (res.success) {
        if (res.fuelAmount) setFuelAmountStr(String(res.fuelAmount));
        if (res.fuelVolume) setFuelVolumeStr(String(res.fuelVolume));
        if (res.gasStationName) setGasStationName(res.gasStationName);
        if (res.fuelType) setFuelType(res.fuelType);
        if (res.paymentMethod) setPaymentMethod(res.paymentMethod);
        if (res.fuelDate) setFuelDate(res.fuelDate);
        setFuelReceiptAiBadge(`⚡ AI 영수증 인식 완료 (${res.gasStationName || '주유소'}, ₩${res.fuelAmount?.toLocaleString() || ''})`);
        setTimeout(() => setFuelReceiptAiBadge(null), 6000);
      }
    }
  };

  // 2-1. 운행일지 출발 계기판 사진 업로드 시 AI 자동인식
  const handleStartDashboardPhotosChange = async (photos: string[]) => {
    setStartDashboardPhotos(photos);
    if (photos.length > 0 && photos[0] && !isAnalyzingStartOdo) {
      setIsAnalyzingStartOdo(true);
      const selectedVeh = corporateVehicles.find(v => v.id === opVehicleId);
      const res = await analyzeOdometerPhoto(photos[0], {
        vehicleNo: selectedVeh?.vehicleNo,
        modelName: selectedVeh?.modelName,
        currentMileage: selectedVeh?.currentMileage
      });
      setIsAnalyzingStartOdo(false);
      if (res.success && res.mileage) {
        setStartMileageStr(String(res.mileage));
        setStartOdoAiBadge(`⚡ AI 출발 계기판 인식: ${res.mileage.toLocaleString()} km`);
        setTimeout(() => setStartOdoAiBadge(null), 6000);
      }
    }
  };

  // 2-2. 운행일지 도착 계기판 사진 업로드 시 AI 자동인식
  const handleEndDashboardPhotosChange = async (photos: string[]) => {
    setEndDashboardPhotos(photos);
    if (photos.length > 0 && photos[0] && !isAnalyzingEndOdo) {
      setIsAnalyzingEndOdo(true);
      const selectedVeh = corporateVehicles.find(v => v.id === opVehicleId);
      const res = await analyzeOdometerPhoto(photos[0], {
        vehicleNo: selectedVeh?.vehicleNo,
        modelName: selectedVeh?.modelName,
        currentMileage: Number(startMileageStr) || selectedVeh?.currentMileage
      });
      setIsAnalyzingEndOdo(false);
      if (res.success && res.mileage) {
        setEndMileageStr(String(res.mileage));
        setEndOdoAiBadge(`⚡ AI 도착 계기판 인식: ${res.mileage.toLocaleString()} km`);
        setTimeout(() => setEndOdoAiBadge(null), 6000);
      }
    }
  };

  // 운행일지 차량 변경 시 출발거리 자동 입력
  useEffect(() => {
    const selectedVeh = sortedCorporateVehicles.find(v => v.id === opVehicleId);
    if (selectedVeh && selectedVeh.currentMileage > 0) {
      setStartMileageStr(String(selectedVeh.currentMileage));
    }
  }, [opVehicleId, sortedCorporateVehicles]);

  // 주행거리 자동 계산
  const calculatedDriveDistance = useMemo(() => {
    const start = Number(startMileageStr) || 0;
    const end = Number(endMileageStr) || 0;
    if (end > start) return end - start;
    return 0;
  }, [startMileageStr, endMileageStr]);

  // 사진 확대 모달
  const [photoViewerUrl, setPhotoViewerUrl] = useState<string | null>(null);

  // 등록 완료 팝업 안내
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3000);
  };

  // ─────────────────────────────────────────────────────────────
  // 3. 주유 기록 제출
  // ─────────────────────────────────────────────────────────────
  const handleSaveFuel = async (e: React.FormEvent) => {
    e.preventDefault();
    const volume = Number(fuelVolumeStr);
    const amount = Number(fuelAmountStr);
    const mileage = Number(fuelMileageStr);

    if (!fuelVehicleId || !sortedCorporateVehicles.some(v => v.id === fuelVehicleId)) {
      showErrorModal('주유할 법인 차량을 목록에서 선택해 주십시오.');
      return;
    }
    if (!volume || volume <= 0) {
      showErrorModal('주유량(리터)을 입력해 주십시오.');
      return;
    }
    if (!amount || amount <= 0) {
      showErrorModal('주유금액을 입력해 주십시오.');
      return;
    }
    if (!mileage || mileage <= 0) {
      showErrorModal('주유 시점의 계기판 주행거리(km)를 입력해 주십시오.');
      return;
    }
    if (receiptPhotos.length === 0) {
      showErrorModal('주유 영수증 사진은 국세청 세무 증빙을 위해 반드시 촬영·첨부해야 합니다.');
      return;
    }

    const selectedVeh = sortedCorporateVehicles.find(v => v.id === fuelVehicleId);
    const vehicleNo = selectedVeh ? selectedVeh.vehicleNo : '법인차량';

    setIsSubmittingFuel(true);
    try {
      await registerVehicleFuelLog({
        vehicleId: fuelVehicleId,
        vehicleNo,
        driverId: currentUser?.id || 'usr-driver',
        driverName: currentUser?.name || '운행자',
        fuelDate,
        fuelType,
        fuelVolume: volume,
        fuelAmount: amount,
        fuelUnitPrice: Math.round(amount / volume),
        currentMileage: mileage,
        receiptPhotoUrl: receiptPhotos[0],
        dashboardPhotoUrl: dashboardPhotos.length > 0 ? dashboardPhotos[0] : undefined,
        gasStationName: gasStationName.trim() || undefined,
        paymentMethod,
        memo: fuelMemo.trim() || undefined
      });

      showToast(`⛽ ${vehicleNo} 주유 기록(${volume}L / ₩${amount.toLocaleString()})이 정상 저장되었습니다.`);
      // 폼 초기화
      setFuelVolumeStr('');
      setFuelAmountStr('');
      setReceiptPhotos([]);
      setDashboardPhotos([]);
      setFuelMemo('');
      // 내역 탭으로 전환
      setActiveTab('HISTORY');
    } catch (err: any) {
      showErrorModal(err?.message || '주유 기록 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSubmittingFuel(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 4. 운행일지 제출
  // ─────────────────────────────────────────────────────────────
  const handleSaveOperation = async (e: React.FormEvent) => {
    e.preventDefault();
    const startMileage = Number(startMileageStr);
    const endMileage = Number(endMileageStr);

    if (!opVehicleId || !sortedCorporateVehicles.some(v => v.id === opVehicleId)) {
      showErrorModal('운행할 법인 차량을 목록에서 선택해 주십시오.');
      return;
    }
    if (!departureLocation.trim() || !arrivalLocation.trim()) {
      showErrorModal('출발지와 도착지를 모두 입력해 주십시오.');
      return;
    }
    if (!startMileage || startMileage <= 0) {
      showErrorModal('출발 시 계기판 거리를 입력해 주십시오.');
      return;
    }
    if (!endMileage || endMileage <= 0) {
      showErrorModal('도착 시 계기판 거리를 입력해 주십시오.');
      return;
    }
    if (endMileage <= startMileage) {
      showErrorModal('도착 시 계기판 거리가 출발 시 거리보다 커야 합니다.');
      return;
    }

    const selectedVeh = sortedCorporateVehicles.find(v => v.id === opVehicleId);
    const vehicleNo = selectedVeh ? selectedVeh.vehicleNo : '법인차량';
    const driveDistance = endMileage - startMileage;
    const isCommute = purposeType === 'COMMUTE';

    setIsSubmittingOp(true);
    try {
      await registerVehicleOperationLog({
        vehicleId: opVehicleId,
        vehicleNo,
        driverId: currentUser?.id || 'usr-driver',
        driverName: currentUser?.name || '운행자',
        driverDept: currentUser?.department || '현장운행',
        operationDate,
        purposeType,
        purposeDetail: purposeDetail.trim() || undefined,
        departureLocation: departureLocation.trim(),
        arrivalLocation: arrivalLocation.trim(),
        departureMileage: startMileage,
        arrivalMileage: endMileage,
        driveDistance,
        businessDistance: isCommute ? 0 : driveDistance,
        commuteDistance: isCommute ? driveDistance : 0,
        dashboardPhotoStart: startDashboardPhotos.length > 0 ? startDashboardPhotos[0] : undefined,
        dashboardPhotoEnd: endDashboardPhotos.length > 0 ? endDashboardPhotos[0] : undefined,
        memo: opMemo.trim() || undefined,
        status: 'SUBMITTED'
      });

      showToast(`🚗 ${vehicleNo} 운행일지(${driveDistance} km)가 정상 등록되었습니다.`);
      setArrivalLocation('');
      setEndMileageStr('');
      setPurposeDetail('');
      setStartDashboardPhotos([]);
      setEndDashboardPhotos([]);
      setOpMemo('');
      setActiveTab('HISTORY');
    } catch (err: any) {
      showErrorModal(err?.message || '운행일지 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSubmittingOp(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 5. 내 최근 이력 데이터
  // ─────────────────────────────────────────────────────────────
  const myRecentFuels = useMemo(() => {
    return (vehicleFuelLogs || [])
      .filter(f => !currentUser || f.driverId === currentUser.id || f.vehicleId === defaultVehicleId)
      .sort((a, b) => b.fuelDate.localeCompare(a.fuelDate))
      .slice(0, 10);
  }, [vehicleFuelLogs, currentUser, defaultVehicleId]);

  const myRecentOperations = useMemo(() => {
    return (vehicleOperationLogs || [])
      .filter(o => !currentUser || o.driverId === currentUser.id || o.vehicleId === defaultVehicleId)
      .sort((a, b) => b.operationDate.localeCompare(a.operationDate))
      .slice(0, 10);
  }, [vehicleOperationLogs, currentUser, defaultVehicleId]);

  return (
    <div className="flex flex-col gap-3 pb-24 text-slate-100 min-h-screen">
      {/* ── 토스트 메시지 ── */}
      {successToast && (
        <div className="fixed top-16 left-4 right-4 z-50 bg-emerald-600 text-white text-xs font-bold px-4 py-3 rounded-lg shadow-xl flex items-center gap-2 animate-bounce">
          <CheckCircle2 size={16} />
          <span>{successToast}</span>
        </div>
      )}

      {/* ── 1. 페이지 헤더 ── */}
      <div className="flex items-center justify-between bg-slate-900/90 backdrop-blur p-3.5 rounded-xl border border-slate-800 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-amber-500/20 text-amber-400 rounded-lg">
            <Car size={20} />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-slate-100 flex items-center gap-1.5">
              <span>법인차량 주유기록</span>
            </h1>
            <p className="text-[11px] text-slate-400">
              계기판 및 주유영수증 촬영 ➔ 주유 대장 자동 집계
            </p>
          </div>
        </div>
      </div>

      {/* ── 2. 모바일 상단 탭 (운행일지 작성은 임직원 업무저항 검토 중으로 임시 숨김) ── */}
      <div className="grid grid-cols-2 gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
        <button
          type="button"
          onClick={() => setActiveTab('FUEL_LOG')}
          className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'FUEL_LOG'
              ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Fuel size={14} />
          <span>주유 영수증</span>
        </button>

        {/* 운행일지 작성 탭: 임직원 업무저항 검토 중으로 임시 숨김 */}
        {false && (
          <button
            type="button"
            onClick={() => setActiveTab('OPERATION_LOG')}
            className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'OPERATION_LOG'
                ? 'bg-blue-600 text-white shadow-md font-extrabold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText size={14} />
            <span>운행일지 작성</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('HISTORY')}
          className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-lg transition-all ${
            activeTab === 'HISTORY'
              ? 'bg-slate-700 text-amber-400 shadow-md font-extrabold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <History size={14} />
          <span>내 주유 내역</span>
        </button>
      </div>

      {/* ── 3-1. 탭 1: 주유 영수증 기록 ── */}
      {activeTab === 'FUEL_LOG' && (
        <form onSubmit={handleSaveFuel} className="flex flex-col gap-3.5 bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-lg">
          <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <Fuel size={15} />
              <span>주유 시점 실시간 입력 (영수증 촬영 필수)</span>
            </span>
            <span className="text-[11px] text-slate-500">
              운행자: {currentUser?.name || '기본'}
            </span>
          </div>

          {/* 차량 선택 */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300">운행 차량 선택 *</label>
              <button
                type="button"
                onClick={async () => {
                  setHasManuallySelectedFuel(false);
                  if (loadTablesForMenu) await loadTablesForMenu('vehicle_log');
                  else refreshAllData();
                }}
                className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
                title="차량 목록 갱신"
              >
                <RotateCw size={11} />
                <span>목록 갱신</span>
              </button>
            </div>
            <select
              value={fuelVehicleId}
              onChange={e => {
                setFuelVehicleId(e.target.value);
                setHasManuallySelectedFuel(true);
              }}
              className="bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-500 font-semibold"
            >
              {sortedCorporateVehicles.length === 0 ? (
                <option value="">등록된 법인 차량이 없습니다</option>
              ) : (
                <>
                  {!fuelVehicleId && (
                    <option value="" disabled>
                      -- 차량을 선택해 주십시오 --
                    </option>
                  )}
                  {sortedCorporateVehicles.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.vehicleNo} - {v.modelName} ({v.assignedDepartment}) {!v.isActive ? '[휴차]' : ''} {v.primaryDriverId === currentUser?.id ? '★내 배정차량' : ''}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          {/* 유종 원터치 칩 선택 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-300">유종 선택</label>
            <div className="grid grid-cols-4 gap-1.5">
              {FUEL_TYPES.map(type => (
                <button
                  type="button"
                  key={type}
                  onClick={() => setFuelType(type)}
                  className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                    fuelType === type
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* 주유 시점 계기판 주행거리 (km) */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
              <span>계기판 주행거리 (km) *</span>
              {isAnalyzingFuelOdo ? (
                <span className="text-[11px] text-amber-400 flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" />
                  <span>AI 계기판 판독 중...</span>
                </span>
              ) : fuelOdoAiBadge ? (
                <span className="text-[11px] text-emerald-400 font-bold flex items-center gap-1">
                  <Sparkles size={12} />
                  <span>{fuelOdoAiBadge}</span>
                </span>
              ) : (
                <span className="text-[11px] text-amber-400 font-normal">현재 계기판 숫자 기입</span>
              )}
            </label>
            <input
              type="number"
              placeholder="예: 28450"
              value={fuelMileageStr}
              onChange={e => setFuelMileageStr(e.target.value)}
              required
              className="bg-slate-800 border border-slate-700 text-slate-100 text-base font-bold rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* 계기판 사진 촬영 (카메라/갤러리) */}
          <CameraUploader
            label="계기판 사진 (주유 시점 - 촬영 시 자동 판독)"
            images={dashboardPhotos}
            onChange={handleFuelDashboardPhotosChange}
            maxImages={1}
          />

          {/* 주유량(L) & 주유금액(원) 2열 배치 */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300">주유용량 (리터 L) *</label>
              <input
                type="number"
                step="0.01"
                placeholder="예: 55.4"
                value={fuelVolumeStr}
                onChange={e => setFuelVolumeStr(e.target.value)}
                required
                className="bg-slate-800 border border-slate-700 text-slate-100 text-base font-bold rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300">주유금액 (원 ₩) *</label>
              <input
                type="number"
                placeholder="예: 85000"
                value={fuelAmountStr}
                onChange={e => setFuelAmountStr(e.target.value)}
                required
                className="bg-slate-800 border border-slate-700 text-slate-100 text-base font-bold rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* 주유 영수증 사진 촬영 (필수) */}
          <div className="p-3 bg-slate-950/60 rounded-xl border border-amber-500/30 flex flex-col gap-2">
            <CameraUploader
              label="주유 영수증 사진 (국세청 필수 증빙 - 촬영 시 7대 항목 자동 채움)"
              images={receiptPhotos}
              onChange={handleReceiptPhotosChange}
              maxImages={1}
              required
            />
            {isAnalyzingFuelReceipt && (
              <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-2 text-xs text-amber-300 animate-pulse">
                <Loader2 size={14} className="animate-spin" />
                <span>AI가 주유 영수증 7대 항목(상호, 금액, 유종 등)을 자동 판독하고 있습니다...</span>
              </div>
            )}
            {fuelReceiptAiBadge && (
              <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2 text-xs text-emerald-300 font-bold">
                <Sparkles size={14} />
                <span>{fuelReceiptAiBadge}</span>
              </div>
            )}
          </div>

          {/* 주유소 상호 & 결제방식 */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300">주유소 상호</label>
              <input
                type="text"
                placeholder="예: SK 서해로주유소"
                value={gasStationName}
                onChange={e => setGasStationName(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300">결제 수단</label>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value as any)}
                className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-500"
              >
                <option value="CORPORATE_CARD">법인카드</option>
                <option value="PERSONAL_EXPENSE">개인경비 후청구</option>
              </select>
            </div>
          </div>

          {/* 특이사항 메모 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-300">비고 / 주유 메모</label>
            <input
              type="text"
              placeholder="예: 출장 전 만땅 주유, 요소수 함께 구매 등"
              value={fuelMemo}
              onChange={e => setFuelMemo(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* 하단 52px 대형 원터치 저장 버튼 */}
          <button
            type="submit"
            disabled={isSubmittingFuel}
            className="mt-2 w-full h-[52px] bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-base rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <Fuel size={20} />
            <span>{isSubmittingFuel ? '저장 처리중...' : '주유 영수증 및 기록 저장 완료'}</span>
          </button>
        </form>
      )}

      {/* ── 3-2. 탭 2: 운행일지 작성 ── */}
      {activeTab === 'OPERATION_LOG' && (
        <form onSubmit={handleSaveOperation} className="flex flex-col gap-3.5 bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-lg">
          <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
              <FileText size={15} />
              <span>국세청 법정 운행기록 작성</span>
            </span>
            <span className="text-[11px] text-slate-500">
              운행자: {currentUser?.name || '기본'}
            </span>
          </div>

          {/* 차량 선택 */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300">운행 차량 *</label>
              <button
                type="button"
                onClick={async () => {
                  setHasManuallySelectedOp(false);
                  if (loadTablesForMenu) await loadTablesForMenu('vehicle_log');
                  else refreshAllData();
                }}
                className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold"
                title="차량 목록 갱신"
              >
                <RotateCw size={11} />
                <span>목록 갱신</span>
              </button>
            </div>
            <select
              value={opVehicleId}
              onChange={e => {
                setOpVehicleId(e.target.value);
                setHasManuallySelectedOp(true);
              }}
              className="bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 font-semibold"
            >
              {sortedCorporateVehicles.length === 0 ? (
                <option value="">등록된 법인 차량이 없습니다</option>
              ) : (
                <>
                  {!opVehicleId && (
                    <option value="" disabled>
                      -- 차량을 선택해 주십시오 --
                    </option>
                  )}
                  {sortedCorporateVehicles.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.vehicleNo} - {v.modelName} ({v.assignedDepartment}) {!v.isActive ? '[휴차]' : ''} {v.primaryDriverId === currentUser?.id ? '★내 배정차량' : ''}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          {/* 운행 목적 칩 선택 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-300">운행 목적 *</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PURPOSE_OPTIONS.map(opt => (
                <button
                  type="button"
                  key={opt.type}
                  onClick={() => setPurposeType(opt.type)}
                  className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                    purposeType === opt.type
                      ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 목적 상세 (고객사명 / 현장명 / 용건) */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-300">목적 상세 / 현장명</label>
            <input
              type="text"
              placeholder="예: 시흥 배곧 2차 현장 수리, 삼성 고덕 계약 미팅"
              value={purposeDetail}
              onChange={e => setPurposeDetail(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* 출발지 ➔ 도착지 2열 */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300">출발지 *</label>
              <input
                type="text"
                placeholder="예: 본사 주기장"
                value={departureLocation}
                onChange={e => setDepartureLocation(e.target.value)}
                required
                className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 font-semibold"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300">도착지 *</label>
              <input
                type="text"
                placeholder="예: 평택 고덕 현장"
                value={arrivalLocation}
                onChange={e => setArrivalLocation(e.target.value)}
                required
                className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500 font-semibold"
              />
            </div>
          </div>

          {/* 출발 계기판 & 도착 계기판 (km) */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                <span>출발 시 계기판(km) *</span>
                {isAnalyzingStartOdo ? (
                  <span className="text-[10px] text-blue-400 flex items-center gap-1">
                    <Loader2 size={11} className="animate-spin" />
                    <span>판독 중...</span>
                  </span>
                ) : startOdoAiBadge ? (
                  <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                    <Sparkles size={11} />
                    <span>AI완료</span>
                  </span>
                ) : null}
              </label>
              <input
                type="number"
                placeholder="예: 28350"
                value={startMileageStr}
                onChange={e => setStartMileageStr(e.target.value)}
                required
                className="bg-slate-800 border border-slate-700 text-slate-100 text-sm font-bold rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-300 flex items-center justify-between">
                <span>도착 시 계기판(km) *</span>
                {isAnalyzingEndOdo ? (
                  <span className="text-[10px] text-blue-400 flex items-center gap-1">
                    <Loader2 size={11} className="animate-spin" />
                    <span>판독 중...</span>
                  </span>
                ) : endOdoAiBadge ? (
                  <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                    <Sparkles size={11} />
                    <span>AI완료</span>
                  </span>
                ) : null}
              </label>
              <input
                type="number"
                placeholder="예: 28450"
                value={endMileageStr}
                onChange={e => setEndMileageStr(e.target.value)}
                required
                className="bg-slate-800 border border-slate-700 text-slate-100 text-sm font-bold rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* 주행거리 자동 산출 배지 */}
          <div className="p-3 bg-blue-950/40 rounded-xl border border-blue-500/30 flex items-center justify-between">
            <span className="text-xs font-bold text-blue-300">주행거리 자동 계산:</span>
            <span className="text-lg font-black text-blue-400">
              {calculatedDriveDistance.toLocaleString()} km
            </span>
          </div>

          {/* 출발 & 도착 계기판 사진 촬영 (선택 - 촬영 시 자동 판독) */}
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2.5">
              <CameraUploader
                label="출발 계기판 (촬영 시 자동판독)"
                images={startDashboardPhotos}
                onChange={handleStartDashboardPhotosChange}
                maxImages={1}
              />
              <CameraUploader
                label="도착 계기판 (촬영 시 자동판독)"
                images={endDashboardPhotos}
                onChange={handleEndDashboardPhotosChange}
                maxImages={1}
              />
            </div>
            {(isAnalyzingStartOdo || isAnalyzingEndOdo) && (
              <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center gap-2 text-xs text-blue-300 animate-pulse">
                <Loader2 size={14} className="animate-spin" />
                <span>{isAnalyzingStartOdo ? '출발 계기판 ODO 주행거리를 분석하고 있습니다...' : '도착 계기판 ODO 주행거리를 분석하고 있습니다...'}</span>
              </div>
            )}
            {(startOdoAiBadge || endOdoAiBadge) && (
              <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2 text-xs text-emerald-300 font-bold">
                <Sparkles size={14} />
                <span>{startOdoAiBadge || endOdoAiBadge}</span>
              </div>
            )}
          </div>

          {/* 메모 */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-300">운행 메모</label>
            <input
              type="text"
              placeholder="특이사항 또는 통행료/주차비 메모"
              value={opMemo}
              onChange={e => setOpMemo(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* 52px 등록 완료 버튼 */}
          <button
            type="submit"
            disabled={isSubmittingOp}
            className="mt-2 w-full h-[52px] bg-blue-600 hover:bg-blue-500 text-white font-black text-base rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <CheckCircle2 size={20} />
            <span>{isSubmittingOp ? '등록 처리중...' : '차량 운행일지 등록 완료'}</span>
          </button>
        </form>
      )}

      {/* ── 3-3. 탭 3: 내 운행 / 주유 이력 ── */}
      {activeTab === 'HISTORY' && (
        <div className="flex flex-col gap-4">
          {/* 최근 주유 영수증 기록 섹션 */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
                <Fuel size={14} />
                <span>최근 주유 영수증 내역 ({myRecentFuels.length}건)</span>
              </span>
            </div>

            {myRecentFuels.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 p-8 text-center text-slate-500 text-xs rounded-xl">
                최근 등록된 주유 영수증 기록이 없습니다.
              </div>
            ) : (
              myRecentFuels.map(f => (
                <div key={f.id} className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl flex flex-col gap-2 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-amber-400">{f.vehicleNo}</span>
                    <span className="text-[11px] text-slate-400">{f.fuelDate}</span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">
                      {f.fuelType} {f.fuelVolume.toFixed(1)} L (₩{f.fuelAmount.toLocaleString()})
                    </span>
                    <span className="font-bold text-emerald-400">
                      계기판: {f.currentMileage.toLocaleString()} km
                    </span>
                  </div>

                  {/* 사진 확인 썸네일 */}
                  <div className="flex gap-2 pt-1 border-t border-slate-800/80 items-center justify-between">
                    <span className="text-[11px] text-slate-400">
                      {f.gasStationName || '주유소 상호 미기재'}
                    </span>
                    <div className="flex gap-1.5">
                      {f.receiptPhotoUrl && (
                        <button
                          type="button"
                          onClick={() => setPhotoViewerUrl(f.receiptPhotoUrl)}
                          className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-[11px] font-bold rounded flex items-center gap-1"
                        >
                          <Eye size={12} />
                          <span>영수증 보기</span>
                        </button>
                      )}
                      {f.dashboardPhotoUrl && (
                        <button
                          type="button"
                          onClick={() => setPhotoViewerUrl(f.dashboardPhotoUrl!)}
                          className="px-2 py-1 bg-blue-500/20 text-blue-400 text-[11px] font-bold rounded flex items-center gap-1"
                        >
                          <Eye size={12} />
                          <span>계기판 보기</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 최근 운행일지 기록 섹션 (임직원 업무저항 검토 중: 임시 숨김) */}
          {false && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-blue-400 flex items-center gap-1">
                  <FileText size={14} />
                  <span>최근 운행일지 내역 ({myRecentOperations.length}건)</span>
                </span>
              </div>

              {myRecentOperations.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 p-8 text-center text-slate-500 text-xs rounded-xl">
                  최근 등록된 운행일지 기록이 없습니다.
                </div>
              ) : (
                myRecentOperations.map(op => (
                  <div key={op.id} className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl flex flex-col gap-2 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-extrabold text-blue-400">{op.vehicleNo}</span>
                        <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] font-bold rounded">
                          {op.purposeType === 'SITE_AS' ? '현장AS' : op.purposeType === 'CLIENT_MEETING' ? '미팅' : '일반'}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400">{op.operationDate}</span>
                    </div>

                    <div className="text-xs text-slate-200 font-medium">
                      {op.departureLocation} ➔ {op.arrivalLocation}
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
                      <span className="text-slate-400">
                        {op.departureMileage.toLocaleString()} ➔ {op.arrivalMileage.toLocaleString()} km
                      </span>
                      <span className="font-extrabold text-amber-400">
                        {op.driveDistance} km 주행
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 4. 전체화면 사진 확인 팝업 ── */}
      {photoViewerUrl && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-3"
          onClick={() => setPhotoViewerUrl(null)}
        >
          <button
            type="button"
            onClick={() => setPhotoViewerUrl(null)}
            className="absolute top-4 right-4 p-2 bg-slate-800 text-white rounded-full shadow-lg"
          >
            <X size={24} />
          </button>
          <img
            src={photoViewerUrl}
            alt="증빙 사진"
            className="max-w-full max-h-[85vh] object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
