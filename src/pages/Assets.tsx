import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Search, Download, Eye, Layers, Edit2, Save, X, Wrench, RefreshCw, PlusCircle, ShoppingBag, CheckCircle2, AlertCircle } from 'lucide-react';
import { exportToExcel } from '../services/excel';
import { Asset, calculateAssetDepreciation, AssetInOutLog, Repair } from '../services/db';
import { ASSET_STATUS_SSOT, getAssetStatusLabel, getAssetStatusBadgeClass } from '../config/asset_status_config';

export const Assets: React.FC = () => {
  const { 
    assets, customers, sites, contracts, contractAssets, hasPermission, 
    saveAsset, showErrorModal, loadTablesForMenu, assetInOutLogs, repairs, 
    vendors, products, setActiveTab: setGlobalActiveTab 
  } = useApp();

  const canEdit = hasPermission('asset', 'save');

  // 토스트 알림 상태
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // 실시간 검색 및 필터 상태 (즉시 반응형 로딩: 헌장 1.1 & 1.2)
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [ownerFilter, setOwnerFilter] = useState('ALL');
  const [manufacturerFilter, setManufacturerFilter] = useState('ALL');
  const [customerFilter, setCustomerFilter] = useState('ALL');

  // 정렬 상태
  type AssetSortField = 'assetNo' | 'modelName' | 'ownerType' | 'status' | 'currentCustomerId' | 'acquisitionDate' | 'manufacturer';
  const [sortField, setSortField] = useState<AssetSortField>('assetNo');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // 상세조회 Dossier 슬라이드오버 및 수정 상태
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Asset>>({});
  const [showHistoryToggle, setShowHistoryToggle] = useState(false);

  // ── 🌟 [초고속 O(1) 룩업 인덱싱 해시맵: 헌장 1.1] ──
  const customerMap = useMemo(() => new Map((customers || []).map(c => [c.id, c.name])), [customers]);
  const siteMap = useMemo(() => new Map((sites || []).map(s => [s.id, s.name])), [sites]);
  const vendorMap = useMemo(() => new Map((vendors || []).map(v => [v.id, v.name])), [vendors]);
  const productFeetMap = useMemo(() => {
    const map = new Map<string, string>();
    (products || []).forEach(p => {
      if (p.modelName) map.set(p.modelName, p.feet ? `${p.feet} ft` : '');
    });
    return map;
  }, [products]);

  // 계약번호 O(1) 사전 인덱싱 (기존 380만 번 반복 순회 제거)
  const contractMap = useMemo(() => {
    const map = new Map<string, { contractNo: string; contractId: string }>();
    if (!contractAssets || !contracts) return map;
    const contractsById = new Map<string, any>((contracts || []).map(c => [c.id, c]));
    for (const ca of contractAssets) {
      if (!ca.assetId) continue;
      const c = contractsById.get(ca.contractId);
      if (c) {
        if (c.status === 'ACTIVE' || !map.has(ca.assetId)) {
          map.set(ca.assetId, { contractNo: c.contractNo, contractId: c.id });
        }
      }
    }
    return map;
  }, [contractAssets, contracts]);

  // 헬퍼: 외부 임차(전대) 자산 소유 원사명 (O(1) 즉각 조회)
  const getAssetRenterName = (a: Asset): string => {
    if (a.ownerType !== 'RENTED') return '-';
    if (a.renter) return a.renter;
    if (a.vendorId) return vendorMap.get(a.vendorId) || '-';
    return '-';
  };

  // 헬퍼: 당사자산 구입처(공급처) 명칭 (O(1) 즉각 조회)
  const getAssetSupplierName = (a: Asset): string => {
    if (a.ownerType !== 'OWNED') return '-';
    if (a.supplier) return a.supplier;
    if (a.vendorId) return vendorMap.get(a.vendorId) || '-';
    return '-';
  };

  // 헬퍼: 모델별 규격(피트) 조회 (O(1) 즉각 조회)
  const getAssetFeet = (a: Asset): string => {
    const feet = productFeetMap.get(a.modelName);
    if (feet) return feet;
    const m = a.modelName.match(/(\d{2})/);
    return m ? `${m[1]} ft` : '-';
  };

  const getCustomerName = (id?: string) => {
    if (!id) return '-';
    return customerMap.get(id) || '-';
  };

  const getSiteName = (id?: string) => {
    if (!id) return '-';
    return siteMap.get(id) || '-';
  };

  // 활성 계약 정보 O(1) 룩업
  const getAssetContractInfo = (assetId?: string): { contractNo: string; contractId: string } | null => {
    if (!assetId) return null;
    return contractMap.get(assetId) || null;
  };

  // 고유 제조사 목록
  const uniqueManufacturers = useMemo(
    () => Array.from(new Set(assets.map(a => a.manufacturer).filter(Boolean))) as string[],
    [assets]
  );

  // 자산 생애주기 통합 감사 이력 추출
  const getUnifiedAssetLogs = (asset: Asset): AssetInOutLog[] => {
    if (!asset) return [];
    const rawLogs = (assetInOutLogs || []).filter((l: AssetInOutLog) => l.assetId === asset.id || (l.assetNo && l.assetNo === asset.assetNo));
    const assetRepairs = (repairs || []).filter((r: Repair) => r.assetId === asset.id || (r.assetNo && r.assetNo === asset.assetNo));
    const existingRepairIds = new Set(rawLogs.map(l => l.repairId).filter(Boolean));

    const repairLogs: AssetInOutLog[] = assetRepairs
      .filter(r => !existingRepairIds.has(r.id))
      .map(r => ({
        id: `repair-log-${r.id}`,
        assetId: asset.id,
        assetNo: asset.assetNo,
        modelName: asset.modelName,
        type: 'REPAIR',
        eventDate: r.visitDate || r.repairDate || r.requestDate || (r.createdAt ? r.createdAt.slice(0, 10) : ''),
        customerId: r.customerId,
        customerName: r.customerName || (r as any).customer,
        siteId: r.siteId,
        siteName: r.siteName || (r as any).site,
        repairId: r.id,
        memo: `${r.ticketNo || 'AS'} ${r.issueDescription || r.details || '정비점검'} ➔ ${r.actionTaken || '조치완료'} (정비사: ${r.mechanicName || '-'})`,
        createdAt: r.createdAt || new Date().toISOString()
      }));

    const unified = [...rawLogs, ...repairLogs];

    const hasAcquisition = unified.some(l => l.type === 'ACQUISITION');
    if (!hasAcquisition && asset.acquisitionDate) {
      unified.unshift({
        id: `acq-fallback-${asset.id}`,
        assetId: asset.id,
        assetNo: asset.assetNo,
        modelName: asset.modelName,
        type: 'ACQUISITION',
        eventDate: asset.acquisitionDate,
        memo: `자산 최초 취득 및 대장 등록 (취득일: ${asset.acquisitionDate} / 취득가: ${(asset.acquisitionPrice || 0).toLocaleString()}원 / 구입처: ${asset.supplier || '-'})`,
        createdAt: asset.createdAt || asset.acquisitionDate
      });
    }

    return unified.sort((a, b) => (b.eventDate || '').localeCompare(a.eventDate || ''));
  };

  const handleExportAssetHistoryExcel = (asset: Asset) => {
    const assetLogs = getUnifiedAssetLogs(asset);
    if (assetLogs.length === 0) {
      showToast('해당 자산의 누적 이력 데이터가 존재하지 않습니다.', 'error');
      return;
    }
    const dataToExport = assetLogs.map((log: AssetInOutLog, idx: number) => ({
      'No': idx + 1,
      '구분': log.type === 'ACQUISITION' ? '취득' : log.type === 'OUTBOUND' ? '출고' : log.type === 'INBOUND' ? '입고' : log.type === 'INBOUND_CANCEL' ? '입고취소' : log.type === 'DISPOSAL' ? '매각' : '정비',
      '입고고유번호': log.inboundNo || '-',
      '발생일자': log.eventDate,
      '관리번호': log.assetNo,
      '모델명': log.modelName,
      '거래처(고객사)': log.customerName || '-',
      '현장명': log.siteName || '-',
      '정비점수': log.maintenanceScore || 0,
      '특이사항/메모': log.memo || '-'
    }));

    exportToExcel(dataToExport, `자산이력_${asset.assetNo}_${new Date().toISOString().split('T')[0]}`);
    showToast(`자산 ${asset.assetNo} 이력 엑셀 파일이 다운로드되었습니다.`);
  };

  // 실시간 KPI 통계
  const kpiStats = useMemo(() => {
    const totalCount = assets.length;
    const ownedCount = assets.filter(a => a.ownerType === 'OWNED').length;
    const rentedCount = assets.filter(a => a.ownerType === 'RENTED').length;
    
    // 실가동: 현장 대여중(RENTED) + 출고대기(ASSIGNED)
    const rentedOpCount = assets.filter(a => a.status === 'RENTED').length;
    const assignedCount = assets.filter(a => a.status === 'ASSIGNED').length;
    const availableCount = assets.filter(a => a.status === 'AVAILABLE' && !a.actualRentReturnDate).length;
    const repairingCount = assets.filter(a => a.status === 'REPAIRING').length;
    const returnedOrDisposedCount = assets.filter(a => a.status === 'RENTED_RETURNED' || a.status === 'SOLD' || Boolean(a.actualRentReturnDate)).length;

    const activeTotal = totalCount - returnedOrDisposedCount;
    const opRate = activeTotal > 0 ? Math.round(((rentedOpCount + assignedCount) / activeTotal) * 100) : 0;

    const totalBookValue = assets.reduce((sum, a) => {
      if (a.ownerType === 'OWNED') {
        const bv = a.bookValue ?? Math.max(0, (a.acquisitionPrice || 0) - (a.accumDepreciation || 0));
        return sum + (bv > 0 ? bv : 0);
      }
      return sum;
    }, 0);

    return {
      totalCount,
      ownedCount,
      rentedCount,
      rentedOpCount,
      assignedCount,
      availableCount,
      repairingCount,
      returnedOrDisposedCount,
      opRate,
      totalBookValue
    };
  }, [assets]);

  // 🌟 [초고속 렌더링 청크 윈도우: 헌장 1.1] 초기 50건 우선 렌더링으로 10만 개 DOM 프리징 원천 방어
  const [visibleCount, setVisibleCount] = useState(50);

  // 실시간 반응형 필터링 및 정렬
  const filtered = useMemo(() => {
    setVisibleCount(50); // 필터 변경 시 50건으로 리셋
    return assets.filter(a => {
      const renterName = getAssetRenterName(a);
      const supplierName = getAssetSupplierName(a);
      const isReturned = Boolean(a.actualRentReturnDate) || a.status === 'RENTED_RETURNED';
      
      const matchesSearch =
        !searchTerm ||
        a.assetNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.modelName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (a.serialNo && a.serialNo.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (a.manufacturer && a.manufacturer.toLowerCase().includes(searchTerm.toLowerCase())) ||
        renterName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        supplierName.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === 'ALL' ? true :
                            statusFilter === 'RENTED_RETURNED' ? isReturned :
                            statusFilter === 'AVAILABLE' ? (a.status === 'AVAILABLE' && !isReturned) :
                            a.status === statusFilter;

      const matchesOwner = ownerFilter === 'ALL' || a.ownerType === ownerFilter;
      const matchesManufacturer = manufacturerFilter === 'ALL' || a.manufacturer === manufacturerFilter;
      const matchesCustomer = customerFilter === 'ALL' || a.currentCustomerId === customerFilter;

      return matchesSearch && matchesStatus && matchesOwner && matchesManufacturer && matchesCustomer;
    }).sort((a, b) => {
      let aVal: any = sortField === 'currentCustomerId' ? getCustomerName(a.currentCustomerId) : a[sortField as keyof Asset];
      let bVal: any = sortField === 'currentCustomerId' ? getCustomerName(b.currentCustomerId) : b[sortField as keyof Asset];
      if (aVal === undefined || aVal === null) aVal = '';
      if (bVal === undefined || bVal === null) bVal = '';
      const cmp = String(aVal).localeCompare(String(bVal), 'ko', { numeric: true });
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [assets, searchTerm, statusFilter, ownerFilter, manufacturerFilter, customerFilter, sortField, sortDirection]);

  // 현재 뷰포트에 렌더링할 청크 데이터 (초기 50건 -> 스크롤 시 자동 확장)
  const visibleAssets = useMemo(() => {
    return filtered.slice(0, visibleCount);
  }, [filtered, visibleCount]);

  const handleTableScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 200) {
      if (visibleCount < filtered.length) {
        setVisibleCount(prev => Math.min(prev + 50, filtered.length));
      }
    }
  };

  const handleSort = (field: AssetSortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const renderSortArrow = (field: AssetSortField) => {
    if (sortField !== field) return <span style={{ color: 'var(--text-muted)', fontSize: '10px', marginLeft: '3px' }}>↕</span>;
    return <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '11px', marginLeft: '3px' }}>{sortDirection === 'asc' ? '▲' : '▼'}</span>;
  };

  const handleSelectAsset = (asset: Asset) => {
    setSelectedAsset(asset);
    setIsEditing(false);
    setShowHistoryToggle(false);
    setEditForm({ ...asset });
  };

  const handleStartEdit = () => {
    if (selectedAsset) {
      setEditForm({ ...selectedAsset });
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditForm(selectedAsset ? { ...selectedAsset } : {});
  };

  const handleSaveEdit = async () => {
    if (!selectedAsset || !editForm) return;
    try {
      const updated: Asset = { ...selectedAsset, ...editForm };
      await (saveAsset as any)(updated);
      setSelectedAsset(updated);
      setIsEditing(false);
      showToast(`자산 ${updated.assetNo} 정보가 저장되었습니다.`);
    } catch (err: any) {
      showErrorModal(`자산 정보 저장 실패: ${err?.message || err}`, '자산 저장 오류');
    }
  };

  const ef = (field: keyof Asset) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const val = e.target.type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value;
    setEditForm(prev => ({ ...prev, [field]: val }));
  };

  const handleExport = () => {
    const data = filtered.map((a, idx) => {
      const ci = getAssetContractInfo(a.id);
      const isReturned = Boolean(a.actualRentReturnDate) || a.status === 'RENTED_RETURNED';
      const netProfit = (a.cumRentalFee || 0) - (a.cumRepairCost || 0);
      const accumDepn = a.ownerType === 'OWNED' ? (a.accumDepreciation || 0) : 0;
      const bookVal = a.ownerType === 'OWNED' ? (a.bookValue ?? Math.max(0, (a.acquisitionPrice || 0) - accumDepn)) : 0;
      return {
        'No': idx + 1,
        '관리번호': a.assetNo || '-',
        '모델명': a.modelName || '-',
        '규격(피트)': getAssetFeet(a),
        '제조사': a.manufacturer || '-',
        '제조번호(S/N)': a.serialNo || '-',
        '연식': a.manufactureYear || '-',
        '소유구분': a.ownerType === 'OWNED' ? '당사자산' : '외부임차',
        '상태': isReturned ? '임차처 반납완료' : getAssetStatusLabel(a.status),
        '현재 고객사': getCustomerName(a.currentCustomerId),
        '현재 현장': getSiteName(a.currentSiteId),
        '계약번호': ci ? ci.contractNo : '-',
        '계약기간': a.contractStart ? `${a.contractStart.slice(0, 10)} ~ ${a.contractEnd?.slice(0, 10) || ''}` : '-',
        '청구마감일': a.billingDay ? `${a.billingDay}일` : '-',
        '월 렌탈료(원)': a.monthlyRentalFee || 0,
        '소유원사(임차처)': getAssetRenterName(a),
        '구입/공급처': getAssetSupplierName(a),
        '취득일자': a.acquisitionDate ? a.acquisitionDate.slice(0, 10) : (a.rentStart ? a.rentStart.slice(0, 10) : '-'),
        '취득원가(원)': a.acquisitionPrice || 0,
        '감가상각누계액(원)': accumDepn,
        '장부가치(원)': bookVal,
        '누적렌탈수익(원)': a.cumRentalFee || 0,
        '누적수리비(원)': a.cumRepairCost || 0,
        '기여순익(원)': netProfit,
        '정비점수': a.maintenanceScore || 0,
        '비고': a.memo || a.memo1 || '-'
      };
    });
    exportToExcel(data, `전사자산목록_${new Date().toISOString().split('T')[0]}`, '자산목록');
    showToast(`전사 자산 목록 (${filtered.length}건) 엑셀이 다운로드되었습니다.`);
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
      position: 'relative'
    }}>
      
      {/* 알림 토스트 */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '24px',
          zIndex: 9999,
          padding: '10px 18px',
          borderRadius: '6px',
          backgroundColor: toastMessage.type === 'success' ? 'var(--success)' : 'var(--danger)',
          color: '#ffffff',
          fontWeight: 600,
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'fadeIn 0.2s ease-in-out'
        }}>
          {toastMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* ① 상단 헤더 & 파이프라인 (좌상단 Scope + 우상단 Pipeline) */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        paddingBottom: '4px',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 style={{ margin: 0, fontWeight: '700', fontSize: '17px', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
            자산 관리 대장
          </h2>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            총 <strong>{assets.length}</strong>대 (조회 <strong>{filtered.length}</strong>대)
          </span>
        </div>

        {/* 우상단 파이프라인 버튼군 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            className="btn-secondary"
            onClick={handleExport}
            style={{ padding: '5px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
          >
            <Download size={13} /> 엑셀 다운로드
          </button>
          <button
            className="btn-secondary"
            onClick={() => setGlobalActiveTab('acquisition_disposal')}
            style={{ padding: '5px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
          >
            <PlusCircle size={13} /> 자산 취득 / 매각
          </button>
          <button
            className="btn-primary"
            onClick={() => setGlobalActiveTab('rent_asset')}
            style={{ padding: '5px 12px', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap' }}
          >
            <ShoppingBag size={13} /> 임차자산 관리
          </button>
        </div>
      </div>

      {/* ② 실시간 자산 운용 KPI 요약 바 (Scope) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px', flexShrink: 0 }}>
        <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>임대 가능 (주기장)</span>
          <strong style={{ fontSize: '14px', color: 'var(--success)', whiteSpace: 'nowrap' }}>{kpiStats.availableCount}대</strong>
        </div>
        <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>현장 대여중</span>
          <strong style={{ fontSize: '14px', color: 'var(--primary)', whiteSpace: 'nowrap' }}>{kpiStats.rentedOpCount}대</strong>
        </div>
        <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>출고/검수 대기</span>
          <strong style={{ fontSize: '14px', color: '#0070C0', whiteSpace: 'nowrap' }}>{kpiStats.assignedCount}대</strong>
        </div>
        <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>수리/정비중</span>
          <strong style={{ fontSize: '14px', color: 'var(--danger)', whiteSpace: 'nowrap' }}>{kpiStats.repairingCount}대</strong>
        </div>
        <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>반납/매각 완료</span>
          <strong style={{ fontSize: '14px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{kpiStats.returnedOrDisposedCount}대</strong>
        </div>
        <div style={{ padding: '7px 12px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>실가동률</span>
          <strong style={{ fontSize: '14px', color: 'var(--primary)', whiteSpace: 'nowrap' }}>{kpiStats.opRate}%</strong>
        </div>
      </div>

      {/* ③ 필터 컨트롤 바 (Vertical Header-Label Layout: 헌장 3.4) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        backgroundColor: 'var(--bg-card)',
        borderRadius: '6px',
        border: '1px solid var(--border-color)',
        flexWrap: 'wrap',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: '1', minWidth: '180px' }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>통합 검색</label>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: '8px', top: '7px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="관리번호, 모델명, 제조사, S/N, 임차처"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '4px 8px 4px 26px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)',
                fontSize: '12px'
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>소유구분</label>
          <select
            value={ownerFilter}
            onChange={e => setOwnerFilter(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', minWidth: '90px' }}
          >
            <option value="ALL">전체 소유</option>
            <option value="OWNED">당사자산</option>
            <option value="RENTED">임차자산</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>장비 상태</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', minWidth: '110px' }}
          >
            <option value="ALL">전체 상태</option>
            {Object.values(ASSET_STATUS_SSOT).map(st => (
              <option key={st.code} value={st.code}>{st.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>제조사</label>
          <select
            value={manufacturerFilter}
            onChange={e => setManufacturerFilter(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', minWidth: '100px' }}
          >
            <option value="ALL">전체 제조사</option>
            {uniqueManufacturers.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>현재 고객사</label>
          <select
            value={customerFilter}
            onChange={e => setCustomerFilter(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', fontSize: '12px', minWidth: '130px' }}
          >
            <option value="ALL">전체 고객사</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {(searchTerm || ownerFilter !== 'ALL' || statusFilter !== 'ALL' || manufacturerFilter !== 'ALL' || customerFilter !== 'ALL') && (
          <button
            onClick={() => { setSearchTerm(''); setOwnerFilter('ALL'); setStatusFilter('ALL'); setManufacturerFilter('ALL'); setCustomerFilter('ALL'); }}
            style={{
              marginTop: '16px',
              padding: '4px 8px',
              fontSize: '11.5px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap'
            }}
          >
            <RefreshCw size={11} /> 초기화
          </button>
        )}
      </div>

      {/* ④ 고밀도 전사 자산 대장 그리드 (Body / Inspection: 헌장 3.6 유형 B) */}
      <div style={{
        flex: 1,
        backgroundColor: 'var(--bg-card)',
        borderRadius: '6px',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <div
          className="table-wrapper"
          onScroll={handleTableScroll}
          style={{
            flex: 1,
            minHeight: 0,
            overflowX: 'scroll',
            overflowY: 'auto',
            position: 'relative'
          }}
        >
          <table style={{ minWidth: '2400px', width: 'max-content', borderCollapse: 'collapse', textAlign: 'left', fontSize: '11.5px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr style={{ backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontWeight: 600 }}>
                {/* 1. 상세 (고정) */}
                <th style={{ padding: '7px 8px', width: '50px', textAlign: 'center', whiteSpace: 'nowrap', position: 'sticky', left: 0, zIndex: 12, backgroundColor: 'var(--bg-app)' }}>상세</th>
                {/* 2. 관리번호 (고정) */}
                <th onClick={() => handleSort('assetNo')} style={{ padding: '7px 8px', width: '90px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', position: 'sticky', left: '50px', zIndex: 12, backgroundColor: 'var(--bg-app)' }}>
                  관리번호{renderSortArrow('assetNo')}
                </th>
                {/* 3. 모델명 */}
                <th onClick={() => handleSort('modelName')} style={{ padding: '7px 8px', width: '100px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  모델명{renderSortArrow('modelName')}
                </th>
                {/* 4. 규격/피트 */}
                <th style={{ padding: '7px 8px', width: '75px', textAlign: 'center', whiteSpace: 'nowrap' }}>규격(피트)</th>
                {/* 5. 제조사 */}
                <th onClick={() => handleSort('manufacturer')} style={{ padding: '7px 8px', width: '90px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  제조사{renderSortArrow('manufacturer')}
                </th>
                {/* 6. 제조번호(S/N) */}
                <th style={{ padding: '7px 8px', width: '100px', whiteSpace: 'nowrap' }}>제조번호(S/N)</th>
                {/* 7. 연식 */}
                <th style={{ padding: '7px 8px', width: '70px', textAlign: 'center', whiteSpace: 'nowrap' }}>연식</th>
                {/* 8. 소유구분 */}
                <th onClick={() => handleSort('ownerType')} style={{ padding: '7px 8px', width: '70px', cursor: 'pointer', userSelect: 'none', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  소유{renderSortArrow('ownerType')}
                </th>
                {/* 9. 상태 */}
                <th onClick={() => handleSort('status')} style={{ padding: '7px 8px', width: '85px', cursor: 'pointer', userSelect: 'none', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  상태{renderSortArrow('status')}
                </th>
                {/* 10. 현재 고객사 */}
                <th onClick={() => handleSort('currentCustomerId')} style={{ padding: '7px 8px', width: '140px', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  현재 고객사{renderSortArrow('currentCustomerId')}
                </th>
                {/* 11. 사용 현장 */}
                <th style={{ padding: '7px 8px', width: '150px', whiteSpace: 'nowrap' }}>사용 현장</th>
                {/* 12. 계약번호 */}
                <th style={{ padding: '7px 8px', width: '105px', textAlign: 'center', whiteSpace: 'nowrap' }}>계약번호</th>
                {/* 13. 계약기간 */}
                <th style={{ padding: '7px 8px', width: '160px', textAlign: 'center', whiteSpace: 'nowrap' }}>계약기간</th>
                {/* 14. 청구일 */}
                <th style={{ padding: '7px 8px', width: '65px', textAlign: 'center', whiteSpace: 'nowrap' }}>청구일</th>
                {/* 15. 월 렌탈료 */}
                <th style={{ padding: '7px 8px', width: '95px', textAlign: 'right', whiteSpace: 'nowrap' }}>월 렌탈료</th>
                {/* 16. 소유 원사 (임차처) */}
                <th style={{ padding: '7px 8px', width: '120px', whiteSpace: 'nowrap' }}>소유 원사 (임차처)</th>
                {/* 17. 구입/공급처 */}
                <th style={{ padding: '7px 8px', width: '120px', whiteSpace: 'nowrap' }}>구입/공급처</th>
                {/* 18. 취득/개시일 */}
                <th onClick={() => handleSort('acquisitionDate')} style={{ padding: '7px 8px', width: '90px', cursor: 'pointer', userSelect: 'none', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  취득/개시일{renderSortArrow('acquisitionDate')}
                </th>
                {/* 19. 취득원가 */}
                <th style={{ padding: '7px 8px', width: '105px', textAlign: 'right', whiteSpace: 'nowrap' }}>취득원가</th>
                {/* 20. 감가누계액 */}
                <th style={{ padding: '7px 8px', width: '105px', textAlign: 'right', whiteSpace: 'nowrap' }}>감가누계액</th>
                {/* 21. 장부가치 */}
                <th style={{ padding: '7px 8px', width: '105px', textAlign: 'right', whiteSpace: 'nowrap' }}>장부가치</th>
                {/* 22. 누적 렌탈수익 */}
                <th style={{ padding: '7px 8px', width: '105px', textAlign: 'right', whiteSpace: 'nowrap' }}>누적 렌탈수익</th>
                {/* 23. 누적 수리비 */}
                <th style={{ padding: '7px 8px', width: '95px', textAlign: 'right', whiteSpace: 'nowrap' }}>누적 수리비</th>
                {/* 24. 기여 순익 */}
                <th style={{ padding: '7px 8px', width: '105px', textAlign: 'right', whiteSpace: 'nowrap' }}>기여 순익</th>
                {/* 25. 정비점수 */}
                <th style={{ padding: '7px 8px', width: '70px', textAlign: 'center', whiteSpace: 'nowrap' }}>정비점수</th>
                {/* 26. 비고 */}
                <th style={{ padding: '7px 8px', width: '140px', whiteSpace: 'nowrap' }}>비고</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={26} style={{ padding: '36px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                    조회 조건에 해당하는 자산이 없습니다.
                  </td>
                </tr>
              ) : (
                visibleAssets.map(a => {
                  const ci = getAssetContractInfo(a.id);
                  const isReturned = Boolean(a.actualRentReturnDate) || a.status === 'RENTED_RETURNED';
                  const renterName = getAssetRenterName(a);
                  const supplierName = getAssetSupplierName(a);
                  const custName = getCustomerName(a.currentCustomerId);
                  const siteName = getSiteName(a.currentSiteId);
                  const netProfit = (a.cumRentalFee || 0) - (a.cumRepairCost || 0);
                  const accumDepn = a.ownerType === 'OWNED' ? (a.accumDepreciation || 0) : 0;
                  const bookVal = a.ownerType === 'OWNED' ? (a.bookValue ?? Math.max(0, (a.acquisitionPrice || 0) - accumDepn)) : 0;

                  return (
                    <tr
                      key={a.id}
                      onClick={() => handleSelectAsset(a)}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s',
                        opacity: isReturned || a.status === 'SOLD' ? 0.75 : 1
                      }}
                      className="hover-row"
                    >
                      {/* 1. 상세 버튼 (고정) */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap', position: 'sticky', left: 0, zIndex: 2, backgroundColor: 'var(--bg-card)' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSelectAsset(a); }}
                          style={{
                            padding: '2px 6px',
                            fontSize: '11px',
                            border: '1px solid var(--border-color)',
                            borderRadius: '3px',
                            backgroundColor: 'transparent',
                            cursor: 'pointer',
                            color: 'var(--primary)',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          보기
                        </button>
                      </td>

                      {/* 2. 관리번호 (고정) */}
                      <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap', position: 'sticky', left: '50px', zIndex: 2, backgroundColor: 'var(--bg-card)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span>{a.assetNo}</span>
                          {a.ownerType === 'RENTED' && (
                            <span className="badge badge-info" style={{ fontSize: '9.5px', padding: '1px 4px' }}>임차</span>
                          )}
                        </div>
                      </td>

                      {/* 3. 모델명 */}
                      <td style={{ padding: '6px 8px', color: 'var(--text-main)', fontWeight: 600, whiteSpace: 'nowrap' }}>{a.modelName}</td>

                      {/* 4. 규격(피트) */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        <span className="badge badge-secondary" style={{ fontSize: '10px' }}>{getAssetFeet(a)}</span>
                      </td>

                      {/* 5. 제조사 */}
                      <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{a.manufacturer || '-'}</td>

                      {/* 6. 시리얼번호 */}
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {a.serialNo || '-'}
                      </td>

                      {/* 7. 연식 */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>{a.manufactureYear || '-'}</td>

                      {/* 8. 소유구분 */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <span className={`badge ${a.ownerType === 'OWNED' ? 'badge-success' : 'badge-info'}`} style={{ fontSize: '10px', padding: '1px 5px' }}>
                          {a.ownerType === 'OWNED' ? '당사' : '임차'}
                        </span>
                      </td>

                      {/* 9. FSM 운용 상태 */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {isReturned ? (
                          <span className="badge badge-secondary" style={{ fontSize: '10px', padding: '1px 5px' }}>임차처 반납완료</span>
                        ) : a.status === 'SOLD' ? (
                          <span className="badge badge-danger" style={{ fontSize: '10px', padding: '1px 5px' }}>매각 처분완료</span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
                            <span className={`badge ${getAssetStatusBadgeClass(a.status)}`} style={{ fontSize: '10px', padding: '1px 5px' }}>
                              {getAssetStatusLabel(a.status)}
                            </span>
                            {a.status === 'REPAIRING' && (() => {
                              const extRep = repairs?.find(r => r.assetId === a.id && r.status === 'IN_PROGRESS' && r.maintenanceType === 'EXTERNAL');
                              if (extRep) {
                                const vName = vendors?.find(v => v.id === extRep.vendorId)?.name || '외주처';
                                return (
                                  <span className="badge" style={{ fontSize: '9px', padding: '1px 4px', backgroundColor: '#8b5cf6', color: '#ffffff', whiteSpace: 'nowrap' }}>
                                    외주:{vName}
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        )}
                      </td>

                      {/* 10. 현재 고객사 */}
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                        {custName !== '-' ? (
                          <strong style={{ color: 'var(--text-main)' }}>{custName}</strong>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>-</span>
                        )}
                      </td>

                      {/* 11. 사용 현장 */}
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                        {siteName !== '-' ? siteName : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                      </td>

                      {/* 12. 계약번호 */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                        {ci ? <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{ci.contractNo}</span> : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                      </td>

                      {/* 13. 계약기간 */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {a.contractStart ? `${a.contractStart.slice(0, 10)} ~ ${a.contractEnd?.slice(0, 10) || ''}` : '-'}
                      </td>

                      {/* 14. 청구일 */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '11px', whiteSpace: 'nowrap' }}>
                        {a.billingDay ? `${a.billingDay}일` : '-'}
                      </td>

                      {/* 15. 월 렌탈료 */}
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                        {a.monthlyRentalFee ? `₩${a.monthlyRentalFee.toLocaleString()}` : '-'}
                      </td>

                      {/* 16. 소유 원사 (임차처) - 임차자산 전용 */}
                      <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                        {renterName !== '-' ? renterName : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                      </td>

                      {/* 17. 구입/공급처 - 당사자산 전용 */}
                      <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                        {supplierName !== '-' ? supplierName : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                      </td>

                      {/* 18. 취득/개시일자 */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {a.acquisitionDate ? a.acquisitionDate.slice(0, 10) : (a.rentStart ? a.rentStart.slice(0, 10) : '-')}
                      </td>

                      {/* 19. 취득원가 */}
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                        {a.ownerType === 'OWNED'
                          ? `₩${(a.acquisitionPrice || 0).toLocaleString()}`
                          : <span style={{ color: 'var(--text-muted)' }}>(임차자산)</span>}
                      </td>

                      {/* 20. 감가누계액 */}
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {a.ownerType === 'OWNED'
                          ? <span style={{ color: 'var(--danger)' }}>₩{accumDepn.toLocaleString()}</span>
                          : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                      </td>

                      {/* 21. 장부가치 */}
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {a.ownerType === 'OWNED'
                          ? <span style={{ color: 'var(--success)' }}>₩{bookVal.toLocaleString()}</span>
                          : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                      </td>

                      {/* 22. 누적 렌탈수익 */}
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                        ₩{(a.cumRentalFee || 0).toLocaleString()}
                      </td>

                      {/* 23. 누적 수리비 */}
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        ₩{(a.cumRepairCost || 0).toLocaleString()}
                      </td>

                      {/* 24. 기여 순익 */}
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', color: netProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {netProfit >= 0 ? `+₩${netProfit.toLocaleString()}` : `-₩${Math.abs(netProfit).toLocaleString()}`}
                      </td>

                      {/* 25. 정비점수 */}
                      <td style={{ padding: '6px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <span className={`badge ${(a.maintenanceScore || 0) === 0 ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '10px' }}>
                          {a.maintenanceScore || 0}점
                        </span>
                      </td>

                      {/* 26. 비고 */}
                      <td style={{ padding: '6px 8px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }} title={a.memo || a.memo1 || ''}>
                        {a.memo || a.memo1 || '-'}
                      </td>
                    </tr>
                  );
                })
              )}

              {/* 🌟 [청크 로딩 안내 & 전체 확장 행: 헌장 1.1] */}
              {visibleCount < filtered.length && (
                <tr style={{ backgroundColor: 'var(--bg-app)', borderTop: '2px dashed var(--border-color)' }}>
                  <td colSpan={26} style={{ padding: '10px 16px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        현재 <strong>{visibleAssets.length}</strong>대 표시 중 (전체 {filtered.length}대 중 잔여 {filtered.length - visibleAssets.length}대)
                      </span>
                      <button
                        onClick={() => setVisibleCount(prev => Math.min(prev + 100, filtered.length))}
                        className="btn-secondary"
                        style={{ padding: '3px 10px', fontSize: '11px', cursor: 'pointer' }}
                      >
                        +100대 더 보기
                      </button>
                      <button
                        onClick={() => setVisibleCount(filtered.length)}
                        className="btn-primary"
                        style={{ padding: '3px 12px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                      >
                        전체 {filtered.length}대 한 번에 펼치기
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ⑤ 우하단 Terminal Action: 전사 자산 회계 대차대조식 검증 바 (헌장 3.5) */}
        <div style={{
          padding: '8px 14px',
          backgroundColor: 'var(--bg-app)',
          borderTop: '1px solid var(--border-color)',
          boxShadow: '0 -2px 6px rgba(0,0,0,0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          fontSize: '11.5px',
          borderRadius: '0 0 6px 6px',
          flexShrink: 0,
          zIndex: 15
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span>전사 등록자산: <strong style={{ color: 'var(--primary)' }}>{kpiStats.totalCount}대</strong> (당사 {kpiStats.ownedCount}대 + 임차 {kpiStats.rentedCount}대)</span>
            <span>|</span>
            <span>실가동률: <strong style={{ color: 'var(--success)' }}>{kpiStats.opRate}%</strong> (대여중 {kpiStats.rentedOpCount}대 + 대기 {kpiStats.assignedCount}대)</span>
            <span>|</span>
            <span>당사자산 장부가 총액: <strong style={{ color: 'var(--primary)' }}>₩{kpiStats.totalBookValue.toLocaleString()}원</strong></span>
          </div>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: 'var(--success-light)',
            color: 'var(--success)',
            fontWeight: 700,
            fontSize: '11px'
          }}>
            ⚖️ 대차 정상 (전사 자산 대사 완결)
          </span>
        </div>
      </div>

      {/* ⑥ 서랍형 상세 Dossier 슬라이드오버 (헌장 3.6 마스터-디테일 스튜디오) */}
      {selectedAsset && (() => {
        const isReturned = Boolean(selectedAsset.actualRentReturnDate) || selectedAsset.status === 'RENTED_RETURNED';
        const renterName = getAssetRenterName(selectedAsset);
        const supplierName = getAssetSupplierName(selectedAsset);
        const depn = calculateAssetDepreciation(isEditing ? { ...selectedAsset, ...editForm } as Asset : selectedAsset);
        const netProfit = (selectedAsset.cumRentalFee || 0) - (selectedAsset.cumRepairCost || 0);

        return (
          <div style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: '500px',
            maxWidth: '92vw',
            backgroundColor: 'var(--bg-card)',
            borderLeft: '1px solid var(--border-color)',
            boxShadow: '-4px 0 20px rgba(0,0,0,0.18)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideLeft 0.2s ease-in-out'
          }}>
            {/* 서랍 헤더 */}
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--bg-app)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Layers className="text-primary" size={16} />
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)' }}>
                  {selectedAsset.assetNo} {isEditing ? '자산 정보 수정' : '자산 상세 명세서'}
                </span>
                {isReturned ? (
                  <span className="badge badge-secondary" style={{ fontSize: '10px' }}>반납완료</span>
                ) : (
                  <span className={`badge ${getAssetStatusBadgeClass(selectedAsset.status)}`} style={{ fontSize: '10px' }}>
                    {getAssetStatusLabel(selectedAsset.status)}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {canEdit && !isEditing && (
                  <button
                    className="btn-primary"
                    onClick={handleStartEdit}
                    style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Edit2 size={12} /> 수정
                  </button>
                )}
                {isEditing && (
                  <>
                    <button
                      className="btn-success"
                      onClick={handleSaveEdit}
                      style={{ padding: '3px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Save size={12} /> 저장
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={handleCancelEdit}
                      style={{ padding: '3px 8px', fontSize: '11px' }}
                    >
                      취소
                    </button>
                  </>
                )}
                <button
                  onClick={() => { if (!isEditing) setSelectedAsset(null); }}
                  style={{ border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* 서랍 본문 스크롤 영역 */}
            <div style={{ padding: '16px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '12px' }}>
              
              {/* 1. 기본 장비 물리 제원 */}
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px' }}>1. 기본 장비 물리 제원</div>
                {isEditing ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div><label style={labelStyle}>관리번호</label><input style={inputStyle} value={editForm.assetNo || ''} onChange={ef('assetNo')} /></div>
                    <div><label style={labelStyle}>모델명</label><input style={inputStyle} value={editForm.modelName || ''} onChange={ef('modelName')} /></div>
                    <div><label style={labelStyle}>제조번호 (S/N)</label><input style={inputStyle} value={editForm.serialNo || ''} onChange={ef('serialNo')} /></div>
                    <div><label style={labelStyle}>제조사</label><input style={inputStyle} value={editForm.manufacturer || ''} onChange={ef('manufacturer')} /></div>
                    <div><label style={labelStyle}>제조년도</label><input style={inputStyle} value={editForm.manufactureYear || ''} onChange={ef('manufactureYear')} /></div>
                    <div>
                      <label style={labelStyle}>소유구분</label>
                      <select style={inputStyle} value={editForm.ownerType || 'OWNED'} onChange={ef('ownerType')}>
                        <option value="OWNED">당사자산</option>
                        <option value="RENTED">임차자산</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>상태</label>
                      <select style={inputStyle} value={editForm.status || 'AVAILABLE'} onChange={ef('status')}>
                        {Object.values(ASSET_STATUS_SSOT).map(st => (
                          <option key={st.code} value={st.code}>{st.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11.5px' }}>
                    <div><span style={{ color: 'var(--text-secondary)' }}>관리번호:</span> <strong>{selectedAsset.assetNo}</strong></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>모델명:</span> <strong>{selectedAsset.modelName}</strong></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>제조사:</span> {selectedAsset.manufacturer || '-'}</div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>제조번호:</span> {selectedAsset.serialNo || '-'}</div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>연식:</span> {selectedAsset.manufactureYear || '-'}</div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>소유구분:</span> {selectedAsset.ownerType === 'OWNED' ? '당사자산' : '임차자산'}</div>
                  </div>
                )}
              </div>

              {/* 2. 현재 운용 / 임대 현황 */}
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px' }}>2. 현재 운용 / 임대 현황</div>
                {isEditing ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div><label style={labelStyle}>월 렌탈료 (원)</label><input type="number" style={inputStyle} value={editForm.monthlyRentalFee ?? ''} onChange={ef('monthlyRentalFee')} /></div>
                    <div><label style={labelStyle}>일 렌탈료 (원)</label><input type="number" style={inputStyle} value={editForm.dailyRentalFee ?? ''} onChange={ef('dailyRentalFee')} /></div>
                    <div><label style={labelStyle}>청구 마감일 (일)</label><input type="number" style={inputStyle} value={editForm.billingDay ?? ''} onChange={ef('billingDay')} /></div>
                    <div><label style={labelStyle}>계약 시작일</label><input type="date" style={inputStyle} value={editForm.contractStart || ''} onChange={ef('contractStart')} /></div>
                    <div><label style={labelStyle}>계약 종료일</label><input type="date" style={inputStyle} value={editForm.contractEnd || ''} onChange={ef('contractEnd')} /></div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11.5px' }}>
                    <div><span style={{ color: 'var(--text-secondary)' }}>계약번호:</span> {(() => { const ci = getAssetContractInfo(selectedAsset.id); return ci ? <strong style={{ color: 'var(--primary)' }}>{ci.contractNo}</strong> : '-'; })()}</div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>현재 고객사:</span> <strong>{getCustomerName(selectedAsset.currentCustomerId)}</strong></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>사용 현장:</span> {getSiteName(selectedAsset.currentSiteId)}</div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>청구 마감일:</span> {selectedAsset.billingDay ? `매달 ${selectedAsset.billingDay}일` : '-'}</div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>월 렌탈료:</span> <strong>₩{(selectedAsset.monthlyRentalFee || 0).toLocaleString()}</strong></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>계약 기간:</span> {selectedAsset.contractStart ? `${selectedAsset.contractStart} ~ ${selectedAsset.contractEnd}` : '-'}</div>
                  </div>
                )}
              </div>

              {/* 3. 소유 속성별 재무/임차 정보 */}
              {(isEditing ? editForm.ownerType === 'OWNED' : selectedAsset.ownerType === 'OWNED') ? (
                <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px' }}>3. 당사자산 감가상각 / 장부가치</div>
                  {isEditing ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <div><label style={labelStyle}>취득일자</label><input type="date" style={inputStyle} value={editForm.acquisitionDate || ''} onChange={ef('acquisitionDate')} /></div>
                      <div><label style={labelStyle}>취득원가 (원)</label><input type="number" style={inputStyle} value={editForm.acquisitionPrice ?? ''} onChange={ef('acquisitionPrice')} /></div>
                      <div><label style={labelStyle}>구입처 (공급자)</label><input style={inputStyle} value={editForm.supplier || ''} onChange={ef('supplier')} /></div>
                      <div><label style={labelStyle}>내용연수(개월)</label><input type="number" style={inputStyle} value={editForm.depreciationMonths ?? ''} onChange={ef('depreciationMonths')} /></div>
                      <div><label style={labelStyle}>잔존가치율 (%)</label><input type="number" style={inputStyle} value={editForm.residualValueRate ?? ''} onChange={ef('residualValueRate')} /></div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11.5px' }}>
                      <div><span style={{ color: 'var(--text-secondary)' }}>취득일자:</span> {selectedAsset.acquisitionDate || '-'}</div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>취득원가:</span> <strong>₩{(selectedAsset.acquisitionPrice || 0).toLocaleString()}</strong></div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>구입처:</span> <strong>{supplierName}</strong></div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>내용연수:</span> {selectedAsset.depreciationMonths ? `${selectedAsset.depreciationMonths}개월 (경과: ${depn.elapsedMonths}개월)` : '-'}</div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>감가누계액:</span> <strong style={{ color: 'var(--danger)' }}>₩{depn.accumDepreciation.toLocaleString()}</strong></div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>미상각 장부가:</span> <strong style={{ color: 'var(--success)' }}>₩{depn.bookValue.toLocaleString()}</strong></div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px' }}>3. 소유 원사 임차 약정 조건</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11.5px' }}>
                    <div><span style={{ color: 'var(--text-secondary)' }}>소유 원사:</span> <strong>{renterName}</strong></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>월 임차료:</span> <strong style={{ color: 'var(--danger)' }}>₩{(selectedAsset.monthlyRentFee || 0).toLocaleString()}</strong></div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>임차 시작일:</span> {selectedAsset.rentStart || '-'}</div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>임차 만료예정:</span> {selectedAsset.rentEnd || '-'}</div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>원사 반납일:</span> {selectedAsset.actualRentReturnDate ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>{selectedAsset.actualRentReturnDate} (반납)</span> : '미반납'}</div>
                    <div><span style={{ color: 'var(--text-secondary)' }}>일할 단가:</span> ₩{(selectedAsset.dailyRentFee || 0).toLocaleString()}</div>
                  </div>
                </div>
              )}

              {/* 4. 자산 손익 및 공헌이익 */}
              <div style={{ padding: '10px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px' }}>4. 누적 손익 및 공헌이익</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11.5px' }}>
                  <div><span style={{ color: 'var(--text-secondary)' }}>누적 렌탈수익:</span> <strong style={{ color: 'var(--primary)' }}>₩{(selectedAsset.cumRentalFee || 0).toLocaleString()}</strong></div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>누적 수리비:</span> <strong style={{ color: 'var(--danger)' }}>₩{(selectedAsset.cumRepairCost || 0).toLocaleString()}</strong></div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>기여 순이익:</span>{' '}
                    <strong style={{ color: netProfit >= 0 ? 'var(--success)' : 'var(--danger)', fontSize: '13px' }}>
                      {netProfit >= 0 ? `+₩${netProfit.toLocaleString()}` : `-₩${Math.abs(netProfit).toLocaleString()}`}
                    </strong>
                  </div>
                </div>
              </div>

              {/* 5. 정비 및 검수 이력 현황 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>5. 정비 및 감사 이력 현황</div>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleExportAssetHistoryExcel(selectedAsset)}
                    style={{ padding: '2px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Download size={11} /> 이력 엑셀
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '8px', backgroundColor: 'var(--bg-app)', padding: '8px 10px', borderRadius: '4px', fontSize: '11.5px' }}>
                  <span>정비필요점수: <strong>{selectedAsset.maintenanceScore || 0}점</strong></span>
                  <span>|</span>
                  <span>누적 수리: <strong>{repairs.filter((r: Repair) => r.assetId === selectedAsset.id).length}회</strong></span>
                </div>

                {/* 이력 타임라인 */}
                <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {(() => {
                    const unifiedLogs = getUnifiedAssetLogs(selectedAsset);
                    if (unifiedLogs.length === 0) {
                      return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>기록된 이력이 없습니다.</div>;
                    }
                    return unifiedLogs.map((log: AssetInOutLog, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '4px',
                          backgroundColor: 'var(--bg-app)',
                          border: '1px solid var(--border-color)',
                          fontSize: '11px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className={`badge ${log.type === 'ACQUISITION' ? 'badge-info' : log.type === 'OUTBOUND' ? 'badge-primary' : log.type === 'INBOUND' ? 'badge-success' : log.type === 'DISPOSAL' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '9.5px' }}>
                            {log.type === 'ACQUISITION' ? '취득' : log.type === 'OUTBOUND' ? '출고' : log.type === 'INBOUND' ? '입고' : log.type === 'INBOUND_CANCEL' ? '입고취소' : log.type === 'DISPOSAL' ? '매각' : '정비'}
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>{log.eventDate}</span>
                        </div>
                        <div style={{ color: 'var(--text-main)', marginTop: '2px' }}>{log.memo || '이상 무'}</div>
                      </div>
                    ));
                  })()}
                </div>
              </div>

            </div>

            {/* 서랍 푸터 */}
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedAsset(null)}
                style={{ padding: '5px 14px', fontSize: '12px' }}
              >
                닫기
              </button>
            </div>
          </div>
        );
      })()}

    </div>
  );
};

// 헬퍼 스타일
const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-muted)',
  fontWeight: '600',
  display: 'block',
  marginBottom: '3px',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: '12px',
  borderRadius: '4px',
  border: '1px solid var(--border-color)',
  backgroundColor: 'var(--bg-app)',
  color: 'var(--text-main)',
  boxSizing: 'border-box',
};
