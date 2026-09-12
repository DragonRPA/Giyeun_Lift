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
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      <div 
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-6xl h-[92vh] max-h-[900px] flex flex-col shadow-2xl overflow-hidden text-slate-200"
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
          className="hidden"
          onChange={handleFilesChosen}
        />
        <input 
          ref={filesInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
          className="hidden"
          onChange={handleFilesChosen}
        />

        {/* ─── ① 모달 상단 헤더 (Scope & Target) ─── */}
        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-950/80 border border-sky-800/80 text-sky-400">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight whitespace-nowrap">
                  사업자등록증 폴더 일괄 등록
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 border border-slate-700 text-slate-300">
                  Vision AI 순회 엔진
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                지정된 폴더 내 사업자등록증(PDF, 이미지)을 전수 순회하여 상호·사업자번호·대표자 정보를 자동 등록 및 보완합니다.
              </p>
            </div>
          </div>

          <button 
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            title="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ─── ② 조작 및 파이프라인 제어 바 (Gutenberg Z-Pattern: 좌상단 Scope -> 우상단 Pipeline) ─── */}
        <div className="px-5 py-3 bg-slate-900 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
          {/* 좌측: 등록 대상 선택 탭 및 폴더 선택 버튼군 */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* 등록 대상 토글 */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  setTargetType('CUSTOMER');
                  if (results.length > 0) {
                    setResults(prev => prev.map(r => ({ ...r, targetType: 'CUSTOMER' })));
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  targetType === 'CUSTOMER'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>매출처 (고객사)</span>
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
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  targetType === 'VENDOR'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>매입처 (공급/외주처)</span>
              </button>
            </div>

            {/* 매입처 선택 시 기본 거래유형 셀렉터 */}
            {targetType === 'VENDOR' && (
              <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap">기본 유형:</span>
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
                  className="bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-500"
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
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => folderInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 active:scale-95 disabled:opacity-50 transition-all whitespace-nowrap"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                <span>폴더 선택</span>
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => filesInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 active:scale-95 disabled:opacity-50 transition-all whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5 text-sky-400" />
                <span>파일 복수 선택</span>
              </button>
            </div>
          </div>

          {/* 우측: 실행 / 정지 / 초기화 컨트롤 */}
          <div className="flex items-center gap-2">
            {!isProcessing ? (
              <button
                type="button"
                disabled={selectedFiles.length === 0}
                onClick={handleStartBatch}
                className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>일괄 분석 및 등록 시작</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStopBatch}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition-all whitespace-nowrap"
              >
                <Pause className="w-3.5 h-3.5 fill-current" />
                <span>일시 정지 / 중단</span>
              </button>
            )}

            <button
              type="button"
              disabled={isProcessing || selectedFiles.length === 0}
              onClick={handleReset}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-40 transition-colors"
              title="대기열 초기화"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ─── ③ 실시간 진행 HUD & 현황 통계 배지 ─── */}
        <div className="px-5 py-2.5 bg-slate-950/60 border-b border-slate-800 flex flex-col gap-2 flex-shrink-0">
          {/* 프로그레스 바 */}
          <div className="w-full bg-slate-800/80 rounded-full h-2 overflow-hidden flex">
            <div 
              className={`h-full transition-all duration-300 ${
                isProcessing ? 'bg-gradient-to-r from-blue-500 to-sky-400' : 'bg-emerald-500'
              }`}
              style={{ width: `${currentProgress.percent}%` }}
            />
          </div>

          {/* 진행 통계 카운터 카드 */}
          <div className="flex items-center justify-between text-xs flex-wrap gap-2 font-mono">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-sans text-[11px]">진행률:</span>
              <strong className="text-white font-bold">{currentProgress.percent}%</strong>
              <span className="text-slate-500">({currentProgress.processed} / {currentProgress.total}건)</span>
              {isProcessing && (
                <span className="flex items-center gap-1 text-[11px] text-sky-400 font-sans animate-pulse">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>분석 순회 중...</span>
                </span>
              )}
              {isAborted && (
                <span className="text-[11px] text-amber-400 font-sans font-bold">
                  [일시 중단됨]
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700 text-[11px]">
                전체 <strong>{currentProgress.total}</strong>
              </span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 text-[11px]">
                신규 <strong>{currentProgress.successNew}</strong>
              </span>
              <span className="px-2 py-0.5 rounded-md bg-sky-950/80 text-sky-300 border border-sky-800/60 text-[11px]">
                보완 <strong>{currentProgress.successUpdated}</strong>
              </span>
              {currentProgress.failed > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-rose-950/80 text-rose-300 border border-rose-800/60 text-[11px]">
                  오류 <strong>{currentProgress.failed}</strong>
                </span>
              )}
              {currentProgress.skipped > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-amber-950/80 text-amber-300 border border-amber-800/60 text-[11px]">
                  건너뜀 <strong>{currentProgress.skipped}</strong>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ─── ④ 고밀도 실시간 스트리밍 대사 테이블 (Inspection: 화면의 75~80% 차지) ─── */}
        <div className="flex-1 min-h-0 overflow-auto bg-slate-900/60 relative">
          {selectedFiles.length === 0 ? (
            /* 드래그앤드롭 유도 화면 */
            <div 
              className={`h-full flex flex-col items-center justify-center p-8 text-center transition-colors cursor-pointer ${
                isDragOver ? 'bg-sky-950/30 border-2 border-dashed border-sky-500' : ''
              }`}
              onClick={() => folderInputRef.current?.click()}
            >
              <div className="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400 mb-4 shadow-inner">
                <FolderOpen className="w-8 h-8 text-sky-400" />
              </div>
              <h3 className="text-base font-bold text-white">
                사업자등록증 폴더를 이곳으로 드래그하거나 클릭하여 선택하십시오
              </h3>
              <p className="text-xs text-slate-400 max-w-md mt-1.5 leading-relaxed">
                PDF 파일 및 이미지(PNG, JPG, WEBP)가 포함된 폴더를 통째로 지정하면 모든 파일을 순회하여 
                {targetType === 'CUSTOMER' ? ' 매출처(고객사)' : ' 매입처(협력사)'} 마스터에 
                자동으로 등록하거나 기존 정보를 보완합니다.
              </p>
              <div className="flex items-center gap-2 mt-5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    folderInputRef.current?.click();
                  }}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>사업자등록증 폴더 열기</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    filesInputRef.current?.click();
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 active:scale-95"
                >
                  <FileText className="w-4 h-4 text-sky-400" />
                  <span>개별 파일 다중 선택</span>
                </button>
              </div>
            </div>
          ) : (
            /* 실시간 고밀도 스트리밍 대사 테이블 */
            <table className="w-full text-left border-collapse font-sans text-xs">
              <thead className="bg-slate-950 text-slate-400 font-bold sticky top-0 z-10 border-b border-slate-800">
                <tr className="h-9">
                  <th className="px-3 py-1 text-center w-12 whitespace-nowrap flex-shrink-0">No.</th>
                  <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">상태</th>
                  <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">파일명 / 경로</th>
                  <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">상호 (법인명)</th>
                  <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">사업자등록번호</th>
                  <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">대표자</th>
                  <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">연락처 / 이메일</th>
                  <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">소재지</th>
                  <th className="px-3 py-1 whitespace-nowrap flex-shrink-0">처리 결과 및 상세</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-normal text-slate-300">
                {results.map((row) => {
                  const isCurProcessing = row.status === 'PROCESSING';
                  const isNew = row.status === 'SUCCESS_NEW';
                  const isUpdated = row.status === 'SUCCESS_UPDATED';
                  const isFail = row.status === 'FAILED';
                  const isPending = row.status === 'PENDING';

                  return (
                    <tr 
                      key={row.index} 
                      className={`h-9 hover:bg-slate-800/50 transition-colors ${
                        isCurProcessing ? 'bg-sky-950/30' : ''
                      }`}
                    >
                      {/* 순번 */}
                      <td className="px-3 py-1 text-center font-mono text-slate-500 whitespace-nowrap">
                        {row.index}
                      </td>

                      {/* 상태 배지 */}
                      <td className="px-3 py-1 whitespace-nowrap">
                        {isNew && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-emerald-950 border border-emerald-800 text-emerald-300">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>신규등록</span>
                          </span>
                        )}
                        {isUpdated && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-sky-950 border border-sky-800 text-sky-300">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>정보보완</span>
                          </span>
                        )}
                        {isCurProcessing && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-blue-950 border border-blue-800 text-blue-300 animate-pulse">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>분석중</span>
                          </span>
                        )}
                        {isFail && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-rose-950 border border-rose-800 text-rose-300">
                            <AlertCircle className="w-3 h-3" />
                            <span>오류</span>
                          </span>
                        )}
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-400">
                            <Clock className="w-3 h-3" />
                            <span>대기</span>
                          </span>
                        )}
                        {row.status === 'SKIPPED' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-950 border border-amber-800 text-amber-300">
                            <span>건너뜀</span>
                          </span>
                        )}
                      </td>

                      {/* 파일명 */}
                      <td className="px-3 py-1 font-mono text-[11px] text-slate-300 whitespace-nowrap max-w-[180px] truncate" title={row.filePath}>
                        {row.fileName}
                      </td>

                      {/* 상호 */}
                      <td className="px-3 py-1 font-bold text-white whitespace-nowrap max-w-[160px] truncate" title={row.companyName || ''}>
                        {row.companyName || (isPending ? '-' : '판독 중...')}
                      </td>

                      {/* 사업자번호 */}
                      <td className="px-3 py-1 font-mono text-slate-300 whitespace-nowrap">
                        {row.bizRegNo || '-'}
                      </td>

                      {/* 대표자 */}
                      <td className="px-3 py-1 whitespace-nowrap">
                        {row.representative || '-'}
                      </td>

                      {/* 연락처 / 이메일 */}
                      <td className="px-3 py-1 font-mono text-[11px] text-slate-400 whitespace-nowrap max-w-[160px] truncate">
                        {row.repContact || row.repEmail ? `${row.repContact || ''} ${row.repEmail ? `(${row.repEmail})` : ''}` : '-'}
                      </td>

                      {/* 소재지 */}
                      <td className="px-3 py-1 text-slate-400 whitespace-nowrap max-w-[180px] truncate" title={row.address || ''}>
                        {row.address || '-'}
                      </td>

                      {/* 처리 결과 및 상세 */}
                      <td className="px-3 py-1 text-[11px] whitespace-nowrap max-w-[220px] truncate">
                        {row.error ? (
                          <span className="text-rose-400 font-bold" title={row.error}>{row.error}</span>
                        ) : (
                          <span className="text-slate-400" title={row.details || ''}>{row.details || '-'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ─── ⑤ 하단 마감 및 엑셀 다운로드 바 (Terminal Action: 우하단 종결) ─── */}
        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-mono">
              대기열: <strong className="text-white">{results.length}건</strong>
            </span>
            <span>•</span>
            <span className="font-mono">
              완료: <strong className="text-emerald-400">{currentProgress.successNew + currentProgress.successUpdated}건</strong>
            </span>
            {currentProgress.failed > 0 && (
              <>
                <span>•</span>
                <span className="font-mono text-rose-400">
                  오류: <strong>{currentProgress.failed}건</strong>
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={results.length === 0}
              onClick={handleExportExcel}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 active:scale-95 disabled:opacity-40 transition-all whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>결과 엑셀 다운로드</span>
            </button>

            <button
              type="button"
              disabled={isProcessing}
              onClick={handleFinishAndClose}
              className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition-all whitespace-nowrap disabled:opacity-40"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>완료 및 닫기</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
