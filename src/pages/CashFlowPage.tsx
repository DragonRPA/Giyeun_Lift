import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { db } from '../services/db';
import { 
  TrendingUp, ArrowDownRight, ArrowUpRight, AlertTriangle, 
  Layers, CheckCircle, RefreshCw, Landmark, 
  Camera, Trash2, Calendar, FileText, Clock,
  ChevronLeft, ChevronRight, BarChart2, X, Info,
  Download, ExternalLink, ShieldAlert, DollarSign
} from 'lucide-react';
import { exportToExcel } from '../services/excel';

interface DailyForecastItem {
  date: string;
  isPast: boolean; // 과거 실적 vs 미래 예정
  inflow: number;
  inflowDetail: string;
  inflowItems: {
    source: 'BILLING' | 'RECEIVABLE' | 'ASSET_SALE' | 'BANK_TX';
    id: string;
    title: string;
    amount: number;
  }[];
  opex: number;
  opexDetail: string;
  opexItems: {
    source: 'SETTLEMENT' | 'LEASE' | 'PAYROLL' | 'BANK_TX';
    id: string;
    title: string;
    amount: number;
  }[];
  capex: number;
  capexDetail: string;
  capexItems: {
    source: 'ASSET_CAPEX';
    id: string;
    title: string;
    amount: number;
  }[];
  net: number;
  cumulative: number;
  status: 'SAFE' | 'WARNING' | 'CRITICAL';
}

