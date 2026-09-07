// src/utils/nativeLauncher.ts
// 스마트폰(Android / iOS) 앱 딥링크, 클립보드 복사 및 전화걸기 안전 실행 유틸리티

export type NavAppType = 'TMAP' | 'KAKAO' | 'NAVER' | 'WEB';

// 🌟 연속 클릭으로 인한 OS 액티비티 충돌 및 데드락 방지 락 (2초)
let lastNavLaunchTime = 0;

/**
 * 모바일 클립보드 안전 복사 헬퍼 (iOS / Android / PWA 전 플랫폼 호환)
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('navigator.clipboard.writeText failed:', err);
  }

  // 폴백: textarea execCommand
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '-9999px';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback execCommand copy failed:', err);
    return false;
  }
}

/**
 * 화면 상단/하단 비간섭 안내 토스트 표출
 */
function showFloatingToast(message: string) {
  const existing = document.getElementById('nav-floating-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'nav-floating-toast';
  toast.style.position = 'fixed';
  toast.style.bottom = '90px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.backgroundColor = 'rgba(15, 23, 42, 0.95)';
  toast.style.color = '#38bdf8';
  toast.style.border = '1px solid rgba(56, 189, 248, 0.4)';
  toast.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.5)';
  toast.style.padding = '10px 16px';
  toast.style.borderRadius = '12px';
  toast.style.fontSize = '12px';
  toast.style.fontWeight = 'bold';
  toast.style.zIndex = '99999';
  toast.style.textAlign = 'center';
  toast.style.whiteSpace = 'pre-line';
  toast.style.pointerEvents = 'none';
  toast.innerText = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3500);
}

/**
 * 안전한 길안내 내비게이션 앱 실행기
 * 
 * 📌 [T맵 연동 실패 원인 및 구조적 해결]:
 * 1. 일상에서 공유하는 티맵 링크(surl.tmap.co.kr)는 티맵 서버에 이미 저장된 목적지의 위도/경도(GPS 좌표)를 품고 있습니다.
 *    반면 당사 ERP DB에는 사용자가 입력한 문자열 텍스트 주소('창업로 42')만 존재합니다.
 * 2. 티맵의 길안내 스킴(tmap://route)은 위경도 숫자 좌표(goalx, goaly)가 없으면 경로 계산을 시작하지 못하고 메인 홈 화면만 엽니다.
 *    좌표가 없는 텍스트 주소는 티맵의 '검색 스킴(tmap://search?name=...)'으로 호출해야 검색창에 주소가 전달됩니다.
 * 3. 현장 상세 주소에 동/호수나 특수문자가 섞여 티맵 POI 검색이 빗나가는 경우를 100% 방지하기 위해,
 *    내비 버튼 클릭 즉시 목적지 주소를 스마트폰 클립보드에 자동 복사하여 필요 시 1-Click 붙여넣기를 보장합니다.
 */
