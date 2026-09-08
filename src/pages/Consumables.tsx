// d:\Kiyeun_Lift\src\pages\Consumables.tsx
import React, { useState, useRef, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { 
  ShoppingCart, Hammer, ListCollapse, Layers, Plus, ClipboardList, PackagePlus, 
  CheckCircle2, XCircle, Search, Download, FileText, Camera, Upload, RefreshCw, 
  Truck, ArrowRightLeft, ArrowUpRight, ArrowDownLeft, User, ShieldCheck, X,
  FileCheck, AlertOctagon, CheckSquare, Boxes, Archive, AlertTriangle, Edit, Trash2
} from 'lucide-react';
import { exportToExcel } from '../services/excel';
import { Consumable, MechanicConsumableStock, StocktakingAudit, StocktakingAuditItem, CollectedPart, db } from '../services/db';
import { compressFileIfNeeded } from '../utils/imageCompressor';
import { uploadToSupabaseStorage } from '../services/supabaseStorage';

export const Consumables: React.FC = () => {
  const {
    consumables, consumableLogs, consumablePurchases, mechanicConsumableStocks, assets, purchaseConsumable, useConsumable,
    transferConsumableToMechanic, returnConsumableToHq, transferConsumableBetweenMechanics, addConsumable, updateConsumable, deleteConsumable,
    stocktakingAudits, stocktakingAuditItems, collectedParts,
    createStocktakingAudit, updateStocktakingItem, confirmStocktakingAudit, cancelStocktakingAudit, processCollectedPart,
    requestConsumablePurchase, acceptConsumablePurchase, completeConsumablePurchase, inboundConsumablePurchase,
    hasPermission, users, currentUser, showErrorModal
  } = useApp();

  const canSave = hasPermission('consumable', 'save');
  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // ─── [Gutenberg Z-패턴 4단계 최하단 재고/원가 대차대조식 검증] ───
  const hqStockSummary = useMemo(() => {
    const totalKinds = consumables.length;
    const totalQty = consumables.reduce((acc, c) => acc + (c.stockQty || 0), 0);
    const totalValue = consumables.reduce((acc, c) => acc + (c.stockQty || 0) * (c.unitPrice || 0), 0);
    return { totalKinds, totalQty, totalValue };
  }, [consumables]);

  const vehicleStockSummary = useMemo(() => {
    const totalQty = (mechanicConsumableStocks || []).reduce((acc, s) => acc + (s.stockQty || 0), 0);
    const totalValue = (mechanicConsumableStocks || []).reduce((acc, s) => {
      const c = consumables.find(item => item.id === s.consumableId);
      return acc + (s.stockQty || 0) * (c?.unitPrice || 0);
    }, 0);
    return { totalQty, totalValue };
  }, [mechanicConsumableStocks, consumables]);

  const monthlyPurchaseSummary = useMemo(() => {
    const ym = new Date().toISOString().substring(0, 7);
    const thisMonthPurchases = consumablePurchases.filter(p => p.status === 'COMPLETED' && p.completedDate?.startsWith(ym));
    const totalCount = thisMonthPurchases.length;
    const totalAmount = thisMonthPurchases.reduce((acc, p) => acc + (p.receivedQty || p.requestedQty) * (p.unitPrice || 0), 0);
    return { totalCount, totalAmount };
  }, [consumablePurchases]);

  const monthlyUseSummary = useMemo(() => {
    const ym = new Date().toISOString().substring(0, 7);
    const thisMonthLogs = consumableLogs.filter(l => l.type === 'OUTBOUND' && l.actionDate?.startsWith(ym));
    const totalCount = thisMonthLogs.length;
    const totalAmount = thisMonthLogs.reduce((acc, l) => acc + (l.quantity * (l.unitPrice || 0)), 0);
    return { totalCount, totalAmount };
  }, [consumableLogs]);
  // 탭 구성: STOCK (본사 재고), VEHICLE_STOCK (차량별 이동재고), STOCKTAKING (재고 실사), COLLECTED_PARTS (고품 관리), REQ_LIST (신청 내역 조회), REQ_WRITE (구매신청 작성), REQ_INBOUND (구매물품 입고처리), USE (소모품 사용), LOGS (입출고 로그)
  const [activeTab, setActiveTab] = useState<'STOCK' | 'VEHICLE_STOCK' | 'STOCKTAKING' | 'COLLECTED_PARTS' | 'REQ_LIST' | 'REQ_WRITE' | 'REQ_INBOUND' | 'USE' | 'LOGS'>('STOCK');

  // --- [신규] 재고 실사 스튜디오 상태 ---
  const [selectedAuditId, setSelectedAuditId] = useState<string>('');
  const [auditTargetFilter, setAuditTargetFilter] = useState<'ALL' | 'HQ' | 'VEHICLE'>('ALL');
  const [auditStatusFilter, setAuditStatusFilter] = useState<'ALL' | 'DRAFT' | 'CONFIRMED' | 'CANCELLED'>('ALL');
  const [showCreateAuditModal, setShowCreateAuditModal] = useState<boolean>(false);
  const [newAuditTargetType, setNewAuditTargetType] = useState<'HQ' | 'VEHICLE'>('HQ');
  const [newAuditMechanicId, setNewAuditMechanicId] = useState<string>('');
  const [newAuditMemo, setNewAuditMemo] = useState<string>('');
  const [auditItemSearch, setAuditItemSearch] = useState<string>('');

  // --- [신규] 수거 고품 관리 상태 ---
  const [partDispositionFilter, setPartDispositionFilter] = useState<'ALL' | 'REBUILD' | 'SCRAP' | 'VENDOR_WARRANTY'>('ALL');
  const [partStatusFilter, setPartStatusFilter] = useState<'ALL' | 'RECEIVED' | 'IN_PROCESS' | 'COMPLETED'>('ALL');
  const [partSearch, setPartSearch] = useState<string>('');

  // --- [신규] 차량 간(P2P) 이동 모달 상태 ---
  const [showP2PModal, setShowP2PModal] = useState<boolean>(false);
  const [p2pFromMechanicId, setP2pFromMechanicId] = useState<string>('');
  const [p2pToMechanicId, setP2pToMechanicId] = useState<string>('');
  const [p2pConsumableId, setP2pConsumableId] = useState<string>('');
  const [p2pQty, setP2pQty] = useState<number>(1);
  const [p2pMemo, setP2pMemo] = useState<string>('');

  // --- [신규] 차량 반납 모달 내 고품 격리 상태 ---
  const [isReturnDefective, setIsReturnDefective] = useState<boolean>(false);
  const [returnDisposition, setReturnDisposition] = useState<'REBUILD' | 'SCRAP' | 'VENDOR_WARRANTY'>('REBUILD');

  // --- [1] 구매신청 조회용 필터 상태 ---
  const [reqSearchTerm, setReqSearchTerm] = useState('');
  const [reqStatusFilter, setReqStatusFilter] = useState<'ALL' | 'INCOMPLETE' | 'COMPLETED'>('ALL');
  const thisMonthStart = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; })();
  const thisMonthEnd   = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()).padStart(2,'0')}`; })();
  const [reqStartDate, setReqStartDate] = useState(thisMonthStart);
  const [reqEndDate, setReqEndDate] = useState(thisMonthEnd);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusQuery, setStatusQuery] = useState<'ALL' | 'INCOMPLETE' | 'COMPLETED'>('ALL');
  const [startDateQuery, setStartDateQuery] = useState(thisMonthStart);
  const [endDateQuery, setEndDateQuery] = useState(thisMonthEnd);
  const [userQuery, setUserQuery] = useState('ALL');

  // --- [1.1] 추가 필터 상태 ---
  const [reqUserFilter, setReqUserFilter] = useState('ALL');
  const [stockSearch, setStockSearch] = useState('');
  const [vehicleStockSearch, setVehicleStockSearch] = useState('');
  const [selectedMechanicFilter, setSelectedMechanicFilter] = useState('ALL');
  const [logTypeFilter, setLogTypeFilter] = useState('ALL');
  const [logStartDate, setLogStartDate] = useState('');
  const [logEndDate, setLogEndDate] = useState('');
  const [logSearch, setLogSearch] = useState('');

  // --- [2] 구매신청 작성(Write) 폼 상태 ---
  const [reqConsumableId, setReqConsumableId] = useState('');
  const [reqModelName, setReqModelName] = useState('');
  const [reqQty, setReqQty] = useState(1);
  const [reqUnitPrice, setReqUnitPrice] = useState(0);
  const [reqDate, setReqDate] = useState(new Date().toISOString().split('T')[0]);
  const [reqSellerName, setReqSellerName] = useState('');

  // --- [3] 입고처리(Inbound) 폼 상태 ---
  const [selectedReqId, setSelectedReqId] = useState('');
  const [inboundQty, setInboundQty] = useState(1);
  const [uploadMethod, setUploadMethod] = useState<'PC' | 'MOBILE'>('PC');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [noInvoice, setNoInvoice] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // --- [4] 소모품 사용(Use) 폼 상태 ---
  const [useConsumableId, setUseConsumableId] = useState('');
  const [useQty, setUseQty] = useState(1);
  const [useAssetId, setUseAssetId] = useState('');
  const [useDesc, setUseDesc] = useState('');

  // --- [5] 증빙 미리보기 상태 ---
  const [previewRequest, setPreviewRequest] = useState<any | null>(null);

  // --- [6] 차량 재고 이동 모달 상태 ---
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferMechanicId, setTransferMechanicId] = useState('');
  const [transferConsumableId, setTransferConsumableId] = useState('');
  const [transferQty, setTransferQty] = useState(1);
  const [transferMemo, setTransferMemo] = useState('');

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnMechanicId, setReturnMechanicId] = useState('');
  const [returnConsumableId, setReturnConsumableId] = useState('');
  const [returnQty, setReturnQty] = useState(1);
  const [returnMemo, setReturnMemo] = useState('');

  // --- [7] 품목 마스터 관리 모달 상태 ---
  const [showMasterModal, setShowMasterModal] = useState(false);
  const [masterEditingId, setMasterEditingId] = useState<string | null>(null);
  const [masterModelName, setMasterModelName] = useState('');
  const [masterUnit, setMasterUnit] = useState('개');
  const [masterUnitPrice, setMasterUnitPrice] = useState(0);
  const [masterSupplier, setMasterSupplier] = useState('');
  const [masterInitialStockQty, setMasterInitialStockQty] = useState(0);

  const mechanics = users.filter(u => u.role === 'MECHANIC' || u.role === 'ADMIN' || u.role === 'MANAGER');

  const getUserName = (id?: string) => {
    if (!id) return '시스템';
    return users.find(u => u.id === id)?.name || '정비 담당자';
  };

  const getAssetNo = (id?: string) => {
    if (!id) return '-';
    return assets.find(a => a.id === id)?.assetNo || '-';
  };

  // --- 엑셀 다운로드 핸들러 ---
  const handleExportStock = () => {
    const excelData = consumables.map((c, idx) => {
      const logs = consumableLogs.filter(l => l.consumableId === c.id);
      const totalUsed = logs.filter(l => l.type === 'OUTBOUND').reduce((sum, l) => sum + l.quantity, 0);
      const totalTransferred = logs.filter(l => l.type === 'TRANSFER_TO_VEHICLE').reduce((sum, l) => sum + l.quantity, 0);
      const totalReturned = logs.filter(l => l.type === 'RETURN_TO_HQ').reduce((sum, l) => sum + l.quantity, 0);

      // 전체 차량에 적재된 재고 수량
      const totalVehicleQty = (mechanicConsumableStocks || []).filter(ms => ms.consumableId === c.id).reduce((sum, ms) => sum + ms.stockQty, 0);

      return {
        'No': idx + 1,
        '자재 품목명': c.modelName,
        '본사 중앙 재고': c.stockQty,
        '차량 이동 재고': totalVehicleQty,
        '전사 총 재고': c.stockQty + totalVehicleQty,
        '단위': c.unit,
        '단가': `${c.unitPrice.toLocaleString()}원`,
        '본사 재고평가액': `${(c.stockQty * c.unitPrice).toLocaleString()}원`,
        '차량 재고평가액': `${(totalVehicleQty * c.unitPrice).toLocaleString()}원`,
        '총 재고평가액': `${((c.stockQty + totalVehicleQty) * c.unitPrice).toLocaleString()}원`,
        '최근 구입처': c.supplier || '-'
      };
    });

    exportToExcel(excelData, `소모품재고대장_${new Date().toISOString().split('T')[0]}`, '소모품재고');
  };

  const handleExportVehicleStock = () => {
    const excelData = (mechanicConsumableStocks || []).map((ms, idx) => {
      const item = consumables.find(c => c.id === ms.consumableId);
      const mechanic = users.find(u => u.id === ms.mechanicId);
      return {
        'No': idx + 1,
        '담당 정비사': mechanic?.name || '정비사',
        '자재 품목명': item?.modelName || '-',
        '차량 적재 수량': ms.stockQty,
        '단위': item?.unit || '개',
        '단가': `${(item?.unitPrice || 0).toLocaleString()}원`,
        '평가액': `${(ms.stockQty * (item?.unitPrice || 0)).toLocaleString()}원`,
        '최종 변경일': ms.updatedAt
      };
    });

    exportToExcel(excelData, `차량별소모품이동재고_${new Date().toISOString().split('T')[0]}`, '차량재고');
  };

  const handleExportLogs = () => {
    const excelData = consumableLogs.map((l, idx) => {
      const item = consumables.find(c => c.id === l.consumableId);
      return {
        'No': idx + 1,
        '구분': l.type === 'INBOUND' ? '구매입고' :
                l.type === 'OUTBOUND' ? '현장소진(출고)' :
                l.type === 'TRANSFER_TO_VEHICLE' ? '차량불출' :
                l.type === 'RETURN_TO_HQ' ? '본사반납' : '재고조정',
        '품목명': item?.modelName || '삭제된 품목',
        '수량': l.quantity,
        '단가': `${l.unitPrice.toLocaleString()}원`,
        '금액': `${(l.quantity * l.unitPrice).toLocaleString()}원`,
        '출처': l.fromLocation || (l.type === 'INBOUND' ? (l.supplier || '매입처') : '본사 중앙창고'),
        '이동처/적용': l.toLocation || (l.targetAssetId ? `자산(${getAssetNo(l.targetAssetId)})` : '-'),
        '담당자': getUserName(l.userId || l.mechanicId),
        '일자': l.actionDate,
        '상세 내용': l.description
      };
    });

    exportToExcel(excelData, `소모품입출고이력_${new Date().toISOString().split('T')[0]}`, '입출고이력');
  };

  // --- 구매신청 필터 연동 ---
  const getFilteredPurchases = () => {
    return consumablePurchases.filter(p => {
      const matchesSearch = p.modelName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            p.sellerName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusQuery === 'ALL' ? true :
                            statusQuery === 'COMPLETED' ? p.status === 'COMPLETED' :
                            p.status !== 'COMPLETED';
      const matchesStart = !startDateQuery || p.requestDate >= startDateQuery;
      const matchesEnd = !endDateQuery || p.requestDate <= endDateQuery;
      const matchesUser = userQuery === 'ALL' || p.requesterId === userQuery;

      return matchesSearch && matchesStatus && matchesStart && matchesEnd && matchesUser;
    });
  };

  // --- 구매신청서 작성 제출 ---
  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    
    const finalModelName = reqConsumableId === 'NEW' ? reqModelName : (consumables.find(c => c.id === reqConsumableId)?.modelName || '');
    if (!finalModelName || reqQty <= 0 || reqUnitPrice < 0 || !reqSellerName) {
      showToast('신청 품명, 수량, 단가 및 판매처를 올바르게 지정해 주세요.', 'error');
      return;
    }

    try {
      await requestConsumablePurchase({
        consumableId: reqConsumableId !== 'NEW' ? reqConsumableId : undefined,
        modelName: finalModelName,
        qty: reqQty,
        unitPrice: reqUnitPrice,
        requestDate: reqDate,
        sellerName: reqSellerName
      });

      await db.awaitPendingWrites();
      showToast('소모품 구매 신청서가 성공적으로 제출 및 저장되었습니다.');
      setReqConsumableId('');
      setReqModelName('');
      setReqQty(1);
      setReqUnitPrice(0);
      setReqSellerName('');
      setActiveTab('REQ_LIST');
    } catch (err: any) {
      showErrorModal(`⚠️ 소모품 구매신청 저장 중 오류가 발생했습니다:\n\n${err?.message || err}`, '구매신청 저장 오류');
    }
  };

  // --- 입고 확정 처리 ---
  const handleInboundConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (!selectedReqId || inboundQty <= 0) {
      showToast('입고할 신청건을 선택하고 입고 수량을 지정해 주세요.', 'error');
      return;
    }
    if (!selectedFile && !noInvoice) {
      showToast('공급자 거래명세서 증빙 파일을 먼저 지정해 주세요.', 'error');
      return;
    }

    setIsUploading(true);
    const targetReq = consumablePurchases.find(p => p.id === selectedReqId);
    const purchaseNo = targetReq ? targetReq.id.toUpperCase() : `CPR-${new Date().getTime()}`;
    const rawExt = selectedFile ? (selectedFile.name.split('.').pop()?.toLowerCase() || 'jpg') : 'jpg';
    const newFileName = `${purchaseNo}.${rawExt}`;

    try {
      let uploadedUrl = '';
      if (selectedFile) {
        const compressed = await compressFileIfNeeded(selectedFile);
        const base64Response = await fetch(compressed.base64);
        const uploadBlob = await base64Response.blob();
        const uploadFile = new File([uploadBlob], newFileName, { type: compressed.mimeType });

        const storageResult = await uploadToSupabaseStorage({
          file: uploadFile,
          folder: 'consumables',
          fileName: newFileName
        });

        if (!storageResult.success || !storageResult.fileUrl) {
          throw new Error(storageResult.message || '스토리지 업로드에 실패했습니다.');
        }
        uploadedUrl = storageResult.fileUrl;
      }

      await inboundConsumablePurchase(selectedReqId, inboundQty, uploadedUrl);
      await db.awaitPendingWrites();
      showToast('입고 처리가 완료되었습니다. 본사 중앙 창고 재고에 반영되었습니다.');
      setSelectedReqId('');
      setInboundQty(1);
      setSelectedFile(null);
      setActiveTab('STOCK');
    } catch (err: any) {
      showErrorModal(`⚠️ 입고 처리 중 오류가 발생했습니다:\n\n${err?.message || err}`, '입고 처리 오류');
    } finally {
      setIsUploading(false);
    }
  };

  // --- 본사 ➔ 차량 불출 제출 ---
  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferMechanicId || !transferConsumableId || transferQty <= 0) {
      showToast('정비사와 소모품 품목, 불출 수량을 선택해 주세요.', 'error');
      return;
    }
    const targetItem = consumables.find(c => c.id === transferConsumableId);
    if (!targetItem) return;
    const clampedQty = Math.max(1, transferQty);
    if (clampedQty > targetItem.stockQty) {
      showErrorModal(`불출 요청 수량(${clampedQty}개)이 본사 가용 재고(${targetItem.stockQty}개)를 초과할 수 없습니다.`);
      return;
    }

    try {
      await transferConsumableToMechanic(transferMechanicId, transferConsumableId, clampedQty, transferMemo);
      await db.awaitPendingWrites();
      showToast('본사 창고에서 정비사 차량으로 소모품 불출 이동이 완료되었습니다.');
      setShowTransferModal(false);
      setTransferQty(1);
      setTransferMemo('');
    } catch (err: any) {
      showErrorModal(err?.message || '소모품 불출 이동 중 오류가 발생했습니다.');
    }
  };

  // --- 차량 ➔ 본사 반납 제출 ---
  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnMechanicId || !returnConsumableId || returnQty <= 0) {
      showToast('정비사와 반납 소모품 품목, 반납 수량을 선택해 주세요.', 'error');
      return;
    }
    const currentVehicleStock = (mechanicConsumableStocks || []).find(
      ms => ms.mechanicId === returnMechanicId && ms.consumableId === returnConsumableId
    )?.stockQty || 0;
    const clampedQty = Math.max(1, returnQty);
    if (clampedQty > currentVehicleStock) {
      showErrorModal(`반납 요청 수량(${clampedQty}개)이 정비사 차량 보유 재고(${currentVehicleStock}개)를 초과할 수 없습니다.`);
      return;
    }

    try {
      await returnConsumableToHq(returnMechanicId, returnConsumableId, clampedQty, returnMemo, isReturnDefective, returnDisposition);
      await db.awaitPendingWrites();
      showToast(isReturnDefective 
        ? `수거 고품(${returnDisposition === 'REBUILD' ? '재생' : returnDisposition === 'SCRAP' ? '폐기' : '무상보증'}) 반납 격리 처리가 완료되었습니다.`
        : '정비사 차량에서 본사 창고로 정상 소모품 반납이 완료되었습니다.');
      setShowReturnModal(false);
      setReturnQty(1);
      setReturnMemo('');
      setIsReturnDefective(false);
      setReturnDisposition('REBUILD');
    } catch (err: any) {
      showErrorModal(err?.message || '소모품 반납 중 오류가 발생했습니다.');
    }
  };

  // --- 차량 ➔ 차량(P2P) 이동 제출 ---
  const handleP2PSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!p2pFromMechanicId || !p2pToMechanicId || !p2pConsumableId || p2pQty <= 0) {
      showToast('양도/양수 정비사 및 부품, 수량을 올바르게 지정해 주세요.', 'error');
      return;
    }
    if (p2pFromMechanicId === p2pToMechanicId) {
      showToast('동일한 정비사 간에는 이동할 수 없습니다.', 'error');
      return;
    }
    const fromStock = (mechanicConsumableStocks || []).find(
      ms => ms.mechanicId === p2pFromMechanicId && ms.consumableId === p2pConsumableId
    )?.stockQty || 0;
    if (p2pQty > fromStock) {
      showErrorModal(`양도 정비사 차량의 보유 재고(${fromStock}개)를 초과할 수 없습니다.`);
      return;
    }

    try {
      await transferConsumableBetweenMechanics(p2pFromMechanicId, p2pToMechanicId, p2pConsumableId, p2pQty, p2pMemo);
      await db.awaitPendingWrites();
      showToast('정비사 차량 간 부품 융통 이동이 성공적으로 완료되었습니다.');
      setShowP2PModal(false);
      setP2pQty(1);
      setP2pMemo('');
    } catch (err: any) {
      showErrorModal(err?.message || '차량 간 부품 이동 중 오류가 발생했습니다.');
    }
  };

  // --- 신규 실사 전표 생성 제출 ---
  const handleCreateAuditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (newAuditTargetType === 'VEHICLE' && !newAuditMechanicId) {
      showToast('차량 실사의 경우 담당 정비사를 선택해 주세요.', 'error');
      return;
    }

    try {
      const newAudit = await createStocktakingAudit(newAuditTargetType, newAuditTargetType === 'VEHICLE' ? newAuditMechanicId : undefined, newAuditMemo);
      await db.awaitPendingWrites();
      showToast(`재고실사 전표(${newAudit.auditNo})가 성공적으로 생성되었습니다.`);
      setSelectedAuditId(newAudit.id);
      setShowCreateAuditModal(false);
      setNewAuditMemo('');
    } catch (err: any) {
      showErrorModal(`⚠️ 실사 전표 생성 실패:\n${err?.message || err}`);
    }
  };

  // --- 실사 품목 수량 인라인 수정 핸들러 ---
  const handleAuditItemQtyChange = async (itemId: string, newActualQty: number, diffReason?: StocktakingAuditItem['diffReason'], note?: string) => {
    if (!selectedAuditId) return;
    try {
      await updateStocktakingItem(selectedAuditId, itemId, newActualQty, diffReason, note);
    } catch (err: any) {
      showToast(err?.message || '수량 반영 실패', 'error');
    }
  };

  // --- 실사 확정 및 전산재고 강제 반영 핸들러 ---
  const handleConfirmAudit = async (auditId: string) => {
    if (!canSave) return;
    try {
      await confirmStocktakingAudit(auditId);
      await db.awaitPendingWrites();
      showToast('재고 실사가 최종 확정되어 전산 재고가 강제 보정되었습니다.');
    } catch (err: any) {
      showErrorModal(`⚠️ 실사 확정 실패:\n${err?.message || err}`);
    }
  };

  // --- 실사 취소 핸들러 ---
  const handleCancelAudit = async (auditId: string) => {
    if (!canSave) return;
    try {
      await cancelStocktakingAudit(auditId);
      await db.awaitPendingWrites();
      showToast('실사 전표가 취소되었습니다.');
    } catch (err: any) {
      showErrorModal(`⚠️ 실사 취소 실패:\n${err?.message || err}`);
    }
  };

  // --- 수거 고품 처리 상태 변경 핸들러 ---
  const handleProcessCollectedPart = async (partId: string, actionStatus: 'IN_PROCESS' | 'COMPLETED', actionMemo?: string) => {
    if (!canSave) return;
    try {
      await processCollectedPart(partId, actionStatus, actionMemo);
      await db.awaitPendingWrites();
      showToast(`고품 상태가 '${actionStatus === 'COMPLETED' ? '완료' : '처리중'}'으로 갱신되었습니다.`);
    } catch (err: any) {
      showErrorModal(`⚠️ 고품 상태 갱신 실패:\n${err?.message || err}`);
    }
  };

  // --- 소모품 수동 출고 ---
  const handleUseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (!useConsumableId || useQty <= 0) {
      showToast('사용할 품목과 수량을 확인해 주세요.', 'error');
      return;
    }

    const item = consumables.find(c => c.id === useConsumableId);
    if (!item || item.stockQty < useQty) {
      showToast('본사 중앙 재고가 부족합니다.', 'error');
      return;
    }

    try {
      await useConsumable({
        consumableId: useConsumableId,
        quantity: useQty,
        targetAssetId: useAssetId,
        description: useDesc || '일반 야적장 정비 사용'
      });

      await db.awaitPendingWrites();
      showToast('소모품 출고 및 자산 정비비용 누적이 완료되었습니다.');
      setUseConsumableId('');
      setUseQty(1);
      setUseAssetId('');
      setUseDesc('');
      setActiveTab('STOCK');
    } catch (err: any) {
      showErrorModal(`⚠️ 소모품 출고 오류:\n${err?.message || err}`);
    }
  };
  // --- 품목 마스터 CRUD 핸들러 ---
  const openCreateMaster = () => {
    setMasterEditingId(null);
    setMasterModelName('');
    setMasterUnit('개');
    setMasterUnitPrice(0);
    setMasterSupplier('');
    setMasterInitialStockQty(0);
    setShowMasterModal(true);
  };

  const openEditMaster = (item: Consumable) => {
    setMasterEditingId(item.id);
    setMasterModelName(item.modelName);
    setMasterUnit(item.unit || '개');
    setMasterUnitPrice(item.unitPrice || 0);
    setMasterSupplier(item.supplier || '');
    setMasterInitialStockQty(item.stockQty || 0);
    setShowMasterModal(true);
  };

  const handleSaveMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterModelName.trim()) {
      showToast('품목명을 입력해 주세요.', 'error');
      return;
    }
    try {
      if (masterEditingId) {
        await updateConsumable(masterEditingId, {
          modelName: masterModelName,
          unit: masterUnit,
          unitPrice: masterUnitPrice,
          supplier: masterSupplier,
        });
        showToast('품목 마스터가 성공적으로 수정되었습니다.');
      } else {
        await addConsumable({
          modelName: masterModelName,
          unit: masterUnit,
          unitPrice: masterUnitPrice,
          supplier: masterSupplier,
          stockQty: masterInitialStockQty
        });
        showToast('신규 품목 마스터가 성공적으로 등록되었습니다.');
      }
      setShowMasterModal(false);
    } catch (err: any) {
      showErrorModal(`⚠️ 품목 저장 실패:\n${err?.message || err}`);
    }
  };

  const handleDeleteMaster = async (id: string, modelName: string) => {
    if (!window.confirm(`정말 '${modelName}' 품목을 삭제하시겠습니까?\n주의: 수불 이력이나 잔여 재고가 있으면 삭제가 거부될 수 있습니다.`)) return;
    try {
      await deleteConsumable(id);
      showToast('품목이 성공적으로 삭제되었습니다.');
    } catch (err: any) {
      showErrorModal(`⚠️ 삭제 실패:\n${err?.message || err}`);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* 🔔 인앱 토스트 알림 (헌장 5.2) */}
      {toastMessage && (
        <div style={{
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
        }}>
          {toastMessage.text}
        </div>
      )}
      {/* 상단 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ fontWeight: '800', margin: 0 }}>소모품 수불 관리</h2>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            본사 창고 및 정비 차량 2-Tier 재고 수불 대장
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {activeTab === 'STOCK' && (
            <button className="btn-secondary" onClick={handleExportStock} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Download size={14} /> 본사재고 엑셀
            </button>
          )}
          {activeTab === 'VEHICLE_STOCK' && (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="btn-primary" onClick={() => {
                setTransferMechanicId(mechanics[0]?.id || '');
                setTransferConsumableId(consumables[0]?.id || '');
                setShowTransferModal(true);
              }} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ArrowUpRight size={14} /> 본사 ➔ 차량 불출
              </button>
              <button className="btn-secondary" onClick={() => {
                const stockWithQty = (mechanicConsumableStocks || []).find(ms => ms.stockQty > 0);
                if (stockWithQty) {
                  setReturnMechanicId(stockWithQty.mechanicId);
                  setReturnConsumableId(stockWithQty.consumableId);
                } else {
                  setReturnMechanicId(mechanics[0]?.id || '');
                  setReturnConsumableId(consumables[0]?.id || '');
                }
                setIsReturnDefective(false);
                setReturnDisposition('REBUILD');
                setShowReturnModal(true);
              }} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ArrowDownLeft size={14} /> 차량 ➔ 본사 반납
              </button>
              <button className="btn-secondary" onClick={() => {
                setP2pFromMechanicId(mechanics[0]?.id || '');
                setP2pToMechanicId(mechanics[1]?.id || mechanics[0]?.id || '');
                const firstAvailable = (mechanicConsumableStocks || []).find(ms => ms.mechanicId === (mechanics[0]?.id || '') && ms.stockQty > 0);
                setP2pConsumableId(firstAvailable?.consumableId || consumables[0]?.id || '');
                setShowP2PModal(true);
              }} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ArrowRightLeft size={14} /> 차량 ➔ 차량 이동 (P2P)
              </button>
              <button className="btn-secondary" onClick={handleExportVehicleStock} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Download size={14} /> 차량재고 엑셀
              </button>
            </div>
          )}
          {activeTab === 'STOCKTAKING' && (
            <div style={{ display: 'flex', gap: '6px' }}>
              {canSave && (
                <button className="btn-primary" onClick={() => {
                  setNewAuditTargetType('HQ');
                  setNewAuditMechanicId(mechanics[0]?.id || '');
                  setNewAuditMemo('');
                  setShowCreateAuditModal(true);
                }} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Plus size={14} /> 새 실사 전표 생성
                </button>
              )}
            </div>
          )}
          {activeTab === 'LOGS' && (
            <button className="btn-secondary" onClick={handleExportLogs} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Download size={14} /> 수불이력 엑셀
            </button>
          )}
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid var(--border)', marginBottom: '24px' }}>
        <button
          className={activeTab === 'STOCK' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('STOCK')}
          style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <Layers size={14} /> 본사 재고
        </button>
        <button
          className={activeTab === 'VEHICLE_STOCK' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('VEHICLE_STOCK')}
          style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }}
        >
          <Truck size={14} /> 차량 이동 재고
        </button>
        <button
          className={activeTab === 'STOCKTAKING' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('STOCKTAKING')}
          style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <CheckSquare size={14} /> 재고 실사
        </button>
        <button
          className={activeTab === 'COLLECTED_PARTS' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('COLLECTED_PARTS')}
          style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <Archive size={14} /> 고품 관리
        </button>
        <button
          className={activeTab === 'REQ_LIST' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('REQ_LIST')}
          style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <ClipboardList size={14} /> 구매 신청 대장
        </button>
        {canSave && (
          <>
            <button
              className={activeTab === 'REQ_WRITE' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setActiveTab('REQ_WRITE')}
              style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Plus size={14} /> 구매 신청 등록
            </button>
            <button
              className={activeTab === 'REQ_INBOUND' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setActiveTab('REQ_INBOUND')}
              style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <PackagePlus size={14} /> 입고 처리
            </button>
            <button
              className={activeTab === 'USE' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setActiveTab('USE')}
              style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <Hammer size={14} /> 소모품 출고
            </button>
          </>
        )}
        <button
          className={activeTab === 'LOGS' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('LOGS')}
          style={{ padding: '8px 14px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <ListCollapse size={14} /> 입출고 수불 이력
        </button>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [TAB 1] 본사 중앙 재고 현황 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'STOCK' && (
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 className="card-title">본사 중앙 창고 재고 현황</h3>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {canSave && (
                <button className="btn-primary" onClick={openCreateMaster} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Plus size={14} /> 신규 품목 등록
                </button>
              )}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={stockSearch}
                  onChange={e => setStockSearch(e.target.value)}
                  placeholder="품목명 검색..."
                  style={{ paddingLeft: '32px', height: '34px', fontSize: '13px', width: '200px' }}
                />
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
              </div>
            </div>
          </div>

          {/* 실시간 요약 바 */}
          {(() => {
            const hqStockValue = consumables.reduce((sum, c) => sum + (c.stockQty * c.unitPrice), 0);
            const totalVehicleStockValue = (mechanicConsumableStocks || []).reduce((sum, ms) => {
              const item = consumables.find(c => c.id === ms.consumableId);
              return sum + (ms.stockQty * (item?.unitPrice || 0));
            }, 0);
            const totalAssetValue = hqStockValue + totalVehicleStockValue;

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', margin: '14px 0' }}>
                <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>총 관리 품목</span>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--primary)' }}>{consumables.length}종</div>
                </div>
                <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>본사 창고 재고액</span>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#0070C0' }}>₩{hqStockValue.toLocaleString()}원</div>
                </div>
                <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>차량 이동 재고액</span>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#059669' }}>₩{totalVehicleStockValue.toLocaleString()}원</div>
                </div>
                <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>전사 총 소모품 자산</span>
                  <div style={{ fontSize: '15px', fontWeight: 800 }}>₩{totalAssetValue.toLocaleString()}원</div>
                </div>
              </div>
            );
          })()}

          <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>자재 품목명</th>
                  <th style={{ textAlign: 'center' }}>본사 중앙재고</th>
                  <th style={{ textAlign: 'center' }}>차량 이동재고</th>
                  <th style={{ textAlign: 'center' }}>전사 총재고</th>
                  <th>단위</th>
                  <th>단가</th>
                  <th>본사 평가금액</th>
                  <th>최근 구입처</th>
                  {canSave && <th style={{ textAlign: 'center' }}>관리</th>}
                </tr>
              </thead>
              <tbody>
                {consumables
                  .filter(c => !stockSearch || c.modelName.toLowerCase().includes(stockSearch.toLowerCase()))
                  .map(c => {
                  const vehicleQty = (mechanicConsumableStocks || []).filter(ms => ms.consumableId === c.id).reduce((sum, ms) => sum + ms.stockQty, 0);
                  const totalQty = c.stockQty + vehicleQty;

                  return (
                    <tr key={c.id}>
                      <td><strong style={{ color: 'var(--primary)' }}>{c.modelName}</strong></td>
                      <td style={{ textAlign: 'center', fontWeight: '700', fontSize: '14px', color: 'var(--text-main)' }}>{c.stockQty}</td>
                      <td style={{ textAlign: 'center', fontWeight: '600', color: '#059669' }}>{vehicleQty}</td>
                      <td style={{ textAlign: 'center', fontWeight: '800', color: 'var(--primary)' }}>{totalQty}</td>
                      <td>{c.unit}</td>
                      <td>{c.unitPrice.toLocaleString()}원</td>
                      <td style={{ fontWeight: '600' }}>{(c.stockQty * c.unitPrice).toLocaleString()}원</td>
                      <td>{c.supplier || '-'}</td>
                      {canSave && (
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                            <button className="btn-secondary" onClick={() => openEditMaster(c)} style={{ padding: '4px 6px' }} title="수정">
                              <Edit size={14} />
                            </button>
                            <button className="btn-secondary" onClick={() => handleDeleteMaster(c.id, c.modelName)} style={{ padding: '4px 6px', color: '#ef4444' }} title="삭제">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [TAB 2] AS 차량별 이동재고 (Van Stock) 뷰 (신설!) */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'VEHICLE_STOCK' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* 정비사별 차량 이동재고 카드 요약 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
            {mechanics.map(m => {
              const myStocks = (mechanicConsumableStocks || []).filter(ms => ms.mechanicId === m.id && ms.stockQty > 0);
              const totalItems = myStocks.reduce((sum, ms) => sum + ms.stockQty, 0);
              const totalVal = myStocks.reduce((sum, ms) => {
                const item = consumables.find(c => c.id === ms.consumableId);
                return sum + (ms.stockQty * (item?.unitPrice || 0));
              }, 0);

              return (
                <div key={m.id} className="card" style={{ padding: '14px', borderTop: '3px solid var(--primary)', margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Truck size={16} className="text-primary" />
                      <strong style={{ fontSize: '13.5px' }}>{m.name} 정비차량</strong>
                    </div>
                    <span className="badge badge-info" style={{ fontSize: '10.5px' }}>
                      {myStocks.length}종 / {totalItems}개
                    </span>
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    적재 평가액: <strong style={{ color: '#0070C0' }}>₩{totalVal.toLocaleString()}원</strong>
                  </div>

                  {myStocks.length === 0 ? (
                    <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11.5px', backgroundColor: 'var(--bg-app)', borderRadius: '4px' }}>
                      차량에 적재된 소모품이 없습니다.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
                      {myStocks.map(ms => {
                        const item = consumables.find(c => c.id === ms.consumableId);
                        return (
                          <div key={ms.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px', fontSize: '11.5px' }}>
                            <span>{item?.modelName || '품목'}</span>
                            <strong>{ms.stockQty} {item?.unit || '개'}</strong>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '6px', marginTop: '10px', paddingTop: '8px', borderTop: '1px dashed var(--border-color)' }}>
                    <button type="button" className="btn-secondary" onClick={() => {
                      setTransferMechanicId(m.id);
                      setTransferConsumableId(consumables[0]?.id || '');
                      setShowTransferModal(true);
                    }} style={{ flex: 1, padding: '4px 8px', fontSize: '11.5px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      <ArrowUpRight size={12} /> 불출
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => {
                      setReturnMechanicId(m.id);
                      const myFirstStock = myStocks[0];
                      setReturnConsumableId(myFirstStock?.consumableId || consumables[0]?.id || '');
                      setShowReturnModal(true);
                    }} style={{ flex: 1, padding: '4px 8px', fontSize: '11.5px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      <ArrowDownLeft size={12} /> 반납
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 차량 이동재고 전체 통합 상세 대장 */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 className="card-title">AS 차량별 소모품 적재 상세 대장</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>각 정비사 차량에 보관 중인 실시간 이동 재고</span>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select value={selectedMechanicFilter} onChange={e => setSelectedMechanicFilter(e.target.value)} style={{ padding: '5px 8px', fontSize: '12px' }}>
                  <option value="ALL">전체 정비사 차량</option>
                  {mechanics.map(m => (
                    <option key={m.id} value={m.id}>{m.name} 차량</option>
                  ))}
                </select>

                <input
                  type="text"
                  value={vehicleStockSearch}
                  onChange={e => setVehicleStockSearch(e.target.value)}
                  placeholder="품목명 검색..."
                  style={{ padding: '5px 8px', fontSize: '12px', width: '160px' }}
                />
              </div>
            </div>

            <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>담당 정비사</th>
                    <th>자재 품목명</th>
                    <th style={{ textAlign: 'center' }}>차량 적재수량</th>
                    <th>단위</th>
                    <th>단가</th>
                    <th>평가 금액</th>
                    <th>최종 갱신일</th>
                    <th style={{ textAlign: 'center' }}>관리 액션</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filteredList = (mechanicConsumableStocks || []).filter(ms => {
                      if (ms.stockQty <= 0) return false;
                      const matchMech = selectedMechanicFilter === 'ALL' || ms.mechanicId === selectedMechanicFilter;
                      const item = consumables.find(c => c.id === ms.consumableId);
                      const matchSearch = !vehicleStockSearch || (item?.modelName || '').toLowerCase().includes(vehicleStockSearch.toLowerCase());
                      return matchMech && matchSearch;
                    });

                    if (filteredList.length === 0) {
                      return (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                            차량에 적재된 이동 재고 내역이 없습니다.
                          </td>
                        </tr>
                      );
                    }

                    return filteredList.map(ms => {
                      const item = consumables.find(c => c.id === ms.consumableId);
                      const mech = users.find(u => u.id === ms.mechanicId);
                      const unitPrice = item?.unitPrice || 0;

                      return (
                        <tr key={ms.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700' }}>
                              <Truck size={13} className="text-primary" /> {mech?.name || '정비사'}
                            </div>
                          </td>
                          <td><strong style={{ color: 'var(--primary)' }}>{item?.modelName || '-'}</strong></td>
                          <td style={{ textAlign: 'center', fontWeight: '800', fontSize: '14px', color: '#059669' }}>
                            {ms.stockQty}
                          </td>
                          <td>{item?.unit || '개'}</td>
                          <td>{unitPrice.toLocaleString()}원</td>
                          <td style={{ fontWeight: '600' }}>{(ms.stockQty * unitPrice).toLocaleString()}원</td>
                          <td style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{ms.updatedAt}</td>
                          <td style={{ textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', gap: '4px' }}>
                              <button type="button" className="btn-secondary" onClick={() => {
                                setTransferMechanicId(ms.mechanicId);
                                setTransferConsumableId(ms.consumableId);
                                setShowTransferModal(true);
                              }} style={{ padding: '2px 6px', fontSize: '11px' }}>
                                추가불출
                              </button>
                              <button type="button" className="btn-secondary" onClick={() => {
                                setReturnMechanicId(ms.mechanicId);
                                setReturnConsumableId(ms.consumableId);
                                setReturnQty(Math.min(ms.stockQty, 1));
                                setShowReturnModal(true);
                              }} style={{ padding: '2px 6px', fontSize: '11px' }}>
                                본사반납
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [신규 TAB] 재고 실사 스튜디오 (Stocktaking Audit Studio) */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'STOCKTAKING' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 상단: 실사 전표 스코프 및 필터 바 */}
          <div className="card" style={{ margin: 0, padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>실사 대상 구분</label>
                  <select
                    value={auditTargetFilter}
                    onChange={e => setAuditTargetFilter(e.target.value as any)}
                    style={{ padding: '5px 8px', fontSize: '12px' }}
                  >
                    <option value="ALL">전체 실사 대상</option>
                    <option value="HQ">본사 중앙창고</option>
                    <option value="VEHICLE">AS 기사 정비차량</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>실사 상태</label>
                  <select
                    value={auditStatusFilter}
                    onChange={e => setAuditStatusFilter(e.target.value as any)}
                    style={{ padding: '5px 8px', fontSize: '12px' }}
                  >
                    <option value="ALL">전체 상태</option>
                    <option value="DRAFT">작성중 (DRAFT)</option>
                    <option value="CONFIRMED">실사확정 (CONFIRMED)</option>
                    <option value="CANCELLED">취소 (CANCELLED)</option>
                  </select>
                </div>
              </div>

              {canSave && (
                <button
                  className="btn-primary"
                  onClick={() => {
                    setNewAuditTargetType('HQ');
                    setNewAuditMechanicId(mechanics[0]?.id || '');
                    setNewAuditMemo('');
                    setShowCreateAuditModal(true);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Plus size={14} /> 새 실사 전표 생성
                </button>
              )}
            </div>

            {/* 실사 전표 가로 스크롤 카드/배너 목록 */}
            <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 700, marginBottom: '8px', color: 'var(--text-secondary)' }}>
                실사 전표 목록 ({stocktakingAudits.length}건)
              </div>
              <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '6px' }}>
                {(() => {
                  const filteredAudits = stocktakingAudits.filter(a => {
                    const matchTarget = auditTargetFilter === 'ALL' || a.targetType === auditTargetFilter;
                    const matchStatus = auditStatusFilter === 'ALL' || a.status === auditStatusFilter;
                    return matchTarget && matchStatus;
                  });

                  if (filteredAudits.length === 0) {
                    return (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '10px 0' }}>
                        조건에 맞는 실사 전표가 없습니다. [새 실사 전표 생성] 버튼을 눌러 실사를 시작하세요.
                      </div>
                    );
                  }

                  return filteredAudits.map(a => {
                    const isSelected = selectedAuditId === a.id;
                    const statusColor = a.status === 'CONFIRMED' ? 'var(--success)' : (a.status === 'CANCELLED' ? 'var(--danger)' : '#d97706');
                    const statusBg = a.status === 'CONFIRMED' ? 'var(--success-light)' : (a.status === 'CANCELLED' ? 'var(--danger-light)' : '#fef3c7');

                    return (
                      <div
                        key={a.id}
                        onClick={() => setSelectedAuditId(a.id)}
                        style={{
                          minWidth: '240px',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                          backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.05)' : 'var(--bg-app)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <strong style={{ fontSize: '12.5px', color: isSelected ? 'var(--primary)' : 'inherit' }}>{a.auditNo}</strong>
                          <span style={{ fontSize: '10.5px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', color: statusColor, backgroundColor: statusBg }}>
                            {a.status === 'CONFIRMED' ? '확정완료' : (a.status === 'CANCELLED' ? '취소' : '실사중')}
                          </span>
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                          {a.targetType === 'HQ' ? '🏢 본사 중앙창고' : `🚚 ${a.mechanicName || '정비사'} 차량`}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginTop: '6px', color: 'var(--text-muted)' }}>
                          <span>실사일: {a.auditDate}</span>
                          <span>오차: <strong style={{ color: a.totalDiffQty === 0 ? 'inherit' : (a.totalDiffQty > 0 ? '#2563eb' : '#ef4444') }}>
                            {a.totalDiffQty > 0 ? `+${a.totalDiffQty}` : a.totalDiffQty}개
                          </strong></span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>

          {/* 중앙: 선택된 실사 전표의 고밀도 멀티컬럼 대사 그리드 */}
          {(() => {
            const currentAudit = stocktakingAudits.find(a => a.id === selectedAuditId) || stocktakingAudits[0];
            if (!currentAudit) {
              return (
                <div className="card" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  등록된 재고실사 전표가 없습니다. 상단의 [새 실사 전표 생성]을 눌러 첫 실사를 시작하세요.
                </div>
              );
            }

            const currentItems = stocktakingAuditItems.filter(i => i.auditId === currentAudit.id)
              .filter(i => !auditItemSearch || i.modelName.toLowerCase().includes(auditItemSearch.toLowerCase()));

            const isDraft = currentAudit.status === 'DRAFT';

            return (
              <div className="card" style={{ margin: 0 }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <CheckSquare size={16} className="text-primary" />
                      실사 상세 대사 그리드: {currentAudit.auditNo}
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: currentAudit.status === 'CONFIRMED' ? 'var(--success-light)' : '#fef3c7',
                        color: currentAudit.status === 'CONFIRMED' ? 'var(--success)' : '#d97706',
                        fontWeight: 700
                      }}>
                        {currentAudit.targetType === 'HQ' ? '본사 중앙창고' : `${currentAudit.mechanicName} 차량`} ({currentAudit.status})
                      </span>
                    </h3>
                    <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      실사자: {currentAudit.auditorName} | 실사일자: {currentAudit.auditDate}
                      {currentAudit.confirmedAt && ` | 확정: ${currentAudit.confirmedAt.substring(0, 16)} (${currentAudit.confirmedBy})`}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="text"
                      value={auditItemSearch}
                      onChange={e => setAuditItemSearch(e.target.value)}
                      placeholder="실사 품목 검색..."
                      style={{ padding: '5px 8px', fontSize: '12px', width: '160px' }}
                    />
                    {isDraft && canSave && (
                      <>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => handleCancelAudit(currentAudit.id)}
                          style={{ padding: '6px 12px', fontSize: '12px', color: 'var(--danger)' }}
                        >
                          전표 취소
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => handleConfirmAudit(currentAudit.id)}
                          style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 700 }}
                        >
                          실사 확정 및 재고 강제 반영
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* 4대 KPI 요약 바 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', padding: '12px 16px', backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>전산 총수량</div>
                    <div style={{ fontSize: '15px', fontWeight: 800 }}>{currentAudit.totalSystemQty.toLocaleString()}개</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>실물 총수량</div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--primary)' }}>{currentAudit.totalActualQty.toLocaleString()}개</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>차이 수량 (실물 - 전산)</div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: currentAudit.totalDiffQty === 0 ? 'inherit' : (currentAudit.totalDiffQty > 0 ? '#2563eb' : '#ef4444') }}>
                      {currentAudit.totalDiffQty > 0 ? `+${currentAudit.totalDiffQty}` : currentAudit.totalDiffQty}개
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>재고 감모/잉여 차액</div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: currentAudit.totalDiffAmount === 0 ? 'inherit' : (currentAudit.totalDiffAmount > 0 ? '#2563eb' : '#ef4444') }}>
                      ₩{currentAudit.totalDiffAmount.toLocaleString()}원
                    </div>
                  </div>
                </div>

                {/* 고밀도 품목 그리드 (행 높이 38~42px 슬림) */}
                <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '40px', textAlign: 'center' }}>No</th>
                        <th>자재 품목명</th>
                        <th style={{ width: '60px' }}>단위</th>
                        <th style={{ width: '90px', textAlign: 'right' }}>기준단가</th>
                        <th style={{ width: '90px', textAlign: 'center' }}>전산재고</th>
                        <th style={{ width: '110px', textAlign: 'center', backgroundColor: isDraft ? 'rgba(37, 99, 235, 0.05)' : 'inherit' }}>
                          실물재고 (실사)
                        </th>
                        <th style={{ width: '100px', textAlign: 'center' }}>차이수량</th>
                        <th style={{ width: '110px', textAlign: 'right' }}>차이금액</th>
                        <th style={{ width: '130px' }}>차이사유</th>
                        <th>비고 / 특이사항</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentItems.length === 0 ? (
                        <tr>
                          <td colSpan={10} style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                            실사 대상 품목이 없습니다.
                          </td>
                        </tr>
                      ) : (
                        currentItems.map((item, idx) => {
                          const hasDiff = item.diffQty !== 0;

                          return (
                            <tr key={item.id} style={{ backgroundColor: hasDiff ? 'rgba(239, 68, 68, 0.03)' : 'inherit' }}>
                              <td style={{ textAlign: 'center', fontSize: '11.5px', color: 'var(--text-muted)' }}>{idx + 1}</td>
                              <td>
                                <strong style={{ color: 'var(--primary)' }}>{item.modelName}</strong>
                              </td>
                              <td style={{ fontSize: '12px' }}>{item.unit}</td>
                              <td style={{ textAlign: 'right', fontSize: '12px' }}>₩{item.unitPrice.toLocaleString()}</td>
                              <td style={{ textAlign: 'center', fontWeight: 700, fontSize: '13px' }}>{item.systemQty}</td>
                              <td style={{ textAlign: 'center' }}>
                                {isDraft ? (
                                  <input
                                    type="number"
                                    min={0}
                                    value={item.actualQty}
                                    onChange={e => {
                                      const val = parseInt(e.target.value) || 0;
                                      handleAuditItemQtyChange(item.id, val, item.diffReason, item.note);
                                    }}
                                    style={{
                                      width: '70px',
                                      padding: '3px 6px',
                                      fontSize: '12.5px',
                                      fontWeight: 800,
                                      textAlign: 'center',
                                      borderRadius: '4px',
                                      border: hasDiff ? '2px solid #ef4444' : '1px solid var(--border-color)',
                                      backgroundColor: hasDiff ? '#fff1f2' : 'var(--bg-app)'
                                    }}
                                  />
                                ) : (
                                  <strong style={{ fontSize: '13px', color: 'var(--primary)' }}>{item.actualQty}</strong>
                                )}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                {item.diffQty === 0 ? (
                                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>0</span>
                                ) : item.diffQty > 0 ? (
                                  <span className="badge badge-primary" style={{ fontSize: '11px', fontWeight: 800 }}>
                                    +{item.diffQty} (잉여)
                                  </span>
                                ) : (
                                  <span className="badge badge-danger" style={{ fontSize: '11px', fontWeight: 800 }}>
                                    {item.diffQty} (감모)
                                  </span>
                                )}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '12px', color: item.diffAmount === 0 ? 'inherit' : (item.diffAmount > 0 ? '#2563eb' : '#ef4444') }}>
                                {item.diffAmount === 0 ? '-' : `₩${item.diffAmount.toLocaleString()}`}
                              </td>
                              <td>
                                {isDraft ? (
                                  <select
                                    value={item.diffReason || 'OTHER'}
                                    disabled={!hasDiff}
                                    onChange={e => handleAuditItemQtyChange(item.id, item.actualQty, e.target.value as any, item.note)}
                                    style={{ padding: '2px 4px', fontSize: '11px', width: '100%', opacity: hasDiff ? 1 : 0.4 }}
                                  >
                                    <option value="LOST">망실/도난</option>
                                    <option value="DAMAGED">파손/부식/폐기</option>
                                    <option value="UNRECORDED_USAGE">미기록 현장소모</option>
                                    <option value="SURPLUS">미등록 잉여수거</option>
                                    <option value="OTHER">기타 사유</option>
                                  </select>
                                ) : (
                                  <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                                    {item.diffReason === 'LOST' ? '망실/도난'
                                      : item.diffReason === 'DAMAGED' ? '파손/부식'
                                      : item.diffReason === 'UNRECORDED_USAGE' ? '미기록 현장소모'
                                      : item.diffReason === 'SURPLUS' ? '미등록 잉여' : (item.diffQty !== 0 ? '기타' : '-')}
                                  </span>
                                )}
                              </td>
                              <td>
                                {isDraft ? (
                                  <input
                                    type="text"
                                    value={item.note || ''}
                                    placeholder="특이사항 메모..."
                                    onChange={e => handleAuditItemQtyChange(item.id, item.actualQty, item.diffReason, e.target.value)}
                                    style={{ width: '100%', padding: '2px 6px', fontSize: '11px' }}
                                  />
                                ) : (
                                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{item.note || '-'}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 하단 Gutenberg Z-패턴 터미널 대차대조식 바 */}
                <div style={{
                  padding: '12px 18px',
                  backgroundColor: 'var(--bg-app)',
                  borderTop: '1px solid var(--border-color)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '10px'
                }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span>📦 <strong>실물 총액:</strong> ₩{currentAudit.totalActualAmount.toLocaleString()}원</span>
                    <span>=</span>
                    <span>💻 <strong>전산 총액:</strong> ₩{currentAudit.totalSystemAmount.toLocaleString()}원</span>
                    <span>+</span>
                    <span>⚖️ <strong>실사 차액:</strong> ₩{currentAudit.totalDiffAmount.toLocaleString()}원</span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span style={{ color: 'var(--success)', fontWeight: 800 }}>⚖️ 대차 차액 ₩0 무결 확정</span>
                  </div>

                  {isDraft && canSave && (
                    <button
                      className="btn-primary"
                      onClick={() => handleConfirmAudit(currentAudit.id)}
                      style={{ padding: '8px 18px', fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <CheckCircle2 size={16} /> 실사 확정 및 재고 강제 반영
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [신규 TAB] 수거 고품(폐부품/교체부품) 관리 대장 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'COLLECTED_PARTS' && (
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Archive size={16} className="text-primary" />
                수거 고품 사후처리(재생/폐기/보증) 관리 대장
              </h3>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                현장 AS 및 입고 정비 시 교체 수거된 불량 부품의 격리 및 사후처리 파이프라인
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <select
                value={partDispositionFilter}
                onChange={e => setPartDispositionFilter(e.target.value as any)}
                style={{ padding: '5px 8px', fontSize: '12px' }}
              >
                <option value="ALL">전체 처분구분</option>
                <option value="REBUILD">재생 대상 (REBUILD)</option>
                <option value="SCRAP">폐기/고철 (SCRAP)</option>
                <option value="VENDOR_WARRANTY">제조사 무상보증 (WARRANTY)</option>
              </select>

              <select
                value={partStatusFilter}
                onChange={e => setPartStatusFilter(e.target.value as any)}
                style={{ padding: '5px 8px', fontSize: '12px' }}
              >
                <option value="ALL">전체 상태</option>
                <option value="RECEIVED">수거 접수 (RECEIVED)</option>
                <option value="IN_PROCESS">처리 진행중 (IN_PROCESS)</option>
                <option value="COMPLETED">조치 완료 (COMPLETED)</option>
              </select>

              <input
                type="text"
                value={partSearch}
                onChange={e => setPartSearch(e.target.value)}
                placeholder="고품 부품명 검색..."
                style={{ padding: '5px 8px', fontSize: '12px', width: '160px' }}
              />
            </div>
          </div>

          {/* 고품 4대 요약 카드 */}
          {(() => {
            const totalCount = collectedParts.length;
            const rebuildCount = collectedParts.filter(p => p.disposition === 'REBUILD').length;
            const scrapCount = collectedParts.filter(p => p.disposition === 'SCRAP').length;
            const warrantyCount = collectedParts.filter(p => p.disposition === 'VENDOR_WARRANTY').length;

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', padding: '12px 16px', backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>총 수거 건수</div>
                  <div style={{ fontSize: '15px', fontWeight: 800 }}>{totalCount}건</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>재생 대기 (REBUILD)</div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#7c3aed' }}>{rebuildCount}건</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>폐기/고철 (SCRAP)</div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#ea580c' }}>{scrapCount}건</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>제조사 무상보증 클레임</div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#2563eb' }}>{warrantyCount}건</div>
                </div>
              </div>
            );
          })()}

          {/* 고품 목록 테이블 */}
          <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>고품 관리번호</th>
                  <th>부품 품목명</th>
                  <th style={{ textAlign: 'center' }}>수량</th>
                  <th>수거 정비사</th>
                  <th style={{ textAlign: 'center' }}>처분 구분</th>
                  <th style={{ textAlign: 'center' }}>처리 상태</th>
                  <th>수거 일자</th>
                  <th>조치 일자</th>
                  <th>메모 / 조치내용</th>
                  <th style={{ textAlign: 'center' }}>관리 액션</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filtered = collectedParts.filter(p => {
                    const matchDisp = partDispositionFilter === 'ALL' || p.disposition === partDispositionFilter;
                    const matchStatus = partStatusFilter === 'ALL' || p.status === partStatusFilter;
                    const matchSearch = !partSearch || p.modelName.toLowerCase().includes(partSearch.toLowerCase()) || p.partNo.toLowerCase().includes(partSearch.toLowerCase());
                    return matchDisp && matchStatus && matchSearch;
                  });

                  if (filtered.length === 0) {
                    return (
                      <tr>
                        <td colSpan={10} style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                          수거된 고품 내역이 없습니다. (차량 반납 시 고품 체크 시 자동 등재됩니다)
                        </td>
                      </tr>
                    );
                  }

                  return filtered.map(p => {
                    const dispLabel = p.disposition === 'REBUILD' ? '재생 대상' : (p.disposition === 'SCRAP' ? '폐기/고철' : '제조사 보증');
                    const dispColor = p.disposition === 'REBUILD' ? '#7c3aed' : (p.disposition === 'SCRAP' ? '#ea580c' : '#2563eb');
                    const dispBg = p.disposition === 'REBUILD' ? '#f5f3ff' : (p.disposition === 'SCRAP' ? '#fff7ed' : '#eff6ff');

                    const statusLabel = p.status === 'COMPLETED' ? '조치 완료' : (p.status === 'IN_PROCESS' ? '처리중' : '수거 접수');
                    const statusColor = p.status === 'COMPLETED' ? 'var(--success)' : (p.status === 'IN_PROCESS' ? '#2563eb' : '#d97706');

                    return (
                      <tr key={p.id}>
                        <td><strong>{p.partNo}</strong></td>
                        <td><strong style={{ color: 'var(--primary)' }}>{p.modelName}</strong></td>
                        <td style={{ textAlign: 'center', fontWeight: 800 }}>{p.quantity}개</td>
                        <td>{p.mechanicName}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', color: dispColor, backgroundColor: dispBg }}>
                            {dispLabel}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ fontSize: '11.5px', fontWeight: 700, color: statusColor }}>
                            {statusLabel}
                          </span>
                        </td>
                        <td style={{ fontSize: '11.5px' }}>{p.receivedDate}</td>
                        <td style={{ fontSize: '11.5px' }}>{p.actionDate || '-'}</td>
                        <td style={{ fontSize: '12px' }}>{p.actionMemo || p.memo || '-'}</td>
                        <td style={{ textAlign: 'center' }}>
                          {canSave && p.status !== 'COMPLETED' && (
                            <div style={{ display: 'inline-flex', gap: '4px' }}>
                              {p.status === 'RECEIVED' && (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => handleProcessCollectedPart(p.id, 'IN_PROCESS', '재생/외주 정비 또는 폐기 착수')}
                                  style={{ padding: '2px 6px', fontSize: '11px' }}
                                >
                                  처리 착수
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn-primary"
                                onClick={() => handleProcessCollectedPart(p.id, 'COMPLETED', `${dispLabel} 최종 조치 완료`)}
                                style={{ padding: '2px 8px', fontSize: '11px' }}
                              >
                                조치 완료
                              </button>
                            </div>
                          )}
                          {p.status === 'COMPLETED' && (
                            <span style={{ fontSize: '11px', color: 'var(--success)', fontWeight: 700 }}>✓ 종결</span>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [TAB 3] 구매 신청 내역 조회 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'REQ_LIST' && (
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title">소모품 구매 신청 대장</h3>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={reqSearchTerm}
              onChange={e => setReqSearchTerm(e.target.value)}
              placeholder="품목명, 공급사 검색"
              style={{ padding: '6px', fontSize: '12.5px', width: '180px' }}
            />
            <select value={reqStatusFilter} onChange={e => setReqStatusFilter(e.target.value as any)} style={{ padding: '6px', fontSize: '12.5px' }}>
              <option value="ALL">전체 상태</option>
              <option value="INCOMPLETE">미완료</option>
              <option value="COMPLETED">입고완료</option>
            </select>
            <input type="date" value={reqStartDate} onChange={e => setReqStartDate(e.target.value)} style={{ padding: '6px', fontSize: '12.5px' }} />
            <span>~</span>
            <input type="date" value={reqEndDate} onChange={e => setReqEndDate(e.target.value)} style={{ padding: '6px', fontSize: '12.5px' }} />
            <button className="btn-primary" onClick={() => {
              setSearchQuery(reqSearchTerm);
              setStatusQuery(reqStatusFilter);
              setStartDateQuery(reqStartDate);
              setEndDateQuery(reqEndDate);
              setUserQuery(reqUserFilter);
            }} style={{ padding: '6px 14px', fontSize: '12.5px' }}>조회</button>
          </div>

          <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>신청번호</th>
                  <th>품명</th>
                  <th style={{ textAlign: 'center' }}>수량</th>
                  <th>예상단가</th>
                  <th>합계금액</th>
                  <th>공급처</th>
                  <th>신청자</th>
                  <th>신청일</th>
                  <th>진행상태</th>
                </tr>
              </thead>
              <tbody>
                {getFilteredPurchases().length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                      조회 조건에 맞는 구매 신청 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  getFilteredPurchases().map(p => (
                    <tr key={p.id}>
                      <td><span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{p.id}</span></td>
                      <td><strong>{p.modelName}</strong></td>
                      <td style={{ textAlign: 'center' }}>{p.requestedQty}</td>
                      <td>{p.unitPrice.toLocaleString()}원</td>
                      <td style={{ fontWeight: '600' }}>{(p.requestedQty * p.unitPrice).toLocaleString()}원</td>
                      <td>{p.sellerName}</td>
                      <td>{p.requesterName}</td>
                      <td>{p.requestDate}</td>
                      <td>
                        <span className={`badge ${
                          p.status === 'COMPLETED' ? 'badge-success' :
                          p.status === 'ACCEPTED' ? 'badge-primary' : 'badge-warning'
                        }`}>
                          {p.status === 'COMPLETED' ? '입고완료' :
                           p.status === 'ACCEPTED' ? '접수완료' : '신청접수'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [TAB 4] 소모품 구매 신청서 작성 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'REQ_WRITE' && (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h3 className="card-title" style={{ marginBottom: '16px' }}>소모품 구매 신청서 작성</h3>
          <form onSubmit={handleRequestSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>기존 품목 선택 또는 신규</label>
              <select value={reqConsumableId} onChange={e => {
                setReqConsumableId(e.target.value);
                const item = consumables.find(c => c.id === e.target.value);
                if (item) {
                  setReqModelName(item.modelName);
                  setReqUnitPrice(item.unitPrice);
                  setReqSellerName(item.supplier || '');
                }
              }} style={{ width: '100%', padding: '7px' }}>
                <option value="NEW">-- 신규 품목 직접 입력 --</option>
                {consumables.map(c => (
                  <option key={c.id} value={c.id}>{c.modelName} (현재고: {c.stockQty}개, 단가: ₩{c.unitPrice.toLocaleString()})</option>
                ))}
              </select>
            </div>

            {reqConsumableId === 'NEW' && (
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>신규 품목명 *</label>
                <input type="text" value={reqModelName} onChange={e => setReqModelName(e.target.value)} placeholder="예: 유압호스 1/4 2W" required style={{ width: '100%', padding: '7px' }} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>신청 수량 *</label>
                <input type="number" value={reqQty} onChange={e => setReqQty(parseInt(e.target.value) || 1)} min={1} required style={{ width: '100%', padding: '7px' }} />
              </div>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>예상 단가 (원) *</label>
                <input type="number" value={reqUnitPrice} onChange={e => setReqUnitPrice(parseInt(e.target.value) || 0)} min={0} required style={{ width: '100%', padding: '7px' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>신청 일자 *</label>
                <input type="date" value={reqDate} onChange={e => setReqDate(e.target.value)} required style={{ width: '100%', padding: '7px' }} />
              </div>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>구매처/공급사 *</label>
                <input type="text" value={reqSellerName} onChange={e => setReqSellerName(e.target.value)} placeholder="예: (주)한국유압상사" required style={{ width: '100%', padding: '7px' }} />
              </div>
            </div>

            <div style={{ padding: '12px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>예상 총 구매비용:</span>
              <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>₩{(reqQty * reqUnitPrice).toLocaleString()}원</strong>
            </div>

            <button type="submit" className="btn-primary" style={{ padding: '10px', marginTop: '6px' }}>구매 신청서 제출</button>
          </form>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [TAB 5] 구매물품 입고 처리 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'REQ_INBOUND' && (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h3 className="card-title" style={{ marginBottom: '16px' }}>구매 소모품 본사 창고 입고 처리</h3>
          <form onSubmit={handleInboundConfirmSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>입고 대상 구매 신청건 *</label>
              <select value={selectedReqId} onChange={e => {
                setSelectedReqId(e.target.value);
                const req = consumablePurchases.find(p => p.id === e.target.value);
                if (req) setInboundQty(req.requestedQty);
              }} required style={{ width: '100%', padding: '7px' }}>
                <option value="">-- 입고 대기 신청건 선택 --</option>
                {consumablePurchases.filter(p => p.status !== 'COMPLETED').map(p => (
                  <option key={p.id} value={p.id}>[{p.requestDate}] {p.modelName} ({p.requestedQty}개) - {p.sellerName}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>실제 입고 수량 *</label>
              <input type="number" value={inboundQty} onChange={e => setInboundQty(parseInt(e.target.value) || 1)} min={1} required style={{ width: '100%', padding: '7px' }} />
            </div>

            <div>
              <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>거래명세서 증빙 파일 첨부</label>
              <input type="file" accept="image/*,.pdf" onChange={e => setSelectedFile(e.target.files?.[0] || null)} style={{ width: '100%', padding: '7px' }} />
              {selectedFile && <div style={{ fontSize: '12px', color: 'var(--primary)', marginTop: '4px' }}>선택된 파일: {selectedFile.name}</div>}
            </div>

            <button type="submit" className="btn-primary" disabled={isUploading} style={{ padding: '10px' }}>
              {isUploading ? '업로드 및 입고 처리중...' : '본사 창고 입고 확정'}
            </button>
          </form>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [TAB 6] 소모품 출고(사용) */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'USE' && (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h3 className="card-title" style={{ marginBottom: '16px' }}>소모품 직접 출고 (본사 야적장 정비)</h3>
          <form onSubmit={handleUseSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>출고 품목 *</label>
              <select value={useConsumableId} onChange={e => setUseConsumableId(e.target.value)} required style={{ width: '100%', padding: '7px' }}>
                <option value="">-- 품목 선택 --</option>
                {consumables.map(c => (
                  <option key={c.id} value={c.id}>{c.modelName} (본사재고: {c.stockQty}개, ₩{c.unitPrice.toLocaleString()})</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>출고 수량 *</label>
                <input type="number" value={useQty} onChange={e => setUseQty(parseInt(e.target.value) || 1)} min={1} required style={{ width: '100%', padding: '7px' }} />
              </div>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>적용 대상 자산</label>
                <select value={useAssetId} onChange={e => setUseAssetId(e.target.value)} style={{ width: '100%', padding: '7px' }}>
                  <option value="">-- 자산 선택 (선택사항) --</option>
                  {assets.map(a => (
                    <option key={a.id} value={a.id}>{a.assetNo} ({a.modelName})</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>사용 목적 및 상세</label>
              <input type="text" value={useDesc} onChange={e => setUseDesc(e.target.value)} placeholder="예: 입고 장비 정기 점검 유압유 보충" style={{ width: '100%', padding: '7px' }} />
            </div>

            <button type="submit" className="btn-primary" style={{ padding: '10px', marginTop: '6px' }}>소모품 출고 저장</button>
          </form>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* [TAB 7] 입출고 수불 이력 로그 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'LOGS' && (
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title">소모품 입출고 및 이동 수불 로그</h3>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={logSearch}
              onChange={e => setLogSearch(e.target.value)}
              placeholder="품목명, 비고 검색..."
              style={{ padding: '6px', fontSize: '12.5px', width: '180px' }}
            />
            <select value={logTypeFilter} onChange={e => setLogTypeFilter(e.target.value)} style={{ padding: '6px', fontSize: '12.5px' }}>
              <option value="ALL">전체 구분</option>
              <option value="INBOUND">구매입고</option>
              <option value="OUTBOUND">현장소진(출고)</option>
              <option value="TRANSFER_TO_VEHICLE">차량불출</option>
              <option value="RETURN_TO_HQ">본사반납</option>
              <option value="ADJUST">재고조정</option>
            </select>
            <input type="date" value={logStartDate} onChange={e => setLogStartDate(e.target.value)} style={{ padding: '6px', fontSize: '12.5px' }} />
            <span>~</span>
            <input type="date" value={logEndDate} onChange={e => setLogEndDate(e.target.value)} style={{ padding: '6px', fontSize: '12.5px' }} />
          </div>

          <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>구분</th>
                  <th>품목명</th>
                  <th style={{ textAlign: 'center' }}>수량</th>
                  <th>단가</th>
                  <th>총금액</th>
                  <th>출처</th>
                  <th>이동처 / 적용</th>
                  <th>담당자</th>
                  <th>일자</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {consumableLogs
                  .filter(l => {
                    const matchType = logTypeFilter === 'ALL' || l.type === logTypeFilter;
                    const matchStart = !logStartDate || l.actionDate >= logStartDate;
                    const matchEnd = !logEndDate || l.actionDate <= logEndDate;
                    const item = consumables.find(c => c.id === l.consumableId);
                    const matchSearch = !logSearch || (item?.modelName || '').toLowerCase().includes(logSearch.toLowerCase()) || (l.description || '').toLowerCase().includes(logSearch.toLowerCase());
                    return matchType && matchStart && matchEnd && matchSearch;
                  })
                  .map(l => {
                  const item = consumables.find(c => c.id === l.consumableId);
                  return (
                    <tr key={l.id}>
                      <td>
                        <span className={`badge ${
                          l.type === 'INBOUND' ? 'badge-success' :
                          l.type === 'OUTBOUND' ? 'badge-danger' :
                          l.type === 'TRANSFER_TO_VEHICLE' ? 'badge-primary' :
                          l.type === 'RETURN_TO_HQ' ? 'badge-warning' : 'badge-secondary'
                        }`}>
                          {l.type === 'INBOUND' ? '구매입고' :
                           l.type === 'OUTBOUND' ? '현장소진' :
                           l.type === 'TRANSFER_TO_VEHICLE' ? '차량불출' :
                           l.type === 'RETURN_TO_HQ' ? '본사반납' : '재고조정'}
                        </span>
                      </td>
                      <td><strong>{item?.modelName || '품목'}</strong></td>
                      <td style={{ textAlign: 'center', fontWeight: '700' }}>{l.quantity}</td>
                      <td>{l.unitPrice.toLocaleString()}원</td>
                      <td style={{ fontWeight: '600' }}>{(l.quantity * l.unitPrice).toLocaleString()}원</td>
                      <td>{l.fromLocation || (l.type === 'INBOUND' ? (l.supplier || '매입처') : '본사 중앙창고')}</td>
                      <td>{l.toLocation || (l.targetAssetId ? `자산(${getAssetNo(l.targetAssetId)})` : '-')}</td>
                      <td>{getUserName(l.userId || l.mechanicId)}</td>
                      <td>{l.actionDate}</td>
                      <td style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{l.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 본사 ➔ 차량 불출 모달 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showTransferModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <form onSubmit={handleTransferSubmit} className="card" style={{ width: '90%', maxWidth: '450px', backgroundColor: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '14px' }}>
              <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--primary)' }}>
                <ArrowUpRight size={16} /> 본사 ➔ AS 차량 소모품 불출
              </h3>
              <button type="button" className="btn-secondary" onClick={() => setShowTransferModal(false)} style={{ padding: '3px 8px' }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>불출 대상 정비사 (차량) *</label>
                <select value={transferMechanicId} onChange={e => setTransferMechanicId(e.target.value)} required style={{ width: '100%', padding: '6px' }}>
                  {mechanics.map(m => (
                    <option key={m.id} value={m.id}>{m.name} 정비차량</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>불출 소모품 품목 *</label>
                <select value={transferConsumableId} onChange={e => setTransferConsumableId(e.target.value)} required style={{ width: '100%', padding: '6px' }}>
                  {consumables.map(c => (
                    <option key={c.id} value={c.id}>{c.modelName} (본사 가용재고: {c.stockQty}개, 단가: ₩{c.unitPrice.toLocaleString()})</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>불출 수량 *</label>
                <input
                  type="number"
                  value={transferQty}
                  onChange={e => setTransferQty(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  max={consumables.find(c => c.id === transferConsumableId)?.stockQty || 9999}
                  required
                  style={{ width: '100%', padding: '6px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>비고 / 메모</label>
                <input type="text" value={transferMemo} onChange={e => setTransferMemo(e.target.value)} placeholder="예: 주간 정기 순회 정비용 적재" style={{ width: '100%', padding: '6px' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowTransferModal(false)}>취소</button>
              <button type="submit" className="btn-primary">차량 불출 실행</button>
            </div>
          </form>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 차량 ➔ 본사 반납 모달 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showReturnModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <form onSubmit={handleReturnSubmit} className="card" style={{ width: '90%', maxWidth: '450px', backgroundColor: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '14px' }}>
              <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px', color: '#d97706' }}>
                <ArrowDownLeft size={16} /> AS 차량 ➔ 본사 창고 반납
              </h3>
              <button type="button" className="btn-secondary" onClick={() => setShowReturnModal(false)} style={{ padding: '3px 8px' }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>반납 정비사 (차량) *</label>
                <select value={returnMechanicId} onChange={e => {
                  setReturnMechanicId(e.target.value);
                  const firstStock = (mechanicConsumableStocks || []).find(ms => ms.mechanicId === e.target.value && ms.stockQty > 0);
                  if (firstStock) setReturnConsumableId(firstStock.consumableId);
                }} required style={{ width: '100%', padding: '6px' }}>
                  {mechanics.map(m => (
                    <option key={m.id} value={m.id}>{m.name} 정비차량</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>반납 소모품 품목 *</label>
                <select value={returnConsumableId} onChange={e => setReturnConsumableId(e.target.value)} required style={{ width: '100%', padding: '6px' }}>
                  {(() => {
                    const mechStocks = (mechanicConsumableStocks || []).filter(ms => ms.mechanicId === returnMechanicId && ms.stockQty > 0);
                    if (mechStocks.length === 0) {
                      return <option value="">-- 차량 내 보유 재고 없음 --</option>;
                    }
                    return mechStocks.map(ms => {
                      const item = consumables.find(c => c.id === ms.consumableId);
                      return (
                        <option key={ms.consumableId} value={ms.consumableId}>
                          {item?.modelName || '품목'} (차량 보유: {ms.stockQty}개)
                        </option>
                      );
                    });
                  })()}
                </select>
              </div>

              {(() => {
                const targetStock = (mechanicConsumableStocks || []).find(ms => ms.mechanicId === returnMechanicId && ms.consumableId === returnConsumableId);
                const maxStock = targetStock ? targetStock.stockQty : 1;
                return (
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>반납 수량 (보유: {maxStock}개) *</label>
                    <input
                      type="number"
                      value={returnQty}
                      onChange={e => setReturnQty(Math.min(maxStock, Math.max(1, parseInt(e.target.value) || 1)))}
                      min={1}
                      max={maxStock}
                      required
                      style={{ width: '100%', padding: '6px' }}
                    />
                  </div>
                );
              })()}

              {/* 고품(불량품) 반납 격리 스위치 */}
              <div style={{ padding: '10px', backgroundColor: isReturnDefective ? '#fff7ed' : 'var(--bg-app)', borderRadius: '6px', border: isReturnDefective ? '1px solid #fdba74' : '1px solid var(--border-color)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                  <input
                    type="checkbox"
                    checked={isReturnDefective}
                    onChange={e => setIsReturnDefective(e.target.checked)}
                  />
                  <span>⚠️ 교체 수거 고품(불량/고장 부품) 반납 (본사 신품재고 가산 차단)</span>
                </label>

                {isReturnDefective && (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #fdba74' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px', color: '#ea580c' }}>
                      고품 사후처리 판정 구분 *
                    </label>
                    <select
                      value={returnDisposition}
                      onChange={e => setReturnDisposition(e.target.value as any)}
                      style={{ width: '100%', padding: '5px', fontSize: '12px' }}
                    >
                      <option value="REBUILD">재생 판정 (오버홀 / 자체 수리 재생 대상)</option>
                      <option value="SCRAP">폐기 처분 (수리 불가 고철 매각/폐기)</option>
                      <option value="VENDOR_WARRANTY">제조사 무상보증 클레임 대상</option>
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>비고 / 메모</label>
                <input type="text" value={returnMemo} onChange={e => setReturnMemo(e.target.value)} placeholder="예: 잔여분 본사 회수 or 현장 모터 교체 수거품" style={{ width: '100%', padding: '6px' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowReturnModal(false)}>취소</button>
              <button type="submit" className="btn-primary" style={{ backgroundColor: isReturnDefective ? '#ea580c' : '#d97706', borderColor: isReturnDefective ? '#ea580c' : '#d97706' }}>
                {isReturnDefective ? '고품 격리 반납 실행' : '본사 정상 반납 실행'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 정비사 차량 간 (P2P) 부품 융통 이동 모달 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showP2PModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <form onSubmit={handleP2PSubmit} className="card" style={{ width: '90%', maxWidth: '450px', backgroundColor: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '14px' }}>
              <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--primary)' }}>
                <ArrowRightLeft size={16} /> AS 차량 ➔ 차량 부품 이동 (P2P 융통)
              </h3>
              <button type="button" className="btn-secondary" onClick={() => setShowP2PModal(false)} style={{ padding: '3px 8px' }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>양도 정비사 (출처) *</label>
                  <select
                    value={p2pFromMechanicId}
                    onChange={e => {
                      setP2pFromMechanicId(e.target.value);
                      const available = (mechanicConsumableStocks || []).find(ms => ms.mechanicId === e.target.value && ms.stockQty > 0);
                      if (available) setP2pConsumableId(available.consumableId);
                    }}
                    required
                    style={{ width: '100%', padding: '6px' }}
                  >
                    {mechanics.map(m => (
                      <option key={m.id} value={m.id}>{m.name} 차량</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>양수 정비사 (도착) *</label>
                  <select
                    value={p2pToMechanicId}
                    onChange={e => setP2pToMechanicId(e.target.value)}
                    required
                    style={{ width: '100%', padding: '6px' }}
                  >
                    {mechanics.map(m => (
                      <option key={m.id} value={m.id}>{m.name} 차량</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>이동할 부품 품목 *</label>
                <select value={p2pConsumableId} onChange={e => setP2pConsumableId(e.target.value)} required style={{ width: '100%', padding: '6px' }}>
                  {(() => {
                    const fromStocks = (mechanicConsumableStocks || []).filter(ms => ms.mechanicId === p2pFromMechanicId && ms.stockQty > 0);
                    if (fromStocks.length === 0) {
                      return <option value="">-- 양도 정비사 차량에 보유 재고 없음 --</option>;
                    }
                    return fromStocks.map(ms => {
                      const item = consumables.find(c => c.id === ms.consumableId);
                      return (
                        <option key={ms.consumableId} value={ms.consumableId}>
                          {item?.modelName || '품목'} (보유: {ms.stockQty}개)
                        </option>
                      );
                    });
                  })()}
                </select>
              </div>

              {(() => {
                const targetStock = (mechanicConsumableStocks || []).find(ms => ms.mechanicId === p2pFromMechanicId && ms.consumableId === p2pConsumableId);
                const maxStock = targetStock ? targetStock.stockQty : 1;
                return (
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>이동 수량 (보유: {maxStock}개) *</label>
                    <input
                      type="number"
                      value={p2pQty}
                      onChange={e => setP2pQty(Math.min(maxStock, Math.max(1, parseInt(e.target.value) || 1)))}
                      min={1}
                      max={maxStock}
                      required
                      style={{ width: '100%', padding: '6px' }}
                    />
                  </div>
                );
              })()}

              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>융통 사유 / 메모</label>
                <input type="text" value={p2pMemo} onChange={e => setP2pMemo(e.target.value)} placeholder="예: 천안 현장 긴급 지원용 차대차 이관" style={{ width: '100%', padding: '6px' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowP2PModal(false)}>취소</button>
              <button type="submit" className="btn-primary">차량 간 이동 실행</button>
            </div>
          </form>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 새 재고실사 전표 생성 모달 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showCreateAuditModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <form onSubmit={handleCreateAuditSubmit} className="card" style={{ width: '90%', maxWidth: '460px', backgroundColor: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '14px' }}>
              <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckSquare size={16} className="text-primary" /> 새 재고실사 전표 생성
              </h3>
              <button type="button" className="btn-secondary" onClick={() => setShowCreateAuditModal(false)} style={{ padding: '3px 8px' }}>
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>실사 대상 창고 / 장소 *</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setNewAuditTargetType('HQ')}
                    className={newAuditTargetType === 'HQ' ? 'btn-primary' : 'btn-secondary'}
                    style={{ padding: '8px', fontSize: '12.5px', fontWeight: 700 }}
                  >
                    🏢 본사 중앙창고
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewAuditTargetType('VEHICLE')}
                    className={newAuditTargetType === 'VEHICLE' ? 'btn-primary' : 'btn-secondary'}
                    style={{ padding: '8px', fontSize: '12.5px', fontWeight: 700 }}
                  >
                    🚚 AS 정비차량
                  </button>
                </div>
              </div>

              {newAuditTargetType === 'VEHICLE' && (
                <div>
                  <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>대상 정비사 (차량) *</label>
                  <select
                    value={newAuditMechanicId}
                    onChange={e => setNewAuditMechanicId(e.target.value)}
                    required
                    style={{ width: '100%', padding: '6px' }}
                  >
                    {mechanics.map(m => (
                      <option key={m.id} value={m.id}>{m.name} 정비사 차량</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label style={{ fontSize: '11.5px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>실사 비고 / 감사 목적</label>
                <input
                  type="text"
                  value={newAuditMemo}
                  onChange={e => setNewAuditMemo(e.target.value)}
                  placeholder="예: 2026년 상반기 정기 차량 재고 실사"
                  style={{ width: '100%', padding: '6px' }}
                />
              </div>

              <div style={{ padding: '10px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                ℹ️ 전표 생성 시 당시의 전산 재고 수량이 스냅샷으로 자동 동결되며, 생성 즉시 상세 대사 그리드에서 실물 수량을 카운트하여 입력할 수 있습니다.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowCreateAuditModal(false)}>취소</button>
              <button type="submit" className="btn-primary">실사 전표 생성</button>
            </div>
          </form>
        </div>
      )}

      {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 회계/재고 대차대조식 검증 바 (헌장 3.5) */}
      <div style={{
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
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          <span>📦 <strong>본사 재고:</strong> {hqStockSummary.totalKinds}종 / {hqStockSummary.totalQty.toLocaleString()}개 (₩{hqStockSummary.totalValue.toLocaleString()}원)</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span>🚚 <strong>차량 이동재고:</strong> {vehicleStockSummary.totalQty.toLocaleString()}개 (₩{vehicleStockSummary.totalValue.toLocaleString()}원)</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span>📥 <strong>당월 구매입고:</strong> {monthlyPurchaseSummary.totalCount}건 (₩{monthlyPurchaseSummary.totalAmount.toLocaleString()}원)</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span>🔧 <strong>당월 정비출고:</strong> {monthlyUseSummary.totalCount}건 (₩{monthlyUseSummary.totalAmount.toLocaleString()}원)</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: 'var(--success-light)',
            color: 'var(--success)',
            fontWeight: 700,
            fontSize: '11px'
          }}>
            ⚖️ 대차 정상 (기초 + 입고 = 기말 + 사용 무결)
          </span>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* 품목 마스터 등록/수정 모달 */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showMasterModal && (
        <div className="modal-backdrop" style={{ display: 'flex', zIndex: 1000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <div className="modal-content" style={{ width: '400px', backgroundColor: 'var(--bg-app)', padding: '20px', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{masterEditingId ? '품목 수정' : '신규 품목 등록'}</h3>
              <button onClick={() => setShowMasterModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} color="var(--text-muted)" />
              </button>
            </div>
            <form onSubmit={handleSaveMaster}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>품목명 *</label>
                  <input type="text" value={masterModelName} onChange={e => setMasterModelName(e.target.value)} required className="form-input" placeholder="예: 유압유 46 (말통)" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>단위</label>
                  <input type="text" value={masterUnit} onChange={e => setMasterUnit(e.target.value)} className="form-input" placeholder="예: 개, 통, 리터" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>기본 단가 (₩)</label>
                  <input type="number" value={masterUnitPrice} onChange={e => setMasterUnitPrice(Number(e.target.value))} min={0} className="form-input" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600 }}>주요 구입처</label>
                  <input type="text" value={masterSupplier} onChange={e => setMasterSupplier(e.target.value)} className="form-input" placeholder="예: 대한상사" />
                </div>
                {!masterEditingId && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600 }}>초기 본사 재고수량</label>
                    <input type="number" value={masterInitialStockQty} onChange={e => setMasterInitialStockQty(Number(e.target.value))} min={0} className="form-input" />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowMasterModal(false)}>취소</button>
                <button type="submit" className="btn-primary">저장</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 모바일 하단 여유 스페이스 */}
      <div style={{ height: '100px', width: '100%' }} aria-hidden="true" />
    </div>
  );
};
