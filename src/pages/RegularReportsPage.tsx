// @ts-nocheck
import React, { useState, useMemo, useEffect } from 'react';
import { 
  FileBarChart2, Download, Printer, RefreshCw, CheckCircle2, 
  AlertTriangle, ArrowUpRight, TrendingUp, Truck, Wrench, 
  DollarSign, Building2, Save, Sparkles, Clock, Ban, ChevronRight,
  MessageSquare, Link, Plus, Trash2, ChevronDown, ChevronUp
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { 
  aggregateExecutiveMonthlyReport, 
  getStoredExecutiveDirective, 
  saveExecutiveDirective,
  getStoredTeamComment,
  saveTeamComment,
  getAllTeamComments,
  ExecutiveMonthlyReport,
  ExecutiveDirective,
  TeamComment,
  TeamCommentLink,
  TeamKey,
  TEAM_META
} from '../services/monthlyReportEngine';
import { downloadExecutiveReportPdf } from '../services/monthlyReportPdfBuilder';


export const RegularReportsPage: React.FC = () => {
  const context = useApp();
  const [targetYm, setTargetYm] = useState<string>('2026-08');
  const [viewMode, setViewMode] = useState<'EXECUTIVE' | 'DRILLDOWN'>('EXECUTIVE');
  const [drilldownTab, setDrilldownTab] = useState<'FLEET' | 'SALES' | 'LOGISTICS' | 'MAINTENANCE' | 'FINANCE'>('FLEET');
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 경영진 지시사항 로컬 상태
  const [directive, setDirective] = useState<ExecutiveDirective>(() => 
    getStoredExecutiveDirective('2026-08')
  );

  // 팀별 코멘트 로컬 상태 (5개 팀)
  const [teamComments, setTeamComments] = useState<Record<TeamKey, TeamComment>>(() => {
    const init = {} as Record<TeamKey, TeamComment>;
    (['SALES', 'LOGISTICS', 'YARD', 'MAINTENANCE', 'FINANCE'] as TeamKey[]).forEach(k => {
      init[k] = getStoredTeamComment('2026-08', k);
    });
    return init;
  });

  // 팀별 코멘트 패널 접힘 상태
  const [commentPanelOpen, setCommentPanelOpen] = useState<Record<TeamKey, boolean>>({
    SALES: false, LOGISTICS: false, YARD: false, MAINTENANCE: false, FINANCE: false
  });

  // 대상 연월 변경 시 지시사항 및 팀별 코멘트 리로드
  useEffect(() => {
    setDirective(getStoredExecutiveDirective(targetYm));
    const refreshed = {} as Record<TeamKey, TeamComment>;
    (['SALES', 'LOGISTICS', 'YARD', 'MAINTENANCE', 'FINANCE'] as TeamKey[]).forEach(k => {
      refreshed[k] = getStoredTeamComment(targetYm, k);
    });
    setTeamComments(refreshed);
  }, [targetYm]);

  // 실데이터 기반 전사 월간 종합 리포트 집계
  const reportData: ExecutiveMonthlyReport = useMemo(() => {
    return aggregateExecutiveMonthlyReport(targetYm, context);
  }, [targetYm, context]);

  const { period, kpis, fleet, sales, operations, finance, conservation } = reportData;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // 경영진 지시사항 저장
  const handleSaveDirective = () => {
    saveExecutiveDirective(directive);
    showToast('경영진 종합 총평 및 차월 중점 지시사항이 저장되었습니다.');
  };

  // 팀별 코멘트 저장
  const handleSaveTeamComment = (teamKey: TeamKey) => {
    const comment = teamComments[teamKey];
    saveTeamComment({ ...comment, targetYm });
    showToast(`${TEAM_META[teamKey].name} 코멘트가 저장되었습니다.`);
  };

  // 팀별 코멘트 필드 업데이트
  const updateTeamComment = (teamKey: TeamKey, field: keyof TeamComment, value: any) => {
    setTeamComments(prev => ({
      ...prev,
      [teamKey]: { ...prev[teamKey], [field]: value }
    }));
  };

  // 팀별 링크 추가
  const addTeamLink = (teamKey: TeamKey) => {
    const current = teamComments[teamKey].links;
    if (current.length >= 3) return;
    updateTeamComment(teamKey, 'links', [...current, { title: '', url: '' }]);
  };

  // 팀별 링크 수정
  const updateTeamLink = (teamKey: TeamKey, idx: number, field: 'title' | 'url', val: string) => {
    const links = [...teamComments[teamKey].links];
    links[idx] = { ...links[idx], [field]: val };
    updateTeamComment(teamKey, 'links', links);
  };

  // 팀별 링크 삭제
  const removeTeamLink = (teamKey: TeamKey, idx: number) => {
    const links = teamComments[teamKey].links.filter((_, i) => i !== idx);
    updateTeamComment(teamKey, 'links', links);
  };

  // 공식 PDF 다운로드
  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    try {
      await downloadExecutiveReportPdf({ ...reportData, executiveDirective: directive, teamComments: Object.values(teamComments) });
      showToast(`${period.year}년 ${period.month}월 경영 정기보고서 PDF 다운로드가 완료되었습니다.`);
    } catch (err: any) {
      console.error('PDF generation error:', err);
      alert('PDF 생성 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsDownloading(false);
    }
  };

  // 브라우저 공식 인쇄
  const handlePrint = () => {
    window.print();
  };

  // 팀별 코멘트 패널 컴포넌트 (각 보고서 섹션 하단에 삽입)
  const TeamCommentPanel = ({ teamKey }: { teamKey: TeamKey }) => {
    const meta = TEAM_META[teamKey];
    const tc = teamComments[teamKey];
    const isOpen = commentPanelOpen[teamKey];
    const hasContent = tc.comment.trim() || tc.links.some(l => l.url.trim());

    return (
      <div className="mt-3 rounded-lg border border-dashed transition-all"
        style={{ borderColor: hasContent ? 'rgba(99,102,241,0.5)' : 'var(--border-color)', backgroundColor: hasContent ? 'rgba(99,102,241,0.04)' : 'transparent' }}>
        {/* 헤더 토글 */}
        <button
          onClick={() => setCommentPanelOpen(prev => ({ ...prev, [teamKey]: !prev[teamKey] }))}
          className="w-full flex items-center justify-between px-4 py-2.5 text-left rounded-lg"
        >
          <div className="flex items-center gap-2">
            <MessageSquare size={13} className={hasContent ? 'text-indigo-400' : 'text-slate-500'} />
            <span className={`text-[11px] font-bold ${hasContent ? 'text-indigo-300' : 'text-slate-500'}`}>
              {meta.icon} {meta.name} 코멘트
            </span>
            {hasContent && tc.savedAt && (
              <span className="text-[10px] text-slate-500">· 저장: {tc.savedAt.slice(0, 16)}</span>
            )}
            {hasContent && !tc.savedAt && (
              <span className="text-[10px] text-amber-500">· 미저장</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasContent && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                내용 있음
              </span>
            )}
            {isOpen ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
          </div>
        </button>

        {/* 펼친 상태 */}
        {isOpen && (
          <div className="px-4 pb-4 flex flex-col gap-3">
            {/* 코멘트 작성자 + 텍스트 */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400">작성자</label>
              <input
                type="text"
                value={tc.authorName}
                onChange={e => updateTeamComment(teamKey, 'authorName', e.target.value)}
                placeholder="이름 또는 직책"
                className="w-full px-2.5 py-1.5 rounded text-xs text-white border focus:outline-none focus:border-indigo-500"
                style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)', maxWidth: '200px' }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400">부서 코멘트 / 부연 설명</label>
              <textarea
                rows={3}
                value={tc.comment}
                onChange={e => updateTeamComment(teamKey, 'comment', e.target.value)}
                placeholder={`${meta.name}에서 이 보고 항목에 대한 추가 설명이나 특이 사항을 입력하세요...`}
                className="w-full p-2.5 rounded-lg text-xs text-white border focus:outline-none focus:border-indigo-500 leading-relaxed resize-none"
                style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
              />
            </div>

            {/* 참고 링크 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-slate-400">참고 링크 (최대 3개)</label>
                {tc.links.length < 3 && (
                  <button
                    onClick={() => addTeamLink(teamKey)}
                    className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold"
                  >
                    <Plus size={11} /> 링크 추가
                  </button>
                )}
              </div>
              {tc.links.map((lnk, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={lnk.title}
                    onChange={e => updateTeamLink(teamKey, idx, 'title', e.target.value)}
                    placeholder="링크 제목"
                    className="flex-shrink-0 w-32 px-2 py-1.5 rounded text-[11px] text-white border focus:outline-none focus:border-indigo-500"
                    style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
                  />
                  <input
                    type="url"
                    value={lnk.url}
                    onChange={e => updateTeamLink(teamKey, idx, 'url', e.target.value)}
                    placeholder="https://"
                    className="flex-1 px-2 py-1.5 rounded text-[11px] text-white border focus:outline-none focus:border-indigo-500 font-mono"
                    style={{ backgroundColor: 'var(--bg-app)', borderColor: 'var(--border-color)' }}
                  />
                  <button
                    onClick={() => removeTeamLink(teamKey, idx)}
                    className="p-1 text-slate-500 hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {tc.links.length === 0 && (
                <span className="text-[10px] text-slate-600 italic">첨부할 참고 문서나 URL 링크가 있으면 추가하세요.</span>
              )}
            </div>

            {/* 저장 버튼 */}
            <div className="flex justify-end">
              <button
                onClick={() => handleSaveTeamComment(teamKey)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold shadow transition-all active:scale-98"
              >
                <Save size={12} />
                <span>저장</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };


  // ─── 전사 표준 스타일 상수 ────────────────────────────────────────────────
  const S = {
    card: { backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '14px 18px' } as React.CSSProperties,
    cardSm: { backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '10px 14px' } as React.CSSProperties,
    cardDanger: { backgroundColor: 'var(--bg-card)', border: '1px solid var(--danger)', borderRadius: '8px', padding: '14px 18px' } as React.CSSProperties,
    kpiChip: { backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '7px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as React.CSSProperties,
    sectionLabel: { fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' } as React.CSSProperties,
    sectionTitle: { fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 } as React.CSSProperties,
    subTitle: { fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 } as React.CSSProperties,
    muted: { fontSize: '12px', color: 'var(--text-muted)' } as React.CSSProperties,
    tableHeader: { fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, paddingBottom: '6px', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' } as React.CSSProperties,
    tableCell: { fontSize: '12px', color: 'var(--text-primary)', padding: '7px 0', whiteSpace: 'nowrap' } as React.CSSProperties,
    tableCellMuted: { fontSize: '12px', color: 'var(--text-secondary)', padding: '7px 0', whiteSpace: 'nowrap' } as React.CSSProperties,
    divider: { borderTop: '1px solid var(--border-color)', margin: '10px 0' } as React.CSSProperties,
    input: { padding: '6px 10px', borderRadius: '6px', fontSize: '12.5px', border: '1px solid var(--border-color)', outline: 'none', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', width: '100%' } as React.CSSProperties,
    textarea: { padding: '8px 10px', borderRadius: '6px', fontSize: '12.5px', border: '1px solid var(--border-color)', outline: 'none', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', width: '100%', resize: 'vertical' } as React.CSSProperties,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px', paddingBottom: '32px' }}>

      {/* 토스트 알림 */}
      {toastMessage && (
        <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 9999, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.3)', fontSize: '13px', color: 'var(--text-primary)' }}>
          <CheckCircle2 size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>{toastMessage}</span>
        </div>
      )}

      {/* ── 최상단 헤더 (Z-Pattern Scope + Pipeline) ── */}
      <div style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        {/* 좌측: 메뉴명 + 마감연월 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div>
            <h2 style={{ fontWeight: 700, fontSize: '18px', marginBottom: '2px', color: 'var(--text-primary)' }}>정기보고서 생성</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>전사 5대 핵심 도메인 실데이터 통합 보고서</p>
          </div>
          <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>마감 연월</label>
            <select
              value={targetYm}
              onChange={(e) => setTargetYm(e.target.value)}
              style={{ ...S.input, width: 'auto', fontWeight: 700, cursor: 'pointer' }}
            >
              <option value="2026-08">2026년 08월 (8월 마감)</option>
              <option value="2026-07">2026년 07월 (7월 마감)</option>
              <option value="2026-06">2026년 06월 (6월 마감)</option>
              <option value="2026-05">2026년 05월 (5월 마감)</option>
            </select>
          </div>
        </div>

        {/* 우측: 액션 버튼군 */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          <button
            className="btn-secondary"
            onClick={() => showToast('최신 실데이터를 다시 집계했습니다.')}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '7px 12px', fontSize: '12px' }}
          >
            <RefreshCw size={13} /> 새로고침
          </button>
          <button
            className="btn-secondary"
            onClick={handlePrint}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '7px 12px', fontSize: '12px' }}
          >
            <Printer size={13} /> 공식 보고서 인쇄
          </button>
          <button
            className="btn-primary"
            onClick={handleDownloadPdf}
            disabled={isDownloading}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '7px 14px', fontSize: '12px', fontWeight: 700 }}
          >
            {isDownloading ? <><RefreshCw size={13} /> PDF 빌드 중...</> : <><Download size={13} /> 공식 PDF 다운로드</>}
          </button>
        </div>
      </div>

      {/* ── 뷰 모드 탭 + 메타 정보 ── */}
      <div style={{ ...S.card, padding: '0 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '2px' }}>
          {[
            { key: 'EXECUTIVE', label: '경영 종합 보고서', icon: <FileBarChart2 size={13} /> },
            { key: 'DRILLDOWN', label: '부서별 상세 분석', icon: <Building2 size={13} /> },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setViewMode(tab.key as any)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '12px 14px', fontSize: '12px', fontWeight: 700,
                borderBottom: viewMode === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                color: viewMode === tab.key ? 'var(--primary)' : 'var(--text-secondary)',
                background: 'none', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          스냅샷: <strong style={{ color: 'var(--text-primary)' }}>{period.closingDate}</strong>
          &nbsp;·&nbsp;발행: <strong style={{ color: 'var(--text-primary)' }}>{period.generatedAt}</strong>
        </span>
      </div>

      {/* ── 본문 ── */}
      <div>

        {/* [모드 1] 경영 종합 보고서 */}
        {viewMode === 'EXECUTIVE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

            {/* 1. KPI 바 — 전사 표준 소형 칩 그리드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '6px' }}>
              <div style={S.kpiChip}>
                <span style={S.sectionLabel}>총 매출 청구액</span>
                <strong style={{ fontSize: '14px', color: 'var(--primary)', whiteSpace: 'nowrap' }}>₩{kpis.totalRevenue.toLocaleString()}</strong>
              </div>
              <div style={S.kpiChip}>
                <span style={S.sectionLabel}>플릿 가동률</span>
                <strong style={{ fontSize: '14px', color: 'var(--success)', whiteSpace: 'nowrap' }}>{kpis.fleetUtilizationRate}% ({kpis.activeAssetCount}대)</strong>
              </div>
              <div style={S.kpiChip}>
                <span style={S.sectionLabel}>수납률 / 미수 잔액</span>
                <strong style={{ fontSize: '14px', color: 'var(--primary)', whiteSpace: 'nowrap' }}>{kpis.collectionRate}% / ₩{kpis.unpaidAmount.toLocaleString()}</strong>
              </div>
              <div style={S.kpiChip}>
                <span style={S.sectionLabel}>추정 공헌이익</span>
                <strong style={{ fontSize: '14px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>₩{kpis.estimatedMargin.toLocaleString()} ({kpis.marginRate}%)</strong>
              </div>
              <div style={S.kpiChip}>
                <span style={S.sectionLabel}>EXCHANGE 절감</span>
                <strong style={{ fontSize: '14px', color: 'var(--success)', whiteSpace: 'nowrap' }}>+₩{kpis.exchangeSavedCost.toLocaleString()}</strong>
              </div>
              {kpis.totalWaivedAmount > 0 && (
                <div style={{ ...S.kpiChip, border: '1px solid var(--warning)' }}>
                  <span style={{ ...S.sectionLabel, color: 'var(--warning)' }}>영업 면제(Waiver) 주의</span>
                  <strong style={{ fontSize: '14px', color: 'var(--warning)', whiteSpace: 'nowrap' }}>₩{kpis.totalWaivedAmount.toLocaleString()}</strong>
                </div>
              )}
            </div>

            {/* 2. 플릿 현황 + 장기유휴 경고 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {/* 좌측: 규격별 플릿 가동 현황 */}
              <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={S.subTitle}>1. 모델 규격별 플릿 가동 현황</strong>
                  <span style={S.muted}>총 {kpis.totalFleetCount}대 운용</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['규격 그룹', '총보유', '대여중', '유휴(가용)', '정비중', '가동률'].map((h, i) => (
                          <th key={h} style={{ ...S.tableHeader, textAlign: i === 0 ? 'left' : i === 5 ? 'right' : 'center', padding: '5px 6px 7px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fleet.specSummaries.map((spec) => (
                        <tr key={spec.specName} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ ...S.tableCell, fontWeight: 700 }}>{spec.specName}</td>
                          <td style={{ ...S.tableCellMuted, textAlign: 'center' }}>{spec.totalCount}대</td>
                          <td style={{ ...S.tableCell, textAlign: 'center', color: 'var(--success)', fontWeight: 700 }}>{spec.rentedCount}대</td>
                          <td style={{ ...S.tableCellMuted, textAlign: 'center' }}>{spec.availableCount}대</td>
                          <td style={{ ...S.tableCell, textAlign: 'center', color: 'var(--warning)' }}>{spec.repairingCount}대</td>
                          <td style={{ ...S.tableCell, textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{spec.utilizationRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TeamCommentPanel teamKey="YARD" />
              </div>

              {/* 우측: 30일 이상 장기 유휴 경고 */}
              <div style={{ ...S.cardDanger, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertTriangle size={14} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                    <strong style={{ ...S.subTitle, color: 'var(--danger)' }}>30일 이상 장기 유휴 장비 (기회손실)</strong>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--danger)', padding: '2px 8px', border: '1px solid var(--danger)', borderRadius: '4px' }}>집중영업 대상</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['자산번호', '모델(규격)', '유휴일수', '월 임대단가', '월 기회손실'].map((h, i) => (
                          <th key={h} style={{ ...S.tableHeader, textAlign: i < 2 ? 'left' : i === 2 ? 'center' : 'right', padding: '5px 6px 7px', color: 'var(--danger)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fleet.longIdleAssets.map((idle) => (
                        <tr key={idle.assetId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ ...S.tableCell, fontFamily: 'monospace', fontWeight: 700 }}>{idle.assetNumber}</td>
                          <td style={{ ...S.tableCellMuted }}>{idle.modelName} ({idle.spec})</td>
                          <td style={{ ...S.tableCell, textAlign: 'center', color: 'var(--warning)', fontWeight: 700 }}>{idle.daysIdle}일</td>
                          <td style={{ ...S.tableCellMuted, textAlign: 'right' }}>₩{idle.monthlyRate.toLocaleString()}</td>
                          <td style={{ ...S.tableCell, textAlign: 'right', color: 'var(--danger)', fontWeight: 700 }}>-₩{idle.estimatedOpportunityLoss.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* 3. 영업 실적 & 최다 매출 기여 거래처 TOP 5 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 좌측: 최다 매출 기여 거래처 TOP 5 */}
              <div className="p-5 rounded-xl border flex flex-col gap-3 shadow-sm" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <span>3. 당월 최다 매출 기여 거래처 TOP 5</span>
                  </h3>
                  <span className="text-[11px] text-blue-400 font-semibold">
                    신규 {sales.newContractsCount}건 / 종료 {sales.endedContractsCount}건
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800 text-[11px]">
                        <th className="py-2 text-center w-10">순위</th>
                        <th className="py-2 text-left">거래처명</th>
                        <th className="py-2 text-center">가동대수</th>
                        <th className="py-2 text-right">당월 청구액</th>
                        <th className="py-2 text-right">점유율</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {sales.topCustomers.map((c, idx) => (
                        <tr key={c.customerId} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5 text-center font-bold text-slate-400">{idx + 1}</td>
                          <td className="py-2.5 font-bold text-white whitespace-nowrap">{c.customerName}</td>
                          <td className="py-2.5 text-center text-teal-400 font-semibold">{c.assetCount}대</td>
                          <td className="py-2.5 text-right font-bold text-blue-300">₩{c.totalBilled.toLocaleString()}</td>
                          <td className="py-2.5 text-right font-black text-slate-300">{c.sharePct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TeamCommentPanel teamKey="SALES" />
              </div>

              {/* 우측: 물류 배차 효율 및 스펙 오발주 손실 배차 */}
              <div className="p-5 rounded-xl border flex flex-col gap-3 shadow-sm" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <span>4. 배차 물류 효율 및 스펙 오발주 손실 배차</span>
                  </h3>
                  <span className="text-[11px] font-bold text-emerald-400">
                    EXCHANGE 절감 +₩{kpis.exchangeSavedCost.toLocaleString()}
                  </span>
                </div>

                {/* 배차 요약 칩 */}
                <div className="grid grid-cols-4 gap-2 text-center py-2 px-3 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div>
                    <span className="text-[10px] text-slate-400 block">총 배차</span>
                    <span className="text-sm font-bold text-white">{operations.dispatchByType.total}건</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">출고</span>
                    <span className="text-sm font-bold text-blue-400">{operations.dispatchByType.outbound}건</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">회수</span>
                    <span className="text-sm font-bold text-slate-300">{operations.dispatchByType.inbound}건</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">교환(왕복)</span>
                    <span className="text-sm font-bold text-teal-400">{operations.dispatchByType.exchange}건</span>
                  </div>
                </div>

                {/* 스펙 오발주 손실 배차 건 */}
                <div className="space-y-2 mt-1">
                  <div className="flex items-center gap-1 text-[11px] font-bold text-red-400">
                    <AlertTriangle size={13} />
                    <span>현장 진입불가 / 스펙 오발주로 인한 긴급 교환 (당사 손실)</span>
                  </div>

                  {operations.specMismatchEvents.length === 0 ? (
                    <div className="text-xs text-slate-500 py-3 text-center border border-dashed border-slate-800 rounded-lg">
                      당월 발생된 스펙 오발주 손실 배차가 없습니다. (무결점 운영)
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {operations.specMismatchEvents.map((evt) => (
                        <div key={evt.id} className="p-2.5 rounded-lg bg-red-950/30 border border-red-900/40 text-xs flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-bold text-white flex items-center gap-1.5">
                              <span>{evt.customerName}</span>
                              <span className="text-slate-400 font-normal">({evt.assetNumber})</span>
                            </div>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">{evt.reason}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-xs font-bold text-red-400 block">-₩{evt.extraCost.toLocaleString()}</span>
                            <span className="text-[10px] text-slate-400">{evt.paidBy}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <TeamCommentPanel teamKey="LOGISTICS" />
              </div>
            </div>


            {/* 3. 영업 실적 + 배차 물류 섹션 — 전사 표준 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {/* 영업 TOP5 */}
              <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={S.subTitle}>2. 당월 최다 매출 기여 거래처 TOP 5</strong>
                  <span style={{ ...S.muted, color: 'var(--primary)', fontWeight: 600 }}>신규 {sales.newContractsCount}건 / 종료 {sales.endedContractsCount}건</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['순위', '거래처명', '가동대수', '당월 청구액', '점유율'].map((h, i) => (
                          <th key={h} style={{ ...S.tableHeader, textAlign: i === 0 || i === 4 ? 'center' : i === 3 || i === 4 ? 'right' : 'left', padding: '5px 6px 7px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sales.topCustomers.map((c, idx) => (
                        <tr key={c.customerId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ ...S.tableCellMuted, textAlign: 'center', fontWeight: 700 }}>{idx + 1}</td>
                          <td style={{ ...S.tableCell, fontWeight: 700 }}>{c.customerName}</td>
                          <td style={{ ...S.tableCell, textAlign: 'center', color: 'var(--success)', fontWeight: 600 }}>{c.assetCount}대</td>
                          <td style={{ ...S.tableCell, textAlign: 'right', color: 'var(--primary)', fontWeight: 700 }}>₩{c.totalBilled.toLocaleString()}</td>
                          <td style={{ ...S.tableCellMuted, textAlign: 'right', fontWeight: 700 }}>{c.sharePct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TeamCommentPanel teamKey="SALES" />
              </div>

              {/* 배차 물류 효율 */}
              <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={S.subTitle}>3. 배차 물류 효율 및 오발주 손실 배차</strong>
                  <span style={{ ...S.muted, color: 'var(--success)', fontWeight: 600 }}>EXCHANGE 절감 +₩{kpis.exchangeSavedCost.toLocaleString()}</span>
                </div>
                {/* 배차 요약 칩 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', padding: '8px', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                  {[
                    { label: '총 배차', val: `${operations.dispatchByType.total}건`, color: 'var(--text-primary)' },
                    { label: '출고', val: `${operations.dispatchByType.outbound}건`, color: 'var(--primary)' },
                    { label: '회수', val: `${operations.dispatchByType.inbound}건`, color: 'var(--text-secondary)' },
                    { label: '교환(왕복)', val: `${operations.dispatchByType.exchange}건`, color: 'var(--success)' },
                  ].map((item) => (
                    <div key={item.label}>
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'block' }}>{item.label}</span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: item.color }}>{item.val}</span>
                    </div>
                  ))}
                </div>
                {/* 오발주 손실 배차 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--danger)' }}>
                    <AlertTriangle size={13} />
                    현장 진입불가 / 스펙 오발주 긴급 교환 (당사 손실)
                  </div>
                  {operations.specMismatchEvents.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '10px', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                      당월 스펙 오발주 손실 배차 없음 (무결점)
                    </div>
                  ) : operations.specMismatchEvents.map((evt) => (
                    <div key={evt.id} style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--danger)', backgroundColor: 'var(--bg-app)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '12px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{evt.customerName}</span>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({evt.assetNumber})</span>
                        </div>
                        <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evt.reason}</p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--danger)', display: 'block' }}>-₩{evt.extraCost.toLocaleString()}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{evt.paidBy}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <TeamCommentPanel teamKey="LOGISTICS" />
              </div>
            </div>

            {/* 4. 채권 에이징 + Waiver 투명 보고 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {/* 채권 에이징 */}
              <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={S.subTitle}>4. 미수 채권 연체 에이징 분석</strong>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--warning)' }}>총 미수 ₩{finance.receivablesAging.totalUnpaid.toLocaleString()}</span>
                </div>
                {/* 에이징 4구간 칩 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                  {[
                    { label: '정상(30일↓)', val: finance.receivablesAging.under30Days, color: 'var(--success)' },
                    { label: '31~60일', val: finance.receivablesAging.days31To60, color: 'var(--primary)' },
                    { label: '61~90일', val: finance.receivablesAging.days61To90, color: 'var(--warning)' },
                    { label: '90일↑(고위험)', val: finance.receivablesAging.over90Days, color: 'var(--danger)' },
                  ].map((item) => (
                    <div key={item.label} style={{ padding: '8px', borderRadius: '6px', border: `1px solid ${item.color}`, textAlign: 'center', backgroundColor: 'var(--bg-app)' }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, color: item.color, display: 'block' }}>{item.label}</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: item.color, display: 'block', marginTop: '4px' }}>₩{item.val.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                {/* 집중 관리 대상 연체 거래처 */}
                <div>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>집중 관리 대상 연체 거래처</span>
                  {finance.topDelinquentCustomers.map((dc) => (
                    <div key={dc.customerId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>{dc.customerName}</span>
                        <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--warning)', padding: '1px 6px', border: '1px solid var(--warning)', borderRadius: '4px' }}>{dc.status}</span>
                      </div>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--danger)' }}>₩{dc.unpaidAmount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Waiver 투명 보고 */}
              <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Ban size={14} style={{ color: 'var(--warning)' }} />
                    <strong style={S.subTitle}>5. 영업 청구 면제(Waiver) 손실 투명 보고</strong>
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--danger)' }}>총 면제액: ₩{finance.waiverSummary.totalWaived.toLocaleString()}</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['구분', '고객사', '면제 사유', '면제액'].map((h, i) => (
                          <th key={h} style={{ ...S.tableHeader, textAlign: i === 3 ? 'right' : 'left', padding: '5px 6px 7px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {finance.waivers.map((wv) => (
                        <tr key={wv.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ ...S.tableCellMuted, fontWeight: 600 }}>{wv.typeLabel}</td>
                          <td style={{ ...S.tableCell, fontWeight: 700 }}>{wv.customerName}</td>
                          <td style={{ ...S.tableCellMuted, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{wv.reason}</td>
                          <td style={{ ...S.tableCell, textAlign: 'right', color: 'var(--danger)', fontWeight: 700 }}>₩{wv.waivedAmount.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TeamCommentPanel teamKey="FINANCE" />
              </div>
            </div>

            {/* 정비팀 코멘트 섹션 */}
            <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wrench size={14} style={{ color: 'var(--warning)' }} />
                <strong style={S.subTitle}>정비 품질 및 AS 현황</strong>
                <span style={S.muted}>MTTR {kpis.avgMttrHours}h · 완료 {kpis.totalRepairs}건 · 조기고장 {kpis.earlyFailuresCount}건</span>
              </div>
              <TeamCommentPanel teamKey="MAINTENANCE" />
            </div>

            {/* 6. 경영진 지시사항 */}
            <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={15} style={{ color: 'var(--primary)' }} />
                  <strong style={S.subTitle}>6. 경영진 종합 진단 및 차월 중점 지시사항</strong>
                </div>
                <button
                  className="btn-primary"
                  onClick={handleSaveDirective}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '12px' }}
                >
                  <Save size={13} /> 지시사항 저장
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={S.sectionLabel}>당월 마감 경영 총평</label>
                  <textarea
                    rows={4}
                    value={directive.remarks}
                    onChange={(e) => setDirective({ ...directive, remarks: e.target.value })}
                    placeholder="당월 매출 실적 및 장비 가동률에 대한 경영진 평가를 입력하십시오..."
                    style={S.textarea as any}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={S.sectionLabel}>차월 부서별 중점 실행 과제</label>
                  <textarea
                    rows={4}
                    value={directive.priorityTasks}
                    onChange={(e) => setDirective({ ...directive, priorityTasks: e.target.value })}
                    placeholder="1. 30일 이상 유휴 32ft 장비 대형 현장 프로모션  2. 고위험 연체처 출고 제한..."
                    style={S.textarea as any}
                  />
                </div>
              </div>
            </div>

            {/* 7. Gutenberg 대차대조식 검증 바 — Terminal Action */}
            <div style={{ ...S.card, backgroundColor: 'var(--bg-app)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>📄 대차대조 검증:</span>
                <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                  매출청구총액 <strong style={{ color: 'var(--text-primary)' }}>₩{kpis.totalRevenue.toLocaleString()}</strong> =
                  🟢 수납액 <strong style={{ color: 'var(--success)' }}>₩{kpis.collectedAmount.toLocaleString()}</strong> +
                  🔴 미수잔액 <strong style={{ color: 'var(--warning)' }}>₩{kpis.unpaidAmount.toLocaleString()}</strong>
                </span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--success)', padding: '2px 10px', border: '1px solid var(--success)', borderRadius: '4px' }}>
                  ⚖️ 대차 차액 ₩{conservation.delta.toLocaleString()} (100% 무결성 확정)
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                작성자: <strong style={{ color: 'var(--text-primary)' }}>대표이사</strong>
                &nbsp;·&nbsp;
                결재상태: <strong style={{ color: 'var(--success)' }}>공식 확정됨</strong>
              </div>
            </div>
          </div>
        )}

        {/* [모드 2] 부서별 상세 분석 (드릴다운) */}
        {viewMode === 'DRILLDOWN' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* 드릴다운 서브 탭 */}
            <div style={{ ...S.card, padding: '0 18px', display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
              {[
                { key: 'FLEET', label: '자산·플릿 운용', count: `${kpis.totalFleetCount}대` },
                { key: 'SALES', label: '영업·계약 실적', count: `₩${kpis.totalRevenue.toLocaleString()}` },
                { key: 'LOGISTICS', label: '배차·물류 원가', count: `${operations.dispatchByType.total}건` },
                { key: 'MAINTENANCE', label: '정비·AS 품질', count: `MTTR ${kpis.avgMttrHours}h` },
                { key: 'FINANCE', label: '채권·수금 건전성', count: `수납률 ${kpis.collectionRate}%` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setDrilldownTab(tab.key as any)}
                  style={{
                    padding: '11px 14px', fontSize: '12px', fontWeight: 700,
                    borderBottom: drilldownTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                    color: drilldownTab === tab.key ? 'var(--primary)' : 'var(--text-secondary)',
                    background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {tab.label} <span style={{ fontSize: '10px', opacity: 0.75 }}>({tab.count})</span>
                </button>
              ))}
            </div>

            {/* 드릴다운 본문 */}
            <div style={{ ...S.card }}>
              {drilldownTab === 'FLEET' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <strong style={S.subTitle}>전체 장비 플릿 상세 명세 및 가동 상태</strong>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['규격명', '총 대수', '대여중', '대여가능', '정비중', '가동률'].map((h, i) => (
                            <th key={h} style={{ ...S.tableHeader, textAlign: i === 0 ? 'left' : i === 5 ? 'right' : 'center', padding: '5px 6px 7px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {fleet.specSummaries.map(s => (
                          <tr key={s.specName} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ ...S.tableCell, fontWeight: 700 }}>{s.specName}</td>
                            <td style={{ ...S.tableCellMuted, textAlign: 'center' }}>{s.totalCount}대</td>
                            <td style={{ ...S.tableCell, textAlign: 'center', color: 'var(--success)', fontWeight: 700 }}>{s.rentedCount}대</td>
                            <td style={{ ...S.tableCellMuted, textAlign: 'center' }}>{s.availableCount}대</td>
                            <td style={{ ...S.tableCell, textAlign: 'center', color: 'var(--warning)' }}>{s.repairingCount}대</td>
                            <td style={{ ...S.tableCell, textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{s.utilizationRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {drilldownTab === 'SALES' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <strong style={S.subTitle}>영업사원별 계약 수주 및 매출 기여 실적</strong>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['영업담당자', '담당 계약건수', '가동 장비수', '당월 매출 기여액'].map((h, i) => (
                            <th key={h} style={{ ...S.tableHeader, textAlign: i === 0 ? 'left' : i === 3 ? 'right' : 'center', padding: '5px 6px 7px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sales.salespersonPerformance.map(sp => (
                          <tr key={sp.name} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ ...S.tableCell, fontWeight: 700 }}>{sp.name}</td>
                            <td style={{ ...S.tableCellMuted, textAlign: 'center' }}>{sp.contractCount}건</td>
                            <td style={{ ...S.tableCell, textAlign: 'center', color: 'var(--success)', fontWeight: 700 }}>{sp.activeAssetCount}대</td>
                            <td style={{ ...S.tableCell, textAlign: 'right', color: 'var(--primary)', fontWeight: 700 }}>₩{sp.totalBilled.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {drilldownTab === 'LOGISTICS' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <strong style={S.subTitle}>배차 물류 실적 및 운송비 지출 분석</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[
                      { label: '총 운송비 지출', val: operations.transportCostTotal, color: 'var(--text-primary)' },
                      { label: '고객 청구 운송비', val: operations.customerBorneTransport, color: 'var(--primary)' },
                      { label: '당사 순부담 운송비', val: operations.companyBorneTransport, color: 'var(--danger)' },
                    ].map((item) => (
                      <div key={item.label} style={{ ...S.cardSm, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={S.sectionLabel}>{item.label}</span>
                        <strong style={{ fontSize: '18px', color: item.color }}>₩{item.val.toLocaleString()}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {drilldownTab === 'MAINTENANCE' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <strong style={S.subTitle}>정비 및 AS 처리 내역 및 조기 고장 분석</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[
                      { label: '현장 AS 처리', val: `${operations.maintenanceByType.fieldAs}건`, color: 'var(--text-primary)' },
                      { label: '주기장 오버홀', val: `${operations.maintenanceByType.overhaul}건`, color: 'var(--text-primary)' },
                      { label: '출고 7일내 조기고장', val: `${kpis.earlyFailuresCount}건`, color: 'var(--warning)' },
                    ].map((item) => (
                      <div key={item.label} style={{ ...S.cardSm, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={S.sectionLabel}>{item.label}</span>
                        <strong style={{ fontSize: '18px', color: item.color }}>{item.val}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {drilldownTab === 'FINANCE' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <strong style={S.subTitle}>채권 에이징 상세 및 연체 집중 관리 대장</strong>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['거래처명', '연체 일수', '관리 상태', '미수 잔액'].map((h, i) => (
                            <th key={h} style={{ ...S.tableHeader, textAlign: i === 0 ? 'left' : i === 3 ? 'right' : 'center', padding: '5px 6px 7px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {finance.topDelinquentCustomers.map(dc => (
                          <tr key={dc.customerId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ ...S.tableCell, fontWeight: 700 }}>{dc.customerName}</td>
                            <td style={{ ...S.tableCell, textAlign: 'center', color: 'var(--warning)', fontWeight: 700 }}>{dc.overdueDays}일</td>
                            <td style={{ textAlign: 'center', padding: '7px 0' }}>
                              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-secondary)', padding: '2px 6px', border: '1px solid var(--border-color)', borderRadius: '4px' }}>{dc.status}</span>
                            </td>
                            <td style={{ ...S.tableCell, textAlign: 'right', color: 'var(--danger)', fontWeight: 700 }}>₩{dc.unpaidAmount.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

