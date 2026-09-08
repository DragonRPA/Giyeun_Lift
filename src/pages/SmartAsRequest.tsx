// src/pages/SmartAsRequest.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { db } from '../services/db';
import { fetchMyDrafts, DraftDispatchOrder, discardDraft } from '../services/callUploadService';
import { Wrench, Send, AlertTriangle, CheckCircle2, Search, Building2, MapPin, Phone, User, Tag, HelpCircle, PhoneCall, Sparkles, Clock, Check, ClipboardPaste, ChevronUp, ChevronDown, FolderOpen, Zap } from 'lucide-react';

const QUICK_ISSUE_PRESETS = [
  '협착 방지봉 단선 및 파손',
  '과상승 감지봉 파손',
  '상승 / 하강 작동 불가',
  '배터리 충전 안됨 / 충전선 파손',
  '에러코드 발생 (LD / U038)',
  '유압 오일 누유 / 작동유 부족',
  '키박스 / 키스위치 불량',
  '현장 배관 / 파이프 장비 걸림',
  '정기 순회 점검 요청',
  '조종기 레버 센서 불량',
  '타이어 휠 파손',
  '경광등 / 후진 부저 불량'
];

export const SmartAsRequest: React.FC = () => {
  const { customers, sites, contracts, contractAssets, assets, fieldAsTickets, createFieldAsTicket, currentUser, showErrorModal, setActiveTab } = useApp();

  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedAssetNo, setSelectedAssetNo] = useState('');
  const [customAssetNo, setCustomAssetNo] = useState('');
  const [locationDetail, setLocationDetail] = useState('');
  const [reporterName, setReporterName] = useState(currentUser?.name || '');
  const [reporterContact, setReporterContact] = useState(currentUser?.phone || '');
  const [selectedCategory, setSelectedCategory] = useState('방지봉/협착');
  const [issueDescription, setIssueDescription] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [priority, setPriority] = useState<'NORMAL' | 'URGENT'>('NORMAL');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccessTicket, setSubmitSuccessTicket] = useState<any | null>(null);
  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // ── 통화 녹음 초안 수신 큐 상태 ──
  const [asDrafts, setAsDrafts] = useState<DraftDispatchOrder[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  // ── 텍스트 붙여넣기 파싱 상태 ──
  const [pasteZoneOpen, setPasteZoneOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const txtFileInputRef = React.useRef<HTMLInputElement>(null);

  const handleTextFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result) {
        setPasteText(evt.target.result as string);
        showToast('파일 내용을 불러왔습니다.', 'success');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const runParse = React.useCallback((text: string) => {
    if (!text.trim()) { showToast('텍스트를 입력하세요.', 'error'); return; }
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const extractPhone = (s: string) => {
      const m = s.match(/(01[016789]\s*[-~]?\s*\d{3,4}\s*[-~]?\s*\d{4})/g);
      return m ? m[0].replace(/\s+/g, '') : '';
    };

    const extractName = (s: string) => {
      let namePart = s.split(/01[016789]/)[0] || s;
      namePart = namePart.split(/[a-zA-Z0-9._%+-]+@/)[0] || namePart;
      return namePart.replace(/[:：\-]/g, '').replace(/선임|책임|담당자|소장|부장|과장|대리|팀장|반장|인수자/g, '').trim();
    };

    let pCustomerName = '';
    let pSiteName = '';
    let pReporterName = '';
    let pReporterPhone = '';
    let pAssetNo = '';
    let pCategory = '기타/미분류';
    let pIssueDesc = '';

    lines.forEach(line => {
      const val = line.includes(':')
        ? line.substring(line.indexOf(':') + 1).trim()
        : (line.includes('：') ? line.substring(line.indexOf('：') + 1).trim() : '');

      if (/^(?:\d+[.)]\s*)?(?:고객사명?|고객명|업체명?|상호명?|상호|발주처)/i.test(line)) {
        pCustomerName = val || line.replace(/^(?:\d+[.)]\s*)?(?:고객사명?|고객명|업체명?|상호명?|상호|발주처)\s*[:：]?\s*/i, '');
      } else if (/^(?:\d+[.)]\s*)?(?:현장명?|현장)(?!\s*상세|\s*주소|\s*담당|\s*소장)/i.test(line)) {
        pSiteName = val || line.replace(/^(?:\d+[.)]\s*)?(?:현장명?|현장)\s*[:：]?\s*/i, '');
      } else if (/^(?:\d+[.)]\s*)?(?:연락처|담당자|전화번호|신고자)/i.test(line)) {
        const raw = val || line.replace(/^(?:\d+[.)]\s*)?(?:연락처|담당자|전화번호|신고자)\s*[:：]?\s*/i, '');
        pReporterName = extractName(raw);
        pReporterPhone = extractPhone(raw);
      } else if (/^(?:\d+[.)]\s*)?(?:장비번호|호기|자산번호|장비명)/i.test(line)) {
        pAssetNo = val || line.replace(/^(?:\d+[.)]\s*)?(?:장비번호|호기|자산번호|장비명)\s*[:：]?\s*/i, '');
      } else if (/^(?:\d+[.)]\s*)?(?:고장증상|증상|내용|에러코드|AS내용)/i.test(line)) {
        pIssueDesc = val || line.replace(/^(?:\d+[.)]\s*)?(?:고장증상|증상|내용|에러코드|AS내용)\s*[:：]?\s*/i, '');
      }
    });

    if (pCustomerName) {
      const matchedCustomer = customers.find(c => 
        c.name.toLowerCase().includes(pCustomerName.toLowerCase()) ||
        pCustomerName.toLowerCase().includes(c.name.toLowerCase())
      );
      if (matchedCustomer) {
        setSelectedCustomerId(matchedCustomer.id);
        if (pSiteName) {
          const customerSites = sites.filter(s => s.customerId === matchedCustomer.id);
          const matchedSite = customerSites.find(s => 
            s.name.toLowerCase().includes(pSiteName.toLowerCase()) ||
            pSiteName.toLowerCase().includes(s.name.toLowerCase())
          );
          if (matchedSite) setSelectedSiteId(matchedSite.id);
        }
      }
    }

    if (pReporterName) setReporterName(pReporterName);
    if (pReporterPhone) setReporterContact(pReporterPhone);
    if (pAssetNo) {
      const numericMatches = pAssetNo.match(/\d{3,5}/g);
      const assetKeyword = numericMatches ? numericMatches[0] : pAssetNo;
      const foundAsset = assets.find(a => a.assetNo.includes(assetKeyword));
      if (foundAsset) setSelectedAssetNo(foundAsset.assetNo);
      else setCustomAssetNo(pAssetNo);
    }

    let isCategoryFound = false;
    if (pIssueDesc) {
      const issueLower = pIssueDesc.toLowerCase();
      if (/배터리|충전|방전|안켜짐/.test(issueLower)) { pCategory = '배터리/충전'; isCategoryFound = true; }
      else if (/주행|모터|속도|전후진/.test(issueLower)) { pCategory = '주행/모터'; isCategoryFound = true; }
      else if (/유압|누유|호스|오일/.test(issueLower)) { pCategory = '유압/누유'; isCategoryFound = true; }
      else if (/방지봉|협착|바/.test(issueLower)) { pCategory = '방지봉/협착'; isCategoryFound = true; }
      else if (/과상승|리미트|센서/.test(issueLower)) { pCategory = '센서/리미트'; isCategoryFound = true; }
      else if (/조이스틱|레버|버튼|스위치/.test(issueLower)) { pCategory = '조작부/레버'; isCategoryFound = true; }
      
      if (!isCategoryFound) pCategory = '기타/미분류';
      setSelectedCategory(pCategory);
      setIssueDescription(pIssueDesc);
    }

    showToast('데이터 추출 및 자동 입력이 완료되었습니다.', 'success');
    setPasteZoneOpen(false);
  }, [customers, sites, assets]);
  // 통화 초안 로드
  const loadAsDrafts = async () => {
    try {
      const list = await fetchMyDrafts();
      const asFiltered = list.filter(d => {
        const isAsContext = (d.context || []).some(c => (c as any) === 'FIELD_AS');
        const hasAsKeywords = /고장|as|수리|안됨|안 됨|멈춤|누유|에러|점검|파손|부저|레버|오작동|작동불가|스위치|단선/i.test(d.note || '');
        return isAsContext || hasAsKeywords;
      });
      setAsDrafts(asFiltered);
    } catch {
      // 로컬/오프라인 무음 방어
    }
  };

  useEffect(() => {
    loadAsDrafts();
  }, []);

  // 통화 초안 클릭 시 폼에 100% 자동 주입 (Auto Injection)
  const handleApplyDraft = (draft: DraftDispatchOrder) => {
    setSelectedDraftId(draft.id);

    // 1. 고객사 매핑
    const custRaw = draft.customerName?.value?.trim() || '';
    if (custRaw) {
      const matchedCustomer = customers.find(c => 
        c.name.toLowerCase().includes(custRaw.toLowerCase()) ||
        custRaw.toLowerCase().includes(c.name.toLowerCase())
      );
      if (matchedCustomer) {
        setSelectedCustomerId(matchedCustomer.id);

        // 2. 현장 매핑
        const siteRaw = draft.siteName?.value?.trim() || '';
        const customerSites = sites.filter(s => s.customerId === matchedCustomer.id);
        const matchedSite = customerSites.find(s => 
          s.name.toLowerCase().includes(siteRaw.toLowerCase()) ||
          siteRaw.toLowerCase().includes(s.name.toLowerCase())
        );
        if (matchedSite) {
          setSelectedSiteId(matchedSite.id);
        }
      }
    }

    // 3. 연락처 & 접수자 매핑
    if (draft.contactPerson?.value) setReporterName(draft.contactPerson.value);
    if (draft.contactPhone) setReporterContact(draft.contactPhone);

    // 4. 고장 증상 및 에러코드 파싱
    const noteText = draft.note || '';
    setIssueDescription(noteText);

    // 에러코드 정규식 추출 (예: LD, U038 등)
    const errMatch = noteText.match(/\b([A-Z]{1,3}\s*[-_]?\s*\d{2,4})\b/i);
    if (errMatch) {
      setErrorCode(errMatch[1].toUpperCase());
      setSelectedCategory('에러코드');
    } else if (/방지봉|감지봉|협착/i.test(noteText)) {
      setSelectedCategory('방지봉/협착');
    } else if (/상승|하강/i.test(noteText)) {
      setSelectedCategory('상하강불량');
    } else if (/배터리|충전/i.test(noteText)) {
      setSelectedCategory('충전/전원');
    } else if (/오일|누유/i.test(noteText)) {
      setSelectedCategory('오일누유');
    } else if (/키박스|스위치/i.test(noteText)) {
      setSelectedCategory('키박스/스위치');
    }

    if (draft.urgency === 'HIGH') {
      setPriority('URGENT');
    }

    showToast(`[${draft.customerName?.value || '통화'}] 내용이 AS 접수 폼에 자동 입력되었습니다.`);
  };

  // ─── [Gutenberg Z-패턴 4단계 최하단 현장 AS 접수 현황 대차대조식 검증] ───
  const asAuditSummary = useMemo(() => {
    const list = fieldAsTickets || [];
    const totalCount = list.length;
    const requestedCount = list.filter(t => t.status === 'REQUESTED').length;
    const inProgressCount = list.filter(t => t.status === 'SCHEDULED' || t.status === 'IN_PROGRESS').length;
    const completedCount = list.filter(t => t.status === 'COMPLETED').length;

    return { totalCount, requestedCount, inProgressCount, completedCount };
  }, [fieldAsTickets]);

  // 선택된 고객사의 계약 현장 목록 필터링
  const availableSites = selectedCustomerId 
    ? sites.filter(s => s.customerId === selectedCustomerId)
    : sites;

  // 선택된 현장에서 대여중인 활성 계약 장비 목록 필터링
  const activeContractsForSite = contracts.filter(c => 
    c.status === 'ACTIVE' && 
    (!selectedCustomerId || c.customerId === selectedCustomerId) &&
    (!selectedSiteId || c.siteId === selectedSiteId)
  );

  const activeContractAssetIds = contractAssets
    .filter(ca => activeContractsForSite.some(c => c.id === ca.contractId) && ca.status !== 'RETURNED')
    .map(ca => ca.assetId);

  const siteRentedAssets = assets.filter(a => activeContractAssetIds.includes(a.id));

  const handlePresetClick = (preset: string) => {
    if (!issueDescription) {
      setIssueDescription(preset);
    } else if (!issueDescription.includes(preset)) {
      setIssueDescription(prev => `${prev}\n${preset}`);
    }

    if (preset.includes('방지봉') || preset.includes('감지봉')) setSelectedCategory('방지봉/협착');
    else if (preset.includes('상승') || preset.includes('하강')) setSelectedCategory('상하강불량');
    else if (preset.includes('충전') || preset.includes('배터리')) setSelectedCategory('충전/전원');
    else if (preset.includes('오일') || preset.includes('누유')) setSelectedCategory('오일누유');
    else if (preset.includes('키박스') || preset.includes('키스위치')) setSelectedCategory('키박스/스위치');
    else if (preset.includes('에러')) setSelectedCategory('에러코드');
    else if (preset.includes('점검')) setSelectedCategory('점검요청');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId && !selectedSiteId && !customAssetNo) {
      showErrorModal('고객사, 현장 또는 관리번호 중 최소 1개 이상을 입력해 주세요.');
      return;
    }
    if (!issueDescription.trim()) {
      showErrorModal('고장 증상 및 요청 내용을 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      const customer = customers.find(c => c.id === selectedCustomerId);
      const site = sites.find(s => s.id === selectedSiteId);
      const finalAssetNo = selectedAssetNo === 'CUSTOM' ? (customAssetNo || '현장확인') : (selectedAssetNo || customAssetNo || '현장확인');
      const matchedAsset = assets.find(a => a.assetNo === finalAssetNo);

      const ticket = await createFieldAsTicket({
        source: 'SALES_REQUEST',
        customerId: customer?.id || '',
        customerName: customer?.name || (site?.name ? `${site.name} 협력사` : '영업 의뢰 고객사'),
        siteId: site?.id || '',
        siteName: site?.name || '현장 지정 요청',
        siteAddress: site?.address?.trim() || customer?.address?.trim() || '',
        assetId: matchedAsset?.id || '',
        assetNo: finalAssetNo,
        locationDetail: locationDetail.trim(),
        reporterName: reporterName.trim(),
        reporterContact: reporterContact.trim(),
        issueCategory: selectedCategory,
        issueDescription: issueDescription.trim(),
        errorCode: errorCode.trim(),
        priority,
        status: 'REQUESTED',
        billableType: 'FREE',
        billableAmount: 0
      });
      await db.awaitPendingWrites();

      if (selectedDraftId) {
        try {
          await discardDraft(selectedDraftId);
          setAsDrafts(prev => prev.filter(d => d.id !== selectedDraftId));
          setSelectedDraftId(null);
        } catch {
          // 조용히 방어
        }
      }

      setSubmitSuccessTicket(ticket);
      showToast(`[${finalAssetNo}] 현장 AS 의뢰가 접수되었습니다.`);
    } catch (err: any) {
      // showErrorModal handled in context
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedCustomerId('');
    setSelectedSiteId('');
    setSelectedAssetNo('');
    setCustomAssetNo('');
    setLocationDetail('');
    setIssueDescription('');
    setErrorCode('');
    setPriority('NORMAL');
    setSubmitSuccessTicket(null);
    setSelectedDraftId(null);
  };

  return (
    <div style={{ padding: '20px 24px', maxWidth: '1440px', margin: '0 auto', position: 'relative' }}>
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
      {/* 타이틀 및 헤더 (헌장 3.1 무수식어 건조 표준) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '14px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wrench size={20} color="var(--primary)" />
            AS 요청 접수
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
            통화 녹음 AI 파싱 및 현장 고장 접수 전용 스튜디오
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('field_as')}
            style={{
              padding: '7px 14px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              fontSize: '12.5px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 700
            }}
          >
            현장 AS 관리 이동 ➔
          </button>
        </div>
      </div>

      {submitSuccessTicket ? (
        <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '12px', padding: '32px', textAlign: 'center' }}>
          <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 16px auto' }} />
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-main)', margin: '0 0 8px 0' }}>
            AS 의뢰가 성공적으로 접수되었습니다!
          </h2>
          <p style={{ fontSize: '14px', color: '#10b981', margin: '0 0 20px 0' }}>
            접수번호: <strong>{submitSuccessTicket.ticketNo}</strong> (현장: {submitSuccessTicket.siteName} / 장비: {submitSuccessTicket.assetNo})
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
            <button
              onClick={handleReset}
              style={{
                padding: '10px 20px',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--text-main)',
                cursor: 'pointer'
              }}
            >
              추가 AS 접수하기
            </button>
            <button
              onClick={() => setActiveTab('field_as')}
              style={{
                padding: '10px 20px',
                backgroundColor: 'var(--primary)',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#ffffff',
                cursor: 'pointer'
              }}
            >
              현장 AS 관리 대장 이동
            </button>
          </div>
        </div>
      ) : (
        /* ── 헌장 3.6 마스터-디테일 스튜디오 레이아웃 ── */
        <div style={{ display: 'flex', gap: '18px', alignItems: 'flex-start' }}>
          {/* 좌측 Master: 통화 접수 AS 대기 큐 (너비 360px 고정) */}
          <div style={{
            width: '360px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '10px',
            backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px',
            padding: '14px', boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                <PhoneCall size={15} /> 통화 접수 대기 ({asDrafts.length}건)
              </h3>
              <button
                onClick={loadAsDrafts}
                style={{ fontSize: '11px', color: 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 700 }}
              >
                새로고침
              </button>
            </div>

            {asDrafts.length === 0 ? (
              <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                대기 중인 통화 AS 초안이 없습니다.<br />
                우측 폼에서 직접 수동 접수하십시오.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '620px', overflowY: 'auto' }}>
                {asDrafts.map(d => {
                  const isSelected = selectedDraftId === d.id;
                  return (
                    <div
                      key={d.id}
                      onClick={() => handleApplyDraft(d)}
                      style={{
                        padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s ease',
                        backgroundColor: isSelected ? 'rgba(59,130,246,0.12)' : 'var(--bg-body)',
                        border: isSelected ? '1.5px solid var(--primary)' : '1px solid var(--border-color)',
                        display: 'flex', flexDirection: 'column', gap: '4px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 800, color: 'var(--text-primary)' }}>
                          {d.customerName?.value || '고객사 미상'}
                        </span>
                        <span style={{
                          fontSize: '10px', padding: '1px 5px', borderRadius: '4px', fontWeight: 800,
                          backgroundColor: d.urgency === 'HIGH' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
                          color: d.urgency === 'HIGH' ? '#ef4444' : '#2563eb'
                        }}>
                          {d.urgency === 'HIGH' ? '🚨 긴급' : '일반'}
                        </span>
                      </div>

                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        현장: {d.siteName?.value || '현장 미상'} {d.contactPerson?.value ? `· ${d.contactPerson.value}` : ''}
                      </div>

                      {d.note && (
                        <div style={{
                          fontSize: '11.5px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis',
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.4'
                        }}>
                          {d.note}
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', fontSize: '10.5px', color: 'var(--text-muted)' }}>
                        <span>{d.createdAt?.slice(5, 16) || ''}</span>
                        <span style={{ color: 'var(--primary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                          <Sparkles size={11} /> 1-클릭 꽂아넣기 ➔
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 우측 Detail: AS 접수 및 상세 검토 폼 (flex: 1) */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {selectedDraftId && (
              <div style={{
                backgroundColor: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '8px',
                padding: '8px 14px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <span style={{ fontSize: '12px', color: '#2563eb', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={14} /> 선택된 통화 내용이 폼에 자동 입력되었습니다. 미비한 점을 확인 후 접수 확정하십시오.
                </span>
                <button
                  onClick={handleReset}
                  style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  초기화
                </button>
              </div>
            )}

            {/* 텍스트 붙여넣기 파싱 영역 (출고의뢰 통합 스타일) */}
            <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden', marginBottom: '16px', boxShadow: 'var(--shadow-sm)' }}>
              <div
                onClick={() => setPasteZoneOpen(p => !p)}
                style={{
                  backgroundColor: 'var(--bg-main)',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  borderBottom: pasteZoneOpen ? '1px solid var(--border-color)' : 'none',
                  transition: 'background-color 0.2s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 700, color: 'var(--text-main)' }}>
                  <ClipboardPaste size={16} color="var(--primary)" />
                  <span>카톡/문자/밴드 텍스트 붙여넣기 파싱</span>
                </div>
                {pasteZoneOpen ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
              </div>
              {pasteZoneOpen && (
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'var(--bg-main)' }}>
                  <textarea
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    placeholder="카톡, 문자, 밴드 AS요청 원문을 붙여넣거나 [파일 불러오기]를 실행한 뒤 [폼 데이터 변환 (추출)]을 누르세요."
                    rows={5}
                    style={{
                      width: '100%',
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '12px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      color: 'var(--text-main)',
                      resize: 'vertical',
                      boxSizing: 'border-box'
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        ref={txtFileInputRef}
                        type="file"
                        accept=".txt,.csv,.log,text/plain"
                        style={{ display: 'none' }}
                        onChange={handleTextFileChange}
                      />
                      <button
                        type="button"
                        onClick={() => txtFileInputRef.current?.click()}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px',
                          borderRadius: '8px', fontSize: '12px', fontWeight: 700,
                          backgroundColor: 'var(--bg-card)', color: '#d97706', border: '1px solid var(--border-color)',
                          cursor: 'pointer', boxShadow: 'var(--shadow-sm)'
                        }}
                      >
                        <FolderOpen size={14} color="#f59e0b" />
                        <span>파일 불러오기</span>
                      </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => { setPasteText(''); setPasteZoneOpen(false); }}
                        style={{
                          padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                          backgroundColor: 'transparent', color: 'var(--text-muted)', border: 'none', cursor: 'pointer'
                        }}
                      >
                        닫기
                      </button>
                      <button
                        type="button"
                        onClick={() => runParse(pasteText)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 16px',
                          borderRadius: '8px', fontSize: '12px', fontWeight: 700,
                          backgroundColor: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer',
                          boxShadow: 'var(--shadow-sm)'
                        }}
                      >
                        <Zap size={14} />
                        <span>폼 데이터 변환 (추출)</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 1. 현장 및 대상 장비 스코핑 카드 */}
          <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '20px', boxShadow: 'var(--shadow-sm)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-main)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Building2 size={18} color="var(--primary)" />
              1. 현장 및 대상 장비 선택
            </h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              {/* 고객사 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  고객사 (업체명)
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => {
                    setSelectedCustomerId(e.target.value);
                    setSelectedSiteId('');
                    setSelectedAssetNo('');
                  }}
                  style={{
                    padding: '9px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '14px',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)'
                  }}
                >
                  <option value="">고객사 선택 (선택 안 함 가능)</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* 공사 현장 선택 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  공사 현장명 <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <select
                  value={selectedSiteId}
                  onChange={(e) => {
                    setSelectedSiteId(e.target.value);
                    setSelectedAssetNo('');
                  }}
                  style={{
                    padding: '9px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '14px',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)'
                  }}
                >
                  <option value="">현장 선택</option>
                  {availableSites.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.address || '주소미등록'})</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 관리번호 선택 (대여중 장비 드롭다운 + 직접/유연 입력) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  해당 현장 대여 장비 목록
                </label>
                <select
                  value={selectedAssetNo}
                  onChange={(e) => {
                    setSelectedAssetNo(e.target.value);
                    if (e.target.value !== 'CUSTOM') setCustomAssetNo('');
                  }}
                  style={{
                    padding: '9px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '14px',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)'
                  }}
                >
                  <option value="">대여 장비 선택</option>
                  {siteRentedAssets.map(a => (
                    <option key={a.id} value={a.assetNo}>
                      {a.assetNo} ({a.modelName})
                    </option>
                  ))}
                  <option value="CUSTOM">직접 입력 (전체장비 / 미확인 / 다수 장비)</option>
                </select>
              </div>

              {/* 장비번호 직접입력 또는 위치 상세 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {selectedAssetNo === 'CUSTOM' || !selectedAssetNo ? '장비번호 직접입력 (예: G10032, 14002 외 3대, 전체장비)' : '장비 세부 위치 (층/구역/열)'}
                </label>
                {selectedAssetNo === 'CUSTOM' || !selectedAssetNo ? (
                  <input
                    type="text"
                    value={customAssetNo}
                    onChange={(e) => setCustomAssetNo(e.target.value)}
                    placeholder="예: G19190, 팹동 전체장비, 확인필요"
                    style={{
                      padding: '9px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      fontSize: '14px',
                      backgroundColor: 'var(--bg-card)',
                      color: 'var(--text-main)'
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={locationDetail}
                    onChange={(e) => setLocationDetail(e.target.value)}
                    placeholder="예: 팹동 8층 X27 Y17, 지원동 B2"
                    style={{
                      padding: '9px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      fontSize: '14px',
                      backgroundColor: 'var(--bg-card)',
                      color: 'var(--text-main)'
                    }}
                  />
                )}
              </div>
            </div>

            {selectedAssetNo && selectedAssetNo !== 'CUSTOM' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '12px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  현장 장비 위치 상세 (선택)
                </label>
                <input
                  type="text"
                  value={locationDetail}
                  onChange={(e) => setLocationDetail(e.target.value)}
                  placeholder="예: 팹동 8층 X27 Y17, 지원동 2공구 B2 몽골텐트옆"
                  style={{
                    padding: '9px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '14px',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)'
                  }}
                />
              </div>
            )}
          </div>

          {/* 2. 고장 증상 및 요청 내용 입력 카드 */}
          <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '20px', boxShadow: 'var(--shadow-sm)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-main)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Tag size={18} color="var(--primary)" />
              2. 고장 증상 및 요청 내용
            </h3>

            {/* 다빈도 고장 1-Click 프리셋 태그 버튼군 */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
                ⚡ 자주 접수되는 고장 증상 (클릭 시 자동 입력)
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {QUICK_ISSUE_PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    style={{
                      padding: '6px 10px',
                      backgroundColor: 'var(--bg-app)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '16px',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  고장 분류
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  style={{
                    padding: '9px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '14px',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)'
                  }}
                >
                  <option value="방지봉/협착">방지봉 / 협착 센서</option>
                  <option value="상하강불량">상승 / 하강 작동 불량</option>
                  <option value="충전/전원">충전 불량 / 충전선 단선</option>
                  <option value="오일누유">유압 오일 누유</option>
                  <option value="키박스/스위치">키박스 / 키스위치 불량</option>
                  <option value="에러코드">에러코드 점등 (LD / U038)</option>
                  <option value="파이프걸림">현장 배관/파이프 걸림</option>
                  <option value="점검요청">정기 순회 점검</option>
                  <option value="기타">기타 고장</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  계기판 표시 에러코드 (선택)
                </label>
                <input
                  type="text"
                  value={errorCode}
                  onChange={(e) => setErrorCode(e.target.value)}
                  placeholder="예: LD, U038, CH02, 02 등"
                  style={{
                    padding: '9px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '14px',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                상세 증상 및 전달 사항 <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <textarea
                rows={4}
                value={issueDescription}
                onChange={(e) => setIssueDescription(e.target.value)}
                placeholder="현장에서 전달받은 구체적인 고장 내용과 방문 시 주의사항을 적어주세요. (예: 도착 전 소장님께 전화 요망, 안전모 지참 필수 등)"
                style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  fontSize: '14px',
                  resize: 'vertical',
                  lineHeight: '1.5',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-main)'
                }}
              />
            </div>
          </div>

          {/* 3. 접수자 정보 및 긴급도 */}
          <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '20px', boxShadow: 'var(--shadow-sm)' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-main)', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <User size={18} color="var(--primary)" />
              3. 접수자 연락처 및 우선순위
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  현장 접수자 성명
                </label>
                <input
                  type="text"
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                  placeholder="예: 김소장, 이민우 대리"
                  style={{
                    padding: '9px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '14px',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  접수자 연락처
                </label>
                <input
                  type="text"
                  value={reporterContact}
                  onChange={(e) => setReporterContact(e.target.value)}
                  placeholder="예: 010-1234-5678"
                  style={{
                    padding: '9px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    fontSize: '14px',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-main)'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  출동 긴급도
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  style={{
                    padding: '9px 12px',
                    borderRadius: '6px',
                    border: priority === 'URGENT' ? '2px solid var(--danger)' : '1px solid var(--border-color)',
                    fontSize: '14px',
                    backgroundColor: priority === 'URGENT' ? 'var(--danger-light)' : 'var(--bg-card)',
                    fontWeight: priority === 'URGENT' ? 700 : 400,
                    color: priority === 'URGENT' ? 'var(--danger)' : 'var(--text-main)'
                  }}
                >
                  <option value="NORMAL">보통 (일반 순회/익일 일정)</option>
                  <option value="URGENT">🚨 긴급 (당일 현장 작업 중단)</option>
                </select>
              </div>
            </div>
          </div>

          {/* 하단 최종 발행 버튼 (우하단 배치 - 헌장 3.5 Gutenberg Z-Pattern) */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
            <button
              type="button"
              onClick={handleReset}
              style={{
                padding: '12px 20px',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                cursor: 'pointer'
              }}
            >
              초기화
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 28px',
                backgroundColor: priority === 'URGENT' ? 'var(--danger)' : 'var(--primary)',
                border: 'none',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: 700,
                color: 'var(--text-on-primary)',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
              }}
            >
              <Send size={18} />
              {isSubmitting ? '의뢰 전송 중...' : 'AS 의뢰 전송'}
            </button>
          </div>
        </form>
          </div>
        </div>
      )}
      {/* ⚖️ Gutenberg Z-패턴 4단계 최하단 현장 AS 접수 대차대조식 검증 바 (헌장 3.5) */}
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
          <span>🔧 <strong>누적AS접수:</strong> {asAuditSummary.totalCount}건</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: 'var(--danger)' }}>🚨 <strong>접수대기:</strong> {asAuditSummary.requestedCount}건</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: 'var(--warning)' }}>⏳ <strong>배정/출동중:</strong> {asAuditSummary.inProgressCount}건</span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: 'var(--success)' }}>🟢 <strong>조치완료:</strong> {asAuditSummary.completedCount}건</span>
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
            ⚖️ 대차 정상 (전체 AS 티켓 상태 파이프라인 무결)
          </span>
        </div>
      </div>
      <div style={{ height: '50px' }} aria-hidden="true" />
    </div>
  );
};
