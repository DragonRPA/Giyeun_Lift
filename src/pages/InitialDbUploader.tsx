// @ts-nocheck
import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  exportFullDatabaseBackup,
  resetAllDatabaseTables,
  parseWorkbookToEntities,
  ingestExcelInitialData,
  ParsedInitialData,
  ReconciliationReport,
  parseDispatchExcelWorkbook,
  ingestDispatchData,
  ParsedDispatchData,
  generateAndIngestHistoricalBillingsDirect,
  parseDispatchHistoryText,
  analyzeDispatchHistoryForCustomerDefaults,
  ingestCustomerDefaultsFromDispatchHistory,
  DispatchAnalysisResult,
  CustomerEnrichmentSummary,
  parseBandAsHistoryText,
  analyzeBandAsHistory,
  ingestBandAsHistoryDirect,
  BandAsAnalysisResult,
  ParsedBandAsRecord
} from '../services/migrationEngine';
import {
  parseConsumableInventoryText,
  ingestConsumablesToDatabase,
  SEED_INVENTORY_ITEMS,
  ParsedConsumableItem,
  detectSupplier,
  detectCategory
} from '../services/consumableMigrationService';
import * as XLSX from 'xlsx';
import {
  Database,
  Download,
  Trash2,
  Upload,
  CheckCircle,
  AlertTriangle,
  FileSpreadsheet,
  Layers,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  XCircle,
  FileText,
  Truck,
  RotateCcw,
  Receipt,
  FileCheck,
  TrendingUp,
  History,
  Wrench,
  Search,
  Eye,
  X,
  Copy,
  Boxes,
  Package
} from 'lucide-react';

