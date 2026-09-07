/**
 * ==============================================================================
 * [기연리프트] 네이버 밴드 출고 게시글 상세 모달 순차 수집기 (v8.0 txtBody 완전 정밀)
 * ==============================================================================
 * 
 * [v8.0 핵심 개선 사항]
 * 1. 정확한 본문 요소: .postBody .txtBody (사용자 DevTools 지정 $0 요소) 100% 정밀 추출
 * 2. 작성자 및 일시 분리: [data-viewname="DPostAuthorView"]에서 정확한 날짜 및 작성자 추출
 * 3. 다음(>) 버튼 전환 대기 보강:
 *    - 네이버 밴드 SPA 비동기 로딩 중 버튼 일시 소멸/비활성화 시 조기 종료 방지 (최대 4초 폴링 대기)
 *    - 1건 읽고 튕기는 치명적 버그 완전 해결
 *    - 본문/일시 시그니처 변경 감지 (최대 6초 감시) 및 미변경 시 1회 자동 재클릭
 * 4. 종료 판정: 버튼이 완전히 사라지거나 비활성화된 상태에서 재시도 실패 시에만 안전하게 마지막 글로 판정
 * 5. UTF-8 BOM 인코딩 보장 다운로드: Windows 메모장 및 엑셀 한글 깨짐 0%
 * ==============================================================================
 */

