// src/pages/asset_history.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Search, Download, Layers, ArrowUpRight, ArrowDownLeft, 
  CheckCircle2, RotateCcw, AlertTriangle, ShieldCheck, Camera
} from 'lucide-react';
import { exportToExcel } from '../services/excel';
import { InboundDefectDetail, formatContractEndDate } from '../services/db';
import { compressImageFile } from '../utils/imageCompressor';

export const AssetHistory: React.FC = () => {
  const { 
    assetInOutLogs, assets, customers, sites, contractAssets, contracts, 
    navigationPayload, setNavigationPayload,
    inspectionChecklistItems, registerInboundAsset, cancelInboundAsset, fullRefreshFromServer, googleConfigs, showErrorModal
  } = useApp();

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 1. 탭 상태: 'INBOUND_REGISTER' | 'INBOUND' | 'OUTBOUND'
  const [activeTab, setActiveTab] = useState<'INBOUND_REGISTER' | 'INBOUND' | 'OUTBOUND'>('INBOUND_REGISTER');

  const getTodayStr = () => new Date().toISOString().split('T')[0];
  const todayStr = getTodayStr();

  // 2. 검색 및 조회기간 입력 상태 (사용자 조작용)
  const [inputStartDate, setInputStartDate] = useState('');
  const [inputEndDate, setInputEndDate] = useState(todayStr);
  const [inputSearchTerm, setInputSearchTerm] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');

  // 3. 확정 조회 조건 (명시적 [조회] 버튼 클릭 시에만 갱신)
  const [activeSearchParams, setActiveSearchParams] = useState({
    startDate: '',
    endDate: todayStr,
    searchTerm: ''
  });


  // 💡 [입고 등록 폼 상태] (수동 점수 입력 제거 ➔ 정비 필요 항목 체크박스 선택 연동 + 사진 첨부)
  const [inboundAssetNoInput, setInboundAssetNoInput] = useState('');
  const [selectedInboundAssetId, setSelectedInboundAssetId] = useState('');
  const [inboundDate, setInboundDate] = useState(todayStr);
  const [selectedChecklistIds, setSelectedChecklistIds] = useState<string[]>([]);
  const [defectPhotos, setDefectPhotos] = useState<Record<string, string>>({}); // { checkitemId: photoUrlBase64 }
  const [inboundMemo, setInboundMemo] = useState('');
  const [isSubmittingInbound, setIsSubmittingInbound] = useState(false);

  // 💡 [사장님 지시] 사전 정의 정비 필요 항목 점수 100% 자동 합산 (수동 입력 휴먼에러 전면 제거)
  const selectedChecklistObjects = inspectionChecklistItems.filter(item => selectedChecklistIds.includes(item.id));
  const calculatedInboundScore = selectedChecklistObjects.reduce((sum, item) => sum + item.score, 0);
  const selectedChecklistSummary = selectedChecklistObjects.map(item => `${item.name}(+${item.score}점)`).join(', ');

  // 💡 정비 점검 항목 퀵버튼 원클릭 토글
  const toggleChecklistItem = (itemId: string) => {
    let newIds: string[];
    if (selectedChecklistIds.includes(itemId)) {
      newIds = selectedChecklistIds.filter(id => id !== itemId);
      setDefectPhotos(prev => {
        const next = { ...prev };
        delete next[itemId];
        try { sessionStorage.setItem('inbound_draft_photos', JSON.stringify(next)); } catch (err) {}
        return next;
      });
    } else {
      newIds = [...selectedChecklistIds, itemId];
    }
    setSelectedChecklistIds(newIds);
    try { sessionStorage.setItem('inbound_draft_checklist', JSON.stringify(newIds)); } catch (err) {}
  };
  // 💡 [입고 취소 롤백] 전용 모달 상태 (window.prompt 퇴출)
  const [cancelModal, setCancelModal] = useState<{ isOpen: boolean; log: any; reason: string } | null>(null);

  // 💡 모바일 카메라 촬영 앱 전환 후 복귀 시 자동 복원 (SessionStorage Auto Recovery)
  useEffect(() => {
    try {
      const savedAssetNo = sessionStorage.getItem('inbound_draft_assetNo');
      const savedChecklist = sessionStorage.getItem('inbound_draft_checklist');
      const savedMemo = sessionStorage.getItem('inbound_draft_memo');
      const savedPhotos = sessionStorage.getItem('inbound_draft_photos');

      if (savedAssetNo) setInboundAssetNoInput(savedAssetNo);
      if (savedChecklist) setSelectedChecklistIds(JSON.parse(savedChecklist));
      if (savedMemo) setInboundMemo(savedMemo);
      if (savedPhotos) setDefectPhotos(JSON.parse(savedPhotos));
    } catch (e) {}
  }, []);

  // 💡 [사진 업로드 처리] (모바일 고해상도 카메라 10MB+ ➔ 100KB 경량화 압축)
  const handlePhotoFileChange = async (itemId: string, file: File | null) => {
    if (!file) return;
    try {
      const compressedDataUrl = await compressImageFile(file);
      if (compressedDataUrl) {
        setDefectPhotos(prev => ({ ...prev, [itemId]: compressedDataUrl }));
      }
    } catch (err: any) {
      const msg = err?.message || '사진 처리 중 오류가 발생했습니다.';
      showErrorModal(msg);
    }
  };

  // 0. 타 탭 이동 페이로드(특정 자산 이력 조회) 감지
  useEffect(() => {
    if (navigationPayload && navigationPayload.assetId) {
      setSelectedAssetId(navigationPayload.assetId);
      setNavigationPayload(null); // 페이로드 소비 후 소멸
    }
  }, [navigationPayload]);

  // 💡 명시적 [조회] 버튼 실행 헬퍼 (Supabase 클라우드 원격 DB 동기화 연동)
  const handleSearch = async (overrideStart?: string, overrideEnd?: string) => {
    if (fullRefreshFromServer) {
      try { await fullRefreshFromServer(); } catch (e) {}
    }
    setActiveSearchParams({
      startDate: overrideStart !== undefined ? overrideStart : inputStartDate,
      endDate: overrideEnd !== undefined ? overrideEnd : inputEndDate,
      searchTerm: inputSearchTerm
    });
  };

  // 💡 기간 빠른 선택 (오늘 / 1주 / 1개월 / 전체)
  const setQuickRange = (rangeType: 'TODAY' | 'WEEK' | 'MONTH' | 'ALL') => {
    const today = new Date();
    let newStart = '';
    let newEnd = todayStr;

    if (rangeType === 'TODAY') {
      newStart = todayStr;
    } else if (rangeType === 'WEEK') {
      const pastWeek = new Date(today);
      pastWeek.setDate(today.getDate() - 7);
      newStart = pastWeek.toISOString().split('T')[0];
    } else if (rangeType === 'MONTH') {
      const pastMonth = new Date(today);
      pastMonth.setMonth(today.getMonth() - 1);
      newStart = pastMonth.toISOString().split('T')[0];
    } else if (rangeType === 'ALL') {
      newStart = '';
    }

    setInputStartDate(newStart);
    setInputEndDate(newEnd);
    handleSearch(newStart, newEnd);
  };

  // =========================================================================
  // 🌟 [핵심 엔진 1: 정밀 모델명 보정 엔진 (100% Precision Matcher)]
  // =========================================================================
  const resolvePrecisionModelName = (assetId?: string, assetNo?: string, rawModel?: string): string => {
    // 1. assets 마스터 데이터 교차 검증 (자산 식별자 1:1 매칭)
    const matchedAsset = assets.find(a => 
      (assetId && a.id === assetId) || 
      (assetNo && a.assetNo && a.assetNo.trim().toLowerCase() === assetNo.trim().toLowerCase())
    );
    if (matchedAsset?.modelName && matchedAsset.modelName !== '고소작업대' && matchedAsset.modelName !== '전체장비') {
      return matchedAsset.modelName;
    }

    // 2. rawModel 검사 (이미 구체적 세부 기종인 경우)
    if (rawModel && rawModel !== '고소작업대' && rawModel !== '전체장비' && rawModel !== '기종확인필요' && rawModel !== '미지정') {
      return rawModel;
    }

    // 3. 자산번호 패턴 기반 세부 기종 정밀 추론
    if (assetNo) {
      const u = assetNo.toUpperCase().trim();
      if (u.startsWith('G19') || u.startsWith('GS19') || u.includes('1930')) return 'GS-1930';
      if (u.startsWith('S32') || u.startsWith('SJ32') || u.includes('3219')) return 'SJ-3219';
      if (u.startsWith('G26') || u.startsWith('GS26') || u.includes('2646')) return 'GS-2646';
      if (u.startsWith('S46') || u.startsWith('SJ46') || u.includes('4626')) return 'SJ-4626';
      if (u.startsWith('G32') || u.startsWith('GS32') || u.includes('3246')) return 'GS-3246';
      if (u.startsWith('Z34') || u.includes('3422')) return 'Z-34/22N';
      if (u.startsWith('Z45') || u.includes('4525')) return 'Z-45/25J';
      if (u.startsWith('S40') || u.startsWith('S-40')) return 'S-40';
      if (u.startsWith('S60') || u.startsWith('S-60')) return 'S-60';
    }

    return matchedAsset?.modelName || 'GS-1930';
  };

  // 💡 입출고 탭용 로그 필터링 (INBOUND, OUTBOUND)
  const filteredTabLogs = useMemo(() => {
    return assetInOutLogs.filter(log => {
      if (log.type !== activeTab) return false;
      if (log.eventDate > todayStr) return false;
      if (selectedAssetId && log.assetId !== selectedAssetId) return false;
      if (activeSearchParams.startDate && log.eventDate < activeSearchParams.startDate) return false;
      if (activeSearchParams.endDate && log.eventDate > activeSearchParams.endDate) return false;

      if (activeSearchParams.searchTerm.trim()) {
        const term = activeSearchParams.searchTerm.toLowerCase();
        const matchesAssetNo = log.assetNo.toLowerCase().includes(term);
        const matchesModel = log.modelName.toLowerCase().includes(term);
        const matchesCustomer = log.customerName && log.customerName.toLowerCase().includes(term);
        const matchesSite = log.siteName && log.siteName.toLowerCase().includes(term);
        const matchesMemo = log.memo && log.memo.toLowerCase().includes(term);

        if (!matchesAssetNo && !matchesModel && !matchesCustomer && !matchesSite && !matchesMemo) {
          return false;
        }
      }
      return true;
    }).sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());
  }, [assetInOutLogs, activeTab, selectedAssetId, activeSearchParams, todayStr]);

  // 💡 [오타방지 및 유연매칭] 입고 등록용 선택된 자산 정보 및 대여 계약 자동 매칭 탐색
  const inboundTargetAsset = assets.find(a => a.id === selectedInboundAssetId || a.assetNo.toLowerCase() === inboundAssetNoInput.trim().toLowerCase());
  const inboundContractAsset = inboundTargetAsset ? (
    contractAssets.find(ca => ca.assetId === inboundTargetAsset.id && ca.status === 'RENTED') ||
    contractAssets.find(ca => ca.assetId === inboundTargetAsset.id && ca.status !== 'RETURNED') ||
    contractAssets.find(ca => ca.assetId === inboundTargetAsset.id)
  ) : null;
  const inboundContract = inboundContractAsset ? contracts.find(c => c.id === inboundContractAsset.contractId) : null;
  const inboundCustomer = inboundContract ? customers.find(c => c.id === inboundContract.customerId) : null;
  const inboundSite = inboundContract ? sites.find(s => s.id === inboundContract.siteId) : null;

  // 입고 등록 전송 실행
  const handleSubmitInbound = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!inboundTargetAsset) {
      showErrorModal('입고 처리할 대상 자산의 정확한 관리번호를 입력해 주세요.');
      return;
    }

    try {
      setIsSubmittingInbound(true);
      const combinedMemo = selectedChecklistSummary 
        ? `[정비 필요 항목: ${selectedChecklistSummary}] ${inboundMemo}`.trim()
        : (inboundMemo.trim() || '입고 검수 이상 무');

      const uploadedPhotoUrls: Record<string, string> = {};
      const config = googleConfigs[0];
      const accountId = config?.r2AccountId || '35014a2514680107d74e1e68d96e6c32';
      const bucketName = config?.r2BucketName || 'kiyeun-storage';
      const accessKeyId = config?.r2AccessKeyId || '03cdb7560d37242de608a5db2a976030';
      const secretAccessKey = config?.r2SecretAccessKey || 'b2407ab4532e02317860bc3d63226fb7bc232e88083b150c15023906ed141986';

      for (const item of selectedChecklistObjects) {
        const base64 = defectPhotos[item.id];
        if (!base64) continue;
        try {
          const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const fileName = `inbound_${inboundTargetAsset.assetNo}_${item.id}_${dateStr}.jpg`;
          const key = `inbound/${inboundTargetAsset.assetNo}/${fileName}`;

          const res = await fetch('/api/r2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'upload',
              accountId,
              bucketName,
              accessKeyId,
              secretAccessKey,
              key,
              base64Content: base64,
              contentType: 'image/jpeg'
            })
          });

          const resJson = await res.json();
          if (resJson.success) {
            uploadedPhotoUrls[item.id] = resJson.publicUrl || `https://pub-drcf-bucket.r2.dev/${key}`;
          } else {
            showErrorModal(`사진 업로드 실패 (${item.name}): ${resJson.error}`);
          }
        } catch (uploadErr: any) {
          showErrorModal(`사진 네트워크 업로드 실패 (${item.name}): ${uploadErr.message || uploadErr}`);
        }
      }

      const defectPayloads: InboundDefectDetail[] = selectedChecklistObjects.map(item => ({
        subNo: '',
        checkitemId: item.id,
        checkitemName: item.name,
        score: item.score,
        photoUrl: uploadedPhotoUrls[item.id] || undefined
      }));

      await registerInboundAsset({
        assetId: inboundTargetAsset.id,
        returnDate: inboundDate,
        maintenanceScore: Math.max(0, calculatedInboundScore),
        defects: defectPayloads,
        photos: Object.values(uploadedPhotoUrls).filter(Boolean),
        memo: combinedMemo
      });

      showToast(`[입고 등록 완결] 자산 ${inboundTargetAsset.assetNo} 입고 등록 및 자산 상태 갱신이 완료되었습니다.`);
      
      setSelectedInboundAssetId('');
      setInboundAssetNoInput('');
      setSelectedChecklistIds([]);
      setDefectPhotos({});
      setInboundMemo('');
      try {
        sessionStorage.removeItem('inbound_draft_assetNo');
        sessionStorage.removeItem('inbound_draft_checklist');
        sessionStorage.removeItem('inbound_draft_memo');
        sessionStorage.removeItem('inbound_draft_photos');
      } catch (e) {}
      setActiveTab('INBOUND');
    } catch (err: any) {
      showErrorModal(`⚠️ 입고 등록 중 오류 발생: ${err?.message || err}`);
    } finally {
      setIsSubmittingInbound(false);
    }
  };

  // 💡 [입고 취소 롤백]
  const handleCancelInbound = (log: any) => {
    setCancelModal({
      isOpen: true,
      log,
      reason: '사용자 입력 오타로 인한 입고 취소 롤백'
    });
  };

  const handleConfirmCancelInbound = async () => {
    if (!cancelModal) return;
    const { log, reason } = cancelModal;
    setCancelModal(null);

    try {
      await cancelInboundAsset(log.id, reason || '사용자 입력 오타로 인한 입고 취소 롤백');
      showToast(`[입고 취소 롤백 성공] 자산 ${log.assetNo} 상태가 대여중(RENTED)으로 안전하게 원복 되었습니다.`);
    } catch (err: any) {
      showErrorModal(`⚠️ 입고 취소 롤백 실패: ${err?.message || err}`);
    }
  };

  // 5. 선택된 자산 정보 및 통합 타임라인
  const selectedAsset = assets.find(a => a.id === selectedAssetId);
  const selectedAssetTimeline = assetInOutLogs
    .filter(l => l.assetId === selectedAssetId)
    .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime());

  // 6. 엑셀 다운로드 (정밀 모델명, 현장명, 상세 정비 정보 반영)
  const handleExport = () => {
    const tabName = activeTab === 'OUTBOUND' ? '출고이력' : '입고이력';
    const excelData = filteredTabLogs.map((log, idx) => ({
      'No': idx + 1,
      '발생일자': log.eventDate,
      '관리번호': log.assetNo,
      '모델명': resolvePrecisionModelName(log.assetId, log.assetNo, log.modelName),
      '거래처(고객사)': log.customerName || '-',
      '연관 현장': log.siteName || '-',
      '상태/점수': log.type === 'INBOUND' ? `${log.maintenanceScore || 0}점` : log.type,
      '메모 / 비고': log.memo || '-'
    }));

    exportToExcel(excelData, `자산_${tabName}_${new Date().toISOString().split('T')[0]}`, tabName);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 1. 페이지 헤더 (헌장 3.1: 무수식어 건조 표준) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontWeight: '700', marginBottom: '4px' }}>자산 입출고</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            장비의 출하, 반납 입고 및 검수 결과를 조회 추적합니다.
          </p>
        </div>
        <button className="btn-secondary" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          <Download size={14} /> 엑셀 다운로드
        </button>
      </div>

      {/* 📊 자산 라이프사이클 이벤트 실시간 요약 바 */}
      {(() => {
        const inboundCount = assetInOutLogs.filter(l => l.type === 'INBOUND').length;
        const outboundCount = assetInOutLogs.filter(l => l.type === 'OUTBOUND').length;

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>총 입고(반납) 이력</span>
              <strong style={{ fontSize: '15px', color: '#16a34a' }}>{inboundCount}건</strong>
            </div>
            <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>총 출고(출하) 이력</span>
              <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>{outboundCount}건</strong>
            </div>
          </div>
        );
      })()}

      {/* 2. 3대 탭 메뉴 (입고등록, 입고조회, 출고조회) */}
      <div style={{ display: 'flex', gap: '10px', borderBottom: '2px solid var(--border-color)', paddingBottom: '10px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('INBOUND_REGISTER')}
          className={activeTab === 'INBOUND_REGISTER' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '8px 18px', fontSize: '13.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <CheckCircle2 size={16} /> 입고 등록 (반납)
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('INBOUND')}
          className={activeTab === 'INBOUND' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '8px 18px', fontSize: '13.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <ArrowDownLeft size={16} /> 입고 조회
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('OUTBOUND')}
          className={activeTab === 'OUTBOUND' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '8px 18px', fontSize: '13.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          <ArrowUpRight size={16} /> 출고 조회
        </button>
      </div>

      {/* 3. [신설] 입고 등록 전용 워크보드 (activeTab === 'INBOUND_REGISTER') */}
      {activeTab === 'INBOUND_REGISTER' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
          
          {/* 왼쪽: 자산 관리번호 선택 및 폼 입력 */}
          <div className="card" style={{ padding: '20px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ArrowDownLeft size={18} className="text-primary" /> 입고 자산 선택 및 검수 정보 입력
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 'bold' }}>입고 장비 관리번호 입력 / 검색 *</label>
                <input
                  type="text"
                  placeholder="예: G19004 또는 RENT-0001 관리번호 입력..."
                  value={inboundAssetNoInput}
                  onChange={e => {
                    const val = e.target.value;
                    setInboundAssetNoInput(val);
                    try { sessionStorage.setItem('inbound_draft_assetNo', val); } catch (err) {}
                    const matched = assets.find(a => a.assetNo.toLowerCase() === val.trim().toLowerCase());
                    if (matched) setSelectedInboundAssetId(matched.id);
                  }}
                  required
                  style={{ padding: '9px 12px', fontSize: '13.5px', fontWeight: 'bold' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 'bold' }}>입고 일자 *</label>
                <input
                  type="date"
                  max={todayStr}
                  value={inboundDate}
                  onChange={e => setInboundDate(e.target.value)}
                  required
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '12.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ShieldCheck size={15} className="text-primary" /> 정비 필요 항목 점검 선택 (자동 합산 연동)
                  </label>
                  <span className={`badge ${calculatedInboundScore === 0 ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '12px', fontWeight: 'bold', padding: '4px 8px' }}>
                    총 정비필요점수: {calculatedInboundScore}점 {calculatedInboundScore === 0 ? '(이상무: AVAILABLE)' : '(검수대기: RENTED_RETURNED)'}
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                  gap: '6px',
                  marginTop: '4px',
                  maxHeight: '400px',
                  overflowY: 'auto',
                  paddingRight: '2px'
                }}>
                  {inspectionChecklistItems.map(item => {
                    const isChecked = selectedChecklistIds.includes(item.id);
                    const photo = defectPhotos[item.id];
                    return (
                      <div
                        key={item.id}
                        onClick={() => toggleChecklistItem(item.id)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          backgroundColor: isChecked ? 'var(--primary-light)' : 'var(--bg-card)',
                          border: `1px solid ${isChecked ? 'var(--primary)' : 'var(--border-color)'}`,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                          <label
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            onClick={e => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleChecklistItem(item.id)}
                              style={{ width: '14px', height: '14px', accentColor: 'var(--primary)', cursor: 'pointer', flexShrink: 0 }}
                            />
                            <span style={{ fontWeight: isChecked ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.name}
                            </span>
                          </label>
                          <span style={{ fontSize: '11px', color: isChecked ? 'var(--primary)' : 'var(--warning)', fontWeight: 'bold', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            +{item.score}점
                          </span>
                        </div>

                        {isChecked && (
                          <div
                            onClick={e => e.stopPropagation()}
                            style={{ marginTop: '2px', paddingTop: '4px', borderTop: '1px dashed var(--border-color)', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}
                          >
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const fileInput = document.getElementById(`defect-camera-input-${item.id}`);
                                if (fileInput) fileInput.click();
                              }}
                              style={{ padding: '2px 5px', fontSize: '10.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px', margin: 0, whiteSpace: 'nowrap', flexShrink: 0 }}
                            >
                              <Camera size={11} /> 📸 촬영
                            </button>
                            <input
                              id={`defect-camera-input-${item.id}`}
                              type="file"
                              accept="image/*"
                              capture="environment"
                              style={{ display: 'none' }}
                              onChange={e => handlePhotoFileChange(item.id, e.target.files?.[0] || null)}
                            />

                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const fileInput = document.getElementById(`defect-gallery-input-${item.id}`);
                                if (fileInput) fileInput.click();
                              }}
                              style={{ padding: '2px 5px', fontSize: '10.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px', margin: 0, whiteSpace: 'nowrap', flexShrink: 0 }}
                            >
                              🖼 갤러리
                            </button>
                            <input
                              id={`defect-gallery-input-${item.id}`}
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              onChange={e => handlePhotoFileChange(item.id, e.target.files?.[0] || null)}
                            />

                            {photo ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                                <img src={photo} alt="파손 사진" style={{ width: '26px', height: '26px', objectFit: 'cover', borderRadius: '3px', border: '1px solid var(--border-color)' }} />
                                <span style={{ fontSize: '10px', color: 'var(--success)', fontWeight: 'bold' }}>✅ 첨부됨</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDefectPhotos(prev => {
                                      const next = { ...prev };
                                      delete next[item.id];
                                      try { sessionStorage.setItem('inbound_draft_photos', JSON.stringify(next)); } catch (err) {}
                                      return next;
                                    });
                                  }}
                                  style={{ border: 'none', background: 'none', color: 'var(--danger)', fontSize: '10px', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                                >
                                  삭제
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>(사진 선택)</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                  검수 및 입고 특이사항 메모 (선택사항)
                </label>
                <textarea
                  rows={2}
                  placeholder="추가적인 특이사항 또는 담당자 비고 입력 (선택)..."
                  value={inboundMemo}
                  onChange={e => {
                    const val = e.target.value;
                    setInboundMemo(val);
                    try { sessionStorage.setItem('inbound_draft_memo', val); } catch (err) {}
                  }}
                  style={{ padding: '8px', fontSize: '12.5px' }}
                />
              </div>

              <button
                type="button"
                onClick={() => handleSubmitInbound()}
                className="btn-primary"
                disabled={isSubmittingInbound || !inboundTargetAsset}
                style={{ width: '100%', padding: '10px', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '6px' }}
              >
                <CheckCircle2 size={16} /> 📥 반납 / 입고 등록 확정
              </button>

            </div>
          </div>

          {/* 오른쪽: 휴먼에러 오타 방지용 자동 매칭 교차 검증 정보 카드 */}
          <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--primary)' }}>
              <ShieldCheck size={18} /> 오타 방지 자산 및 대여 계약 자동 검증 정보
            </h3>

            {inboundTargetAsset ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
                
                <div style={{ padding: '12px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--primary)', marginBottom: '4px' }}>
                    {inboundTargetAsset.assetNo} {inboundTargetAsset.modelName}
                  </div>
                  <div><strong>시리얼번호(S/N):</strong> {inboundTargetAsset.serialNo || '-'}</div>
                  <div><strong>소유형태:</strong> {inboundTargetAsset.ownerType === 'OWNED' ? '당사 자산' : '외부 임차 장비'}</div>
                  <div><strong>현재 자산 상태:</strong> <span className="badge badge-info">{inboundTargetAsset.status}</span></div>
                </div>

                {inboundContractAsset ? (
                  <div style={{ padding: '12px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--primary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 'bold' }}>
                      ✓ 대여 계약 매칭 성공 (휴먼에러 방지 교차 확인)
                    </div>
                    <div><strong>계약번호:</strong> {inboundContract?.contractNo}</div>
                    <div><strong>고객사 (거래처):</strong> <strong style={{ fontSize: '14px' }}>{inboundCustomer?.name || '-'}</strong></div>
                    <div><strong>현장명:</strong> {inboundSite?.name || '-'} ({inboundSite?.address || '-'})</div>
                    <div><strong>약정 계약기간:</strong> {inboundContract?.startDate} ~ {formatContractEndDate(inboundContract?.endDate)}</div>
                  </div>
                ) : (
                  <div style={{ padding: '12px', backgroundColor: 'var(--warning-light)', borderRadius: '8px', border: '1px solid var(--warning)', color: '#c2410c' }}>
                    ⚠️ 현재 체결 대여 중인 계약(RENTED)을 찾을 수 없습니다. (입고 시 미할당 자산으로 자동 처리됩니다)
                  </div>
                )}

                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '8px', backgroundColor: 'var(--bg-card)', borderRadius: '6px' }}>
                  💡 <strong>입고 후 자동 자산 상태 전환:</strong><br />
                  - 검수점수 0점: <strong>`임대가능 (AVAILABLE)`</strong> 상태로 자동 즉시 전이<br />
                  - 검수점수 1점 이상: <strong>`입고반납/검수대기 (RENTED_RETURNED)`</strong> 상태로 자동 전이
                </div>

              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '240px', color: 'var(--text-muted)' }}>
                <AlertTriangle size={40} style={{ strokeWidth: 1.2, marginBottom: '10px' }} />
                <span>왼쪽 폼에서 입고할 자산의 관리번호를 선택하거나 입력해 주세요.</span>
              </div>
            )}
          </div>

        </div>
      ) : (

        /* 검색 & 필터 패널 */
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', alignItems: 'end' }}>
            
            {/* 1. 조회 기간 설정 필터 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                조회 기간 설정 (상한: 오늘)
              </label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="date"
                  value={inputStartDate}
                  max={todayStr}
                  onChange={e => setInputStartDate(e.target.value)}
                  style={{ flex: 1, padding: '7px', fontSize: '12.5px' }}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>~</span>
                <input
                  type="date"
                  value={inputEndDate}
                  max={todayStr}
                  onChange={e => {
                    const val = e.target.value;
                    setInputEndDate(val > todayStr ? todayStr : val);
                  }}
                  style={{ flex: 1, padding: '7px', fontSize: '12.5px' }}
                />
              </div>
            </div>

            {/* 2. 기간 빠른 선택 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                기간 선택
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setQuickRange('TODAY')}
                  style={{ flex: 1, padding: '6px 4px', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  오늘
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setQuickRange('WEEK')}
                  style={{ flex: 1, padding: '6px 4px', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  1주
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setQuickRange('MONTH')}
                  style={{ flex: 1, padding: '6px 4px', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  1개월
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setQuickRange('ALL')}
                  style={{ flex: 1, padding: '6px 4px', fontSize: '12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  전체
                </button>
              </div>
            </div>

            {/* 3. 통합 검색 필터 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                통합 검색 (모델명 / 관리번호 / 고객사 / 현장 / 조치내역)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={inputSearchTerm}
                  onChange={e => setInputSearchTerm(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                  placeholder="모델명, 관리번호, 고객사명, 현장, 조치내용 (Enter)..."
                  style={{ width: '100%', padding: '7px 10px 7px 32px', fontSize: '12.5px' }}
                />
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              </div>
            </div>

            {/* 4. [조회] 실행 버튼 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: 'transparent', whiteSpace: 'nowrap', userSelect: 'none' }}>
                조회 실행
              </label>
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleSearch()}
                style={{
                  width: '100%',
                  padding: '7px 16px',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
                  height: '34px',
                  flexShrink: 0
                }}
              >
                <Search size={15} /> 조회
              </button>
            </div>

          </div>

        </div>
      )}

      {/* 4. 자산 개별 선택 정보 및 연대기 타임라인 (선택된 자산이 있는 경우) */}
      {selectedAssetId && selectedAsset && (
        <div className="card" style={{ padding: '20px', border: '1px solid var(--primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontWeight: '700', fontSize: '15px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={18} />
              자산 통합 이력 연대기: {selectedAsset.assetNo} {selectedAsset.modelName}
            </h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className={`badge ${
                selectedAsset.status === 'AVAILABLE' ? 'badge-success' :
                selectedAsset.status === 'RENTED' ? 'badge-info' : 'badge-danger'
              }`}>
                현재상태: {
                  selectedAsset.status === 'AVAILABLE' ? '임대가능' :
                  selectedAsset.status === 'ASSIGNED' ? '출고대기' :
                  selectedAsset.status === 'RENTED' ? '대여중' :
                  selectedAsset.status === 'REPAIRING' ? '정비중' :
                  selectedAsset.status === 'RENTED_RETURNED' ? '반납완료' : selectedAsset.status
                }
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedAssetId('')}
                style={{ fontSize: '11px', padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                ✕ 전체 보기로 복귀
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.5fr', gap: '24px', alignItems: 'start' }}>
            <div style={{ backgroundColor: 'var(--bg-app)', padding: '14px', borderRadius: '8px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid var(--border-color)' }}>
              <div><strong>관리번호:</strong> <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{selectedAsset.assetNo}</span></div>
              <div><strong>모델명:</strong> {selectedAsset.modelName}</div>
              <div><strong>제조번호 (SN):</strong> {selectedAsset.serialNo || '-'}</div>
              <div><strong>소유 형태:</strong> {selectedAsset.ownerType === 'OWNED' ? '자사자산' : '외부임차장비'}</div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
              <div><strong>기여액 (누적):</strong> {(selectedAsset.cumRentalFee || 0).toLocaleString()}원</div>
              <div><strong>수리비 지출 (누적):</strong> {(selectedAsset.cumRepairCost || 0).toLocaleString()}원</div>
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px 0', fontSize: '13.5px', fontWeight: '700' }}>장비 생애주기 이력 로그 ({selectedAssetTimeline.length}건)</h4>
              {selectedAssetTimeline.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px' }}>
                  등록된 이력 로그가 없습니다.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderLeft: '2px solid var(--border-color)', paddingLeft: '14px', marginLeft: '6px' }}>
                  {selectedAssetTimeline.map(log => (
                    <div key={log.id} style={{ position: 'relative' }}>
                      <div style={{
                        position: 'absolute', left: '-21px', top: '3px', width: '12px', height: '12px', borderRadius: '50%',
                        backgroundColor: 
                          log.type === 'OUTBOUND' ? 'var(--primary)' : 
                          log.type === 'INBOUND' ? 'var(--success)' : 'var(--warning)',
                        border: '2px solid var(--bg-card)'
                      }} />
                      <div style={{ padding: '10px', fontSize: '12.5px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <strong style={{ color: log.type === 'OUTBOUND' ? 'var(--primary)' : log.type === 'INBOUND' ? 'var(--success)' : 'var(--warning)' }}>
                            {log.type === 'OUTBOUND' ? '📤 출고 (OUTBOUND)' : log.type === 'INBOUND' ? '📥 입고 (INBOUND)' : '🛠️ 정비 (REPAIR)'}
                          </strong>
                          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{log.eventDate}</span>
                        </div>
                        <div>고객사/거래처: <strong>{log.customerName || '-'}</strong> {log.siteName ? `(${log.siteName})` : ''}</div>
                        {log.memo && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '2px' }}>비고: {log.memo}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. 탭별 조회 결과 안내 & 데이터 테이블 (activeTab !== 'INBOUND_REGISTER') */}
      {activeTab !== 'INBOUND_REGISTER' && (
        <div className="card" style={{ padding: '16px' }}>
          
          {/* 결과 요약 헤더 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {activeTab === 'OUTBOUND' && <span>📤 출고 이력 목록</span>}
              {activeTab === 'INBOUND' && <span>📥 입고 이력 목록</span>}
            </div>

            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              총 <strong style={{ color: 'var(--primary)', fontSize: '15px' }}>{filteredTabLogs.length}</strong>건 조회됨
            </div>
          </div>

          {/* 데이터 테이블 (헌장 3.2: 줄바꿈 방지 nowrap) */}
          <div className="table-container" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                {activeTab === 'OUTBOUND' && (
                  <tr>
                    <th style={{ whiteSpace: 'nowrap' }}>번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>출고일자</th>
                    <th style={{ whiteSpace: 'nowrap' }}>관리번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>모델명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>고객사 (거래처)</th>
                    <th style={{ whiteSpace: 'nowrap' }}>현장명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>비고 / 메모</th>
                  </tr>
                )}
                {activeTab === 'INBOUND' && (
                  <tr>
                    <th style={{ whiteSpace: 'nowrap' }}>번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>입고 고유번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>입고일자</th>
                    <th style={{ whiteSpace: 'nowrap' }}>관리번호</th>
                    <th style={{ whiteSpace: 'nowrap' }}>모델명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>고객사 (거래처)</th>
                    <th style={{ whiteSpace: 'nowrap' }}>현장명</th>
                    <th style={{ whiteSpace: 'nowrap' }}>정비 점수</th>
                    <th style={{ whiteSpace: 'nowrap' }}>불량 증상 상세</th>
                    <th style={{ whiteSpace: 'nowrap' }}>작업</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {filteredTabLogs.length === 0 ? (
                  <tr>
                    <td colSpan={activeTab === 'INBOUND' ? 10 : 7} style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                      선택한 탭 및 검색 조건에 부합하는 자산 이력 데이터가 존재하지 않습니다.
                    </td>
                  </tr>
                ) : (
                    filteredTabLogs.map((log, idx) => {
                      const parsedDefects: InboundDefectDetail[] = log.defectsJson ? JSON.parse(log.defectsJson) : [];
                      const precisionModel = resolvePrecisionModelName(log.assetId, log.assetNo, log.modelName);
                      return (
                        <tr
                          key={log.id}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelectedAssetId(log.assetId)}
                          title="클릭 시 자산별 생애주기 통합 연대기를 확인합니다."
                        >
                          <td style={{ whiteSpace: 'nowrap' }}>{idx + 1}</td>
                          
                          {activeTab === 'OUTBOUND' && (
                            <>
                              <td style={{ whiteSpace: 'nowrap' }}>{log.eventDate}</td>
                              <td style={{ whiteSpace: 'nowrap' }}><strong style={{ color: 'var(--primary)' }}>{log.assetNo}</strong></td>
                              <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{precisionModel}</td>
                              <td style={{ whiteSpace: 'nowrap' }}><strong>{log.customerName || '-'}</strong></td>
                              <td style={{ whiteSpace: 'nowrap' }}>{log.siteName || '-'}</td>
                              <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{log.memo || '-'}</td>
                            </>
                          )}

                          {activeTab === 'INBOUND' && (
                            <>
                              <td style={{ whiteSpace: 'nowrap', fontWeight: 'bold', color: 'var(--primary)', fontSize: '12px' }}>
                                {log.inboundNo || '-'}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>{log.eventDate}</td>
                              <td style={{ whiteSpace: 'nowrap' }}><strong style={{ color: 'var(--primary)' }}>{log.assetNo}</strong></td>
                              <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{precisionModel}</td>
                              <td style={{ whiteSpace: 'nowrap' }}><strong>{log.customerName || '-'}</strong></td>
                              <td style={{ whiteSpace: 'nowrap' }}>{log.siteName || '-'}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <span className={`badge ${(log.maintenanceScore || 0) === 0 ? 'badge-success' : 'badge-warning'}`}>
                                  {log.maintenanceScore || 0}점
                                </span>
                              </td>
                              <td style={{ fontSize: '12px' }}>
                                {parsedDefects.length > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {parsedDefects.map((d, dIdx) => (
                                      <div key={dIdx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span className="badge badge-secondary" style={{ fontSize: '10px' }}>{d.subNo}</span>
                                        <span>{d.checkitemName} (+{d.score}점)</span>
                                        {d.photoUrl && (
                                          <a href={d.photoUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                                            <img src={d.photoUrl} alt="사진" style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '3px', border: '1px solid var(--border-color)' }} />
                                          </a>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span>{log.memo || '-'}</span>
                                )}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => handleCancelInbound(log)}
                                  style={{ fontSize: '11px', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--danger)', border: '1px solid var(--danger-light)' }}
                                  title="사용자 휴먼에러 입고 오타 시 원래 대여중 상태로 롤백 복원합니다."
                                >
                                  <RotateCcw size={12} /> 입고 취소
                                </button>
                              </td>
                            </>
                          )}

                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          padding: '12px 20px',
          borderRadius: '8px',
          backgroundColor: toastMessage.type === 'error' ? '#ef4444' : toastMessage.type === 'warning' ? '#f59e0b' : '#10b981',
          color: '#fff',
          fontWeight: 700,
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {toastMessage.text}
        </div>
      )}

      {/* 입고 취소 롤백 모달 */}
      {cancelModal && cancelModal.isOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11000
        }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '10px', padding: '20px', maxWidth: '440px', width: '90%', border: '1px solid var(--border-color)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '15px', color: '#ef4444' }}>입고 취소 롤백</h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              자산번호 <strong>{cancelModal.log.assetNo}</strong> 입고 건을 취소하고 자산 상태를 대여중(RENTED)으로 복원하시겠습니까?
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>취소 사유</label>
              <input
                type="text"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-body)', color: 'var(--text-primary)', fontSize: '12.5px' }}
                value={cancelModal.reason}
                onChange={e => setCancelModal({ ...cancelModal, reason: e.target.value })}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn-secondary" onClick={() => setCancelModal(null)}>닫기</button>
              <button
                className="btn-primary"
                style={{ backgroundColor: '#ef4444', borderColor: '#ef4444' }}
                onClick={handleConfirmCancelInbound}
              >
                입고 취소 롤백 실행
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