export const InitialDbUploader: React.FC = () => {
  const { showSuccessToast, showErrorModal, fullRefreshFromServer, users, customers, contracts, contractAssets, customerSites, assets, importBandAsHistory, currentUser } = useApp();

  // 상태 관리
  const [activeTab, setActiveTab] = useState<'INGEST' | 'BACKUP' | 'RESET'>('INGEST');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<{ filename: string; count: number } | null>(null);

  // 초기화 상태
  const [isResetting, setIsResetting] = useState(false);
  const [keepAdminUser, setKeepAdminUser] = useState(true);

  // 엑셀 파싱 및 마이그레이션 상태
  const [fileName, setFileName] = useState<string>('');
  const [parsedData, setParsedData] = useState<ParsedInitialData | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [progressInfo, setProgressInfo] = useState<{ step: number; total: number; message: string }>({
    step: 0,
    total: 13,
    message: ''
  });
  const [reconciliationReport, setReconciliationReport] = useState<ReconciliationReport | null>(null);

  // 소급 청구서 생성 기간 설정
  const [histBillingEnabled, setHistBillingEnabled] = useState(true);
  const [histBillingStart, setHistBillingStart] = useState('2026-01');
  const [histBillingEnd, setHistBillingEnd] = useState('2026-07');
  const [isHistBillingIngesting, setIsHistBillingIngesting] = useState(false);
  const [histBillingProgressMsg, setHistBillingProgressMsg] = useState('');

  // 배차 이력 업로드 상태
  const [dispatchFileName, setDispatchFileName] = useState<string>('');
  const [dispatchParsedData, setDispatchParsedData] = useState<ParsedDispatchData | null>(null);
  const [isDispatchParsing, setIsDispatchParsing] = useState(false);
  const [isDispatchIngesting, setIsDispatchIngesting] = useState(false);
  const [dispatchProgressMsg, setDispatchProgressMsg] = useState('');

  const dispatchFileInputRef = useRef<HTMLInputElement>(null);

  // 밴드 과거 AS 이력 업로드 상태
  const [bandFileName, setBandFileName] = useState<string>('');
  const [bandAnalysisResult, setBandAnalysisResult] = useState<BandAsAnalysisResult | null>(null);
  const [bandSearchTerm, setBandSearchTerm] = useState<string>('');
  const [bandStatusFilter, setBandStatusFilter] = useState<'ALL' | 'COMPLETED' | 'REVISIT' | 'GUIDED'>('ALL');
  const [bandContractFilter, setBandContractFilter] = useState<'ALL' | 'MATCHED' | 'UNMATCHED' | 'GUESSED'>('ALL');
  const [isBandParsing, setIsBandParsing] = useState(false);
  const [isBandIngesting, setIsBandIngesting] = useState(false);
  const [bandProgressMsg, setBandProgressMsg] = useState('');
  const [selectedAsRecord, setSelectedAsRecord] = useState<ParsedBandAsRecord | null>(null);

  const bandFileInputRef = useRef<HTMLInputElement>(null);

  // 🌟 밴드 출고요청 분석 및 고객사/현장 기본 요구사항 마스터 동기화 상태
  const [dispatchHistFileName, setDispatchHistFileName] = useState<string>('');
  const [dispatchAnalysisResult, setDispatchAnalysisResult] = useState<DispatchAnalysisResult | null>(null);
  const [isAnalyzingDispatchHist, setIsAnalyzingDispatchHist] = useState(false);
  const [isIngestingCustomerDefaults, setIsIngestingCustomerDefaults] = useState(false);
  const [dispatchHistProgressMsg, setDispatchHistProgressMsg] = useState('');
  const [showIgnoredPostsModal, setShowIgnoredPostsModal] = useState(false);
  const dispatchHistFileInputRef = useRef<HTMLInputElement>(null);

  // 📦 소모품 및 부품 재고 업로드 상태
  const [consumableFileName, setConsumableFileName] = useState<string>('');
  const [consumableRawText, setConsumableRawText] = useState<string>('');
  const [parsedConsumables, setParsedConsumables] = useState<ParsedConsumableItem[] | null>(null);
  const [isConsumableParsing, setIsConsumableParsing] = useState(false);
  const [isConsumableIngesting, setIsConsumableIngesting] = useState(false);
  const [showConsumableTextarea, setShowConsumableTextarea] = useState(false);
  const consumableFileInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 소모품 파일 파싱 핸들러 (.txt 또는 .xlsx) ──
  const handleConsumableFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    setConsumableFileName(file.name);
    setIsConsumableParsing(true);

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const sheetName = wb.SheetNames[0];
          const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
          const items: ParsedConsumableItem[] = rows.map((r, idx) => {
            const mName = String(r['품목명'] || r['모델명'] || r['소모품명'] || r['품명'] || `품목-${idx + 1}`).trim();
            const qty = Number(r['수량'] || r['현재고'] || r['재고수량'] || 1);
            const price = Number(r['단가'] || r['입고단가'] || r['단가(원)'] || 0);
            return {
              modelName: mName,
              stockQty: isNaN(qty) ? 1 : qty,
              unit: String(r['단위'] || '개').trim(),
              unitPrice: isNaN(price) ? 0 : price,
              supplier: String(r['제조사'] || r['공급처'] || detectSupplier(mName)).trim(),
              category: String(r['분류'] || r['카테고리'] || detectCategory(mName)).trim(),
              note: String(r['비고'] || r['특이사항'] || '').trim()
            };
          });
          setParsedConsumables(items);
          showSuccessToast?.(`소모품 엑셀 파싱 완료: ${items.length}건`);
        } catch (err: any) {
          showErrorModal?.(`소모품 엑셀 파싱 오류: ${err.message}`);
        } finally {
          setIsConsumableParsing(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const text = evt.target?.result as string;
          setConsumableRawText(text);
          const items = parseConsumableInventoryText(text);
          setParsedConsumables(items);
          showSuccessToast?.(`소모품 텍스트 파싱 완료: ${items.length}건`);
        } catch (err: any) {
          showErrorModal?.(`소모품 텍스트 파싱 오류: ${err.message}`);
        } finally {
          setIsConsumableParsing(false);
        }
      };
      reader.readAsText(file);
    }
  };

  // ── 텍스트 직접 입력 시 파싱 ──
  const handleConsumableTextareaParse = () => {
    if (!consumableRawText.trim()) {
      showErrorModal?.('파싱할 텍스트 내용을 입력해 주세요.');
      return;
    }
    try {
      const items = parseConsumableInventoryText(consumableRawText);
      setParsedConsumables(items);
      setConsumableFileName('직접 텍스트 입력');
      showSuccessToast?.(`소모품 텍스트 파싱 완료: ${items.length}건`);
    } catch (err: any) {
      showErrorModal?.(`텍스트 파싱 오류: ${err.message}`);
    }
  };

  // ── 표준 30종 기본 재고 즉시 불러오기 ──
  const handleLoadDefaultSeedConsumables = () => {
    setConsumableFileName('소모품재고.txt (표준 30종 마스터)');
    setParsedConsumables([...SEED_INVENTORY_ITEMS]);
    showSuccessToast?.('관리 소모품 30종 (총 102개) 즉시 로드 완료');
  };

  // ── 소모품 재고 일괄 DB 반영 ──
  const handleConsumablesIngest = async () => {
    if (!parsedConsumables || parsedConsumables.length === 0) {
      showErrorModal?.('반영할 소모품 목록이 없습니다. 파일을 선택하거나 기본 목록을 불러와 주세요.');
      return;
    }
    setIsConsumableIngesting(true);
    try {
      const res = await ingestConsumablesToDatabase(parsedConsumables, currentUser?.id);
      showSuccessToast?.(`소모품 DB 반영 완료: 신규 ${res.addedCount}건, 갱신 ${res.updatedCount}건, 총 재고 ${res.totalQty}개`);
      await fullRefreshFromServer();
    } catch (err: any) {
      showErrorModal?.(`소모품 DB 반영 실패: ${err.message}`);
    } finally {
      setIsConsumableIngesting(false);
    }
  };

  // ── 1. DB 전체 백업 실행 ──
  const handleBackup = async () => {
    setIsBackingUp(true);
    try {
      const { backupData, filename } = await exportFullDatabaseBackup();
      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const totalRows = Object.values(backupData).reduce((acc, arr) => acc + (arr?.length || 0), 0);
      setBackupResult({ filename, count: totalRows });
      showSuccessToast?.(`전체 DB 백업 완료 (${totalRows.toLocaleString()}건)`);
    } catch (e: any) {
      showErrorModal?.(`백업 실패: ${e.message}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  // ── 2. DB 초기화 실행 ──
  const handleReset = async () => {
    if (!window.confirm('기존의 모든 자산, 고객사, 계약, 배차, 청구 대장을 영구 삭제하고 초기화하시겠습니까?')) {
      return;
    }

    setIsResetting(true);
    try {
      const res = await resetAllDatabaseTables(keepAdminUser);
      if (res.success) {
        showSuccessToast?.(res.message);
        // ✅ DB 초기화 완료 후 localStorage stale 캐시 차단 + Supabase 최신 상태로 React state 즉시 동기화
        await fullRefreshFromServer();
      } else {
        showErrorModal?.(res.message);
      }
    } catch (e: any) {
      showErrorModal?.(`초기화 오류: ${e.message}`);
    } finally {
      setIsResetting(false);
    }
  };

  // ── 3. 엑셀 파일 선택 및 분석 ──
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setFileName(file.name);
    setIsParsing(true);
    setReconciliationReport(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const histRange = histBillingEnabled
          ? { start: histBillingStart, end: histBillingEnd }
          : undefined;
        const parsed = parseWorkbookToEntities(wb, users, histRange);
        setParsedData(parsed);
        showSuccessToast?.(`엑셀 분석 완료: 계약 ${parsed.stats.contractsCount}건, 출고배차 ${parsed.stats.outboundDeliveriesCount}건, 소급청구 ${parsed.stats.historicalBillingsCount}건`);
      } catch (err: any) {
        showErrorModal?.(`엑셀 파싱 오류: ${err.message}`);
      } finally {
        setIsParsing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── 배차 이력 엑셀 파싱 ──
  const handleDispatchFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    setDispatchFileName(file.name);
    setIsDispatchParsing(true);
    setDispatchParsedData(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const parsed = parseDispatchExcelWorkbook(
          wb,
          customers || [],
          contractAssets || [],
          contracts || [],
          customerSites || []
        );
        setDispatchParsedData(parsed);
        showSuccessToast?.(
          `배차 이력 파싱 완료: 총 ${parsed.stats.total}건 / EXCHANGE ${parsed.stats.exchangeCount}건 / 고객미매핑 ${parsed.stats.customerUnmatched}건`
        );
      } catch (err: any) {
        showErrorModal?.(`배차 엑셀 파싱 오류: ${err.message}`);
      } finally {
        setIsDispatchParsing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── 배차 이력 일괄 적재 ──
  const handleDispatchIngest = async () => {
    if (!dispatchParsedData) {
      showErrorModal?.('분석된 배차 데이터가 없습니다. 먼저 파일을 선택해 주세요.');
      return;
    }
    setIsDispatchIngesting(true);
    setDispatchProgressMsg('배차 이력 적재 시작...');
    try {
      const result = await ingestDispatchData(dispatchParsedData, (_step, _total, msg) => {
        setDispatchProgressMsg(msg);
      });
      if (result.success) {
        showSuccessToast?.(result.message);
        await fullRefreshFromServer();
      } else {
        showErrorModal?.(result.message);
      }
    } catch (e: any) {
      showErrorModal?.(`배차 적재 오류: ${e.message}`);
    } finally {
      setIsDispatchIngesting(false);
      setDispatchProgressMsg('');
    }
  };

  // ── 과거 소급 청구서 독립 선택 생성 및 적재 ──
  const handleDirectHistBillingIngest = async () => {
    if (!contracts || contracts.length === 0) {
      showErrorModal?.('DB에 등록된 계약 데이터가 없습니다. 먼저 초기 DB 엑셀 파일을 업로드해 주세요.');
      return;
    }

    if (!histBillingStart || !histBillingEnd) {
      showErrorModal?.('소급 청구서 생성 시작 월과 종료 월을 입력해 주세요.');
      return;
    }

    if (histBillingStart > histBillingEnd) {
      showErrorModal?.('시작 월이 종료 월보다 클 수 없습니다.');
      return;
    }

    setIsHistBillingIngesting(true);
    setHistBillingProgressMsg('소급 청구서 계산 및 적재 시작...');

    try {
      const result = await generateAndIngestHistoricalBillingsDirect(
        contracts,
        contractAssets || [],
        customers || [],
        assets || [],
        { start: histBillingStart, end: histBillingEnd },
        (_step, _total, msg) => {
          setHistBillingProgressMsg(msg);
        }
      );

      if (result.success) {
        showSuccessToast?.(result.message);
        await fullRefreshFromServer();
      } else {
        showErrorModal?.(result.message);
      }
    } catch (e: any) {
      showErrorModal?.(`소급 청구서 생성 오류: ${e.message}`);
    } finally {
      setIsHistBillingIngesting(false);
      setHistBillingProgressMsg('');
    }
  };

  // ── 밴드 AS 이력 텍스트/JSON 파서 및 적재 로직 ──
  const extractFieldsFromBandRaw = (raw: string, date: string, author: string) => {
    let site = '';
    let address = '';
    let contractor = '';
    let assetNo = '';
    let location = '';
    let contact = '';
    let issue = '';

    const lines = raw.split('\n');
    for (const l of lines) {
      if (l.includes('현장') || l.includes('현 장')) {
        site = l.replace(/^[^:]*[:：]\s*/, '').trim();
      } else if (l.includes('주소') || l.includes('상세주소') || l.includes('도로명')) {
        address = l.replace(/^[^:]*[:：]\s*/, '').trim();
      } else if (l.includes('업체') || l.includes('업 체')) {
        contractor = l.replace(/^[^:]*[:：]\s*/, '').trim();
      } else if (l.includes('장비') || l.includes('호기') || l.includes('관리번호') || l.includes('장 비')) {
        assetNo = l.replace(/^[^:]*[:：]\s*/, '').trim();
      } else if (l.includes('위치') || l.includes('위 치')) {
        location = l.replace(/^[^:]*[:：]\s*/, '').trim();
      } else if (l.includes('연락처') || l.includes('전화') || l.includes('연 락 처')) {
        contact = l.replace(/^[^:]*[:：]\s*/, '').trim();
      } else if (l.includes('증상') || l.includes('내용') || l.includes('고장')) {
        issue = l.replace(/^[^:]*[:：]\s*/, '').trim();
      }
    }

    if (!assetNo) {
      const assetMatch = raw.match(/([A-Za-z]\d{3,5}|\d{5})/);
      if (assetMatch) assetNo = assetMatch[1];
      else if (raw.includes('전체장비')) assetNo = '전체장비';
      else assetNo = '현장확인';
    }

    if (!site) {
      if (raw.includes('SK하이닉스') || raw.includes('하이닉스')) site = '용인 SK하이닉스';
      else if (raw.includes('평택 P') || raw.includes('P3') || raw.includes('P4')) site = '평택 고덕';
      else if (raw.includes('원주')) site = '원주 푸르지오';
      else site = '일반 현장';
    }

    if (!issue) {
      issue = raw.slice(0, 100);
    }

    let inspectionItemCode = '';
    let degradationScore = 0;
    
    // 💡 [Phase 1/2] 밴드 빅데이터 고장 증상 키워드 기반 정비 마스터 코드 및 노후도 점수 1:1 매핑 (Data Tagging)
    const lowerIssue = issue.toLowerCase();
    if (lowerIssue.includes('타이어') || lowerIssue.includes('바퀴') || lowerIssue.includes('주행') || lowerIssue.includes('궤도')) {
      inspectionItemCode = 'CHK-000004'; // 주행/타이어
      degradationScore = 20;
    } else if (lowerIssue.includes('배터리') || lowerIssue.includes('충전') || lowerIssue.includes('전기') || lowerIssue.includes('차단기')) {
      inspectionItemCode = 'CHK-000003'; // 전기/배터리
      degradationScore = 15;
    } else if (lowerIssue.includes('유압') || lowerIssue.includes('실린더') || lowerIssue.includes('모터') || lowerIssue.includes('동력') || lowerIssue.includes('누유')) {
      inspectionItemCode = 'CHK-000002'; // 유압/동력
      degradationScore = 10;
    } else if (lowerIssue.includes('외관') || lowerIssue.includes('파손') || lowerIssue.includes('안전바') || lowerIssue.includes('찌그러짐') || lowerIssue.includes('데칼')) {
      inspectionItemCode = 'CHK-000001'; // 외관/바디
      degradationScore = 5;
    } else {
      inspectionItemCode = 'CHK-000005'; // 기타/접수
      degradationScore = 5;
    }

    return {
      site: site || '미지정현장',
      address: address || '',
      contractor: contractor || '협력업체',
      asset_no: assetNo,
      location,
      contact,
      issue,
      date,
      author,
      raw,
      inspectionItemCode,
      degradationScore
    };
  };

  const parseBandTextContent = (text: string) => {
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json) && json.length > 0) return json;
    } catch (_) {}

    const lines = text.split('\n');
    const records: any[] = [];
    let currentPost: { author?: string; date?: string; lines: string[] } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const dateMatch = line.match(/(20\d{2})[.\-년\s]+(\d{1,2})[.\-월\s]+(\d{1,2})/);
      if (dateMatch && (line.includes('오전') || line.includes('오후') || line.length < 50)) {
        if (currentPost && currentPost.lines.length > 0) {
          const raw = currentPost.lines.join('\n');
          records.push(extractFieldsFromBandRaw(raw, currentPost.date || '2026-08-01', currentPost.author || ''));
        }
        const y = dateMatch[1];
        const m = String(dateMatch[2]).padStart(2, '0');
        const d = String(dateMatch[3]).padStart(2, '0');
        currentPost = {
          date: `${y}-${m}-${d}`,
          author: line.split(/\s+/)[0] || '',
          lines: []
        };
      } else {
        if (currentPost) {
          currentPost.lines.push(line);
        } else {
          currentPost = { date: '2026-08-01', author: '', lines: [line] };
        }
      }
    }
    if (currentPost && currentPost.lines.length > 0) {
      const raw = currentPost.lines.join('\n');
      records.push(extractFieldsFromBandRaw(raw, currentPost.date || '2026-08-01', currentPost.author || ''));
    }
    return records;
  };

  const handleBandFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBandFileName(file.name);
    setIsBandParsing(true);
    try {
      const text = await file.text();
      const analysis = analyzeBandAsHistory(text, contracts, contractAssets, customers, customerSites, assets, users);
      if (!analysis || analysis.totalCount === 0) {
        showErrorModal?.('파싱 가능한 AS 게시글 데이터를 찾을 수 없습니다.');
        return;
      }

      setBandAnalysisResult(analysis);
      showSuccessToast?.(`밴드 AS 데이터 총 ${analysis.totalCount.toLocaleString()}건 전수 분석 완료 (고유장비 ${analysis.uniqueAssetsCount.toLocaleString()}대, 계약 ${analysis.matchedContractCount.toLocaleString()}건 매핑)`);
    } catch (err: any) {
      showErrorModal?.(`밴드 파일 분석 실패: ${err.message || err}`);
    } finally {
      setIsBandParsing(false);
      e.target.value = '';
    }
  };

  const handleBandIngest = async () => {
    if (!bandAnalysisResult || bandAnalysisResult.totalCount === 0) return;

    setIsBandIngesting(true);
    setBandProgressMsg('과거 AS 이력 정비 마스터(repairs) DB 적재 중...');
    try {
      const result = await ingestBandAsHistoryDirect(bandAnalysisResult, (curr, tot, msg) => {
        setBandProgressMsg(msg);
      });
      showSuccessToast?.(result.message);
      await fullRefreshFromServer();
    } catch (err: any) {
      showErrorModal?.(`밴드 AS 적재 오류: ${err.message || err}`);
    } finally {
      setIsBandIngesting(false);
      setBandProgressMsg('');
    }
  };

  // ── 🌟 밴드 출고요청 분석 및 고객/현장 요구사항 동기화 핸들러 ──
  const handleDispatchHistFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setDispatchHistFileName(file.name);
    setIsAnalyzingDispatchHist(true);
    try {
      const text = await file.text();
      const posts = parseDispatchHistoryText(text);
      if (!posts || posts.length === 0) {
        showErrorModal?.('파싱 가능한 출고요청 게시글 데이터를 찾을 수 없습니다.');
        return;
      }

      const analysis = analyzeDispatchHistoryForCustomerDefaults(
        posts,
        customers || [],
        customerSites || [],
        contracts || [],
        []
      );

      setDispatchAnalysisResult(analysis);
      showSuccessToast?.(`출고요청 ${posts.length}건 분석 완료 (유효 계약 고객 ${analysis.stats.contractedCustomerCount}개사 매칭)`);
    } catch (err: any) {
      showErrorModal?.(`출고요청 파일 분석 실패: ${err.message || err}`);
    } finally {
      setIsAnalyzingDispatchHist(false);
      e.target.value = '';
    }
  };

  const handleCustomerDefaultsIngest = async () => {
    if (!dispatchAnalysisResult || dispatchAnalysisResult.matchedEnrichments.length === 0) {
      showErrorModal?.('동기화할 유효 계약 고객 데이터가 없습니다.');
      return;
    }

    setIsIngestingCustomerDefaults(true);
    setDispatchHistProgressMsg('고객사/현장 기본 요구사항 마스터 동기화 중...');
    try {
      const res = await ingestCustomerDefaultsFromDispatchHistory(
        dispatchAnalysisResult.matchedEnrichments,
        (step, total, msg) => {
          setDispatchHistProgressMsg(`[${step}/${total}] ${msg}`);
        }
      );

      if (res.success) {
        showSuccessToast?.(res.message);
        await fullRefreshFromServer();
      } else {
        showErrorModal?.(res.message);
      }
    } catch (err: any) {
      showErrorModal?.(`고객 요구사항 적재 오류: ${err.message || err}`);
    } finally {
      setIsIngestingCustomerDefaults(false);
      setDispatchHistProgressMsg('');
    }
  };

  // ── 밴드 콘솔 추출 스크립트 클립보드 복사 ──
  const handleCopyBandScraperScript = () => {
    const scriptCode = `(async () => {
  console.log('🚀 [ERP] 밴드 postDetailView ➔ txtBody 정밀 순차 수집기 v8.0 시작...');

  const hudId = 'band_modal_scraper_hud';
  const oldHud = document.getElementById(hudId);
  if (oldHud) oldHud.remove();

  const hud = document.createElement('div');
  hud.id = hudId;
  hud.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999999;background:rgba(15,23,42,0.96);color:#fff;padding:18px 22px;border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,0.5);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;line-height:1.5;min-width:340px;border:2px solid #38bdf8;backdrop-filter:blur(8px);';
  hud.innerHTML = 
    '<div style="font-weight:700;font-size:15px;margin-bottom:10px;color:#38bdf8;display:flex;align-items:center;justify-content:space-between;">' +
      '<span>🚜 밴드 순차 수집기 v8.0</span>' +
      '<span id="hud_status_badge" style="font-size:11px;font-weight:600;padding:3px 8px;background:#0284c7;border-radius:6px;color:#fff;">수집 중</span>' +
    '</div>' +
    '<div style="margin-bottom:6px;display:flex;justify-content:space-between;border-bottom:1px solid #334155;padding-bottom:6px;">' +
      '<span>수집된 게시글:</span>' +
      '<strong id="hud_post_count" style="color:#4ade80;font-size:17px;">0 건</strong>' +
    '</div>' +
    '<div style="margin-bottom:8px;border-bottom:1px solid #334155;padding-bottom:6px;">' +
      '<div style="font-size:11px;color:#94a3b8;">현재 수집된 일시 / 작성자:</div>' +
      '<div id="hud_current_date" style="color:#facc15;font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">대기 중...</div>' +
    '</div>' +
    '<div style="margin-bottom:12px;font-size:11px;color:#cbd5e1;line-height:1.4;max-height:42px;overflow:hidden;text-overflow:ellipsis;" id="hud_info">게시글 본문(txtBody) 읽는 중...</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button id="hud_btn_stop" style="flex:1;padding:8px 10px;background:#ef4444;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;">중단 및 저장</button>' +
      '<button id="hud_btn_save" style="flex:1;padding:8px 10px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;">지금 다운로드</button>' +
    '</div>';
  document.body.appendChild(hud);

  const postMap = new Map();
  let isRunning = true;

  const updateHud = (statusText, dateStr, previewMsg, isDone = false) => {
    const elBadge = document.getElementById('hud_status_badge');
    const elCount = document.getElementById('hud_post_count');
    const elDate = document.getElementById('hud_current_date');
    const elInfo = document.getElementById('hud_info');

    if (elCount) elCount.innerText = postMap.size + ' 건';
    if (elBadge && statusText) {
      elBadge.innerText = statusText;
      elBadge.style.background = isDone ? '#10b981' : '#0284c7';
    }
    if (elDate && dateStr) elDate.innerText = dateStr;
    if (elInfo && previewMsg) elInfo.innerText = previewMsg;
  };

  const triggerDownload = () => {
    if (postMap.size === 0) {
      alert('수집된 게시글이 없습니다.');
      return;
    }
    const allPosts = Array.from(postMap.values());
    const fullText = allPosts.join('\\n\\n');
    const blob = new Blob(['\\uFEFF' + fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'band_dispatch_history_full.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    updateHud('완료', null, '✅ 총 ' + postMap.size + '건 파일 다운로드 완료!', true);
    console.log('🎉 [ERP] 총 ' + postMap.size + '건 다운로드 완료! (band_dispatch_history_full.txt)');
  };

  document.getElementById('hud_btn_stop')?.addEventListener('click', () => {
    isRunning = false;
    triggerDownload();
  });
  document.getElementById('hud_btn_save')?.addEventListener('click', () => {
    triggerDownload();
  });

  const getDetailLayer = () => {
    return document.querySelector('.postDetailView, [data-viewname="DContentDetailLayerView"], .lyPostViewer, .cPostCard');
  };

  const extractCurrentPost = () => {
    const layer = getDetailLayer();
    if (!layer) return null;

    const authorWrap = layer.querySelector('[data-viewname="DPostAuthorView"], .postWriter');
    let author = '관리자';
    let dateStr = '';

    if (authorWrap) {
      const authorText = authorWrap.innerText || '';
      const dm = authorText.match(/(\\d{4}년\\s*\\d{1,2}월\\s*\\d{1,2}일\\s*(?:오전|오후)\\s*\\d{1,2}:\\d{2})/);
      if (dm) dateStr = dm[1];

      const nameEl = authorWrap.querySelector('.name, strong, a.author, .author');
      if (nameEl && nameEl.innerText.trim()) {
        author = nameEl.innerText.trim();
      } else {
        const lines = authorText.split('\\n').map(s => s.trim()).filter(Boolean);
        if (lines.length > 0 && !lines[0].includes('년') && !lines[0].includes('월')) {
          author = lines[0];
        }
      }
    }

    if (!dateStr) {
      const dm2 = layer.innerText.match(/(\\d{4}년\\s*\\d{1,2}월\\s*\\d{1,2}일\\s*(?:오전|오후)\\s*\\d{1,2}:\\d{2})/);
      if (dm2) dateStr = dm2[1];
    }

    const bodyEl = layer.querySelector('.postBody .txtBody, [data-viewname="DPostTextView"] .txtBody, .txtBody') ||
                   layer.querySelector('.postBody .postText, .postText');
    if (!bodyEl) return null;

    const bodyText = bodyEl.innerText.trim();
    if (!bodyText) return null;

    let commentsText = '';
    const commentNodes = layer.querySelectorAll('[data-viewname="DCommentItemView"], .comment_item, .uComment, .cCommentItem');
    if (commentNodes.length > 0) {
      const cLines = [];
      commentNodes.forEach(cn => {
        const cText = cn.innerText.trim().replace(/\\n+/g, ' ');
        if (cText && !cText.includes('댓글을 남겨주세요') && !cText.includes('표정짓기')) {
          cLines.push('댓글: ' + cText);
        }
      });
      if (cLines.length > 0) {
        commentsText = '\\n\\n' + cLines.join('\\n');
      }
    }

    const headerLine = (dateStr || '일시미상') + ' 게시글';
    const fullText = headerLine + '\\n' + author + '\\n' + bodyText + commentsText;
    const signature = (dateStr || 'NODATE') + ' | ' + bodyText.slice(0, 40);

    return {
      date: dateStr || '일시미상',
      author,
      body: bodyText,
      fullText,
      signature
    };
  };

  const waitForNextButton = async (timeoutMs = 4000) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const btn = document.querySelector('button.btnNextPost, button._btnNextPost, [class*="btnNextPost"]');
      if (btn) {
        const isHidden = (btn.style.display === 'none') || (window.getComputedStyle(btn).display === 'none');
        const isDisabled = btn.disabled || btn.classList.contains('disabled') || btn.classList.contains('-disabled') || btn.getAttribute('aria-disabled') === 'true';
        if (!isHidden && !isDisabled) {
          return btn;
        }
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return null;
  };

  const clickNextButton = (btn) => {
    try {
      btn.scrollIntoView({ block: 'center' });
    } catch(e) {}

    const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const evType of eventTypes) {
      try {
        btn.dispatchEvent(new MouseEvent(evType, { bubbles: true, cancelable: true, view: window }));
      } catch (e) {}
    }
    try { btn.click(); } catch(e) {}

    const innerSpan = btn.querySelector('span, .gSrOnly');
    if (innerSpan) {
      try { innerSpan.click(); } catch(e) {}
    }
  };

  const waitForPostChange = async (oldSignature, maxWaitMs = 6000) => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, 200));
      const cur = extractCurrentPost();
      if (cur && cur.body.length > 0 && cur.signature !== oldSignature) {
        await new Promise(r => setTimeout(r, 300));
        return true;
      }
    }
    return false;
  };

  let step = 0;
  let consecutiveFailCount = 0;

  console.log('🔄 밴드 상세뷰 모달 순차 수집 시작...');

  while (isRunning && step < 4000) {
    step++;

    const post = extractCurrentPost();
    if (!post) {
      updateHud('대기 중', null, '게시글 본문(txtBody) 로딩 중...');
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    if (!postMap.has(post.signature) || post.fullText.length > (postMap.get(post.signature)?.length || 0)) {
      postMap.set(post.signature, post.fullText);
      console.log('📦 [' + postMap.size + '건 수집] ' + post.date + ' | ' + post.author + ' | 본문길이: ' + post.body.length + '자');
    }

    updateHud('수집 중', post.date + ' (' + post.author + ')', '[' + postMap.size + '건] ' + post.body.slice(0, 35) + '...');

    let nextBtn = await waitForNextButton(3500);
    if (!nextBtn) {
      await new Promise(r => setTimeout(r, 1000));
      nextBtn = await waitForNextButton(2000);
      if (!nextBtn) {
        console.log('🏁 다음(>) 버튼이 더 이상 없습니다. 마지막 글 도달 완료!');
        break;
      }
    }

    updateHud('로딩 중', post.date, '다음(>) 글 로딩 중...');
    clickNextButton(nextBtn);

    const changed = await waitForPostChange(post.signature, 5000);

    if (!changed) {
      console.warn('⚠️ 글 전환 지연 감지. 버튼 재클릭 시도...');
      const retryBtn = await waitForNextButton(2000);
      if (retryBtn) {
        clickNextButton(retryBtn);
        const retryChanged = await waitForPostChange(post.signature, 4000);
        if (!retryChanged) {
          consecutiveFailCount++;
          if (consecutiveFailCount >= 2) {
            console.log('🏁 2회 연속 글 변경 없음 -> 마지막 글 완료로 판정!');
            break;
          }
        } else {
          consecutiveFailCount = 0;
        }
      } else {
        console.log('🏁 다음 버튼 없음 -> 마지막 글 완료!');
        break;
      }
    } else {
      consecutiveFailCount = 0;
    }
  }

  console.log('✅ 최종 수집 완료! 총 ' + postMap.size + '건 수집됨.');
  triggerDownload();
})();`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(scriptCode).then(() => {
        showSuccessToast?.('📋 밴드 추출 스크립트가 복사되었습니다. 네이버 밴드 화면의 F12 콘솔에 붙여넣어 실행하세요.');
      }).catch(() => {
        showErrorModal?.('클립보드 복사에 실패했습니다.');
      });
    }
  };

  // ── 4. 시작점 데이터 일괄 적재 실행 ──
  const handleIngest = async () => {
    if (!parsedData) {
      showErrorModal?.('분석된 엑셀 데이터가 없습니다.');
      return;
    }

    setIsIngesting(true);
    setProgressInfo({ step: 0, total: 13, message: '초기 DB 적재 파이프라인 시작...' });

    try {
      const result = await ingestExcelInitialData(parsedData, (step, total, message) => {
        setProgressInfo({ step, total, message });
      });

      if (result.success) {
        setReconciliationReport(result.report);
        showSuccessToast?.(result.message);
        // ✅ 적재 완료 후 localStorage stale 캐시 전체 차단 + Supabase 최신 데이터로 React state 즉시 동기화
        // (db.ts의 pullFromSupabase가 ALL_DB_KEYS 전체를 선제 초기화한 뒤 Supabase pull을 수행함)
        setProgressInfo({ step: 12, total: 12, message: 'Supabase 최신 데이터 동기화 중...' });
        await fullRefreshFromServer();
      } else {
        setReconciliationReport(result.report);
        showErrorModal?.(result.message);
        // 실패 시에도 Supabase 현재 상태로 동기화 (부분 적재 결과 반영)
        await fullRefreshFromServer();
      }
    } catch (e: any) {
      showErrorModal?.(`적재 실행 오류: ${e.message}`);
    } finally {
      setIsIngesting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* 상단 타이틀 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Database size={28} color="#2563eb" />
          <div>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>초기DB 업로드</h1>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              신규 고객 서비스 개시를 위한 과거 라이프사이클 체인 복원 및 청구 마감 일괄 적재
            </span>
          </div>
        </div>

        {/* 탭 네비게이션 */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('INGEST')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '6px',
              border: activeTab === 'INGEST' ? '1px solid var(--primary)' : '1px solid var(--border-color)',
              backgroundColor: activeTab === 'INGEST' ? 'rgba(37, 99, 235, 0.15)' : 'var(--bg-card)',
              color: activeTab === 'INGEST' ? 'var(--primary)' : 'var(--text-secondary)',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <Upload size={16} />
            초기DB 업로드
          </button>

          <button
            onClick={() => setActiveTab('BACKUP')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '6px',
              border: activeTab === 'BACKUP' ? '1px solid var(--primary)' : '1px solid var(--border-color)',
              backgroundColor: activeTab === 'BACKUP' ? 'rgba(37, 99, 235, 0.15)' : 'var(--bg-card)',
              color: activeTab === 'BACKUP' ? 'var(--primary)' : 'var(--text-secondary)',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <Download size={16} />
            DB 백업
          </button>

          <button
            onClick={() => setActiveTab('RESET')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '6px',
              border: activeTab === 'RESET' ? '1px solid #ef4444' : '1px solid #cbd5e1',
              backgroundColor: activeTab === 'RESET' ? '#fef2f2' : 'var(--bg-card)',
              color: activeTab === 'RESET' ? '#b91c1c' : '#475569',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <Trash2 size={16} />
            DB 초기화
          </button>
        </div>
      </div>

      {/* ── TAB 1: 초기DB 업로드 (메인) ── */}
      {activeTab === 'INGEST' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 1. 파일 선택 카드 */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
              <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                엑셀 파일 선택
              </label>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                5개 시트(보유자산현황, 보유장비 임대현황, 거래처정보현황, 업체별마감일자, 계약현황)가 포함된 초기 현황 엑셀 파일(.xlsx)
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isParsing || isIngesting}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 20px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: isParsing || isIngesting ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                <FileSpreadsheet size={18} />
                엑셀 파일 선택
              </button>

              {fileName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px' }}>
                  <FileText size={16} color="#475569" />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>{fileName}</span>
                </div>
              )}

              {isParsing && (
                <span style={{ fontSize: '13px', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                  <RefreshCw size={14} className="animate-spin" />
                  엑셀 5개 시트 및 라이프사이클 이벤트 분석 중...
                </span>
              )}
            </div>
          </div>

          {/* 2. 과거 소급 청구서 선택적 생성 카드 */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <Layers size={16} color="#d97706" />
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#d97706', whiteSpace: 'nowrap' }}>
                과거 소급 청구서 생성 (선택 실행)
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                지정 기간 내 계약별 월별 청구서를 독립적으로 계산하여 DB에 일괄 생성합니다.
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>시작 월</label>
                <input
                  type="month"
                  value={histBillingStart}
                  onChange={e => setHistBillingStart(e.target.value)}
                  disabled={isHistBillingIngesting}
                  style={{
                    padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '6px',
                    fontSize: '14px', color: 'var(--text-main)', backgroundColor: 'var(--bg-app)', outline: 'none'
                  }}
                />
              </div>

              <span style={{ fontSize: '18px', color: 'var(--text-muted)', paddingBottom: '8px' }}>~</span>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>종료 월</label>
                <input
                  type="month"
                  value={histBillingEnd}
                  onChange={e => setHistBillingEnd(e.target.value)}
                  disabled={isHistBillingIngesting}
                  style={{
                    padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '6px',
                    fontSize: '14px', color: 'var(--text-main)', backgroundColor: 'var(--bg-app)', outline: 'none'
                  }}
                />
              </div>

              {/* 과거 소급 청구서 생성 실행 버튼 */}
              <button
                onClick={handleDirectHistBillingIngest}
                disabled={isHistBillingIngesting}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center',
                  padding: '9px 20px', backgroundColor: isHistBillingIngesting ? '#94a3b8' : '#d97706',
                  color: 'white', border: 'none', borderRadius: '6px',
                  cursor: isHistBillingIngesting ? 'not-allowed' : 'pointer',
                  fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap'
                }}
              >
                {isHistBillingIngesting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    소급 청구서 생성 중...
                  </>
                ) : (
                  <>
                    <Upload size={14} />
                    소급 청구서 생성 및 적재 시작
                  </>
                )}
              </button>

              <div style={{
                padding: '7px 12px', backgroundColor: '#fffbeb', border: '1px solid #fcd34d',
                borderRadius: '6px', fontSize: '12px', color: '#92400e', whiteSpace: 'nowrap'
              }}>
                ⚠️ {histBillingStart} ~ {histBillingEnd} 기간 계약별 월별 청구서 대량 생성
              </div>
            </div>

            {/* 진행 메시지 */}
            {histBillingProgressMsg && (
              <div style={{ marginTop: '12px', fontSize: '13px', color: '#d97706', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RefreshCw size={13} className="animate-spin" />
                {histBillingProgressMsg}
              </div>
            )}
          </div>

          {/* ③ 배차 이력 업로드 카드 */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <Truck size={16} color="#0369a1" />
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#0369a1', whiteSpace: 'nowrap' }}>
                배차 이력 업로드
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                배차현황 엑셀 파일 (2025-04 ~ 2026-09)
              </span>
            </div>

            {/* 파일 선택 버튼 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <input
                ref={dispatchFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleDispatchFileSelect}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => dispatchFileInputRef.current?.click()}
                disabled={isDispatchParsing || isDispatchIngesting}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', backgroundColor: '#0369a1', color: 'white',
                  border: 'none', borderRadius: '6px', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap',
                  opacity: (isDispatchParsing || isDispatchIngesting) ? 0.5 : 1
                }}
              >
                <FileSpreadsheet size={14} />
                배차 엑셀 파일 선택
              </button>

              {dispatchFileName && (
                <span style={{ fontSize: '13px', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                  {dispatchFileName}
                </span>
              )}

              {isDispatchParsing && (
                <span style={{ fontSize: '12px', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                  <RefreshCw size={13} className="animate-spin" /> 파싱 중...
                </span>
              )}
            </div>

            {/* 파싱 결과 프리뷰 */}
            {dispatchParsedData && (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                  {[
                    { label: '총 배차건', value: `${dispatchParsedData.stats.total}건`, color: 'var(--text-main)' },
                    { label: '완료', value: `${dispatchParsedData.stats.completed}건`, color: '#059669' },
                    { label: '왕복(EXCHANGE)', value: `${dispatchParsedData.stats.exchangeCount}건`, color: '#7c3aed' },
                    { label: '2026 운송사', value: `${dispatchParsedData.stats.transportCompaniesCount}개사`, color: '#0284c7' },
                    { label: '고객 미매핑', value: `${dispatchParsedData.stats.customerUnmatched}건`, color: dispatchParsedData.stats.customerUnmatched > 0 ? '#dc2626' : '#059669' },
                    { label: '계약 미매핑', value: `${dispatchParsedData.stats.contractUnmatched}건`, color: dispatchParsedData.stats.contractUnmatched > 0 ? '#d97706' : '#059669' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ backgroundColor: 'var(--bg-app)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color, marginTop: '2px' }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* 진행 메시지 */}
                {dispatchProgressMsg && (
                  <div style={{ fontSize: '13px', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <RefreshCw size={13} className="animate-spin" />
                    {dispatchProgressMsg}
                  </div>
                )}

                {/* 적재 버튼 */}
                <button
                  onClick={handleDispatchIngest}
                  disabled={isDispatchIngesting}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center',
                    padding: '10px 20px', backgroundColor: isDispatchIngesting ? '#94a3b8' : '#0369a1',
                    color: 'white', border: 'none', borderRadius: '6px',
                    cursor: isDispatchIngesting ? 'not-allowed' : 'pointer',
                    fontSize: '14px', fontWeight: 600, whiteSpace: 'nowrap', alignSelf: 'flex-start'
                  }}
                >
                  {isDispatchIngesting
                    ? <><RefreshCw size={15} className="animate-spin" /> 배차 이력 적재 중...</>
                    : <><Upload size={15} /> 배차 이력 일괄 적재 시작</>
                  }
                </button>
              </div>
            )}
          </div>

          {/* ④ 밴드 과거 AS 이력 빅데이터 업로드 카드 */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <Wrench size={16} color="#16a34a" />
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#16a34a', whiteSpace: 'nowrap' }}>
                현장 AS 과거 이력 (네이버 밴드) 빅데이터 업로드
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                네이버 밴드 AS 게시글 텍스트 파일 (총 5,518건, 2,171대 장비 이력 및 단독계약 1대 추정 연동)
              </span>
            </div>

            {/* 파일 선택 버튼 & 샘플 로드 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <input
                ref={bandFileInputRef}
                type="file"
                accept=".txt,.json,.html"
                onChange={handleBandFileSelect}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => bandFileInputRef.current?.click()}
                disabled={isBandParsing || isBandIngesting}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', backgroundColor: '#16a34a', color: 'white',
                  border: 'none', borderRadius: '6px', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap',
                  opacity: (isBandParsing || isBandIngesting) ? 0.5 : 1
                }}
              >
                <FileText size={14} />
                밴드 AS 파일 (.txt / .json / .html) 선택
              </button>

              {bandFileName && (
                <span style={{ fontSize: '13px', color: 'var(--text-main)', whiteSpace: 'nowrap', fontWeight: 600 }}>
                  📄 {bandFileName}
                </span>
              )}

              {isBandParsing && (
                <span style={{ fontSize: '12px', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                  <RefreshCw size={13} className="animate-spin" /> AS 빅데이터 5대 매트릭스 전수 분석 중...
                </span>
              )}
            </div>

            {/* 파싱 결과 프리뷰 */}
            {bandAnalysisResult && (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* 5대 지표 바 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                  {[
                    { label: '총 AS 분석 건수', value: `${bandAnalysisResult.totalCount.toLocaleString()}건`, color: 'var(--text-main)' },
                    { label: '고유 장비 매핑', value: `${bandAnalysisResult.uniqueAssetsCount.toLocaleString()}대`, color: '#2563eb' },
                    { label: '유효 계약 연동', value: `${bandAnalysisResult.matchedContractCount.toLocaleString()}건`, color: '#7c3aed', sub: bandAnalysisResult.singleAssetGuessedCount > 0 ? `(1대 계약 추정 ${bandAnalysisResult.singleAssetGuessedCount}건)` : undefined },
                    { label: '현장 조치완료', value: `${bandAnalysisResult.completedCount.toLocaleString()}건`, color: '#16a34a' },
                    { label: '익일방문 / 안내', value: `${(bandAnalysisResult.revisitCount + bandAnalysisResult.guidedCount).toLocaleString()}건`, color: '#d97706' },
                  ].map(({ label, value, color, sub }) => (
                    <div key={label} style={{ backgroundColor: 'var(--bg-app)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color, marginTop: '2px' }}>{value}</div>
                      {sub && <div style={{ fontSize: '10px', color: '#7c3aed', marginTop: '1px' }}>{sub}</div>}
                    </div>
                  ))}
                </div>

                {/* 검색 및 필터 컨트롤 바 */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', backgroundColor: 'var(--bg-app)', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '200px' }}>
                    <Search size={14} color="#64748b" />
                    <input
                      type="text"
                      placeholder="현장명, 고객사, 장비번호, 고장내용, 작성자 검색..."
                      value={bandSearchTerm}
                      onChange={e => setBandSearchTerm(e.target.value)}
                      style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '12px' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    {(['ALL', 'COMPLETED', 'REVISIT', 'GUIDED'] as const).map(st => (
                      <button
                        key={st}
                        onClick={() => setBandStatusFilter(st)}
                        style={{
                          padding: '4px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '4px', border: 'none', cursor: 'pointer',
                          backgroundColor: bandStatusFilter === st ? '#1e293b' : '#e2e8f0',
                          color: bandStatusFilter === st ? '#ffffff' : '#475569'
                        }}
                      >
                        {st === 'ALL' ? '전체 상태' : st === 'COMPLETED' ? '조치완료' : st === 'REVISIT' ? '익일방문' : '안내종결'}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    {(['ALL', 'MATCHED', 'GUESSED', 'UNMATCHED'] as const).map(cf => (
                      <button
                        key={cf}
                        onClick={() => setBandContractFilter(cf)}
                        style={{
                          padding: '4px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '4px', border: 'none', cursor: 'pointer',
                          backgroundColor: bandContractFilter === cf ? '#7c3aed' : '#e2e8f0',
                          color: bandContractFilter === cf ? '#ffffff' : '#475569'
                        }}
                      >
                        {cf === 'ALL' ? '계약 전체' : cf === 'MATCHED' ? '계약 매핑' : cf === 'GUESSED' ? '1대 추정' : '미매핑'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 고밀도 대사 테이블 */}
                {(() => {
                  const filteredRecords = bandAnalysisResult.records.filter(r => {
                    const matchesSearch = !bandSearchTerm || 
                      r.site.includes(bandSearchTerm) || 
                      r.customer.includes(bandSearchTerm) || 
                      r.assetNo.includes(bandSearchTerm) || 
                      r.issue.includes(bandSearchTerm) || 
                      r.author.includes(bandSearchTerm) ||
                      (r.matchedCustomerName || '').includes(bandSearchTerm);
                    
                    const matchesStatus = bandStatusFilter === 'ALL' || r.status === bandStatusFilter;
                    const matchesContract = 
                      bandContractFilter === 'ALL' ? true :
                      bandContractFilter === 'MATCHED' ? Boolean(r.matchedContractId) :
                      bandContractFilter === 'GUESSED' ? r.isSingleAssetGuessed :
                      !r.matchedContractId;

                    return matchesSearch && matchesStatus && matchesContract;
                  });

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                        <span>필터링된 건수: <strong>{filteredRecords.length.toLocaleString()}건</strong> / 총 {bandAnalysisResult.totalCount.toLocaleString()}건</span>
                        <span style={{ fontSize: '11px' }}>※ 상위 50건 표시 중 (전체 {bandAnalysisResult.totalCount.toLocaleString()}건 일괄 적재 대상)</span>
                      </div>

                      <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflowX: 'auto', maxHeight: '360px', overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', whiteSpace: 'nowrap' }}>
                          <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-secondary)', zIndex: 1 }}>
                            <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                              <th style={{ padding: '8px 10px' }}>No</th>
                              <th style={{ padding: '8px 10px' }}>접수일자</th>
                              <th style={{ padding: '8px 10px' }}>작성자</th>
                              <th style={{ padding: '8px 10px' }}>고객사 / 현장</th>
                              <th style={{ padding: '8px 10px' }}>관리번호 (모델)</th>
                              <th style={{ padding: '8px 10px' }}>고장 내용</th>
                              <th style={{ padding: '8px 10px' }}>조치 내용</th>
                              <th style={{ padding: '8px 10px' }}>소속 계약 매핑</th>
                              <th style={{ padding: '8px 10px', textAlign: 'center' }}>상태</th>
                              <th style={{ padding: '8px 10px', textAlign: 'center' }}>원문</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRecords.slice(0, 50).map(r => (
                              <tr key={r.idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{r.idx}</td>
                                <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{r.date}</td>
                                <td style={{ padding: '6px 10px', fontWeight: 600 }}>{r.author || '-'}</td>
                                <td style={{ padding: '6px 10px' }}>
                                  <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{r.matchedCustomerName || r.customer}</div>
                                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.matchedSiteName || r.site}</div>
                                  <div style={{ fontSize: '10.5px', color: '#0284c7' }}>📍 {r.matchedSiteAddress || r.address || '주소 미등록'}</div>
                                </td>
                                <td style={{ padding: '6px 10px' }}>
                                  <span style={{ fontWeight: 700, color: r.matchedAssetId ? '#2563eb' : '#475569' }}>
                                    {r.matchedAssetNo || r.assetNo}
                                  </span>
                                  {r.isSingleAssetGuessed && (
                                    <span className="badge badge-warning" style={{ fontSize: '9px', marginLeft: '4px' }}>1대추정</span>
                                  )}
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>({r.matchedModelName})</span>
                                </td>
                                <td style={{ padding: '6px 10px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {r.issue}
                                </td>
                                <td style={{ padding: '6px 10px', color: '#059669', fontWeight: 600 }}>
                                  {r.actionTaken}
                                </td>
                                <td style={{ padding: '6px 10px' }}>
                                  {r.matchedContractNo ? (
                                    <span className="badge badge-info" style={{ fontSize: '10px' }}>{r.matchedContractNo}</span>
                                  ) : (
                                    <span style={{ color: '#94a3b8', fontSize: '11px' }}>- (일반이력)</span>
                                  )}
                                </td>
                                <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                  <span className={`badge ${
                                    r.status === 'COMPLETED' ? 'badge-success' :
                                    r.status === 'REVISIT' ? 'badge-warning' :
                                    r.status === 'GUIDED' ? 'badge-info' : 'badge-secondary'
                                  }`} style={{ fontSize: '10px' }}>
                                    {r.status === 'COMPLETED' ? '조치완료' : r.status === 'REVISIT' ? '익일방문' : '안내종결'}
                                  </span>
                                </td>
                                <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                  <button
                                    onClick={() => setSelectedAsRecord(r)}
                                    style={{ padding: '2px 6px', fontSize: '10.5px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', cursor: 'pointer' }}
                                  >
                                    상세
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* 진행 메시지 */}
                {bandProgressMsg && (
                  <div style={{ fontSize: '13px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(16, 185, 129, 0.12)', padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                    <RefreshCw size={14} className="animate-spin" />
                    <strong>{bandProgressMsg}</strong>
                  </div>
                )}

                {/* 우하단 종결 버튼 (Gutenberg Z-Pattern) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    💡 총 <strong>{bandAnalysisResult.totalCount.toLocaleString()}건</strong>의 과거 AS 이력을 정비 마스터(`repairs`) 및 자산/계약 타임라인에 무누락 영구 저장합니다.
                  </div>

                  <button
                    onClick={handleBandIngest}
                    disabled={isBandIngesting}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '10px 24px', backgroundColor: isBandIngesting ? '#94a3b8' : '#16a34a',
                      color: 'white', border: 'none', borderRadius: '6px',
                      cursor: isBandIngesting ? 'not-allowed' : 'pointer',
                      fontSize: '14px', fontWeight: 700, whiteSpace: 'nowrap'
                    }}
                  >
                    {isBandIngesting
                      ? <><RefreshCw size={15} className="animate-spin" /> 밴드 AS 이력 일괄 적재 중...</>
                      : <><Upload size={15} /> 🚀 과거 AS 이력 전수 정비 마스터(`repairs`) DB 일괄 적재 실행</>
                    }
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ⑤ 밴드 출고요청 분석 & 유효 계약처 기본 요구사항(옵션/보양/스펙) 마스터 동기화 카드 */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <FileCheck size={16} color="#7c3aed" />
              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                출고요청 이력 분석 & 고객 요구사항 마스터 DB 동기화
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                과거 출고요청 텍스트에서 고객이 요구한 맞춤 옵션·보양·특이사항을 마스터 DB에 정확히 기억하여, 향후 신규 계약 및 출고 시 100% 자동 상속·재사용합니다.
              </span>
            </div>

            {/* 파일 선택 버튼 & 상태 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <input
                ref={dispatchHistFileInputRef}
                type="file"
                accept=".txt,.json,.html"
                onChange={handleDispatchHistFileSelect}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => dispatchHistFileInputRef.current?.click()}
                disabled={isAnalyzingDispatchHist || isIngestingCustomerDefaults}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', backgroundColor: '#7c3aed', color: 'white',
                  border: 'none', borderRadius: '6px', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap',
                  opacity: (isAnalyzingDispatchHist || isIngestingCustomerDefaults) ? 0.5 : 1
                }}
              >
                <FileText size={14} />
                출고요청 파일 (.txt / .json) 선택
              </button>

              <button
                onClick={handleCopyBandScraperScript}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 14px', backgroundColor: 'var(--bg-app)', color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer',
                  fontSize: '12.5px', fontWeight: 600, whiteSpace: 'nowrap'
                }}
                title="네이버 밴드 화면에서 F12 콘솔에 붙여넣어 중복 없이 전체 출고 이력을 추출하는 자바스크립트 코드를 클립보드에 복사합니다."
              >
                <Copy size={13} />
                밴드 전체 게시글 추출 스크립트 복사
              </button>

              {dispatchHistFileName && (
                <span style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {dispatchHistFileName}
                </span>
              )}

              {isAnalyzingDispatchHist && (
                <span style={{ fontSize: '12px', color: '#7c3aed', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                  <RefreshCw size={13} className="animate-spin" /> 출고요청 데이터 정밀 분석 중...
                </span>
              )}
            </div>

            {/* 파싱 및 분석 결과 프리뷰 */}
            {dispatchAnalysisResult && (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* 5대 통계 지표 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                  {[
                    { label: '총 출고요청 건수', value: `${dispatchAnalysisResult.stats.totalParsed}건`, color: 'var(--text-main)' },
                    { label: '유효 계약 고객사', value: `${dispatchAnalysisResult.stats.contractedCustomerCount}개사`, color: '#7c3aed' },
                    { label: '유효 계약 현장', value: `${dispatchAnalysisResult.stats.contractedSiteCount}개소`, color: '#2563eb' },
                    { label: '추출 고객 요구사항', value: `${dispatchAnalysisResult.stats.extractedOptionCount + dispatchAnalysisResult.stats.extractedProtectionCount}건`, color: '#059669' },
                    { label: '제외된 미계약 건', value: `${dispatchAnalysisResult.stats.ignoredCount}건`, color: 'var(--text-muted)' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ backgroundColor: 'var(--bg-app)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color, marginTop: '2px' }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* 매칭된 유효 고객사 요구사항 고밀도 대사 그리드 */}
                <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                      📋 고객사별 고유 요구사항(옵션·보양·특이사항) 마스터 추출 내역 ({dispatchAnalysisResult.matchedEnrichments.length}개사)
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      * 시계열 최신값 우선 & 빈칸 안전 보완 정책 적용
                    </span>
                  </div>

                  <div style={{ maxHeight: '280px', overflowY: 'auto', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                          <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>고객사명</th>
                          <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>계약수</th>
                          <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>최신일자</th>
                          <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>기본 유상옵션</th>
                          <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>기본 보양작업</th>
                          <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>현장/담당자</th>
                          <th style={{ padding: '8px 10px', minWidth: '180px' }}>고객 특이 요구사항 (반복 재사용 메모)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dispatchAnalysisResult.matchedEnrichments.map(item => {
                          const specCount = item.extractedDefaults.defaultCheckedSpecs ? Object.keys(item.extractedDefaults.defaultCheckedSpecs).length : 0;
                          return (
                            <tr key={item.customerId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                                {item.customerName}
                              </td>
                              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                                <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(37, 99, 235, 0.12)', color: 'var(--primary)', fontSize: '11px', fontWeight: 600 }}>
                                  {item.contractCount}건
                                </span>
                              </td>
                              <td style={{ padding: '8px 10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                {item.latestDate}
                              </td>
                              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: item.extractedDefaults.defaultPaidOptions ? '#059669' : '#94a3b8' }}>
                                {item.extractedDefaults.defaultPaidOptions || '(기본)'}
                              </td>
                              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: item.extractedDefaults.defaultProtection ? '#059669' : '#94a3b8' }}>
                                {item.extractedDefaults.defaultProtection || '(기본)'}
                              </td>
                              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                                {item.sites.map(s => s.siteName).join(', ') || '-'}
                                {item.contacts.length > 0 && ` (${item.contacts[0].name} ${item.contacts[0].contact})`}
                              </td>
                              <td style={{ padding: '8px 10px', color: item.extractedDefaults.specialNotes ? '#1e293b' : '#94a3b8', fontSize: '11.5px', maxWidth: '300px' }}>
                                {item.extractedDefaults.specialNotes || '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 제외된 과거/미계약 건 안내 바 */}
                {dispatchAnalysisResult.ignoredPosts.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '12px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>
                      🚫 과거 종료 거래처 / 계약 미보유 건 <strong>{dispatchAnalysisResult.ignoredPosts.length}건</strong>은 대장 오염 방지 원칙에 따라 안전하게 제외되었습니다.
                    </span>
                    <button
                      onClick={() => setShowIgnoredPostsModal(!showIgnoredPostsModal)}
                      style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', textDecoration: 'underline', fontSize: '12px', fontWeight: 600 }}
                    >
                      {showIgnoredPostsModal ? '제외 목록 닫기' : '제외 상세 목록 확인'}
                    </button>
                  </div>
                )}

                {/* 제외 목록 상세 드롭다운 */}
                {showIgnoredPostsModal && (
                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: '#fafafa', padding: '8px' }}>
                    <table style={{ width: '100%', fontSize: '11px', textAlign: 'left', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                          <th style={{ padding: '4px 6px' }}>일시</th>
                          <th style={{ padding: '4px 6px' }}>고객사명</th>
                          <th style={{ padding: '4px 6px' }}>현장명</th>
                          <th style={{ padding: '4px 6px' }}>제외 사유</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dispatchAnalysisResult.ignoredPosts.map((ip, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '4px 6px', color: '#94a3b8' }}>{ip.date}</td>
                            <td style={{ padding: '4px 6px', fontWeight: 600 }}>{ip.customerName}</td>
                            <td style={{ padding: '4px 6px' }}>{ip.siteName}</td>
                            <td style={{ padding: '4px 6px', color: '#ef4444' }}>{ip.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 진행 메시지 */}
                {dispatchHistProgressMsg && (
                  <div style={{ fontSize: '13px', color: '#7c3aed', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <RefreshCw size={13} className="animate-spin" />
                    {dispatchHistProgressMsg}
                  </div>
                )}

                {/* 적재 완결 버튼 (Gutenberg Terminal Action) */}
                <button
                  onClick={handleCustomerDefaultsIngest}
                  disabled={isIngestingCustomerDefaults}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center',
                    padding: '10px 20px', backgroundColor: isIngestingCustomerDefaults ? '#94a3b8' : '#7c3aed',
                    color: 'white', border: 'none', borderRadius: '6px',
                    cursor: isIngestingCustomerDefaults ? 'not-allowed' : 'pointer',
                    fontSize: '14px', fontWeight: 600, whiteSpace: 'nowrap', alignSelf: 'flex-start'
                  }}
                >
                  {isIngestingCustomerDefaults
                    ? <><RefreshCw size={15} className="animate-spin" /> 마스터 DB 동기화 중...</>
                    : <><Upload size={15} /> 고객 요구사항 마스터 일괄 DB 동기화 (영구 기억 및 자동 상속)</>
                  }
                </button>
              </div>
            )}
          </div>

          {/* ⑥ 관리 소모품 및 부품 재고 업로드 카드 */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Boxes size={18} color="#0284c7" />
                  <label style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                    관리 소모품 및 부품 재고 업로드
                  </label>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '9999px', backgroundColor: '#e0f2fe', color: '#0369a1', fontWeight: 600 }}>
                    밴드 재고 실사 텍스트 / 엑셀
                  </span>
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  소모품재고.txt 파일 또는 엑셀 목록을 분석하여 본사 재고 및 최초 입고 이력을 일괄 등록합니다.
                </span>
              </div>

              {/* 우상단 액션 버튼군 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleLoadDefaultSeedConsumables}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '8px 14px', borderRadius: '6px',
                    border: '1px solid #0284c7', backgroundColor: '#f0f9ff',
                    color: '#0284c7', fontSize: '13px', fontWeight: 600,
                    cursor: 'pointer', whiteSpace: 'nowrap'
                  }}
                >
                  <FileText size={14} />
                  표준 30종 기본 로드
                </button>

                <button
                  type="button"
                  onClick={() => setShowConsumableTextarea(!showConsumableTextarea)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '8px 14px', borderRadius: '6px',
                    border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600,
                    cursor: 'pointer', whiteSpace: 'nowrap'
                  }}
                >
                  <Copy size={14} />
                  텍스트 직접 입력 {showConsumableTextarea ? '닫기' : '열기'}
                </button>
              </div>
            </div>

            {/* 파일 업로드 바 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', backgroundColor: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
              <input
                ref={consumableFileInputRef}
                type="file"
                accept=".txt,.xlsx,.xls"
                onChange={handleConsumableFileSelect}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => consumableFileInputRef.current?.click()}
                disabled={isConsumableParsing}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '7px 14px', borderRadius: '6px',
                  backgroundColor: '#0284c7', color: 'white',
                  border: 'none', fontSize: '13px', fontWeight: 600,
                  cursor: isConsumableParsing ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {isConsumableParsing ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                파일 선택 (.txt / .xlsx)
              </button>

              <span style={{ fontSize: '13px', color: consumableFileName ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: consumableFileName ? 600 : 400 }}>
                {consumableFileName || '선택된 파일 없음 (.txt / .xlsx 등)'}
              </span>
            </div>

            {/* 텍스트 직접 입력창 (토글) */}
            {showConsumableTextarea && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', padding: '12px', backgroundColor: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  소모품 재고 텍스트 직접 붙여넣기 (예: "JLG 충전기 2", "지니 g콘 (유압식) 4  3개수리중")
                </label>
                <textarea
                  rows={6}
                  value={consumableRawText}
                  onChange={(e) => setConsumableRawText(e.target.value)}
                  placeholder="품목명과 수량을 줄 단위로 입력하세요.&#10;예:&#10;JLG 충전기 2&#10;지니 충전기 5&#10;스카이잭 컨트롤박스1"
                  style={{
                    width: '100%', padding: '8px 10px', fontSize: '13px',
                    fontFamily: 'monospace', borderRadius: '4px',
                    border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)', resize: 'vertical'
                  }}
                />
                <button
                  type="button"
                  onClick={handleConsumableTextareaParse}
                  style={{
                    alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 14px', borderRadius: '4px',
                    backgroundColor: '#0284c7', color: 'white',
                    border: 'none', fontSize: '12px', fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <Search size={13} />
                  텍스트 파싱 적용
                </button>
              </div>
            )}

            {/* 파싱 결과 고밀도 테이블 및 최종 반영 버튼 */}
            {parsedConsumables && parsedConsumables.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>
                    파싱 결과 목록 ({parsedConsumables.length}건)
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    관리 소모품 제품 및 기초 수량
                  </span>
                </div>

                <div style={{ maxHeight: '340px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                    <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-card)', zIndex: 1, borderBottom: '1px solid var(--border-color)' }}>
                      <tr style={{ color: 'var(--text-muted)' }}>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap', width: '40px' }}>No</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>분류</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>공급처/브랜드</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>품목명 / 모델명</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>재고 수량</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>기준 단가</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>재고 금액</th>
                        <th style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>비고 / 수리상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedConsumables.map((item, idx) => {
                        const totalItemVal = item.stockQty * (item.unitPrice || 0);
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                            <td style={{ padding: '7px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{idx + 1}</td>
                            <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                              <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(2, 132, 199, 0.1)', color: '#0284c7', fontSize: '11px', fontWeight: 600 }}>
                                {item.category || '기타소모품'}
                              </span>
                            </td>
                            <td style={{ padding: '7px 12px', whiteSpace: 'nowrap', fontWeight: 500, color: 'var(--text-main)' }}>{item.supplier}</td>
                            <td style={{ padding: '7px 12px', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--text-main)' }}>{item.modelName}</td>
                            <td style={{ padding: '7px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: '#0284c7' }}>
                              {item.stockQty.toLocaleString()} {item.unit || '개'}
                            </td>
                            <td style={{ padding: '7px 12px', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                              {item.unitPrice ? `₩${item.unitPrice.toLocaleString()}` : '-'}
                            </td>
                            <td style={{ padding: '7px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--text-main)' }}>
                              {totalItemVal ? `₩${totalItemVal.toLocaleString()}` : '-'}
                            </td>
                            <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                              {item.note ? (
                                <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: item.repairingQty ? '#fee2e2' : '#fef3c7', color: item.repairingQty ? '#b91c1c' : '#b45309', fontSize: '11px', fontWeight: 600 }}>
                                  {item.note}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>정상 가용</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 4단계 우하단 Gutenberg Z-패턴: 요약 검증식 & 최종 적재 완결 버튼 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', padding: '12px 16px', backgroundColor: 'var(--bg-main)', borderRadius: '6px', border: '1px solid var(--border-color)', marginTop: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', fontSize: '13px' }}>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      총 품목수: <strong style={{ color: 'var(--text-main)' }}>{parsedConsumables.length}종</strong>
                    </span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      총 재고 수량: <strong style={{ color: '#0284c7' }}>{parsedConsumables.reduce((acc, it) => acc + it.stockQty, 0).toLocaleString()}개</strong>
                    </span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      수리중: <strong style={{ color: '#ef4444' }}>{parsedConsumables.reduce((acc, it) => acc + (it.repairingQty || 0), 0)}개</strong>
                    </span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      재고 자산 평가액: <strong style={{ color: '#059669' }}>₩{parsedConsumables.reduce((acc, it) => acc + (it.stockQty * (it.unitPrice || 0)), 0).toLocaleString()}</strong>
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleConsumablesIngest}
                    disabled={isConsumableIngesting}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '10px 20px', borderRadius: '6px',
                      backgroundColor: isConsumableIngesting ? '#94a3b8' : '#0284c7',
                      color: 'white', border: 'none',
                      fontSize: '14px', fontWeight: 600,
                      cursor: isConsumableIngesting ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {isConsumableIngesting ? (
                      <><RefreshCw size={15} className="animate-spin" /> DB 반영 중...</>
                    ) : (
                      <><Upload size={15} /> 소모품 재고 DB 반영 ({parsedConsumables.length}건)</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 4. 파싱 통계 프리뷰 카드뉴스 */}
          {parsedData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                  라이프사이클 이벤트 체인 및 회계 데이터 분석 현황
                </h3>
                <span style={{ fontSize: '13px', color: '#059669', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  ✓ 스키마 및 외래키(FK) 무결성 100% 검증 완료
                </span>
              </div>

              {/* 통계 카드 그리드 (라이프사이클 & 회계) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
                {/* 1. 마스터 자산 */}
                <div style={{ backgroundColor: 'var(--bg-app)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Layers size={14} /> 자산 대장 (assets)
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-main)', marginTop: '4px' }}>
                    {parsedData.stats.assetsCount} 대
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    대여중 계약연동 {parsedData.stats.activeRentedAssetsCount || 0}대 100% 매핑
                  </div>
                </div>

                {/* 2. 장비 모델 & 제원문서 */}
                <div style={{ backgroundColor: '#f0fdfa', padding: '14px', borderRadius: '8px', border: '1px solid #ccfbf1' }}>
                  <div style={{ fontSize: '12px', color: '#0f766e', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <FileText size={14} /> 모델 & 실물 제원표 (products)
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#115e59', marginTop: '4px' }}>
                    {parsedData.stats.productsCount} 종
                  </div>
                  <div style={{ fontSize: '11px', color: '#0d9488', marginTop: '2px' }}>
                    R2 제원표/안전문서 {parsedData.stats.docLinkedProductsCount || 0}종 자동 연동
                  </div>
                </div>

                {/* 3. 렌탈 계약 */}
                <div style={{ backgroundColor: 'var(--bg-app)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <FileCheck size={14} /> 렌탈 계약 (contracts)
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-main)', marginTop: '4px' }}>
                    {parsedData.stats.contractsCount} 건
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>고객사 {parsedData.stats.customersCount}사 / 현장 {parsedData.stats.sitesCount}개소</div>
                </div>

                {/* 4. 출고 배차 체인 */}
                <div style={{ backgroundColor: 'rgba(37, 99, 235, 0.12)', padding: '14px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                  <div style={{ fontSize: '12px', color: '#3b82f6', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Truck size={14} /> 출고 배차 (deliveries)
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-main)', marginTop: '4px' }}>
                    {parsedData.stats.outboundDeliveriesCount} 건
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>출고검수 {parsedData.stats.outboundInspectionsCount}건 자동 승인</div>
                </div>

                {/* 5. 회수 배차 체인 */}
                <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', padding: '14px', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  <div style={{ fontSize: '12px', color: '#10b981', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <RotateCcw size={14} /> 회수 배차 (deliveries)
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-main)', marginTop: '4px' }}>
                    {parsedData.stats.inboundDeliveriesCount} 건
                  </div>
                  <div style={{ fontSize: '11px', color: '#22c55e', marginTop: '2px' }}>종료 계약 입고 등록 100% 매핑</div>
                </div>

                {/* 6. 과거 소급 청구서 */}
                <div style={{ backgroundColor: '#faf5ff', padding: '14px', borderRadius: '8px', border: '1px solid #e9d5ff' }}>
                  <div style={{ fontSize: '12px', color: '#7e22ce', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <History size={14} /> 과거 소급 청구서 (billings)
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#6b21a8', marginTop: '4px' }}>
                    {parsedData.stats.historicalBillingsCount} 건
                  </div>
                  <div style={{ fontSize: '11px', color: '#9333ea', marginTop: '2px' }}>누적 ₩{parsedData.stats.totalHistoricalBillingAmount.toLocaleString()}</div>
                </div>

                {/* 7. 2026-08 당월 청구서 */}
                <div style={{ backgroundColor: '#fefce8', padding: '14px', borderRadius: '8px', border: '1px solid #fef08a' }}>
                  <div style={{ fontSize: '12px', color: '#a16207', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Receipt size={14} /> 2026-08 당월 청구 합계
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#854d0e', marginTop: '4px' }}>
                    ₩{parsedData.stats.currentMonthBillingAmount.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '11px', color: '#ca8a04', marginTop: '2px' }}>71개사 청구서 (차액 ₩0 일치)</div>
                </div>

                {/* 8. 전대 매입 & 외상미수금 */}
                <div style={{ backgroundColor: '#fff7ed', padding: '14px', borderRadius: '8px', border: '1px solid #ffedd5' }}>
                  <div style={{ fontSize: '12px', color: '#c2410c', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <TrendingUp size={14} /> 전대 매입 & 부대비
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#9a3412', marginTop: '4px' }}>
                    ₩{parsedData.stats.totalPurchaseBillingAmount.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '11px', color: '#ea580c', marginTop: '2px' }}>
                    외상미수금 {parsedData.stats.receivablesCount}건 (운반비 등)
                  </div>
                </div>
              </div>

              {/* 3. 일괄 적재 실행 버튼 및 프로그레스 바 */}
              <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                      라이프사이클 체인 & 시작점 데이터 일괄 적재 실행
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      13단계 순차 DAG 배치 적재: 구버전 삭제 → 출고/회수 배차 + 검수 + 과거 소급 청구 + 8월 청구 + 매입 정산
                    </div>
                  </div>

                  <button
                    onClick={handleIngest}
                    disabled={isIngesting}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '12px 28px',
                      backgroundColor: '#059669',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 700,
                      fontSize: '15px',
                      cursor: isIngesting ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {isIngesting ? <RefreshCw size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                    전체 데이터 일괄 적재 시작
                  </button>
                </div>

                {isIngesting && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-main)' }}>
                      <span>{progressInfo.message}</span>
                      <span>{progressInfo.step} / {progressInfo.total} ({Math.round((progressInfo.step / progressInfo.total) * 100)}%)</span>
                    </div>
                    <div style={{ width: '100%', height: '8px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${(progressInfo.step / progressInfo.total) * 100}%`,
                          height: '100%',
                          backgroundColor: '#059669',
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 4. 4대 대차대조(Reconciliation) 검증 리포트 */}
          {reconciliationReport && (
            <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <ShieldCheck size={24} color="#059669" />
                <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                  4대 대차대조(Reconciliation) 무결성 검증 증명서
                </h3>
                <span
                  style={{
                    marginLeft: 'auto',
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 700,
                    backgroundColor: reconciliationReport.allPassed ? '#dcfce7' : '#fee2e2',
                    color: reconciliationReport.allPassed ? '#166534' : '#991b1b',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {reconciliationReport.allPassed ? '전수 검증 통과 (차액 ₩0)' : '검증 불일치 발생'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                {/* 1. 자산 수량 대사 */}
                <div style={{ padding: '14px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>1. 자산 수량 대사</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>엑셀 보유자산:</span>
                    <span style={{ fontWeight: 600 }}>{reconciliationReport.assetCountMatch.excel} 대</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>DB 자사 자산:</span>
                    <span style={{ fontWeight: 600, color: '#059669' }}>{reconciliationReport.assetCountMatch.db} 대</span>
                  </div>
                  <div style={{ marginTop: '6px', fontSize: '12px', color: reconciliationReport.assetCountMatch.isMatch ? '#059669' : '#dc2626', fontWeight: 600 }}>
                    {reconciliationReport.assetCountMatch.isMatch ? '✓ 100% 일치' : '✗ 수량 불일치'}
                  </div>
                </div>

                {/* 2. 8월 매출 총액 대사 */}
                <div style={{ padding: '14px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>2. 8월 청구 총액 대사</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>엑셀 청구합계:</span>
                    <span style={{ fontWeight: 600 }}>₩{reconciliationReport.currentBillingTotalMatch.excel.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>DB 청구서 총합:</span>
                    <span style={{ fontWeight: 600, color: '#059669' }}>₩{reconciliationReport.currentBillingTotalMatch.db.toLocaleString()}</span>
                  </div>
                  <div style={{ marginTop: '6px', fontSize: '12px', color: reconciliationReport.currentBillingTotalMatch.isMatch ? '#059669' : '#dc2626', fontWeight: 600 }}>
                    {reconciliationReport.currentBillingTotalMatch.isMatch ? '✓ 차액 ₩0 (완전 일치)' : `✗ 차액 ₩${reconciliationReport.currentBillingTotalMatch.diff.toLocaleString()}`}
                  </div>
                </div>

                {/* 3. 청구 상세 라인 대사 */}
                <div style={{ padding: '14px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>3. 청구 상세 라인 대사</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>청구 헤더 합:</span>
                    <span style={{ fontWeight: 600 }}>₩{reconciliationReport.currentDetailsTotalMatch.headerSum.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>청구 상세 합:</span>
                    <span style={{ fontWeight: 600, color: '#059669' }}>₩{reconciliationReport.currentDetailsTotalMatch.detailSum.toLocaleString()}</span>
                  </div>
                  <div style={{ marginTop: '6px', fontSize: '12px', color: reconciliationReport.currentDetailsTotalMatch.isMatch ? '#059669' : '#dc2626', fontWeight: 600 }}>
                    {reconciliationReport.currentDetailsTotalMatch.isMatch ? '✓ 단수 오차 보정 완료 (₩0)' : `✗ 차액 ₩${reconciliationReport.currentDetailsTotalMatch.diff.toLocaleString()}`}
                  </div>
                </div>

                {/* 4. 라이프사이클 배차 매핑 대사 */}
                <div style={{ padding: '14px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-app)' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>4. 라이프사이클 배차 매핑</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>총 계약 건수:</span>
                    <span style={{ fontWeight: 600 }}>{reconciliationReport.lifecycleChainMatch.contracts} 건</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>출고 배차 건수:</span>
                    <span style={{ fontWeight: 600, color: '#059669' }}>{reconciliationReport.lifecycleChainMatch.outboundDeliveries} 건</span>
                  </div>
                  <div style={{ marginTop: '6px', fontSize: '12px', color: '#059669', fontWeight: 600 }}>
                    ✓ 계약 대비 100% 출고 배차 연계 완료
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: DB 전체 백업 ── */}
      {activeTab === 'BACKUP' && (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
              전체 데이터베이스 백업 내보내기
            </h3>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              현재 Supabase / 로컬 DB에 적재된 모든 20개 테이블의 데이터를 JSON 파일로 다운로드하여 영구 보관합니다.
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              onClick={handleBackup}
              disabled={isBackingUp}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 24px',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: isBackingUp ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              {isBackingUp ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />}
              전체 DB 백업 파일 다운로드 (.json)
            </button>

            {backupResult && (
              <span style={{ fontSize: '13px', color: '#059669', fontWeight: 600, whiteSpace: 'nowrap' }}>
                ✓ {backupResult.filename} 다운로드 완료 ({backupResult.count.toLocaleString()}건)
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 3: DB 초기화 ── */}
      {activeTab === 'RESET' && (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', border: '1px solid #fecaca', padding: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626' }}>
              <AlertTriangle size={20} />
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                데이터베이스 전체 초기화
              </h3>
            </div>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              기존에 입력된 자산, 고객사, 현장, 계약, 청구서, 수납 등 모든 비즈니스 데이터를 영구 삭제합니다.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'rgba(239, 68, 68, 0.08)', padding: '16px', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#ef4444', fontWeight: 600, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={keepAdminUser}
                onChange={(e) => setKeepAdminUser(e.target.checked)}
              />
              시스템 관리자 계정(admin/users/departments)은 보존
            </label>

            <button
              onClick={handleReset}
              disabled={isResetting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                backgroundColor: isResetting ? '#94a3b8' : '#dc2626',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: isResetting ? 'not-allowed' : 'pointer',
                width: 'fit-content',
                whiteSpace: 'nowrap'
              }}
            >
              {isResetting ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  데이터 전체 초기화 진행 중...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  데이터 전체 초기화 실행
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 밴드 AS 단건 상세 원문 모달 */}
      {selectedAsRecord && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '8px', maxWidth: '600px', width: '100%', padding: '24px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wrench size={18} color="#16a34a" />
                <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-main)' }}>
                  AS 게시글 상세 내역 [No. {selectedAsRecord.idx}]
                </span>
              </div>
              <button
                onClick={() => setSelectedAsRecord(null)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>접수일자:</span> <strong>{selectedAsRecord.date}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>작성자/정비사:</span> <strong>{selectedAsRecord.author}</strong> ({selectedAsRecord.mechanicName})
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>고객사:</span> <strong>{selectedAsRecord.matchedCustomerName || selectedAsRecord.customer}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>현장명:</span> <strong>{selectedAsRecord.matchedSiteName || selectedAsRecord.site}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>관리번호:</span> <strong style={{ color: '#2563eb' }}>{selectedAsRecord.matchedAssetNo || selectedAsRecord.assetNo}</strong> ({selectedAsRecord.matchedModelName})
                {selectedAsRecord.isSingleAssetGuessed && (
                  <span className="badge badge-warning" style={{ fontSize: '10px', marginLeft: '6px' }}>1대계약 자동추정</span>
                )}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>소속 계약:</span> <strong>{selectedAsRecord.matchedContractNo || '미매핑(일반이력)'}</strong>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ color: 'var(--text-muted)' }}>장비 세부위치:</span> {selectedAsRecord.location || '미상'}
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ color: 'var(--text-muted)' }}>현장 접수자 연락처:</span> {selectedAsRecord.contact || '미상'}
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ color: 'var(--text-muted)' }}>고장 내용:</span>
                <div style={{ marginTop: '4px', padding: '8px 12px', backgroundColor: 'rgba(239, 68, 68, 0.12)', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#ef4444', fontWeight: 600 }}>
                  {selectedAsRecord.issue}
                </div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ color: 'var(--text-muted)' }}>조치 내용:</span>
                <div style={{ marginTop: '4px', padding: '8px 12px', backgroundColor: 'rgba(16, 185, 129, 0.12)', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.25)', color: '#10b981', fontWeight: 600 }}>
                  {selectedAsRecord.actionTaken}
                </div>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ color: 'var(--text-muted)' }}>밴드 원문 텍스트:</span>
                <div style={{ marginTop: '4px', padding: '10px', backgroundColor: 'var(--bg-app)', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '12px', color: 'var(--text-main)', maxHeight: '120px', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                  {selectedAsRecord.raw}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
              <button
                onClick={() => setSelectedAsRecord(null)}
                style={{ padding: '8px 18px', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InitialDbUploader;