export async function launchNavigation(destination: string, app: NavAppType = 'TMAP') {
  if (!destination || !destination.trim()) {
    alert('길안내 목적지 정보가 없습니다.');
    return;
  }

  // 1. 연속 클릭 방지 락 (2초 이내 중복 호출 차단)
  const now = Date.now();
  if (now - lastNavLaunchTime < 2000) {
    console.warn('내비게이션 호출 쿨다운 중입니다 (중복 호출 차단)');
    return;
  }
  lastNavLaunchTime = now;

  const cleanDest = destination.trim();

  // 2. 📋 스마트폰 클립보드에 고객/현장 주소 100% 선제적 자동 복사 (붙여넣기 대비)
  await copyToClipboard(cleanDest);
  showFloatingToast(`📋 현장 주소가 클립보드에 복사되었습니다!\n(T맵 검색창에 길게 눌러 바로 붙여넣기 가능)`);

  // 3. 검색 쿼리 정제 (부연 설명, 괄호, 층수 등 제거하여 T맵/내비 검색 성공률 극대화)
  const cleanSearchQuery = cleanDest
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/지하\s*\d+층|지상\s*\d+층|\d+층|하역장|게이트.*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || cleanDest;

  const encodedDest = encodeURIComponent(cleanSearchQuery);
  const ua = navigator.userAgent.toLowerCase();
  const isAndroid = /android/.test(ua);
  const isIos = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let targetUrl = '';

  if (app === 'TMAP') {
    // 💡 TMAP은 좌표 없는 문자열 주소 전달 시 'search' 스킴을 사용해야 검색창에 주소가 자동 입력됨
    targetUrl = `tmap://search?name=${encodedDest}`;
  } else if (app === 'KAKAO') {
    // 카카오내비 정식 길안내 모드 (텍스트 주소로도 내부 POI 길안내 자동 매핑)
    targetUrl = `kakaonavi://navigate?name=${encodedDest}&coord_type=wgs84`;
  } else if (app === 'NAVER') {
    // 네이버지도 내비게이션 정식 길안내 모드
    targetUrl = `nmap://navigation?dname=${encodedDest}&appname=com.ebro.lift`;
  } else {
    // WEB 모드: 웹 길찾기
    targetUrl = `https://map.kakao.com/link/to/${encodedDest}`;
  }

  // 데스크톱 브라우저이거나 웹 링크인 경우 새 탭 열기
  if (!isAndroid && !isIos && targetUrl.startsWith('http')) {
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  // 모바일 환경: 브라우저 윈도우 스택 및 DOM을 오염시키지 않는 안전한 다이렉트 디스패치
  try {
    window.location.href = targetUrl;
  } catch {
    const a = document.createElement('a');
    a.href = targetUrl;
    a.target = '_self';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

/**
 * 안전한 전화걸기 헬퍼
 * - window.location.href 직접 대입으로 인한 PWA 흰 화면(ERR_UNKNOWN_URL_SCHEME) 및 세션 리셋 방지
 * - DOM <a> 태그 클릭 방식을 사용하여 스마트폰 기본 전화 다이얼러를 안전하게 호출
 */
export function safePhoneCall(phone: string | undefined | null) {
  if (!phone) {
    alert('전화번호 정보가 없습니다.');
    return;
  }

  const cleanNumber = phone.replace(/[^0-9+*#]/g, '');
  if (!cleanNumber) {
    alert('유효하지 않은 전화번호입니다.');
    return;
  }

  const a = document.createElement('a');
  a.href = `tel:${cleanNumber}`;
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    } catch {
      // ignore
    }
  }, 300);
}

/**
 * 현장 티켓/의뢰 정보로부터 실제 내비게이션 목적지 상세 도로명 주소를 정밀 다단계 역추적
 * 1. siteId 기준 customerSites.address 매핑
 * 2. siteName 기준 customerSites 공백 무시 일치 검색
 * 3. contractId 기준 contracts.siteAddress / customerSites 매핑
 * 4. assetNo / assetId 기준 현재 가동 중인 계약의 현장 도로명 주소 매핑
 * 5. locationDetail 내 도로명 주소 패턴 정규식 매칭
 * 6. customerName 기준 고객사 소속 현장 주소 역추적
 * 7. 최후 폴백: siteName 또는 '현장'
 */
export function resolveSiteDetailedAddress(params: {
  siteAddress?: string;
  siteId?: string;
  siteName?: string;
  contractId?: string;
  assetNo?: string;
  assetId?: string;
  customerName?: string;
  locationDetail?: string;
  customerSites?: Array<{ id: string; customerId?: string; name: string; address?: string }>;
  contracts?: Array<{ id: string; siteId?: string; siteAddress?: string }>;
  contractAssets?: Array<{ contractId: string; assetId?: string; assetNo?: string; actualReturnDate?: string | null }>;
  customers?: Array<{ id: string; name: string; address?: string }>;
}): string {
  const {
    siteAddress,
    siteId,
    siteName,
    contractId,
    assetNo,
    assetId,
    customerName,
    locationDetail,
    customerSites = [],
    contracts = [],
    contractAssets = [],
    customers = []
  } = params;

  // 0. 티켓 자체에 명시된 siteAddress가 있는 경우 최우선 반환 (단일 진실의 원천 SSOT)
  if (siteAddress && siteAddress.trim()) {
    return siteAddress.trim();
  }

  // 1. siteId 기준 매핑
  if (siteId) {
    const site = customerSites.find(s => s.id === siteId);
    if (site?.address && site.address.trim()) {
      return site.address.trim();
    }
  }

  // 2. siteName 기준 customerSites 공백 무시/포함 검색
  if (siteName && siteName.trim()) {
    const sClean = siteName.replace(/\s+/g, '');
    const site = customerSites.find(s => {
      if (!s.name || !s.address?.trim()) return false;
      const msClean = s.name.replace(/\s+/g, '');
      return msClean === sClean || msClean.includes(sClean) || sClean.includes(msClean);
    });
    if (site?.address && site.address.trim()) {
      return site.address.trim();
    }
  }

  // 3. contractId 기준 매핑
  if (contractId) {
    const contract = contracts.find(c => c.id === contractId);
    if (contract?.siteAddress && contract.siteAddress.trim()) {
      return contract.siteAddress.trim();
    }
    if (contract?.siteId) {
      const site = customerSites.find(s => s.id === contract.siteId);
      if (site?.address && site.address.trim()) {
        return site.address.trim();
      }
    }
  }

  // 4. assetNo / assetId 기준 현재 대여 중인 계약 현장 역추적
  if (assetNo || assetId) {
    const targetNo = assetNo?.trim();
    const ca = contractAssets.find(c => 
      !c.actualReturnDate && 
      ((assetId && c.assetId === assetId) || (targetNo && c.assetNo === targetNo))
    );
    if (ca) {
      const contract = contracts.find(c => c.id === ca.contractId);
      if (contract?.siteAddress && contract.siteAddress.trim()) {
        return contract.siteAddress.trim();
      }
      if (contract?.siteId) {
        const site = customerSites.find(s => s.id === contract.siteId);
        if (site?.address && site.address.trim()) {
          return site.address.trim();
        }
      }
    }
  }

  // 5. locationDetail 내에 도로명/지번 주소 패턴이 있는 경우
  if (locationDetail && /(?:시|군|구)\s+[가-힣0-9]+(?:로|길|읍|면|동)/.test(locationDetail)) {
    return locationDetail.trim();
  }

  // 6. customerName 기준 고객사 소속 현장 주소 역추적
  if (customerName && customerName.trim()) {
    const cClean = customerName.replace(/\s+/g, '');
    const cust = customers.find(c => {
      const mcClean = c.name.replace(/\s+/g, '');
      return mcClean === cClean || mcClean.includes(cClean) || cClean.includes(mcClean);
    });
    if (cust) {
      const cSites = customerSites.filter(s => s.customerId === cust.id && s.address?.trim());
      if (cSites.length === 1) {
        return cSites[0].address!.trim();
      } else if (cSites.length > 1 && siteName) {
        const matched = cSites.find(s => s.name.includes(siteName) || siteName.includes(s.name));
        if (matched?.address?.trim()) return matched.address.trim();
      }
      // 고객사에 등록된 기본 도로명 주소가 있는 경우 상속
      if (cust.address && cust.address.trim()) {
        return cust.address.trim();
      }
    }
  }

  // 7. 최후 폴백: 현장명 또는 상세위치
  return siteName || locationDetail || customerName || '현장';
}

/**
 * 🚚 화물 기사 배차 안내 문자 포맷팅 파라미터
 */
export interface DispatchSmsParams {
  delivery: {
    id?: string;
    type?: string;
    dispatchCategory?: string;
    loadingDate?: string;
    loadingTimeSlot?: string;
    unloadingDate?: string;
    unloadingTimeSlot?: string;
    scheduledDate?: string;
    requestDate?: string;
    originAddress?: string;
    destinationAddress?: string;
    vehicleNo?: string;
    vehicleType?: string;
    driverName?: string;
    driverContact?: string;
    deliveryCost?: number;
    finalCost?: number;
    cargoItems?: string;
    memo?: string;
    closingMemo?: string;
  };
  siteName?: string;
  siteAddress?: string;
  siteContactName?: string;
  siteContactPhone?: string;
  customerName?: string;
  companyName?: string;
  hqYardAddress?: string;
  hqYardPhone?: string;
}

/**
 * 🚚 기사 배차 안내 문자 전문 조립기 (한글 표준 템플릿)
 */
export function buildDispatchSmsText(params: DispatchSmsParams): string {
  const { delivery } = params;
  const hqAddress = params.hqYardAddress || '경기도 용인시 처인구 모현읍 백옥대로 2420 (본사주기장)';
  const hqPhone = params.hqYardPhone || '배차/출고팀';

  const type = delivery.type || 'OUTBOUND';
  const typeLabel = 
    type === 'EXCHANGE' ? '🔄 [왕복 교환배차]' :
    type === 'RETURN' || type === 'INBOUND' ? '📦 [장비 회수배차]' :
    '🚚 [장비 출고배차]';

  const category = delivery.dispatchCategory || (type === 'EXCHANGE' ? '교환' : type === 'RETURN' ? '반납' : '출고');
  const dNo = delivery.id ? delivery.id.slice(0, 8).toUpperCase() : 'NEW';

  const driver = delivery.driverName || '기사님';
  const vehicle = [delivery.vehicleType, delivery.vehicleNo].filter(Boolean).join(' ') || '지정차량';
  const cost = delivery.finalCost || delivery.deliveryCost || 0;
  const costStr = cost > 0 ? `${cost.toLocaleString()}원 (부가세별도)` : '운송사 약정단가';

  const loadingDate = delivery.loadingDate || delivery.scheduledDate || delivery.requestDate || '일정 확인요망';
  const loadingTime = delivery.loadingTimeSlot || '오전';

  const siteName = params.siteName || params.customerName || '현장';
  const siteAddress = delivery.destinationAddress || params.siteAddress || '하차지 주소 확인요망';
  const contactName = params.siteContactName || '현장담당자';
  const contactPhone = params.siteContactPhone || '';

  let cargoSummary = '';
  if (delivery.cargoItems) {
    try {
      if (typeof delivery.cargoItems === 'string' && delivery.cargoItems.startsWith('[')) {
        const parsed = JSON.parse(delivery.cargoItems);
        if (Array.isArray(parsed)) {
          cargoSummary = parsed.map((p: any) => `${p.modelName || p.ft || '장비'} ${p.count || 1}대`).join(', ');
        }
      } else {
        cargoSummary = delivery.cargoItems;
      }
    } catch {
      cargoSummary = delivery.cargoItems;
    }
  }

  // 상차지와 하차지 분기
  let origin = delivery.originAddress || hqAddress;
  let destination = siteAddress;
  let originContact = hqPhone;
  let destContact = [contactName, contactPhone].filter(Boolean).join(' ');

  // 회수(INBOUND/RETURN)인 경우: 상차지가 현장, 하차지가 주기장
  if (type === 'RETURN' || type === 'INBOUND') {
    origin = siteAddress;
    originContact = [contactName, contactPhone].filter(Boolean).join(' ');
    destination = hqAddress;
    destContact = hqPhone;
  }

  const headerTitle = params.companyName ? `[${params.companyName} 배차안내]` : '[배차안내]';
  const lines = [
    headerTitle,
    `■ 배차유형: ${typeLabel} (${category})`,
    `■ 배차번호: DP-${dNo}`,
    `■ 배정기사: ${driver} (${vehicle})`,
    `■ 확정운송료: ${costStr}`,
    ``,
    `[1. 상차지 (출발지)]`,
    `- 일시: ${loadingDate} ${loadingTime}`,
    `- 위치: ${origin}`,
    `- 연락처: ${originContact}`,
    ``,
    `[2. 하차지 (도착지)]`,
    `- 일시: ${delivery.unloadingDate || loadingDate} ${delivery.unloadingTimeSlot || ''}`.trim(),
    `- 현장명: ${siteName}`,
    `- 위치: ${destination}`,
    `- 현장연락처: ${destContact || '도착 전 확인'}`,
  ];

  if (cargoSummary) {
    lines.push(``, `[3. 적재 장비]`, `- ${cargoSummary}`);
  }

  if (type === 'EXCHANGE') {
    lines.push(``, `※ [교환 배차 주의사항]`, `- 신규 장비 하차 후, 현장 회수 장비를 상차하여 모현 주기장으로 복귀하는 왕복 배차입니다.`);
  }

  if (delivery.memo && delivery.memo.trim()) {
    lines.push(``, `[특이사항]`, `- ${delivery.memo.trim()}`);
  }

  if (delivery.closingMemo && delivery.closingMemo.trim()) {
    lines.push(``, `[옵션 및 보양]`, `- ${delivery.closingMemo.trim()}`);
  }

  lines.push(``, `※ 현장 도착 30분 전 인수자에게 사전 연락 부탁드립니다.`);

  return lines.join('\n');
}

/**
 * 📲 스마트폰 기본 문자메시지 앱 딥링크 호출 (sms:?body=...)
 * - 선제 클립보드 복사(copyToClipboard)를 수행하여 앱 미연동 환경에서도 1-Click 붙여넣기 지원
 */
export async function launchDispatchSms(options: {
  driverContact: string;
  smsBody: string;
}): Promise<boolean> {
  const { driverContact, smsBody } = options;
  if (!driverContact || !driverContact.trim()) {
    alert('화물 기사 연락처가 없습니다.');
    return false;
  }

  // 1. 선제 클립보드 안전 복사
  await copyToClipboard(smsBody);

  // 2. 모바일 브라우저 sms: 딥링크 호출
  const cleanPhone = driverContact.replace(/[^0-9]/g, '');
  const isApple = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const separator = isApple ? '&' : '?';
  const smsUrl = `sms:${cleanPhone}${separator}body=${encodeURIComponent(smsBody)}`;

  try {
    window.location.href = smsUrl;
    showFloatingToast('기사 배차 안내문이 문자 앱에 입력되었습니다.\n(클립보드에도 복사 완료)');
    return true;
  } catch (err) {
    console.warn('launchDispatchSms failed:', err);
    alert('문자 앱을 호출하지 못했습니다. 배차 안내문이 클립보드에 복사되었으니 메시지 창에 붙여넣기 하세요.');
    return false;
  }
}

