// src/components/BatchBusinessLicenseModal.tsx
// 사업자등록증 폴더/다중 파일 일괄 순회 분석 및 매출처(고객사)/매입처(협력사) 자동 등록 모달

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  X, FolderOpen, FileText, Play, Pause, RotateCcw, 
  Download, CheckCircle2, AlertCircle, Building2, 
  RefreshCw, CheckSquare, Layers, Clock, ShieldCheck
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { exportToExcel } from '../services/excel';
import { 
  BatchTargetType, VendorTypeOption, BatchItemResult, BatchProgressStats,
  filterValidLicenseFiles, extractFilesFromDataTransfer, runBatchBusinessLicenses 
} from '../services/batchBusinessLicenseService';

interface BatchBusinessLicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTargetType?: BatchTargetType;
  onCompleted?: (results: BatchItemResult[]) => void;
}

export const BatchBusinessLicenseModal: React.FC<BatchBusinessLicenseModalProps> = ({
  isOpen,
  onClose,
  initialTargetType = 'CUSTOMER',
  onCompleted
}) => {
  const { customers, vendors, saveCustomer, saveVendor, refreshAllData, showErrorModal } = useApp();

  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 대상 구분: 'CUSTOMER' (매출처/고객사) | 'VENDOR' (매입처/협력사)
  const [targetType, setTargetType] = useState<BatchTargetType>(initialTargetType);
  const [defaultVendorType, setDefaultVendorType] = useState<VendorTypeOption>('RENTAL');

  // 파일 목록 및 상태
  const [selectedFiles, setSelectedFiles] = useState<{ file: File; path: string }[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAborted, setIsAborted] = useState(false);

  // 실행 결과 목록
  const [results, setResults] = useState<BatchItemResult[]>([]);
  const [currentProgress, setCurrentProgress] = useState<BatchProgressStats>({
    total: 0,
    processed: 0,
    pending: 0,
    successNew: 0,
    successUpdated: 0,
    failed: 0,
    skipped: 0,
    percent: 0
  });

  // 모달 오픈 시 초기화
  useEffect(() => {
    if (isOpen) {
      setTargetType(initialTargetType);
      setDefaultVendorType('RENTAL');
      setSelectedFiles([]);
      setResults([]);
      setIsProcessing(false);
      setIsAborted(false);
      setCurrentProgress({
        total: 0,
        processed: 0,
        pending: 0,
        successNew: 0,
        successUpdated: 0,
        failed: 0,
        skipped: 0,
        percent: 0
      });
    }
  }, [isOpen, initialTargetType]);

  // 컴포넌트 언마운트 시 처리 중단
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  if (!isOpen) return null;

  // 1. 파일/폴더 선택 핸들러
  const handleFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const valid = filterValidLicenseFiles(Array.from(e.target.files));
      if (valid.length === 0) {
        showErrorModal('선택된 폴더/파일에 지원되는 사업자등록증(PDF, JPG, PNG, WEBP) 파일이 없습니다.');
        return;
      }
      setSelectedFiles(valid);
      initializeResults(valid);
    }
    // 동일 폴더 재선택을 위해 값 리셋
    e.target.value = '';
  };

  // 2. 드래그 앤 드롭 핸들러
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      try {
        const valid = await extractFilesFromDataTransfer(e.dataTransfer.items);
        if (valid.length === 0) {
          showErrorModal('드롭된 폴더/파일에 지원되는 사업자등록증(PDF, JPG, PNG, WEBP) 파일이 없습니다.');
          return;
        }
        setSelectedFiles(valid);
        initializeResults(valid);
      } catch (err: any) {
        showErrorModal(`폴더 탐색 오류: ${err?.message || err}`);
      }
    }
  };

  // 대기열 결과 초기화
  const initializeResults = (files: { file: File; path: string }[]) => {
    const initialList: BatchItemResult[] = files.map((item, idx) => ({
      index: idx + 1,
      fileName: item.file.name,
      filePath: item.path,
      fileSize: item.file.size,
      status: 'PENDING',
      targetType,
      vendorType: targetType === 'VENDOR' ? defaultVendorType : undefined,
      details: '대기 중'
    }));
    setResults(initialList);
    setCurrentProgress({
      total: files.length,
      processed: 0,
      pending: files.length,
      successNew: 0,
      successUpdated: 0,
      failed: 0,
      skipped: 0,
      percent: 0
    });
  };

  // 3. 일괄 순회 분석 및 등록 실행
  const handleStartBatch = async () => {
    if (selectedFiles.length === 0 || isProcessing) return;

    setIsProcessing(true);
    setIsAborted(false);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await runBatchBusinessLicenses(selectedFiles, {
        targetType,
        defaultVendorType,
        delayBetweenMs: 850,
        abortSignal: controller.signal,
        saveCustomer,
        saveVendor,
        existingCustomers: customers,
        existingVendors: vendors,
        onProgress: (stats, currentItem) => {
          setCurrentProgress(stats);
          setResults(prev => {
            const next = [...prev];
            const targetIdx = next.findIndex(r => r.index === currentItem.index);
            if (targetIdx >= 0) {
              next[targetIdx] = currentItem;
            }
            return next;
          });
        }
      });

      await refreshAllData();
    } catch (err: any) {
      console.error('[BatchBusinessLicenseModal] Batch execution error:', err);
      showErrorModal(`배치 처리 중 오류가 발생했습니다: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  // 4. 일시 정지 / 중단 핸들러
  const handleStopBatch = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsAborted(true);
      setIsProcessing(false);
    }
  };

  // 5. 초기화
  const handleReset = () => {
    if (isProcessing) return;
    setSelectedFiles([]);
    setResults([]);
    setCurrentProgress({
      total: 0,
      processed: 0,
      pending: 0,
      successNew: 0,
      successUpdated: 0,
      failed: 0,
      skipped: 0,
      percent: 0
    });
  };

  // 6. 결과 엑셀 다운로드
  const handleExportExcel = () => {
    if (results.length === 0) return;

    const excelData = results.map(r => ({
      '순번': r.index,
      '구분': r.targetType === 'CUSTOMER' ? '매출처(고객사)' : `매입처(${r.vendorType || '임차'})`,
      '파일명': r.fileName,
      '상호(법인명)': r.companyName || '-',
      '사업자등록번호': r.bizRegNo || '-',
      '대표자': r.representative || '-',
      '연락처': r.repContact || '-',
      '이메일': r.repEmail || '-',
      '사업장소재지': r.address || '-',
      '업태': r.bizType || '-',
      '종목': r.bizItem || '-',
      '개업연월일': r.openingDate || '-',
      '처리상태': r.status === 'SUCCESS_NEW' ? '신규등록' :
                  r.status === 'SUCCESS_UPDATED' ? '정보보완' :
                  r.status === 'FAILED' ? '오류' :
                  r.status === 'SKIPPED' ? '건너뜀' : '대기',
      '상세내용': r.details || r.error || '-'
    }));

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = targetType === 'CUSTOMER' ? '고객사_사업자등록증_일괄등록' : '매입처_사업자등록증_일괄등록';
    exportToExcel(excelData, `${prefix}_결과_${dateStr}`, '일괄등록결과');
  };

  // 7. 완료 및 닫기
  const handleFinishAndClose = async () => {
    await refreshAllData();
    onCompleted?.(results);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div 
        style={{
          width: '100%',
          maxWidth: '1320px',
          height: '90vh',
          maxHeight: '900px',
          backgroundColor: 'var(--bg-card, #ffffff)',
          color: 'var(--text-main, #0f172a)',
          borderRadius: '12px',
          border: '1px solid var(--border-color, #cbd5e1)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 숨김 파일/폴더 입력 엘리먼트 */}
        <input 
          ref={folderInputRef}
          type="file"
          // @ts-ignore
          webkitdirectory=""
          directory=""
          multiple
          style={{ display: 'none' }}
          onChange={handleFilesChosen}
        />
        <input 
          ref={filesInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
          style={{ display: 'none' }}
          onChange={handleFilesChosen}
        />

        {/* ─── ① 모달 상단 헤더 ─── */}
        <div style={{
          padding: '14px 20px',
          backgroundColor: 'var(--bg-secondary, #f8fafc)',
          borderBottom: '1px solid var(--border-color, #cbd5e1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <FolderOpen size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text-main, #0f172a)', whiteSpace: 'nowrap' }}>
                사업자등록증 폴더 일괄 등록
              </h3>
            </div>
          </div>

          <button 
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            style={{
              background: 'none',
              border: 'none',
              padding: '6px',
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              color: 'var(--text-muted, #64748b)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px'
            }}
            title="닫기"
          >
            <X size={20} />
          </button>
        </div>

        {/* ─── ② 조작 및 파이프라인 제어 바 (Gutenberg Z-Pattern) ─── */}
        <div style={{
          padding: '10px 20px',
          backgroundColor: 'var(--bg-card, #ffffff)',
          borderBottom: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
          flexShrink: 0
        }}>
          {/* 좌측: 등록 대상 선택 탭 및 폴더 선택 버튼군 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{
              display: 'flex',
              padding: '2px',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-secondary, #f1f5f9)',
              border: '1px solid var(--border-color, #cbd5e1)'
            }}>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  setTargetType('CUSTOMER');
                  if (results.length > 0) {
                    setResults(prev => prev.map(r => ({ ...r, targetType: 'CUSTOMER' })));
                  }
                }}
                style={{
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: targetType === 'CUSTOMER' ? 700 : 500,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: isProcessing ? 'not-allowed' : 'pointer',
                  backgroundColor: targetType === 'CUSTOMER' ? '#0284c7' : 'transparent',
                  color: targetType === 'CUSTOMER' ? '#ffffff' : 'var(--text-secondary, #475569)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap'
                }}
              >
                <Building2 size={13} />
                매출처 (고객사)
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  setTargetType('VENDOR');
                  if (results.length > 0) {
                    setResults(prev => prev.map(r => ({ ...r, targetType: 'VENDOR', vendorType: defaultVendorType })));
                  }
                }}
                style={{
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: targetType === 'VENDOR' ? 700 : 500,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: isProcessing ? 'not-allowed' : 'pointer',
                  backgroundColor: targetType === 'VENDOR' ? '#10b981' : 'transparent',
                  color: targetType === 'VENDOR' ? '#ffffff' : 'var(--text-secondary, #475569)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap'
                }}
              >
                <Layers size={13} />
                매입처 (협력사)
              </button>
            </div>

            {targetType === 'VENDOR' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderRadius: '6px', backgroundColor: 'var(--bg-secondary, #f1f5f9)', border: '1px solid var(--border-color, #cbd5e1)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted, #64748b)', whiteSpace: 'nowrap' }}>유형:</span>
                <select
                  disabled={isProcessing}
                  value={defaultVendorType}
                  onChange={(e) => {
                    const nextVal = e.target.value as VendorTypeOption;
                    setDefaultVendorType(nextVal);
                    if (results.length > 0) {
                      setResults(prev => prev.map(r => ({ ...r, vendorType: nextVal })));
                    }
                  }}
                  style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color, #cbd5e1)',
                    backgroundColor: 'var(--bg-card, #ffffff)',
                    color: 'var(--text-main, #0f172a)'
                  }}
                >
                  <option value="RENTAL">장비 임차처</option>
                  <option value="PURCHASE">장비 구매처</option>
                  <option value="TRANSPORT">운송 협력사</option>
                  <option value="REPAIR">외주 정비처</option>
                  <option value="CONSUMABLE">소모품 구매처</option>
                  <option value="OTHER">기타 매입처</option>
                </select>
              </div>
            )}

            {/* 폴더 선택 / 파일 복수 선택 버튼 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => folderInputRef.current?.click()}
                style={{
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-secondary, #f8fafc)',
                  color: 'var(--text-main, #0f172a)',
                  cursor: isProcessing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap'
                }}
              >
                <FolderOpen size={14} color="#d97706" />
                폴더 선택
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => filesInputRef.current?.click()}
                style={{
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-secondary, #f8fafc)',
                  color: 'var(--text-main, #0f172a)',
                  cursor: isProcessing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap'
                }}
              >
                <FileText size={14} color="#0284c7" />
                파일 선택
              </button>
            </div>
          </div>

          {/* 우측: 실행 / 정지 / 초기화 컨트롤 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!isProcessing ? (
              <button
                type="button"
                disabled={selectedFiles.length === 0}
                onClick={handleStartBatch}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: selectedFiles.length === 0 ? '#94a3b8' : '#2563eb',
                  color: '#ffffff',
                  cursor: selectedFiles.length === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
                  whiteSpace: 'nowrap'
                }}
              >
                <Play size={14} style={{ fill: '#ffffff' }} />
                일괄 분석 및 등록 시작
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopBatch}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#e11d48',
                  color: '#ffffff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap'
                }}
              >
                <Pause size={14} style={{ fill: '#ffffff' }} />
                일시 정지 / 중단
              </button>
            )}

            <button
              type="button"
              disabled={isProcessing || selectedFiles.length === 0}
              onClick={handleReset}
              style={{
                padding: '6px 8px',
                borderRadius: '6px',
                border: '1px solid var(--border-color, #cbd5e1)',
                backgroundColor: 'var(--bg-secondary, #f8fafc)',
                color: 'var(--text-secondary, #475569)',
                cursor: (isProcessing || selectedFiles.length === 0) ? 'not-allowed' : 'pointer'
              }}
              title="초기화"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        {/* ─── ③ 실시간 진행 HUD & 현황 통계 배지 ─── */}
        <div style={{
          padding: '8px 20px',
          backgroundColor: 'var(--bg-secondary, #f1f5f9)',
          borderBottom: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          flexShrink: 0
        }}>
          {/* 프로그레스 바 */}
          <div style={{ width: '100%', height: '6px', borderRadius: '3px', backgroundColor: '#e2e8f0', overflow: 'hidden' }}>
            <div 
              style={{
                height: '100%',
                width: `${currentProgress.percent}%`,
                backgroundColor: isProcessing ? '#0284c7' : '#10b981',
                transition: 'width 0.3s ease'
              }}
            />
          </div>

          {/* 진행 통계 카운터 카드 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted, #64748b)' }}>진행률:</span>
              <strong>{currentProgress.percent}%</strong>
              <span style={{ color: 'var(--text-muted, #64748b)' }}>({currentProgress.processed} / {currentProgress.total}건)</span>
              {isProcessing && (
                <span style={{ color: '#0284c7', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}>
                  <RefreshCw size={12} className="animate-spin" /> 분석 중...
                </span>
              )}
              {isAborted && (
                <span style={{ color: '#d97706', fontWeight: 700 }}>[중단됨]</span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>전체: <strong>{currentProgress.total}</strong></span>
              <span style={{ color: '#059669' }}>신규: <strong>{currentProgress.successNew}</strong></span>
              <span style={{ color: '#0284c7' }}>보완: <strong>{currentProgress.successUpdated}</strong></span>
              {currentProgress.failed > 0 && (
                <span style={{ color: '#e11d48' }}>오류: <strong>{currentProgress.failed}</strong></span>
              )}
              {currentProgress.skipped > 0 && (
                <span style={{ color: '#d97706' }}>건너뜀: <strong>{currentProgress.skipped}</strong></span>
              )}
            </div>
          </div>
        </div>

        {/* ─── ④ 고밀도 실시간 스트리밍 대사 테이블 ─── */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          backgroundColor: 'var(--bg-card, #ffffff)'
        }}>
          {selectedFiles.length === 0 ? (
            <div 
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                backgroundColor: isDragOver ? 'rgba(2, 132, 199, 0.05)' : 'transparent',
                border: isDragOver ? '2px dashed #0284c7' : 'none'
              }}
              onClick={() => folderInputRef.current?.click()}
            >
              <div style={{ width: '56px', height: '56px', borderRadius: '14px', backgroundColor: 'var(--bg-secondary, #f1f5f9)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' }}>
                <FolderOpen size={28} color="#0284c7" />
              </div>
              <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-main, #0f172a)' }}>
                사업자등록증 폴더를 이곳으로 드래그하거나 클릭하여 선택하십시오
              </h4>
              <p style={{ margin: '8px 0 20px 0', fontSize: '12px', color: 'var(--text-muted, #64748b)', maxWidth: '460px', lineHeight: '1.5' }}>
                PDF 및 이미지(PNG, JPG, WEBP)가 포함된 폴더를 통째로 지정하면 모든 파일을 순회하여 
                {targetType === 'CUSTOMER' ? ' 매출처(고객사)' : ' 매입처(협력사)'}에 자동으로 등록하거나 보완합니다.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    folderInputRef.current?.click();
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <FolderOpen size={14} /> 폴더 열기
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    filesInputRef.current?.click();
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-secondary, #f1f5f9)',
                    color: 'var(--text-main, #0f172a)',
                    fontSize: '12px',
                    fontWeight: 600,
                    border: '1px solid var(--border-color, #cbd5e1)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <FileText size={14} /> 파일 선택
                </button>
              </div>
            </div>
          ) : (
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '12px',
              textAlign: 'left'
            }}>
              <thead style={{
                position: 'sticky',
                top: 0,
                zIndex: 5,
                backgroundColor: 'var(--bg-secondary, #f8fafc)',
                borderBottom: '2px solid var(--border-color, #cbd5e1)',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
              }}>
                <tr style={{ height: '38px' }}>
                  <th style={{ padding: '6px 10px', textAlign: 'center', width: '48px', whiteSpace: 'nowrap', fontWeight: 700 }}>No.</th>
                  <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>상태</th>
                  <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>파일명</th>
                  <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>상호</th>
                  <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>사업자등록번호</th>
                  <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>대표자</th>
                  <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>연락처 / 이메일</th>
                  <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>소재지</th>
                  <th style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontWeight: 700 }}>처리 결과</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => {
                  const isCurProcessing = row.status === 'PROCESSING';
                  const isNew = row.status === 'SUCCESS_NEW';
                  const isUpdated = row.status === 'SUCCESS_UPDATED';
                  const isFail = row.status === 'FAILED';
                  const isPending = row.status === 'PENDING';

                  return (
                    <tr 
                      key={row.index} 
                      style={{
                        height: '38px',
                        borderBottom: '1px solid var(--border-color, #e2e8f0)',
                        backgroundColor: isCurProcessing ? '#e0f2fe' : (row.index % 2 === 1 ? 'var(--bg-secondary, #f8fafc)' : 'transparent')
                      }}
                    >
                      <td style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {row.index}
                      </td>

                      <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>
                        {isNew && (
                          <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #86efac', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <CheckCircle2 size={12} /> 신규등록
                          </span>
                        )}
                        {isUpdated && (
                          <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: '#e0f2fe', color: '#0369a1', border: '1px solid #7dd3fc', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <CheckCircle2 size={12} /> 정보보완
                          </span>
                        )}
                        {isCurProcessing && (
                          <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <RefreshCw size={12} className="animate-spin" /> 분석중
                          </span>
                        )}
                        {isFail && (
                          <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <AlertCircle size={12} /> 오류
                          </span>
                        )}
                        {isPending && (
                          <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', color: 'var(--text-muted, #94a3b8)', backgroundColor: 'var(--bg-secondary, #f1f5f9)' }}>
                            대기
                          </span>
                        )}
                        {row.status === 'SKIPPED' && (
                          <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '11px', color: '#b45309', backgroundColor: '#fef3c7' }}>
                            건너뜀
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.filePath}>
                        {row.fileName}
                      </td>

                      <td style={{ padding: '6px 12px', fontWeight: 700, color: 'var(--text-main, #0f172a)', whiteSpace: 'nowrap', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.companyName || ''}>
                        {row.companyName || (isPending ? '-' : '판독 중...')}
                      </td>

                      <td style={{ padding: '6px 12px', fontFamily: 'monospace', color: 'var(--text-secondary, #475569)', whiteSpace: 'nowrap' }}>
                        {row.bizRegNo || '-'}
                      </td>

                      <td style={{ padding: '6px 12px', whiteSpace: 'nowrap', color: 'var(--text-secondary, #475569)' }}>
                        {row.representative || '-'}
                      </td>

                      <td style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--text-muted, #64748b)', whiteSpace: 'nowrap', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.repContact || row.repEmail ? `${row.repContact || ''} ${row.repEmail ? `(${row.repEmail})` : ''}` : '-'}
                      </td>

                      <td style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--text-muted, #64748b)', whiteSpace: 'nowrap', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.address || ''}>
                        {row.address || '-'}
                      </td>

                      <td style={{ padding: '6px 12px', fontSize: '11px', whiteSpace: 'nowrap', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.error ? (
                          <span style={{ color: '#e11d48', fontWeight: 700 }} title={row.error}>{row.error}</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted, #64748b)' }} title={row.details || ''}>{row.details || '-'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ─── ⑤ 하단 마감 및 엑셀 다운로드 바 ─── */}
        <div style={{
          padding: '12px 20px',
          backgroundColor: 'var(--bg-secondary, #f8fafc)',
          borderTop: '1px solid var(--border-color, #cbd5e1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: 'var(--text-secondary, #475569)' }}>
            <span>대기열: <strong>{results.length}건</strong></span>
            <span>•</span>
            <span style={{ color: '#059669' }}>완료: <strong>{currentProgress.successNew + currentProgress.successUpdated}건</strong></span>
            {currentProgress.failed > 0 && (
              <>
                <span>•</span>
                <span style={{ color: '#e11d48' }}>오류: <strong>{currentProgress.failed}건</strong></span>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              disabled={results.length === 0}
              onClick={handleExportExcel}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                border: '1px solid var(--border-color, #cbd5e1)',
                backgroundColor: 'var(--bg-card, #ffffff)',
                color: 'var(--text-main, #0f172a)',
                cursor: results.length === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap'
              }}
            >
              <Download size={14} color="#059669" />
              결과 엑셀 다운로드
            </button>

            <button
              type="button"
              disabled={isProcessing}
              onClick={handleFinishAndClose}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                backgroundColor: 'var(--primary, #4f46e5)',
                color: '#ffffff',
                border: 'none',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap'
              }}
            >
              <ShieldCheck size={15} />
              완료 및 닫기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