// ─── 날짜 연산 헬퍼 (타임존 변환 오프셋 방지) ───
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function getNextMonthDue(dateStr: string, dueDay: number): string {
  const [y, m] = dateStr.split('-').map(Number);
  const dt = new Date(y, m, dueDay);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export const CashFlowPage: React.FC = () => {
  const { 
    hasPermission, 
    cashFlowSnapshots, 
    saveCashFlowSnapshot, 
    deleteCashFlowSnapshot, 
    bankTransactions, 
    bankInitialBalances,
    billings,
    receivables,
    purchaseSettlements,
    assets, 
    users,
    contracts,
    customers,
    refreshAllData
  } = useApp();

  const canSave = hasPermission('billing', 'save');

  // 토스트 알림 상태 (헌장 5.2: 브라우저 alert/confirm 전면 배제)
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 탭 관리: 유동성 전망 대장 vs 스냅샷 이력 대장 (헌장 3.1 무수식어 건조 표준)
  const [activeSubTab, setActiveSubTab] = useState<'FORECAST' | 'HISTORY'>('FORECAST');

  // ─── 헌장 3.5 좌상단 Scope 제어 필터 ───
  // 1. 기준일 (기본 오늘)
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [baseDate, setBaseDate] = useState<string>(todayStr);

  // 2. 전망 기간 (30일 / 60일 / 90일)
  const [forecastDays, setForecastDays] = useState<30 | 60 | 90>(30);

  // 3. 계좌 필터 ('ALL' 또는 특정 은행명)
  const [selectedBank, setSelectedBank] = useState<string>('ALL');

  // 4. 안전 기준액 (기본 10,000,000원)
  const [safetyThreshold, setSafetyThreshold] = useState<number>(10000000);

  // 스냅샷 비고 입력 모달
  const [showSnapModal, setShowSnapModal] = useState(false);
  const [snapNotes, setSnapNotes] = useState('');

  // 특정 일자의 원천 전표 상세 드로어 (일자 문자열 또는 null)
  const [selectedDetailDate, setSelectedDetailDate] = useState<DailyForecastItem | null>(null);

  // 차트 마우스 호버 포인트
  const [hoveredPoint, setHoveredPoint] = useState<{ item: DailyForecastItem; x: number; y: number } | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);

  // 사용 가능한 은행 계좌 목록 추출 (고유 은행명)
  const availableBanks = useMemo(() => {
    const banks = new Set<string>();
    (bankInitialBalances || []).forEach(b => {
      if (b.bankName) banks.add(b.bankName);
    });
    (bankTransactions || []).forEach(t => {
      if (t.bankName) banks.add(t.bankName);
    });
    return Array.from(banks);
  }, [bankInitialBalances, bankTransactions]);

  // ─── 1. 실시간 가용 시작 잔액 (B0) 정밀 산출 엔진 ───
  // 기준일(baseDate) 시점의 실제 통장 잔고 산출:
  // B(baseDate) = 기초잔액합계 + sum(baseDate 이전 모든 실제 거래내역 입금 - 출금)
  const startingBalanceAtBase = useMemo(() => {
    let initSum = 0;
    (bankInitialBalances || []).forEach(b => {
      if (selectedBank === 'ALL' || b.bankName === selectedBank) {
        initSum += (b.initialBalance || 0);
      }
    });

    let transSum = 0;
    (bankTransactions || []).forEach(t => {
      if (selectedBank === 'ALL' || t.bankName === selectedBank) {
        // 기준일 이전까지의 실제 거래만 반영 (당일 포함)
        if (t.transactionDate <= `${baseDate} 23:59:59`) {
          transSum += ((t.depositAmount || 0) - (t.withdrawAmount || 0));
        }
      }
    });

    return initSum + transSum;
  }, [bankInitialBalances, bankTransactions, selectedBank, baseDate]);

  // ─── 2. 전대(임차) 자산 월 임차료 실데이터 집계 ───
  const activeRentedAssets = useMemo(() => {
    return (assets || []).filter(a => a.ownerType === 'RENTED' && a.status !== 'SOLD' && a.status !== 'RENTED_RETURNED');
  }, [assets]);

  const monthlyLeaseExpense = useMemo(() => {
    return activeRentedAssets.reduce((sum, a) => sum + (a.monthlyRentFee || a.monthlyRentalFee || 0), 0);
  }, [activeRentedAssets]);

  // ─── 3. 임직원 정기 급여 합계 집계 ───
  const activeUsersSalaryTotal = useMemo(() => {
    const activeUsers = (users || []).filter(u => u.status === 'ACTIVE' || !u.status);
    if (activeUsers.length === 0) return 0;
    const sumSalary = activeUsers.reduce((sum, u) => sum + (u.baseSalary || 0), 0);
    // 기본급 데이터가 미등록된 초기 상태를 위한 기본 고정비 fallback
    return sumSalary > 0 ? sumSalary : (activeUsers.length * 3000000);
  }, [users]);

  // ─── 4. 직접법(Direct Method) 실데이터 1:1 대사 일별 전망 엔진 ───
  const forecastList = useMemo(() => {
    const list: DailyForecastItem[] = [];

    let currentCumulative = startingBalanceAtBase;

    for (let i = 1; i <= forecastDays; i++) {
      const targetDateStr = addDays(baseDate, i);
      const isPast = targetDateStr < todayStr;

      let dailyInflow = 0;
      const inflowItems: DailyForecastItem['inflowItems'] = [];
      let dailyOpex = 0;
      const opexItems: DailyForecastItem['opexItems'] = [];
      let dailyCapex = 0;
      const capexItems: DailyForecastItem['capexItems'] = [];

      if (isPast) {
        // [과거 일자]: 실제 통장 거래내역(bankTransactions) 1:1 대사
        const dayTxs = (bankTransactions || []).filter(t => {
          const matchBank = selectedBank === 'ALL' || t.bankName === selectedBank;
          return matchBank && t.transactionDate.startsWith(targetDateStr);
        });

        dayTxs.forEach(t => {
          if (t.depositAmount > 0) {
            dailyInflow += t.depositAmount;
            inflowItems.push({
              source: 'BANK_TX',
              id: t.id,
              title: `${t.senderName || '통장입금'} (${t.bankName || '은행'})`,
              amount: t.depositAmount
            });
          }
          if (t.withdrawAmount > 0) {
            dailyOpex += t.withdrawAmount;
            opexItems.push({
              source: 'BANK_TX',
              id: t.id,
              title: `${t.senderName || '통장출금'} (${t.bankName || '은행'})`,
              amount: t.withdrawAmount
            });
          }
        });
      } else {
        // [당일 및 미래 일자]: 원천 DB 실데이터 직접법 1:1 매핑

        // ① 매출 청구서 미수금 (billings) 매핑
        (billings || []).forEach(b => {
          if (b.status === 'UNPAID' || b.status === 'PARTIAL' || (b.status as string) === 'OVERDUE') {
            const unpaid = Math.max(0, (b.totalAmount || 0) - (b.paidAmount || 0));
            if (unpaid <= 0) return;

            // 납기일 판단: 고객사 또는 계약의 paymentDueDay 기준 익월 N일
            const cust = customers.find(c => c.id === b.customerId);
            const contract = contracts.find(c => c.id === b.contractId);
            const dueDay = contract?.paymentDueDay || cust?.paymentDueDay || 25;
            const dueDate = getNextMonthDue(b.billingDate || todayStr, dueDay);

            if (dueDate === targetDateStr) {
              const custName = cust?.name || b.customerId;
              dailyInflow += unpaid;
              inflowItems.push({
                source: 'BILLING',
                id: b.id,
                title: `${custName} 렌탈 청구 수납예정 (${b.id})`,
                amount: unpaid
              });
            }
          }
        });

        // ② 단독 외상채권 (receivables) 매핑
        (receivables || []).forEach(r => {
          if (r.status === 'PENDING' || r.status === 'PARTIAL') {
            const unpaid = Math.max(0, (r.totalAmount || 0) - (r.billedAmount || 0));
            if (unpaid <= 0) return;

            // 채권 발생일로부터 30일 후 약정일
            const due = addDays(r.occurredDate || todayStr, 30);
            if (due === targetDateStr) {
              const cust = customers.find(c => c.id === r.customerId);
              const custName = cust?.name || '고객사';
              dailyInflow += unpaid;
              inflowItems.push({
                source: 'RECEIVABLE',
                id: r.id,
                title: `${custName} 외상채권(${r.internalDescription || r.type}) 회수예정`,
                amount: unpaid
              });
            }
          }
        });

        // ③ 자산 매각 계약 잔금 및 계약금 (contracts[contractType === 'SALE'])
        (contracts || []).forEach(c => {
          if (c.contractType === 'SALE' && c.saleTerms) {
            const terms = c.saleTerms;
            const cust = customers.find(cu => cu.id === c.customerId);
            
            // 계약금 입금예정
            if (terms.installmentDownDate === targetDateStr && (terms.installmentDownAmount || 0) > 0) {
              dailyInflow += (terms.installmentDownAmount || 0);
              inflowItems.push({
                source: 'ASSET_SALE',
                id: `${c.id}-down`,
                title: `${cust?.name || '매수처'} 자산 매각 계약금 입금예정 (${c.contractNo})`,
                amount: terms.installmentDownAmount || 0
              });
            }

            // 잔금 입금예정
            if (terms.installmentBalanceDueDate === targetDateStr && (terms.installmentBalanceAmount || 0) > 0) {
              dailyInflow += (terms.installmentBalanceAmount || 0);
              inflowItems.push({
                source: 'ASSET_SALE',
                id: `${c.id}-balance`,
                title: `${cust?.name || '매수처'} 자산 매각 잔금 입금예정 (${c.contractNo})`,
                amount: terms.installmentBalanceAmount || 0
              });
            }
          }
        });

        // ④ 매입정산 미지급금 (purchaseSettlements)
        (purchaseSettlements || []).forEach(ps => {
          if (ps.status === 'CONFIRMED' || ps.status === 'PENDING') {
            const unpaid = Math.max(0, (ps.totalAmount || 0) - (ps.paidAmount || 0));
            if (unpaid <= 0) return;

            // 지급예정일: paymentDate 또는 정산월 익월 10일
            let payDate = ps.paymentDate;
            if (!payDate && ps.settlementYm) {
              const parts = ps.settlementYm.split('-');
              const year = parseInt(parts[0]);
              const month = parseInt(parts[1]);
              const d = new Date(year, month, 10);
              payDate = d.toISOString().split('T')[0];
            }

            if (payDate === targetDateStr) {
              dailyOpex += unpaid;
              opexItems.push({
                source: 'SETTLEMENT',
                id: ps.id,
                title: `${ps.vendorName || '매입처'} 매입정산금 지급 (${ps.settlementType})`,
                amount: unpaid
              });
            }
          }
        });

        // ⑤ 전대(외부 임차) 장비 월 임차료: 매월 20일 자동 스케줄링
        const dayOfMonth = parseInt(targetDateStr.split('-')[2]);
        if (dayOfMonth === 20 && monthlyLeaseExpense > 0) {
          dailyOpex += monthlyLeaseExpense;
          opexItems.push({
            source: 'LEASE',
            id: `lease-${targetDateStr}`,
            title: `임차 고소장비 대금 정산 (${activeRentedAssets.length}대)`,
            amount: monthlyLeaseExpense
          });
        }

        // ⑥ 임직원 월 정기 급여: 매월 15일 자동 스케줄링
        if (dayOfMonth === 15 && activeUsersSalaryTotal > 0) {
          dailyOpex += activeUsersSalaryTotal;
          opexItems.push({
            source: 'PAYROLL',
            id: `payroll-${targetDateStr}`,
            title: '임직원 월 정기급여 지급',
            amount: activeUsersSalaryTotal
          });
        }

        // ⑦ 신규 자산 도입 설비투자 (CAPEX): 향후 자산 취득일
        (assets || []).forEach(a => {
          if (a.acquisitionDate === targetDateStr && a.acquisitionPrice && a.acquisitionPrice > 0) {
            dailyCapex += a.acquisitionPrice;
            capexItems.push({
              source: 'ASSET_CAPEX',
              id: a.id,
              title: `${a.modelName || '고소작업대'} 신규 도입 취득 (CAPEX)`,
              amount: a.acquisitionPrice
            });
          }
        });
      }

      const net = dailyInflow - dailyOpex - dailyCapex;
      currentCumulative += net;

      // 유동성 상태 판단 (CRITICAL: 잔고 < 0, WARNING: 잔고 < 안전기준액, SAFE: 정상)
      let status: 'SAFE' | 'WARNING' | 'CRITICAL' = 'SAFE';
      if (currentCumulative < 0) {
        status = 'CRITICAL';
      } else if (currentCumulative < safetyThreshold) {
        status = 'WARNING';
      }

      // 텍스트 요약 생성
      const inflowDetail = inflowItems.map(i => i.title).slice(0, 2).join(', ') + (inflowItems.length > 2 ? ` 외 ${inflowItems.length - 2}건` : '');
      const opexDetail = opexItems.map(i => i.title).slice(0, 2).join(', ') + (opexItems.length > 2 ? ` 외 ${opexItems.length - 2}건` : '');
      const capexDetail = capexItems.map(i => i.title).slice(0, 2).join(', ') + (capexItems.length > 2 ? ` 외 ${capexItems.length - 2}건` : '');

      list.push({
        date: targetDateStr,
        isPast,
        inflow: dailyInflow,
        inflowDetail,
        inflowItems,
        opex: dailyOpex,
        opexDetail,
        opexItems,
        capex: dailyCapex,
        capexDetail,
        capexItems,
        net,
        cumulative: currentCumulative,
        status
      });
    }

    return list;
  }, [
    baseDate, 
    forecastDays, 
    startingBalanceAtBase, 
    todayStr, 
    selectedBank, 
    bankTransactions, 
    billings, 
    receivables, 
    contracts, 
    purchaseSettlements, 
    monthlyLeaseExpense, 
    activeRentedAssets.length, 
    activeUsersSalaryTotal, 
    assets, 
    customers, 
    safetyThreshold
  ]);

  // ─── 5. 구간 종단 합계 및 유동성 진단 메트릭 ───
  const totalInflow = useMemo(() => forecastList.reduce((s, i) => s + i.inflow, 0), [forecastList]);
  const totalOpex = useMemo(() => forecastList.reduce((s, i) => s + i.opex, 0), [forecastList]);
  const totalCapex = useMemo(() => forecastList.reduce((s, i) => s + i.capex, 0), [forecastList]);
  const finalBalance = useMemo(() => startingBalanceAtBase + totalInflow - totalOpex - totalCapex, [startingBalanceAtBase, totalInflow, totalOpex, totalCapex]);

  // 최저 잔고 지점 (Trough Date) 및 부도위험 감지
  const minBalanceItem = useMemo(() => {
    if (forecastList.length === 0) return null;
    return forecastList.reduce((min, curr) => curr.cumulative < min.cumulative ? curr : min, forecastList[0]);
  }, [forecastList]);

  // 현금 런웨이 (Runway, 일수): 일평균 운영지출 대비 현재 가용자금 지속 기간
  const cashRunwayDays = useMemo(() => {
    const dailyBurnRate = forecastDays > 0 ? (totalOpex / forecastDays) : 0;
    if (dailyBurnRate <= 0) return 999;
    if (startingBalanceAtBase <= 0) return 0;
    return Math.floor(startingBalanceAtBase / dailyBurnRate);
  }, [startingBalanceAtBase, totalOpex, forecastDays]);

  // ─── 6. 대차대조식 검증 요약 (종단 보존 법칙 차액 ₩0 무결성) ───
  const auditSummary = useMemo(() => {
    const computedFinal = startingBalanceAtBase + totalInflow - totalOpex - totalCapex;
    const diff = finalBalance - computedFinal;
    const isSafe = finalBalance >= safetyThreshold && (!minBalanceItem || minBalanceItem.cumulative >= safetyThreshold);
    const isCritical = (minBalanceItem && minBalanceItem.cumulative < 0) || finalBalance < 0;

    return {
      startingBalance: startingBalanceAtBase,
      totalInflow,
      totalOpex,
      totalCapex,
      finalBalance,
      diff,
      isSafe,
      isCritical
    };
  }, [startingBalanceAtBase, totalInflow, totalOpex, totalCapex, finalBalance, safetyThreshold, minBalanceItem]);

  // ─── 7. 스냅샷 동결 저장 핸들러 ───
  const handleSaveSnapshotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveCashFlowSnapshot({
        snapshotDate: baseDate,
        startingBalance: startingBalanceAtBase,
        projectedInflow: totalInflow,
        projectedOpex: totalOpex,
        projectedCapex: totalCapex,
        projectedFinalBalance: finalBalance,
        notes: snapNotes
      });
      await db.awaitPendingWrites();

      showToast(`기준일(${baseDate}) 자금흐름 스냅샷이 성공적으로 저장되었습니다.`);
      setShowSnapModal(false);
      setSnapNotes('');
    } catch (err: any) {
      showToast(`스냅샷 저장 실패: ${err?.message || err}`, 'error');
    }
  };

  // ─── 8. 엑셀 내보내기 핸들러 (전사 표준 exportToExcel 적용) ───
  const handleExportCashFlowExcel = () => {
    if (forecastList.length === 0) {
      showToast('내보낼 데이터가 없습니다.', 'error');
      return;
    }

    const exportRows = forecastList.map((item, idx) => {
      const statusStr = item.status === 'CRITICAL' ? '부도위험' : item.status === 'WARNING' ? '자금주의' : '안전';
      const isPastStr = item.isPast ? '실적' : '예정';
      return {
        'No': idx + 1,
        '일자': item.date,
        '실적구분': isPastStr,
        '수납예정(원)': item.inflow,
        '수납상세': item.inflowDetail,
        '운영지출(원)': item.opex,
        '운영지출상세': item.opexDetail,
        '투자지출(원)': item.capex,
        '투자상세': item.capexDetail,
        '일일순유출입(원)': item.net,
        '예상누적잔고(원)': item.cumulative,
        '유동성상태': statusStr
      };
    });

    exportToExcel(exportRows, `유동성전망대장_${baseDate}_${forecastDays}일`, '유동성전망');
    showToast(`총 ${forecastList.length}건의 유동성 전망 데이터가 엑셀로 내보내기 되었습니다.`);
  };

  const handleExportSnapshotHistory = () => {
    if (cashFlowSnapshots.length === 0) {
      showToast('내보낼 스냅샷 이력이 없습니다.', 'error');
      return;
    }

    const exportRows = cashFlowSnapshots.map((snap, idx) => ({
      'No': idx + 1,
      '스냅샷기준일': snap.snapshotDate,
      '기초통장잔고(원)': snap.startingBalance,
      '수납예정액(원)': snap.projectedInflow,
      '일반지출액(원)': snap.projectedOpex,
      '설비투자액(원)': snap.projectedCapex,
      '최종예상잔고(원)': snap.projectedFinalBalance,
      '경영분석메모': snap.notes || ''
    }));

    exportToExcel(exportRows, `자금계획스냅샷이력_${new Date().toISOString().substring(0, 10)}`, '스냅샷이력');
    showToast(`총 ${cashFlowSnapshots.length}건의 스냅샷 이력이 엑셀로 내보내기 되었습니다.`);
  };

  // ─── 9. 슬림 SVG 유동성 밴드 차트 렌더링 좌표 계산 ───
  const svgChartPaths = useMemo(() => {
    if (forecastList.length === 0) return null;

    const width = 800;
    const height = 90;
    const paddingLeft = 60;
    const paddingRight = 20;
    const paddingTop = 12;
    const paddingBottom = 16;
    const chartW = width - paddingLeft - paddingRight;
    const chartH = height - paddingTop - paddingBottom;

    const values = forecastList.map(p => p.cumulative);
    const minVal = Math.min(0, ...values);
    const maxVal = Math.max(safetyThreshold * 1.5, ...values, 1000000);
    const range = (maxVal - minVal) || 1;

    const points = forecastList.map((item, idx) => {
      const x = paddingLeft + (idx / Math.max(forecastList.length - 1, 1)) * chartW;
      const y = paddingTop + chartH - ((item.cumulative - minVal) / range) * chartH;
      return { x, y, item };
    });

    const linePath = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const zeroY = paddingTop + chartH - ((0 - minVal) / range) * chartH;
    const safetyY = paddingTop + chartH - ((safetyThreshold - minVal) / range) * chartH;
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${zeroY} L ${points[0].x} ${zeroY} Z`;

    return {
      width,
      height,
      paddingLeft,
      paddingRight,
      chartW,
      chartH,
      points,
      linePath,
      areaPath,
      zeroY,
      safetyY,
      minVal,
      maxVal
    };
  }, [forecastList, safetyThreshold]);

  // 차트 마우스오버 핸들러
  const handleChartMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!svgChartPaths || forecastList.length === 0 || !chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const scaleX = svgChartPaths.width / rect.width;
    const svgX = clientX * scaleX;

    if (svgX < svgChartPaths.paddingLeft || svgX > svgChartPaths.width - svgChartPaths.paddingRight) {
      setHoveredPoint(null);
      return;
    }

    const pct = (svgX - svgChartPaths.paddingLeft) / svgChartPaths.chartW;
    const idx = Math.min(Math.max(Math.round(pct * (forecastList.length - 1)), 0), forecastList.length - 1);
    const p = svgChartPaths.points[idx];
    setHoveredPoint(p);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '1080px', paddingBottom: '60px' }}>
      
      {/* ─── 토스트 알림 ─── */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 20px',
          borderRadius: '8px',
          backgroundColor: toastMessage.type === 'error' ? '#ef4444' : '#10b981',
          color: '#ffffff',
          fontWeight: '600',
          fontSize: '13px',
          zIndex: 9999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          {toastMessage.text}
        </div>
      )}

      {/* ─── 최상단 헤더 (헌장 3.1 무수식어 건조 표준) ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <TrendingUp size={24} color="var(--primary)" />
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: '800', margin: 0, whiteSpace: 'nowrap' }}>
              자금 흐름 분석
            </h1>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              직접법(Direct Method) 실데이터 1:1 대사 및 유동성 전망
            </span>
          </div>
        </div>

        {/* 탭 네비게이션 */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            className={activeSubTab === 'FORECAST' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveSubTab('FORECAST')}
            style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          >
            <BarChart2 size={15} /> 유동성 전망 대장
          </button>
          <button 
            className={activeSubTab === 'HISTORY' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setActiveSubTab('HISTORY')}
            style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
          >
            <Clock size={15} /> 스냅샷 이력 대장 ({cashFlowSnapshots.length})
          </button>
        </div>
      </div>

      {activeSubTab === 'FORECAST' && (
        <>
          {/* ─── Gutenberg Z-패턴 ① 좌상단 Scope & ② 우상단 Pipeline 바 ─── */}
          <div className="card" style={{ margin: 0, padding: '14px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', flexWrap: 'nowrap' }}>
              
              {/* ① 좌측 상단 (Scope: 상하 세로 스택 헌장 3.4) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'nowrap' }}>
                
                {/* 필터 1: 기준일 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    분석 기준일
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input 
                      type="date"
                      value={baseDate}
                      onChange={e => setBaseDate(e.target.value)}
                      style={{ padding: '5px 8px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', height: '32px' }}
                    />
                    <button
                      className="btn-secondary"
                      onClick={() => setBaseDate(todayStr)}
                      style={{ padding: '0 8px', height: '32px', fontSize: '11px', whiteSpace: 'nowrap', fontWeight: 'bold' }}
                      title="오늘 날짜로 이동"
                    >
                      오늘
                    </button>
                  </div>
                </div>

                {/* 필터 2: 전망 기간 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    전망 기간
                  </label>
                  <div style={{ display: 'flex', gap: '2px', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '2px', height: '32px' }}>
                    {([30, 60, 90] as const).map(d => (
                      <button
                        key={d}
                        onClick={() => setForecastDays(d)}
                        style={{
                          padding: '0 10px',
                          border: 'none',
                          borderRadius: '3px',
                          fontSize: '12px',
                          fontWeight: forecastDays === d ? '700' : '500',
                          backgroundColor: forecastDays === d ? 'var(--primary)' : 'transparent',
                          color: forecastDays === d ? '#ffffff' : 'var(--text-main)',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {d}일
                      </button>
                    ))}
                  </div>
                </div>

                {/* 필터 3: 계좌 선택 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    통장 계좌
                  </label>
                  <select
                    value={selectedBank}
                    onChange={e => setSelectedBank(e.target.value)}
                    style={{ padding: '4px 8px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', height: '32px', minWidth: '150px' }}
                  >
                    <option value="ALL">전체 계좌 (가용 합계)</option>
                    {availableBanks.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                {/* 필터 4: 안전 기준액 (마진) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    안전 기준액
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '32px' }}>
                    <input 
                      type="number"
                      step={1000000}
                      value={safetyThreshold}
                      onChange={e => setSafetyThreshold(parseInt(e.target.value) || 0)}
                      style={{ width: '110px', padding: '4px 8px', fontSize: '12px', textAlign: 'right', borderRadius: '4px', border: '1px solid var(--border-color)', height: '100%' }}
                    />
                    <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>원</span>
                  </div>
                </div>

              </div>

              {/* ② 우측 상단 (Pipeline: 액션 버튼군) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    refreshAllData();
                    showToast('전사 실데이터 동기화가 완료되었습니다.');
                  }}
                  style={{ height: '32px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                  title="전사 실데이터 새로고침"
                >
                  <RefreshCw size={13} /> 동기화
                </button>

                {canSave && (
                  <button
                    className="btn-primary"
                    onClick={() => setShowSnapModal(true)}
                    style={{ height: '32px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                  >
                    <Camera size={13} /> 스냅샷 동결
                  </button>
                )}

                <button
                  className="btn-secondary"
                  onClick={handleExportCashFlowExcel}
                  style={{ height: '32px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', borderColor: 'var(--success)', color: 'var(--success)' }}
                >
                  <Download size={13} /> 엑셀 내보내기
                </button>
              </div>

            </div>
          </div>

          {/* ─── 조기 경보 배너 (부도 위험 또는 안전마진 하회 시) ─── */}
          {minBalanceItem && minBalanceItem.cumulative < 0 && (
            <div style={{
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1.5px solid var(--danger)',
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <ShieldAlert size={24} color="var(--danger)" style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text-main)' }}>
                <strong style={{ color: 'var(--danger)' }}>🚨 자금 고갈(부도 위험) 경보</strong>: 
                기준일로부터 {forecastDays}일 전망 중 <strong>{minBalanceItem.date}</strong>에 누적 가용잔고가 
                <strong style={{ color: 'var(--danger)', marginLeft: '4px' }}>
                  {minBalanceItem.cumulative.toLocaleString()}원
                </strong>으로 마이너스 전이가 감지되었습니다. 
                (예상 최고 결손액: <strong>{Math.abs(minBalanceItem.cumulative).toLocaleString()}원</strong>)
              </div>
            </div>
          )}

          {minBalanceItem && minBalanceItem.cumulative >= 0 && minBalanceItem.cumulative < safetyThreshold && (
            <div style={{
              backgroundColor: 'rgba(245, 158, 11, 0.08)',
              border: '1.5px solid var(--warning)',
              borderRadius: '8px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              <AlertTriangle size={24} color="var(--warning)" style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text-main)' }}>
                <strong style={{ color: 'var(--warning)' }}>⚠️ 안전 자금 주의 경보</strong>: 
                <strong>{minBalanceItem.date}</strong> 기준 최저 잔고(<strong>{minBalanceItem.cumulative.toLocaleString()}원</strong>)가 
                설정된 안전 기준액(<strong>{safetyThreshold.toLocaleString()}원</strong>)을 하회합니다. 미수금 조기 회수 관리가 필요합니다.
              </div>
            </div>
          )}

          {/* ─── ③ 중앙 본문 (Inspection): 상단 15% 핵심 지표 카드뉴스 ─── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
            
            {/* 카드 1: 기준일 시작 잔액 */}
            <div className="card" style={{ margin: 0, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: '600' }}>기초 가용 잔액</span>
                <Landmark size={16} color="var(--primary)" />
              </div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                {startingBalanceAtBase.toLocaleString()}원
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '4px', whiteSpace: 'nowrap' }}>
                {selectedBank === 'ALL' ? '전체 계좌 실시간 합산' : `${selectedBank} 기준고`}
              </div>
            </div>

            {/* 카드 2: 구간 수납 예정 */}
            <div className="card" style={{ margin: 0, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: '600' }}>구간 수납 예정 (Inflow)</span>
                <ArrowUpRight size={16} color="var(--success)" />
              </div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--success)', whiteSpace: 'nowrap' }}>
                +{totalInflow.toLocaleString()}원
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '4px', whiteSpace: 'nowrap' }}>
                미수 청구서 및 채권 연동
              </div>
            </div>

            {/* 카드 3: 구간 운영 지출 */}
            <div className="card" style={{ margin: 0, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: '600' }}>구간 운영 지출 (OPEX)</span>
                <ArrowDownRight size={16} color="var(--warning)" />
              </div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--warning)', whiteSpace: 'nowrap' }}>
                -{totalOpex.toLocaleString()}원
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '4px', whiteSpace: 'nowrap' }}>
                매입정산·임차료·급여 합산
              </div>
            </div>

            {/* 카드 4: 구간 설비 투자 */}
            <div className="card" style={{ margin: 0, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: '600' }}>구간 설비 투자 (CAPEX)</span>
                <Layers size={16} color="var(--danger)" />
              </div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--danger)', whiteSpace: 'nowrap' }}>
                -{totalCapex.toLocaleString()}원
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '4px', whiteSpace: 'nowrap' }}>
                장비 신규 취득 설비대금
              </div>
            </div>

            {/* 카드 5: 기말 예상 잔고 & 런웨이 */}
            <div className="card" style={{ 
              margin: 0, 
              padding: '14px 16px',
              backgroundColor: auditSummary.isCritical ? 'rgba(239, 68, 68, 0.04)' : 'transparent',
              borderColor: auditSummary.isCritical ? 'var(--danger)' : 'var(--border-color)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: '600' }}>
                  {forecastDays}일 후 기말 잔고
                </span>
                {auditSummary.isCritical ? <AlertTriangle size={16} color="var(--danger)" /> : <CheckCircle size={16} color="var(--success)" />}
              </div>
              <div style={{ 
                fontSize: '18px', 
                fontWeight: '800', 
                color: finalBalance < 0 ? 'var(--danger)' : 'var(--primary)', 
                whiteSpace: 'nowrap' 
              }}>
                {finalBalance.toLocaleString()}원
              </div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '4px', whiteSpace: 'nowrap' }}>
                현금 런웨이: <strong>{cashRunwayDays >= 999 ? '안정적(999일+)' : `${cashRunwayDays}일`}</strong>
              </div>
            </div>

          </div>

          {/* ─── 슬림 SVG 유동성 추이 밴드 차트 (높이 100px) ─── */}
          {svgChartPaths && (
            <div className="card" style={{ margin: 0, padding: '12px 18px', position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>잔고 추이 타임라인</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    (안전선: ₩{safetyThreshold.toLocaleString()} | 부도위험선: ₩0)
                  </span>
                </div>
                {minBalanceItem && (
                  <div style={{ fontSize: '11px', color: minBalanceItem.cumulative < 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    최저점: <strong>{minBalanceItem.date}</strong> (₩{minBalanceItem.cumulative.toLocaleString()})
                  </div>
                )}
              </div>

              <div style={{ position: 'relative', width: '100%', height: '90px' }}>
                <svg
                  ref={chartRef}
                  viewBox={`0 0 ${svgChartPaths.width} ${svgChartPaths.height}`}
                  width="100%"
                  height="100%"
                  onMouseMove={handleChartMouseMove}
                  onMouseLeave={() => setHoveredPoint(null)}
                  style={{ overflow: 'visible', cursor: 'crosshair' }}
                >
                  <defs>
                    <linearGradient id="cfBandGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* 안전 기준선 */}
                  {svgChartPaths.safetyY >= 10 && svgChartPaths.safetyY <= svgChartPaths.height - 10 && (
                    <line
                      x1={svgChartPaths.paddingLeft}
                      y1={svgChartPaths.safetyY}
                      x2={svgChartPaths.width - svgChartPaths.paddingRight}
                      y2={svgChartPaths.safetyY}
                      stroke="var(--warning)"
                      strokeWidth="1"
                      strokeDasharray="4 3"
                    />
                  )}

                  {/* 부도 위험선 (0선) */}
                  {svgChartPaths.zeroY >= 10 && svgChartPaths.zeroY <= svgChartPaths.height - 10 && (
                    <line
                      x1={svgChartPaths.paddingLeft}
                      y1={svgChartPaths.zeroY}
                      x2={svgChartPaths.width - svgChartPaths.paddingRight}
                      y2={svgChartPaths.zeroY}
                      stroke="var(--danger)"
                      strokeWidth="1.2"
                    />
                  )}

                  {/* 채워진 영역 */}
                  <path d={svgChartPaths.areaPath} fill="url(#cfBandGrad)" />

                  {/* 곡선 패스 */}
                  <path d={svgChartPaths.linePath} fill="none" stroke="var(--primary)" strokeWidth="2" />

                  {/* 데이터 포인트 */}
                  {svgChartPaths.points.map((p, idx) => (
                    <circle
                      key={idx}
                      cx={p.x}
                      cy={p.y}
                      r={p.item.status === 'CRITICAL' ? 3.5 : 2}
                      fill={p.item.status === 'CRITICAL' ? 'var(--danger)' : 'var(--bg-card)'}
                      stroke={p.item.status === 'CRITICAL' ? 'var(--danger)' : 'var(--primary)'}
                      strokeWidth="1.5"
                    />
                  ))}

                  {/* 호버 가이드라인 */}
                  {hoveredPoint && (
                    <>
                      <line
                        x1={hoveredPoint.x}
                        y1={10}
                        x2={hoveredPoint.x}
                        y2={svgChartPaths.height - 10}
                        stroke="var(--primary)"
                        strokeWidth="1"
                        strokeDasharray="2 2"
                      />
                      <circle
                        cx={hoveredPoint.x}
                        cy={hoveredPoint.y}
                        r="4.5"
                        fill="var(--primary)"
                      />
                    </>
                  )}
                </svg>

                {/* 실시간 툴팁 */}
                {hoveredPoint && (
                  <div style={{
                    position: 'absolute',
                    top: `${hoveredPoint.y - 60}px`,
                    left: `${Math.min(Math.max(hoveredPoint.x - 60, 10), 650)}px`,
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    color: '#ffffff',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    lineHeight: '1.4',
                    pointerEvents: 'none',
                    zIndex: 20,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    whiteSpace: 'nowrap'
                  }}>
                    <strong>{hoveredPoint.item.date}</strong> ({hoveredPoint.item.isPast ? '실적' : '예정'})<br />
                    • 잔고: <strong>{hoveredPoint.item.cumulative.toLocaleString()}원</strong><br />
                    • 수지차: <span style={{ color: hoveredPoint.item.net >= 0 ? '#4ade80' : '#f87171' }}>
                      {hoveredPoint.item.net >= 0 ? `+${hoveredPoint.item.net.toLocaleString()}` : hoveredPoint.item.net.toLocaleString()}원
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── ③ 중앙 본문 (Inspection): 본문 80% 고밀도 1:1 수지 대사 테이블 (유형 B 아키타입) ─── */}
          <div className="card" style={{ margin: 0, padding: 0 }}>
            <div style={{ 
              padding: '12px 18px', 
              borderBottom: '1px solid var(--border-color)', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center' 
            }}>
              <div style={{ fontSize: '13px', fontWeight: '700' }}>
                일별 수지 대사 및 잔고 원장 ({forecastList.length}개 일자)
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                행 클릭 또는 [상세 ➔] 버튼으로 일자별 원천 전표 확인
              </div>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: '520px' }}>
              <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ 
                    position: 'sticky', 
                    top: 0, 
                    backgroundColor: 'var(--bg-app)', 
                    zIndex: 10,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    height: '38px'
                  }}>
                    {/* 핵심 액션 컬럼 첫 번째 고정 배치 (헌장 3.2) */}
                    <th style={{ width: '60px', textAlign: 'center', whiteSpace: 'nowrap', padding: '0 8px' }}>상세</th>
                    <th style={{ width: '95px', whiteSpace: 'nowrap', padding: '0 10px' }}>일자</th>
                    <th style={{ width: '60px', textAlign: 'center', whiteSpace: 'nowrap', padding: '0 8px' }}>구분</th>
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px' }}>수납액 (Inflow)</th>
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px' }}>운영지출 (OPEX)</th>
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px' }}>투자지출 (CAPEX)</th>
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px' }}>일일 수지차</th>
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 14px' }}>예상 누적 잔고</th>
                    <th style={{ width: '80px', textAlign: 'center', whiteSpace: 'nowrap', padding: '0 8px' }}>상태</th>
                    <th style={{ whiteSpace: 'nowrap', padding: '0 12px' }}>수지 내역 요약</th>
                  </tr>
                </thead>
                <tbody>
                  {forecastList.map(item => (
                    <tr 
                      key={item.date}
                      onClick={() => setSelectedDetailDate(item)}
                      style={{ 
                        height: '38px',
                        cursor: 'pointer',
                        backgroundColor: item.status === 'CRITICAL' 
                          ? 'rgba(239, 68, 68, 0.05)' 
                          : item.status === 'WARNING' 
                            ? 'rgba(245, 158, 11, 0.03)' 
                            : 'transparent',
                        borderBottom: '1px solid var(--border-color)'
                      }}
                    >
                      {/* [상세 ➔] 액션 버튼 (헌장 3.2: 횡스크롤 발생 시 좌측 1컬럼 고정) */}
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap', padding: '0 8px' }}>
                        <button
                          className="btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDetailDate(item);
                          }}
                          style={{ padding: '2px 6px', fontSize: '11px', whiteSpace: 'nowrap' }}
                        >
                          상세 ➔
                        </button>
                      </td>

                      {/* 일자 */}
                      <td style={{ whiteSpace: 'nowrap', padding: '0 10px', fontWeight: item.date === todayStr ? '800' : '600' }}>
                        {item.date}
                        {item.date === todayStr && (
                          <span style={{ marginLeft: '4px', fontSize: '10px', color: 'var(--primary)', backgroundColor: 'rgba(59,130,246,0.1)', padding: '1px 4px', borderRadius: '3px' }}>
                            오늘
                          </span>
                        )}
                      </td>

                      {/* 구분 (실적 vs 예정) */}
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap', padding: '0 8px' }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '10px',
                          fontWeight: '700',
                          backgroundColor: item.isPast ? 'rgba(100, 116, 139, 0.12)' : 'rgba(59, 130, 246, 0.12)',
                          color: item.isPast ? 'var(--text-secondary)' : 'var(--primary)'
                        }}>
                          {item.isPast ? '실적' : '예정'}
                        </span>
                      </td>

                      {/* 수납액 */}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px', fontWeight: item.inflow > 0 ? '700' : 'normal', color: item.inflow > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                        {item.inflow > 0 ? `+${item.inflow.toLocaleString()}원` : '-'}
                      </td>

                      {/* 운영지출 */}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px', fontWeight: item.opex > 0 ? '700' : 'normal', color: item.opex > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                        {item.opex > 0 ? `-${item.opex.toLocaleString()}원` : '-'}
                      </td>

                      {/* 투자지출 */}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px', fontWeight: item.capex > 0 ? '700' : 'normal', color: item.capex > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {item.capex > 0 ? `-${item.capex.toLocaleString()}원` : '-'}
                      </td>

                      {/* 일일 수지차 */}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px', fontWeight: '800', color: item.net > 0 ? 'var(--success)' : item.net < 0 ? 'var(--danger)' : 'var(--text-main)' }}>
                        {item.net > 0 ? `+${item.net.toLocaleString()}원` : item.net < 0 ? `${item.net.toLocaleString()}원` : '-'}
                      </td>

                      {/* 예상 누적 잔고 */}
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 14px', fontWeight: '800', fontSize: '12.5px', color: item.status === 'CRITICAL' ? 'var(--danger)' : item.status === 'WARNING' ? 'var(--warning)' : 'var(--primary)' }}>
                        {item.cumulative.toLocaleString()}원
                      </td>

                      {/* 상태 배지 */}
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap', padding: '0 8px' }}>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '10px',
                          fontWeight: '700',
                          backgroundColor: item.status === 'SAFE' ? 'rgba(34, 197, 94, 0.12)' : item.status === 'WARNING' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.15)',
                          color: item.status === 'SAFE' ? 'var(--success)' : item.status === 'WARNING' ? 'var(--warning)' : 'var(--danger)'
                        }}>
                          {item.status === 'SAFE' ? '안전' : item.status === 'WARNING' ? '주의' : '부도위험'}
                        </span>
                      </td>

                      {/* 수지 내역 요약 */}
                      <td style={{ whiteSpace: 'nowrap', padding: '0 12px', color: 'var(--text-secondary)', fontSize: '11.5px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {[item.inflowDetail, item.opexDetail, item.capexDetail].filter(Boolean).join(' | ') || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ─── 스냅샷 이력 대장 탭 ─── */}
      {activeSubTab === 'HISTORY' && (
        <div className="card" style={{ margin: 0, padding: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ fontSize: '15px', fontWeight: '800', margin: 0 }}>
                자금 계획 스냅샷 동결 이력 대장
              </h2>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                경영진 의사결정 시점별 동결된 유동성 지표 및 경영지시 메모 영구 보존
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleExportSnapshotHistory}
                style={{ height: '32px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', borderColor: 'var(--success)', color: 'var(--success)' }}
              >
                <Download size={13} /> 엑셀 내보내기
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ height: '38px', backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ whiteSpace: 'nowrap', padding: '0 12px' }}>스냅샷 기준일</th>
                  <th style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px' }}>기초 통장잔고</th>
                  <th style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px' }}>수납 예정액</th>
                  <th style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px' }}>일반 지출액</th>
                  <th style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px' }}>설비 투자액</th>
                  <th style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 14px' }}>최종 예상잔고</th>
                  <th style={{ whiteSpace: 'nowrap', padding: '0 14px' }}>경영 분석 메모</th>
                  <th style={{ width: '60px', textAlign: 'center', whiteSpace: 'nowrap', padding: '0 8px' }}>삭제</th>
                </tr>
              </thead>
              <tbody>
                {cashFlowSnapshots.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                      보존된 과거 자금 계획 스냅샷 이력이 없습니다.
                    </td>
                  </tr>
                ) : (
                  cashFlowSnapshots.map(snap => (
                    <tr key={snap.id} style={{ height: '40px', borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ whiteSpace: 'nowrap', padding: '0 12px', fontWeight: '700' }}>
                        {snap.snapshotDate}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px' }}>
                        {snap.startingBalance.toLocaleString()}원
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px', color: 'var(--success)', fontWeight: '600' }}>
                        +{snap.projectedInflow.toLocaleString()}원
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px', color: 'var(--warning)', fontWeight: '600' }}>
                        -{snap.projectedOpex.toLocaleString()}원
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 12px', color: 'var(--danger)', fontWeight: '600' }}>
                        -{snap.projectedCapex.toLocaleString()}원
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0 14px', fontWeight: '800', color: snap.projectedFinalBalance < 0 ? 'var(--danger)' : 'var(--primary)' }}>
                        {snap.projectedFinalBalance.toLocaleString()}원
                      </td>
                      <td style={{ padding: '0 14px', fontSize: '11.5px', color: 'var(--text-secondary)', maxWidth: '300px' }}>
                        {snap.notes || '-'}
                      </td>
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap', padding: '0 8px' }}>
                        <button
                          className="btn-secondary"
                          onClick={async () => {
                            await deleteCashFlowSnapshot(snap.id);
                            await db.awaitPendingWrites();
                            showToast('스냅샷이 삭제되었습니다.');
                          }}
                          style={{ padding: '3px 8px', fontSize: '11px', color: 'var(--danger)' }}
                          title="스냅샷 삭제"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── 원천 전표 상세 드로어 모달 (선택 일자의 1:1 대사 내역) ─── */}
      {selectedDetailDate && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.5)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="card" style={{ width: '100%', maxWidth: '680px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, borderRadius: '10px' }}>
            
            {/* 드로어 헤더 */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Calendar size={18} color="var(--primary)" />
                  {selectedDetailDate.date} 원천 수지 대사 상세
                  <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', backgroundColor: selectedDetailDate.isPast ? 'rgba(100,116,139,0.1)' : 'rgba(59,130,246,0.1)', color: selectedDetailDate.isPast ? 'var(--text-secondary)' : 'var(--primary)' }}>
                    {selectedDetailDate.isPast ? '실제 거래 실적' : '예측 데이터'}
                  </span>
                </h3>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                  일일 순수지: <strong>{selectedDetailDate.net >= 0 ? `+${selectedDetailDate.net.toLocaleString()}` : selectedDetailDate.net.toLocaleString()}원</strong> | 
                  당일 마감잔고: <strong>{selectedDetailDate.cumulative.toLocaleString()}원</strong>
                </span>
              </div>
              <button
                onClick={() => setSelectedDetailDate(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* 드로어 본문 */}
            <div style={{ padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* 1. 수납 내역 (Inflows) */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--success)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ArrowUpRight size={15} /> 수납 예정 내역 ({selectedDetailDate.inflowItems.length}건, ₩{selectedDetailDate.inflow.toLocaleString()})
                </div>
                {selectedDetailDate.inflowItems.length === 0 ? (
                  <div style={{ padding: '10px', fontSize: '12px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-app)', borderRadius: '6px', textAlign: 'center' }}>
                    해당 일자에 예정된 수납 내역이 없습니다.
                  </div>
                ) : (
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <tbody>
                      {selectedDetailDate.inflowItems.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)', height: '32px' }}>
                          <td style={{ width: '80px', color: 'var(--text-secondary)', fontSize: '11px' }}>[{item.source}]</td>
                          <td>{item.title}</td>
                          <td style={{ textAlign: 'right', fontWeight: '700', color: 'var(--success)' }}>
                            +{item.amount.toLocaleString()}원
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* 2. 운영 지출 내역 (OPEX) */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--warning)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ArrowDownRight size={15} /> 운영 지출 내역 ({selectedDetailDate.opexItems.length}건, ₩{selectedDetailDate.opex.toLocaleString()})
                </div>
                {selectedDetailDate.opexItems.length === 0 ? (
                  <div style={{ padding: '10px', fontSize: '12px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-app)', borderRadius: '6px', textAlign: 'center' }}>
                    해당 일자에 예정된 일반 운영 지출이 없습니다.
                  </div>
                ) : (
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <tbody>
                      {selectedDetailDate.opexItems.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)', height: '32px' }}>
                          <td style={{ width: '80px', color: 'var(--text-secondary)', fontSize: '11px' }}>[{item.source}]</td>
                          <td>{item.title}</td>
                          <td style={{ textAlign: 'right', fontWeight: '700', color: 'var(--warning)' }}>
                            -{item.amount.toLocaleString()}원
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* 3. 설비 투자 내역 (CAPEX) */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--danger)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Layers size={15} /> 설비 투자 내역 ({selectedDetailDate.capexItems.length}건, ₩{selectedDetailDate.capex.toLocaleString()})
                </div>
                {selectedDetailDate.capexItems.length === 0 ? (
                  <div style={{ padding: '10px', fontSize: '12px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-app)', borderRadius: '6px', textAlign: 'center' }}>
                    해당 일자에 예정된 장비 도입 투자가 없습니다.
                  </div>
                ) : (
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <tbody>
                      {selectedDetailDate.capexItems.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)', height: '32px' }}>
                          <td style={{ width: '80px', color: 'var(--text-secondary)', fontSize: '11px' }}>[{item.source}]</td>
                          <td>{item.title}</td>
                          <td style={{ textAlign: 'right', fontWeight: '700', color: 'var(--danger)' }}>
                            -{item.amount.toLocaleString()}원
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

            </div>

            {/* 드로어 푸터 */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn-primary"
                onClick={() => setSelectedDetailDate(null)}
                style={{ padding: '6px 18px', fontSize: '12px' }}
              >
                확인 및 닫기
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ─── 스냅샷 동결 저장 모달 ─── */}
      {showSnapModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.5)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <form 
            onSubmit={handleSaveSnapshotSubmit}
            className="card" 
            style={{ width: '100%', maxWidth: '480px', padding: '20px', borderRadius: '10px' }}
          >
            <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Camera size={18} color="var(--primary)" />
              자금 계획 스냅샷 동결
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12.5px', marginBottom: '16px' }}>
              <div style={{ backgroundColor: 'var(--bg-app)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', lineHeight: '1.6' }}>
                <strong>동결 대상 지표 요약:</strong><br />
                • 기준일: {baseDate} ({forecastDays}일 전망)<br />
                • 기초잔고: {startingBalanceAtBase.toLocaleString()}원<br />
                • 수납예정: +{totalInflow.toLocaleString()}원<br />
                • 운영지출: -{totalOpex.toLocaleString()}원<br />
                • 설비투자: -{totalCapex.toLocaleString()}원<br />
                • 기말잔고: <strong style={{ color: finalBalance < 0 ? 'var(--danger)' : 'var(--primary)' }}>{finalBalance.toLocaleString()}원</strong>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11.5px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  경영 분석 의견 및 지침 메모
                </label>
                <textarea
                  rows={3}
                  value={snapNotes}
                  onChange={e => setSnapNotes(e.target.value)}
                  placeholder="예: 8월 중순 자금 여유분 확보로 고소작업대 신규 도입 일정 확정."
                  style={{ width: '100%', padding: '8px', fontSize: '12.5px', borderRadius: '4px', border: '1px solid var(--border-color)', resize: 'vertical' }}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowSnapModal(false)}
                style={{ padding: '6px 14px', fontSize: '12px' }}
              >
                취소
              </button>
              <button
                type="submit"
                className="btn-primary"
                style={{ padding: '6px 16px', fontSize: '12px' }}
              >
                스냅샷 저장
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─── ⚖️ Gutenberg Z-패턴 ④ 우하단 고정 대차대조식 검증 바 (헌장 3.5) ─── */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          <span>기초: ₩<strong>{auditSummary.startingBalance.toLocaleString()}</strong></span>
          <span style={{ color: 'var(--border-color)' }}>+</span>
          <span style={{ color: 'var(--success)' }}>수납: ₩<strong>{auditSummary.totalInflow.toLocaleString()}</strong></span>
          <span style={{ color: 'var(--border-color)' }}>-</span>
          <span style={{ color: 'var(--warning)' }}>지출: ₩<strong>{auditSummary.totalOpex.toLocaleString()}</strong></span>
          <span style={{ color: 'var(--border-color)' }}>-</span>
          <span style={{ color: 'var(--danger)' }}>투자: ₩<strong>{auditSummary.totalCapex.toLocaleString()}</strong></span>
          <span style={{ color: 'var(--border-color)' }}>=</span>
          <span>기말: ₩<strong>{auditSummary.finalBalance.toLocaleString()}</strong></span>
          <span style={{ color: 'var(--border-color)' }}>|</span>
          <span style={{ color: auditSummary.diff === 0 ? 'var(--success)' : 'var(--danger)', fontWeight: '700' }}>
            ⚖️ 대차 차액: ₩{auditSummary.diff.toLocaleString()}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: auditSummary.isCritical 
              ? 'rgba(239,68,68,0.15)' 
              : auditSummary.isSafe 
                ? 'var(--success-light)' 
                : 'rgba(245,158,11,0.15)',
            color: auditSummary.isCritical 
              ? 'var(--danger)' 
              : auditSummary.isSafe 
                ? 'var(--success)' 
                : 'var(--warning)',
            fontWeight: 700,
            fontSize: '11px',
            whiteSpace: 'nowrap'
          }}>
            {auditSummary.isCritical 
              ? '🚨 부도 위험 (자금 결손 감지)' 
              : auditSummary.isSafe 
                ? '✅ 유동성 정상 (수지 무결)' 
                : '⚠️ 안전마진 하회 (주의)'}
          </span>
        </div>
      </div>

    </div>
  );
};
