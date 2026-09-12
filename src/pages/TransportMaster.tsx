import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Settings, Users, Truck, Plus, Trash2, Edit2, Copy, Check, X, CreditCard, Building, Download } from 'lucide-react';
import { TransportCompany, TransportDriver, db, logPrivacyAccess } from '../services/db';
import { exportToExcel } from '../services/excel';
import { isPrivilegedPrivacyUser, maskPhoneNumber, maskName, maskAddress } from '../utils/privacyMasking';

export const TransportMaster: React.FC = () => {
  const { transportCompanies, transportDrivers, hasPermission, refreshAllData, showErrorModal, currentUser } = useApp();
  const canSave = hasPermission('delivery', 'save');

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 퇴출)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  // 운송사 모달
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Partial<TransportCompany> | null>(null);

  // 기사 모달
  const [showDriverModal, setShowDriverModal] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Partial<TransportDriver> | null>(null);

  // 복사 완료 피드백 상태
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 확인 모달 상태 (헌장 5.2 window.confirm 전면 퇴출)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    isDanger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const filteredDrivers = selectedCompanyId 
    ? transportDrivers.filter(d => d.companyId === selectedCompanyId)
    : transportDrivers;

  // 운송사 삭제
  const handleDeleteCompany = (id: string) => {
    if (!canSave) return;
    setConfirmModal({
      isOpen: true,
      title: '운송사 삭제',
      message: '운송사를 삭제하시겠습니까? 연관된 기사 정보는 유지되나 소속이 해제될 수 있습니다.',
      confirmText: '삭제 실행',
      isDanger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          db.deleteRow('transportCompanies', id);
          await db.awaitPendingWrites();
          refreshAllData();
          showToast('운송사 정보가 삭제되었습니다.');
          if (selectedCompanyId === id) setSelectedCompanyId(null);
        } catch (err: any) {
          showErrorModal(err?.message || '운송사 삭제 실패');
        }
      }
    });
  };

  // 기사 삭제
  const handleDeleteDriver = (id: string) => {
    if (!canSave) return;
    setConfirmModal({
      isOpen: true,
      title: '기사 정보 삭제',
      message: '이 기사 정보를 삭제하시겠습니까?',
      confirmText: '삭제 실행',
      isDanger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          db.deleteRow('transportDrivers', id);
          await db.awaitPendingWrites();
          refreshAllData();
          showToast('기사 정보가 삭제되었습니다.');
        } catch (err: any) {
          showErrorModal(err?.message || '기사 삭제 실패');
        }
      }
    });
  };

  // 운송사 추가/수정 모달 열기
  const handleOpenCompanyModal = (company?: TransportCompany) => {
    if (company) {
      setEditingCompany({ ...company });
    } else {
      setEditingCompany({
        name: '',
        businessNo: '',
        contact: '',
        bankName: '',
        bankAccount: '',
        bankHolder: '',
        memo: ''
      });
    }
    setShowCompanyModal(true);
  };

  // 기사 추가/수정 모달 열기
  const handleOpenDriverModal = (driver?: TransportDriver) => {
    if (driver) {
      setEditingDriver({ 
        ...driver,
        birthDate: driver.birthDate || (driver.idNo ? driver.idNo.slice(0, 6) : '')
      });
    } else {
      setEditingDriver({
        companyId: selectedCompanyId || (transportCompanies[0]?.id || ''),
        driverName: '',
        driverContact: '',
        birthDate: '',
        address: '',
        vehicleNo: '',
        vehicleType: '3.5T',
        vehicleColor: ''
      });
    }
    setShowDriverModal(true);
  };

  // 운송사 저장
  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompany || !editingCompany.name) {
      showErrorModal('운송사 상호명은 필수 입력 항목입니다.');
      return;
    }

    try {
      if (editingCompany.id) {
        db.updateRow<TransportCompany>('transportCompanies', editingCompany.id, {
          ...editingCompany,
          updatedAt: new Date().toISOString()
        } as any);
      } else {
        db.insertRow<TransportCompany>('transportCompanies', {
          ...editingCompany,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        } as any);
      }
      await db.awaitPendingWrites();
      refreshAllData();
      showToast('운송사 정보가 저장되었습니다.');
      setShowCompanyModal(false);
      setEditingCompany(null);
    } catch (err: any) {
      showErrorModal(`⚠️ 운송사 정보 저장 실패:\n\n${err?.message || err}`);
    }
  };

  // 기사 생년월일 포맷팅 (YYMMDD 또는 YYYY-MM-DD)
  const handleBirthDateChange = (val: string) => {
    const raw = val.replace(/[^0-9]/g, '');
    let formatted = raw;
    if (raw.length === 6) {
      formatted = `${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
    } else if (raw.length === 8) {
      formatted = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
    if (editingDriver) {
      setEditingDriver({ ...editingDriver, birthDate: formatted || raw, idNo: undefined });
    }
  };

  // 기사 저장
  const handleSaveDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDriver || !editingDriver.driverName) {
      showErrorModal('기사 성명은 필수 입력 항목입니다.');
      return;
    }

    try {
      if (editingDriver.id) {
        db.updateRow<TransportDriver>('transportDrivers', editingDriver.id, {
          ...editingDriver,
          updatedAt: new Date().toISOString()
        } as any);
      } else {
        db.insertRow<TransportDriver>('transportDrivers', {
          ...editingDriver,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        } as any);
      }
      await db.awaitPendingWrites();
      refreshAllData();
      showToast('기사 정보가 저장되었습니다.');
      setShowDriverModal(false);
      setEditingDriver(null);
    } catch (err: any) {
      showErrorModal(`⚠️ 기사 정보 저장 실패:\n\n${err?.message || err}`);
    }
  };

  // 계좌 정보 1-Click 복사
  const handleCopyAccount = (company: TransportCompany) => {
    const text = `${company.name} | ${company.bankName || ''} ${company.bankAccount || ''} (${company.bankHolder || ''})`;
    navigator.clipboard.writeText(text);
    setCopiedId(company.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // 운송사 대장 엑셀 내보내기
  const handleExportCompanies = () => {
    if (transportCompanies.length === 0) {
      showToast('내보낼 운송사 데이터가 없습니다.', 'warning');
      return;
    }
    const rows = transportCompanies.map((c, index) => ({
      'No': index + 1,
      '운송사명': c.name,
      '사업자번호': c.businessNo || '-',
      '대표연락처': c.contact || '-',
      '은행명': c.bankName || '-',
      '계좌번호': c.bankAccount || '-',
      '예금주': c.bankHolder || '-',
      '소속기사수': transportDrivers.filter(d => d.companyId === c.id).length,
      '등록일시': c.createdAt ? c.createdAt.substring(0, 10) : '-'
    }));
    const todayStr = new Date().toISOString().split('T')[0];
    exportToExcel(rows, `운송사목록_${todayStr}`, '운송사');
    showToast(`운송사 ${rows.length}개사 엑셀 내보내기 완료`);
  };

  // 소속 기사 대장 엑셀 내보내기
  const handleExportDrivers = () => {
    if (filteredDrivers.length === 0) {
      showToast('내보낼 기사 데이터가 없습니다.', 'warning');
      return;
    }
    const isPrivileged = isPrivilegedPrivacyUser(currentUser);
    const rows = filteredDrivers.map((d, index) => {
      const comp = transportCompanies.find(c => c.id === d.companyId);
      return {
        'No': index + 1,
        '기사명': isPrivileged ? d.driverName : maskName(d.driverName),
        '소속운송사': comp?.name || '미상',
        '생년월일': d.birthDate || (d.idNo ? d.idNo.slice(0, 6) : '-'),
        '연락처': isPrivileged ? (d.driverContact || '-') : maskPhoneNumber(d.driverContact),
        '차종/톤수': d.vehicleType || '-',
        '차량번호': d.vehicleNo || '-',
        '차량색상': d.vehicleColor || '-',
        '주소': isPrivileged ? (d.address || '-') : maskAddress(d.address),
        '등록일시': d.createdAt ? d.createdAt.substring(0, 10) : '-'
      };
    });
    const todayStr = new Date().toISOString().split('T')[0];
    exportToExcel(rows, `운송기사목록_${todayStr}`, '운송기사');
    logPrivacyAccess(
      'EXCEL_DOWNLOAD',
      'transport_drivers',
      `운송기사 목록 ${rows.length}건 엑셀 다운로드 (${isPrivileged ? '경영진/개발자 전체 원본' : '개인정보 마스킹'})`,
      { isMasked: !isPrivileged }
    );
    showToast(`기사 ${rows.length}명 엑셀 내보내기 완료 (${isPrivileged ? '전체 정보' : '마스킹 적용'})`);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontWeight: '700', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Settings size={22} color="var(--primary)" /> 운송 거래처 관리
        </h2>
      </div>

      {/* 📊 운송사 및 기사 등록 현황 요약 바 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
        <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>등록 운송사</span>
          <strong style={{ fontSize: '15px', color: 'var(--primary)' }}>{transportCompanies.length}개사</strong>
        </div>
        <div style={{ padding: '10px 14px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 600 }}>등록 운송 기사</span>
          <strong style={{ fontSize: '15px', color: '#16a34a' }}>{transportDrivers.length}명</strong>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
        
        {/* 왼쪽: 운송 거래처 목록 */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Truck size={16} /> 운송 거래처 (물류사)
            </h3>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                className="btn-secondary"
                onClick={handleExportCompanies}
                style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
              >
                <Download size={13} /> 엑셀 내보내기
              </button>
              {canSave && (
                <button className="btn-primary" onClick={() => handleOpenCompanyModal()} style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                  <Plus size={14} /> 신규 등록
                </button>
              )}
            </div>
          </div>
          
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div 
              onClick={() => setSelectedCompanyId(null)}
              style={{
                padding: '10px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                backgroundColor: selectedCompanyId === null ? 'var(--bg-active)' : 'transparent',
                border: selectedCompanyId === null ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                fontWeight: selectedCompanyId === null ? '700' : '500'
              }}
            >
              전체 기사 보기 ({transportDrivers.length}명)
            </div>

            {transportCompanies.map(comp => (
              <div 
                key={comp.id}
                onClick={() => setSelectedCompanyId(comp.id)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  backgroundColor: selectedCompanyId === comp.id ? 'var(--bg-active)' : 'transparent',
                  border: selectedCompanyId === comp.id ? '1px solid var(--primary)' : '1px solid var(--border-color)'
                }}
              >
                <div>
                  <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '2px' }}>{comp.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{comp.contact || '연락처 없음'}</div>
                  
                  {/* 입금 계좌정보 및 1-Click 복사 버튼 */}
                  {comp.bankAccount ? (
                    <div style={{ fontSize: '11px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CreditCard size={12} />
                      <span>{comp.bankName} {comp.bankAccount} ({comp.bankHolder})</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleCopyAccount(comp); }}
                        style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '0 2px' }}
                        title="계좌정보 복사"
                      >
                        {copiedId === comp.id ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>계좌 미등록</div>
                  )}
                </div>

                {canSave && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={(e) => { e.stopPropagation(); handleOpenCompanyModal(comp); }} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}>
                      <Edit2 size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteCompany(comp.id); }} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 오른쪽: 소속 기사 목록 */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Users size={16} /> 소속 운송 기사 및 차량 정보 (주민번호 / 주소 / 색상)
            </h3>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                className="btn-secondary"
                onClick={handleExportDrivers}
                style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
              >
                <Download size={13} /> 엑셀 내보내기
              </button>
              {canSave && (
                <button className="btn-primary" onClick={() => handleOpenDriverModal()} style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                  <Plus size={14} /> 기사 신규 등록
                </button>
              )}
            </div>
          </div>

          <div className="table-container" style={{ marginTop: '16px' }}>
            <table>
              <thead>
                <tr style={{ whiteSpace: 'nowrap' }}>
                  <th style={{ whiteSpace: 'nowrap' }}>기사명</th>
                  <th style={{ whiteSpace: 'nowrap' }}>소속 운송사</th>
                  <th style={{ whiteSpace: 'nowrap' }}>생년월일</th>
                  <th style={{ whiteSpace: 'nowrap' }}>연락처</th>
                  <th style={{ whiteSpace: 'nowrap' }}>차종/톤수</th>
                  <th style={{ whiteSpace: 'nowrap' }}>차량번호</th>
                  <th style={{ whiteSpace: 'nowrap' }}>색상</th>
                  <th style={{ whiteSpace: 'nowrap' }}>주소</th>
                  {canSave && <th style={{ width: '80px', textAlign: 'center', whiteSpace: 'nowrap' }}>관리</th>}
                </tr>
              </thead>
              <tbody>
                {filteredDrivers.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                      {transportDrivers.length === 0
                        ? '📭 등록된 기사 정보가 없습니다.'
                        : selectedCompanyId
                          ? '🔍 선택한 운송사에 등록된 기사가 없습니다.'
                          : '🔍 조회 조건에 맞는 기사 정보가 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  filteredDrivers.map(d => {
                    const comp = transportCompanies.find(c => c.id === d.companyId);
                    return (
                      <tr key={d.id} style={{ whiteSpace: 'nowrap' }}>
                        <td style={{ fontWeight: '700', whiteSpace: 'nowrap' }}>{d.driverName}</td>
                        <td style={{ whiteSpace: 'nowrap' }}><span className="badge badge-secondary">{comp?.name || '미상'}</span></td>
                        <td style={{ fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{d.birthDate || (d.idNo ? `${d.idNo.slice(0, 6)}` : '-')}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{d.driverContact || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}><span className="badge badge-info">{d.vehicleType || '-'}</span></td>
                        <td style={{ fontWeight: '600', whiteSpace: 'nowrap' }}>{d.vehicleNo || '-'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{d.vehicleColor || '-'}</td>
                        <td style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{d.address || '-'}</td>
                        {canSave && (
                          <td style={{ textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button onClick={() => handleOpenDriverModal(d)} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}>
                                <Edit2 size={14} />
                              </button>
                              <button onClick={() => handleDeleteDriver(d.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* 운송 거래처 등록/수정 모달 */}
      {showCompanyModal && editingCompany && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleSaveCompany} className="card" style={{ width: '100%', maxWidth: '450px', backgroundColor: 'var(--bg-card)' }}>
            <h3 className="card-title" style={{ marginBottom: '16px' }}>{editingCompany.id ? '운송 거래처 정보 수정' : '신규 운송 거래처 등록'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              <div>
                <label>운송사 상호명 *</label>
                <input type="text" value={editingCompany.name || ''} onChange={e => setEditingCompany({ ...editingCompany, name: e.target.value })} required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label>사업자등록번호</label>
                  <input type="text" value={editingCompany.businessNo || ''} onChange={e => setEditingCompany({ ...editingCompany, businessNo: e.target.value })} placeholder="000-00-00000" />
                </div>
                <div>
                  <label>대표 연락처</label>
                  <input type="text" value={editingCompany.contact || ''} onChange={e => setEditingCompany({ ...editingCompany, contact: e.target.value })} placeholder="010-0000-0000" />
                </div>
              </div>

              {/* 입금 계좌 정보 */}
              <div style={{ padding: '12px', backgroundColor: 'var(--bg-active)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <label style={{ fontWeight: '700', color: 'var(--primary)', marginBottom: '8px', display: 'block' }}>🏦 지급 입금 계좌 정보 (계좌 연동)</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <label style={{ fontSize: '11px' }}>은행명</label>
                    <input type="text" value={editingCompany.bankName || ''} onChange={e => setEditingCompany({ ...editingCompany, bankName: e.target.value })} placeholder="예: 기업은행" />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px' }}>예금주</label>
                    <input type="text" value={editingCompany.bankHolder || ''} onChange={e => setEditingCompany({ ...editingCompany, bankHolder: e.target.value })} placeholder="예: (주)엠제이로지스" />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '11px' }}>계좌번호</label>
                  <input type="text" value={editingCompany.bankAccount || ''} onChange={e => setEditingCompany({ ...editingCompany, bankAccount: e.target.value })} placeholder="숫자 및 하이픈" />
                </div>
              </div>

              <div>
                <label>메모</label>
                <textarea value={editingCompany.memo || ''} onChange={e => setEditingCompany({ ...editingCompany, memo: e.target.value })} rows={2} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowCompanyModal(false)}>취소</button>
              <button type="submit" className="btn-primary">저장</button>
            </div>
          </form>
        </div>
      )}

      {/* 기사 등록/수정 모달 */}
      {showDriverModal && editingDriver && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleSaveDriver} className="card" style={{ width: '100%', maxWidth: '500px', backgroundColor: 'var(--bg-card)' }}>
            <h3 className="card-title" style={{ marginBottom: '16px' }}>{editingDriver.id ? '운송 기사 정보 수정' : '신규 운송 기사 등록'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label>기사 성명 *</label>
                  <input type="text" value={editingDriver.driverName || ''} onChange={e => setEditingDriver({ ...editingDriver, driverName: e.target.value })} required />
                </div>
                <div>
                  <label>소속 운송사 *</label>
                  <select value={editingDriver.companyId || ''} onChange={e => setEditingDriver({ ...editingDriver, companyId: e.target.value })} required>
                    <option value="">-- 운송사 선택 --</option>
                    {transportCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label>기사 연락처</label>
                  <input type="text" value={editingDriver.driverContact || ''} onChange={e => setEditingDriver({ ...editingDriver, driverContact: e.target.value })} placeholder="010-0000-0000" />
                </div>
                <div>
                  <label>생년월일 (YYMMDD)</label>
                  <input 
                    type="text" 
                    value={editingDriver.birthDate || ''} 
                    onChange={e => handleBirthDateChange(e.target.value)} 
                    placeholder="예: 850315" 
                    maxLength={10}
                  />
                </div>
              </div>

              <div>
                <label>기사 주소</label>
                <input type="text" value={editingDriver.address || ''} onChange={e => setEditingDriver({ ...editingDriver, address: e.target.value })} placeholder="도로명 주소" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div>
                  <label>차종 / 톤수</label>
                  <select value={editingDriver.vehicleType || '3.5T'} onChange={e => setEditingDriver({ ...editingDriver, vehicleType: e.target.value })}>
                    <option value="1.4T">1.4T</option>
                    <option value="2.5T">2.5T</option>
                    <option value="3.5T">3.5T</option>
                    <option value="5T">5T</option>
                    <option value="5T장축">5T장축</option>
                    <option value="8.5T">8.5T</option>
                    <option value="11T">11T</option>
                    <option value="노배드">노배드</option>
                  </select>
                </div>
                <div>
                  <label>차량 번호</label>
                  <input type="text" value={editingDriver.vehicleNo || ''} onChange={e => setEditingDriver({ ...editingDriver, vehicleNo: e.target.value })} placeholder="80가1234" />
                </div>
                <div>
                  <label>차량 색상</label>
                  <input type="text" value={editingDriver.vehicleColor || ''} onChange={e => setEditingDriver({ ...editingDriver, vehicleColor: e.target.value })} placeholder="흰색, 은색 등" />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowDriverModal(false)}>취소</button>
              <button type="submit" className="btn-primary">저장</button>
            </div>
          </form>
        </div>
      )}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          padding: '12px 20px',
          borderRadius: '8px',
          backgroundColor: toastMessage.type === 'error' ? '#ef4444' : toastMessage.type === 'warning' ? '#f59e0b' : '#10b981',
          color: '#fff',
          fontWeight: 700,
          fontSize: '13px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {toastMessage.text}
        </div>
      )}

      {/* 확인 모달 (Charter 5.2) */}
      {confirmModal && confirmModal.isOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11000
        }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '10px', padding: '20px', maxWidth: '400px', width: '90%', border: '1px solid var(--border-color)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '15px', color: confirmModal.isDanger ? '#ef4444' : 'inherit' }}>{confirmModal.title}</h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', whiteSpace: 'pre-line' }}>{confirmModal.message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn-secondary" onClick={() => setConfirmModal(null)}>취소</button>
              <button
                className="btn-primary"
                style={{ backgroundColor: confirmModal.isDanger ? '#ef4444' : 'var(--primary)', borderColor: confirmModal.isDanger ? '#ef4444' : 'var(--primary)' }}
                onClick={confirmModal.onConfirm}
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
