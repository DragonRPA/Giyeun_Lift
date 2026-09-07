// src/services/templates.ts
import { drive } from './drive';
import { db } from './db';

// 테넌트 정보 동적 조회 헬퍼
function getLessorInfo() {
  const t = db.currentTenant;
  const corporateName = t?.corporateName || t?.displayName || '(주)임대인';
  const tradeName = t?.tradeName || t?.displayName || corporateName;
  const bizNo = t?.businessNumber || '138-81-83251';
  const ceo = t?.representativeName || '대표자';
  const email = t?.email || 'contact@ebro.com';
  const tel = t?.tel || '031-334-5296';
  const fax = t?.fax || '031-335-5297';
  const address = t?.businessAddress || (t as any)?.address || '본사';
  const stampImg = t?.stampImageUrl || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAAAXNSR0IArs4c6QAAAAlwSFlzAAALEwAACxMBAJqcGAAAAadJREFUaEPtmWFOwzAMhW/uA+4/90HACUgIEoc0ad26/lhq1STN19hOqN9SJfFjO/4e3pI3S5F3fFw8bFp97dZz8/G2abfB2wZ7D6/J+69bWJ6L52P7mHy+Xz8+Lx+fr6v6Xv5m9fP69Vrfy//2Wl/L217ra/s5t4/J91+vybE9bHl9TNu3vVbeXsszW/k59pq2r3up1+TYHk2Ove61/e01ObaHLa+PyWvbq63PseW5eE2OpvXl1XNl9dxyZe7/7M9V33t7eW/sPbfvjXXeW8u5+PzcXq7P5er293v7b8u5+O/rZ/bZ+97bf1vXz+yzz/f+3FauXN6eKz/n8q51/cw+++zzvT+3lSuXt+fKz7m8a10/s88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a/wdzK+i+0EagAAAAABJRU5ErkJggg==';
  const firstAcc = t?.bankAccounts?.[0];
  const bankAccount = firstAcc ? `${firstAcc.bankName} ${firstAcc.accountNumber} (예금주: ${firstAcc.accountHolder})` : '기업은행 138-81-83251 (예금주: (주)임대인)';
  return {
    corporateName,
    tradeName,
    bizNo,
    ceo,
    email,
    tel,
    fax,
    address,
    stampImg,
    bankAccount,
    displayName: t?.displayName || 'e-Bro'
  };
}

function applyLessorPlaceholders(html: string): string {
  const info = getLessorInfo();
  return html
    .replace(/\{\{lessorCorporateName\}\}/g, info.corporateName)
    .replace(/\{\{lessorTradeName\}\}/g, info.tradeName)
    .replace(/\{\{lessorBizNo\}\}/g, info.bizNo)
    .replace(/\{\{lessorCeo\}\}/g, info.ceo)
    .replace(/\{\{lessorEmail\}\}/g, info.email)
    .replace(/\{\{lessorTel\}\}/g, info.tel)
    .replace(/\{\{lessorFax\}\}/g, info.fax)
    .replace(/\{\{lessorAddress\}\}/g, info.address)
    .replace(/\{\{lessorStampImg\}\}/g, info.stampImg)
    .replace(/\{\{lessorBankAccount\}\}/g, info.bankAccount)
    .replace(/\{\{lessorDisplayName\}\}/g, info.displayName);
}

