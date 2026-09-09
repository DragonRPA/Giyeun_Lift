// src/pages/inspection_checklist_manage.tsx
import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  ShieldCheck,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  Search,
  FileText,
  Download,
  Eye,
  BookOpen,
  Wrench,
  BarChart2,
  Clock,
  Layers,
  Calendar,
  Filter,
  CheckCircle2,
  UploadCloud,
  FileDown,
  Sparkles,
  Tag,
  Cpu,
  AlertTriangle,
  Video,
  Globe,
  Play,
  ExternalLink
} from 'lucide-react';
import { InspectionChecklistItem, EquipmentManual, extractYoutubeVideoId, db } from '../services/db';
import { extractManualMetadataWithAI } from '../services/manualAiEngine';
import { exportToExcel } from '../services/excel';

const Youtube: React.FC<{ size?: number; className?: string; style?: React.CSSProperties }> = ({ size = 16, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    style={style}
  >
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

type TabType = 'MASTER' | 'ANALYTICS' | 'MANUALS';

export const InspectionChecklistManage: React.FC = () => {
  const {
    inspectionChecklistItems,
    saveInspectionChecklistItem,
    deleteInspectionChecklistItem,
    equipmentManuals,
    saveEquipmentManual,
    deleteEquipmentManual,
    repairs,
    repairConsumables,
    consumables,
    products
  } = useApp();

  // ─── [탭 상태] ───
  const [activeTab, setActiveTab] = useState<TabType>('MASTER');

  // ─── [토스트 및 확인 모달 (헌장 5.2: alert/confirm 퇴출)] ───
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    isDanger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // ═════════════════════════════════════════════════════════════════
  // ─── [탭 1: 정비 항목 마스터 (MASTER)] 상태 및 로직 ───
  // ═════════════════════════════════════════════════════════════════
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('전체');
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<InspectionChecklistItem> | null>(null);

  const [formCategory, setFormCategory] = useState('외관/바디');
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formScore, setFormScore] = useState<number>(5);
  const [formManHours, setFormManHours] = useState<number>(0.5);
  const [formRecommendedConsumables, setFormRecommendedConsumables] = useState<string[]>([]);
  const [formActionGuide, setFormActionGuide] = useState('');
  const [formDescription, setFormDescription] = useState('');

  // 과거 AS 발생 누적 통계 매핑
  const repairMappingStats = useMemo(() => {
    const stats: Record<string, { count: number; lastOccurred?: string }> = {};
    (repairs || []).forEach(r => {
      const keys = [r.inspectionItemCode, r.inspectionItemId].filter(Boolean) as string[];
      keys.forEach(k => {
        if (!stats[k]) stats[k] = { count: 0 };
        const stat = stats[k]!;
        stat.count += 1;
        const rDate = r.requestDate || r.repairDate || r.completedDate;
        if (rDate) {
          if (!stat.lastOccurred || rDate > stat.lastOccurred) {
            stat.lastOccurred = rDate;
          }
        }
      });
    });
    return stats;
  }, [repairs]);

  // 소모품 Map (id -> Consumable)
  const consumableMap = useMemo(() => {
    const map = new Map<string, (typeof consumables)[0]>();
    (consumables || []).forEach(c => map.set(c.id, c));
    return map;
  }, [consumables]);

  const handleOpenAddItemModal = () => {
    setEditingItem(null);
    setFormCategory('외관/바디');
    let maxNum = 0;
    inspectionChecklistItems.forEach(item => {
      if (item.code && item.code.startsWith('CHK-')) {
        const num = parseInt(item.code.replace('CHK-', ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });
    const nextCode = `CHK-${String(maxNum + 1).padStart(7, '0')}`;
    setFormCode(nextCode);
    setFormName('');
    setFormScore(5);
    setFormManHours(0.5);
    setFormRecommendedConsumables([]);
    setFormActionGuide('');
    setFormDescription('');
    setIsItemModalOpen(true);
  };

  const handleOpenEditItemModal = (item: InspectionChecklistItem) => {
    setEditingItem(item);
    setFormCategory(item.category || '외관/바디');
    setFormCode(item.code || '');
    setFormName(item.name || '');
    setFormScore(item.score || 0);
    setFormManHours(item.standardManHours || 0.5);
    setFormRecommendedConsumables(item.recommendedConsumableIds || []);
    setFormActionGuide(item.actionGuide || '');
    setFormDescription(item.description || '');
    setIsItemModalOpen(true);
  };

  const handleItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      showToast('정비 필요 항목명을 입력해 주세요.', 'error');
      return;
    }

    try {
      await saveInspectionChecklistItem({
        id: editingItem?.id,
        category: formCategory,
        code: formCode || `CHK-${Date.now().toString().slice(-7)}`,
        name: formName.trim(),
        score: Number(formScore),
        standardManHours: Number(formManHours),
        recommendedConsumableIds: formRecommendedConsumables,
        actionGuide: formActionGuide.trim(),
        description: formDescription.trim()
      });
      await db.awaitPendingWrites();

      showToast(`[${formName}] 정비 항목 ${editingItem ? '수정' : '신규 등록'} 완료`);
      setIsItemModalOpen(false);
    } catch (err: any) {
      showToast(`저장 실패: ${err?.message || err}`, 'error');
    }
  };

  const doDeleteItem = async (item: InspectionChecklistItem) => {
    try {
      await deleteInspectionChecklistItem(item.id);
      await db.awaitPendingWrites();
      showToast(`[${item.name}] 항목이 마스터 대장에서 삭제되었습니다.`);
    } catch (err: any) {
      showToast(`삭제 실패: ${err?.message || err}`, 'error');
    }
  };

  const handleDeleteItem = (item: InspectionChecklistItem) => {
    setConfirmModal({
      isOpen: true,
      title: '정비 항목 삭제',
      message: `정비 항목 [${item.name}] (${item.code})을 마스터 대장에서 삭제하시겠습니까?\n기존 누적 데이터 연계에 영향을 줄 수 있습니다.`,
      confirmText: '삭제 실행',
      isDanger: true,
      onConfirm: () => {
        setConfirmModal(null);
        doDeleteItem(item);
      }
    });
  };

  const filteredMasterItems = useMemo(() => {
    return inspectionChecklistItems.filter(item => {
      const matchCat = selectedCategory === '전체' || item.category === selectedCategory;
      if (!matchCat) return false;
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        item.name.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term) ||
        item.code.toLowerCase().includes(term) ||
        (item.description && item.description.toLowerCase().includes(term)) ||
        (item.actionGuide && item.actionGuide.toLowerCase().includes(term))
      );
    });
  }, [inspectionChecklistItems, selectedCategory, searchTerm]);

  // 마스터 요약 통계
  const masterAuditSummary = useMemo(() => {
    const totalCount = inspectionChecklistItems.length;
    const categories = Array.from(new Set(inspectionChecklistItems.map(i => i.category || '외관/바디')));
    const totalScore = inspectionChecklistItems.reduce((sum, i) => sum + (i.score || 0), 0);
    const avgScore = totalCount > 0 ? (totalScore / totalCount).toFixed(1) : '0';
    const totalManHours = inspectionChecklistItems.reduce((sum, i) => sum + (i.standardManHours || 0.5), 0);
    const linkedPartsCount = inspectionChecklistItems.filter(i => (i.recommendedConsumableIds || []).length > 0).length;

    return {
      totalCount,
      categoryCount: categories.length,
      totalScore,
      avgScore,
      totalManHours: totalManHours.toFixed(1),
      linkedPartsCount
    };
  }, [inspectionChecklistItems]);

  // 엑셀 내보내기 (마스터 대장)
  const exportMasterToExcel = () => {
    if (filteredMasterItems.length === 0) {
      showToast('내보낼 정비 항목 데이터가 없습니다.', 'error');
      return;
    }
    const rows = filteredMasterItems.map((item, idx) => {
      const partsNames = (item.recommendedConsumableIds || [])
        .map(cid => consumableMap.get(cid)?.modelName || cid)
        .join(', ');
      const stat = repairMappingStats[item.code] || { count: 0 };
      return {
        'No': idx + 1,
        '카테고리': item.category,
        '항목코드': item.code,
        '항목명': item.name,
        '배점': item.score,
        '표준공수(M/H)': item.standardManHours || 0.5,
        '추천부품': partsNames || '-',
        '누적발생건수': stat.count,
        '조치가이드': item.actionGuide || '-',
        '상세설명': item.description || '-'
      };
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    exportToExcel(rows, `정비항목_마스터대장_${todayStr}`, '정비항목');
    showToast(`정비 항목 마스터 대장 ${rows.length}건 엑셀 내보내기 완료`);
  };

  // ═════════════════════════════════════════════════════════════════
  // ─── [탭 2: 조직역량 & 비용 분석 (ANALYTICS)] 상태 및 로직 ───
  // ═════════════════════════════════════════════════════════════════
  const getTodayStr = () => new Date().toISOString().slice(0, 10);
  const getFirstDayOfMonth = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  };
  const getLastDayOfMonth = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  };

  const [analyticsStartDate, setAnalyticsStartDate] = useState(getFirstDayOfMonth());
  const [analyticsEndDate, setAnalyticsEndDate] = useState(getLastDayOfMonth());
  const [analyticsCategoryFilter, setAnalyticsCategoryFilter] = useState('전체');

  const setPeriodPreset = (type: 'THIS_MONTH' | 'LAST_MONTH' | 'LAST_3_MONTHS' | 'ALL') => {
    const now = new Date();
    if (type === 'THIS_MONTH') {
      setAnalyticsStartDate(getFirstDayOfMonth());
      setAnalyticsEndDate(getLastDayOfMonth());
    } else if (type === 'LAST_MONTH') {
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
      setAnalyticsStartDate(prevStart);
      setAnalyticsEndDate(prevEnd);
    } else if (type === 'LAST_3_MONTHS') {
      const start = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
      setAnalyticsStartDate(start);
      setAnalyticsEndDate(getTodayStr());
    } else if (type === 'ALL') {
      setAnalyticsStartDate('2020-01-01');
      setAnalyticsEndDate(getTodayStr());
    }
  };

  // 기간 내 정비 건 필터링 및 항목별 집계
  const analyticsData = useMemo(() => {
    const filteredRepairs = (repairs || []).filter(r => {
      const date = r.completedDate || r.repairDate || r.requestDate;
      if (!date) return false;
      return date >= analyticsStartDate && date <= analyticsEndDate;
    });

    const repairConsMap = new Map<string, typeof repairConsumables>();
    (repairConsumables || []).forEach(rc => {
      const list = repairConsMap.get(rc.repairId) || [];
      list.push(rc);
      repairConsMap.set(rc.repairId, list);
    });

    const itemCodeMap = new Map<string, InspectionChecklistItem>();
    inspectionChecklistItems.forEach(item => itemCodeMap.set(item.code, item));

    interface ItemAggregate {
      itemCode: string;
      itemName: string;
      category: string;
      standardManHours: number;
      count: number;
      totalManHours: number;
      partCost: number;
      externalCost: number;
      totalCost: number;
      billableAmount: number;
      companyCost: number;
      actionGuide?: string;
    }

    const itemAggMap = new Map<string, ItemAggregate>();

    let totalRepairCount = 0;
    let grandTotalManHours = 0;
    let grandTotalStandardManHours = 0;
    let grandPartCost = 0;
    let grandExternalCost = 0;
    let grandTotalCost = 0;
    let grandBillableAmount = 0;
    let grandCompanyCost = 0;

    filteredRepairs.forEach(r => {
      totalRepairCount += 1;
      const code = r.inspectionItemCode || 'UNCLASSIFIED';
      const masterItem = itemCodeMap.get(code);

      const category = masterItem?.category || r.issueCategory || '기타/검수';
      const itemName = masterItem?.name || r.details || '미분류 정비';
      const stdMH = masterItem?.standardManHours || 0.5;
      const actualMH = r.spentManHours ?? (r.durationMinutes ? r.durationMinutes / 60 : stdMH);

      // 부품비 계산
      let repairPartCost = 0;
      const rCons = repairConsMap.get(r.id) || [];
      if (rCons.length > 0) {
        rCons.forEach(rc => {
          const uPrice = rc.unitPrice || consumableMap.get(rc.consumableId)?.unitPrice || 0;
          repairPartCost += uPrice * rc.quantity;
        });
      } else if (r.partsUsed && r.partsUsed.length > 0) {
        r.partsUsed.forEach(pu => {
          repairPartCost += (pu.unitPrice || 0) * (pu.quantity || 1);
        });
      }

      // 외주비 계산
      let repairExternalCost = 0;
      const isExternal =
        r.workCategory === 'EXTERNAL_VENDOR' ||
        r.repairType === 'EXTERNAL' ||
        r.resolutionType === 'EXTERNAL_OUTSOURCE';
      if (isExternal) {
        repairExternalCost = r.totalCost || 0;
      }

      const repairTotalCost = repairPartCost + repairExternalCost || (r.totalCost || 0);
      const billable = r.billableType === 'BILLABLE' ? (r.billableAmount || 0) : 0;
      const compCost = Math.max(0, repairTotalCost - billable);

      const existing = itemAggMap.get(code) || {
        itemCode: code,
        itemName,
        category,
        standardManHours: stdMH,
        count: 0,
        totalManHours: 0,
        partCost: 0,
        externalCost: 0,
        totalCost: 0,
        billableAmount: 0,
        companyCost: 0,
        actionGuide: masterItem?.actionGuide
      };

      existing.count += 1;
      existing.totalManHours += actualMH;
      existing.partCost += repairPartCost;
      existing.externalCost += repairExternalCost;
      existing.totalCost += repairTotalCost;
      existing.billableAmount += billable;
      existing.companyCost += compCost;
      itemAggMap.set(code, existing);

      grandTotalManHours += actualMH;
      grandTotalStandardManHours += stdMH;
      grandPartCost += repairPartCost;
      grandExternalCost += repairExternalCost;
      grandTotalCost += repairTotalCost;
      grandBillableAmount += billable;
      grandCompanyCost += compCost;
    });

    const items = Array.from(itemAggMap.values())
      .filter(item => {
        if (analyticsCategoryFilter === '전체') return true;
        return item.category === analyticsCategoryFilter;
      })
      .sort((a, b) => b.totalCost - a.totalCost || b.count - a.count);

    return {
      items,
      totalRepairCount,
      grandTotalManHours: grandTotalManHours.toFixed(1),
      grandTotalStandardManHours: grandTotalStandardManHours.toFixed(1),
      grandPartCost,
      grandExternalCost,
      grandTotalCost,
      grandBillableAmount,
      grandCompanyCost,
      balanceDiff: grandTotalCost - (grandBillableAmount + grandCompanyCost)
    };
  }, [
    repairs,
    repairConsumables,
    inspectionChecklistItems,
    consumableMap,
    analyticsStartDate,
    analyticsEndDate,
    analyticsCategoryFilter
  ]);

  // 분석 데이터 엑셀 내보내기
  const exportAnalyticsToExcel = () => {
    if (!analyticsData.items || analyticsData.items.length === 0) {
      showToast('내보낼 분석 데이터가 없습니다.', 'error');
      return;
    }
    const rows = analyticsData.items.map(item => {
      const share = analyticsData.grandTotalCost > 0
        ? ((item.totalCost / analyticsData.grandTotalCost) * 100).toFixed(1)
        : '0.0';
      return {
        '항목코드': item.itemCode,
        '정비항목명': item.itemName,
        '카테고리': item.category,
        '발생건수': item.count,
        '표준공수(M/H)': item.standardManHours,
        '누적공수(M/H)': Number(item.totalManHours.toFixed(1)),
        '자체부품비(원)': item.partCost,
        '외주정비비(원)': item.externalCost,
        '총소요비용(원)': item.totalCost,
        '고객청구액(원)': item.billableAmount,
        '회사순부담(원)': item.companyCost,
        '비용비중': `${share}%`
      };
    });

    exportToExcel(rows, `정비조직역량_비용분석_${analyticsStartDate}_${analyticsEndDate}`, '비용분석');
    showToast(`정비 역량 및 비용 분석 대장 ${rows.length}건 엑셀 내보내기 완료`);
  };

  // ═════════════════════════════════════════════════════════════════
  // ─── [탭 3: 장비 매뉴얼 라이브러리 (MANUALS)] 상태 및 로직 ───
  // ═════════════════════════════════════════════════════════════════
  const [manualSearchTerm, setManualSearchTerm] = useState('');
  const [selectedManualModel, setSelectedManualModel] = useState<string>('전체');
  const [selectedManualCategory, setSelectedManualCategory] = useState<string>('전체');
  const [selectedManualMediaType, setSelectedManualMediaType] = useState<'전체' | 'PDF' | 'YOUTUBE' | 'WEB_LINK'>('전체');
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [previewManual, setPreviewManual] = useState<EquipmentManual | null>(null);

  // AI 메타데이터 처리 및 편집 상태
  const [isIndexingAI, setIsIndexingAI] = useState(false);
  const [indexingProgress, setIndexingProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const [editingMetadataManual, setEditingMetadataManual] = useState<EquipmentManual | null>(null);
  const [editKeywordsInput, setEditKeywordsInput] = useState('');
  const [editErrorCodesInput, setEditErrorCodesInput] = useState('');
  const [editMajorPartsInput, setEditMajorPartsInput] = useState('');
  const [editSymptomsInput, setEditSymptomsInput] = useState('');
  const [editAiSummaryInput, setEditAiSummaryInput] = useState('');

  // 매뉴얼 등록 폼 상태 (멀티미디어 확장: PDF / 유튜브 / 웹문서)
  const [manualFormMediaType, setManualFormMediaType] = useState<'PDF' | 'YOUTUBE' | 'WEB_LINK'>('PDF');
  const [manualFormExternalUrl, setManualFormExternalUrl] = useState('');
  const [manualFormDurationMinutes, setManualFormDurationMinutes] = useState<number | ''>('');
  const [manualFormModel, setManualFormModel] = useState('SJ-3219');
  const [manualFormManufacturer, setManualFormManufacturer] = useState('Skyjack');
  const [manualFormCategory, setManualFormCategory] = useState<EquipmentManual['category']>('PARTS_BOOK');
  const [manualFormTitle, setManualFormTitle] = useState('');
  const [manualFormVersion, setManualFormVersion] = useState('Rev. 2024-A');
  const [manualFormTargetSpecFt, setManualFormTargetSpecFt] = useState<number>(19);
  const [manualFormMemo, setManualFormMemo] = useState('');
  const [manualFormFileName, setManualFormFileName] = useState('');
  const [manualFormFileSize, setManualFormFileSize] = useState<number>(0);
  const [manualFormFileSizeLabel, setManualFormFileSizeLabel] = useState('0 KB');
  const [manualFormFileUrl, setManualFormFileUrl] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 모델 고유 목록 추출
  const modelOptions = useMemo(() => {
    const models = new Set<string>();
    (equipmentManuals || []).forEach(m => {
      if (m.modelName) models.add(m.modelName);
    });
    (products || []).forEach(p => {
      if (p.modelName) models.add(p.modelName);
    });
    return Array.from(models).sort();
  }, [equipmentManuals, products]);

  // 매뉴얼 다차원 AI 메타데이터 필터링
  const filteredManuals = useMemo(() => {
    return (equipmentManuals || []).filter(m => {
      const matchModel = selectedManualModel === '전체' || m.modelName === selectedManualModel;
      const matchCat = selectedManualCategory === '전체' || m.category === selectedManualCategory;
      const matchMedia =
        selectedManualMediaType === '전체' ||
        (selectedManualMediaType === 'PDF' && (!m.mediaType || m.mediaType === 'PDF')) ||
        m.mediaType === selectedManualMediaType;

      if (!matchModel || !matchCat || !matchMedia) return false;
      if (!manualSearchTerm.trim()) return true;
      const term = manualSearchTerm.toLowerCase();

      const matchBasic =
        m.title.toLowerCase().includes(term) ||
        m.modelName.toLowerCase().includes(term) ||
        m.manufacturer.toLowerCase().includes(term) ||
        (m.memo && m.memo.toLowerCase().includes(term)) ||
        (m.version && m.version.toLowerCase().includes(term));
      if (matchBasic) return true;

      const matchKeywords = (m.keywords || []).some(kw => kw.toLowerCase().includes(term));
      const matchErrors = (m.errorCodes || []).some(ec => ec.toLowerCase().includes(term) || term.includes(ec.toLowerCase()));
      const matchParts = (m.majorParts || []).some(p => p.toLowerCase().includes(term));
      const matchSymptoms = (m.symptoms || []).some(s => s.toLowerCase().includes(term));
      const matchSummary = m.aiSummary ? m.aiSummary.toLowerCase().includes(term) : false;

      return matchKeywords || matchErrors || matchParts || matchSymptoms || matchSummary;
    });
  }, [equipmentManuals, selectedManualModel, selectedManualCategory, selectedManualMediaType, manualSearchTerm]);

  // 매뉴얼 통계
  const manualSummary = useMemo(() => {
    const total = (equipmentManuals || []).length;
    const partsBookCount = (equipmentManuals || []).filter(m => m.category === 'PARTS_BOOK').length;
    const errorCodeCount = (equipmentManuals || []).filter(m => m.category === 'ERROR_CODE').length;
    const wiringCount = (equipmentManuals || []).filter(m => m.category === 'WIRING_DIAGRAM').length;
    const operatorCount = (equipmentManuals || []).filter(m => m.category === 'OPERATOR_MANUAL').length;
    const pdfCount = (equipmentManuals || []).filter(m => !m.mediaType || m.mediaType === 'PDF').length;
    const youtubeCount = (equipmentManuals || []).filter(m => m.mediaType === 'YOUTUBE').length;
    const webLinkCount = (equipmentManuals || []).filter(m => m.mediaType === 'WEB_LINK').length;
    const aiIndexedCount = (equipmentManuals || []).filter(m => m.aiProcessed).length;
    const aiPendingCount = (equipmentManuals || []).filter(m => !m.aiProcessed).length;

    return { total, partsBookCount, errorCodeCount, wiringCount, operatorCount, pdfCount, youtubeCount, webLinkCount, aiIndexedCount, aiPendingCount };
  }, [equipmentManuals]);

  // 장비 매뉴얼 엑셀 내보내기
  const exportManualsToExcel = () => {
    if (filteredManuals.length === 0) {
      showToast('내보낼 매뉴얼 데이터가 없습니다.', 'error');
      return;
    }
    const rows = filteredManuals.map((m, idx) => ({
      'No': idx + 1,
      '매뉴얼명': m.title,
      '카테고리': m.category,
      '제조사': m.manufacturer || '-',
      '적용모델': m.modelName || '-',
      '규격피트': m.targetSpecFt ? `${m.targetSpecFt}ft` : '-',
      '버전/연식': m.version || '-',
      '자료구분': m.mediaType || (m.youtubeVideoId ? '동영상(유튜브)' : 'PDF'),
      'URL/경로': m.externalUrl || m.fileUrl || m.fileName || '-',
      '등록일': m.uploadDate || (m.createdAt ? m.createdAt.slice(0, 10) : '-'),
      '설명/비고': m.memo || m.aiSummary || '-'
    }));
    const todayStr = new Date().toISOString().slice(0, 10);
    exportToExcel(rows, `장비매뉴얼목록_${todayStr}`, '매뉴얼');
    showToast(`장비 매뉴얼 목록 ${rows.length}건 엑셀 내보내기 완료`);
  };

  // 단건 AI 색인 실행
  const handleSingleManualAI = async (manual: EquipmentManual) => {
    showToast(`[${manual.title}] AI 메타데이터 자동 추출 중...`);
    try {
      const aiRes = await extractManualMetadataWithAI(manual);
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await saveEquipmentManual({
        ...manual,
        aiProcessed: true,
        aiProcessedAt: nowStr,
        keywords: aiRes.keywords,
        errorCodes: aiRes.errorCodes,
        majorParts: aiRes.majorParts,
        symptoms: aiRes.symptoms,
        aiSummary: aiRes.aiSummary
      });
      await db.awaitPendingWrites();
      showToast(`[${manual.title}] AI 메타데이터 색인 완료!`);
    } catch (err: any) {
      showToast(`AI 색인 실패: ${err?.message || err}`, 'error');
    }
  };

  // 미처리 전체 일괄 AI 색인 실행
  const handleBatchIndexAI = async () => {
    const unindexed = (equipmentManuals || []).filter(m => !m.aiProcessed);
    if (unindexed.length === 0) {
      showToast('모든 매뉴얼에 AI 메타데이터가 이미 색인되어 있습니다.');
      return;
    }

    setIsIndexingAI(true);
    try {
      for (let i = 0; i < unindexed.length; i++) {
        const target = unindexed[i];
        setIndexingProgress({ current: i + 1, total: unindexed.length, title: target.title });
        const aiRes = await extractManualMetadataWithAI(target);
        const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
        await saveEquipmentManual({
          ...target,
          aiProcessed: true,
          aiProcessedAt: nowStr,
          keywords: aiRes.keywords,
          errorCodes: aiRes.errorCodes,
          majorParts: aiRes.majorParts,
          symptoms: aiRes.symptoms,
          aiSummary: aiRes.aiSummary
        });
      }
      await db.awaitPendingWrites();
      showToast(`${unindexed.length}건의 매뉴얼에 AI 메타데이터 색인이 완료되었습니다.`);
    } catch (err: any) {
      showToast(`일괄 AI 색인 실패: ${err?.message || err}`, 'error');
    } finally {
      setIsIndexingAI(false);
      setIndexingProgress(null);
    }
  };

  // 메타데이터 편집 모달 열기
  const handleOpenMetadataModal = (manual: EquipmentManual) => {
    setEditingMetadataManual(manual);
    setEditKeywordsInput((manual.keywords || []).join(', '));
    setEditErrorCodesInput((manual.errorCodes || []).join(', '));
    setEditMajorPartsInput((manual.majorParts || []).join(', '));
    setEditSymptomsInput((manual.symptoms || []).join(', '));
    setEditAiSummaryInput(manual.aiSummary || '');
  };

  // 메타데이터 편집 저장
  const handleSaveMetadataModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMetadataManual) return;

    try {
      const parseList = (str: string) => str.split(',').map(s => s.trim()).filter(Boolean);
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

      await saveEquipmentManual({
        ...editingMetadataManual,
        aiProcessed: true,
        aiProcessedAt: editingMetadataManual.aiProcessedAt || nowStr,
        keywords: parseList(editKeywordsInput),
        errorCodes: parseList(editErrorCodesInput),
        majorParts: parseList(editMajorPartsInput),
        symptoms: parseList(editSymptomsInput),
        aiSummary: editAiSummaryInput.trim()
      });
      await db.awaitPendingWrites();
      showToast(`[${editingMetadataManual.title}] 메타데이터가 저장되었습니다.`);
      setEditingMetadataManual(null);
    } catch (err: any) {
      showToast(`저장 실패: ${err?.message || err}`, 'error');
    }
  };

  // 파일 선택 핸들러
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setManualFormFileName(file.name);
    setManualFormFileSize(file.size);

    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    setManualFormFileSizeLabel(`${sizeMb} MB`);

    if (!manualFormTitle) {
      setManualFormTitle(file.name.replace(/\.[^/.]+$/, ''));
    }

    const reader = new FileReader();
    reader.onload = event => {
      setManualFormFileUrl(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleOpenAddManualModal = () => {
    setManualFormMediaType('PDF');
    setManualFormExternalUrl('');
    setManualFormDurationMinutes('');
    setManualFormModel(modelOptions[0] || 'SJ-3219');
    setManualFormManufacturer('Skyjack');
    setManualFormCategory('PARTS_BOOK');
    setManualFormTitle('');
    setManualFormVersion('Rev. 2024-A');
    setManualFormTargetSpecFt(19);
    setManualFormMemo('');
    setManualFormFileName('');
    setManualFormFileSize(0);
    setManualFormFileSizeLabel('0 KB');
    setManualFormFileUrl('');
    setIsManualModalOpen(true);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualFormTitle.trim()) {
      showToast('매뉴얼 명칭(제목)을 입력해 주세요.', 'error');
      return;
    }

    if (manualFormMediaType === 'PDF' && !manualFormFileUrl) {
      showToast('매뉴얼 문서(PDF 등) 파일을 선택해 주세요.', 'error');
      return;
    }

    if (manualFormMediaType === 'YOUTUBE' && !manualFormExternalUrl.trim()) {
      showToast('유튜브 동영상 링크(URL)를 입력해 주세요.', 'error');
      return;
    }

    if (manualFormMediaType === 'WEB_LINK' && !manualFormExternalUrl.trim()) {
      showToast('웹 기술문서 링크(URL)를 입력해 주세요.', 'error');
      return;
    }

    try {
      let targetFileUrl = manualFormFileUrl;
      let targetFileName = manualFormFileName;
      let targetFileSize = manualFormFileSize;
      let targetFileSizeLabel = manualFormFileSizeLabel;
      let youtubeId: string | undefined = undefined;

      if (manualFormMediaType === 'YOUTUBE') {
        const cleanUrl = manualFormExternalUrl.trim();
        youtubeId = extractYoutubeVideoId(cleanUrl) || undefined;
        targetFileUrl = cleanUrl;
        targetFileName = targetFileName || `${manualFormTitle.trim()}.mp4`;
        targetFileSize = 0;
        targetFileSizeLabel = manualFormDurationMinutes
          ? `${String(manualFormDurationMinutes).padStart(2, '0')}:00`
          : '유튜브 영상';
      } else if (manualFormMediaType === 'WEB_LINK') {
        const cleanUrl = manualFormExternalUrl.trim();
        targetFileUrl = cleanUrl;
        targetFileName = targetFileName || `${manualFormTitle.trim()}.html`;
        targetFileSize = 0;
        targetFileSizeLabel = '웹 링크';
      } else {
        targetFileName = targetFileName || `${manualFormTitle.trim()}.pdf`;
        targetFileSize = targetFileSize || 1024 * 1024;
      }

      await saveEquipmentManual({
        modelName: manualFormModel,
        manufacturer: manualFormManufacturer,
        targetSpecFt: Number(manualFormTargetSpecFt) || undefined,
        category: manualFormCategory,
        mediaType: manualFormMediaType,
        externalUrl: manualFormMediaType !== 'PDF' ? manualFormExternalUrl.trim() : undefined,
        youtubeVideoId: youtubeId,
        durationMinutes: manualFormDurationMinutes ? Number(manualFormDurationMinutes) : undefined,
        title: manualFormTitle.trim(),
        fileUrl: targetFileUrl,
        fileName: targetFileName,
        fileSize: targetFileSize,
        fileSizeLabel: targetFileSizeLabel,
        version: manualFormVersion.trim() || 'Rev. 1.0',
        uploadDate: getTodayStr(),
        uploadedBy: '정비자산팀',
        memo: manualFormMemo.trim()
      });
      await db.awaitPendingWrites();
      showToast('장비 기술 자료가 성공적으로 등록되었습니다.');
      setIsManualModalOpen(false);
    } catch (err: any) {
      showToast(`등록 실패: ${err?.message || err}`, 'error');
    }
  };

  const doDeleteManual = async (manual: EquipmentManual) => {
    try {
      await deleteEquipmentManual(manual.id);
      await db.awaitPendingWrites();
      showToast(`[${manual.title}] 매뉴얼이 삭제되었습니다.`);
    } catch (err: any) {
      showToast(`삭제 실패: ${err?.message || err}`, 'error');
    }
  };

  const handleDeleteManual = (manual: EquipmentManual) => {
    setConfirmModal({
      isOpen: true,
      title: '장비 매뉴얼 삭제',
      message: `매뉴얼 [${manual.title}] (${manual.modelName} / ${manual.category}) 문서를 라이브러리에서 삭제하시겠습니까?`,
      confirmText: '삭제 실행',
      isDanger: true,
      onConfirm: () => {
        setConfirmModal(null);
        doDeleteManual(manual);
      }
    });
  };

  const getCategoryBadgeClass = (category: EquipmentManual['category']) => {
    switch (category) {
      case 'PARTS_BOOK':
        return 'badge-info';
      case 'ERROR_CODE':
        return 'badge-danger';
      case 'WIRING_DIAGRAM':
        return 'badge-warning';
      case 'OPERATOR_MANUAL':
        return 'badge-success';
      default:
        return 'badge-secondary';
    }
  };

  const getCategoryLabel = (category: EquipmentManual['category']) => {
    switch (category) {
      case 'PARTS_BOOK':
        return '부품 파츠북';
      case 'ERROR_CODE':
        return '에러코드 진단표';
      case 'WIRING_DIAGRAM':
        return '전기/유압 회로도';
      case 'OPERATOR_MANUAL':
        return '취급 운전 설명서';
      default:
        return category;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
      {/* 🔔 인앱 토스트 알림 (헌장 5.2) */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            padding: '10px 18px',
            borderRadius: '6px',
            backgroundColor: toastMessage.type === 'error' ? '#ef4444' : '#10b981',
            color: '#ffffff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            fontWeight: 600,
            fontSize: '13px'
          }}
        >
          {toastMessage.text}
        </div>
      )}

      {/* ─── 상단 헤더 & 탭 네비게이션 ─── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '12px'
        }}
      >
        <div>
          <h2 style={{ fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck className="text-primary" size={22} /> 정비 항목 관리
          </h2>
        </div>

        {/* 3대 탭 스위처 */}
        <div
          style={{
            display: 'flex',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '3px'
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('MASTER')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: activeTab === 'MASTER' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'MASTER' ? '#ffffff' : 'var(--text-secondary)',
              transition: 'all 0.2s'
            }}
          >
            <Layers size={14} /> 정비 항목 마스터
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ANALYTICS')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: activeTab === 'ANALYTICS' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'ANALYTICS' ? '#ffffff' : 'var(--text-secondary)',
              transition: 'all 0.2s'
            }}
          >
            <BarChart2 size={14} /> 조직역량 & 비용 분석
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('MANUALS')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: activeTab === 'MANUALS' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'MANUALS' ? '#ffffff' : 'var(--text-secondary)',
              transition: 'all 0.2s'
            }}
          >
            <BookOpen size={14} /> 장비 매뉴얼 라이브러리
          </button>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── [탭 1: 정비 항목 마스터 (MASTER)] ─── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {activeTab === 'MASTER' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* 상단 4대 요약 카드 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>관리 분류</span>
              <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>{masterAuditSummary.categoryCount}개 카테고리</strong>
            </div>
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>총 점검항목</span>
              <strong style={{ fontSize: '15px', color: '#16a34a' }}>{masterAuditSummary.totalCount}개</strong>
            </div>
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>평균 정비배점</span>
              <strong style={{ fontSize: '15px', color: '#d97706' }}>{masterAuditSummary.avgScore}점</strong>
            </div>
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>부품연계 항목</span>
              <strong style={{ fontSize: '15px', color: '#2563eb' }}>
                {masterAuditSummary.linkedPartsCount}개 ({masterAuditSummary.totalCount > 0 ? ((masterAuditSummary.linkedPartsCount / masterAuditSummary.totalCount) * 100).toFixed(0) : 0}%)
              </strong>
            </div>
          </div>

          {/* 필터 및 상단 파이프라인 액션 바 */}
          <div
            className="card"
            style={{
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px'
            }}
          >
            {/* 좌상단: Scope */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', width: '260px' }}>
                <input
                  type="text"
                  placeholder="항목명, 코드, 가이드 검색..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px 7px 32px', fontSize: '12.5px' }}
                />
                <Search
                  size={14}
                  style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                />
              </div>

              {/* 카테고리 칩 필터 */}
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {['전체', '외관/바디', '유압/동력', '전기/배터리', '주행/타이어', '기타/검수'].map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      fontSize: '11.5px',
                      cursor: 'pointer',
                      backgroundColor: selectedCategory === cat ? 'var(--primary)' : 'var(--bg-main)',
                      color: selectedCategory === cat ? '#ffffff' : 'var(--text-secondary)',
                      fontWeight: selectedCategory === cat ? 700 : 500,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* 우상단: Pipeline 액션군 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={exportMasterToExcel}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', fontSize: '12px' }}
              >
                <FileDown size={14} /> 엑셀 내보내기
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleOpenAddItemModal}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 14px', fontSize: '12px', fontWeight: 600 }}
              >
                <Plus size={15} /> 신규 정비 항목 등록
              </button>
            </div>
          </div>

          {/* 중앙 고밀도 데이터 그리드 (헌장 3.2: 줄바꿈 방지) */}
          <div className="card" style={{ padding: '14px' }}>
            <div className="table-container" style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ whiteSpace: 'nowrap', width: '50px' }}>No</th>
                    <th style={{ whiteSpace: 'nowrap', width: '90px' }}>카테고리</th>
                    <th style={{ whiteSpace: 'nowrap', width: '105px' }}>항목 코드</th>
                    <th style={{ whiteSpace: 'nowrap', width: '180px' }}>정비 필요 항목명</th>
                    <th style={{ whiteSpace: 'nowrap', width: '80px' }}>정비 배점</th>
                    <th style={{ whiteSpace: 'nowrap', width: '90px' }}>표준 공수</th>
                    <th style={{ whiteSpace: 'nowrap', minWidth: '160px' }}>추천 소모품 / 부품</th>
                    <th style={{ whiteSpace: 'nowrap', width: '100px' }}>누적 정비 건수</th>
                    <th style={{ minWidth: '220px' }}>표준 조치 절차 (SOP)</th>
                    <th style={{ whiteSpace: 'nowrap', width: '110px' }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMasterItems.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                        조회 조건에 해당하는 정비 점검 항목이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredMasterItems.map((item, idx) => {
                      const stat = repairMappingStats[item.code] || repairMappingStats[item.id] || { count: 0 };
                      const recommendedParts = (item.recommendedConsumableIds || []).map(cid => consumableMap.get(cid)).filter(Boolean);

                      return (
                        <tr key={item.id}>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{idx + 1}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className="badge badge-info">{item.category}</span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap', fontSize: '11.5px', color: 'var(--text-muted)' }}>{item.code}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <strong style={{ fontSize: '13px' }}>{item.name}</strong>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span
                              className="badge badge-warning"
                              style={{ fontSize: '11.5px', fontWeight: 'bold', padding: '2px 7px' }}
                            >
                              +{item.score}점
                            </span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>
                              {item.standardManHours || 0.5} M/H
                            </span>
                          </td>
                          <td>
                            {recommendedParts.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {recommendedParts.map(part => (
                                  <span
                                    key={part!.id}
                                    style={{
                                      fontSize: '11px',
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      backgroundColor: 'rgba(59, 130, 246, 0.12)',
                                      color: '#3b82f6',
                                      border: '1px solid rgba(59, 130, 246, 0.25)',
                                      whiteSpace: 'nowrap'
                                    }}
                                    title={`단가: ₩${(part!.unitPrice || 0).toLocaleString()} | 현재재고: ${part!.stockQty}개`}
                                  >
                                    {part!.modelName}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>-</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {stat.count > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--primary)' }}>
                                  {stat.count.toLocaleString()}건
                                </span>
                                {stat.lastOccurred && (
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>최근 {stat.lastOccurred}</span>
                                )}
                              </div>
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>0건</span>
                            )}
                          </td>
                          <td style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                            {item.actionGuide || item.description || '-'}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => handleOpenEditItemModal(item)}
                                style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}
                              >
                                <Edit2 size={12} /> 수정
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => handleDeleteItem(item)}
                                style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--danger)' }}
                              >
                                <Trash2 size={12} /> 삭제
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── [탭 2: 조직역량 & 비용 분석 (ANALYTICS)] ─── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {activeTab === 'ANALYTICS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* 기간 선택 및 스코핑 컨트롤 바 */}
          <div
            className="card"
            style={{
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px'
            }}
          >
            {/* 좌상단: Scope (기간 및 카테고리) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Calendar size={15} style={{ color: 'var(--primary)' }} />
                <span style={{ fontSize: '12px', fontWeight: 700 }}>분석 기간</span>
                <input
                  type="date"
                  value={analyticsStartDate}
                  onChange={e => setAnalyticsStartDate(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>~</span>
                <input
                  type="date"
                  value={analyticsEndDate}
                  onChange={e => setAnalyticsEndDate(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                />
              </div>

              {/* 기간 퀵 프리셋 버튼 */}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPeriodPreset('THIS_MONTH')}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                >
                  당월
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPeriodPreset('LAST_MONTH')}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                >
                  전월
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPeriodPreset('LAST_3_MONTHS')}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                >
                  최근 3개월
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPeriodPreset('ALL')}
                  style={{ padding: '3px 8px', fontSize: '11px' }}
                >
                  전체
                </button>
              </div>

              {/* 카테고리 필터 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Filter size={13} style={{ color: 'var(--text-muted)' }} />
                <select
                  value={analyticsCategoryFilter}
                  onChange={e => setAnalyticsCategoryFilter(e.target.value)}
                  style={{ padding: '4px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                >
                  <option value="전체">전체 카테고리</option>
                  <option value="외관/바디">외관/바디</option>
                  <option value="유압/동력">유압/동력</option>
                  <option value="전기/배터리">전기/배터리</option>
                  <option value="주행/타이어">주행/타이어</option>
                  <option value="기타/검수">기타/검수</option>
                </select
              ></div>
            </div>

            {/* 우상단: Pipeline (엑셀 내보내기) */}
            <div>
              <button
                type="button"
                className="btn-secondary"
                onClick={exportAnalyticsToExcel}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', fontSize: '12px' }}
              >
                <FileDown size={14} /> 정산 분석 엑셀 내보내기
              </button>
            </div>
          </div>

          {/* 상단 5대 핵심 KPI 카드 (조직역량 Throughput & 비용) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>정비 완료 총량 (건수)</span>
                <Clock size={15} style={{ color: 'var(--primary)' }} />
              </div>
              <strong style={{ fontSize: '18px', color: 'var(--primary)' }}>
                {analyticsData.totalRepairCount.toLocaleString()}건
              </strong>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                실제 {analyticsData.grandTotalManHours} M/H (표준 {analyticsData.grandTotalStandardManHours} M/H)
              </span>
            </div>

            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>정비 소요 총비용</span>
                <Wrench size={15} style={{ color: '#d97706' }} />
              </div>
              <strong style={{ fontSize: '18px', color: '#d97706' }}>
                ₩{analyticsData.grandTotalCost.toLocaleString()}
              </strong>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                소모품비 + 외주비 합계
              </span>
            </div>

            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>자체 소모품비</span>
                <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 700 }}>소모품</span>
              </div>
              <strong style={{ fontSize: '18px', color: '#16a34a' }}>
                ₩{analyticsData.grandPartCost.toLocaleString()}
              </strong>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                비중: {analyticsData.grandTotalCost > 0 ? ((analyticsData.grandPartCost / analyticsData.grandTotalCost) * 100).toFixed(1) : 0}%
              </span>
            </div>

            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>고객 유상 청구액</span>
                <span style={{ fontSize: '12px', color: '#2563eb', fontWeight: 700 }}>청구</span>
              </div>
              <strong style={{ fontSize: '18px', color: '#2563eb' }}>
                ₩{analyticsData.grandBillableAmount.toLocaleString()}
              </strong>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>고객 과실/파손 청구</span>
            </div>

            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>당사 순부담 원가</span>
                <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 700 }}>순원가</span>
              </div>
              <strong style={{ fontSize: '18px', color: '#dc2626' }}>
                ₩{analyticsData.grandCompanyCost.toLocaleString()}
              </strong>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                총비용 - 고객청구액
              </span>
            </div>
          </div>

          {/* 중앙 고밀도 항목별 역량 및 비용 대사 그리드 (Inspection) */}
          <div className="card" style={{ padding: '14px' }}>
            <div className="table-container" style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ whiteSpace: 'nowrap', width: '50px' }}>No</th>
                    <th style={{ whiteSpace: 'nowrap', width: '90px' }}>카테고리</th>
                    <th style={{ whiteSpace: 'nowrap', width: '105px' }}>항목 코드</th>
                    <th style={{ whiteSpace: 'nowrap', minWidth: '160px' }}>정비 항목명</th>
                    <th style={{ whiteSpace: 'nowrap', width: '80px', textAlign: 'right' }}>발생 건수</th>
                    <th style={{ whiteSpace: 'nowrap', width: '90px', textAlign: 'right' }}>소요 공수</th>
                    <th style={{ whiteSpace: 'nowrap', width: '100px', textAlign: 'right' }}>자체 소모품비</th>
                    <th style={{ whiteSpace: 'nowrap', width: '100px', textAlign: 'right' }}>외주 정비비</th>
                    <th style={{ whiteSpace: 'nowrap', width: '110px', textAlign: 'right' }}>정비 총비용</th>
                    <th style={{ whiteSpace: 'nowrap', width: '100px', textAlign: 'right' }}>고객 청구액</th>
                    <th style={{ whiteSpace: 'nowrap', width: '100px', textAlign: 'right' }}>회사 순부담</th>
                    <th style={{ whiteSpace: 'nowrap', width: '80px', textAlign: 'right' }}>비용 비중</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsData.items.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                        지정된 기간 내 정비 활동 데이터가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    analyticsData.items.map((item, idx) => {
                      const share = analyticsData.grandTotalCost > 0
                        ? ((item.totalCost / analyticsData.grandTotalCost) * 100).toFixed(1)
                        : '0.0';

                      return (
                        <tr key={item.itemCode}>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>{idx + 1}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className="badge badge-info">{item.category}</span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap', fontSize: '11.5px', color: 'var(--text-muted)' }}>{item.itemCode}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <strong style={{ fontSize: '13px' }}>{item.itemName}</strong>
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                            {item.count}건
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right', fontSize: '12px' }}>
                            {item.totalManHours.toFixed(1)} M/H
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right', fontSize: '12px' }}>
                            ₩{item.partCost.toLocaleString()}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right', fontSize: '12px' }}>
                            ₩{item.externalCost.toLocaleString()}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right', fontSize: '12.5px', fontWeight: 700, color: '#d97706' }}>
                            ₩{item.totalCost.toLocaleString()}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right', fontSize: '12px', color: '#2563eb' }}>
                            ₩{item.billableAmount.toLocaleString()}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#dc2626' }}>
                            ₩{item.companyCost.toLocaleString()}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                            <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                              {share}%
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── [탭 3: 장비 매뉴얼 라이브러리 (MANUALS)] ─── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {activeTab === 'MANUALS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* 상단 통계 바 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>전체 지식자료</span>
              <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>{manualSummary.total}건</strong>
            </div>
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <FileText size={12} /> PDF 문서
              </span>
              <strong style={{ fontSize: '15px', color: '#334155' }}>{manualSummary.pdfCount}건</strong>
            </div>
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid #fecaca',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '11.5px', color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Youtube size={13} /> 유튜브 영상
              </span>
              <strong style={{ fontSize: '15px', color: '#dc2626' }}>{manualSummary.youtubeCount}건</strong>
            </div>
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid #c7d2fe',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '11.5px', color: '#4338ca', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Globe size={12} /> 웹 기술문서
              </span>
              <strong style={{ fontSize: '15px', color: '#4338ca' }}>{manualSummary.webLinkCount}건</strong>
            </div>
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>에러코드 진단</span>
              <strong style={{ fontSize: '15px', color: '#dc2626' }}>{manualSummary.errorCodeCount}건</strong>
            </div>
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid #bbf7d0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '11.5px', color: '#15803d', fontWeight: 600 }}>AI 색인완료</span>
              <strong style={{ fontSize: '15px', color: '#16a34a' }}>{manualSummary.aiIndexedCount}건</strong>
            </div>
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: manualSummary.aiPendingCount > 0 ? '1px solid #fed7aa' : '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <span style={{ fontSize: '11.5px', color: manualSummary.aiPendingCount > 0 ? '#c2410c' : 'var(--text-secondary)', fontWeight: 600 }}>
                AI 분석대기
              </span>
              <strong style={{ fontSize: '15px', color: manualSummary.aiPendingCount > 0 ? '#ea580c' : 'var(--text-muted)' }}>
                {manualSummary.aiPendingCount}건
              </strong>
            </div>
          </div>

          {/* 검색 및 필터 컨트롤 바 */}
          <div
            className="card"
            style={{
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px'
            }}
          >
            {/* 좌상단: Scope */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', width: '270px' }}>
                <input
                  type="text"
                  placeholder="매뉴얼명, 모델, 에러코드(02, 18), 부품, 증상..."
                  value={manualSearchTerm}
                  onChange={e => setManualSearchTerm(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px 7px 32px', fontSize: '12.5px' }}
                />
                <Search
                  size={14}
                  style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
                />
              </div>

              {/* 모델 필터 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  장비 모델:
                </span>
                <select
                  value={selectedManualModel}
                  onChange={e => setSelectedManualModel(e.target.value)}
                  style={{ padding: '5px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                >
                  <option value="전체">전체 모델</option>
                  {modelOptions.map(model => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>

              {/* 미디어 유형 칩 필터 */}
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  자료 형태:
                </span>
                {[
                  { key: '전체', label: '전체' },
                  { key: 'PDF', label: '📄 PDF' },
                  { key: 'YOUTUBE', label: '🎬 유튜브' },
                  { key: 'WEB_LINK', label: '🌐 웹문서' }
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelectedManualMediaType(item.key as any)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      fontSize: '11.5px',
                      cursor: 'pointer',
                      backgroundColor: selectedManualMediaType === item.key ? 'var(--primary)' : 'var(--bg-main)',
                      color: selectedManualMediaType === item.key ? '#ffffff' : 'var(--text-secondary)',
                      fontWeight: selectedManualMediaType === item.key ? 700 : 500,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* 문서 분류 칩 필터 */}
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {[
                  { key: '전체', label: '전체' },
                  { key: 'PARTS_BOOK', label: '파츠북' },
                  { key: 'ERROR_CODE', label: '에러코드' },
                  { key: 'WIRING_DIAGRAM', label: '회로도' },
                  { key: 'OPERATOR_MANUAL', label: '취급설명서' }
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelectedManualCategory(item.key)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      fontSize: '11.5px',
                      cursor: 'pointer',
                      backgroundColor: selectedManualCategory === item.key ? '#334155' : 'var(--bg-main)',
                      color: selectedManualCategory === item.key ? '#ffffff' : 'var(--text-secondary)',
                      fontWeight: selectedManualCategory === item.key ? 700 : 500,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 우상단: Pipeline 액션 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* 일괄 AI 색인 버튼 */}
              <button
                type="button"
                className="btn-secondary"
                onClick={handleBatchIndexAI}
                disabled={isIndexingAI || manualSummary.aiPendingCount === 0}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: manualSummary.aiPendingCount > 0 ? '#c2410c' : 'var(--text-muted)',
                  borderColor: manualSummary.aiPendingCount > 0 ? '#fed7aa' : 'var(--border-color)',
                  backgroundColor: manualSummary.aiPendingCount > 0 ? '#fff7ed' : 'var(--bg-main)',
                  cursor: (isIndexingAI || manualSummary.aiPendingCount === 0) ? 'default' : 'pointer'
                }}
                title={manualSummary.aiPendingCount === 0 ? '모든 매뉴얼 색인 완결됨' : '미처리 매뉴얼 일괄 AI 메타데이터 색인'}
              >
                <Sparkles size={14} style={{ color: manualSummary.aiPendingCount > 0 ? '#ea580c' : 'var(--text-muted)' }} />
                {isIndexingAI ? 'AI 색인 진행 중...' : `일괄 AI 색인 (미처리 ${manualSummary.aiPendingCount}건)`}
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={exportManualsToExcel}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                <Download size={14} /> 엑셀 내보내기
              </button>

              <button
                type="button"
                className="btn-primary"
                onClick={handleOpenAddManualModal}
                style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 14px', fontSize: '12px', fontWeight: 600 }}
              >
                <UploadCloud size={15} /> 신규 기술자료 등록
              </button>
            </div>

            {/* 일괄 진행 프로그레스 바 */}
            {isIndexingAI && indexingProgress && (
              <div
                style={{
                  width: '100%',
                  marginTop: '4px',
                  padding: '8px 12px',
                  backgroundColor: '#eff6ff',
                  borderRadius: '4px',
                  border: '1px solid #bfdbfe',
                  fontSize: '11.5px',
                  color: '#1e40af'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>
                    ⚡ AI 메타데이터 자동 추출 중: <strong>{indexingProgress.title}</strong>
                  </span>
                  <strong>
                    {indexingProgress.current} / {indexingProgress.total}건 (
                    {Math.round((indexingProgress.current / indexingProgress.total) * 100)}%)
                  </strong>
                </div>
                <div style={{ height: '5px', backgroundColor: '#dbeafe', borderRadius: '3px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      backgroundColor: 'var(--primary)',
                      width: `${(indexingProgress.current / indexingProgress.total) * 100}%`,
                      transition: 'width 0.3s'
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 카드 그리드 워크벤치 (유형 A/Card Dossier) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '14px' }}>
            {filteredManuals.length === 0 ? (
              <div
                className="card"
                style={{ gridColumn: '1 / -1', padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)' }}
              >
                조건에 맞는 장비 기술 자료가 없습니다. [신규 기술자료 등록] 버튼으로 PDF, 유튜브 정비영상 또는 웹 문서를 등록해 주세요.
              </div>
            ) : (
              filteredManuals.map(manual => (
                <div
                  key={manual.id}
                  className="card"
                  style={{
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '10px',
                    border: '1px solid var(--border-color)',
                    transition: 'box-shadow 0.2s',
                    backgroundColor: 'var(--bg-card)'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* 상단 배지 헤더 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* 미디어 유형 배지 */}
                        {manual.mediaType === 'YOUTUBE' ? (
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: '#fee2e2',
                              color: '#dc2626',
                              border: '1px solid #fecaca',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <Youtube size={12} /> 유튜브 영상
                          </span>
                        ) : manual.mediaType === 'WEB_LINK' ? (
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: '#e0e7ff',
                              color: '#4338ca',
                              border: '1px solid #c7d2fe',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <Globe size={11} /> 웹 문서
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: '#f1f5f9',
                              color: '#475569',
                              border: '1px solid #e2e8f0',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <FileText size={11} /> PDF 문서
                          </span>
                        )}

                        <span className={`badge ${getCategoryBadgeClass(manual.category)}`} style={{ fontSize: '10.5px' }}>
                          {getCategoryLabel(manual.category)}
                        </span>
                        <span
                          style={{
                            fontSize: '10.5px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--bg-main)',
                            border: '1px solid var(--border-color)'
                          }}
                        >
                          {manual.modelName}
                        </span>

                        {manual.aiProcessed ? (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '2px 5px',
                              borderRadius: '4px',
                              backgroundColor: '#dcfce7',
                              color: '#15803d',
                              border: '1px solid #bbf7d0',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            <Sparkles size={10} /> AI 색인됨
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              padding: '2px 5px',
                              borderRadius: '4px',
                              backgroundColor: '#fef3c7',
                              color: '#b45309',
                              border: '1px solid #fde68a'
                            }}
                          >
                            AI 대기
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{manual.version}</span>
                    </div>

                    {/* 유튜브 영상일 경우 썸네일 미리보기 */}
                    {manual.mediaType === 'YOUTUBE' && manual.youtubeVideoId && (
                      <div
                        style={{
                          position: 'relative',
                          width: '100%',
                          height: '140px',
                          borderRadius: '6px',
                          overflow: 'hidden',
                          cursor: 'pointer',
                          backgroundColor: '#000000',
                          marginTop: '2px'
                        }}
                        onClick={() => setPreviewManual(manual)}
                        title="클릭하여 유튜브 영상 즉시 재생"
                      >
                        <img
                          src={`https://img.youtube.com/vi/${manual.youtubeVideoId}/hqdefault.jpg`}
                          alt={manual.title}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            backgroundColor: 'rgba(0,0,0,0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <div
                            style={{
                              width: '38px',
                              height: '38px',
                              borderRadius: '50%',
                              backgroundColor: '#dc2626',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#ffffff',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
                            }}
                          >
                            <Play size={17} fill="#ffffff" style={{ marginLeft: '2px' }} />
                          </div>
                        </div>
                        {manual.fileSizeLabel && (
                          <span
                            style={{
                              position: 'absolute',
                              bottom: '6px',
                              right: '6px',
                              padding: '2px 6px',
                              backgroundColor: 'rgba(0,0,0,0.8)',
                              color: '#ffffff',
                              fontSize: '10px',
                              borderRadius: '3px',
                              fontWeight: 700
                            }}
                          >
                            {manual.fileSizeLabel}
                          </span>
                        )}
                      </div>
                    )}

                    {/* 매뉴얼 명칭 */}
                    <h4
                      style={{
                        margin: 0,
                        fontSize: '13.5px',
                        fontWeight: 700,
                        color: 'var(--text-main)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      {manual.mediaType === 'YOUTUBE' ? (
                        <Youtube size={16} style={{ color: '#dc2626', flexShrink: 0 }} />
                      ) : manual.mediaType === 'WEB_LINK' ? (
                        <Globe size={16} style={{ color: '#4338ca', flexShrink: 0 }} />
                      ) : (
                        <FileText size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                      )}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {manual.title}
                      </span>
                    </h4>

                    {/* 제원 및 제조사 정보 */}
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', display: 'flex', gap: '10px' }}>
                      <span>제조사: <strong>{manual.manufacturer}</strong></span>
                      {manual.targetSpecFt && <span>규격: <strong>{manual.targetSpecFt}ft</strong></span>}
                      <span>크기/분량: <strong>{manual.fileSizeLabel || '0 MB'}</strong></span>
                    </div>

                    {/* AI 요약 콜아웃 (있을 경우) */}
                    {manual.aiSummary && (
                      <div
                        style={{
                          backgroundColor: '#f8fafc',
                          borderLeft: '3px solid var(--primary)',
                          padding: '6px 10px',
                          borderRadius: '0 4px 4px 0',
                          fontSize: '11.5px',
                          color: 'var(--text-main)',
                          lineHeight: '1.45'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10.5px', color: 'var(--primary)', fontWeight: 700, marginBottom: '2px' }}>
                          <Sparkles size={11} /> AI 수록 요약
                        </div>
                        {manual.aiSummary}
                      </div>
                    )}

                    {/* 설명/메모 */}
                    {manual.memo && !manual.aiSummary && (
                      <p
                        style={{
                          margin: 0,
                          fontSize: '11.5px',
                          color: 'var(--text-muted)',
                          lineHeight: '1.4',
                          backgroundColor: 'var(--bg-main)',
                          padding: '6px 8px',
                          borderRadius: '4px'
                        }}
                      >
                        {manual.memo}
                      </p>
                    )}

                    {/* 에러코드 & 고장증상 & 부품 태그 칩 그리드 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                      {/* 에러코드 태그 */}
                      {manual.errorCodes && manual.errorCodes.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '10px', color: '#b91c1c', fontWeight: 700 }}>코드:</span>
                          {manual.errorCodes.map((ec, idx) => (
                            <span
                              key={idx}
                              style={{
                                fontSize: '10px',
                                padding: '1px 5px',
                                borderRadius: '3px',
                                backgroundColor: '#fee2e2',
                                color: '#991b1b',
                                border: '1px solid #fecaca',
                                fontWeight: 600
                              }}
                            >
                              🚨 {ec}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 고장증상 태그 */}
                      {manual.symptoms && manual.symptoms.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '10px', color: '#c2410c', fontWeight: 700 }}>증상:</span>
                          {manual.symptoms.map((sym, idx) => (
                            <span
                              key={idx}
                              style={{
                                fontSize: '10px',
                                padding: '1px 5px',
                                borderRadius: '3px',
                                backgroundColor: '#ffedd5',
                                color: '#9a3412',
                                border: '1px solid #fed7aa',
                                fontWeight: 500
                              }}
                            >
                              ⚠️ {sym}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 주요부품 태그 */}
                      {manual.majorParts && manual.majorParts.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '10px', color: '#1d4ed8', fontWeight: 700 }}>부품:</span>
                          {manual.majorParts.slice(0, 3).map((part, idx) => (
                            <span
                              key={idx}
                              style={{
                                fontSize: '10px',
                                padding: '1px 5px',
                                borderRadius: '3px',
                                backgroundColor: '#dbeafe',
                                color: '#1e40af',
                                border: '1px solid #bfdbfe',
                                fontWeight: 500
                              }}
                            >
                              🔧 {part}
                            </span>
                          ))}
                          {manual.majorParts.length > 3 && (
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              +{manual.majorParts.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 하단 액션 버튼군 */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: '10px'
                    }}
                  >
                    <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                      등록일: {manual.uploadDate}
                    </span>

                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {manual.mediaType === 'YOUTUBE' ? (
                        <>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => setPreviewManual(manual)}
                            style={{
                              padding: '4px 9px',
                              fontSize: '11px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              backgroundColor: '#dc2626',
                              borderColor: '#dc2626'
                            }}
                          >
                            <Play size={12} fill="#ffffff" /> 영상재생
                          </button>
                          <a
                            href={manual.externalUrl || manual.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-secondary"
                            style={{
                              padding: '4px 8px',
                              fontSize: '11px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              textDecoration: 'none'
                            }}
                            title="YouTube 원본 링크 새창 열기"
                          >
                            <ExternalLink size={12} /> YouTube
                          </a>
                        </>
                      ) : manual.mediaType === 'WEB_LINK' ? (
                        <>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => setPreviewManual(manual)}
                            style={{ padding: '4px 9px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}
                          >
                            <Eye size={12} /> 열람
                          </button>
                          <a
                            href={manual.externalUrl || manual.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-secondary"
                            style={{
                              padding: '4px 8px',
                              fontSize: '11px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              textDecoration: 'none'
                            }}
                            title="외부 웹 문서 새창 열기"
                          >
                            <ExternalLink size={12} /> 웹열기
                          </a>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => setPreviewManual(manual)}
                            style={{ padding: '4px 9px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}
                          >
                            <Eye size={12} /> 열람
                          </button>
                          <a
                            href={manual.fileUrl}
                            download={manual.fileName}
                            className="btn-secondary"
                            style={{
                              padding: '4px 8px',
                              fontSize: '11px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px',
                              textDecoration: 'none'
                            }}
                          >
                            <Download size={12} /> 다운로드
                          </a>
                        </>
                      )}

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleSingleManualAI(manual)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '3px',
                          color: '#d97706',
                          borderColor: '#fed7aa'
                        }}
                        title="AI 메타데이터 단건 재색인"
                      >
                        <Sparkles size={12} /> AI 색인
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleOpenMetadataModal(manual)}
                        style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}
                        title="메타데이터 태그 수동 편집"
                      >
                        <Tag size={12} /> 태그
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleDeleteManual(manual)}
                        style={{ padding: '4px 7px', fontSize: '11px', color: 'var(--danger)' }}
                        title="매뉴얼 삭제"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── [모달 1] 정비 필요 항목 등록/수정 모달 (상하 스택 헌장 3.4) ─── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {isItemModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '560px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              backgroundColor: 'var(--bg-card)',
              borderRadius: '12px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                borderBottom: '1px solid var(--border-color)',
                paddingBottom: '10px'
              }}
            >
              <h3 style={{ margin: 0, fontWeight: '700', fontSize: '16px' }}>
                {editingItem ? '정비 항목 마스터 수정' : '신규 정비 항목 마스터 등록'}
              </h3>
              <button
                type="button"
                onClick={() => setIsItemModalOpen(false)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleItemSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {/* 카테고리 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>카테고리 분류 *</label>
                  <select
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value)}
                    style={{
                      padding: '8px 10px',
                      fontSize: '12.5px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-main)'
                    }}
                  >
                    <option value="외관/바디">외관/바디 (도장, 섀시, 커버)</option>
                    <option value="유압/동력">유압/동력 (실린더, 유압유, 호스)</option>
                    <option value="전기/배터리">전기/배터리 (단선, 컨트롤러, 충전기)</option>
                    <option value="주행/타이어">주행/타이어 (타이어, 휠, 모터)</option>
                    <option value="기타/검수">기타/검수</option>
                  </select>
                </div>

                {/* 항목 코드 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>항목 코드 (자동채번)</label>
                  <input
                    type="text"
                    value={formCode}
                    readOnly
                    style={{
                      padding: '8px 10px',
                      fontSize: '12.5px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-muted)'
                    }}
                  />
                </div>
              </div>

              {/* 항목명 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>정비 항목명 *</label>
                <input
                  type="text"
                  placeholder="예: 실린더 유압유 누유 (패킹 마모)"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  required
                  style={{
                    padding: '8px 10px',
                    fontSize: '13px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-main)',
                    color: 'var(--text-main)'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {/* 연동 정비 배점 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>연동 정비 배점 (벌점) *</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={formScore}
                    onChange={e => setFormScore(Number(e.target.value))}
                    required
                    style={{
                      padding: '8px 10px',
                      fontSize: '12.5px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-main)'
                    }}
                  />
                </div>

                {/* 표준 작업 공수 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>표준 작업 공수 (M/H) *</label>
                  <input
                    type="number"
                    step="0.1"
                    min={0.1}
                    max={50}
                    value={formManHours}
                    onChange={e => setFormManHours(Number(e.target.value))}
                    required
                    style={{
                      padding: '8px 10px',
                      fontSize: '12.5px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-main)',
                      color: 'var(--text-main)'
                    }}
                  />
                </div>
              </div>

              {/* 추천 소모품 / 부품 연계 멀티 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>추천 소모품 / 필요 부품 연계</label>
                  {formRecommendedConsumables.length > 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 600 }}>
                      {formRecommendedConsumables.length}개 부품 선택됨
                    </span>
                  )}
                </div>
                <div
                  style={{
                    maxHeight: '130px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '8px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    backgroundColor: 'var(--bg-main)'
                  }}
                >
                  {(consumables || []).map(part => {
                    const isSelected = formRecommendedConsumables.includes(part.id);
                    return (
                      <button
                        key={part.id}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setFormRecommendedConsumables(formRecommendedConsumables.filter(id => id !== part.id));
                          } else {
                            setFormRecommendedConsumables([...formRecommendedConsumables, part.id]);
                          }
                        }}
                        style={{
                          padding: '4px 9px',
                          borderRadius: '6px',
                          border: isSelected ? '1px solid #3b82f6' : '1px solid var(--border-color)',
                          backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-card)',
                          color: isSelected ? '#3b82f6' : 'var(--text-main)',
                          fontSize: '11.5px',
                          fontWeight: isSelected ? 600 : 400,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0
                        }}
                      >
                        {isSelected ? (
                          <CheckCircle2 size={13} style={{ color: '#3b82f6' }} />
                        ) : (
                          <span style={{ width: '10px', height: '10px', borderRadius: '50%', border: '1px solid var(--text-muted)', display: 'inline-block' }} />
                        )}
                        <span>{part.modelName} {part.unitPrice ? `(₩${part.unitPrice.toLocaleString()})` : ''}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 표준 조치 절차 (SOP) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>표준 조치 절차 (SOP)</label>
                <textarea
                  rows={2}
                  placeholder="정비사 조치 시 핵심 확인 절차 (예: 메인 밸브 차단 후 오링 교체, 유압유 레벨 점검)..."
                  value={formActionGuide}
                  onChange={e => setFormActionGuide(e.target.value)}
                  style={{
                    padding: '8px 10px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-main)',
                    color: 'var(--text-main)',
                    resize: 'vertical'
                  }}
                />
              </div>

              {/* 상세 설명 및 판단 가이드 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>상세 설명 및 입고검수 판단 기준</label>
                <textarea
                  rows={2}
                  placeholder="현장 검수자가 이 항목을 판단할 때 참고할 기준 가이드..."
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  style={{
                    padding: '8px 10px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-main)',
                    color: 'var(--text-main)',
                    resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsItemModalOpen(false)}
                  style={{ flex: 1, padding: '8px' }}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ flex: 1, padding: '8px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                >
                  <Save size={14} /> 저장 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── [모달 2] 신규 장비 매뉴얼 등록 모달 (멀티미디어 확장: PDF / 유튜브 / 웹문서) ─── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {isManualModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '560px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              backgroundColor: 'var(--bg-card)',
              borderRadius: '12px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                borderBottom: '1px solid var(--border-color)',
                paddingBottom: '10px'
              }}
            >
              <h3 style={{ margin: 0, fontWeight: '700', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <UploadCloud className="text-primary" size={18} /> 신규 기술자료 등록
              </h3>
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 자료 형태 선택 세그먼트 (헌장 3.4) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold' }}>자료 형태 (미디어 포맷) *</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  {[
                    { type: 'PDF', label: '📄 PDF / 파일' },
                    { type: 'YOUTUBE', label: '🎬 유튜브 영상' },
                    { type: 'WEB_LINK', label: '🌐 웹 기술문서' }
                  ].map(m => (
                    <button
                      key={m.type}
                      type="button"
                      onClick={() => setManualFormMediaType(m.type as any)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: manualFormMediaType === m.type ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                        backgroundColor: manualFormMediaType === m.type ? '#eff6ff' : 'var(--bg-main)',
                        color: manualFormMediaType === m.type ? '#1d4ed8' : 'var(--text-secondary)',
                        fontWeight: manualFormMediaType === m.type ? 700 : 500,
                        fontSize: '12px',
                        cursor: 'pointer',
                        textAlign: 'center'
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {/* 장비 모델 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold' }}>적용 장비 모델 *</label>
                  <input
                    type="text"
                    list="model-options"
                    placeholder="예: SJ-3219, GS-1930, 공통"
                    value={manualFormModel}
                    onChange={e => setManualFormModel(e.target.value)}
                    required
                    style={{ padding: '7px', fontSize: '12.5px' }}
                  />
                  <datalist id="model-options">
                    {modelOptions.map(m => (
                      <option key={m} value={m} />
                    ))}
                    <option value="공통" />
                  </datalist>
                </div>

                {/* 제조사 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold' }}>제조사 *</label>
                  <select
                    value={manualFormManufacturer}
                    onChange={e => setManualFormManufacturer(e.target.value)}
                    style={{ padding: '7px', fontSize: '12.5px' }}
                  >
                    <option value="Skyjack">Skyjack (스카이잭)</option>
                    <option value="Genie">Genie (지니)</option>
                    <option value="Dingli">Dingli (딩리)</option>
                    <option value="JLG">JLG</option>
                    <option value="Delta-Q">Delta-Q (델타큐)</option>
                    <option value="기타">기타 제조사</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {/* 문서 분류 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold' }}>내용 분류 *</label>
                  <select
                    value={manualFormCategory}
                    onChange={e => setManualFormCategory(e.target.value as EquipmentManual['category'])}
                    style={{ padding: '7px', fontSize: '12.5px' }}
                  >
                    <option value="ERROR_CODE">에러코드 진단 및 수리영상/표</option>
                    <option value="PARTS_BOOK">부품 파츠북 및 교체 실무</option>
                    <option value="WIRING_DIAGRAM">전기/유압 회로도 및 점검</option>
                    <option value="OPERATOR_MANUAL">취급 운전 및 조작 설명서</option>
                  </select>
                </div>

                {/* 개정 버전 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold' }}>자료 버전 / 비고</label>
                  <input
                    type="text"
                    placeholder="예: Rev. 2024-C 또는 실무촬영본"
                    value={manualFormVersion}
                    onChange={e => setManualFormVersion(e.target.value)}
                    style={{ padding: '7px', fontSize: '12.5px' }}
                  />
                </div>
              </div>

              {/* 매뉴얼 명칭 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold' }}>자료 명칭 (제목) *</label>
                <input
                  type="text"
                  placeholder={
                    manualFormMediaType === 'YOUTUBE'
                      ? '예: [사내정비] SJ-3219 상승 솔레노이드 밸브 분해정비 및 에어빼기 실무'
                      : manualFormMediaType === 'WEB_LINK'
                      ? '예: [웹매뉴얼] Delta-Q 충전기 배터리 프로파일 온라인 세팅 가이드'
                      : '예: Skyjack SJIII 3219 부품 매뉴얼 (Rev. 2024)'
                  }
                  value={manualFormTitle}
                  onChange={e => setManualFormTitle(e.target.value)}
                  required
                  style={{ padding: '8px', fontSize: '13px' }}
                />
              </div>

              {/* 미디어 유형별 입력 영역 */}
              {manualFormMediaType === 'PDF' ? (
                /* PDF 파일 업로드 */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold' }}>매뉴얼 문서 파일 (PDF 등) *</label>
                  <div
                    style={{
                      border: '2px dashed var(--border-color)',
                      borderRadius: '8px',
                      padding: '16px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      backgroundColor: 'var(--bg-main)'
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg"
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                    />
                    <UploadCloud size={28} style={{ color: 'var(--primary)', marginBottom: '6px' }} />
                    {manualFormFileName ? (
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--primary)' }}>
                        선택된 파일: {manualFormFileName} ({manualFormFileSizeLabel})
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        클릭하여 PDF 문서 또는 매뉴얼 파일 선택
                      </div>
                    )}
                  </div>
                </div>
              ) : manualFormMediaType === 'YOUTUBE' ? (
                /* 유튜브 동영상 등록 */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 'bold' }}>
                      유튜브 동영상 링크 (YouTube URL) *
                    </label>
                    <input
                      type="text"
                      placeholder="https://www.youtube.com/watch?v=... 또는 https://youtu.be/..."
                      value={manualFormExternalUrl}
                      onChange={e => setManualFormExternalUrl(e.target.value)}
                      required
                      style={{ padding: '8px', fontSize: '12.5px' }}
                    />
                  </div>

                  {/* 유튜브 비디오 ID 자동 감지 및 실시간 썸네일 미리보기 */}
                  {(() => {
                    const videoId = extractYoutubeVideoId(manualFormExternalUrl);
                    if (videoId) {
                      return (
                        <div
                          style={{
                            display: 'flex',
                            gap: '12px',
                            padding: '10px',
                            backgroundColor: '#eff6ff',
                            borderRadius: '6px',
                            border: '1px solid #bfdbfe',
                            alignItems: 'center'
                          }}
                        >
                          <img
                            src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                            alt="YouTube Thumbnail"
                            style={{ width: '100px', height: '56px', objectFit: 'cover', borderRadius: '4px' }}
                          />
                          <div style={{ fontSize: '11.5px', color: '#1e40af' }}>
                            <div style={{ fontWeight: 700 }}>🟢 유튜브 영상 ID 감지 완료</div>
                            <div>고유 ID: <strong>{videoId}</strong></div>
                            <div style={{ fontSize: '11px', color: '#3b82f6' }}>앱 내에서 직접 임베드 재생됩니다.</div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 'bold' }}>영상 러닝타임 (분 단위, 선택)</label>
                    <input
                      type="number"
                      placeholder="예: 8 (8분)"
                      value={manualFormDurationMinutes}
                      onChange={e => setManualFormDurationMinutes(e.target.value ? Number(e.target.value) : '')}
                      style={{ padding: '7px', fontSize: '12.5px' }}
                    />
                  </div>
                </div>
              ) : (
                /* 웹 기술문서 링크 등록 */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold' }}>웹페이지 링크 URL (Web Link) *</label>
                  <input
                    type="text"
                    placeholder="https://support.example.com/manuals/..."
                    value={manualFormExternalUrl}
                    onChange={e => setManualFormExternalUrl(e.target.value)}
                    required
                    style={{ padding: '8px', fontSize: '12.5px' }}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    제조사 기술지원 웹사이트 또는 온라인 매뉴얼 웹 주소를 입력하세요.
                  </span>
                </div>
              )}

              {/* 비고 및 요약 설명 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold' }}>비고 및 요약 설명</label>
                <textarea
                  rows={2}
                  placeholder="자료 주요 내용, 특이사항, 현장 정비/조치 시 참고 사항..."
                  value={manualFormMemo}
                  onChange={e => setManualFormMemo(e.target.value)}
                  style={{ padding: '7px', fontSize: '12px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsManualModalOpen(false)}
                  style={{ flex: 1, padding: '8px' }}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ flex: 1, padding: '8px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                >
                  <Save size={14} /> 자료 등록 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── [모달 3] 인앱 PDF/문서 미리보기 뷰어 모달 ─── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {previewManual && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
            padding: '20px'
          }}
        >
          <div
            className="card"
            style={{
              width: '95%',
              maxWidth: '960px',
              height: '85vh',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'var(--bg-card)',
              borderRadius: '12px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              overflow: 'hidden'
            }}
          >
            {/* 뷰어 헤더 */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 18px',
                borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-main)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {previewManual.mediaType === 'YOUTUBE' ? (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: '4px',
                      backgroundColor: '#fee2e2',
                      color: '#dc2626',
                      border: '1px solid #fecaca',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Youtube size={13} /> 유튜브 영상
                  </span>
                ) : previewManual.mediaType === 'WEB_LINK' ? (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: '4px',
                      backgroundColor: '#e0e7ff',
                      color: '#4338ca',
                      border: '1px solid #c7d2fe',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Globe size={12} /> 웹 기술문서
                  </span>
                ) : (
                  <span className={`badge ${getCategoryBadgeClass(previewManual.category)}`}>
                    {getCategoryLabel(previewManual.category)}
                  </span>
                )}
                <strong style={{ fontSize: '14px' }}>{previewManual.title}</strong>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>({previewManual.modelName})</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {previewManual.mediaType === 'YOUTUBE' ? (
                  <a
                    href={previewManual.externalUrl || previewManual.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary"
                    style={{
                      padding: '4px 10px',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      textDecoration: 'none',
                      color: '#dc2626'
                    }}
                  >
                    <ExternalLink size={13} /> YouTube 원본 열기
                  </a>
                ) : previewManual.mediaType === 'WEB_LINK' ? (
                  <a
                    href={previewManual.externalUrl || previewManual.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary"
                    style={{
                      padding: '4px 10px',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      textDecoration: 'none',
                      color: '#4338ca'
                    }}
                  >
                    <ExternalLink size={13} /> 새창에서 열기
                  </a>
                ) : (
                  <a
                    href={previewManual.fileUrl}
                    download={previewManual.fileName}
                    className="btn-secondary"
                    style={{
                      padding: '4px 10px',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      textDecoration: 'none'
                    }}
                  >
                    <Download size={13} /> 다운로드
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => setPreviewManual(null)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* 뷰어 본문 (멀티미디어 분기) */}
            <div style={{ flex: 1, backgroundColor: '#000000', overflow: 'hidden', position: 'relative' }}>
              {previewManual.mediaType === 'YOUTUBE' && previewManual.youtubeVideoId ? (
                /* 유튜브 반응형 임베드 플레이어 */
                <iframe
                  src={`https://www.youtube.com/embed/${previewManual.youtubeVideoId}?autoplay=1&rel=0`}
                  title={previewManual.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  style={{ width: '100%', height: '100%', border: 'none' }}
                />
              ) : previewManual.mediaType === 'WEB_LINK' ? (
                /* 웹 기술문서 인라인 또는 링크 안내 */
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'var(--bg-main)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '14px',
                    padding: '24px'
                  }}
                >
                  <Globe size={48} style={{ color: '#4338ca' }} />
                  <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-main)' }}>{previewManual.title}</div>
                  <p style={{ maxWidth: '480px', textAlign: 'center', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    {previewManual.memo || '보안 정책상 외부 웹사이트는 새 창에서 가장 쾌적하게 확인하실 수 있습니다.'}
                  </p>
                  <a
                    href={previewManual.externalUrl || previewManual.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary"
                    style={{ padding: '8px 18px', fontSize: '13px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <ExternalLink size={15} /> 새 창에서 공식 웹 기술문서 열기
                  </a>
                </div>
              ) : previewManual.fileUrl.startsWith('data:application/pdf') || previewManual.fileName.endsWith('.pdf') ? (
                /* PDF 인앱 뷰어 */
                <iframe
                  src={previewManual.fileUrl}
                  title={previewManual.title}
                  style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#333333' }}
                />
              ) : (
                /* 기타 파일 다운로드 안내 */
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    gap: '12px',
                    padding: '24px'
                  }}
                >
                  <FileText size={48} style={{ color: '#93c5fd' }} />
                  <div style={{ fontSize: '16px', fontWeight: 700 }}>{previewManual.title}</div>
                  <div style={{ fontSize: '13px', color: '#d1d5db' }}>
                    파일 형식: {previewManual.fileName} ({previewManual.fileSizeLabel || '0 KB'})
                  </div>
                  <p style={{ maxWidth: '500px', textAlign: 'center', fontSize: '12.5px', color: '#9ca3af' }}>
                    {previewManual.memo || '브라우저 내장 뷰어가 지원되지 않는 문서 형식입니다. [다운로드] 버튼을 눌러 원본 파일을 확인하세요.'}
                  </p>
                  <a
                    href={previewManual.fileUrl}
                    download={previewManual.fileName}
                    className="btn-primary"
                    style={{ padding: '8px 16px', fontSize: '13px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Download size={15} /> 로컬 다운로드 및 열기
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── [모달 4] 인앱 커스텀 삭제 확인 모달 (헌장 5.2) ─── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {confirmModal && confirmModal.isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
            padding: '20px'
          }}
        >
          <div
            className="card"
            style={{
              width: '90%',
              maxWidth: '440px',
              backgroundColor: 'var(--bg-card)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}
          >
            <h3
              style={{
                fontSize: '15px',
                fontWeight: 800,
                margin: 0,
                color: confirmModal.isDanger ? 'var(--danger)' : 'var(--text-main)'
              }}
            >
              {confirmModal.title}
            </h3>
            <div
              style={{
                fontSize: '12.5px',
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
                color: 'var(--text-secondary)'
              }}
            >
              {confirmModal.message}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                borderTop: '1px solid var(--border-color)',
                paddingTop: '10px'
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmModal(null)}
                style={{ padding: '6px 14px', fontSize: '12px' }}
              >
                취소
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={confirmModal.onConfirm}
                style={{
                  padding: '6px 16px',
                  fontSize: '12px',
                  backgroundColor: confirmModal.isDanger ? '#dc2626' : 'var(--primary)',
                  borderColor: confirmModal.isDanger ? '#dc2626' : 'var(--primary)'
                }}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── [모달 5] AI 메타데이터 색인 태그 편집 모달 (헌장 3.4) ─── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      {editingMetadataManual && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1150,
            padding: '20px'
          }}
        >
          <div
            className="card"
            style={{
              width: '90%',
              maxWidth: '560px',
              backgroundColor: 'var(--bg-card)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Tag size={16} style={{ color: 'var(--primary)' }} />
                  AI 메타데이터 색인 태그 편집
                </h3>
                <p style={{ margin: '3px 0 0 0', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                  [{editingMetadataManual.modelName}] {editingMetadataManual.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingMetadataManual(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveMetadataModal} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 상하 스택 1: AI 수록 요약 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                  AI 수록 요약 (트러블슈팅/정비 포인트)
                </label>
                <textarea
                  rows={3}
                  value={editAiSummaryInput}
                  onChange={e => setEditAiSummaryInput(e.target.value)}
                  placeholder="AI가 요약한 핵심 트러블슈팅 또는 매뉴얼 주요 점검 내용..."
                  style={{ width: '100%', padding: '8px', fontSize: '12px', lineHeight: '1.45', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                />
              </div>

              {/* 상하 스택 2: 에러코드 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                  진단 에러코드 (콤마로 구분)
                </label>
                <input
                  type="text"
                  value={editErrorCodesInput}
                  onChange={e => setEditErrorCodesInput(e.target.value)}
                  placeholder="예: 02, 18, LL, OL, 99"
                  style={{ width: '100%', padding: '7px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                />
              </div>

              {/* 상하 스택 3: 고장증상 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                  주요 고장증상 (콤마로 구분)
                </label>
                <input
                  type="text"
                  value={editSymptomsInput}
                  onChange={e => setEditSymptomsInput(e.target.value)}
                  placeholder="예: 상승 불가, 주행 모터 과열, 비상하강 작동불량"
                  style={{ width: '100%', padding: '7px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                />
              </div>

              {/* 상하 스택 4: 주요 부품 및 품번 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                  주요 부품 / 품번 (콤마로 구분)
                </label>
                <input
                  type="text"
                  value={editMajorPartsInput}
                  onChange={e => setEditMajorPartsInput(e.target.value)}
                  placeholder="예: 솔레노이드 밸브 103138, 조이스틱 159108, 릴리프 밸브"
                  style={{ width: '100%', padding: '7px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                />
              </div>

              {/* 상하 스택 5: 검색 키워드 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-main)' }}>
                  추천 검색 키워드 (콤마로 구분)
                </label>
                <input
                  type="text"
                  value={editKeywordsInput}
                  onChange={e => setEditKeywordsInput(e.target.value)}
                  placeholder="예: 스카이잭, 유압회로, 릴리프, 상승밸브"
                  style={{ width: '100%', padding: '7px 10px', fontSize: '12px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                />
              </div>

              {/* 모달 푸터 버튼군 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: '1px solid var(--border-color)',
                  paddingTop: '12px',
                  marginTop: '6px'
                }}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    if (!editingMetadataManual) return;
                    showToast('AI 분석 다시 실행 중...');
                    const res = await extractManualMetadataWithAI(editingMetadataManual);
                    setEditAiSummaryInput(res.aiSummary);
                    setEditErrorCodesInput(res.errorCodes.join(', '));
                    setEditSymptomsInput(res.symptoms.join(', '));
                    setEditMajorPartsInput(res.majorParts.join(', '));
                    setEditKeywordsInput(res.keywords.join(', '));
                    showToast('AI 메타데이터가 입력창에 다시 채워졌습니다.');
                  }}
                  style={{ padding: '6px 12px', fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '4px', color: '#ea580c' }}
                >
                  <Sparkles size={13} /> AI 자동 다시채우기
                </button>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setEditingMetadataManual(null)}
                    style={{ padding: '6px 14px', fontSize: '12px' }}
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    style={{ padding: '6px 16px', fontSize: '12px' }}
                  >
                    메타데이터 저장
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ─── [우하단 Gutenberg Z-패턴 4단계 최하단 대차대조식 바 (헌장 3.5)] ─── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 'var(--sidebar-width, 240px)',
          right: 0,
          height: '42px',
          backgroundColor: 'var(--bg-card)',
          borderTop: '2px solid var(--primary)',
          boxShadow: '0 -2px 10px rgba(0,0,0,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          zIndex: 99,
          fontSize: '11.5px',
          fontWeight: 600
        }}
      >
        {activeTab === 'MASTER' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
            <span>🛠️ <strong>정비점검항목:</strong> {masterAuditSummary.totalCount}개</span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span>📂 <strong>관리분류:</strong> {masterAuditSummary.categoryCount}개 카테고리</span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span style={{ color: 'var(--warning)' }}>⭐ <strong>배점총합:</strong> {masterAuditSummary.totalScore}점 (평균 {masterAuditSummary.avgScore}점)</span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span>⏱️ <strong>표준공수 총계:</strong> {masterAuditSummary.totalManHours} M/H</span>
          </div>
        )}

        {activeTab === 'ANALYTICS' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
            <span>📄 <strong>정비총비용:</strong> ₩{analyticsData.grandTotalCost.toLocaleString()}</span>
            <span style={{ color: 'var(--border-color)' }}>=</span>
            <span style={{ color: '#16a34a' }}>🟢 <strong>소모품비:</strong> ₩{analyticsData.grandPartCost.toLocaleString()}</span>
            <span>+</span>
            <span style={{ color: '#d97706' }}>🏢 <strong>외주비:</strong> ₩{analyticsData.grandExternalCost.toLocaleString()}</span>
            <span style={{ color: 'var(--border-color)' }}>=</span>
            <span style={{ color: '#2563eb' }}>🟢 <strong>고객청구:</strong> ₩{analyticsData.grandBillableAmount.toLocaleString()}</span>
            <span>+</span>
            <span style={{ color: '#dc2626' }}>🔴 <strong>회사순부담:</strong> ₩{analyticsData.grandCompanyCost.toLocaleString()}</span>
          </div>
        )}

        {activeTab === 'MANUALS' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
            <span>📚 <strong>매뉴얼 총계:</strong> {manualSummary.total}건</span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span style={{ color: '#16a34a' }}>🟢 <strong>AI 색인완료:</strong> {manualSummary.aiIndexedCount}건</span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span style={{ color: manualSummary.aiPendingCount > 0 ? '#ea580c' : 'var(--text-muted)' }}>
              🟡 <strong>AI 분석대기:</strong> {manualSummary.aiPendingCount}건
            </span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span>파츠북 {manualSummary.partsBookCount}건</span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span>에러코드 {manualSummary.errorCodeCount}건</span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span>회로도 {manualSummary.wiringCount}건</span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span>취급설명서 {manualSummary.operatorCount}건</span>
          </div>
        )}

        {/* 우측 종단 확정 배지 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '4px',
              backgroundColor: 'var(--success-light)',
              color: 'var(--success)',
              fontWeight: 700,
              fontSize: '11px',
              whiteSpace: 'nowrap'
            }}
          >
            {activeTab === 'ANALYTICS'
              ? `⚖️ 대차 차액 ₩${analyticsData.balanceDiff.toLocaleString()} (무결)`
              : '⚖️ 데이터 무결 보존'}
          </span>
        </div>
      </div>

      <div style={{ height: '50px' }} aria-hidden="true" />
    </div>
  );
};