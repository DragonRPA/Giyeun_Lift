// src/pages/VehicleOperationLogPage.tsx
// 관리부 법인 차량운행일지 및 주유 영수증 감사 대사 총괄 마스터 스튜디오

import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  CorporateVehicle,
  VehicleOperationLog,
  VehicleFuelLog,
  CorporateVehicleType,
  CorporateVehicleOwnership,
  CorporateVehicleFuelType,
  OperationPurposeType
} from '../services/db';
import {
  Car,
  Fuel,
  FileText,
  Calendar,
  Plus,
  Search,
  Download,
  Trash2,
  Edit2,
  CheckCircle,
  Clock,
  Eye,
  AlertTriangle,
  ShieldCheck,
  X,
  RotateCw,
  Building2,
  User as UserIcon,
  Check,
  ChevronDown
} from 'lucide-react';
import * as XLSX from 'xlsx';

// 탭 정의 (헌장 3.1: 무수식어 건조 명사 표준)
type PageTab = 'OPERATION_LOG' | 'FUEL_LOG' | 'FLEET_MASTER';

const PURPOSE_MAP: Record<OperationPurposeType, { label: string; bg: string; text: string }> = {
  BUSINESS_GENERAL:   { label: '일반업무', bg: 'rgba(2, 132, 199, 0.15)', text: '#0284c7' },
  SITE_AS:            { label: '현장AS',   bg: 'rgba(234, 88, 12, 0.15)', text: '#ea580c' },
  CLIENT_MEETING:     { label: '고객미팅', bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981' },
  COMMUTE:            { label: '출퇴근',   bg: 'rgba(168, 85, 247, 0.15)', text: '#a855f7' },
  LOGISTICS_DELIVERY: { label: '탁송배차', bg: 'rgba(249, 115, 22, 0.15)', text: '#f97316' },
  OTHER:              { label: '기타',     bg: 'rgba(148, 163, 184, 0.15)', text: 'var(--text-secondary)' }
};

export const VehicleOperationLogPage: React.FC = () => {
  const {
    corporateVehicles,
    vehicleOperationLogs,
    vehicleFuelLogs,
    users,
    registerCorporateVehicle,
    updateCorporateVehicle,
    deleteCorporateVehicle,
    updateVehicleOperationLog,
    deleteVehicleOperationLog,
    deleteVehicleFuelLog,
    showErrorModal
  } = useApp();

  // 현재 활성 탭 (운행일지 대장 임시 비활성화 -> 주유 영수증 대장이 기본 탭)
  const [activeTab, setActiveTab] = useState<PageTab>('FUEL_LOG');

  // 검색/필터 상태
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [selectedYm, setSelectedYm] = useState<string>(currentYm);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('ALL');
  const [driverSearch, setDriverSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // 사진 확대 모달 상태
  const [photoModal, setPhotoModal] = useState<{ isOpen: boolean; title: string; url: string } | null>(null);

  // 차량 등록/수정 모달 상태
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<CorporateVehicle | null>(null);
  const [vehicleForm, setVehicleForm] = useState({
    vehicleNo: '',
    modelName: '',
    vehicleType: '승합차' as CorporateVehicleType,
    ownershipType: 'OWNED' as CorporateVehicleOwnership,
    fuelType: 'DIESEL' as CorporateVehicleFuelType,
    assignedDepartment: '관리부',
    primaryDriverId: '',
    primaryDriverName: '',
    initialMileage: 0,
    currentMileage: 0,
    insuranceExpiryDate: '',
    inspectionExpiryDate: '',
    isActive: true,
    memo: ''
  });

  // 삭제 확인 모달
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    type: 'VEHICLE' | 'OPERATION_LOG' | 'FUEL_LOG';
    id: string;
    title: string;
    message: string;
  } | null>(null);

  // 1. 운행일지 필터링
  const filteredOperationLogs = useMemo(() => {
    return (vehicleOperationLogs || []).filter(log => {
      if (selectedYm && !log.operationDate.startsWith(selectedYm)) return false;
      if (selectedVehicleId !== 'ALL' && log.vehicleId !== selectedVehicleId) return false;
      if (statusFilter !== 'ALL' && log.status !== statusFilter) return false;
      if (driverSearch) {
        const query = driverSearch.trim().toLowerCase();
        const dName = (log.driverName || '').toLowerCase();
        const vNo = (log.vehicleNo || '').toLowerCase();
        const pDet = (log.purposeDetail || '').toLowerCase();
        if (!dName.includes(query) && !vNo.includes(query) && !pDet.includes(query)) {
          return false;
        }
      }
      return true;
    }).sort((a, b) => b.operationDate.localeCompare(a.operationDate));
  }, [vehicleOperationLogs, selectedYm, selectedVehicleId, statusFilter, driverSearch]);

  // 2. 주유 영수증 필터링
  const filteredFuelLogs = useMemo(() => {
    return (vehicleFuelLogs || []).filter(fuel => {
      if (selectedYm && !fuel.fuelDate.startsWith(selectedYm)) return false;
      if (selectedVehicleId !== 'ALL' && fuel.vehicleId !== selectedVehicleId) return false;
      if (driverSearch) {
        const query = driverSearch.trim().toLowerCase();
        const dName = (fuel.driverName || '').toLowerCase();
        const vNo = (fuel.vehicleNo || '').toLowerCase();
        const gName = (fuel.gasStationName || '').toLowerCase();
        if (!dName.includes(query) && !vNo.includes(query) && !gName.includes(query)) {
          return false;
        }
      }
      return true;
    }).sort((a, b) => b.fuelDate.localeCompare(a.fuelDate));
  }, [vehicleFuelLogs, selectedYm, selectedVehicleId, driverSearch]);

  // 운행일지 대차대조 집계 수식 (헌장 3.5 Gutenberg Z-Pattern)
  const operationMetrics = useMemo(() => {
    const totalCount = filteredOperationLogs.length;
    const totalDistance = filteredOperationLogs.reduce((acc, cur) => acc + (cur.driveDistance || 0), 0);
    const businessDistance = filteredOperationLogs.reduce((acc, cur) => acc + (cur.businessDistance || 0), 0);
    const commuteDistance = filteredOperationLogs.reduce((acc, cur) => acc + (cur.commuteDistance || 0), 0);
    const businessRatio = totalDistance > 0 ? ((businessDistance / totalDistance) * 100).toFixed(1) : '0.0';
    return { totalCount, totalDistance, businessDistance, commuteDistance, businessRatio };
  }, [filteredOperationLogs]);

  // 주유일지 대차대조 집계 수식
  const fuelMetrics = useMemo(() => {
    const totalCount = filteredFuelLogs.length;
    const totalVolume = filteredFuelLogs.reduce((acc, cur) => acc + (cur.fuelVolume || 0), 0);
    const totalAmount = filteredFuelLogs.reduce((acc, cur) => acc + (cur.fuelAmount || 0), 0);
    const receiptProofCount = filteredFuelLogs.filter(f => !!f.receiptPhotoUrl).length;
    const proofRatio = totalCount > 0 ? ((receiptProofCount / totalCount) * 100).toFixed(1) : '100.0';
    return { totalCount, totalVolume, totalAmount, receiptProofCount, proofRatio };
  }, [filteredFuelLogs]);

  // 국세청 법인세법 별지 제29호의2 서식 [업무용승용차 운행기록부] 엑셀 다운로드
  const handleExportNtsExcel = () => {
    try {
      const selectedVehicle = corporateVehicles.find(v => v.id === selectedVehicleId);

      // 국세청 법정 양식 데이터 조립
      const ntsRows = [];

      // 1. 헤더 안내부
      ntsRows.push({ A: '【별지 제29호의2 서식】 업무용승용차 운행기록부' });
      ntsRows.push({ A: `과세연월: ${selectedYm || '전체기간'}`, B: '', C: `차량번호: ${selectedVehicle ? selectedVehicle.vehicleNo : '전체'}`, D: '', E: `차종: ${selectedVehicle ? selectedVehicle.modelName : '전체'}` });
      ntsRows.push({
        A: '①사용일자',
        B: '②사용자 부서',
        C: '③사용자 성명',
        D: '④출발지',
        E: '⑤도착지',
        F: '⑥주행 전 계기판(km)',
        G: '⑦주행 후 계기판(km)',
        H: '⑧총 주행거리(km)',
        I: '⑨출퇴근용(km)',
        J: '⑩일반업무용(km)',
        K: '⑪업무용 사용거리(km)',
        L: '⑫운행목적/비고'
      });

      // 2. 레코드 데이터
      filteredOperationLogs.forEach(log => {
        ntsRows.push({
          A: log.operationDate,
          B: log.driverDept || '관리부',
          C: log.driverName,
          D: log.departureLocation,
          E: log.arrivalLocation,
          F: log.departureMileage,
          G: log.arrivalMileage,
          H: log.driveDistance,
          I: log.commuteDistance || 0,
          J: log.businessDistance || 0,
          K: (log.commuteDistance || 0) + (log.businessDistance || 0),
          L: `${PURPOSE_MAP[log.purposeType]?.label || ''} ${log.purposeDetail || ''}`.trim()
        });
      });

      // 3. 국세청 합계 대차대조
      ntsRows.push({});
      ntsRows.push({
        A: '【합계】',
        B: '',
        C: '',
        D: '',
        E: '',
        F: '',
        G: '총계',
        H: operationMetrics.totalDistance,
        I: operationMetrics.commuteDistance,
        J: operationMetrics.businessDistance,
        K: operationMetrics.businessDistance + operationMetrics.commuteDistance,
        L: `업무사용비율: ${operationMetrics.businessRatio}%`
      });

      const ws = XLSX.utils.json_to_sheet(ntsRows, { skipHeader: true });
      ws['!cols'] = [
        { wch: 12 },
        { wch: 12 },
        { wch: 10 },
        { wch: 18 },
        { wch: 18 },
        { wch: 15 },
        { wch: 15 },
        { wch: 14 },
        { wch: 12 },
        { wch: 12 },
        { wch: 15 },
        { wch: 30 }
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '국세청_운행기록부');
      XLSX.writeFile(wb, `국세청_업무용승용차_운행기록부_${selectedYm}_${selectedVehicle?.vehicleNo || '통합'}.xlsx`);
    } catch (err: any) {
      showErrorModal(err?.message || '국세청 양식 엑셀 다운로드 중 오류가 발생했습니다.');
    }
  };

  // 주유 영수증 대장 엑셀 내보내기
  const handleExportFuelExcel = () => {
    try {
      const fuelRows = filteredFuelLogs.map((f, idx) => ({
        '연번': idx + 1,
        '주유일시': f.fuelDate,
        '차량번호': f.vehicleNo,
        '운행/주유자': f.driverName,
        '유종': f.fuelType,
        '주유량(L)': f.fuelVolume,
        '주유금액(원)': f.fuelAmount,
        '단가(원/L)': f.fuelUnitPrice || (f.fuelVolume > 0 ? Math.round(f.fuelAmount / f.fuelVolume) : 0),
        '계기판(km)': f.currentMileage,
        '주유소명': f.gasStationName || '',
        '결제수단': f.paymentMethod === 'CORPORATE_CARD' ? '법인카드' : '개인경비',
        '카드번호(끝4자리)': f.cardLast4 || '',
        '계산연비(km/L)': f.fuelEfficiency || '',
        '영수증증빙여부': f.receiptPhotoUrl ? '증빙완료' : '미첨부',
        '비고': f.memo || ''
      }));

      const ws = XLSX.utils.json_to_sheet(fuelRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '주유영수증대장');
      XLSX.writeFile(wb, `법인차량_주유영수증_대장_${selectedYm}.xlsx`);
    } catch (err: any) {
      showErrorModal(err?.message || '주유 대장 엑셀 내보내기 중 오류가 발생했습니다.');
    }
  };

  // 차량 등록/수정 저장
  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleForm.vehicleNo.trim() || !vehicleForm.modelName.trim()) {
      showErrorModal('차량번호와 모델명을 입력해 주십시오.');
      return;
    }

    try {
      if (editingVehicle) {
        await updateCorporateVehicle(editingVehicle.id, {
          vehicleNo: vehicleForm.vehicleNo.trim(),
          modelName: vehicleForm.modelName.trim(),
          vehicleType: vehicleForm.vehicleType,
          ownershipType: vehicleForm.ownershipType,
          fuelType: vehicleForm.fuelType,
          assignedDepartment: vehicleForm.assignedDepartment,
          primaryDriverId: vehicleForm.primaryDriverId || undefined,
          primaryDriverName: vehicleForm.primaryDriverName || undefined,
          initialMileage: Number(vehicleForm.initialMileage) || 0,
          currentMileage: Number(vehicleForm.currentMileage) || 0,
          insuranceExpiryDate: vehicleForm.insuranceExpiryDate || undefined,
          inspectionExpiryDate: vehicleForm.inspectionExpiryDate || undefined,
          isActive: vehicleForm.isActive,
          memo: vehicleForm.memo || undefined
        });
      } else {
        await registerCorporateVehicle({
          vehicleNo: vehicleForm.vehicleNo.trim(),
          modelName: vehicleForm.modelName.trim(),
          vehicleType: vehicleForm.vehicleType,
          ownershipType: vehicleForm.ownershipType,
          fuelType: vehicleForm.fuelType,
          assignedDepartment: vehicleForm.assignedDepartment,
          primaryDriverId: vehicleForm.primaryDriverId || undefined,
          primaryDriverName: vehicleForm.primaryDriverName || undefined,
          initialMileage: Number(vehicleForm.initialMileage) || 0,
          currentMileage: Number(vehicleForm.currentMileage) || 0,
          insuranceExpiryDate: vehicleForm.insuranceExpiryDate || undefined,
          inspectionExpiryDate: vehicleForm.inspectionExpiryDate || undefined,
          isActive: vehicleForm.isActive,
          memo: vehicleForm.memo || undefined
        });
      }
      setVehicleModalOpen(false);
      setEditingVehicle(null);
    } catch (err: any) {
      showErrorModal(err?.message || '차량 정보 저장 중 오류가 발생했습니다.');
    }
  };

  // 삭제 확정 실행
  const handleExecuteDelete = async () => {
    if (!deleteConfirm) return;
    try {
      if (deleteConfirm.type === 'VEHICLE') {
        await deleteCorporateVehicle(deleteConfirm.id);
      } else if (deleteConfirm.type === 'OPERATION_LOG') {
        await deleteVehicleOperationLog(deleteConfirm.id);
      } else if (deleteConfirm.type === 'FUEL_LOG') {
        await deleteVehicleFuelLog(deleteConfirm.id);
      }
      setDeleteConfirm(null);
    } catch (err: any) {
      showErrorModal(err?.message || '삭제 처리 중 오류가 발생했습니다.');
    }
  };

  // 운행일지 승인 토글
  const handleToggleLogStatus = async (log: VehicleOperationLog) => {
    try {
      const nextStatus = log.status === 'CONFIRMED' ? 'SUBMITTED' : 'CONFIRMED';
      await updateVehicleOperationLog(log.id, {
        status: nextStatus,
        confirmedBy: nextStatus === 'CONFIRMED' ? '관리부' : undefined,
        confirmedAt: nextStatus === 'CONFIRMED' ? new Date().toISOString().replace('T', ' ').slice(0, 16) : undefined
      });
    } catch (err: any) {
      showErrorModal(err?.message || '운행일지 상태 갱신 중 오류가 발생했습니다.');
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100dvh - 85px)',
      maxHeight: 'calc(100dvh - 85px)',
      minHeight: 0,
      overflow: 'hidden',
      gap: '8px',
      width: '100%',
      color: 'var(--text-main)',
      boxSizing: 'border-box'
    }}>
      {/* ── 1. 페이지 헤더 (헌장 3.1 무수식어 건조 명사 UI) ── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: '4px',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ padding: '6px', backgroundColor: 'var(--primary)', borderRadius: '6px', color: '#fff', display: 'flex' }}>
            <Car size={18} />
          </div>
          <h2 style={{ fontSize: '17px', fontWeight: '700', margin: 0, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
            법인 차량 및 주유 관리
          </h2>
        </div>

        {/* 상단 퀵 액션 버튼군 */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {activeTab === 'OPERATION_LOG' && (
            <button
              onClick={handleExportNtsExcel}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                backgroundColor: 'var(--success)',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '5px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              <Download size={13} />
              <span>국세청 법정 서식 엑셀 다운로드</span>
            </button>
          )}

          {activeTab === 'FUEL_LOG' && (
            <button
              onClick={handleExportFuelExcel}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                backgroundColor: 'var(--primary)',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '5px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              <Download size={13} />
              <span>주유 영수증 대장 엑셀 다운로드</span>
            </button>
          )}

          {activeTab === 'FLEET_MASTER' && (
            <button
              onClick={() => {
                setEditingVehicle(null);
                setVehicleForm({
                  vehicleNo: '',
                  modelName: '',
                  vehicleType: '승합차',
                  ownershipType: 'OWNED',
                  fuelType: 'DIESEL',
                  assignedDepartment: '관리부',
                  primaryDriverId: '',
                  primaryDriverName: '',
                  initialMileage: 0,
                  currentMileage: 0,
                  insuranceExpiryDate: '',
                  inspectionExpiryDate: '',
                  isActive: true,
                  memo: ''
                });
                setVehicleModalOpen(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                backgroundColor: 'var(--primary)',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '5px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              <Plus size={13} />
              <span>법인 차량 신규 등록</span>
            </button>
          )}
        </div>
      </div>

      {/* ── 2. 메인 탭 바 (운행일지 대장은 임직원 업무저항 검토 중으로 임시 숨김) ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', gap: '4px', flexShrink: 0 }}>
        {/* 운행일지 대장 탭: 임직원 업무저항 검토 중으로 임시 숨김 */}
        {false && (
          <button
            onClick={() => setActiveTab('OPERATION_LOG')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: activeTab === 'OPERATION_LOG' ? '800' : '600',
              color: activeTab === 'OPERATION_LOG' ? 'var(--primary)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'OPERATION_LOG' ? '3px solid var(--primary)' : '3px solid transparent',
              marginBottom: '-1px',
              backgroundColor: 'transparent',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer'
            }}
          >
            <FileText size={15} />
            <span>운행일지 대장</span>
            <span style={{ fontSize: '11px', backgroundColor: 'rgba(2,132,199,0.15)', color: 'var(--primary)', padding: '1px 6px', borderRadius: '10px', fontWeight: '700' }}>
              {vehicleOperationLogs.length}
            </span>
          </button>
        )}

        <button
          onClick={() => setActiveTab('FUEL_LOG')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: activeTab === 'FUEL_LOG' ? '800' : '600',
            color: activeTab === 'FUEL_LOG' ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: activeTab === 'FUEL_LOG' ? '3px solid var(--primary)' : '3px solid transparent',
            marginBottom: '-1px',
            backgroundColor: 'transparent',
            borderTop: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            cursor: 'pointer'
          }}
        >
          <Fuel size={15} />
          <span>주유 영수증 대장</span>
          <span style={{ fontSize: '11px', backgroundColor: 'rgba(234,88,12,0.15)', color: '#ea580c', padding: '1px 6px', borderRadius: '10px', fontWeight: '700' }}>
            {vehicleFuelLogs.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('FLEET_MASTER')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: activeTab === 'FLEET_MASTER' ? '800' : '600',
            color: activeTab === 'FLEET_MASTER' ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: activeTab === 'FLEET_MASTER' ? '3px solid var(--primary)' : '3px solid transparent',
            marginBottom: '-1px',
            backgroundColor: 'transparent',
            borderTop: 'none',
            borderLeft: 'none',
            borderRight: 'none',
            cursor: 'pointer'
          }}
        >
          <Car size={15} />
          <span>법인 차량 관리</span>
          <span style={{ fontSize: '11px', backgroundColor: 'var(--border-color)', color: 'var(--text-main)', padding: '1px 6px', borderRadius: '10px', fontWeight: '700' }}>
            {corporateVehicles.length}
          </span>
        </button>
      </div>

      {/* ── 3. 필터 패널 (운행일지 & 주유일지 공통) ── */}
      {activeTab !== 'FLEET_MASTER' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '8px 12px',
            flexShrink: 0,
            flexWrap: 'wrap'
          }}
        >
          {/* 정산 연월 (YYYY-MM) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>조회 연월</label>
            <input
              type="month"
              value={selectedYm}
              onChange={e => setSelectedYm(e.target.value)}
              style={{
                height: '32px',
                padding: '0 8px',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                fontSize: '12px',
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)'
              }}
            />
          </div>

          {/* 차량 선택 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>차량 선택</label>
            <select
              value={selectedVehicleId}
              onChange={e => setSelectedVehicleId(e.target.value)}
              style={{
                height: '32px',
                padding: '0 8px',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                fontSize: '12px',
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)',
                minWidth: '160px'
              }}
            >
              <option value="ALL">전체 차량 ({corporateVehicles.length}대)</option>
              {corporateVehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {v.vehicleNo} - {v.modelName} ({v.assignedDepartment})
                </option>
              ))}
            </select>
          </div>

          {/* 운행일지 상태 필터 */}
          {activeTab === 'OPERATION_LOG' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>검증 상태</label>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{
                  height: '32px',
                  padding: '0 8px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  backgroundColor: 'var(--bg-app)',
                  color: 'var(--text-main)'
                }}
              >
                <option value="ALL">전체 상태</option>
                <option value="SUBMITTED">승인대기</option>
                <option value="CONFIRMED">승인완료</option>
              </select>
            </div>
          )}

          {/* 검색어 (운행자 / 차량번호 / 행선지) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '180px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>검색</label>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: 'var(--text-muted, #94a3b8)' }} />
              <input
                type="text"
                placeholder="운행자, 차량번호, 목적지, 주유소 검색"
                value={driverSearch}
                onChange={e => setDriverSearch(e.target.value)}
                style={{
                  height: '32px',
                  padding: '0 10px 0 30px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  width: '100%',
                  boxSizing: 'border-box',
                  backgroundColor: 'var(--bg-app)',
                  color: 'var(--text-main)'
                }}
              />
            </div>
          </div>

          {/* 필터 초기화 버튼 */}
          <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%' }}>
            <button
              onClick={() => {
                setSelectedYm(currentYm);
                setSelectedVehicleId('ALL');
                setStatusFilter('ALL');
                setDriverSearch('');
              }}
              style={{
                height: '32px',
                padding: '0 12px',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              초기화
            </button>
          </div>
        </div>
      )}

      {/* ── 4-1. 탭 1: 운행일지 대장 ── */}
      {activeTab === 'OPERATION_LOG' && (
        <>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--bg-card)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr style={{ backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', height: '36px' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'center', width: '40px' }}>No</th>
                  <th style={{ padding: '8px 10px' }}>운행일자</th>
                  <th style={{ padding: '8px 10px' }}>차량번호</th>
                  <th style={{ padding: '8px 10px' }}>운행자(부서)</th>
                  <th style={{ padding: '8px 10px' }}>운행목적</th>
                  <th style={{ padding: '8px 10px' }}>출발지 ➔ 도착지</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>출발(km)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>도착(km)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: '800' }}>주행(km)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>업무용(km)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>계기판 증빙</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>상태</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredOperationLogs.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)' }}>
                      조회 조건에 해당하는 운행일지 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredOperationLogs.map((log, idx) => {
                    const purposeInfo = PURPOSE_MAP[log.purposeType] || PURPOSE_MAP.OTHER;
                    return (
                      <tr
                        key={log.id}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          height: '38px',
                          backgroundColor: idx % 2 === 1 ? 'rgba(0,0,0,0.02)' : 'transparent'
                        }}
                      >
                        <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                        <td style={{ padding: '6px 10px', fontWeight: '700', color: 'var(--text-main)' }}>{log.operationDate}</td>
                        <td style={{ padding: '6px 10px', fontWeight: '700', color: 'var(--primary)' }}>{log.vehicleNo}</td>
                        <td style={{ padding: '6px 10px' }}>
                          <span style={{ fontWeight: '700', color: 'var(--text-main)' }}>{log.driverName}</span>
                          <span style={{ color: 'var(--text-secondary)', fontSize: '11px', marginLeft: '4px' }}>({log.driverDept || '관리부'})</span>
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <span
                            style={{
                              backgroundColor: purposeInfo.bg,
                              color: purposeInfo.text,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: '700'
                            }}
                          >
                            {purposeInfo.label}
                          </span>
                          {log.purposeDetail && (
                            <span style={{ marginLeft: '6px', color: 'var(--text-secondary)', fontSize: '11px' }}>
                              {log.purposeDetail}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{log.departureLocation}</span>
                          <span style={{ margin: '0 4px', color: 'var(--text-muted, #94a3b8)' }}>➔</span>
                          <span style={{ fontWeight: '600', color: 'var(--text-main)' }}>{log.arrivalLocation}</span>
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {log.departureMileage.toLocaleString()}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {log.arrivalMileage.toLocaleString()}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '800', color: 'var(--primary)' }}>
                          {log.driveDistance.toLocaleString()} km
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: '#10b981', fontWeight: '700' }}>
                          {log.businessDistance.toLocaleString()} km
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', gap: '4px' }}>
                            {log.dashboardPhotoStart ? (
                              <button
                                onClick={() => setPhotoModal({ isOpen: true, title: `${log.vehicleNo} 출발 계기판 (${log.departureMileage} km)`, url: log.dashboardPhotoStart || '' })}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: '11px',
                                  backgroundColor: 'var(--bg-app)',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  color: 'var(--text-main)'
                                }}
                              >
                                <Eye size={12} />
                                <span>출발</span>
                              </button>
                            ) : (
                              <span style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '11px' }}>-</span>
                            )}
                            {log.dashboardPhotoEnd ? (
                              <button
                                onClick={() => setPhotoModal({ isOpen: true, title: `${log.vehicleNo} 도착 계기판 (${log.arrivalMileage} km)`, url: log.dashboardPhotoEnd || '' })}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: '11px',
                                  backgroundColor: 'var(--bg-app)',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  color: 'var(--text-main)'
                                }}
                              >
                                <Eye size={12} />
                                <span>도착</span>
                              </button>
                            ) : (
                              <span style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '11px' }}>-</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                          <span
                            onClick={() => handleToggleLogStatus(log)}
                            style={{
                              backgroundColor: log.status === 'CONFIRMED' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                              color: log.status === 'CONFIRMED' ? '#10b981' : '#eab308',
                              padding: '3px 8px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: '700',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                            title="클릭 시 검증 상태 토글"
                          >
                            {log.status === 'CONFIRMED' ? <ShieldCheck size={12} /> : <Clock size={12} />}
                            <span>{log.status === 'CONFIRMED' ? '승인완료' : '승인대기'}</span>
                          </span>
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                          <button
                            onClick={() => setDeleteConfirm({
                              isOpen: true,
                              type: 'OPERATION_LOG',
                              id: log.id,
                              title: '운행일지 기록 삭제',
                              message: `${log.operationDate} ${log.vehicleNo} ${log.driverName} 님의 운행기록을 삭제하시겠습니까?`
                            })}
                            style={{
                              border: 'none',
                              backgroundColor: 'transparent',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '2px'
                            }}
                            title="삭제"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 하단 Gutenberg Z-패턴 대차대조 바 (헌장 3.5) */}
          <div
            style={{
              marginTop: 'auto',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '10px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12px',
              fontWeight: '700',
              flexShrink: 0
            }}
          >
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
              <span>🚗 운행건수: <strong style={{ color: 'var(--primary)' }}>{operationMetrics.totalCount}</strong>건</span>
              <span>🛣️ 총 주행거리: <strong style={{ color: 'var(--primary)' }}>{operationMetrics.totalDistance.toLocaleString()}</strong> km</span>
              <span>🏢 업무용: <strong style={{ color: '#10b981' }}>{operationMetrics.businessDistance.toLocaleString()}</strong> km</span>
              <span>🏠 출퇴근: <strong style={{ color: '#a855f7' }}>{operationMetrics.commuteDistance.toLocaleString()}</strong> km</span>
            </div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <span>📊 업무사용비율: <strong style={{ color: '#eab308' }}>{operationMetrics.businessRatio}%</strong></span>
              <span style={{ backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', padding: '4px 10px', borderRadius: '6px', color: 'var(--primary)', fontSize: '11px' }}>
                ⚖️ 대차대조 무결성 일치
              </span>
            </div>
          </div>
        </>
      )}

      {/* ── 4-2. 탭 2: 주유 영수증 대장 ── */}
      {activeTab === 'FUEL_LOG' && (
        <>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--bg-card)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr style={{ backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', height: '36px' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'center', width: '40px' }}>No</th>
                  <th style={{ padding: '8px 10px' }}>주유일시</th>
                  <th style={{ padding: '8px 10px' }}>차량번호</th>
                  <th style={{ padding: '8px 10px' }}>주유자</th>
                  <th style={{ padding: '8px 10px' }}>유종</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>주유량(L)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: '800' }}>주유금액(원)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>리터단가(원/L)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>계기판(km)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>계기판 사진</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>영수증 사진</th>
                  <th style={{ padding: '8px 10px' }}>주유소명</th>
                  <th style={{ padding: '8px 10px' }}>결제구분</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredFuelLogs.length === 0 ? (
                  <tr>
                    <td colSpan={14} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)' }}>
                      조회 조건에 해당하는 주유 영수증 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredFuelLogs.map((fuel, idx) => {
                    const unitPrice = fuel.fuelUnitPrice || (fuel.fuelVolume > 0 ? Math.round(fuel.fuelAmount / fuel.fuelVolume) : 0);
                    return (
                      <tr
                        key={fuel.id}
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          height: '38px',
                          backgroundColor: idx % 2 === 1 ? 'rgba(0,0,0,0.02)' : 'transparent'
                        }}
                      >
                        <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                        <td style={{ padding: '6px 10px', fontWeight: '700', color: 'var(--text-main)' }}>{fuel.fuelDate}</td>
                        <td style={{ padding: '6px 10px', fontWeight: '700', color: 'var(--primary)' }}>{fuel.vehicleNo}</td>
                        <td style={{ padding: '6px 10px', fontWeight: '600', color: 'var(--text-main)' }}>{fuel.driverName}</td>
                        <td style={{ padding: '6px 10px' }}>
                          <span
                            style={{
                              backgroundColor: fuel.fuelType === '경유' ? 'rgba(234,88,12,0.15)' : fuel.fuelType === '휘발유' ? 'rgba(239,68,68,0.15)' : 'rgba(2,132,199,0.15)',
                              color: fuel.fuelType === '경유' ? '#ea580c' : fuel.fuelType === '휘발유' ? '#ef4444' : 'var(--primary)',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: '700'
                            }}
                          >
                            {fuel.fuelType}
                          </span>
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '700', color: 'var(--text-main)' }}>
                          {fuel.fuelVolume.toFixed(1)} L
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '800', color: '#10b981' }}>
                          ₩{fuel.fuelAmount.toLocaleString()}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                          ₩{unitPrice.toLocaleString()}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {fuel.currentMileage.toLocaleString()} km
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                          {fuel.dashboardPhotoUrl ? (
                            <button
                              onClick={() => setPhotoModal({ isOpen: true, title: `${fuel.vehicleNo} 주유 시 계기판 (${fuel.currentMileage} km)`, url: fuel.dashboardPhotoUrl || '' })}
                              style={{
                                padding: '2px 8px',
                                fontSize: '11px',
                                backgroundColor: 'var(--bg-app)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                color: 'var(--primary)',
                                fontWeight: '700',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                            >
                              <Eye size={12} />
                              <span>계기판</span>
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '11px' }}>미등록</span>
                          )}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                          {fuel.receiptPhotoUrl ? (
                            <button
                              onClick={() => setPhotoModal({ isOpen: true, title: `${fuel.vehicleNo} 주유 영수증 (₩${fuel.fuelAmount.toLocaleString()})`, url: fuel.receiptPhotoUrl || '' })}
                              style={{
                                padding: '2px 8px',
                                fontSize: '11px',
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                color: '#10b981',
                                fontWeight: '700',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                            >
                              <Eye size={12} />
                              <span>영수증확인</span>
                            </button>
                          ) : (
                            <span style={{ color: '#ef4444', fontSize: '11px', fontWeight: '700' }}>영수증누락</span>
                          )}
                        </td>
                        <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>
                          {fuel.gasStationName || '-'}
                        </td>
                        <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontSize: '11px' }}>
                          {fuel.paymentMethod === 'CORPORATE_CARD' ? '법인카드' : '개인경비'}
                          {fuel.cardLast4 ? ` (${fuel.cardLast4})` : ''}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                          <button
                            onClick={() => setDeleteConfirm({
                              isOpen: true,
                              type: 'FUEL_LOG',
                              id: fuel.id,
                              title: '주유 영수증 기록 삭제',
                              message: `${fuel.fuelDate} ${fuel.vehicleNo} ₩${fuel.fuelAmount.toLocaleString()} 주유 기록을 삭제하시겠습니까?`
                            })}
                            style={{
                              border: 'none',
                              backgroundColor: 'transparent',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '2px'
                            }}
                            title="삭제"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 하단 Gutenberg Z-패턴 대차대조 바 (헌장 3.5) */}
          <div
            style={{
              marginTop: 'auto',
              backgroundColor: 'var(--bg-card)',
              color: 'var(--text-main)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '10px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12px',
              fontWeight: '700',
              flexShrink: 0
            }}
          >
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
              <span>⛽ 주유건수: <strong style={{ color: 'var(--primary)' }}>{fuelMetrics.totalCount}</strong>건</span>
              <span>🛢️ 총 주유용량: <strong style={{ color: 'var(--primary)' }}>{fuelMetrics.totalVolume.toFixed(1)}</strong> L</span>
              <span>💰 총 주유금액: <strong style={{ color: '#10b981' }}>₩{fuelMetrics.totalAmount.toLocaleString()}</strong></span>
            </div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <span>🧾 영수증 증빙율: <strong style={{ color: '#eab308' }}>{fuelMetrics.proofRatio}% ({fuelMetrics.receiptProofCount}/{fuelMetrics.totalCount})</strong></span>
              <span style={{ backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', padding: '4px 10px', borderRadius: '6px', color: '#10b981', fontSize: '11px' }}>
                🟢 세무 적격 증빙 확인
              </span>
            </div>
          </div>
        </>
      )}

      {/* ── 4-3. 탭 3: 법인 차량 관리 ── */}
      {activeTab === 'FLEET_MASTER' && (
        <>
          {/* 차량 마스터 KPI 요약 카드 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', flexShrink: 0 }}>
            <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '4px' }}>전사 등록 차량</div>
              <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-main)' }}>{corporateVehicles.length} <span style={{ fontSize: '13px', fontWeight: '500' }}>대</span></div>
              <div style={{ fontSize: '11px', color: '#10b981', marginTop: '3px' }}>가용 {corporateVehicles.filter(v => v.isActive).length}대 / 휴차 {corporateVehicles.filter(v => !v.isActive).length}대</div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '4px' }}>당월 전사 총 주행거리</div>
              <div style={{ fontSize: '20px', fontWeight: '800', color: 'var(--primary)' }}>{operationMetrics.totalDistance.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: '500' }}>km</span></div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>업무사용비율 {operationMetrics.businessRatio}%</div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '4px' }}>당월 총 주유비 지출</div>
              <div style={{ fontSize: '20px', fontWeight: '800', color: '#10b981' }}>₩{fuelMetrics.totalAmount.toLocaleString()}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>총 주유량 {fuelMetrics.totalVolume.toFixed(1)} L</div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '4px' }}>법정 증빙 영수증 첨부율</div>
              <div style={{ fontSize: '20px', fontWeight: '800', color: '#eab308' }}>{fuelMetrics.proofRatio} <span style={{ fontSize: '13px', fontWeight: '500' }}>%</span></div>
              <div style={{ fontSize: '11px', color: '#10b981', marginTop: '3px' }}>국세청 감사 대비 100% 보존</div>
            </div>
          </div>

          {/* 차량 마스터 테이블 */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'var(--bg-card)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr style={{ backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', height: '36px' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'center', width: '40px' }}>No</th>
                  <th style={{ padding: '8px 10px' }}>차량번호</th>
                  <th style={{ padding: '8px 10px' }}>차종 / 모델명</th>
                  <th style={{ padding: '8px 10px' }}>차량구분</th>
                  <th style={{ padding: '8px 10px' }}>소유구분</th>
                  <th style={{ padding: '8px 10px' }}>기본유종</th>
                  <th style={{ padding: '8px 10px' }}>배정부서</th>
                  <th style={{ padding: '8px 10px' }}>주 운행자</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>최초거리(km)</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: '800' }}>현재누적(km)</th>
                  <th style={{ padding: '8px 10px' }}>보험만료일</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>상태</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {corporateVehicles.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)' }}>
                      등록된 법인 차량이 없습니다. [법인 차량 신규 등록] 버튼을 눌러 등록하십시오.
                    </td>
                  </tr>
                ) : (
                  corporateVehicles.map((veh, idx) => (
                    <tr
                      key={veh.id}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        height: '38px',
                        backgroundColor: idx % 2 === 1 ? 'rgba(0,0,0,0.02)' : 'transparent'
                      }}
                    >
                      <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--text-secondary)' }}>{idx + 1}</td>
                      <td style={{ padding: '6px 10px', fontWeight: '800', color: 'var(--primary)' }}>{veh.vehicleNo}</td>
                      <td style={{ padding: '6px 10px', fontWeight: '700', color: 'var(--text-main)' }}>{veh.modelName}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{veh.vehicleType}</td>
                      <td style={{ padding: '6px 10px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {veh.ownershipType === 'OWNED' ? '자사소유' : veh.ownershipType === 'LEASE' ? '리스' : '임차'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: '700', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}>
                          {veh.fuelType}
                        </span>
                      </td>
                      <td style={{ padding: '6px 10px', fontWeight: '600', color: 'var(--text-main)' }}>{veh.assignedDepartment}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--text-main)' }}>{veh.primaryDriverName || '-'}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {veh.initialMileage.toLocaleString()}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '800', color: 'var(--primary)' }}>
                        {veh.currentMileage.toLocaleString()} km
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>
                        {veh.insuranceExpiryDate || '-'}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: '700',
                            backgroundColor: veh.isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: veh.isActive ? '#10b981' : '#ef4444'
                          }}
                        >
                          {veh.isActive ? '운행가능' : '휴차'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                          <button
                            onClick={() => {
                              setEditingVehicle(veh);
                              setVehicleForm({
                                vehicleNo: veh.vehicleNo,
                                modelName: veh.modelName,
                                vehicleType: veh.vehicleType,
                                ownershipType: veh.ownershipType,
                                fuelType: veh.fuelType,
                                assignedDepartment: veh.assignedDepartment,
                                primaryDriverId: veh.primaryDriverId || '',
                                primaryDriverName: veh.primaryDriverName || '',
                                initialMileage: veh.initialMileage,
                                currentMileage: veh.currentMileage,
                                insuranceExpiryDate: veh.insuranceExpiryDate || '',
                                inspectionExpiryDate: veh.inspectionExpiryDate || '',
                                isActive: veh.isActive,
                                memo: veh.memo || ''
                              });
                              setVehicleModalOpen(true);
                            }}
                            style={{
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-app)',
                              color: 'var(--text-main)',
                              borderRadius: '4px',
                              padding: '3px 6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px',
                              fontSize: '11px'
                            }}
                          >
                            <Edit2 size={12} />
                            <span>수정</span>
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({
                              isOpen: true,
                              type: 'VEHICLE',
                              id: veh.id,
                              title: '법인 차량 삭제',
                              message: `차량 ${veh.vehicleNo} (${veh.modelName}) 정보를 삭제하시겠습니까?`
                            })}
                            style={{
                              border: '1px solid rgba(239,68,68,0.4)',
                              backgroundColor: 'var(--bg-app)',
                              color: '#ef4444',
                              borderRadius: '4px',
                              padding: '3px 6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px',
                              fontSize: '11px'
                            }}
                          >
                            <Trash2 size={12} />
                            <span>삭제</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── 5. 고해상도 사진 팝업 모달 (계기판 & 영수증) ── */}
      {photoModal?.isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px'
          }}
          onClick={() => setPhotoModal(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              maxWidth: '850px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: 'var(--text-main)' }}>
                {photoModal.title}
              </h3>
              <button
                onClick={() => setPhotoModal(null)}
                style={{ border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', overflow: 'auto', flex: 1 }}>
              {photoModal.url ? (
                <img
                  src={photoModal.url}
                  alt={photoModal.title}
                  style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '4px' }}
                />
              ) : (
                <div style={{ color: 'var(--text-muted, #94a3b8)', padding: '60px' }}>등록된 사진 이미지가 없습니다.</div>
              )}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', backgroundColor: 'var(--bg-card)' }}>
              <button
                onClick={() => setPhotoModal(null)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 6. 차량 신규/수정 모달 (헌장 3.4 상하 스택 레이아웃) ── */}
      {vehicleModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px'
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              maxWidth: '650px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: 'var(--text-main)' }}>
                {editingVehicle ? '법인 차량 정보 수정' : '법인 차량 신규 등록'}
              </h3>
              <button
                onClick={() => setVehicleModalOpen(false)}
                style={{ border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveVehicle} style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* 차량번호 & 차종/모델명 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>차량번호 *</label>
                  <input
                    type="text"
                    placeholder="예: 82가 1024"
                    value={vehicleForm.vehicleNo}
                    onChange={e => setVehicleForm({ ...vehicleForm, vehicleNo: e.target.value })}
                    required
                    style={{ height: '36px', padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>차종 / 모델명 *</label>
                  <input
                    type="text"
                    placeholder="예: 스타리아 카고 5인승"
                    value={vehicleForm.modelName}
                    onChange={e => setVehicleForm({ ...vehicleForm, modelName: e.target.value })}
                    required
                    style={{ height: '36px', padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  />
                </div>
              </div>

              {/* 차량구분 & 소유구분 & 기본유종 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>차량구분</label>
                  <select
                    value={vehicleForm.vehicleType}
                    onChange={e => setVehicleForm({ ...vehicleForm, vehicleType: e.target.value as CorporateVehicleType })}
                    style={{ height: '36px', padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  >
                    <option value="승합차">승합차</option>
                    <option value="화물/탑차">화물/탑차</option>
                    <option value="승용차">승용차</option>
                    <option value="전기차">전기차</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>소유구분</label>
                  <select
                    value={vehicleForm.ownershipType}
                    onChange={e => setVehicleForm({ ...vehicleForm, ownershipType: e.target.value as CorporateVehicleOwnership })}
                    style={{ height: '36px', padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  >
                    <option value="OWNED">자사 소유</option>
                    <option value="LEASE">리스</option>
                    <option value="RENTAL">장기렌트</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>기본유종</label>
                  <select
                    value={vehicleForm.fuelType}
                    onChange={e => setVehicleForm({ ...vehicleForm, fuelType: e.target.value as CorporateVehicleFuelType })}
                    style={{ height: '36px', padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  >
                    <option value="DIESEL">경유 (DIESEL)</option>
                    <option value="GASOLINE">휘발유 (GASOLINE)</option>
                    <option value="LPG">LPG</option>
                    <option value="HYBRID">하이브리드</option>
                    <option value="ELECTRIC">전기 (ELECTRIC)</option>
                  </select>
                </div>
              </div>

              {/* 배정부서 & 주 운행자 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>배정부서</label>
                  <select
                    value={vehicleForm.assignedDepartment}
                    onChange={e => setVehicleForm({ ...vehicleForm, assignedDepartment: e.target.value })}
                    style={{ height: '36px', padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  >
                    <option value="관리부">관리부</option>
                    <option value="경영지원부">경영지원부</option>
                    <option value="AS팀">AS팀</option>
                    <option value="영업부">영업부</option>
                    <option value="출고관리부">출고관리부</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>주 운행자</label>
                  <select
                    value={vehicleForm.primaryDriverId}
                    onChange={e => {
                      const selectedUser = users.find(u => u.id === e.target.value);
                      setVehicleForm({
                        ...vehicleForm,
                        primaryDriverId: e.target.value,
                        primaryDriverName: selectedUser ? selectedUser.name : ''
                      });
                    }}
                    style={{ height: '36px', padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  >
                    <option value="">미지정 (공용 차량)</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role || u.id})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 최초 주행거리 & 현재 누적 주행거리 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>최초 등록 주행거리 (km)</label>
                  <input
                    type="number"
                    value={vehicleForm.initialMileage}
                    onChange={e => setVehicleForm({ ...vehicleForm, initialMileage: Number(e.target.value) })}
                    style={{ height: '36px', padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>현재 누적 주행거리 (km)</label>
                  <input
                    type="number"
                    value={vehicleForm.currentMileage}
                    onChange={e => setVehicleForm({ ...vehicleForm, currentMileage: Number(e.target.value) })}
                    style={{ height: '36px', padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  />
                </div>
              </div>

              {/* 보험만료일 & 정기검사만료일 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>보험 만료일</label>
                  <input
                    type="date"
                    value={vehicleForm.insuranceExpiryDate}
                    onChange={e => setVehicleForm({ ...vehicleForm, insuranceExpiryDate: e.target.value })}
                    style={{ height: '36px', padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>정기 검사 만료일</label>
                  <input
                    type="date"
                    value={vehicleForm.inspectionExpiryDate}
                    onChange={e => setVehicleForm({ ...vehicleForm, inspectionExpiryDate: e.target.value })}
                    style={{ height: '36px', padding: '0 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                  />
                </div>
              </div>

              {/* 운행 가용 여부 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  id="vehIsActive"
                  checked={vehicleForm.isActive}
                  onChange={e => setVehicleForm({ ...vehicleForm, isActive: e.target.checked })}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <label htmlFor="vehIsActive" style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-main)', cursor: 'pointer' }}>
                  운행 가능 (체크 해제 시 휴차 처리)
                </label>
              </div>

              {/* 비고 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-main)' }}>비고 / 특이사항</label>
                <textarea
                  rows={2}
                  placeholder="차량 용도, 주차 위치, 관리 메모 등"
                  value={vehicleForm.memo}
                  onChange={e => setVehicleForm({ ...vehicleForm, memo: e.target.value })}
                  style={{ padding: '8px 10px', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)' }}
                />
              </div>

              {/* 하단 모달 액션 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setVehicleModalOpen(false)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--bg-app)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer'
                  }}
                >
                  취소
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 18px',
                    backgroundColor: 'var(--primary)',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '700',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  저장 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 7. 삭제 확인 커스텀 모달 ── */}
      {deleteConfirm?.isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px'
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              maxWidth: '420px',
              width: '100%',
              padding: '20px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ padding: '8px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', borderRadius: '8px' }}>
                <AlertTriangle size={20} />
              </div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: 'var(--text-main)' }}>
                {deleteConfirm.title}
              </h3>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: '0 0 16px 0' }}>
              {deleteConfirm.message}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  padding: '8px 14px',
                  backgroundColor: 'var(--bg-app)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
              >
                취소
              </button>
              <button
                onClick={handleExecuteDelete}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#ef4444',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '700',
                  color: '#fff',
                  cursor: 'pointer'
                }}
              >
                영구 삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
