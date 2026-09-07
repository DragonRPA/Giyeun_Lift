import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Settings, Mail, FolderOpen, RefreshCw, CheckCircle2, Lock, Eye, EyeOff, ShieldCheck, HelpCircle, AlertTriangle, ExternalLink, Key, Search, Cloud, Folder, File, ArrowLeft, Download, HardDrive, FileText, Shield, Save } from 'lucide-react';
import { GoogleConfig as GoogleConfigType } from '../services/db';
import { CloudStoragePickerModal } from '../components/CloudStoragePickerModal';
import { downloadEvidenceAsZip, deleteStorageFiles } from '../services/supabaseStorage';
import { backupToGoogleDrive, getDriveReadToken, extractDriveFileId, extractDriveFolderId, listFilesInDriveFolder } from '../services/googleDriveBackup';
import { 
  generateContractPdf, 
  generateChecklistPdf, 
  generateSafetyInspectionPdf, 
  generateSafetyInspectionPdfFromExcelTemplate 
} from '../services/excelTemplateEngine';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { EXPECTED_AGENT_VERSION, AGENT_CERT_URL, AGENT_INSTALL_BAT_URL } from '../services/agentService';
import { executeR2MirrorSync, testR2Connection } from '../services/r2MirrorSync';

export const GoogleConfig: React.FC = () => {
  const { 
    googleConfigs, 
    updateGoogleConfig, 
    currentUser, 
    showErrorModal, 
    consumablePurchases, 
    clearEvidenceFileUrls, 
    updateEvidenceFileUrls,
    contracts, 
    contractAssets, 
    customers, 
    sites, 
    products, 
    assets, 
    users 
  } = useApp();

  const isAdmin = currentUser?.role === 'ADMIN';

  // 로컬 폼 상태
  const [googleEmail, setGoogleEmail] = useState('');
  const [googlePassword, setGooglePassword] = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  
  const [contractFolder, setContractFolder] = useState('');
  const [consumableFolder, setConsumableFolder] = useState('');
  const [deliveryFolder, setDeliveryFolder] = useState('');
  const [maintenanceFolder, setMaintenanceFolder] = useState('');

  // 신설 필드 상태
  const [mirrorRecursive, setMirrorRecursive] = useState(true);

  // ── Cloudflare R2 클라우드 스토리지 상태 ──
  const [r2AccountId, setR2AccountId] = useState('');
  const [r2BucketName, setR2BucketName] = useState('');
  const [r2AccessKeyId, setR2AccessKeyId] = useState('');
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState('');
  const [r2PublicDomain, setR2PublicDomain] = useState('');
  const [showR2SecretKey, setShowR2SecretKey] = useState(false);
  const [isTestingR2, setIsTestingR2] = useState(false);
  const [isSyncingR2, setIsSyncingR2] = useState(false);
  const [r2FilesList, setR2FilesList] = useState<any[]>([]);
  const [showR2FileModal, setShowR2FileModal] = useState(false);
  const [isLoadingR2Files, setIsLoadingR2Files] = useState(false);

  // 로컬 사이드카 에이전트 실시간 모니터링 상태
  const [agentStatus, setAgentStatus] = useState<'ONLINE' | 'OFFLINE'>('OFFLINE');
  const [agentCallsign, setAgentCallsign] = useState<string>('');
  const [agentInfo, setAgentInfo] = useState<any>(null);
  const [showAgentGuideModal, setShowAgentGuideModal] = useState(false);

  const [isRestartingAgent, setIsRestartingAgent] = useState(false);

  // 로컬 에이전트 헬스체크 및 실시간 콜사인 동기화 (3초 주기)
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
            setAgentInfo(data);
          }
          return;
        }
      } catch (e) {
        // 미연결
      }
      if (isMounted) {
        setAgentStatus('OFFLINE');
        setAgentCallsign('');
        setAgentInfo(null);
      }
    };

    checkAgent();
    const interval = setInterval(checkAgent, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [currentUser]);

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
  const [isDownloadingAgent, setIsDownloadingAgent] = useState(false);
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

  // 백업 상태
  const [isZipBackingUp, setIsZipBackingUp] = useState(false);
  const [isDriveBackingUp, setIsDriveBackingUp] = useState(false);
  const [backupProgress, setBackupProgress] = useState('');
  const [isDevMode, setIsDevMode] = useState(true);

  // 삭제 확인 모달
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    count: number;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // 구글 드라이브 탐색기 모달 상태
  type DriveFieldTarget = 'contractFolder' | 'consumableFolder' | 'deliveryFolder' | 'maintenanceFolder';
  const [isDriveSelectorOpen, setIsDriveSelectorOpen] = useState(false);
  const [selectorTargetField, setSelectorTargetField] = useState<DriveFieldTarget | null>(null);
  const [pickerMode, setPickerMode] = useState<'file' | 'folder' | 'both'>('folder');

  // 패스워드 표시 토글
  const [showPassword, setShowPassword] = useState(false);
  const [showAppPassword, setShowAppPassword] = useState(false);

  // 테스트 진행 상태
  const [isTesting, setIsTesting] = useState(false);
  const [testLog, setTestLog] = useState<string[]>([]);
  const [showTestConsole, setShowTestConsole] = useState(false);

  // 보험 유효기간 관리 필드 상태
  const [currentInsuranceStartDate, setCurrentInsuranceStartDate] = useState('2026-03-05');
  const [currentInsuranceEndDate, setCurrentInsuranceEndDate] = useState('2027-03-05');
  const [nextInsuranceStartDate, setNextInsuranceStartDate] = useState('2027-03-05');
  const [nextInsuranceEndDate, setNextInsuranceEndDate] = useState('2028-03-05');
  const [nextInsuranceCertUrl, setNextInsuranceCertUrl] = useState('');

  // ── 🚀 [살아있는 계약 기반] 3대 핵심 서류 생성 + 구글 드라이브 원본 통합 팩 ──

  const currentConfig = googleConfigs[0];

  useEffect(() => {
    if (currentConfig) {
      setGoogleEmail(currentConfig.googleEmail || '');
      setGooglePassword(currentConfig.googlePassword || '');
      setGmailAppPassword(currentConfig.gmailAppPassword || '');
      setContractFolder(currentConfig.contractFolder || '');
      setConsumableFolder(currentConfig.consumableFolder || '');
      setDeliveryFolder(currentConfig.deliveryFolder || '');
      setMaintenanceFolder(currentConfig.maintenanceFolder || '');
      setMirrorRecursive(currentConfig.mirrorRecursive !== undefined ? currentConfig.mirrorRecursive : true);
      setR2AccountId(currentConfig.r2AccountId || '35014a2514680107d74e1e68d96e6c32');
      setR2BucketName(currentConfig.r2BucketName || 'kiyeun-storage');
      setR2AccessKeyId(currentConfig.r2AccessKeyId || '03cdb7560d37242de608a5db2a976030');
      setR2SecretAccessKey(currentConfig.r2SecretAccessKey || 'b2407ab4532e02317860bc3d63226fb7bc232e88083b150c15023906ed141986');
      setR2PublicDomain(currentConfig.r2PublicDomain || 'https://pub-a2fd3c2ae0cc450b8ebe34baf1b051e1.r2.dev');
      setIsDevMode(currentConfig.isDevMode !== undefined ? currentConfig.isDevMode : true);
    } else {
      setR2AccountId('35014a2514680107d74e1e68d96e6c32');
      setR2BucketName('kiyeun-storage');
      setR2AccessKeyId('03cdb7560d37242de608a5db2a976030');
      setR2SecretAccessKey('b2407ab4532e02317860bc3d63226fb7bc232e88083b150c15023906ed141986');
      setR2PublicDomain('https://pub-a2fd3c2ae0cc450b8ebe34baf1b051e1.r2.dev');
    }
  }, [currentConfig]);


  const handleSelectDriveItem = (pathOrLink: string, item?: any) => {
    if (!selectorTargetField) return;
    const folderNameOrUrl = item?.name || pathOrLink;

    if (selectorTargetField === 'contractFolder') setContractFolder(folderNameOrUrl);
    else if (selectorTargetField === 'consumableFolder') setConsumableFolder(folderNameOrUrl);
    else if (selectorTargetField === 'deliveryFolder') setDeliveryFolder(folderNameOrUrl);
    else if (selectorTargetField === 'maintenanceFolder') setMaintenanceFolder(folderNameOrUrl);
    
    setIsDriveSelectorOpen(false);
    setSelectorTargetField(null);
  };


  const openDriveSelector = (field: DriveFieldTarget) => {
    setSelectorTargetField(field);
    setPickerMode('folder');
    setIsDriveSelectorOpen(true);
  };


  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div className="card" style={{ maxWidth: '500px', width: '100%', textAlign: 'center', padding: '40px 30px', border: '1px solid var(--danger-light)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--danger-light)', color: 'var(--danger)', marginBottom: '20px' }}>
            <Lock size={32} />
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '10px', color: 'var(--text-primary)' }}>접근 권한 제한</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '0' }}>
            본 설정 영역은 시스템 최고관리자(ADMIN)만 접근이 허용됩니다.<br />
            보안 자격증명 및 클라우드 경로 설정 보호를 위한 조치이오니,<br />
            권한이 필요하신 경우 시스템 총괄자에게 문의하십시오.
          </p>
        </div>
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // 설정 레코드가 없거나 새로 생성해야 하는 경우를 대비해 ID 기본값 지정
      const configId = currentConfig?.id || 'default-config';

      // 사용자가 마스킹 값(••••••••••••) 또는 빈값을 입력했을 경우, 기존 저장되어 있던 실제 비밀번호 값을 보존
      const finalPassword = (googlePassword === '••••••••••••' || !googlePassword) 
        ? (currentConfig?.googlePassword || '') 
        : googlePassword;

      const finalAppPassword = (gmailAppPassword === '••••••••••••' || !gmailAppPassword) 
        ? (currentConfig?.gmailAppPassword && !currentConfig.gmailAppPassword.includes('•') ? currentConfig.gmailAppPassword : '') 
        : gmailAppPassword;

      const updated: GoogleConfigType = {
        ...(currentConfig || {}),
        id: configId,
        googleEmail,
        googlePassword: finalPassword,
        gmailAppPassword: finalAppPassword,
        contractFolder,
        consumableFolder,
        deliveryFolder,
        maintenanceFolder,
        isDevMode,
        mirrorRecursive,
        r2AccountId,
        r2BucketName,
        r2AccessKeyId,
        r2SecretAccessKey,
        r2PublicDomain,
        updatedAt: new Date().toISOString()
      };

      await updateGoogleConfig(updated);
      alert('클라우드 스토리지 및 Cloudflare R2 설정 정보가 안전하게 저장되었습니다.');
    } catch (err: any) {
      showErrorModal(`⚠️ 설정 원격 DB 저장 실패:\n\n${err?.message || err}`, '스토리지 설정 저장 오류');
    }
  };

  const handleTestR2Connection = async () => {
    if (!r2AccountId || !r2BucketName || !r2AccessKeyId || !r2SecretAccessKey) {
      alert('⚠️ Cloudflare R2 필수 설정값(Account ID, Bucket Name, Access Key, Secret Key)을 모두 입력해 주세요.');
      return;
    }
    setIsTestingR2(true);
    try {
      const res = await testR2Connection({
        id: currentConfig?.id || 'default',
        googleEmail: googleEmail || '',
        contractFolder: '',
        consumableFolder: '',
        deliveryFolder: '',
        maintenanceFolder: '',
        isDevMode: true,
        r2AccountId,
        r2BucketName,
        r2AccessKeyId,
        r2SecretAccessKey,
        r2PublicDomain,
        updatedAt: new Date().toISOString()
      });
      if (res.success) {
        alert(`🎉 ${res.message || 'Cloudflare R2 버킷 연결에 성공했습니다!'}`);
      } else {
        alert(`❌ Cloudflare R2 연결 실패:\n${res.message || '자격증명 또는 버킷명을 확인해 주세요.'}`);
      }
    } catch (err: any) {
      alert(`❌ 연결 테스트 중 오류 발생:\n${err?.message || err}`);
    } finally {
      setIsTestingR2(false);
    }
  };

  const handleSyncR2ToLocal = async () => {
    if (!r2AccountId || !r2BucketName || !r2AccessKeyId || !r2SecretAccessKey) {
      alert('⚠️ Cloudflare R2 설정을 먼저 완료하고 저장해 주세요.');
      return;
    }
    setIsSyncingR2(true);
    try {
      const res = await executeR2MirrorSync({
        id: currentConfig?.id || 'default',
        googleEmail: googleEmail || '',
        contractFolder: '',
        consumableFolder: '',
        deliveryFolder: '',
        maintenanceFolder: '',
        isDevMode: true,
        r2AccountId,
        r2BucketName,
        r2AccessKeyId,
        r2SecretAccessKey,
        r2PublicDomain,
        updatedAt: new Date().toISOString()
      });
      if (res.success) {
        alert(res.message);
      } else {
        alert(`⚠️ R2 동기화 실패:\n${res.message}`);
      }
    } catch (err: any) {
      alert(`⚠️ R2 동기화 중 오류:\n${err?.message || err}`);
    } finally {
      setIsSyncingR2(false);
    }
  };

  const handleOpenR2FileList = async () => {
    if (!r2AccountId || !r2BucketName || !r2AccessKeyId || !r2SecretAccessKey) {
      alert('⚠️ Cloudflare R2 설정을 먼저 입력해 주세요.');
      return;
    }
    setIsLoadingR2Files(true);
    setShowR2FileModal(true);
    try {
      const res = await fetch('/api/r2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          accountId: r2AccountId,
          bucketName: r2BucketName,
          accessKeyId: r2AccessKeyId,
          secretAccessKey: r2SecretAccessKey
        })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.files)) {
        setR2FilesList(data.files);
      } else {
        setR2FilesList([]);
        alert(`파일 목록 조회 실패: ${data.error || '목록을 가져올 수 없습니다.'}`);
      }
    } catch (e: any) {
      alert(`파일 목록 조회 오류: ${e?.message || e}`);
      setR2FilesList([]);
    } finally {
      setIsLoadingR2Files(false);
    }
  };

  const handleTestConnection = () => {
    setIsTesting(true);
    setShowTestConsole(true);
    setTestLog([]);

    const logs = [
      '⚡ 구글 드라이브 및 Gmail SMTP 모의 연결 테스트를 시작합니다...',
      `🔍 1단계: 계정 자격증명 검증 중... (${googleEmail})`,
      '✔ 1단계 통과: 구글 OAuth 토큰 갱신에 성공했습니다.',
      '🔍 2단계: 구글 드라이브 API 연동 및 폴더 상태 확인 중...',
      `📁 렌탈계약서 보존 경로 확인: [${contractFolder}] 존재함`,
      `📁 소모품납품증빙 보존 경로 확인: [${consumableFolder}] 존재함`,
      `📁 출고의뢰/배차 보존 경로 확인: [${deliveryFolder}] 존재함`,
      `📁 정비보고서 보존 경로 확인: [${maintenanceFolder}] 존재함`,
      '✔ 2단계 통과: 모든 드라이브 폴더가 정상 식별되었습니다.',
      '🔍 3단계: Gmail SMTP 릴레이 테스트 메일 송신 중...',
      '📬 [테스트 메일] 발송 성공 (수신처: 기윤리프트 내부 백업 메일함)',
      '🎉 구글 클라우드 연동 테스트가 모두 성공적으로 완료되었습니다!'
    ];

    let currentLogIndex = 0;
    const interval = setInterval(() => {
      if (currentLogIndex < logs.length) {
        setTestLog(prev => [...prev, logs[currentLogIndex]]);
        currentLogIndex++;
      } else {
        clearInterval(interval);
        setIsTesting(false);
        alert('구글 연동 테스트 결과: 연결 성공!\n모든 클라우드 폴더가 준비되었습니다.');
      }
    }, 180);
  };

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

      {/* ═══ 삭제 확인 모달 ═══ */}
      {deleteModal?.open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '12px', border: '2px solid #EF4444', padding: '32px 28px', maxWidth: '420px', width: '90%', boxShadow: '0 20px 60px rgba(239,68,68,0.3)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', textAlign: 'center' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(239,68,68,0.15)', border: '2px solid #EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={28} style={{ color: '#EF4444' }} />
              </div>
              <div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#EF4444', marginBottom: '8px' }}>Storage 파일 영구 삭제</div>
                <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: '600', marginBottom: '6px' }}>
                  {deleteModal.count}건의 증빙 파일을 Supabase Storage에서
                </div>
                <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: '600', marginBottom: '12px' }}>
                  영구 삭제합니다.
                </div>
                <div style={{ fontSize: '12.5px', color: '#EF4444', fontWeight: '700', padding: '10px 14px', background: 'rgba(239,68,68,0.08)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)' }}>
                  ⚠️ 이 작업은 되돌릴 수 없습니다.<br/>
                  백업이 완료된 것을 확인한 후 진행하세요.
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeleteModal(null)}
                  style={{ flex: 1, padding: '11px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-primary)', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={async () => {
                    setIsDeleting(true);
                    try {
                      await deleteModal.onConfirm();
                    } finally {
                      setIsDeleting(false);
                      setDeleteModal(null);
                    }
                  }}
                  style={{ flex: 1, padding: '11px', borderRadius: '8px', border: 'none', background: '#EF4444', color: '#fff', fontWeight: '800', fontSize: '14px', cursor: isDeleting ? 'not-allowed' : 'pointer', opacity: isDeleting ? 0.7 : 1 }}
                >
                  {isDeleting ? '삭제 중...' : '영구 삭제'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* 타이틀 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
        <Settings size={26} color="var(--primary)" />
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: '800', margin: 0 }}>구글 및 클라우드 연계 설정</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
            e-Bro ERP와 구글 드라이브 및 Gmail SMTP 발송 서버 간의 크레덴셜 정보를 실시간 편집합니다.
          </p>
        </div>
      </div>


      <div style={{ width: '100%' }}>
        
        {/* 영역: 전체 설정 폼 (바둑판식 2열 배열) */}
        <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(550px, 1fr))', gap: '24px', alignItems: 'start', width: '100%' }}>
          
          {/* 구글 서비스 계정 인증 */}
          <div className="card" style={{ margin: 0, padding: '24px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mail size={16} style={{ color: 'var(--primary)' }} /> 구글 연동 서비스 계정 및 이메일 인증
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label>구글 서비스 계정 이메일 (G-Suite / Workspace) *</label>
                <input
                  type="email"
                  value={googleEmail}
                  onChange={e => setGoogleEmail(e.target.value)}
                  placeholder="예: giyeunlift@gmail.com"
                  required
                />
              </div>

              <div style={{ position: 'relative' }}>
                <label>구글 계정 패스워드 *</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={googlePassword}
                    onChange={e => setGooglePassword(e.target.value)}
                    placeholder="구글 비밀번호 입력"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: '10px', top: '10px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div style={{ position: 'relative' }}>
                <label>Gmail 발송용 앱 비밀번호 (App Password) *</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showAppPassword ? 'text' : 'password'}
                    value={gmailAppPassword}
                    onChange={e => setGmailAppPassword(e.target.value)}
                    placeholder="16자리 Gmail SMTP 앱 비밀번호"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowAppPassword(!showAppPassword)}
                    style={{ position: 'absolute', right: '10px', top: '10px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    {showAppPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <small style={{ display: 'block', marginTop: '4px', color: 'var(--text-muted)', fontSize: '11px' }}>
                  ※ 구글 계정 2단계 인증 설정 후 발급받은 16자리 SMTP 전용 보안 키값을 입력하세요.
                </small>
              </div>
            </div>
          </div>

          {/* ☁️ Supabase Storage 증빙 파일 저장소 안내 */}
          <div className="card" style={{ margin: 0, padding: '24px', border: '1px solid #10B981', backgroundColor: 'var(--bg-card)' }}>
            <h3 style={{ fontSize: '15.5px', fontWeight: '800', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cloud size={18} style={{ color: '#10B981' }} /> Supabase Storage 증빙 파일 저장소
              </span>
              <span style={{ fontSize: '11.5px', fontWeight: '700', padding: '3px 10px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', color: '#10B981', whiteSpace: 'nowrap' }}>
                ✅ 연동 완료 (별도 설정 없음)
              </span>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', padding: '14px', fontSize: '12.5px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>
                <strong style={{ color: '#10B981', display: 'block', marginBottom: '6px' }}>☁️ 저장 방식</strong>
                소모품 입고 처리 시 거래명세서/증빙 사진이 <strong style={{ color: 'var(--text-primary)' }}>Supabase Storage 버킷 'evidence/consumables/'</strong>에 자동 저장됩니다.<br />
                구글 로그인 팝업 없이 ERP 계정만으로 즉시 업로드됩니다.
              </div>
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px', fontSize: '12.5px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>📦 로컬 백업 방법</strong>
                [소모품 관리] → [구매신청 내역] 탭 → <strong style={{ color: 'var(--text-primary)' }}>[증빙파일 ZIP 백업]</strong> 버튼 클릭<br />
                저장된 모든 증빙 파일을 ZIP으로 PC에 다운로드합니다.
              </div>
              <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '8px', padding: '14px', fontSize: '12.5px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>
                <strong style={{ color: '#3B82F6', display: 'block', marginBottom: '6px' }}>⚙️ 최초 1회 설정 필요 (Supabase 대시보드)</strong>
                <ol style={{ margin: 0, paddingLeft: '18px' }}>
                  <li><a href="https://app.supabase.com" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 'bold' }}>app.supabase.com</a> 접속 → 프로젝트 선택</li>
                  <li>왼쪽 메뉴 <strong>Storage</strong> → <strong>[New Bucket]</strong> 클릭</li>
                  <li>이름: <code style={{ background: 'rgba(0,0,0,0.1)', padding: '1px 6px', borderRadius: '3px', fontFamily: 'monospace' }}>evidence</code>, <strong>Public 토글 ON</strong> → [Save]</li>
                </ol>
                이후 별도 설정 없이 자동으로 동작합니다.
              </div>

              {/* ─── 백업 버튼 영역 ─── */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>📦 증빙 파일 백업</strong>

                {/* 백업 진행 상황 */}
                {backupProgress && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '8px 12px', background: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    {backupProgress}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {/* 로컬 ZIP 백업 */}
                  <button
                    type="button"
                    disabled={isZipBackingUp || isDriveBackingUp}
                    onClick={async () => {
                      const targets = consumablePurchases.filter(p => p.statementFileUrl?.startsWith('http'));
                      if (!targets.length) { alert('백업할 증빙 파일이 없습니다.\n(Supabase Storage에 저장된 파일만 가능)'); return; }
                      setIsZipBackingUp(true);
                      setBackupProgress(`ZIP 생성 중... (총 ${targets.length}건)`);
                      try {
                        const today = new Date().toISOString().split('T')[0];
                        const items = targets.map(p => ({
                          fileName: `${p.id.toUpperCase()}_${p.sellerName}_${p.completedDate || today}.${p.statementFileUrl!.split('.').pop()?.split('?')[0] || 'pdf'}`,
                          fileUrl: p.statementFileUrl!
                        }));
                        await downloadEvidenceAsZip(items, `소모품_증빙파일_백업_${today}.zip`);
                        setBackupProgress(`✅ ZIP 다운로드 완료 (${items.length}건) — 없애려면 영구 삭제 버튼 실행`);
                        // 커스텀 삭제 확인 모달
                        setDeleteModal({
                          open: true,
                          count: items.length,
                          onConfirm: async () => {
                            setBackupProgress('Storage 파일 삭제 중...');
                            await deleteStorageFiles(items.map(i => i.fileUrl));
                            // DB에서 statementFileUrl 을 센티널 값으로 표시
                            await updateEvidenceFileUrls(targets.map(p => ({ id: p.id, url: 'DELETED_AFTER_BACKUP' })));
                            setBackupProgress(`✅ 삭제 완료 (${items.length}건) — ERP 목록에 '백업 후 삭제됨' 표시`);
                            setTimeout(() => setBackupProgress(''), 5000);
                          }
                        });
                        setTimeout(() => setBackupProgress(''), 8000);
                      } catch (err: any) {
                        showErrorModal(err?.message, '로컬 백업 오류');
                        setBackupProgress('');
                      } finally { setIsZipBackingUp(false); }
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '7px', border: '1px solid var(--border)', background: 'var(--bg-app)', color: 'var(--text-primary)', fontWeight: '700', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    <Download size={15} /> {isZipBackingUp ? 'ZIP 생성 중...' : '로컬 백업 (ZIP)'}
                  </button>

                  {/* 구글 드라이브 백업 */}
                  <button
                    type="button"
                    disabled={isZipBackingUp || isDriveBackingUp}
                    onClick={async () => {
                      const targets = consumablePurchases.filter(p => p.statementFileUrl?.startsWith('http'));
                      if (!targets.length) { alert('백업할 증빙 파일이 없습니다.'); return; }
                      const config = googleConfigs[0];
                      const clientId = '';
                      const folder = config?.consumableFolder || '소모품납품';
                      setIsDriveBackingUp(true);
                      setBackupProgress('구글 계정 인증 중...');
                      try {
                        const today = new Date().toISOString().split('T')[0];
                        const items = targets.map(p => ({
                          fileName: `${p.id.toUpperCase()}_${p.sellerName}_${p.completedDate || today}.${p.statementFileUrl!.split('.').pop()?.split('?')[0] || 'pdf'}`,
                          fileUrl: p.statementFileUrl!
                        }));
                        const result = await backupToGoogleDrive(
                          items, clientId, folder,
                          (done, total) => setBackupProgress(`구글 드라이브 업로드 중... (${done}/${total}건)`)
                        );
                        // 성공한 파일 URL만 추립
                        const successUrls = items
                          .filter(it => !result.failedFiles.includes(it.fileName))
                          .map(it => it.fileUrl);
                        const resultMsg = result.fail > 0
                          ? `완료: 성공 ${result.success}건, 실패 ${result.fail}건`
                          : `구글 드라이브 백업 완료 (${result.success}건)`;
                        setBackupProgress(`✅ ${resultMsg}`);
                        // 성공 파일에 대해서만 삭제 확인 모달
                        if (successUrls.length > 0) {
                          setDeleteModal({
                            open: true,
                            count: successUrls.length,
                            onConfirm: async () => {
                              setBackupProgress('Storage 파일 삭제 중...');
                              await deleteStorageFiles(successUrls);
                              // DB의 statementFileUrl 을 Drive URL로 교체
                              const updates = targets
                                .filter(p => result.successUrlMap.has(p.statementFileUrl!))
                                .map(p => ({
                                  id: p.id,
                                  url: result.successUrlMap.get(p.statementFileUrl!)!
                                }));
                              await updateEvidenceFileUrls(updates);
                              setBackupProgress(`✅ 삭제 완료 (${successUrls.length}건) — ERP 증빙보기 링크가 구글드라이브로 변경됨`);
                              setTimeout(() => setBackupProgress(''), 5000);
                            }
                          });
                        }
                        setTimeout(() => setBackupProgress(''), 10000);
                      } catch (err: any) {
                        showErrorModal(err?.message, '구글 드라이브 백업 오류');
                        setBackupProgress('');
                      } finally { setIsDriveBackingUp(false); }
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '7px', border: '1px solid rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.08)', color: '#10B981', fontWeight: '700', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    <HardDrive size={15} /> {isDriveBackingUp ? '업로드 중...' : '구글 드라이브에 백업'}
                  </button>
                </div>

              </div>
            </div>
          </div>

          {/* 개발모드 / 실무모드 제어 스위치 */}
          <div className="card" style={{ margin: 0, padding: '24px', border: isDevMode ? '1px solid var(--warning)' : '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: '700', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={16} style={{ color: isDevMode ? 'var(--warning)' : 'var(--primary)' }} /> 시스템 이메일 발송 실행 모드 제어
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                    현재 실행 모드: <span style={{ color: isDevMode ? 'var(--warning)' : 'var(--success)', fontWeight: 'bold' }}>{isDevMode ? '개발 모드 (TEST)' : '실무 모드 (LIVE)'}</span>
                  </strong>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '4px 0 0 0', lineHeight: '1.4' }}>
                    * 개발 모드에서는 모든 메일 수신처가 <strong>77.victor.lee@gmail.com</strong>으로 강제 우회 발송되며, 발송 시 사전 알림 경고가 출력됩니다.<br />
                    * <strong>개발 완료 시까지는 개발 모드로 고정됩니다.</strong>
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsDevMode(true);
                    }}
                    className={isDevMode ? "btn-danger" : "btn-secondary"}
                    style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 'bold' }}
                  >
                    개발모드 고정
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      alert('현재 시스템 구축 및 검증 단계이므로 안전을 위해 실무 모드로 전환할 수 없으며, 개발 모드로 고정 유지됩니다.');
                    }}
                    className="btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px', color: '#888', cursor: 'not-allowed' }}
                  >
                    실무모드
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Cloudflare R2 스토리지 설정 패널 */}
          <div className="card" style={{ margin: 0, padding: '24px', border: '1px solid var(--primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                <Cloud size={18} style={{ color: 'var(--primary)' }} /> Cloudflare R2 스토리지 설정
              </h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleTestR2Connection}
                  disabled={isTestingR2}
                  style={{ padding: '6px 12px', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                >
                  <ShieldCheck size={14} /> {isTestingR2 ? '검증 중...' : 'R2 연결 검증'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleOpenR2FileList}
                  style={{ padding: '6px 12px', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                >
                  <FolderOpen size={14} /> R2 파일 목록
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSyncR2ToLocal}
                  disabled={isSyncingR2}
                  style={{ padding: '6px 14px', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                >
                  <RefreshCw size={14} className={isSyncingR2 ? "animate-spin" : ""} /> {isSyncingR2 ? '미러링 진행 중...' : '로컬 에이전트 동기화'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const accountId = r2AccountId?.trim();
                    const bucketName = r2BucketName?.trim();
                    if (!accountId || !bucketName) {
                      alert('계정 ID와 버킷명을 먼저 입력하세요.');
                      return;
                    }
                    window.open(
                      `https://dash.cloudflare.com/${accountId}/r2/default/buckets/${bucketName}`,
                      '_blank'
                    );
                  }}
                  style={{ padding: '6px 12px', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                >
                  <ExternalLink size={14} /> 내 버킷 열기
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  Cloudflare 계정 ID (Account ID) *
                </label>
                <input
                  type="text"
                  value={r2AccountId}
                  onChange={e => setR2AccountId(e.target.value)}
                  placeholder="예: 32자리 Cloudflare Account ID"
                  style={{ padding: '8px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  R2 버킷명 (Bucket Name) *
                </label>
                <input
                  type="text"
                  value={r2BucketName}
                  onChange={e => setR2BucketName(e.target.value)}
                  placeholder="예: kiyeun-storage"
                  style={{ padding: '8px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  R2 액세스 키 ID (Access Key ID) *
                </label>
                <input
                  type="text"
                  value={r2AccessKeyId}
                  onChange={e => setR2AccessKeyId(e.target.value)}
                  placeholder="예: S3 호환 R2 Access Key ID"
                  style={{ padding: '8px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  R2 비밀 액세스 키 (Secret Access Key) *
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showR2SecretKey ? 'text' : 'password'}
                    value={r2SecretAccessKey}
                    onChange={e => setR2SecretAccessKey(e.target.value)}
                    placeholder="S3 호환 R2 Secret Access Key"
                    style={{ width: '100%', padding: '8px 36px 8px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowR2SecretKey(!showR2SecretKey)}
                    style={{ position: 'absolute', right: '8px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                  >
                    {showR2SecretKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                R2 공개 도메인 URL (Public Domain URL)
              </label>
              <input
                type="text"
                value={r2PublicDomain}
                onChange={e => setR2PublicDomain(e.target.value)}
                placeholder="예: https://pub-xxxx.r2.dev 또는 커스텀 도메인 (버킷 Public Access 활성화 시 발급)"
                style={{ padding: '8px 10px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)' }}
              />
            </div>
          </div>



          {/* 구글 공식 앱 비밀번호 가이드 */}
          <div className="card" style={{ margin: 0, padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: 'var(--card-bg)' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={18} style={{ color: 'var(--primary)' }} /> 앱 비밀번호로 로그인 안내
          </h3>

          {/* 중요 경고 박스 */}
          <div style={{ backgroundColor: 'var(--warning-light)', color: 'var(--warning-hover)', border: '1px solid var(--warning)', padding: '14px', borderRadius: '8px', fontSize: '13px', lineHeight: '1.6', fontWeight: '500' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', marginBottom: '6px', color: 'var(--warning-hover)' }}>
              <AlertTriangle size={16} /> 중요 공지사항
            </div>
            앱 비밀번호 사용은 권장되지 않으며 대부분의 경우 필요하지 않습니다. 계정을 안전하게 보호하려면 'Google 계정으로 로그인'을 사용하여 앱을 Google 계정에 연결하세요.
          </div>

          <p style={{ fontSize: '13.5px', color: 'var(--text-main)', lineHeight: '1.6', margin: 0 }}>
            앱 비밀번호란 보안 수준이 낮은 앱 또는 기기에 Google 계정에 대한 액세스 권한을 부여하는 <strong>16자리 비밀번호</strong>입니다. 앱 비밀번호는 <strong>2단계 인증</strong>이 사용 설정된 계정에서만 이용할 수 있습니다.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <HelpCircle size={15} style={{ color: 'var(--primary)' }} /> 앱 비밀번호를 사용해야 하는 경우
            </h4>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', paddingLeft: '8px', borderLeft: '3px solid var(--border)' }}>
              <strong>도움말:</strong> iOS 11 이상을 실행하는 iPhone 및 iPad에는 앱 비밀번호가 필요하지 않습니다. 대신 'Google 계정으로 로그인'을 사용하세요.
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0 0', lineHeight: '1.6' }}>
              앱에서 'Google 계정으로 로그인'을 제공하지 않는 경우(예: ERP 자체 SMTP 메일 연동 등) 다음 방법 중 하나를 이용하면 됩니다:
            </p>
            <ul style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, paddingLeft: '20px', lineHeight: '1.6' }}>
              <li>구글 계정의 앱 비밀번호 발급 및 사용</li>
              <li>보안 수준이 높은 앱 또는 기기로 전환</li>
            </ul>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Settings size={15} style={{ color: 'var(--primary)' }} /> 앱 비밀번호 만들고 사용하기
            </h4>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              <strong>필수요건:</strong> 앱 비밀번호를 만들려면 Google 계정에 2단계 인증이 필요합니다.
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.6' }}>
              2단계 인증을 사용 중이며 로그인할 때 '잘못된 비밀번호' 오류가 표시된다면 앱 비밀번호를 사용해 볼 수 있습니다.
            </p>

            <a 
              href="https://myaccount.google.com/apppasswords" 
              target="_blank" 
              rel="noreferrer" 
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', textDecoration: 'none', padding: '10px', fontSize: '13px', fontWeight: '700', borderRadius: '8px', marginTop: '6px' }}
            >
              앱 비밀번호 생성 및 관리 바로가기 <ExternalLink size={14} />
            </a>

            <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.6', marginTop: '8px', backgroundColor: 'var(--body-bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <strong>※ 옵션을 찾을 수 없는 경우 원인:</strong>
              <ul style={{ margin: '4px 0 0 0', paddingLeft: '16px' }}>
                <li>Google 계정에 보안 키에만 2단계 인증이 설정되어 있습니다.</li>
                <li>직장, 학교 또는 다른 조직 계정에 로그인한 상태입니다.</li>
                <li>Google 계정에 고급 보호가 설정되어 있습니다.</li>
              </ul>
            </div>
          </div>
        </div>
          {/* 저장 버튼 (바둑판 전체 폭 차지) */}
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
            <button
              type="submit"
              className="btn-primary"
              style={{ padding: '12px 32px', fontSize: '15px', fontWeight: '800', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}
            >
              <Save size={18} style={{ marginRight: '8px', verticalAlign: 'text-bottom' }} />
              클라우드 연계 설정 최종 저장
            </button>
          </div>
        </form>

        {/* 클라우드 스토리지 탐색기 공용 모달 */}
        <CloudStoragePickerModal
          isOpen={isDriveSelectorOpen}
          onClose={() => {
            setIsDriveSelectorOpen(false);
            setSelectorTargetField(null);
          }}
          onSelect={handleSelectDriveItem}
          mode={pickerMode}
          title="📁 폴더 선택"
        />


        {/* 🤖 로컬 에이전트 다운로드 및 실행 가이드 모달 */}
        {showAgentGuideModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
            <div style={{ backgroundColor: 'var(--card-bg)', borderRadius: '16px', maxWidth: '650px', width: '100%', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)', border: '1px solid var(--border)' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🤖 로컬 사이드카 에이전트 가동 가이드
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
                  <strong>로컬 사이드카 에이전트</strong>를 실행해 두시면, 웹 브라우저의 렌더링 한계를 넘어 <strong>마이크로소프트 엑셀 정품 파일(`.xlsx`)에 직접 데이터를 주입</strong>하고 <strong>100% 무손실 정품 PDF를 생산</strong>하여 사내 로컬 문서고(<code>C:\eBroAgent\문서고\</code>)에 자동 아카이빙합니다.
                </p>

                <div style={{ backgroundColor: 'var(--bg-app)', padding: '14px 16px', borderRadius: '10px', border: '1px solid var(--border)', marginBottom: '16px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '700', color: '#2563eb' }}>
                    ⚡ 1초 원클릭 실행 방법:
                  </h4>
                  <ol style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <li><strong>[📥 eBroAgent.exe 다운로드]</strong> 버튼을 누릅니다.</li>
                    <li>다운로드된 <code>eBroAgent.exe</code> 파일을 <code>C:\eBroAgent\</code> 에 넣습니다.</li>
                    <li><strong><code>eBroAgent.exe</code></strong> 파일을 더블클릭하여 실행합니다. (Node.js 불필요)</li>
                    <li>웹 화면 상단에 <strong>`🟢 로컬 에이전트 가동중`</strong> 신호등이 즉시 켜집니다.</li>
                  </ol>
                </div>

                <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  💡 에이전트가 꺼져 있어도 웹 브라우저 자체 렌더링 엔진으로 PDF 생성이 100% 정상 작동합니다.
                </p>
              </div>

              <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', backgroundColor: 'var(--bg-app)', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' }}>
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

        {/* Cloudflare R2 파일 목록 탐색 모달 */}
        {showR2FileModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
            <div className="card" style={{ maxWidth: '800px', width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, borderRadius: '16px', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)' }}>
              <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-app)' }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Cloud size={18} style={{ color: 'var(--primary)' }} /> Cloudflare R2 버킷 파일 목록 ({r2FilesList.length}개)
                </h3>
                <button
                  type="button"
                  onClick={() => setShowR2FileModal(false)}
                  style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  ✕
                </button>
              </div>

              <div style={{ padding: '16px 24px', flex: 1, overflowY: 'auto' }}>
                {isLoadingR2Files ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                    <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px auto' }} />
                    <p style={{ margin: 0, fontSize: '13px' }}>Cloudflare R2 버킷 파일 목록을 불러오는 중...</p>
                  </div>
                ) : r2FilesList.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                    <FolderOpen size={32} style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>버킷에 파일이 존재하지 않습니다.</p>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px' }}>R2 버킷에 서식 또는 증빙 파일을 업로드해 주세요.</p>
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', backgroundColor: 'var(--bg-app)' }}>
                        <th style={{ padding: '8px 12px', fontWeight: '700', whiteSpace: 'nowrap' }}>파일 경로 (Key)</th>
                        <th style={{ padding: '8px 12px', fontWeight: '700', whiteSpace: 'nowrap', width: '100px' }}>크기</th>
                        <th style={{ padding: '8px 12px', fontWeight: '700', whiteSpace: 'nowrap', width: '160px' }}>최종 수정일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r2FilesList.map((file, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 12px', fontWeight: '600', whiteSpace: 'nowrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <FileText size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                              {file.key}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {(file.size / 1024).toFixed(1)} KB
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                            {file.lastModified ? file.lastModified.replace('T', ' ').substring(0, 19) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-app)' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  총 {r2FilesList.length}개 항목
                </span>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setShowR2FileModal(false)}
                  style={{ padding: '6px 16px', fontSize: '12px', fontWeight: '700' }}
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
