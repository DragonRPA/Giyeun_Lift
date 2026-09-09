// d:\Kiyeun_Lift\src\pages\Dashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Activity, ShieldAlert, Users, Layers, ShieldCheck, Wrench, Truck, CreditCard, ShoppingBag, CheckCircle, Bell, AlertTriangle, ArrowRight, Cloud, AlertCircle, Download, FileText, Bot, Shield, CheckSquare } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { PDFDocument } from 'pdf-lib';
import { 
  generateContractPdf, 
  generateChecklistPdf, 
  generateSafetyInspectionPdf 
} from '../services/excelTemplateEngine';
import { getDriveReadToken, extractDriveFolderId, listFilesInDriveFolder } from '../services/googleDriveBackup';
import { EXPECTED_AGENT_VERSION, AGENT_DOWNLOAD_URL, AGENT_CERT_URL, AGENT_INSTALL_BAT_URL, AGENT_KILL_BAT_URL } from '../services/agentService';
import { findActiveTasksForUser } from '../utils/taskHandoverPipeline';
import { ExecutiveDirectiveModal } from '../components/ExecutiveDirectiveModal';
import { ContractDocumentBundleModal } from '../components/ContractDocumentBundleModal';
import { Todo } from '../services/db';

export const Dashboard: React.FC = () => {
  const { 
    currentUser, 
    hasPermission, 
    assets, 
    contracts, 
    contractAssets, 
    consumables, 
    repairs, 
    deliveries, 
    billings, 
    customers, 
    sites, 
    products, 
    todos, 
    googleConfigs, 
    completeTodo, 
    resolveExecutiveDirective,
    setActiveTab, 
    setNavigationPayload,
    currentTenant 
  } = useApp();

  // 경영진 업무지시 하달 모달 및 조치 보고 상태
  const [showDirectiveModal, setShowDirectiveModal] = useState(false);
  const [reportingDirectiveTodo, setReportingDirectiveTodo] = useState<Todo | null>(null);
  const [directiveReportNote, setDirectiveReportNote] = useState<string>('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  const userRole = currentUser?.role || 'SALES';
  const userDept = currentUser?.department || '';
  const isExecUser = userRole === 'ADMIN' || userRole === 'EXECUTIVE' || userRole === 'MANAGER' || userDept.includes('경영') || userDept.includes('대표');

  // 사용자 메뉴 권한 기반 카드 노출 판단 플래그 (조치/저장 실행 권한 기준 단일 표준 ID)
  const canActDelivery = hasPermission('delivery', 'save');
  const canActRepair = hasPermission('repair', 'save');
  const canActBilling = hasPermission('billing', 'save');
  const canActContract = hasPermission('contract', 'save');
  const canActConsumable = hasPermission('consumable', 'save');
  const canActRentAsset = hasPermission('rent_asset', 'save');
  const canGeneratePackage = hasPermission('agent_badge', 'view');  // 계약서 패키지 생성 권한 = agent_badge

  // ── 📄 계약서패키지 재발송 모달 상태 ──
  const [showBundleModal, setShowBundleModal] = useState(false);
  const [bundleTargetContractId, setBundleTargetContractId] = useState<string | undefined>(undefined);

  // ── 🤖 로컬 사이드카 에이전트 실시간 모니터링 상태 ──
  const [agentStatus, setAgentStatus] = useState<'ONLINE' | 'OFFLINE'>('OFFLINE');
  const [agentCallsign, setAgentCallsign] = useState<string>('');
  const [agentVersion, setAgentVersion] = useState<string>('');
  const [isDownloadingAgent, setIsDownloadingAgent] = useState(false);
  const [isRestartingAgent, setIsRestartingAgent] = useState(false);
  const [showAgentGuideModal, setShowAgentGuideModal] = useState(false);

  // 에이전트 헬스체크 및 실시간 콜사인 동기화 (3초 주기)
  useEffect(() => {
    let isMounted = true;
    const checkAgent = async () => {
      try {
        const userCallsign = currentUser?.loginId || currentUser?.name || 'admin';
        const res = await fetch(`http://127.0.0.1:5175/health?callsign=${encodeURIComponent(userCallsign)}`, { method: 'GET', signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setAgentStatus('ONLINE');
            setAgentCallsign(data.callsign || userCallsign);
            setAgentVersion(data.version || '');
          }
          return;
        }
      } catch (e) {}
      if (isMounted) {
        setAgentStatus('OFFLINE');
        setAgentCallsign('');
        setAgentVersion('');
      }
    };
    checkAgent();
    const interval = setInterval(checkAgent, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [currentUser]);

  // ── 🔄 에이전트 원클릭 핫 재시작 ──
  const handleRestartAgent = async () => {
    setIsRestartingAgent(true);
    try {
      await fetch('http://127.0.0.1:5175/api/restart', { method: 'POST', signal: AbortSignal.timeout(2000) });
      setTimeout(() => {
        setIsRestartingAgent(false);
      }, 2000);
    } catch (e) {
      setIsRestartingAgent(false);
    }
  };

  // ── 📥 사내 보안 인증서 (.cer & .bat) 다운로드 ──
  const handleDownloadCert = () => {
    try {
      const link1 = document.createElement('a');
      link1.href = AGENT_CERT_URL;
      link1.download = 'eBroAgent_Root.cer';
      document.body.appendChild(link1);
      link1.click();
      document.body.removeChild(link1);

      setTimeout(() => {
        const link2 = document.createElement('a');
        link2.href = AGENT_INSTALL_BAT_URL;
        link2.download = 'install-cert.bat';
        document.body.appendChild(link2);
        link2.click();
        document.body.removeChild(link2);
      }, 500);
    } catch (err: any) {
      alert(`⚠️ 인증서 다운로드 실패: ${err?.message || err}`);
    }
  };

  // ── 📥 Node.js 무설치 단독 실행 파일 (eBroAgent.exe) 직접 다운로드 ──
  const handleDownloadAgentExe = () => {
    setIsDownloadingAgent(true);
    try {
      const link = document.createElement('a');
      link.href = '/downloads/eBroAgent.exe';
      link.download = 'eBroAgent.exe';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert(`⚠️ 에이전트 다운로드 실패: ${err?.message || err}`);
    } finally {
      setIsDownloadingAgent(false);
    }
  };

  // ── 🚀 계약 서류 14p 통합 팩 발행 기능 ──
  const [showContractSelectModal, setShowContractSelectModal] = useState(false);
  const [isMergingDoc, setIsMergingDoc] = useState(false);
  const [mergeProgressLabel, setMergeProgressLabel] = useState('');

  const handleGenerateActiveContractPackage = async (contractId: string) => {
    const targetContract = contracts.find(c => c.id === contractId);
    if (!targetContract) {
      alert('⚠️ 계약 정보를 찾을 수 없습니다.');
      return;
    }

    const customer = customers.find(c => c.id === targetContract.customerId);
    const site = sites.find(s => s.id === targetContract.siteId);
    const cAssets = contractAssets.filter(ca => ca.contractId === contractId);
    const assignedAssets = cAssets.map(ca => {
      const a = assets.find(x => x.id === ca.assetId);
      const prod = a ? products.find(p => p.modelName === a.modelName) : undefined;
      return { ca, asset: a, product: prod };
    });

    const cfg = googleConfigs[0];
    const folderInput = '';
    const folderId = extractDriveFolderId(folderInput);
    const clientId = '';

    setShowContractSelectModal(false);
    setIsMergingDoc(true);

    try {
      const mergedPdf = await PDFDocument.create();

      // 1. 계약서 1p
      setMergeProgressLabel('1단계: 계약서 양식 데이터 주입 중...');
      const contractPdfData = {
        contractDate: targetContract.startDate || new Date().toISOString().split('T')[0],
        lessorName: currentTenant?.corporateName || currentTenant?.tradeName || '주식회사 임대인',
        lessorCeo: currentTenant?.representativeName || '대표자',
        lessorBizNo: currentTenant?.businessNumber || '138-81-83251',
        lesseeName: customer?.name || '주식회사 우진아이엔에스',
        lesseeCeo: customer?.representative || '홍경모',
        lesseeBizNo: customer?.bizRegNo || '114-81-33003',
        deliveryLocation: site?.name || '인천 검단신도시 101 역세권 개발사업',
        siteAddress: site?.address || '인천 연수구 원당동 1061-1',
        deliveryDateTime: `${targetContract.startDate} 인도 예정`,
        managerName: site?.contactName || '양병욱 차장',
        managerPhone: site?.contact || '010-4066-6543',
        assets: assignedAssets.map(item => ({
          modelName: item.asset?.modelName || 'GS-1930',
          quantity: 1,
          serialNo: item.asset ? `${item.asset.assetNo}${item.asset.serialNo ? ` (${item.asset.serialNo})` : ''}` : 'G19052',
          monthlyFee: item.ca.monthlyRentalFee || 300000,
          subtotal: item.ca.monthlyRentalFee || 300000
        })),
        totalMonthlyFee: assignedAssets.reduce((sum, item) => sum + (item.ca.monthlyRentalFee || 300000), 0),
        transportTerms: '2개월 이하 왕복 임차인 부담'
      };

      const contractBytes = await generateContractPdf(contractPdfData);
      const contractDoc = await PDFDocument.load(contractBytes);
      const [contractPage] = await mergedPdf.copyPages(contractDoc, [0]);
      mergedPdf.addPage(contractPage);

      // 2. 체크리스트
      setMergeProgressLabel(`2단계: 체결 장비(${assignedAssets.length}대)별 체크리스트 생성 중...`);
      for (let i = 0; i < assignedAssets.length; i++) {
        const item = assignedAssets[i];
        const checklistBytes = await generateChecklistPdf({
          modelName: item.asset?.modelName || 'GS-1930',
          serialNo: item.asset ? `${item.asset.assetNo}${item.asset.serialNo ? ` (${item.asset.serialNo})` : ''}` : `G1905${i + 1}`
        });
        const clDoc = await PDFDocument.load(checklistBytes);
        const [clPage] = await mergedPdf.copyPages(clDoc, [0]);
        mergedPdf.addPage(clPage);
      }

      // 3. 안전점검결과서
      setMergeProgressLabel(`3단계: 체결 장비(${assignedAssets.length}대)별 안전점검표 생성 중...`);
      for (let i = 0; i < assignedAssets.length; i++) {
        const item = assignedAssets[i];
        const inspectionBytes = await generateSafetyInspectionPdf({
          siteName: site?.name || '인천 검단신도시 101 역세권 개발사업',
          clientName: customer?.name || '주식회사 우진아이엔에스',
          manufacturer: item.product?.manufacturer || item.asset?.manufacturer || 'GENIE',
          modelName: item.asset?.modelName || 'GS-1930',
          serialNo: item.asset?.assetNo || `G1905${i + 1}`,
          weight: item.product?.weight || '1,500 kg',
          speed: item.product?.speed || '4.0 Km/h',
          maxHeightCapacity: item.product?.maxHeightCapacity || '7.8 M / 227 kg',
          safetyCertDate: item.product?.safetyCertDate || '2024-03-01',
          inspectionDate: targetContract.startDate || new Date().toISOString().split('T')[0],
          manufactureYear: item.asset?.manufactureYear || '2024년'
        });
        const inspDoc = await PDFDocument.load(inspectionBytes);
        const [inspPage] = await mergedPdf.copyPages(inspDoc, [0]);
        mergedPdf.addPage(inspPage);
      }

      // 4. 로컬 미러링 문서고 / 원본 서류 결합 (팝업 0회)
      setMergeProgressLabel('4단계: 로컬 미러링 원본 서류 결합 중...');
      try {
        const mirrorRes = await fetch('http://127.0.0.1:5175/api/mirror-status', { signal: AbortSignal.timeout(2000) });
        if (mirrorRes.ok) {
          const mirrorData = await mirrorRes.json();
          const pdfFiles = (mirrorData.files || []).filter((f: any) => f.name.toLowerCase().endsWith('.pdf') && !f.name.includes('임대차계약서') && !f.name.includes('반입전체크리스트') && !f.name.includes('안전점검'));

          for (const mFile of pdfFiles) {
            try {
              const fileRes = await fetch(`http://127.0.0.1:5175/api/get-file?fileName=${encodeURIComponent(mFile.name)}`);
              if (fileRes.ok) {
                const drivePdfBytes = await fileRes.arrayBuffer();
                const driveDoc = await PDFDocument.load(drivePdfBytes);
                const copiedPages = await mergedPdf.copyPages(driveDoc, driveDoc.getPageIndices());
                copiedPages.forEach(p => mergedPdf.addPage(p));
              }
            } catch (e) {}
          }
        }
      } catch (mirrorErr) {}

      // 5. 다운로드 및 로컬 아카이빙
      const finalBytes = await mergedPdf.save();
      const blob = new Blob([finalBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      const tenantBrand = currentTenant?.displayName || currentTenant?.tradeName || 'e-Bro';
      link.download = `[${tenantBrand}]_${targetContract.contractNo}_${customer?.name || '계약서'}_통합팩_${mergedPdf.getPageCount()}p_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      let localSaveMsg = '';
      if (agentStatus === 'ONLINE') {
        try {
          const agentRes = await fetch('http://127.0.0.1:5175/api/execute-job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jobType: 'CONTRACT_BUNDLE',
              contractNo: targetContract.contractNo,
              customerName: customer?.name || '고객사',
              pageCount: mergedPdf.getPageCount()
            })
          });
          if (agentRes.ok) {
            const agentData = await agentRes.json();
            localSaveMsg = `\n\n📂 [로컬 문서고 자동 보관 완료]\n저장 경로: ${agentData.localFilePath || 'C:\\eBroAgent\\문서고'}`;
          }
        } catch (e) {}
      }

      alert(`🎉 [계약: ${targetContract.contractNo}] 3대 핵심 서류 + 드라이브 원본 결합 성공!\n\n총 ${mergedPdf.getPageCount()}페이지 단일 PDF로 완벽하게 병합 다운로드되었습니다.${localSaveMsg}`);
    } catch (err: any) {
      alert(`⚠️ 서류 팩 생성 실패: ${err?.message || err}`);
    } finally {
      setIsMergingDoc(false);
      setMergeProgressLabel('');
    }
  };

  const activeTasks = useMemo(() => findActiveTasksForUser(todos, currentUser, hasPermission), [todos, currentUser, hasPermission]);
  const myTodos = activeTasks;

  const totalAssets = assets.length;
  const rentedAssets = assets.filter(a => a.status === 'RENTED').length;
  const availableAssets = assets.filter(a => a.status === 'AVAILABLE').length;
  const repairingAssets = assets.filter(a => a.status === 'REPAIRING').length;

  const activeContracts = contracts.filter(c => c.status === 'ACTIVE' || c.status === 'EXTENDED').length;
  const lowStockConsumables = consumables.filter(c => c.stockQty < 5).length;
  const pendingRepairs = repairs.filter(r => r.status === 'PENDING' || r.status === 'IN_PROGRESS').length;
  const activeDeliveries = deliveries.filter(d => d.status !== 'COMPLETED').length;

  const unpaidBillings = billings.filter(b => b.status !== 'PAID');
  const totalUnpaidAmount = unpaidBillings.reduce((sum, b) => sum + (b.totalAmount - b.paidAmount), 0);

  // 임차 자산 반납 지연 및 전대 계약 미스매치 계산
  const allRentedAssets = assets.filter(a => a.ownerType === 'RENTED');

  const checkRentedDelayDays = (asset: any): number => {
    if (!asset.rentEnd) return 0;
    const plannedEnd = new Date(asset.rentEnd);
    const actualEnd = asset.actualRentReturnDate 
      ? new Date(asset.actualRentReturnDate) 
      : new Date();
    plannedEnd.setHours(0,0,0,0);
    actualEnd.setHours(0,0,0,0);
    const diffTime = actualEnd.getTime() - plannedEnd.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  const isSubleaseMismatch = (asset: any): boolean => {
    if (!asset.rentEnd || !asset.contractEnd) return false;
    const leaseEnd = new Date(asset.rentEnd);
    const subleaseEnd = new Date(asset.contractEnd);
    leaseEnd.setHours(0,0,0,0);
    subleaseEnd.setHours(0,0,0,0);
    return subleaseEnd.getTime() > leaseEnd.getTime();
  };

  const overdueRentedCount = allRentedAssets.filter(a => a.status !== 'RENTED_RETURNED' && checkRentedDelayDays(a) > 0).length;
  const mismatchRentedCount = allRentedAssets.filter(a => isSubleaseMismatch(a)).length;

  // 최근 활동 내역 합성
  const activities: { id: string; type: string; text: string; date: string; icon: React.ReactNode }[] = [];
  
  contracts.slice(-3).forEach(c => {
    const cust = customers.find(cust => cust.id === c.customerId);
    activities.push({
      id: `act-c-${c.id}`,
      type: '계약',
      text: `계약 등록: ${cust?.name || '고객'} (${c.contractNo})`,
      date: c.createdAt.substring(0, 10),
      icon: <Layers size={16} className="text-primary" />
    });
  });

  repairs.slice(-3).forEach(r => {
    const asset = assets.find(a => a.id === r.assetId);
    activities.push({
      id: `act-r-${r.id}`,
      type: '정비',
      text: `정비 등록: [${asset?.assetNo || '자산'}] ${r.details.substring(0, 20)}...`,
      date: r.createdAt.substring(0, 10),
      icon: <Wrench size={16} className="text-warning" />
    });
  });

  deliveries.slice(-3).forEach(d => {
    const contr = contracts.find(c => c.id === d.contractId);
    const cust = contr ? customers.find(cust => cust.id === contr.customerId) : null;
    activities.push({
      id: `act-d-${d.id}`,
      type: '배차',
      text: `${d.type === 'OUTBOUND' ? '출고' : '회수'} 배차 상태: [${d.status}] ${cust?.name || ''}`,
      date: d.createdAt.substring(0, 10),
      icon: <Truck size={16} className="text-info" />
    });
  });

  activities.sort((a, b) => b.date.localeCompare(a.date));

  const role = currentUser?.role || 'SALES';

  // 직무 역할 한글 매핑 및 배지 색상
  const getRoleBadge = () => {
    switch (role) {
      case 'ADMIN': return { text: '최고관리자 (ADMIN)', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };
      case 'MANAGER': return { text: '부서관리자 (MANAGER)', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' };
      case 'SALES': return { text: '영업담당자 (SALES)', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' };
      case 'REPAIR':
      case 'MECHANIC': return { text: '정비담당자 (MECHANIC)', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
      case 'LOGISTICS':
      case 'DELIVERY': return { text: '배차물류담당자 (LOGISTICS)', color: '#06b6d4', bg: 'rgba(6,182,212,0.1)' };
      default: return { text: '임직원 (USER)', color: 'var(--text-muted)', bg: 'var(--bg-secondary)' };
    }
  };

  const badge = getRoleBadge();

  return (
    <div className="dashboard-page" style={{ maxWidth: '850px', margin: '0 auto', paddingBottom: '40px' }}>
      
      {/* 웰컴 상단 바 */}
      <div className="card" style={{
        margin: '0 0 24px 0', padding: '24px', borderRadius: '12px',
        background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-secondary) 100%)',
        border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ fontSize: '22px', fontWeight: '800', margin: 0 }}>반갑습니다, {currentUser?.name || '임직원'}님!</h2>
            <span style={{
              fontSize: '11px', fontWeight: '800', padding: '3px 8px', borderRadius: '4px',
              color: badge.color, backgroundColor: badge.bg, border: `1px solid ${badge.color}`
            }}>
              {badge.text}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* 계약 서류 14p 통합 팩 발행 버튼 */}
          <button
            type="button"
            className="btn-primary"
            disabled={isMergingDoc}
            onClick={() => setShowContractSelectModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px',
              fontSize: '13px', fontWeight: '800', whiteSpace: 'nowrap',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              border: 'none', borderRadius: '8px', color: '#fff', cursor: isMergingDoc ? 'wait' : 'pointer',
              boxShadow: '0 4px 10px rgba(37,99,235,0.25)'
            }}
          >
            <Download size={15} />
            {isMergingDoc ? '서류 팩 생성 중...' : '계약 서류 14p 통합 팩'}
          </button>

          {/* ⚡ 경영진 업무지시 하달 버튼 (경영진/관리자 전용) */}
          {isExecUser && (
            <button
              type="button"
              onClick={() => setShowDirectiveModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px',
                fontSize: '13px', fontWeight: '800', whiteSpace: 'nowrap',
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(239, 68, 68, 0.25)'
              }}
            >
              <ShieldAlert size={15} />
              경영진 업무지시 하달
            </button>
          )}

          {role === 'ADMIN' && (
            <button 
              className="btn-danger" 
              onClick={() => {
                if(confirm('모든 로컬 데이터를 삭제하고 방금 주입된 100개의 테스트 데이터로 초기화하시겠습니까?')) {
                  localStorage.clear();
                  location.reload();
                }
              }}
              style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '8px', fontWeight: 'bold' }}
            >
              🔄 테스트 리셋
            </button>
          )}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────── */}
      {/* 권한(Permission) 기반 스마트 카드 피드 렌더링 섹션 */}
      {/* ──────────────────────────────────────────────────────── */}
      {(() => {
        const requestedDeliveries = deliveries.filter(d => d.status === 'REQUESTED');
        const showDeliveryFeed = requestedDeliveries.length > 0 && canActDelivery;
        const showBillingFeed = unpaidBillings.length > 0 && canActBilling;
        const showRentAssetFeed = (overdueRentedCount > 0 || mismatchRentedCount > 0) && canActRentAsset;
        const showRepairFeed = pendingRepairs > 0 && canActRepair;
        const showConsumableFeed = lowStockConsumables > 0 && canActConsumable;
        const showContractFeed = activeContracts > 0 && canActContract;
        const showTodoFeed = myTodos.length > 0;

        const visibleCount = [showDeliveryFeed, showBillingFeed, showRentAssetFeed, showRepairFeed, showConsumableFeed, showContractFeed, showTodoFeed].filter(Boolean).length;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* 1. 출고/회수 배차 대기 피드 카드 (배차 저장/실행 권한자 표출) */}
            {showDeliveryFeed && (
              <div style={{
                backgroundColor: 'var(--bg-card)', borderRadius: '12px', padding: '20px 24px',
                borderLeft: '5px solid #06b6d4', border: '1px solid var(--border-color)', borderLeftWidth: '5px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: '800', color: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.12)', padding: '3px 9px', borderRadius: '4px', border: '1px solid rgba(6,182,212,0.3)' }}>
                    배차 관리
                  </span>
                  <span style={{ fontSize: '12.5px', fontWeight: '700', color: '#06b6d4' }}>
                    배차 대기 {requestedDeliveries.length}건
                  </span>
                </div>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Truck size={18} color="#06b6d4" /> 출고/회수 배차 대기
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                  차량 미배정 배차 요청 <strong>{requestedDeliveries.length}건</strong> 대기. 운송 기사 수배 및 차량 배차 처리 필요.
                </p>

                {/* 배차 대기 목록 프리뷰 카드 피드 리스트 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                  {requestedDeliveries.slice(0, 3).map((del, idx) => {
                    const contr = contracts.find(c => c.id === del.contractId);
                    const cust = contr ? customers.find(c => c.id === contr.customerId) : null;
                    let cargoSummary = '';
                    try {
                      const items = JSON.parse(del.cargoItems || '[]');
                      cargoSummary = items.map((it: any) => `${it.modelName} ${it.count}대`).join(', ');
                    } catch (e) {
                      cargoSummary = '장비 배정 대기';
                    }

                    return (
                      <div key={del.id} style={{
                        backgroundColor: 'var(--bg-secondary)', padding: '12px 14px', borderRadius: '8px',
                        border: '1px solid var(--border-color)', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '4px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: '800', color: 'var(--text-main)' }}>
                            {idx + 1}. {cust?.name || del.destinationAddress || '고객사 미상'}
                          </span>
                          <span style={{
                            fontSize: '11px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px',
                            backgroundColor: del.type === 'OUTBOUND' ? 'rgba(59,130,246,0.15)' : 'rgba(245,158,11,0.15)',
                            color: del.type === 'OUTBOUND' ? '#3b82f6' : '#f59e0b'
                          }}>
                            {del.type === 'OUTBOUND' ? '출고 배차' : '회수 배차'} (요청: {del.requestDate || del.createdAt.substring(0, 10)})
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          <span>🚩 <strong>하차지:</strong> {del.destinationAddress}</span>
                          {cargoSummary && <span style={{ color: '#06b6d4', fontWeight: 'bold' }}>⚙️ {cargoSummary}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button className="btn-primary" onClick={() => setActiveTab('delivery')} style={{ backgroundColor: '#06b6d4', border: 'none', fontSize: '12.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  배차 관리 이동 <ArrowRight size={13} />
                </button>
              </div>
            )}

            {/* 2. 전사 미수금 회수 카드 (수납/청구 저장/실행 권한자 표출) */}
            {showBillingFeed && (
              <div style={{
                backgroundColor: 'var(--bg-card)', borderRadius: '12px', padding: '20px 24px',
                borderLeft: '5px solid #ef4444', border: '1px solid var(--border-color)', borderLeftWidth: '5px'
              }}>
                <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '800', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', padding: '2px 8px', borderRadius: '4px' }}>미수금 관리</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>수납 미완료 {unpaidBillings.length}건</span>
                </div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CreditCard size={18} color="#ef4444" /> 렌탈 매출 미수금 대장
                </h4>
                <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                  수납 미완료 대금 총 <strong style={{ color: '#ef4444', fontSize: '15px' }}>{totalUnpaidAmount.toLocaleString()}원</strong> ({unpaidBillings.length}건).
                </p>
                <button className="btn-primary" onClick={() => setActiveTab('billing')} style={{ backgroundColor: '#ef4444', border: 'none', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  수납/청구 관리 이동 <ArrowRight size={12} />
                </button>
              </div>
            )}

            {/* 3. 소유사(임차) 자산 반납 지연 카드 (임차 자산 저장/실행 권한자 표출) */}
            {showRentAssetFeed && (
              <div style={{
                backgroundColor: 'var(--bg-card)', borderRadius: '12px', padding: '20px 24px',
                borderLeft: '5px solid #f59e0b', border: '1px solid var(--border-color)', borderLeftWidth: '5px'
              }}>
                <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '800', color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: '4px' }}>임차 자산 관리</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{overdueRentedCount + mismatchRentedCount}건</span>
                </div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldAlert size={18} color="#f59e0b" /> 임차 자산 반납 지연 및 만기 불일치
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                  {overdueRentedCount > 0 && `• 반납 기한 초과 임차 장비 ${overdueRentedCount}대. `}
                  {mismatchRentedCount > 0 && `• 매출 계약-임차 만기 불일치 ${mismatchRentedCount}건.`}
                </p>
                <button className="btn-primary" onClick={() => setActiveTab('rent_asset')} style={{ backgroundColor: '#f59e0b', border: 'none', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  임차 자산 관리 이동 <ArrowRight size={12} />
                </button>
              </div>
            )}

            {/* 4. 장비 정비 대기열 카드 (정비 저장/실행 권한자 표출) */}
            {showRepairFeed && (
              <div style={{
                backgroundColor: 'var(--bg-card)', borderRadius: '12px', padding: '20px 24px',
                borderLeft: '5px solid #f59e0b', border: '1px solid var(--border-color)', borderLeftWidth: '5px'
              }}>
                <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '800', color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: '4px' }}>정비 관리</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>미완료 {pendingRepairs}건</span>
                </div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Wrench size={18} color="#f59e0b" /> 장비 정비 대기열
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                  {repairs.filter(r => r.status !== 'COMPLETED').slice(0, 3).map((rep, idx) => {
                    const asset = assets.find(a => a.id === rep.assetId);
                    return (
                      <div key={rep.id} style={{ backgroundColor: 'var(--bg-secondary)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '13px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                          <span>{idx + 1}. 장비번호: <strong style={{ color: 'var(--primary)' }}>{asset?.assetNo || '미정'}</strong> ({asset?.modelName || '미정'})</span>
                          <span style={{ color: 'var(--danger)', fontSize: '11px' }}>정비부담점수: {asset?.maintenanceScore || 0}점</span>
                        </div>
                        <div style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>
                          <strong>불량/의뢰 내용:</strong> {rep.details}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button className="btn-primary" onClick={() => setActiveTab('repair')} style={{ backgroundColor: '#f59e0b', border: 'none', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  정비 관리 이동 <ArrowRight size={12} />
                </button>
              </div>
            )}

            {/* 5. 소모품 재고 부족 카드 (소모품 저장/실행 권한자 표출) */}
            {showConsumableFeed && (
              <div style={{
                backgroundColor: 'var(--bg-card)', borderRadius: '12px', padding: '20px 24px',
                borderLeft: '5px solid #ef4444', border: '1px solid var(--border-color)', borderLeftWidth: '5px'
              }}>
                <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '800', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', padding: '2px 8px', borderRadius: '4px' }}>소모품 관리</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>기준 미달 {lowStockConsumables}종</span>
                </div>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShoppingBag size={18} color="#ef4444" /> 정비 소모품 기준 수량 미달
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                  재고 기준 수량(5개) 미달 품목 <strong>{lowStockConsumables}종</strong>.
                </p>
                <button className="btn-primary" onClick={() => setActiveTab('consumable')} style={{ backgroundColor: '#ef4444', border: 'none', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  소모품 관리 이동 <ArrowRight size={12} />
                </button>
              </div>
            )}

            {/* 6. 영업 및 임대차 계약 관리 카드 (계약 저장/실행 권한자 표출) */}
            {showContractFeed && (
              <div style={{
                backgroundColor: 'var(--bg-card)', borderRadius: '12px', padding: '20px 24px',
                borderLeft: '5px solid #3b82f6', border: '1px solid var(--border-color)', borderLeftWidth: '5px'
              }}>
                <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '800', color: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', padding: '2px 8px', borderRadius: '4px' }}>계약 관리</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>진행 중 계약 {activeContracts}건</span>
                </div>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Layers size={18} color="#3b82f6" /> 렌탈 계약 관리
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                  진행 계약 <strong>{activeContracts}건</strong>.
                </p>
                <button className="btn-primary" onClick={() => setActiveTab('contract')} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  계약 관리 이동 <ArrowRight size={12} />
                </button>
              </div>
            )}

            {/* 7. 직무 맞춤형 당면 과제 ToDo 피드 (헌장 3.3 ToDo 피드 대시보드 정책) */}
            {showTodoFeed && (
              <div style={{
                backgroundColor: 'var(--bg-card)', borderRadius: '12px', padding: '20px 24px',
                borderLeft: '5px solid #6366f1', border: '1px solid var(--border-color)', borderLeftWidth: '5px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '800', color: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', padding: '3px 9px', borderRadius: '4px' }}>
                    담당 업무
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    총 <strong>{activeTasks.length}건</strong> 대기
                  </span>
                </div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Bell size={18} color="#6366f1" /> 업무 목록
                </h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                  {activeTasks.slice(0, 8).map(task => {
                    const isDirective = task.taskCategory === 'EXECUTIVE_DIRECTIVE';
                    const isPackageResend = task.taskCategory === 'CONTRACT_PACKAGE_RESEND';
                    const priorityColor = task.priority === 'URGENT' ? '#ef4444' : task.priority === 'HIGH' ? '#f59e0b' : '#3b82f6';
                    
                    return (
                      <div key={task.id} style={{
                        backgroundColor: isDirective ? 'rgba(239, 68, 68, 0.03)' : isPackageResend ? 'rgba(99, 102, 241, 0.04)' : 'var(--bg-secondary)',
                        padding: '14px 16px', borderRadius: '8px',
                        border: isDirective ? '1.5px solid rgba(239, 68, 68, 0.35)' : isPackageResend ? '1.5px solid rgba(99, 102, 241, 0.4)' : '1px solid var(--border-color)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap'
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '260px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {isDirective ? (
                              <span style={{
                                fontSize: '11px', fontWeight: '900', padding: '2px 8px', borderRadius: '4px',
                                backgroundColor: '#ef4444', color: '#fff', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '3px'
                              }}>
                                ⚡ 경영진 특별지시
                              </span>
                            ) : isPackageResend ? (
                              <span style={{
                                fontSize: '11px', fontWeight: '900', padding: '2px 8px', borderRadius: '4px',
                                backgroundColor: '#6366f1', color: '#fff', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '3px'
                              }}>
                                <FileText size={11} /> 패키지 재발송 필요
                              </span>
                            ) : (
                              <span style={{
                                fontSize: '11px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px',
                                backgroundColor: `${priorityColor}15`, color: priorityColor, border: `1px solid ${priorityColor}33`, whiteSpace: 'nowrap'
                              }}>
                                {task.priority || 'NORMAL'}
                              </span>
                            )}

                            {task.dueDate && (
                              <span style={{
                                fontSize: '11px', fontWeight: '700', padding: '2px 6px', borderRadius: '4px',
                                backgroundColor: 'rgba(245,158,11,0.12)', color: '#d97706', border: '1px solid rgba(245,158,11,0.25)', whiteSpace: 'nowrap'
                              }}>
                                📅 마감: {task.dueDate}
                              </span>
                            )}

                            <span style={{ fontWeight: '800', fontSize: '14px', color: 'var(--text-main)' }}>
                              {task.title}
                            </span>
                          </div>

                          {task.content && (
                            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.45', whiteSpace: 'pre-line' }}>
                              {task.content}
                            </p>
                          )}

                          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'flex', gap: '12px', marginTop: '2px', flexWrap: 'wrap' }}>
                            <span>발행자: <strong>{task.senderName || '경영진'}</strong></span>
                            {task.targetDept && <span>대상부서: {task.targetDept}</span>}
                            <span>발행일시: {task.createdAt ? task.createdAt.substring(0, 16).replace('T', ' ') : '-'}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                          {/* 🌟 계약서패키지 원클릭 재발송 모달 호출 버튼 */}
                          {isPackageResend && (
                            <button
                              onClick={() => {
                                setBundleTargetContractId(task.entityId);
                                setShowBundleModal(true);
                              }}
                              style={{
                                fontSize: '12px', padding: '6px 12px', borderRadius: '6px', border: 'none',
                                backgroundColor: '#4f46e5', color: '#fff', fontWeight: '800', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 2px 6px rgba(79,70,229,0.3)',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              <FileText size={13} /> 패키지 재발송 ➔
                            </button>
                          )}

                          {task.actionUrl && task.actionUrl !== '/' && (
                            <button
                              className="btn-primary"
                              onClick={() => {
                                const tabMap: Record<string, string> = {
                                  '/admin/dispatch': 'delivery',
                                  '/admin/outbound_inspections': 'outbound_inspection',
                                  '/admin/contract': 'contract',
                                  '/admin/repairs': 'repair',
                                  '/admin/billings': 'billing',
                                  '/admin/consumables': 'consumable',
                                  '/admin/organization': 'organization',
                                  '/admin/asset_acquisition_disposal': 'asset_acquisition_disposal',
                                  '/admin/delinquency': 'delinquency',
                                  '/admin/cash_flow': 'cash_flow'
                                };
                                const target = tabMap[task.actionUrl || ''] || 'dashboard';
                                setActiveTab(target);
                              }}
                              style={{ fontSize: '12px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                            >
                              처리 이동 <ArrowRight size={12} />
                            </button>
                          )}

                          {isDirective ? (
                            <button
                              onClick={() => {
                                setReportingDirectiveTodo(task);
                                setDirectiveReportNote('');
                              }}
                              style={{
                                fontSize: '12px', padding: '6px 12px', borderRadius: '6px', border: 'none',
                                backgroundColor: '#10b981', color: '#fff', fontWeight: '800', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 2px 6px rgba(16,185,129,0.25)',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              <CheckSquare size={13} /> 조치 결과 보고 & 완료
                            </button>
                          ) : (
                            <button
                              onClick={() => completeTodo(task.id)}
                              style={{
                                fontSize: '12px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
                                backgroundColor: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                                whiteSpace: 'nowrap'
                              }}
                              title="수동 완료 처리"
                            >
                              <CheckSquare size={12} /> 완료
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 8. 나의 권한 범위 내 당면 과제가 0건일 때 완료 안내 카드 */}
            {visibleCount === 0 && (
              <div className="card" style={{ padding: '36px 24px', textAlign: 'center', borderRadius: '12px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
                <div style={{ display: 'inline-flex', padding: '12px', borderRadius: '50%', backgroundColor: 'rgba(34,197,94,0.1)', color: '#22c55e', marginBottom: '12px' }}>
                  <CheckCircle size={36} />
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: '800', margin: '0 0 8px 0' }}>처리 대기 과제 없음</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                  권한 범위 내 처리 대기 항목 없음.
                </p>
              </div>
            )}

          </div>
        );
      })()}

      {/* 🚀 실시간 유효 계약 선택 팝업 모달 */}
      {showContractSelectModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div style={{ backgroundColor: 'var(--card-bg, #fff)', borderRadius: '16px', maxWidth: '750px', width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)', border: '1px solid var(--border)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  계약 서류 14p 통합 팩 발행
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowContractSelectModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {contracts.filter(c => c.status === 'ACTIVE').length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  현재 유효한(ACTIVE) 계약이 없습니다.
                </div>
              ) : (
                contracts.filter(c => c.status === 'ACTIVE').map(c => {
                  const cust = customers.find(x => x.id === c.customerId);
                  const site = sites.find(s => s.id === c.siteId);
                  const cAssetCount = contractAssets.filter(ca => ca.contractId === c.id).length;

                  return (
                    <div
                      key={c.id}
                      style={{
                        padding: '16px 18px', borderRadius: '10px',
                        border: '1px solid var(--border)', backgroundColor: 'var(--bg-app, #f8fafc)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '13px', fontWeight: '800', color: '#2563eb' }}>{c.contractNo}</span>
                          <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>{cust?.name || '고객사'}</span>
                          <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(37, 99, 235, 0.12)', color: 'var(--primary)', border: '1px solid rgba(59, 130, 246, 0.25)', fontWeight: 'bold' }}>
                            장비 {cAssetCount}대
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          <span>📍 현장: <strong>{site?.name || '기본현장'}</strong></span>
                          <span>📅 계약일: {c.startDate}</span>
                        </div>
                      </div>

                      {canGeneratePackage && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleGenerateActiveContractPackage(c.id)}
                        style={{
                          padding: '9px 16px', fontSize: '13px', fontWeight: '700', whiteSpace: 'nowrap',
                          display: 'flex', alignItems: 'center', gap: '6px',
                          background: '#2563eb', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer'
                        }}
                      >
                        <Download size={15} />
                        통합 팩 발행
                      </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', backgroundColor: 'var(--bg-app, #f8fafc)', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowContractSelectModal(false)}
                style={{ padding: '8px 16px', fontSize: '13px', fontWeight: '600' }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🤖 로컬 에이전트 다운로드 및 가이드 모달 */}
      {showAgentGuideModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
          <div style={{ backgroundColor: 'var(--card-bg, #fff)', borderRadius: '16px', maxWidth: '650px', width: '100%', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)', border: '1px solid var(--border)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Bot size={20} color="#4f46e5" />
                로컬 사이드카 에이전트 가동 가이드
              </h3>
              <button
                type="button"
                onClick={() => setShowAgentGuideModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px 24px', fontSize: '13.5px', lineHeight: '1.6', color: 'var(--text-primary)' }}>
              <p style={{ margin: '0 0 14px 0' }}>
                <strong>로컬 사이드카 에이전트</strong>를 실행해 두시면, 웹 브라우저의 렌더링 한계를 넘어 <strong>마이크로소프트 엑셀 정품 파일에 직접 데이터를 주입</strong>하고 <strong>100% 무손실 정품 PDF를 생산</strong>하여 사내 로컬 문서고(<code>C:\eBroAgent\문서고\</code>)에 자동 보관합니다.
              </p>

              <div style={{ backgroundColor: 'var(--bg-app, #f8fafc)', padding: '14px 16px', borderRadius: '10px', border: '1px solid var(--border)', marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '700', color: '#4f46e5' }}>
                  ⚡ 최초 1회 실행 3단계 순서:
                </h4>
                <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <li>
                    <a href="https://nodejs.org/en/download/" target="_blank" rel="noreferrer" style={{ color: '#16a34a', fontWeight: '700' }}>🟢 Node.js 공식 사이트</a>에서 LTS 버전을 설치합니다. (최초 1회, PC당 1회)
                  </li>
                  <li>
                    <strong>[2단계: 🛡️ 보안 인증서 등록]</strong> 버튼을 누르면 배치 파일이 내려옵니다. 배치 파일을 실행하여 PC에 1회 등록합니다.
                  </li>
                  <li>
                    <strong>[3단계: 📥 에이전트 파일 받기]</strong> 버튼을 누르면 <code>eBroAgent.js</code>와 <code>start-agent.bat</code>이 내려옵니다. 두 파일을 <code>C:\eBroAgent\</code>에 넣은 뒤 <code>start-agent.bat</code>을 실행합니다.
                  </li>
                </ol>
              </div>


              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                💡 에이전트가 꺼져 있어도 웹 브라우저 자체 렌더링 엔진으로 PDF 생성이 100% 정상 작동합니다.
              </p>
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', backgroundColor: 'var(--bg-app, #f8fafc)', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowAgentGuideModal(false)}
                style={{ padding: '8px 18px', fontSize: '13px', fontWeight: '700' }}
              >
                확인 완료
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ⚡ 경영진 업무지시 하달 모달 */}
      <ExecutiveDirectiveModal
        isOpen={showDirectiveModal}
        onClose={() => setShowDirectiveModal(false)}
      />

      {/* 📝 경영진 업무지시 조치 결과 보고 및 완료 모달 */}
      {reportingDirectiveTodo && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card, #ffffff)', borderRadius: '14px',
            width: '100%', maxWidth: '540px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
            border: '1px solid var(--border-color)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden'
          }}>
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid var(--border-color)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: 'var(--bg-secondary)'
            }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CheckSquare size={18} color="#10b981" />
                경영진 특별지시 조치 결과 보고
              </h3>
              <button
                onClick={() => setReportingDirectiveTodo(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '12px 14px', borderRadius: '8px' }}>
                <div style={{ fontSize: '11px', color: '#ef4444', fontWeight: '800', marginBottom: '4px' }}>
                  지시명: {reportingDirectiveTodo.title}
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  {reportingDirectiveTodo.content}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-main)' }}>
                  조치 및 처리 결과 보고 메모 (필수)
                </label>
                <textarea
                  rows={4}
                  value={directiveReportNote}
                  onChange={e => setDirectiveReportNote(e.target.value)}
                  placeholder="지시받은 업무에 대해 실제 조치한 내용, 현장 상황, 완료 결과 등을 상세히 기록해 주십시오."
                  style={{
                    padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-card)', fontSize: '13px', color: 'var(--text-main)',
                    lineHeight: '1.5', resize: 'vertical'
                  }}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setReportingDirectiveTodo(null)}
                  style={{
                    padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-color)',
                    backgroundColor: 'transparent', color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer'
                  }}
                >
                  닫기
                </button>
                <button
                  type="button"
                  disabled={isSubmittingReport || !directiveReportNote.trim()}
                  onClick={async () => {
                    try {
                      setIsSubmittingReport(true);
                      await resolveExecutiveDirective(reportingDirectiveTodo.id, directiveReportNote.trim());
                      setReportingDirectiveTodo(null);
                      setDirectiveReportNote('');
                    } catch (err: any) {
                      alert(`조치 보고 실패: ${err?.message || err}`);
                    } finally {
                      setIsSubmittingReport(false);
                    }
                  }}
                  style={{
                    padding: '8px 20px', borderRadius: '8px', border: 'none',
                    backgroundColor: '#10b981', color: '#fff', fontSize: '13px', fontWeight: '800',
                    cursor: (isSubmittingReport || !directiveReportNote.trim()) ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 10px rgba(16,185,129,0.3)'
                  }}
                >
                  {isSubmittingReport ? '보고 중...' : '조치 완료 보고 제출'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📄 계약서패키지 원클릭 재발송 모달 */}
      <ContractDocumentBundleModal
        isOpen={showBundleModal}
        onClose={() => {
          setShowBundleModal(false);
          setBundleTargetContractId(undefined);
        }}
        initialContractId={bundleTargetContractId}
      />

    </div>
  );
};
