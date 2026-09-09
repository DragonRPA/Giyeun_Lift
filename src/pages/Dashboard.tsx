// d:\Kiyeun_Lift\src\pages\Dashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Activity, ShieldAlert, Users, Layers, ShieldCheck, Wrench, Truck, CreditCard, CheckCircle, Bell, AlertTriangle, ArrowRight, Cloud, AlertCircle, Download, FileText, Bot, Shield, CheckSquare } from 'lucide-react';
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
    contractHistory,
    outboundInspections,
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

  const isTrueDeveloper = currentUser?.loginId === 'admin' || currentUser?.id === 'sys-admin';
  const userRole = currentUser?.role || 'SALES';
  const userDept = currentUser?.department || '';
  const isExecUser = userRole === 'ADMIN' || userRole === 'EXECUTIVE' || userRole === 'MANAGER' || userDept.includes('경영') || userDept.includes('대표');

  // 사용자 메뉴 권한 기반 카드 노출 판단 플래그 (조치/저장 실행 권한 기준 단일 표준 ID + 담당 역할/부서/조회 권한 fallback)
  const canActAssign = hasPermission('dispatch_assign', 'save') || hasPermission('dispatch_assign', 'view') || isExecUser || userRole === 'LOGISTICS' || userRole === 'DELIVERY' || userRole === 'YARD' || (userDept && (userDept.includes('출고') || userDept.includes('주기장') || userDept.includes('배차') || userDept.includes('물류')));
  const canActOutboundInspection = hasPermission('outbound_inspections', 'save') || hasPermission('outbound_inspections', 'view') || hasPermission('repair', 'save') || isExecUser || userRole === 'MECHANIC' || userRole === 'REPAIR' || userRole === 'YARD' || (userDept && (userDept.includes('출고') || userDept.includes('검수') || userDept.includes('정비') || userDept.includes('주기장')));
  const canActDelivery = hasPermission('delivery', 'save') || hasPermission('delivery', 'view') || isExecUser || userRole === 'LOGISTICS' || userRole === 'DELIVERY' || (userDept && (userDept.includes('배차') || userDept.includes('운송') || userDept.includes('물류')));
  const canActRepair = hasPermission('repair', 'save') || hasPermission('repair', 'view') || isExecUser || userRole === 'REPAIR' || userRole === 'MECHANIC' || (userDept && (userDept.includes('정비') || userDept.includes('AS') || userDept.includes('주기장')));
  const canActBilling = hasPermission('billing', 'save') || hasPermission('billing', 'view') || isExecUser || userRole === 'ACCOUNTING' || (userDept && (userDept.includes('회계') || userDept.includes('관리') || userDept.includes('경리')));
  const canActContract = hasPermission('contract', 'save') || hasPermission('contract', 'view') || isExecUser || userRole === 'SALES' || (userDept && (userDept.includes('영업') || userDept.includes('영업부')));
  const canActRentAsset = hasPermission('rent_asset', 'save') || hasPermission('rent_asset', 'view') || isExecUser || userRole === 'LOGISTICS' || userRole === 'DELIVERY' || (userDept && (userDept.includes('출고') || userDept.includes('배차') || userDept.includes('주기장')));

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

  const activeTasks = useMemo(() => findActiveTasksForUser(todos, currentUser, hasPermission), [todos, currentUser, hasPermission]);
  const myTodos = activeTasks;

  const totalAssets = assets.length;
  const rentedAssets = assets.filter(a => a.status === 'RENTED').length;
  const availableAssets = assets.filter(a => a.status === 'AVAILABLE').length;
  const repairingAssets = assets.filter(a => a.status === 'REPAIRING').length;

  const activeContracts = contracts.filter(c => c.status === 'ACTIVE' || c.status === 'EXTENDED').length;
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
      text: `정비 등록: ${asset?.assetNo || '자산'} ${r.details.substring(0, 20)}...`,
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
      case 'ADMIN': 
        return isTrueDeveloper 
          ? { text: '시스템 개발자 (DEV)', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' }
          : { text: '최고관리자 (ADMIN)', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };
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
            <h2 style={{ fontSize: '22px', fontWeight: '800', margin: 0 }}>반갑습니다, {isTrueDeveloper ? '개발자' : (currentUser?.name || '임직원')}님!</h2>
            <span style={{
              fontSize: '11px', fontWeight: '800', padding: '3px 8px', borderRadius: '4px',
              color: badge.color, backgroundColor: badge.bg, border: `1px solid ${badge.color}`
            }}>
              {badge.text}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
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
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────── */}
      {/* 권한(Permission) 기반 스마트 카드 피드 렌더링 섹션 */}
      {/* ──────────────────────────────────────────────────────── */}
      {(() => {
        // 1. 계약 장비 할당 대기 건 (계약 체결 후 자산 미매핑 슬롯)
        const unassignedContractAssets = contractAssets.filter(ca => !ca.assetId);
        const unassignedContractIds = Array.from(new Set(unassignedContractAssets.map(ca => ca.contractId)));
        const showAssignFeed = unassignedContractAssets.length > 0 && canActAssign;

        // 2. 출고 PDI 검수 대기 건 (장비 할당 후 검수 대기/진행)
        const pendingOutboundInspections = (outboundInspections || []).filter(i => {
          const st = i.status || 'PENDING';
          return st === 'PENDING' || st === 'IN_PROGRESS';
        });
        const pendingInspectionContractIds = Array.from(new Set(pendingOutboundInspections.map(i => i.contractId)));
        const showOutboundInspectionFeed = pendingOutboundInspections.length > 0 && canActOutboundInspection;

        // 3. 배차 대기 건
        const requestedDeliveries = deliveries.filter(d => {
          const st = d.status || 'PENDING';
          return st === 'PENDING' || st === 'REQUESTED' || (st !== 'DISPATCHED' && st !== 'DELIVERED' && st !== 'COMPLETED' && st !== 'CANCELLED');
        });
        const showDeliveryFeed = requestedDeliveries.length > 0 && canActDelivery;

        // 4. 정비 대기 건
        const showRepairFeed = pendingRepairs > 0 && canActRepair;

        // 5. 미수금 대장
        const showBillingFeed = unpaidBillings.length > 0 && canActBilling;

        // 6. 임차 자산 반납 지연
        const showRentAssetFeed = (overdueRentedCount > 0 || mismatchRentedCount > 0) && canActRentAsset;

        // 7. 진행 계약
        const showContractFeed = activeContracts > 0 && canActContract;

        // 8. 직무 맞춤 당면 과제 ToDo
        const showTodoFeed = myTodos.length > 0;

        const visibleCount = [showTodoFeed, showAssignFeed, showOutboundInspectionFeed, showDeliveryFeed, showRepairFeed, showBillingFeed, showRentAssetFeed, showContractFeed].filter(Boolean).length;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* 1. 계약 장비 할당 대기 피드 카드 (장비할당/배차/주기장 담당자 표출) */}
            {showAssignFeed && (
              <div style={{
                backgroundColor: 'var(--bg-card)', borderRadius: '12px', padding: '20px 24px',
                borderLeft: '5px solid #8b5cf6', border: '1px solid var(--border-color)', borderLeftWidth: '5px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: '800', color: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.12)', padding: '3px 9px', borderRadius: '4px', border: '1px solid rgba(139,92,246,0.3)' }}>
                    장비 할당 (매핑)
                  </span>
                  <span style={{ fontSize: '12.5px', fontWeight: '700', color: '#8b5cf6' }}>
                    미할당 {unassignedContractAssets.length}대 ({unassignedContractIds.length}개 계약)
                  </span>
                </div>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Layers size={18} color="#8b5cf6" /> 계약 장비 할당 대기
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                  계약 체결 후 관리번호 미매핑 슬롯 <strong>{unassignedContractAssets.length}대</strong> 대기. 가용 재고에서 장비 배정 필요.
                </p>

                {/* 미할당 계약 프리뷰 리스트 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                  {unassignedContractIds.slice(0, 3).map((cid, idx) => {
                    const contr = contracts.find(c => c.id === cid);
                    const cust = contr ? customers.find(c => c.id === contr.customerId) : null;
                    const slots = unassignedContractAssets.filter(ca => ca.contractId === cid);
                    const isExchange = contractHistory ? contractHistory.some(h => h.contractId === cid && h.changeType === 'EXCHANGE') : false;
                    const modelSummary = slots.map(s => s.expectedModel || '미지정').join(', ');

                    return (
                      <div key={cid} style={{
                        backgroundColor: 'var(--bg-secondary)', padding: '12px 14px', borderRadius: '8px',
                        border: '1px solid var(--border-color)', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '4px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: '800', color: 'var(--text-main)' }}>
                            {idx + 1}. {cust?.name || contr?.contractNo || '고객사'}
                          </span>
                          <span style={{
                            fontSize: '11px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px',
                            backgroundColor: isExchange ? 'rgba(239,68,68,0.15)' : 'rgba(139,92,246,0.15)',
                            color: isExchange ? '#ef4444' : '#8b5cf6'
                          }}>
                            {isExchange ? '대차 할당 우선' : '신규 계약'} (미할당 {slots.length}대)
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          <span>📄 <strong>계약번호:</strong> {contr?.contractNo || '-'}</span>
                          <span>📦 <strong>요구모델:</strong> <strong style={{ color: '#8b5cf6' }}>{modelSummary}</strong></span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button className="btn-primary" onClick={() => setActiveTab('dispatch_assign')} style={{ backgroundColor: '#8b5cf6', border: 'none', fontSize: '12.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  장비 할당 이동 <ArrowRight size={13} />
                </button>
              </div>
            )}

            {/* 2. 출고 PDI 검수 승인 대기 피드 카드 (검수/정비/출고 담당자 표출) */}
            {showOutboundInspectionFeed && (
              <div style={{
                backgroundColor: 'var(--bg-card)', borderRadius: '12px', padding: '20px 24px',
                borderLeft: '5px solid #10b981', border: '1px solid var(--border-color)', borderLeftWidth: '5px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: '800', color: '#10b981', backgroundColor: 'rgba(16,185,129,0.12)', padding: '3px 9px', borderRadius: '4px', border: '1px solid rgba(16,185,129,0.3)' }}>
                    출고 검수 관리
                  </span>
                  <span style={{ fontSize: '12.5px', fontWeight: '700', color: '#10b981' }}>
                    검수 대기 {pendingOutboundInspections.length}건 ({pendingInspectionContractIds.length}개 의뢰)
                  </span>
                </div>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckSquare size={18} color="#10b981" /> 출고 PDI 검수 승인 대기
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 14px 0', lineHeight: '1.5' }}>
                  장비 할당 완료 후 출고 전 PDI 안전점검 및 승인 대기 <strong>{pendingOutboundInspections.length}건</strong>. 승인 시 자산 상태가 대여중(RENTED)으로 전환.
                </p>

                {/* 검수 대기 목록 프리뷰 카드 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                  {pendingOutboundInspections.slice(0, 3).map((insp, idx) => {
                    const contr = contracts.find(c => c.id === insp.contractId);
                    const cust = contr ? customers.find(c => c.id === contr.customerId) : null;
                    const asset = assets.find(a => a.id === insp.assetId);

                    return (
                      <div key={insp.id} style={{
                        backgroundColor: 'var(--bg-secondary)', padding: '12px 14px', borderRadius: '8px',
                        border: '1px solid var(--border-color)', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '4px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: '800', color: 'var(--text-main)' }}>
                            {idx + 1}. {cust?.name || contr?.contractNo || '고객사 미상'}
                          </span>
                          <span style={{
                            fontSize: '11px', fontWeight: '800', padding: '2px 6px', borderRadius: '4px',
                            backgroundColor: insp.status === 'IN_PROGRESS' ? 'rgba(59,130,246,0.15)' : 'rgba(245,158,11,0.15)',
                            color: insp.status === 'IN_PROGRESS' ? '#2563eb' : '#d97706'
                          }}>
                            {insp.status === 'IN_PROGRESS' ? '검수 진행중' : '접수 대기'}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          <span>🚜 <strong>할당장비:</strong> <strong style={{ color: '#10b981' }}>{asset?.assetNo || '장비'}</strong> ({asset?.modelName || '-'})</span>
                          <span>📅 <strong>의뢰일:</strong> {insp.createdAt ? insp.createdAt.substring(0, 10) : '-'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button className="btn-primary" onClick={() => setActiveTab('outbound_inspections')} style={{ backgroundColor: '#10b981', border: 'none', fontSize: '12.5px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  출고 검수 이동 <ArrowRight size={13} />
                </button>
              </div>
            )}

            {/* 3. 출고/회수 배차 대기 피드 카드 (배차 저장/실행 권한자 표출) */}
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
                            backgroundColor: del.type === 'EXCHANGE' ? 'rgba(139,92,246,0.15)' : del.type === 'OUTBOUND' ? 'rgba(59,130,246,0.15)' : 'rgba(245,158,11,0.15)',
                            color: del.type === 'EXCHANGE' ? '#8b5cf6' : del.type === 'OUTBOUND' ? '#3b82f6' : '#f59e0b'
                          }}>
                            {del.type === 'EXCHANGE' ? '대차 교환' : del.type === 'OUTBOUND' ? '출고 배차' : '회수 배차'} (요청: {del.requestDate || del.createdAt.substring(0, 10)})
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
                                  '/admin/dispatch_assign': 'dispatch_assign',
                                  '/admin/outbound_inspections': 'outbound_inspections',
                                  '/admin/contract': 'contract',
                                  '/admin/repairs': 'repair',
                                  '/admin/billings': 'billing',
                                  '/admin/consumables': 'consumable',
                                  '/admin/organization': 'organization',
                                  '/admin/asset_acquisition_disposal': 'asset_acquisition_disposal',
                                  '/admin/delinquency': 'delinquency',
                                  '/admin/cash_flow': 'cash_flow',
                                  '/admin/leave_application': 'leave_application',
                                  '/admin/leave_management': 'leave_management',
                                  '/admin/ot_management': 'ot_management',
                                  '/admin/leave_ot': 'leave_management'
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