// 렌탈견적서 HTML 템플릿
const QUOTATION_TEMPLATE = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>렌탈 견적서</title>
    <style>
        body { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; margin: 40px; color: #333; line-height: 1.4; }
        .title { text-align: center; font-size: 28px; font-weight: 800; letter-spacing: 5px; margin-bottom: 30px; text-decoration: underline; }
        .header-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        .header-table td { border: none; padding: 0; vertical-align: top; }
        .info-box { border: 1px solid #000; padding: 12px; height: 130px; }
        .info-box.to { width: 45%; }
        .info-box.from { width: 50%; }
        .info-box h3 { margin: 0 0 10px 0; font-size: 16px; font-weight: bold; border-bottom: 1px dashed #ccc; padding-bottom: 5px; }
        .info-row { display: flex; margin-bottom: 6px; font-size: 13px; }
        .info-label { width: 70px; font-weight: bold; color: #555; }
        .info-value { flex: 1; }
        .price-summary { background-color: #f5f5f5; border: 1px solid #000; padding: 10px; font-size: 14px; font-weight: bold; margin-bottom: 15px; display: flex; justify-content: space-between; }
        .main-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
        .main-table th, .main-table td { border: 1px solid #000; padding: 8px; text-align: center; }
        .main-table th { background-color: #e5e7eb; font-weight: bold; }
        .main-table td.right { text-align: right; }
        .terms-box { border: 1px solid #000; padding: 12px; font-size: 12px; background-color: #fafafa; }
        .terms-box h4 { margin: 0 0 8px 0; font-size: 13px; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 4px; }
        .terms-box ul { margin: 0; padding-left: 20px; line-height: 1.6; }
        .terms-box li { margin-bottom: 4px; }
        .stamp-container { position: relative; display: inline-block; }
        .stamp { position: absolute; right: 10px; top: -15px; width: 45px; height: 45px; opacity: 0.85; }
    </style>
</head>
<body>
    <div class="title">렌탈 견적서</div>
    <table class="header-table">
        <tr>
            <td style="width: 48%;">
                <div class="info-box to">
                    <h3>TO</h3>
                    <div class="info-row"><div class="info-label">수신처</div><div class="info-value"><strong>{{customerName}}</strong></div></div>
                    <div class="info-row"><div class="info-label">담당자</div><div class="info-value">{{contactName}} {{contactPosition}}</div></div>
                    <div class="info-row"><div class="info-label">연락처</div><div class="info-value">{{contactPhone}}</div></div>
                    <div class="info-row"><div class="info-label">견적일</div><div class="info-value">{{quotationDate}}</div></div>
                    <div class="info-row"><div class="info-label">유효기간</div><div class="info-value">견적일로부터 1개월</div></div>
                </div>
            </td>
            <td style="width: 4%;"></td>
            <td style="width: 48%;">
                <div class="info-box from">
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #ccc; padding-bottom: 5px; margin-bottom: 10px; align-items: center;">
                        <h3 style="margin: 0; border: none; padding: 0;">From</h3>
                        <div class="stamp-container">
                            <span style="font-size: 12px; color: #777;">(인)</span>
                            <img class="stamp" src="{{lessorStampImg}}" alt="대표인">
                        </div>
                    </div>
                    <div class="info-row"><div class="info-label">상호</div><div class="info-value"><strong>{{lessorTradeName}}</strong> (대표자: {{lessorCeo}})</div></div>
                    <div class="info-row"><div class="info-label">등록번호</div><div class="info-value">{{lessorBizNo}}</div></div>
                    <div class="info-row"><div class="info-label">담당자</div><div class="info-value">{{salespersonName}} ({{salespersonPhone}})</div></div>
                    <div class="info-row"><div class="info-label">이메일</div><div class="info-value">{{lessorEmail}}</div></div>
                    <div class="info-row"><div class="info-label">TEL / FAX</div><div class="info-value">{{lessorTel}} / {{lessorFax}}</div></div>
                </div>
            </td>
        </tr>
    </table>
    <div class="price-summary">
        <span>견적 금액 (공급가액 + 세액)</span>
        <span>₩{{totalPrice}} (부가세 포함)</span>
    </div>
    <table class="main-table">
        <thead>
            <tr>
                <th style="width: 25%;">품명</th>
                <th style="width: 30%;">사양</th>
                <th style="width: 8%;">수량</th>
                <th style="width: 12%;">단가 (30일 기준)</th>
                <th style="width: 13%;">공급가액</th>
                <th style="width: 12%;">세액</th>
            </tr>
        </thead>
        <tbody>
            {{equipmentLines}}
            <tr>
                <td>상하차 편도 운송료</td>
                <td>배송/회수 차량 배차 비용 (1회 청구)</td>
                <td>1</td>
                <td class="right">₩{{deliveryCost}}</td>
                <td class="right">₩{{deliveryCost}}</td>
                <td class="right">₩{{deliveryTax}}</td>
            </tr>
            <tr>
                <td colspan="2" style="font-weight: bold; background-color: #f9fafb;">합 계</td>
                <td style="font-weight: bold;">{{totalQty}}</td>
                <td class="right" style="background-color: #f9fafb;">-</td>
                <td class="right" style="font-weight: bold; background-color: #f9fafb;">₩{{totalSupply}}</td>
                <td class="right" style="font-weight: bold; background-color: #f9fafb;">₩{{totalTax}}</td>
            </tr>
        </tbody>
    </table>
    <div class="terms-box">
        <h4>기타 약관 및 거래 조건</h4>
        <ul>
            <li><strong>운송약관:</strong> 2개월 이하 사용 시 왕복 운반비 임차인 부담, 4개월 이하 사용 시 편도 운임 임차인 부담, 4개월 이상 사용 시 왕복 운반비 임대인 부담을 원칙으로 합니다.</li>
            <li><strong>보험조건:</strong> 생산물배상책임보험 1사고당 총 보상 한도 5억원에 가입되어 있습니다.</li>
            <li><strong>상하차비:</strong> 현장에 장비 도착 및 회수 반출 시 지게차 사용 비용은 임차인이 부담합니다.</li>
            <li><strong>유지보수:</strong> 일반적인 소모품 및 정비는 임대인이 부담하나, 사용자 과실 및 부주의로 인한 파손 발생 시 정비 수리 비용은 임차인이 전액 부담합니다.</li>
            <li><strong>반납조건:</strong> 장비 반납 시 외관상의 심각한 손상이나 훼손이 확인되는 경우 세차 및 도색비용이 합의 청구될 수 있습니다.</li>
            <li><strong>결제조건:</strong> 청구 발행일로부터 익월 30일 이내에 현금결제를 기준으로 합니다. (귀사 결제일 또는 사전 협의 가능)</li>
        </ul>
    </div>
</body>
</html>`;

// 고소작업대 임대차 계약서 HTML 템플릿
const CONTRACT_TEMPLATE = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>고소작업대 임대차 계약서</title>
    <style>
        body { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; margin: 40px; color: #333; line-height: 1.4; }
        .title { text-align: center; font-size: 26px; font-weight: 800; letter-spacing: 3px; margin-bottom: 5px; }
        .date-subtitle { text-align: center; font-size: 14px; margin-bottom: 25px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px; }
        th, td { border: 1px solid #000; padding: 6px; text-align: center; }
        th { background-color: #f3f4f6; font-weight: bold; }
        .section-title { font-size: 13px; font-weight: bold; text-align: left; margin: 15px 0 6px 0; border-left: 4px solid #000; padding-left: 8px; }
        .footer-info { font-size: 10px; color: #555; text-align: left; margin-top: 20px; border-top: 1px solid #000; padding-top: 8px; line-height: 1.6; }
        .stamp-container { position: relative; display: inline-block; }
        .stamp { position: absolute; right: 10px; top: -15px; width: 40px; height: 40px; opacity: 0.85; }
    </style>
</head>
<body>
    <div class="title">고소작업대 임대차 계약서</div>
    <div class="date-subtitle">{{contractYear}}년 {{contractMonth}}월 {{contractDay}}일</div>
    <table>
        <tr>
            <th rowspan="3" style="width: 10%;">임대인<br>(갑)</th>
            <td style="width: 15%; background-color: #fafafa; font-weight: bold;">등록번호</td>
            <td style="width: 25%;">{{lessorBizNo}}</td>
            <th rowspan="3" style="width: 10%;">임차인<br>(을)</th>
            <td style="width: 15%; background-color: #fafafa; font-weight: bold;">등록번호</td>
            <td style="width: 25%;">{{bizRegNo}}</td>
        </tr>
        <tr>
            <td style="background-color: #fafafa; font-weight: bold;">상 호</td>
            <td>{{lessorCorporateName}}</td>
            <td style="background-color: #fafafa; font-weight: bold;">상 호</td>
            <td>{{customerName}}</td>
        </tr>
        <tr>
            <td style="background-color: #fafafa; font-weight: bold;">대표자</td>
            <td class="stamp-container">
                {{lessorCeo}}
                <img class="stamp" src="{{lessorStampImg}}" alt="대표인">
            </td>
            <td style="background-color: #fafafa; font-weight: bold;">대표자</td>
            <td>{{ceoName}}</td>
        </tr>
    </table>
    <div style="font-size: 10px; margin-bottom: 10px; text-align: left;">임대인과 임차인은 아래의 내용과 같이 임대차 계약을 체결하고, 계약서에 명시된 계약조건을 증명하기 위하여 본 계약서를 2부 작성하여 각 1부씩 보관한다.</div>
    <div class="section-title">임대차 계약 내용</div>
    <table>
        <tr>
            <td style="width: 15%; background-color: #fafafa; font-weight: bold;">장비 인도장소</td>
            <td style="width: 35%;">{{deliverySite}}</td>
            <td style="width: 15%; background-color: #fafafa; font-weight: bold;">장비 인도 예정일</td>
            <td style="width: 35%;">{{deliveryDate}}</td>
        </tr>
        <tr>
            <td style="background-color: #fafafa; font-weight: bold;">현장 상세 위치</td>
            <td colspan="3" style="text-align: left;">{{siteAddress}}</td>
        </tr>
        <tr>
            <td rowspan="3" style="background-color: #fafafa; font-weight: bold;">임차 신청자<br>(임차인의 대리인)</td>
            <td style="background-color: #fafafa; font-weight: bold;">상호(법인명)</td>
            <td>{{customerName}}</td>
            <td style="background-color: #fafafa; font-weight: bold;">사무실 전화</td>
            <td>{{officePhone}}</td>
        </tr>
        <tr>
            <td style="background-color: #fafafa; font-weight: bold;">장비 신청자</td>
            <td>{{applicantName}}</td>
            <td style="background-color: #fafafa; font-weight: bold;">핸드폰</td>
            <td>{{applicantPhone}}</td>
        </tr>
        <tr>
            <td style="background-color: #fafafa; font-weight: bold;">현장 담당자</td>
            <td>{{siteContactName}}</td>
            <td style="background-color: #fafafa; font-weight: bold;">핸드폰</td>
            <td>{{siteContactPhone}}</td>
        </tr>
    </table>
    <div class="section-title">임대 장비 규격 및 납품 명세</div>
    <table>
        <thead>
            <tr>
                <th style="width: 25%;">품목 (모델명)</th>
                <th style="width: 8%;">수량</th>
                <th style="width: 22%;">장비 번호 (S/N)</th>
                <th style="width: 15%;">임대료 (1대/1개월)</th>
                <th style="width: 15%;">소계</th>
                <th style="width: 15%;">비고</th>
            </tr>
        </thead>
        <tbody>
            {{rentalLines}}
            <tr>
                <td colspan="3" style="font-weight: bold; background-color: #fafafa;">합 계 금액</td>
                <td colspan="2" style="font-weight: bold; text-align: right; padding-right: 15px;">₩{{totalFee}}</td>
                <td style="font-size: 9px; color: red;">부가세 별도 / 운송료 별도</td>
            </tr>
        </tbody>
    </table>
    <table>
        <tr>
            <td style="width: 15%; background-color: #fafafa; font-weight: bold;">운송료 청구 기준</td>
            <td style="text-align: left; padding-left: 10px;">
                {{transportationTerms}}
            </td>
        </tr>
        <tr>
            <td style="background-color: #fafafa; font-weight: bold;">첨부 서류</td>
            <td style="text-align: left; padding-left: 10px; font-size: 10px;">
                임대차계약서, 장비반입원장, 장비제원표, 반입전체크리스트, 안전점검결과서, 안전인증서, 사업자등록증사본, 통장사본
            </td>
        </tr>
        <tr>
            <td style="background-color: #fafafa; font-weight: bold;">특이 사항</td>
            <td style="text-align: left; padding-left: 10px; font-weight: bold; color: red;">
                * 1개월 미만 사용 시에도 최소 1개월분의 기본 임대료가 전액 청구됩니다.
            </td>
        </tr>
        <tr>
            <td style="background-color: #fafafa; font-weight: bold;">건설기계 사용 시<br>주의 사항</td>
            <td style="text-align: left; font-size: 9px; line-height: 1.5; color: #444;">
                1. 지게차 및 크레인을 이용한 장비의 상·하차 비용 및 안전사고 책임은 임차인이 전액 부담합니다.<br>
                2. 계약기간 만료 후에도 반납 통보가 없을 시에는 임대차 계약이 동일 조건으로 자동 연장됩니다.<br>
                3. 임차인의 과실, 관리 소홀 및 오작동으로 인한 장비의 파손 및 해체 발생 시 수리 비용 일체는 임차인이 부담합니다.<br>
                4. 그 외 법적 규정되지 않은 사항은 건설기계임대차 표준계약서(공정거래위원회 표준약관)의 일반 조건에 따릅니다.
            </td>
        </tr>
        <tr>
            <td style="background-color: #fafafa; font-weight: bold;">결제 계좌</td>
            <td style="text-align: left; padding-left: 10px; font-weight: bold;">
                {{lessorBankAccount}}
            </td>
        </tr>
    </table>
    <div class="footer-info">
        <strong>본사/공장:</strong> {{lessorAddress}} &nbsp;&nbsp;|&nbsp;&nbsp; 
        <strong>A/S 접수 문의:</strong> {{lessorTel}} &nbsp;&nbsp;|&nbsp;&nbsp; 
        <strong>업무 담당자:</strong> {{salespersonName}} ({{salespersonPhone}})
    </div>
</body>
</html>`;

// 고소작업대 안전점검 결과서 HTML 템플릿
const SAFETY_INSPECTION_TEMPLATE = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>고소작업대 안전점검 결과서</title>
    <style>
        body { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; margin: 30px; color: #333; line-height: 1.3; }
        .title { text-align: center; font-size: 22px; font-weight: 800; border: 2px solid #000; padding: 6px; width: 60%; margin: 0 auto 20px auto; letter-spacing: 2px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10px; }
        th, td { border: 1px solid #000; padding: 5px; text-align: center; }
        th { background-color: #f3f4f6; font-weight: bold; }
        td.left { text-align: left; padding-left: 10px; }
        .fluid-manufacturer {
            display: inline-block;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 100%;
            font-size: clamp(8px, 2.5vw, 11px);
            font-weight: bold;
        }
        .footer-note { font-size: 8px; text-align: left; color: #666; margin-top: 10px; }
        .stamp-container { position: relative; display: inline-block; }
        .stamp { position: absolute; right: -5px; top: -10px; width: 30px; height: 30px; opacity: 0.8; }
    </style>
</head>
<body>
    <div class="title">고소작업대(T/L) 안전점검 결과서</div>
    <table>
        <tr>
            <th style="width: 12%;">사업장명</th>
            <td style="width: 20%;">{{lessorTradeName}}</td>
            <th style="width: 12%;">형식</th>
            <td style="width: 20%;">수직상승형 고소작업대</td>
            <th style="width: 12%;">제조사(렌탈사)</th>
            <td style="width: 24%;">
                <span class="fluid-manufacturer">{{manufacturer}} ({{lessorTradeName}})</span>
            </td>
        </tr>
        <tr>
            <th>사용업체</th>
            <td>{{customerName}}</td>
            <th>동력전달방식</th>
            <td>배터리충전식</td>
            <th>모델명</th>
            <td><strong>{{modelName}}</strong></td>
        </tr>
        <tr>
            <th>장비중량</th>
            <td>{{weight}} kg</td>
            <th>운행속도</th>
            <td>4 Km/h</td>
            <th>작업높이/용량</th>
            <td>{{maxHeight}} M / {{loadCapacity}} kg</td>
        </tr>
        <tr>
            <th>차량번호</th>
            <td><strong>{{assetNo}}</strong></td>
            <th>제조년도</th>
            <td>{{productionYear}}년</td>
            <th>안전인증일</th>
            <td>{{safetyCertDate}}</td>
        </tr>
        <tr>
            <th>안전점검일시</th>
            <td>{{inspectionDate}}</td>
            <th>점검부서</th>
            <td>정비팀</td>
            <th>점검자</th>
            <td class="stamp-container">
                {{inspectorName}}
                <img class="stamp" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAAAXNSR0IArs4c6QAAAAlwSFlzAAALEwAACxMBAJqcGAAAAadJREFUaEPtmWFOwzAMhW/uA+4/90HACUgIEoc0ad26/lhq1STN19hOqN9SJfFjO/4e3pI3S5F3fFw8bFp97dZz8/G2abfB2wZ7D6/J+69bWJ6L52P7mHy+Xz8+Lx+fr6v6Xv5m9fP69Vrfy//2Wl/L217ra/s5t4/J91+vybE9bHl9TNu3vVbeXsszW/k59pq2r3up1+TYHk2Ove61/e01ObaHLa+PyWvbq63PseW5eE2OpvXl1XNl9dxyZe7/7M9V33t7eW/sPbfvjXXeW8u5+PzcXq7P5er293v7b8u5+O/rZ/bZ+97bf1vXz+yzz/f+3FauXN6eKz/n8q51/cw+++zzvT+3lSuXt+fKz7m8a10/s88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a18/ss88++3zvz23lyuXtufJzLu9a/wdzK+i+0EagAAAAABJRU5ErkJggg==" alt="김관주 직인">
            </td>
        </tr>
    </table>
    <table>
        <thead>
            <tr>
                <th style="width: 15%;">검사구분</th>
                <th style="width: 70%;">검사항목</th>
                <th style="width: 15%;">검사결과</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td rowspan="2" style="font-weight: bold;">1. 공통사항</td>
                <td class="left">제조일로부터 15년 이내의 장비일 것</td>
                <td>O</td>
            </tr>
            <tr>
                <td class="left">붐대, 아웃트리거, 용접부등 비파괴 검사 성적서 비치되어 있을것</td>
                <td>-</td>
            </tr>
            <tr>
                <td rowspan="2" style="font-weight: bold;">2. 차대와 타이어</td>
                <td class="left">차체의 균열, 변형, 손상 및 부식이 없을것</td>
                <td>O</td>
            </tr>
            <tr>
                <td class="left">타이어의 이상마모 및 변형이 없고 림부의 체결볼트, 너트 등이 견고하게 체결될것</td>
                <td>O</td>
            </tr>
            <tr>
                <td rowspan="2" style="font-weight: bold;">3. 동력원 및 배터리</td>
                <td class="left">유압펌프 및 모터는 설치상태가 견고하고 작동상태가 원활할 것</td>
                <td>O</td>
            </tr>
            <tr>
                <td class="left">축전지 배선 단락, 변형 및 전선 노후 피복 상태 양호할 것</td>
                <td>O</td>
            </tr>
            <tr>
                <td style="font-weight: bold;">4. 작업대 마스트</td>
                <td class="left">구조물의 균열, 변형이 없고 마스트 잠금 고정상태 양호할 것</td>
                <td>O</td>
            </tr>
            <tr>
                <td rowspan="2" style="font-weight: bold;">5. 작업대</td>
                <td class="left">안전난간대 높이 1.0M 이상, 발끝막이판 0.15M 이상 설치 상태</td>
                <td>O</td>
            </tr>
            <tr>
                <td class="left">작업대 바닥면은 미끄럼 방지 구조이며 배수가 원활할 것</td>
                <td>O</td>
            </tr>
            <tr>
                <td style="font-weight: bold;">6. 제어장치</td>
                <td class="left">상/하부 조작레버 중립 복귀 작동 상태 및 비상정지 스위치 상태</td>
                <td>O</td>
            </tr>
            <tr>
                <td style="font-weight: bold;">7. 경고 및 표시</td>
                <td class="left">명판 제조사, 모델명, 제조번호, 정격하중, 주의사항 표시 부착 상태</td>
                <td>O</td>
            </tr>
            <tr>
                <td rowspan="4" style="font-weight: bold;">8. 안전장치</td>
                <td class="left">상승 주행 시 속도 제한 장치 및 오작동 방지 안전 가드 작동상태</td>
                <td>O</td>
            </tr>
            <tr>
                <td class="left">차대의 경사 허용 한도 초과 시 작동 방지 경보음 및 상승 제한 상태</td>
                <td>O</td>
            </tr>
            <tr>
                <td class="left">비상정지용 누름버튼이 돌출형식으로 수동 복귀 양호할 것</td>
                <td>O</td>
            </tr>
            <tr>
                <td class="left">비상 하강 밸브(비상 조작 유압 밸브) 작동 상태 상태 양호</td>
                <td>O</td>
            </tr>
        </tbody>
    </table>
    <div style="border: 1px solid #000; padding: 6px; font-size: 10px; text-align: left; background-color: #fafafa;">
        <strong>검사의견:</strong> 상기 임대 장비는 규격 및 안전 검사 기준에 부합하며, 반입 전 최종 점검 결과 이상이 없으므로 임대 출고를 승인함.
    </div>
    <div class="footer-note">* 검사결과 표시: 양호 O, 불량 X, 해당무 -</div>
</body>
</html>`;

// 반입 전 CHECK LIST HTML 템플릿
const CHECK_LIST_TEMPLATE = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>반입 전 CHECK LIST</title>
    <style>
        body { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; margin: 30px; color: #333; line-height: 1.2; }
        .header { display: flex; justify-content: space-between; border: 2px solid #000; padding: 6px 12px; font-weight: bold; margin-bottom: 15px; font-size: 13px; }
        .container { display: flex; gap: 15px; }
        .column { width: 50%; }
        table { width: 100%; border-collapse: collapse; font-size: 9px; }
        th, td { border: 1px solid #000; padding: 3px 4px; text-align: center; }
        th { background-color: #f3f4f6; }
        td.left { text-align: left; }
        .section-header { background-color: #e5e7eb; font-weight: bold; text-align: left; padding-left: 6px; }
        .footer-note { font-size: 8px; margin-top: 10px; color: #555; text-align: left; line-height: 1.4; }
    </style>
</head>
<body>
    <div class="header">
        <span>( 모델명: {{modelName}} )</span>
        <span style="font-size: 15px; text-decoration: underline;">■ 반입 전 CHECK LIST</span>
        <span>( 관리번호: {{assetNo}} )</span>
    </div>
    <div class="container">
        <div class="column">
            <table>
                <thead>
                    <tr>
                        <th style="width: 8%;">NO</th>
                        <th style="width: 45%;">검사 항목</th>
                        <th style="width: 12%;">검사기준</th>
                        <th style="width: 10%;">양호</th>
                        <th style="width: 10%;">불량</th>
                        <th style="width: 15%;">점검자</th>
                    </tr>
                </thead>
                <tbody>
                    <tr class="section-header"><td colspan="6">▣ 입고 및 작동검사</td></tr>
                    <tr><td>1</td><td class="left">장비 외관 및 도장 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>2</td><td class="left">스위치 박스 및 케이블 작동 상태</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>3</td><td class="left">상/하부 비상정지 작동 상태</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>4</td><td class="left">전후진 주행 및 속도 제어 상태</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>5</td><td class="left">고속/저속 주행 전환 상태</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>6</td><td class="left">조향 실린더 및 킹핀 조작</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>7</td><td class="left">리프트 상승 및 하강 상태</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>8</td><td class="left">수동 비상 하강 밸브 작동</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>9</td><td class="left">주행 경보음 및 경광등 작동 상태</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr class="section-header"><td colspan="6">▣ 세차 상태</td></tr>
                    <tr><td>10</td><td class="left">흙, 콘크리트 등 이물질 제거</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>11</td><td class="left">하부 프레임 세차 완료 여부</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>12</td><td class="left">휠 및 타이어 청소 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>13</td><td class="left">배터리 및 충전기 오염 제거</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr class="section-header"><td colspan="6">▣ 도장 및 마킹</td></tr>
                    <tr><td>14</td><td class="left">외관 도장 상태 (부분 도색 포함)</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>15</td><td class="left">자산 관리번호(스티커) 부착 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>16</td><td class="left">경고 표시 및 주의 마킹 확인</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>17</td><td class="left">안전 점검 스티커 부착 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr class="section-header"><td colspan="6">▣ 유압 장치</td></tr>
                    <tr><td>18</td><td class="left">유압 오일 게이지 확인 (적정량)</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>19</td><td class="left">유압 탱크 누유 여부</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>20</td><td class="left">유압 호스 및 피팅 상태 (누유 없음)</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>21</td><td class="left">리프트 실린더 누유 및 작동 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>22</td><td class="left">조향 실린더 누유 및 마찰 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>23</td><td class="left">모터 및 매니폴드 블록 누유</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>24</td><td class="left">수동 하강 케이블 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>25</td><td class="left">작동유 탱크 필터 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>26</td><td class="left">유압 압력 밸브 설정 세팅</td><td>측정</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr class="section-header"><td colspan="6">▣ 전기 및 제어 장치</td></tr>
                    <tr><td>27</td><td class="left">배터리 단자 연결 및 부식 여부</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>28</td><td class="left">배터리 액 레벨 상태 (증류수)</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>29</td><td class="left">배터리 팩 충전 테스트 완료</td><td>측정</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>30</td><td class="left">충전용 전원 플러그 및 선 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>31</td><td class="left">메인 릴레이 및 접촉기 작동</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>32</td><td class="left">하부 컨트롤 박스 작동 및 상태</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>33</td><td class="left">조이스틱 레버 중립 스위치</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>34</td><td class="left">조이스틱 프로포셔널 밸브 연계</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>35</td><td class="left">전선 커넥터 및 배선 정리 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                </tbody>
            </table>
        </div>
        <div class="column">
            <table>
                <thead>
                    <tr>
                        <th style="width: 8%;">NO</th>
                        <th style="width: 45%;">검사 항목</th>
                        <th style="width: 12%;">검사기준</th>
                        <th style="width: 10%;">양호</th>
                        <th style="width: 10%;">불량</th>
                        <th style="width: 15%;">점검자</th>
                    </tr>
                </thead>
                <tbody>
                    <tr class="section-header"><td colspan="6">▣ 전기 및 제어 장치 (계속)</td></tr>
                    <tr><td>36</td><td class="left">릴레이 박스 퓨즈 교체 여부</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>37</td><td class="left">배터리 전압 편차 및 상태</td><td>측정</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>38</td><td class="left">배터리 로드 테스트 (방전기 측정)</td><td>측정</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>39</td><td class="left">하부 리미트 스위치 작동 상태</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>40</td><td class="left">상부 과부하 방지 리미트 확인</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>41</td><td class="left">경적(혼) 작동 상태</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>42</td><td class="left">접지 체인 접촉 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr class="section-header"><td colspan="6">▣ 차체 및 마스트 구조</td></tr>
                    <tr><td>43</td><td class="left">가이드 블록 마모도 및 그리스</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>44</td><td class="left">타이어 파손 및 균열 확인</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>45</td><td class="left">킹핀 및 조향 힌지 유격 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>46</td><td class="left">샤시 마스트 볼트 체결 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>47</td><td class="left">확장용 작업대 슬라이딩 상태</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>48</td><td class="left">출입구 안전문 및 잠금 장치</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>49</td><td class="left">사다리 고정 상태 및 디딤판</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>50</td><td class="left">바퀴 허브 베어링 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>51</td><td class="left">마스트 핀 및 부싱 유격 확인</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>52</td><td class="left">포트홀(Pothole) 가드 전개 상태</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>53</td><td class="left">포트홀 리미트 스위치 정상 작동</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>54</td><td class="left">안전 받침대 설치 및 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>55</td><td class="left">아웃트리거(보조 다리) 체결 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>56</td><td class="left">그리스 니플 상태 및 주입 완료</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr class="section-header"><td colspan="6">▣ 출고 전 정비 점검</td></tr>
                    <tr><td>57</td><td class="left">주행 및 승하강 작동 테스트 3회</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>58</td><td class="left">경사지 브레이크 홀딩 테스트</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>59</td><td class="left">비상 정지 하강 스피드 확인</td><td>측정</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>60</td><td class="left">최대 적재 하중 상승 테스트</td><td>작동</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>61</td><td class="left">누유 전수 육안 점검 완료</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>62</td><td class="left">배터리 액 보충 및 세척 완료</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>63</td><td class="left">각 볼트류 토크 렌치 확인</td><td>측정</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>64</td><td class="left">최종 출고 정비 승인 서명</td><td>서명</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr class="section-header"><td colspan="6">▣ 옵션 장치 확인</td></tr>
                    <tr><td>65</td><td class="left">상부 조작함 안전 덮개 장착</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>66</td><td class="left">협착 방지 센서 및 바 장착</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>67</td><td class="left">타이어 커버/클린 타이어 여부</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>68</td><td class="left">안전 벨트 걸이대 보강 유무</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>69</td><td class="left">하부 가설 패널 및 함석 상태</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>70</td><td class="left">기타 요청 옵션 장착 확인</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                    <tr><td>71</td><td class="left">사용 가이드북 부착 여부</td><td>육안</td><td>V</td><td></td><td>김관주</td></tr>
                </tbody>
            </table>
        </div>
    </div>
    <div class="footer-note">
        ※ 주의사항: 1. 기준은 장비 출고 시 최종 성능 검사 기준이며 배터리 충전 및 전압 상태에 따라 일부 오차가 있을 수 있습니다.<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;2. 배터리 소모품의 충전 상태에 따라 속도 편차가 발생할 수 있으니 반입 즉시 정상 충전을 확인하시기 바랍니다.
    </div>
</body>
</html>`;

// ERP 구글 드라이브 표준 거래명세서 HTML 템플릿
const TRANSACTION_STATEMENT_TEMPLATE = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>거래명세서</title>
    <style>
        body { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; margin: 20px; color: #1e293b; line-height: 1.4; background-color: #ffffff; }
        .statement-box { border: 2px solid #0f172a; padding: 24px; width: 100%; max-width: 780px; margin: 0 auto; background-color: #ffffff; box-sizing: border-box; }
        .title-container { text-align: center; margin-bottom: 20px; border-bottom: 2px double #0f172a; padding-bottom: 10px; }
        .title { font-size: 26px; font-weight: 900; letter-spacing: 6px; color: #0f172a; margin: 0; }
        .subtitle { font-size: 11px; color: #64748b; margin-top: 4px; }
        
        .header-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 12px; }
        .header-table td { vertical-align: top; padding: 0; border: none; }
        
        .party-box { border: 1px solid #334155; padding: 10px 12px; min-height: 125px; border-radius: 4px; background-color: #f8fafc; }
        .party-title { font-size: 13px; font-weight: 800; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
        .info-row { display: flex; margin-bottom: 4px; font-size: 12px; }
        .info-label { width: 75px; font-weight: 700; color: #475569; flex-shrink: 0; }
        .info-val { flex: 1; color: #0f172a; word-break: break-all; }

        .meta-bar { display: flex; justify-content: space-between; background-color: #e2e8f0; padding: 8px 14px; border-radius: 4px; font-size: 12px; font-weight: 700; color: #1e293b; margin-bottom: 14px; border: 1px solid #cbd5e1; }
        
        .amount-summary-box { background-color: #eff6ff; border: 1.5px solid #3b82f6; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
        .amount-title { font-size: 13px; font-weight: 800; color: #1e40af; }
        .amount-value { font-size: 17px; font-weight: 900; color: #1e3a8a; }
        .amount-sub { font-size: 11px; color: #3b82f6; margin-top: 2px; }

        .main-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11.5px; }
        .main-table th, .main-table td { border: 1px solid #334155; padding: 8px 6px; text-align: center; }
        .main-table th { background-color: #f1f5f9; font-weight: 800; color: #0f172a; }
        .main-table td.left { text-align: left; }
        .main-table td.right { text-align: right; }
        .main-table tr.total-row td { background-color: #f8fafc; font-weight: 800; border-top: 2px solid #0f172a; }

        .footer-note { font-size: 11px; color: #475569; border: 1px solid #cbd5e1; padding: 10px 14px; border-radius: 4px; background-color: #fafafa; line-height: 1.6; }
        .footer-note strong { color: #0f172a; }

        .stamp-container { position: relative; display: inline-block; }
        .stamp { position: absolute; right: -5px; top: -12px; width: 42px; height: 42px; opacity: 0.9; }
    </style>
</head>
<body>
    <div class="statement-box" id="transaction-statement-pdf-target">
        <div class="title-container">
            <h1 class="title">거 래 명 세 서</h1>
            <div class="subtitle">(공급받는자 보관용 - 구글 드라이브 표준 양식)</div>
        </div>

        <table class="header-table">
            <tr>
                <td style="width: 49%;">
                    <div class="party-box">
                        <div class="party-title">
                            <span>[공급자]</span>
                        </div>
                        <div class="info-row"><div class="info-label">등록번호</div><div class="info-val"><strong>{{lessorBizNo}}</strong></div></div>
                        <div class="info-row">
                            <div class="info-label">상 호</div>
                            <div class="info-val"><strong>{{lessorTradeName}}</strong></div>
                        </div>
                        <div class="info-row">
                            <div class="info-label">대 표 자</div>
                            <div class="info-val stamp-container">
                                <strong>{{lessorCeo}}</strong>
                                <img class="stamp" src="{{lessorStampImg}}" alt="직인">
                            </div>
                        </div>
                        <div class="info-row"><div class="info-label">주 소</div><div class="info-val">{{lessorAddress}}</div></div>
                        <div class="info-row"><div class="info-label">TEL / FAX</div><div class="info-val">{{lessorTel}} / {{lessorFax}}</div></div>
                    </div>
                </td>
                <td style="width: 2%;"></td>
                <td style="width: 49%;">
                    <div class="party-box">
                        <div class="party-title">[공급받는자]</div>
                        <div class="info-row"><div class="info-label">등록번호</div><div class="info-val"><strong>{{bizRegNo}}</strong></div></div>
                        <div class="info-row"><div class="info-label">상 호</div><div class="info-val"><strong>{{customerName}}</strong></div></div>
                        <div class="info-row"><div class="info-label">대 표 자</div><div class="info-val">{{representative}}</div></div>
                        <div class="info-row"><div class="info-label">주 소</div><div class="info-val">{{address}}</div></div>
                        <div class="info-row"><div class="info-label">작업현장</div><div class="info-val"><strong>{{siteName}}</strong></div></div>
                    </div>
                </td>
            </tr>
        </table>

        <div class="meta-bar">
            <span>🗓️ 청구귀속월: {{billingYm}}</span>
            <span>📅 발행일자: {{billingDate}}</span>
            <span>📑 계약번호: {{contractNo}}</span>
        </div>

        <div class="amount-summary-box">
            <div>
                <div class="amount-title">청구 합계 금액 (부가가치세 포함)</div>
                <div class="amount-sub">공급가액: ₩{{totalSupplyFormatted}} | 부가가치세: ₩{{totalVatFormatted}}</div>
            </div>
            <div style="text-align: right;">
                <div class="amount-value">일금 {{totalAmountKorean}} 원정</div>
                <div style="font-size: 13px; color: #1e40af; font-weight: 800;">(₩{{totalAmountFormatted}})</div>
            </div>
        </div>

        <table class="main-table">
            <thead>
                <tr>
                    <th style="width: 6%;">No</th>
                    <th style="width: 36%;">품명 및 적용 기준</th>
                    <th style="width: 8%;">수량</th>
                    <th style="width: 14%;">단가</th>
                    <th style="width: 12%;">공급가액</th>
                    <th style="width: 12%;">부가가치세</th>
                    <th style="width: 12%;">합계</th>
                </tr>
            </thead>
            <tbody>
                {{detailRows}}
                <tr class="total-row">
                    <td colspan="4" style="text-align: center;">합 계</td>
                    <td class="right">₩{{totalSupplyFormatted}}</td>
                    <td class="right">₩{{totalVatFormatted}}</td>
                    <td class="right">₩{{totalAmountFormatted}}</td>
                </tr>
            </tbody>
        </table>

        <div class="footer-note">
            <div><strong>[입금 계좌 안내]</strong> {{lessorBankAccount}}</div>
            <div style="font-size: 10.5px; color: #64748b; margin-top: 2px;">
                • 본 거래명세서는 ERP 표준 양식 기반으로 자동 발행되었습니다.<br>
                • 대금 입금 시 반드시 입금자명을 상호명으로 지정하여 주시기 바랍니다. (문의: {{lessorTel}})
            </div>
        </div>
    </div>
</body>
</html>`;

export function numberToKoreanAmount(amount: number): string {
  if (!amount || isNaN(amount)) return '영';
  const units = ['', '만', '억', '조'];
  const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const subUnits = ['', '십', '백', '천'];
  
  let num = Math.floor(Math.abs(amount));
  let unitIdx = 0;
  let result = '';

  while (num > 0) {
    const chunk = num % 10000;
    if (chunk > 0) {
      let chunkStr = '';
      let c = chunk;
      for (let i = 0; i < 4; i++) {
        const d = c % 10;
        if (d > 0) {
          const digitStr = (d === 1 && i > 0) ? '' : digits[d];
          chunkStr = digitStr + subUnits[i] + chunkStr;
        }
        c = Math.floor(c / 10);
      }
      result = chunkStr + units[unitIdx] + ' ' + result;
    }
    num = Math.floor(num / 10000);
    unitIdx++;
  }
  return result.trim();
}

export const documentBuilder = {
  // 견적서 조립
  buildQuotation(contract: any, customer: any, contact: any, salesperson: any, products: any[]): string {
    const quotationDate = contract.startDate;
    const formattedDate = new Date(quotationDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    // 장비 라인 렌더링
    let linesHtml = '';
    let totalQty = 0;
    let totalRentSupply = 0;

    // 계약 장비 목록
    const contractAssets = JSON.parse(localStorage.getItem('erp_contractAssets') || '[]');
    const matchingContractAssets = contractAssets.filter((ca: any) => ca.contractId === contract.id);
    const assets = JSON.parse(localStorage.getItem('erp_assets') || '[]');

    // 수직형 고소장비 모델별로 그룹핑하여 출력
    const modelGroup: { [model: string]: { qty: number, price: number, spec: string } } = {};

    matchingContractAssets.forEach((ca: any) => {
      const asset = assets.find((a: any) => a.id === ca.assetId);
      if (asset) {
        const prod = products.find((p: any) => p.modelName === asset.modelName);
        const spec = prod ? prod.spec : '동력: 배터리, 작업높이: 7.8M';
        const fee = ca.monthlyRentalFee || 350000;
        if (!modelGroup[asset.modelName]) {
          modelGroup[asset.modelName] = { qty: 0, price: fee, spec };
        }
        modelGroup[asset.modelName].qty += 1;
      }
    });

    Object.keys(modelGroup).forEach(model => {
      const group = modelGroup[model];
      const modelSupply = group.qty * group.price;
      const modelTax = Math.floor(modelSupply * 0.1);
      linesHtml += `
      <tr>
          <td><strong>수직형 고소장비 (${model})</strong></td>
          <td class="left" style="font-size: 10px; line-height: 1.4; white-space: pre-line;">${group.spec}</td>
          <td>${group.qty}</td>
          <td class="right">₩${group.price.toLocaleString()}</td>
          <td class="right">₩${modelSupply.toLocaleString()}</td>
          <td class="right">₩${modelTax.toLocaleString()}</td>
      </tr>`;
      totalQty += group.qty;
      totalRentSupply += modelSupply;
    });

    if (totalQty === 0) {
      // 장비 미지정시 기본 견적 1대
      linesHtml += `
      <tr>
          <td><strong>수직형 고소장비 (GTJZ0608ME)</strong></td>
          <td class="left" style="font-size: 10px; line-height: 1.4;">동력: 배터리<br>작업높이: 7.8M, 발판높이: 5.8M<br>적재중량: 227kg, 장비중량: 1226kg<br>크기: 1.83 * 0.77 * 2.16 (감지봉 4개, 3면 함석)</td>
          <td>1</td>
          <td class="right">₩280,000</td>
          <td class="right">₩280,000</td>
          <td class="right">₩28,000</td>
      </tr>`;
      totalQty = 1;
      totalRentSupply = 280000;
    }

    const deliveryCost = contract.deliveryFee || 150000;
    const deliveryTax = Math.floor(deliveryCost * 0.1);

    const totalSupply = totalRentSupply + deliveryCost;
    const totalTax = Math.floor(totalRentSupply * 0.1) + deliveryTax;
    const totalPrice = totalSupply + totalTax;

    return applyLessorPlaceholders(
      QUOTATION_TEMPLATE
        .replace('{{customerName}}', customer?.name || '미상 고객사')
        .replace('{{contactName}}', contact?.name || '담당자')
        .replace('{{contactPosition}}', contact?.position || '대리/팀장')
        .replace('{{contactPhone}}', contact?.phone || '010-0000-0000')
        .replace('{{quotationDate}}', formattedDate)
        .replace('{{salespersonName}}', salesperson?.name || '김원진 팀장')
        .replace('{{salespersonPhone}}', salesperson?.phone || '010-9402-5296')
        .replace('{{totalPrice}}', totalPrice.toLocaleString())
        .replace('{{deliveryCost}}', deliveryCost.toLocaleString())
        .replace('{{deliveryTax}}', deliveryTax.toLocaleString())
        .replace('{{totalQty}}', totalQty.toString())
        .replace('{{totalSupply}}', totalSupply.toLocaleString())
        .replace('{{totalTax}}', totalTax.toLocaleString())
        .replace('{{equipmentLines}}', linesHtml)
    );
  },

  // 계약서 조립
  buildContract(contract: any, customer: any, contact: any, site: any): string {
    const date = new Date(contract.startDate);
    const contractYear = date.getFullYear().toString();
    const contractMonth = (date.getMonth() + 1).toString();
    const contractDay = date.getDate().toString();

    // 요일 구하기
    const week = ['일', '월', '화', '수', '목', '금', '토'];
    const deliveryDateStr = `${contract.startDate} (${week[new Date(contract.startDate).getDay()]}요일)`;

    // 계약 장비 명세 출력
    const contractAssets = JSON.parse(localStorage.getItem('erp_contractAssets') || '[]');
    const matchingContractAssets = contractAssets.filter((ca: any) => ca.contractId === contract.id);
    const assets = JSON.parse(localStorage.getItem('erp_assets') || '[]');

    let linesHtml = '';
    let totalFee = 0;

    matchingContractAssets.forEach((ca: any) => {
      const asset = assets.find((a: any) => a.id === ca.assetId);
      if (asset) {
        const fee = ca.monthlyRentalFee || 350000;
        const subtotal = fee; // 1대 기준
        linesHtml += `
        <tr>
            <td>${asset.modelName}</td>
            <td>1</td>
            <td><strong>${asset.assetNo}</strong> (${asset.serialNo || 'S/N미상'})</td>
            <td style="text-align: right;">₩${fee.toLocaleString()}</td>
            <td style="text-align: right;">₩${subtotal.toLocaleString()}</td>
            <td>운송비 별도</td>
        </tr>`;
        totalFee += subtotal;
      }
    });

    if (matchingContractAssets.length === 0) {
      linesHtml += `
      <tr>
          <td colspan="6" style="color: #888;">지정된 할당 장비가 없습니다. (계약 체결 전 가계약 상태)</td>
      </tr>`;
    }

    // 운반비 청구 조건 마킹
    const transportTerms = contract.durationMonths >= 4 
      ? '■ 4개월 이상: 왕복 운반비 임대인(갑) 부담'
      : contract.durationMonths >= 2
        ? '■ 2개월 초과 4개월 미만: 편도 운반비 임차인(을) 부담'
        : '■ 2개월 이하 사용: 왕복 운반비 임차인(을) 부담';

    return applyLessorPlaceholders(
      CONTRACT_TEMPLATE
        .replace('{{contractYear}}', contractYear)
        .replace('{{contractMonth}}', contractMonth)
        .replace('{{contractDay}}', contractDay)
        .replace('{{bizRegNo}}', customer?.bizRegNo || '135-81-11137')
        .replace('{{customerName}}', customer?.name || '미상 고객사')
        .replace('{{ceoName}}', customer?.representative || '대표자')
        .replace('{{deliverySite}}', contract.siteName || '평택 현장')
        .replace('{{deliveryDate}}', deliveryDateStr)
        .replace('{{siteAddress}}', site?.address || '현장 상세 주소')
        .replace('{{officePhone}}', customer?.phone || '02-000-0000')
        .replace('{{applicantName}}', contact?.name || '신청 담당자')
        .replace('{{applicantPhone}}', contact?.phone || '010-0000-0000')
        .replace('{{siteContactName}}', contract.siteContactName || '현장 담당자')
        .replace('{{siteContactPhone}}', contract.siteContactPhone || '010-0000-0000')
        .replace('{{totalFee}}', totalFee.toLocaleString())
        .replace('{{transportationTerms}}', transportTerms)
        .replace('{{rentalLines}}', linesHtml)
    );
  },

  // 안전점검 결과서 조립
  buildSafetyInspection(asset: any, product: any, customer: any, contract: any): string {
    const inspectionDate = contract ? contract.startDate : new Date().toISOString().split('T')[0];
    const safetyCertDate = product?.safetyCertDate || '2023-06-20';
    const productionYear = asset.productionYear || '2025';

    // 제품 제조사
    const manufacturerName = product?.manufacturer || 'SINOBOOM';

    return applyLessorPlaceholders(
      SAFETY_INSPECTION_TEMPLATE
        .replace('{{manufacturer}}', manufacturerName)
        .replace('{{customerName}}', customer?.name || '화성엔지니어링 주식회사')
        .replace('{{modelName}}', asset.modelName)
        .replace('{{weight}}', product?.weight || '1,575')
        .replace('{{maxHeight}}', product?.feet || '7.8')
        .replace('{{loadCapacity}}', product?.capacity || '230')
        .replace('{{assetNo}}', asset.assetNo)
        .replace('{{productionYear}}', productionYear)
        .replace('{{safetyCertDate}}', safetyCertDate)
        .replace('{{inspectionDate}}', inspectionDate)
        .replace('{{inspectorName}}', '김관주 주임')
    );
  },

  // 반입 전 체크리스트 조립
  buildPreDeliveryChecklist(asset: any): string {
    return CHECK_LIST_TEMPLATE
      .replace('{{modelName}}', asset.modelName)
      .replace('{{assetNo}}', asset.assetNo);
  },

  // ERP 구글 드라이브 표준 거래명세서 조립
  buildTransactionStatement(billing: any, details: any[], customer: any, contract: any, site: any): string {
    const supplyTotal = Math.round((billing?.totalAmount || 0) / 1.1);
    const vatTotal = (billing?.totalAmount || 0) - supplyTotal;
    const totalAmount = billing?.totalAmount || 0;

    let detailRowsHtml = '';
    if (details && details.length > 0) {
      details.forEach((d: any, idx: number) => {
        const itemSupply = Math.round(d.amount / 1.1);
        const itemVat = d.amount - itemSupply;
        detailRowsHtml += `
        <tr>
            <td>${idx + 1}</td>
            <td class="left">
                <strong>${d.itemName}</strong>
                ${d.description ? `<div style="font-size: 10.5px; color: #64748b; margin-top: 2px;">${d.description}</div>` : ''}
            </td>
            <td>${d.quantity || 1}</td>
            <td class="right">₩${(d.unitPrice || itemSupply).toLocaleString()}</td>
            <td class="right">₩${itemSupply.toLocaleString()}</td>
            <td class="right">₩${itemVat.toLocaleString()}</td>
            <td class="right"><strong>₩${d.amount.toLocaleString()}</strong></td>
        </tr>`;
      });
    } else {
      detailRowsHtml = `
      <tr>
          <td colspan="7" style="color: #64748b; padding: 12px; text-align: center;">세부 청구 내역이 없습니다.</td>
      </tr>`;
    }

    return applyLessorPlaceholders(
      TRANSACTION_STATEMENT_TEMPLATE
        .replace('{{bizRegNo}}', customer?.bizRegNo || '-')
        .replace('{{customerName}}', customer?.name || '미상 고객사')
        .replace('{{representative}}', customer?.representative || '-')
        .replace('{{address}}', customer?.address || '-')
        .replace('{{siteName}}', site?.name || contract?.siteName || '본사/직납')
        .replace('{{billingYm}}', billing?.billingYm || '-')
        .replace('{{billingDate}}', billing?.billingDate || '-')
        .replace('{{contractNo}}', contract?.contractNo || '-')
        .replace('{{totalAmountKorean}}', numberToKoreanAmount(totalAmount))
        .replace('{{totalAmountFormatted}}', totalAmount.toLocaleString())
        .replace('{{totalSupplyFormatted}}', supplyTotal.toLocaleString())
        .replace('{{totalVatFormatted}}', vatTotal.toLocaleString())
        .replace('{{detailRows}}', detailRowsHtml)
    );
  },

  // 계약에 귀속되는 파일들을 전부 자동 조립하여 가상 드라이브에 등록
  generateAndUploadAllDocs(contract: any, customer: any, contact: any, site: any, salesperson: any): string[] {
    const uploadedFileIds: string[] = [];

    // 1. 데이터 조회
    const products = JSON.parse(localStorage.getItem('erp_products') || '[]');
    const contractAssets = JSON.parse(localStorage.getItem('erp_contractAssets') || '[]');
    const matchingContractAssets = contractAssets.filter((ca: any) => ca.contractId === contract.id);
    const assets = JSON.parse(localStorage.getItem('erp_assets') || '[]');

    // 드라이브 폴더가 없으면 생성
    let folderId = contract.driveFolderId;
    if (!folderId || folderId === 'root') {
      const folder = drive.createFolder(`계약_${contract.contractNo}_첨부`, 'root');
      folderId = folder.id;
      // 계약 객체 업데이트 반영 필요
      const contracts = JSON.parse(localStorage.getItem('erp_contracts') || '[]');
      const idx = contracts.findIndex((c: any) => c.id === contract.id);
      if (idx !== -1) {
        contracts[idx].driveFolderId = folderId;
        localStorage.setItem('erp_contracts', JSON.stringify(contracts));
      }
    }

    // 2. 견적서 생성 & 업로드
    const quotHtml = this.buildQuotation(contract, customer, contact, salesperson, products);
    const quotFile = drive.uploadFile(
      `렌탈견적서_${contract.contractNo}.html`,
      'text/html',
      '45 KB',
      folderId,
      `data:text/html;charset=utf-8,${encodeURIComponent(quotHtml)}`
    );
    uploadedFileIds.push(quotFile.id);

    // 3. 계약서 생성 & 업로드
    const contHtml = this.buildContract(contract, customer, contact, site);
    const contFile = drive.uploadFile(
      `고소작업대_임대차계약서_${contract.contractNo}.html`,
      'text/html',
      '55 KB',
      folderId,
      `data:text/html;charset=utf-8,${encodeURIComponent(contHtml)}`
    );
    uploadedFileIds.push(contFile.id);

    // 4. 할당 자산별 점검 서류 생성 & 업로드
    matchingContractAssets.forEach((ca: any) => {
      const asset = assets.find((a: any) => a.id === ca.assetId);
      if (asset) {
        const prod = products.find((p: any) => p.modelName === asset.modelName);

        // 안전점검결과서
        const inspHtml = this.buildSafetyInspection(asset, prod, customer, contract);
        const inspFile = drive.uploadFile(
          `안전점검결과서_${asset.assetNo}.html`,
          'text/html',
          '35 KB',
          folderId,
          `data:text/html;charset=utf-8,${encodeURIComponent(inspHtml)}`
        );
        uploadedFileIds.push(inspFile.id);

        // 반입전 체크리스트
        const chkHtml = this.buildPreDeliveryChecklist(asset);
        const chkFile = drive.uploadFile(
          `반입전체크리스트_${asset.assetNo}.html`,
          'text/html',
          '38 KB',
          folderId,
          `data:text/html;charset=utf-8,${encodeURIComponent(chkHtml)}`
        );
        uploadedFileIds.push(chkFile.id);
      }
    });

    // 5. 구글 환경설정에 지정된 회사 증빙(사업자등록증, 통장사본) 가상 파일 등록 & 포함
    const configs = JSON.parse(localStorage.getItem('erp_googleConfigs') || '[]');
    const config = configs[0] || {};
    
    if (config.bizRegCertUrl) {
      const name = config.bizRegCertUrl.split('/').pop() || '사업자등록증.pdf';
      const bizFile = drive.uploadFile(name, 'application/pdf', '320 KB', folderId, 'https://drive.google.com/mock/biz_reg_cert.pdf');
      uploadedFileIds.push(bizFile.id);
    }
    if (config.bankbookCopyUrl) {
      const name = config.bankbookCopyUrl.split('/').pop() || '통장사본.pdf';
      const bankFile = drive.uploadFile(name, 'application/pdf', '450 KB', folderId, 'https://drive.google.com/mock/bankbook_copy.pdf');
      uploadedFileIds.push(bankFile.id);
    }

    return uploadedFileIds;
  }
};