(async () => {
  console.log('🚀 [기연리프트] 밴드 postDetailView ➔ txtBody 정밀 순차 수집기 v8.0 시작...');

  const hudId = 'band_modal_scraper_hud';
  const oldHud = document.getElementById(hudId);
  if (oldHud) oldHud.remove();

  const hud = document.createElement('div');
  hud.id = hudId;
  hud.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999999;background:rgba(15,23,42,0.96);color:#fff;padding:18px 22px;border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,0.5);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;line-height:1.5;min-width:340px;border:2px solid #38bdf8;backdrop-filter:blur(8px);';
  hud.innerHTML = 
    '<div style="font-weight:700;font-size:15px;margin-bottom:10px;color:#38bdf8;display:flex;align-items:center;justify-content:space-between;">' +
      '<span>🚜 밴드 순차 수집기 v8.0</span>' +
      '<span id="hud_status_badge" style="font-size:11px;font-weight:600;padding:3px 8px;background:#0284c7;border-radius:6px;color:#fff;">수집 중</span>' +
    '</div>' +
    '<div style="margin-bottom:6px;display:flex;justify-content:space-between;border-bottom:1px solid #334155;padding-bottom:6px;">' +
      '<span>수집된 게시글:</span>' +
      '<strong id="hud_post_count" style="color:#4ade80;font-size:17px;">0 건</strong>' +
    '</div>' +
    '<div style="margin-bottom:8px;border-bottom:1px solid #334155;padding-bottom:6px;">' +
      '<div style="font-size:11px;color:#94a3b8;">현재 수집된 일시 / 작성자:</div>' +
      '<div id="hud_current_date" style="color:#facc15;font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">대기 중...</div>' +
    '</div>' +
    '<div style="margin-bottom:12px;font-size:11px;color:#cbd5e1;line-height:1.4;max-height:42px;overflow:hidden;text-overflow:ellipsis;" id="hud_info">게시글 본문(txtBody) 읽는 중...</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<button id="hud_btn_stop" style="flex:1;padding:8px 10px;background:#ef4444;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;">중단 및 저장</button>' +
      '<button id="hud_btn_save" style="flex:1;padding:8px 10px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;">지금 다운로드</button>' +
    '</div>';
  document.body.appendChild(hud);

  const postMap = new Map();
  let isRunning = true;

  const updateHud = (statusText, dateStr, previewMsg, isDone = false) => {
    const elBadge = document.getElementById('hud_status_badge');
    const elCount = document.getElementById('hud_post_count');
    const elDate = document.getElementById('hud_current_date');
    const elInfo = document.getElementById('hud_info');

    if (elCount) elCount.innerText = postMap.size + ' 건';
    if (elBadge && statusText) {
      elBadge.innerText = statusText;
      elBadge.style.background = isDone ? '#10b981' : '#0284c7';
    }
    if (elDate && dateStr) elDate.innerText = dateStr;
    if (elInfo && previewMsg) elInfo.innerText = previewMsg;
  };

  const triggerDownload = () => {
    if (postMap.size === 0) {
      alert('수집된 게시글이 없습니다.');
      return;
    }
    const allPosts = Array.from(postMap.values());
    const fullText = allPosts.join('\n\n');
    const blob = new Blob(['\uFEFF' + fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'band_dispatch_history_full.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    updateHud('완료', null, '✅ 총 ' + postMap.size + '건 파일 다운로드 완료!', true);
    console.log('🎉 [기연리프트] 총 ' + postMap.size + '건 다운로드 완료! (band_dispatch_history_full.txt)');
  };

  document.getElementById('hud_btn_stop')?.addEventListener('click', () => {
    isRunning = false;
    triggerDownload();
  });
  document.getElementById('hud_btn_save')?.addEventListener('click', () => {
    triggerDownload();
  });

  // 1. 상세 모달 레이어 확인
  const getDetailLayer = () => {
    return document.querySelector('.postDetailView, [data-viewname="DContentDetailLayerView"], .lyPostViewer, .cPostCard');
  };

  // 2. 현재 화면의 게시글 데이터 정밀 추출 (.txtBody 타겟)
  const extractCurrentPost = () => {
    const layer = getDetailLayer();
    if (!layer) return null;

    // A. 작성자 및 일시
    const authorWrap = layer.querySelector('[data-viewname="DPostAuthorView"], .postWriter');
    let author = '기연리프트';
    let dateStr = '';

    if (authorWrap) {
      const authorText = authorWrap.innerText || '';
      const dm = authorText.match(/(\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*(?:오전|오후)\s*\d{1,2}:\d{2})/);
      if (dm) dateStr = dm[1];

      const nameEl = authorWrap.querySelector('.name, strong, a.author, .author');
      if (nameEl && nameEl.innerText.trim()) {
        author = nameEl.innerText.trim();
      } else {
        const lines = authorText.split('\n').map(s => s.trim()).filter(Boolean);
        if (lines.length > 0 && !lines[0].includes('년') && !lines[0].includes('월')) {
          author = lines[0];
        }
      }
    }

    if (!dateStr) {
      const dm2 = layer.innerText.match(/(\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*(?:오전|오후)\s*\d{1,2}:\d{2})/);
      if (dm2) dateStr = dm2[1];
    }

    // B. 본문 요소: .postBody .txtBody 정확 타겟!
    const bodyEl = layer.querySelector('.postBody .txtBody, [data-viewname="DPostTextView"] .txtBody, .txtBody') ||
                   layer.querySelector('.postBody .postText, .postText');
    if (!bodyEl) return null;

    const bodyText = bodyEl.innerText.trim();
    if (!bodyText) return null;

    // C. 댓글 (출고 변경/추가 메모 보존)
    let commentsText = '';
    const commentNodes = layer.querySelectorAll('[data-viewname="DCommentItemView"], .comment_item, .uComment, .cCommentItem');
    if (commentNodes.length > 0) {
      const cLines = [];
      commentNodes.forEach(cn => {
        const cText = cn.innerText.trim().replace(/\n+/g, ' ');
        if (cText && !cText.includes('댓글을 남겨주세요') && !cText.includes('표정짓기')) {
          cLines.push('댓글: ' + cText);
        }
      });
      if (cLines.length > 0) {
        commentsText = '\n\n' + cLines.join('\n');
      }
    }

    // D. 표준 헤더 조립
    const headerLine = (dateStr || '일시미상') + ' 게시글';
    const fullText = headerLine + '\n' + author + '\n' + bodyText + commentsText;
    const signature = (dateStr || 'NODATE') + ' | ' + bodyText.slice(0, 40);

    return {
      date: dateStr || '일시미상',
      author,
      body: bodyText,
      fullText,
      signature
    };
  };

  // 3. 다음(>) 버튼 대기 탐색 (SPA 전환 중 일시 사라짐 대비 최대 timeoutMs 대기)
  const waitForNextButton = async (timeoutMs = 4000) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const btn = document.querySelector('button.btnNextPost, button._btnNextPost, [class*="btnNextPost"]');
      if (btn) {
        const isHidden = (btn.style.display === 'none') || (window.getComputedStyle(btn).display === 'none');
        const isDisabled = btn.disabled || btn.classList.contains('disabled') || btn.classList.contains('-disabled') || btn.getAttribute('aria-disabled') === 'true';
        if (!isHidden && !isDisabled) {
          return btn;
        }
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return null;
  };

  // 4. 다음(>) 버튼 마우스 이벤트 복합 클릭
  const clickNextButton = (btn) => {
    try {
      btn.scrollIntoView({ block: 'center' });
    } catch(e) {}

    const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const evType of eventTypes) {
      try {
        btn.dispatchEvent(new MouseEvent(evType, { bubbles: true, cancelable: true, view: window }));
      } catch (e) {}
    }
    try { btn.click(); } catch(e) {}

    const innerSpan = btn.querySelector('span, .gSrOnly');
    if (innerSpan) {
      try { innerSpan.click(); } catch(e) {}
    }
  };

  // 5. 화면이 다음 글로 실제로 바뀔 때까지 감시 (최대 maxWaitMs 대기)
  const waitForPostChange = async (oldSignature, maxWaitMs = 6000) => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, 200));
      const cur = extractCurrentPost();
      if (cur && cur.body.length > 0 && cur.signature !== oldSignature) {
        await new Promise(r => setTimeout(r, 300));
        return true;
      }
    }
    return false;
  };

  let step = 0;
  let consecutiveFailCount = 0;

  console.log('🔄 밴드 상세뷰 모달 순차 수집 시작...');

  while (isRunning && step < 4000) {
    step++;

    // 1. 현재 글 추출
    const post = extractCurrentPost();
    if (!post) {
      updateHud('대기 중', null, '게시글 본문(txtBody) 로딩 중...');
      await new Promise(r => setTimeout(r, 500));
      continue;
    }

    // 2. Map에 저장
    if (!postMap.has(post.signature) || post.fullText.length > (postMap.get(post.signature)?.length || 0)) {
      postMap.set(post.signature, post.fullText);
      console.log(`📦 [${postMap.size}건 수집] ${post.date} | ${post.author} | 본문길이: ${post.body.length}자`);
    }

    updateHud('수집 중', `${post.date} (${post.author})`, `[${postMap.size}건] ${post.body.slice(0, 35)}...`);

    // 3. 다음(>) 버튼 대기
    let nextBtn = await waitForNextButton(3500);
    if (!nextBtn) {
      await new Promise(r => setTimeout(r, 1000));
      nextBtn = await waitForNextButton(2000);
      if (!nextBtn) {
        console.log('🏁 다음(>) 버튼이 더 이상 없습니다. 마지막 글 도달 완료!');
        break;
      }
    }

    // 4. 다음(>) 버튼 클릭
    updateHud('로딩 중', `${post.date}`, `다음(>) 글 로딩 중...`);
    clickNextButton(nextBtn);

    // 5. 다음 글로 변경될 때까지 대기
    const changed = await waitForPostChange(post.signature, 5000);

    if (!changed) {
      console.warn('⚠️ 글 전환 지연 감지. 버튼 재클릭 시도...');
      const retryBtn = await waitForNextButton(2000);
      if (retryBtn) {
        clickNextButton(retryBtn);
        const retryChanged = await waitForPostChange(post.signature, 4000);
        if (!retryChanged) {
          consecutiveFailCount++;
          if (consecutiveFailCount >= 2) {
            console.log('🏁 2회 연속 글 변경 없음 -> 마지막 글 완료로 판정!');
            break;
          }
        } else {
          consecutiveFailCount = 0;
        }
      } else {
        console.log('🏁 다음 버튼 없음 -> 마지막 글 완료!');
        break;
      }
    } else {
      consecutiveFailCount = 0;
    }
  }

  console.log(`✅ 최종 수집 완료! 총 ${postMap.size}건 수집됨.`);
  triggerDownload();
})();
