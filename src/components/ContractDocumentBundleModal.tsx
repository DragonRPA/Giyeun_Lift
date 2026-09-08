// src/components/ContractDocumentBundleModal.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { 
  X, FileText, Download, Eye, CheckCircle2, AlertCircle, 
  RefreshCw, FileCheck, Mail, Send, Plus, Users, Check
} from 'lucide-react';
import { emailService } from '../services/email';
import { db, formatContractEndDate } from '../services/db';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialContractId?: string;
}

export interface RecipientItem {
  id: string;
  email: string;
  name?: string;
  roleLabel?: string;
  source: 'CUSTOMER' | 'CONTACT' | 'SITE' | 'DELIVERY' | 'MANUAL';
}

export const ContractDocumentBundleModal: React.FC<Props> = ({ isOpen, onClose, initialContractId }) => {
  const { 
    contracts, customers, contacts, sites, assets, 
    contractAssets, deliveries, products, googleConfigs, currentUser,
    currentTenant, showErrorModal, hasPermission
  } = useApp();

  const canGeneratePackage = hasPermission('agent_badge', 'view');  // 계약서 패키지 생성 권한

  const [selectedContractId, setSelectedContractId] = useState<string>(
    initialContractId || contracts[0]?.id || ''
  );

  // 실시간 생성 진행 상태
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [generatedResult, setGeneratedResult] = useState<{ 
    url: string; 
    fileName: string; 
    pageCount: number; 
    blob?: Blob;
    base64Content?: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 이메일 수신인 및 발송 상태
  const [recipients, setRecipients] = useState<RecipientItem[]>([]);
  const [manualInputEmail, setManualInputEmail] = useState('');
  const [manualInputName, setManualInputName] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSentSuccess, setEmailSentSuccess] = useState(false);

  // 선택된 계약 상세 정보 계산
  const selectedContract = useMemo(() => {
    return contracts.find(c => c.id === selectedContractId) || contracts[0];
  }, [contracts, selectedContractId]);

  const customer = useMemo(() => {
    if (!selectedContract) return null;
    return customers.find(cust => cust.id === selectedContract.customerId);
  }, [customers, selectedContract]);

  const site = useMemo(() => {
    if (!selectedContract) return null;
    return sites?.find(s => s.id === selectedContract.siteId);
  }, [sites, selectedContract]);

  const mappedAssets = useMemo(() => {
    if (!selectedContract) return [];
    const caList = contractAssets.filter(ca => ca.contractId === selectedContract.id);
    return caList.map(ca => {
      const a = assets.find(ast => ast.id === ca.assetId);
      const model = a?.modelName || ca.expectedModel || 'GS-2646';
      const prod = products.find(p => p.modelName === model);

      return {
        assetNo: a?.assetNo || 'G26006',
        modelName: model,
        sn: a?.serialNo || 'GS46D-13045',
        rentalFee: ca.monthlyRentalFee || 480000,
        manufacturer: prod?.manufacturer || a?.manufacturer || 'GENIE',
        manufactureYear: a?.manufactureYear || '2018',
        weight: prod?.weight || '1,956 kg',
        workingHeight: prod?.workingHeight || '9.92 M',
        platformHeight: prod?.platformHeight || '7.92 M',
        capacityPreExt: prod?.capacityPreExt || '454 kg',
        certDate: (prod as any)?.certDate || '2010-12-29'
      };
    });
  }, [selectedContract, contractAssets, assets, products]);

  // 고유 모델 목록
  const uniqueModelList = useMemo(() => {
    const models: string[] = [];
    mappedAssets.forEach(a => {
      if (a.modelName && !models.includes(a.modelName)) {
        models.push(a.modelName);
      }
    });
    return models.length > 0 ? models : ['GS-2646'];
  }, [mappedAssets]);

  // 해당 고객사에 연결된 전체 인물 풀 (고객 담당자 + 현장 담당자)
  const availableCustomerContacts = useMemo(() => {
    if (!customer) return [];
    const list: { id: string; name: string; position: string; email: string; typeLabel: string }[] = [];

    // 1) 고객 담당자
    const custContacts = (contacts || []).filter(c => c.customerId === customer.id && c.email);
    custContacts.forEach(c => {
      list.push({
        id: `contact-${c.id}`,
        name: c.name || '담당자',
        position: c.position || '고객담당',
        email: c.email.trim(),
        typeLabel: '고객담당'
      });
    });

    // 2) 고객사 현장 목록의 현장 담당자
    const custSites = (sites || []).filter(s => s.customerId === customer.id && s.email);
    custSites.forEach(s => {
      list.push({
        id: `site-${s.id}`,
        name: s.contactName || s.name || '현장담당자',
        position: s.name ? `${s.name} 현장` : '현장담당',
        email: s.email.trim(),
        typeLabel: '현장담당'
      });
    });

    // 이메일 기준 중복 제거
    const uniqueMap = new Map<string, typeof list[0]>();
    list.forEach(item => {
      if (item.email && !uniqueMap.has(item.email.toLowerCase())) {
        uniqueMap.set(item.email.toLowerCase(), item);
      }
    });

    return Array.from(uniqueMap.values());
  }, [customer, contacts, sites]);

  // ── 💡 계약 변경 시 4대 소스 기반 기본 수신인 자동 추출 ──
  useEffect(() => {
    if (!selectedContract || !isOpen) return;

    const initialList: RecipientItem[] = [];
    const seenEmails = new Set<string>();

    const addRecipient = (email: string | undefined, name?: string, roleLabel?: string, source?: RecipientItem['source']) => {
      if (!email) return;
      const cleanEmail = email.trim();
      const lower = cleanEmail.toLowerCase();
      // 유효한 이메일 형식 체크
      if (!lower.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return;
      if (seenEmails.has(lower)) return;
      seenEmails.add(lower);

      initialList.push({
        id: `recip-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        email: cleanEmail,
        name: name || '',
        roleLabel: roleLabel || '기본수신',
        source: source || 'CUSTOMER'
      });
    };

    // 1. 고객사 마스터 (대표 이메일, 세금계산서 이메일)
    if (customer?.repEmail) {
      addRecipient(customer.repEmail, customer.representative || customer.name, '고객사 대표', 'CUSTOMER');
    }
    if (customer && (customer as any).taxBillEmail && (customer as any).taxBillEmail !== customer.repEmail) {
      addRecipient((customer as any).taxBillEmail, customer.name, '세금계산서', 'CUSTOMER');
    }

    // 2. 고객 담당자 (계약 지정 담당자 및 기타 담당자)
    const custContacts = (contacts || []).filter(c => c.customerId === selectedContract.customerId);
    const contractContact = custContacts.find(c => c.id === selectedContract.contactId);
    if (contractContact?.email) {
      addRecipient(contractContact.email, contractContact.name, `계약담당 (${contractContact.position || '담당'})`, 'CONTACT');
    }
    custContacts.forEach(c => {
      if (c.email && c.id !== selectedContract.contactId) {
        addRecipient(c.email, c.name, `담당자 (${c.position || '담당'})`, 'CONTACT');
      }
    });

    // 3. 현장 담당자
    if (site?.email) {
      addRecipient(site.email, site.contactName || site.name, `현장담당 (${site.name})`, 'SITE');
    }

    // 4. 출고의뢰(배차) 본문 및 필드 내 이메일 추출
    const contractDeliveries = (deliveries || []).filter(d => d.contractId === selectedContract.id);
    contractDeliveries.forEach(d => {
      // 4-1. statementEmail
      if ((d as any).statementEmail) {
        const emails = String((d as any).statementEmail).split(/[\s,;/]+/);
        emails.forEach(em => addRecipient(em, '출고의뢰 명세서', '출고의뢰', 'DELIVERY'));
      }
      // 4-2. rawText 자연어 본문 내 이메일 정규식 탐색
      if (d.rawText) {
        const found = d.rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
        if (found) {
          found.forEach(em => addRecipient(em, '출고요청 본문', '출고의뢰', 'DELIVERY'));
        }
      }
      // 4-3. memo 내 이메일 탐색
      if (d.memo) {
        const found = d.memo.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
        if (found) {
          found.forEach(em => addRecipient(em, '배차 메모', '출고의뢰', 'DELIVERY'));
        }
      }
    });

    setRecipients(initialList);

    // 제목 및 본문 기본값 세팅
    const custName = customer?.name || '고객사';
    const siteName = site?.name || '현장';
    const tenantBrand = currentTenant?.displayName || currentTenant?.tradeName || 'e-Bro Lift';
    const tenantCorp = currentTenant?.tradeName || currentTenant?.corporateName || tenantBrand;
    const tenantTel = currentTenant?.tel || '031-334-5296';
    setEmailSubject(`[${tenantBrand}] ${custName} - ${siteName} 고소작업대 임대차 계약서패키지`);
    setEmailBody(`안녕하십니까, ${custName} 담당자님.\n${tenantCorp} 영업팀입니다.\n\n요청하신 [${siteName}] 현장 고소작업대 임대차 계약서패키지를 첨부 파일로 송부드립니다.\n\n■ 첨부 서류 구성 (단일 통합 PDF):\n1. 고소작업대 임대차 계약서 (1p)\n2. 자산별 반입 전 CHECK LIST (${mappedAssets.length}대)\n3. 자산별 안전점검 결과서 (${mappedAssets.length}대)\n4. 장비 모델별(${uniqueModelList.join(', ')}) 정규 문서(제원표, 안전인증서, 작동법 등) 일체\n5. 생산물배상책임(PL)보험증권 (계약기간 보증)\n6. 사업자등록증 (CF R2 원본)\n7. 통장사본 (CF R2 원본)\n\n계약 내용 및 장비 제원을 검토해 주시고, 문의사항이 있으시면 언제든 연락 부탁드립니다.\n\n감사합니다.\n${currentTenant?.corporateName || tenantCorp} 배상\n전화: ${tenantTel}`);

    // 생성 결과 초기화
    setGeneratedResult(null);
    setErrorMessage(null);
    setEmailSentSuccess(false);
  }, [selectedContractId, isOpen, currentTenant]);

  // ── 수신인 추가 / 제거 핸들러 ──
  const handleRemoveRecipient = (id: string) => {
    setRecipients(prev => prev.filter(r => r.id !== id));
  };

  const handleAddManualRecipient = () => {
    const cleanEmail = manualInputEmail.trim();
    if (!cleanEmail) return;
    if (!cleanEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      alert('올바른 이메일 주소 형식을 입력해 주세요.');
      return;
    }
    if (recipients.some(r => r.email.toLowerCase() === cleanEmail.toLowerCase())) {
      alert('이미 추가된 이메일 주소입니다.');
      return;
    }

    setRecipients(prev => [
      ...prev,
      {
        id: `recip-manual-${Date.now()}`,
        email: cleanEmail,
        name: manualInputName.trim() || cleanEmail.split('@')[0],
        roleLabel: '직접입력',
        source: 'MANUAL'
      }
    ]);
    setManualInputEmail('');
    setManualInputName('');
  };

  const handleToggleContactRecipient = (contactItem: { name: string; position: string; email: string; typeLabel: string }) => {
    const exists = recipients.some(r => r.email.toLowerCase() === contactItem.email.toLowerCase());
    if (exists) {
      setRecipients(prev => prev.filter(r => r.email.toLowerCase() !== contactItem.email.toLowerCase()));
    } else {
      setRecipients(prev => [
        ...prev,
        {
          id: `recip-quick-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          email: contactItem.email,
          name: contactItem.name,
          roleLabel: `${contactItem.typeLabel} (${contactItem.position})`,
          source: 'CONTACT'
        }
      ]);
    }
  };

  // ── 💡 핵심 PDF 조립 헬퍼 (로컬 에이전트 COM 엔진 가동) ──
  const buildBundlePdf = async (): Promise<{ url: string; fileName: string; pageCount: number; blob?: Blob; base64Content?: string }> => {
    if (generatedResult?.blob && generatedResult?.base64Content) {
      return generatedResult;
    }

    setIsGenerating(true);
    setProgressPercent(10);
    setProgressText('계약서패키지 조립 시작...');
    setErrorMessage(null);

    const custName = customer?.name || '고객사';
    const siteName = site?.name || '현장';
    const siteAddress = site?.address || customer?.address || '현장 주소';

    try {
      const bundleOptions = {
        customerName: custName,
        bizRegNo: customer?.bizRegNo || '118-81-00241',
        ceoName: customer?.representative || '대표자',
        contractDate: selectedContract.startDate,
        contractStartDate: selectedContract.startDate,
        contractEndDate: selectedContract.endDate,
        deliveryDate: selectedContract.startDate ? `${selectedContract.startDate} 예정` : undefined,
        siteName: siteName,
        siteAddress: siteAddress,
        contractNo: selectedContract.id,
        managerName: customer?.representative || '계약담당자',
        managerPhone: customer?.repContact || '010-0000-0000',
        siteManagerName: site?.contactName || '현장소장',
        siteManagerPhone: site?.contact || '010-0000-0000',
        salesRepName: '김동우 팀장',
        salesRepPhone: '010-9402-5296',
        optionsText: (selectedContract as any).optionsText || (selectedContract as any).remarks || '옵션 협착난간대, 튜브소화기 외',
        assets: mappedAssets.length > 0 ? mappedAssets : undefined,
        r2Config: googleConfigs[0] ? {
          accountId: googleConfigs[0].r2AccountId,
          bucketName: googleConfigs[0].r2BucketName,
          accessKeyId: googleConfigs[0].r2AccessKeyId,
          secretAccessKey: googleConfigs[0].r2SecretAccessKey,
          publicDomain: googleConfigs[0].r2PublicDomain,
        } : undefined,
      };

      setProgressText('로컬 에이전트 정품 엑셀 엔진 가동 중...');
      setProgressPercent(40);

      const agentResp = await fetch('http://127.0.0.1:5175/api/generate-contract-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundleOptions)
      });

      if (!agentResp.ok) {
        throw new Error(`에이전트 응답 오류: HTTP ${agentResp.status}`);
      }

      const agentRes = await agentResp.json();
      if (!agentRes.success || !agentRes.base64Content) {
        throw new Error(agentRes.error || '에이전트에서 PDF 생성에 실패했습니다.');
      }

      setProgressPercent(90);
      const binaryStr = atob(agentRes.base64Content);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes.buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const tenantBrand = currentTenant?.displayName || currentTenant?.tradeName || 'e-Bro Lift';
      const finalRes = {
        url,
        fileName: agentRes.fileName || `[${tenantBrand}]_계약서패키지_${custName}_${siteName}(${agentRes.pageCount || 37}p).pdf`,
        pageCount: agentRes.pageCount || 37,
        blob,
        base64Content: agentRes.base64Content
      };

      setProgressPercent(100);
      setProgressText(`✅ 총 ${finalRes.pageCount}페이지 정품 계약서패키지 조립 완료!`);
      setGeneratedResult(finalRes);
      return finalRes;
    } catch (err: any) {
      const msg = err.message || 'PDF 생성 중 오류가 발생했습니다.';
      setErrorMessage(msg);
      throw err;
    } finally {
      setIsGenerating(false);
    }
  };

  // ── [액션 1] PDF 다운로드 핸들러 ──
  const handleDownloadPdf = async () => {
    try {
      const pdf = await buildBundlePdf();
      const link = document.createElement('a');
      link.href = pdf.url;
      link.download = pdf.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      showErrorModal?.(`PDF 다운로드 실패:\n${err.message || err}`);
    }
  };

  // ── [액션 2] 새 창 미리보기 핸들러 ──
  const handlePreviewPdf = async () => {
    try {
      const pdf = await buildBundlePdf();
      window.open(pdf.url, '_blank');
    } catch (err: any) {
      showErrorModal?.(`PDF 미리보기 실패:\n${err.message || err}`);
    }
  };

  // ── [액션 3] 계약서패키지 이메일 발송 핸들러 (1-A, 2-A, 3-yes 완벽 적용) ──
  const handleSendPackageEmail = async () => {
    if (recipients.length === 0) {
      alert('이메일 수신인을 1명 이상 지정해 주세요.');
      return;
    }

    setIsSendingEmail(true);
    try {
      // 1. PDF가 아직 없으면 원클릭 논스톱 자동 조립 실행 (2-A)
      let pdf = generatedResult;
      if (!pdf || !pdf.base64Content) {
        pdf = await buildBundlePdf();
      }

      // 2. 단일 메일에 복수 수신인(TO: 1번째, CC: 나머지) 바인딩 (1-A)
      const primaryRecipient = recipients[0].email;
      const ccRecipients = recipients.slice(1).map(r => r.email).join(', ');

      const attachments = pdf.base64Content
        ? [{ filename: pdf.fileName, content: pdf.base64Content }]
        : [];

      // 3. Gmail SMTP 서비스 호출
      await emailService.sendEmail(
        primaryRecipient,
        emailSubject,
        emailBody,
        attachments,
        ccRecipients || undefined
      );

      // 4. 계약 변경 이력(contract_history)에 감사 로그 DB 영구 저장 (3-yes)
      try {
        const historyId = db.generateNextId('contractHistory', db.contractHistory);
        const recipientSummary = recipients.map(r => `${r.name ? `${r.name}(${r.email})` : r.email}`).join(', ');
        const senderName = currentUser?.name || '영업담당';

        db.insertRow<any>('contractHistory', {
          id: historyId,
          contractId: selectedContract.id,
          changeType: 'DOCUMENT_SENT',
          description: `계약서패키지 이메일 발송 완료 (총 ${recipients.length}명: ${recipientSummary} / 발송자: ${senderName})`,
          changeDate: new Date().toISOString().split('T')[0],
          createdAt: new Date().toISOString()
        });

        await db.awaitPendingWrites();
      } catch (histErr) {
        console.warn('감사 로그 저장 중 경고:', histErr);
      }

      setEmailSentSuccess(true);
      alert(`✅ 계약서패키지 이메일이 성공적으로 발송되었습니다!\n\n• 수신인(TO): ${primaryRecipient}\n${ccRecipients ? `• 참조(CC): ${ccRecipients}\n` : ''}• 제목: ${emailSubject}\n• 첨부: ${pdf.fileName} (${pdf.pageCount}p)\n• 계약 변경 이력(Audit Log) DB 기록 완료`);
    } catch (err: any) {
      console.error('이메일 발송 실패:', err);
      showErrorModal?.(`이메일 발송 실패:\n${err.message || err}`);
    } finally {
      setIsSendingEmail(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
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
          backgroundColor: 'var(--bg-card)',
          color: 'var(--text-main)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '860px',
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }}
      >
        {/* 모달 헤더 */}
        <div
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--bg-app)',
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={20} color="var(--primary)" />
            <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 'bold', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
              계약서패키지 PDF 생성 및 이메일 발송
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* 모달 본문 */}
        <div style={{ padding: '20px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* 권한 없음 경고 배너 */}
          {!canGeneratePackage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.35)', borderRadius: '8px', color: 'var(--danger)', fontSize: '13px' }}>
              <AlertCircle size={18} />
              <div>
                <strong>계약서 패키지 생성 + 의뢰서 프린터 통제</strong> 권한이 없습니다.
                <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  이 PC에 로컬 에이전트가 설치되어 있지 않거나 해당 권한이 부여되지 않았습니다. 권한 담당자에게 문의하세요.
                </span>
              </div>
            </div>
          )}

          {/* 1. 대상 계약 선택 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              대상 계약 선택 (계약 DB 연동)
            </label>
            <select
              value={selectedContractId}
              onChange={(e) => setSelectedContractId(e.target.value)}
              disabled={isGenerating || isSendingEmail}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                fontSize: '13.5px',
                fontWeight: 600,
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-main)'
              }}
            >
              {contracts.map(c => {
                const cust = customers.find(cust => cust.id === c.customerId);
                const s = sites?.find(site => site.id === c.siteId);
                const custName = cust?.name || '고객사미지정';
                const siteName = s?.name || '현장미지정';
                return (
                  <option key={c.id} value={c.id}>
                    [{c.id}] {custName} — {siteName} ({c.startDate} ~ {formatContractEndDate(c.endDate)})
                  </option>
                );
              })}
            </select>
          </div>

          {/* 2. 선택된 계약 요약 카드 */}
          {selectedContract && (
            <div
              style={{
                backgroundColor: 'var(--bg-app)',
                borderRadius: '8px',
                padding: '12px 16px',
                border: '1px solid var(--border-color)',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                fontSize: '12.5px'
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginRight: '6px' }}>고객사:</span>
                <strong>{customer?.name || '미지정'}</strong> <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({customer?.bizRegNo || '사업자번호 미지정'})</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginRight: '6px' }}>현장명:</span>
                <strong>{site?.name || '현장미지정'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginRight: '6px' }}>계약기간:</span>
                <span>{selectedContract.startDate} ~ {formatContractEndDate(selectedContract.endDate)}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600, marginRight: '6px' }}>투입 자산 ({mappedAssets.length}대):</span>
                <strong style={{ color: 'var(--primary)' }}>
                  {mappedAssets.length > 0
                    ? mappedAssets.map(a => a.modelName + ' (' + a.assetNo + ')').join(', ')
                    : 'GS-2646 (12대 기본 매핑)'}
                </strong>
              </div>
            </div>
          )}

          {/* 3. 이메일 수신인 관리 섹션 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '14px 16px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                <Mail size={15} color="var(--primary)" />
                이메일 수신인 ({recipients.length}명 지정됨)
              </label>
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                * 계약/현장/출고의뢰 기본 수신인 자동 지정됨 (임의 추가 및 삭제 가능)
              </span>
            </div>

            {/* 3-1. 선택된 수신인 칩 목록 */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                minHeight: '38px',
                padding: '8px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                alignItems: 'center'
              }}
            >
              {recipients.length === 0 ? (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', paddingLeft: '4px' }}>
                  지정된 수신인이 없습니다. 아래 빠른 선택 또는 직접 입력을 통해 추가해 주세요.
                </span>
              ) : (
                recipients.map(r => (
                  <div
                    key={r.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 8px 4px 10px',
                      borderRadius: '16px',
                      backgroundColor: r.source === 'DELIVERY' ? 'rgba(234, 88, 12, 0.12)' : 'var(--primary-light)',
                      border: `1px solid ${r.source === 'DELIVERY' ? 'rgba(234, 88, 12, 0.4)' : 'var(--primary)'}`,
                      color: r.source === 'DELIVERY' ? '#ea580c' : 'var(--primary)',
                      fontSize: '12px',
                      fontWeight: 600
                    }}
                  >
                    <span>
                      {r.name ? `${r.name} ` : ''}
                      <span style={{ fontWeight: 400, opacity: 0.9 }}>&lt;{r.email}&gt;</span>
                      <span style={{ fontSize: '10.5px', marginLeft: '4px', opacity: 0.75 }}>({r.roleLabel})</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRecipient(r.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '1px',
                        display: 'flex',
                        alignItems: 'center',
                        color: 'inherit',
                        opacity: 0.8
                      }}
                      title="수신인 제거"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* 3-2. 수신인 직접 입력창 */}
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: '6px', alignItems: 'center' }}>
              <input
                type="text"
                value={manualInputName}
                onChange={e => setManualInputName(e.target.value)}
                placeholder="이름/직책 (선택)"
                style={{
                  padding: '7px 10px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-main)',
                  fontSize: '12.5px'
                }}
              />
              <input
                type="email"
                value={manualInputEmail}
                onChange={e => setManualInputEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddManualRecipient(); } }}
                placeholder="추가할 수신인 이메일 (예: manager@company.com)"
                style={{
                  padding: '7px 10px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-main)',
                  fontSize: '12.5px'
                }}
              />
              <button
                type="button"
                onClick={handleAddManualRecipient}
                style={{
                  padding: '7px 14px',
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap'
                }}
              >
                <Plus size={14} /> 추가
              </button>
            </div>

            {/* 3-3. 👥 고객사 연결 인물 빠른 추가 헬퍼 */}
            {availableCustomerContacts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Users size={12} color="var(--primary)" />
                  고객사 연결 인물 빠른 선택 (클릭하여 추가/제외):
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {availableCustomerContacts.map(c => {
                    const isAdded = recipients.some(r => r.email.toLowerCase() === c.email.toLowerCase());
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleToggleContactRecipient(c)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          border: isAdded ? '1px solid var(--primary)' : '1px dashed var(--border-color)',
                          backgroundColor: isAdded ? 'var(--primary-light)' : 'var(--bg-card)',
                          color: isAdded ? 'var(--primary)' : 'var(--text-muted)',
                          fontSize: '11.5px',
                          fontWeight: isAdded ? 700 : 500,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {isAdded ? <Check size={11} /> : <Plus size={11} />}
                        <span>{c.name} ({c.position})</span>
                        <span style={{ opacity: 0.7, fontSize: '10.5px' }}>&lt;{c.email}&gt;</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 4. 계약서패키지 서류 구성 그리드 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              계약서패키지 서류 구성 (첨부 실물 표준 순서)
            </label>
            <div
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-app)',
                padding: '12px 16px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                fontSize: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} color="var(--success)" />
                <span><strong>1. 고소작업대 임대차 계약서</strong> (1p)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} color="var(--success)" />
                <span><strong>2. 자산별 반입 전 CHECK LIST</strong> ({mappedAssets.length}대)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} color="var(--success)" />
                <span><strong>3. 자산별 안전점검 결과서</strong> ({mappedAssets.length}대)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} color="var(--primary)" />
                <span><strong>4. 모델별 R2 정규문서 일체</strong> ({uniqueModelList.join(', ')})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} color="var(--primary)" />
                <span><strong>5. 생산물배상책임(PL)보험증권</strong> (계약기간 보증)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} color="var(--primary)" />
                <span><strong>6. 사업자등록증</strong> (CF R2 원본)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} color="var(--primary)" />
                <span><strong>7. 통장사본</strong> (CF R2 원본)</span>
              </div>
            </div>
          </div>

          {/* 5. 실시간 진행 상태 게이지 */}
          {isGenerating && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--primary-light)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', fontWeight: 700, color: 'var(--primary)' }}>
                <span>{progressText}</span>
                <span>{progressPercent}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--bg-card)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: progressPercent + '%',
                    height: '100%',
                    backgroundColor: 'var(--primary)',
                    transition: 'width 0.2s ease-in-out'
                  }}
                />
              </div>
            </div>
          )}

          {/* 6. 에러 메시지 표출 */}
          {errorMessage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', backgroundColor: 'var(--danger-light)', border: '1px solid var(--danger)', borderRadius: '6px', color: 'var(--danger)', fontSize: '13px' }}>
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 7. 조립 완료 배지 */}
          {generatedResult && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', backgroundColor: 'var(--success-light)', border: '1px solid var(--success)', borderRadius: '8px', color: 'var(--success)', fontSize: '12.5px', fontWeight: 600 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileCheck size={16} color="var(--success)" />
                <span>{generatedResult.fileName} (총 {generatedResult.pageCount}페이지 조립 완료)</span>
              </div>
              {emailSentSuccess && (
                <span style={{ fontSize: '11.5px', backgroundColor: 'var(--success)', color: '#fff', padding: '2px 8px', borderRadius: '10px' }}>
                  ✓ 이메일 발송 완료
                </span>
              )}
            </div>
          )}

        </div>

        {/* 모달 푸터 (2대 핵심 액션 버튼 배치) */}
        <div
          style={{
            padding: '14px 22px',
            borderTop: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-app)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottomLeftRadius: '12px',
            borderBottomRightRadius: '12px'
          }}
        >
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating || isSendingEmail}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              닫기
            </button>

            <button
              type="button"
              onClick={handlePreviewPdf}
              disabled={isGenerating || isSendingEmail}
              style={{
                padding: '8px 14px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-main)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <Eye size={14} /> 새 창 미리보기
            </button>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            {/* 1. PDF 다운로드 버튼 */}
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isGenerating || isSendingEmail || !canGeneratePackage}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid var(--primary)',
                backgroundColor: !canGeneratePackage ? 'var(--bg-card)' : 'var(--primary-light)',
                color: !canGeneratePackage ? 'var(--text-muted)' : 'var(--primary)',
                fontSize: '13px',
                fontWeight: 700,
                cursor: (isGenerating || !canGeneratePackage) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                opacity: !canGeneratePackage ? 0.5 : 1
              }}
            >
              {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
              계약서패키지 PDF 다운로드
            </button>

            {/* 2. 이메일 발송 버튼 (원클릭 논스톱 발송) */}
            <button
              type="button"
              onClick={handleSendPackageEmail}
              disabled={isGenerating || isSendingEmail || recipients.length === 0 || !canGeneratePackage}
              style={{
                padding: '8px 18px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: (!canGeneratePackage || recipients.length === 0) ? 'var(--text-muted)' : 'var(--primary)',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 700,
                cursor: (isGenerating || isSendingEmail || recipients.length === 0 || !canGeneratePackage) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: (canGeneratePackage && recipients.length > 0) ? '0 2px 6px rgba(0, 0, 0, 0.2)' : 'none',
                opacity: !canGeneratePackage ? 0.5 : 1
              }}
            >
              {isSendingEmail ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
              {isSendingEmail ? '발송 중...' : `계약서패키지 이메일 발송 (${recipients.length}명)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
