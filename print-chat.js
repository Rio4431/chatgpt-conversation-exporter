'use strict';

(async () => {
  const STYLE_ID = 'chatgpt-pdf-print-style';
  const PRINT_ROOT_ID = 'chatgpt-pdf-print-root';
  const STATUS_ID = 'chatgpt-pdf-print-status';
  const HIDE_ORIGINAL_CLASS = 'chatgpt-pdf-original-hidden';
  const LOCK_ATTRIBUTE = 'data-chatgpt-pdf-print-running';
  const MAX_SCAN_ITERATIONS = 200;

  // 二重実行防止
  if (document.documentElement.hasAttribute(LOCK_ATTRIBUTE)) {
    return;
  }
  document.documentElement.setAttribute(LOCK_ATTRIBUTE, '');

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  function nextPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  let statusEl = null;
  let printRootEl = null;
  let cleanedUp = false;
  let originalHiddenNodes = [];
  const originalDocumentTitle = document.title;

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;

    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('afterprint', onAfterPrint);

    document.title = originalDocumentTitle;
    document.documentElement.removeAttribute(LOCK_ATTRIBUTE);

    // 元の非表示にしたノードを再表示
    for (const node of originalHiddenNodes) {
      if (node && node.style) {
        node.style.display = node.getAttribute('data-original-display') || '';
        node.removeAttribute('data-original-display');
      }
    }
    originalHiddenNodes = [];

    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(STATUS_ID)?.remove();
    document.getElementById(PRINT_ROOT_ID)?.remove();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
    }
  }

  function onAfterPrint() {
    updateStatus(statusEl, '保存処理が完了しました。画面上のボタンからHTML/PDFの再保存や、Escキーで画面復元ができます。', true);
  }

  /**
   * スタンドアロンHTMLファイルとしてダウンロード保存
   */
  function downloadHtmlFile(filename, rootEl) {
    if (!rootEl) return;
    const styleEl = document.getElementById(STYLE_ID);
    const styleContent = styleEl ? styleEl.textContent : '';

    const htmlDoc = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(filename)}</title>
<style>
${styleContent}
body {
  background: #f1f5f9 !important;
  margin: 0 !important;
  padding: 30px 16px !important;
}
#${PRINT_ROOT_ID} {
  margin: 0 auto !important;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08) !important;
}
@media print {
  body {
    background: #ffffff !important;
    padding: 0 !important;
  }
}
</style>
</head>
<body>
${rootEl.outerHTML}
</body>
</html>`;

    const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.html`;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function escapeHtml(text) {
    const span = document.createElement('span');
    span.textContent = text;
    return span.innerHTML;
  }

  function reportPrintError(error) {
    updateStatus(statusEl, `PDF用タブを開けませんでした: ${error.message}。保存済みHTMLをChromeで開き、Ctrl+PでもPDF保存できます。`, true);
  }

  async function openPrintTab() {
    if (!printRootEl?.querySelector('.print-turn-wrapper')) throw new Error('会話がありません');
    const result = await chrome.runtime.sendMessage({
      type: 'OPEN_PRINT_TAB',
      payload: {
        title: document.title,
        html: printRootEl.outerHTML,
        css: document.getElementById(STYLE_ID)?.textContent || ''
      }
    });
    if (!result?.ok) throw new Error(result?.error || '拡張機能を再読み込みしてください');
    updateStatus(statusEl, '会話専用の印刷タブを開きました。PDFプレビューが自動で開かない場合は、そのタブの「PDF保存」を押してください。', true);
  }

  function createStatus() {
    document.getElementById(STATUS_ID)?.remove();
    const status = document.createElement('div');
    status.id = STATUS_ID;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const msgSpan = document.createElement('span');
    msgSpan.className = 'status-msg';
    msgSpan.textContent = '会話履歴の収集準備中…';
    status.appendChild(msgSpan);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'status-btn-group';

    // 1. 両方保存ボタン
    const bothBtn = document.createElement('button');
    bothBtn.className = 'status-both-btn';
    bothBtn.textContent = '両方保存 (HTML+PDF)';
    bothBtn.title = 'HTMLファイルを保存し、PDF印刷ダイアログを開きます';
    bothBtn.style.display = 'none';
    bothBtn.onclick = (e) => {
      e.preventDefault();
      const currentTitle = document.title || safeFileTitle(getConversationTitle());
      downloadHtmlFile(currentTitle, printRootEl);
      window.setTimeout(() => {
        openPrintTab().catch(reportPrintError);
      }, 300);
    };
    btnGroup.appendChild(bothBtn);

    // 2. HTML保存ボタン
    const htmlBtn = document.createElement('button');
    htmlBtn.className = 'status-html-btn';
    htmlBtn.textContent = 'HTML保存';
    htmlBtn.title = '完全なスタンドアロンHTMLファイルをダウンロード保存します';
    htmlBtn.style.display = 'none';
    htmlBtn.onclick = (e) => {
      e.preventDefault();
      const currentTitle = document.title || safeFileTitle(getConversationTitle());
      downloadHtmlFile(currentTitle, printRootEl);
      updateStatus(statusEl, 'HTMLファイルを保存しました。', true);
    };
    btnGroup.appendChild(htmlBtn);

    // 3. PDF保存ボタン
    const printAgainBtn = document.createElement('button');
    printAgainBtn.className = 'status-print-btn';
    printAgainBtn.textContent = 'PDF保存';
    printAgainBtn.title = 'Chrome印刷ダイアログ（PDFに保存）を開きます';
    printAgainBtn.style.display = 'none';
    printAgainBtn.onclick = (e) => {
      e.preventDefault();
      openPrintTab().catch(reportPrintError);
    };
    btnGroup.appendChild(printAgainBtn);

    // 4. 閉じるボタン
    const closeBtn = document.createElement('button');
    closeBtn.className = 'status-close-btn';
    closeBtn.textContent = '画面を元に戻す (Esc)';
    closeBtn.title = '元のChatGPT画面に戻します';
    closeBtn.onclick = (e) => {
      e.preventDefault();
      cleanup();
    };
    btnGroup.appendChild(closeBtn);

    status.appendChild(btnGroup);
    document.body.appendChild(status);

    window.addEventListener('keydown', onKeyDown);
    return status;
  }

  function updateStatus(status, message, showActionBtns = false) {
    if (status?.isConnected) {
      const msgSpan = status.querySelector('.status-msg');
      if (msgSpan) {
        msgSpan.textContent = message;
      }
      const btns = status.querySelectorAll('.status-both-btn, .status-html-btn, .status-print-btn');
      btns.forEach((btn) => {
        btn.style.display = showActionBtns ? 'inline-block' : 'none';
      });
    }
  }

  function getConversationTitle() {
    const pageTitle = document.title
      .replace(/\s*[|–—-]\s*ChatGPT.*$/i, '')
      .replace(/^ChatGPT\s*[|–—-]?\s*/i, '')
      .trim();

    if (pageTitle && !/^chatgpt$/i.test(pageTitle) && !/^new chat$/i.test(pageTitle)) {
      return pageTitle;
    }

    const headings = [...document.querySelectorAll('h1, h2, [data-testid="conversation-title"]')]
      .map((el) => el.textContent?.trim() ?? '')
      .filter((txt) => txt && !/^chatgpt$/i.test(txt) && !/^new chat$/i.test(txt));

    if (headings.length > 0) {
      return headings[0];
    }

    return 'ChatGPT 会話ログ';
  }

  function safeFileTitle(title) {
    return title
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  function addStyles() {
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* 常駐操作バー */
      #${STATUS_ID} {
        position: fixed !important;
        z-index: 2147483647 !important;
        top: 16px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        padding: 10px 18px !important;
        border-radius: 8px !important;
        color: #ffffff !important;
        background: rgba(24, 24, 27, 0.96) !important;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4) !important;
        font: 13.5px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        text-align: center !important;
        display: flex !important;
        align-items: center !important;
        gap: 14px !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
      }

      #${STATUS_ID} .status-btn-group {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
      }

      #${STATUS_ID} .status-both-btn {
        background: #2563eb !important;
        color: #ffffff !important;
        border: none !important;
        padding: 5px 12px !important;
        border-radius: 5px !important;
        font-size: 12.5px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
      }
      #${STATUS_ID} .status-both-btn:hover {
        background: #1d4ed8 !important;
      }

      #${STATUS_ID} .status-html-btn {
        background: #0284c7 !important;
        color: #ffffff !important;
        border: none !important;
        padding: 5px 12px !important;
        border-radius: 5px !important;
        font-size: 12.5px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
      }
      #${STATUS_ID} .status-html-btn:hover {
        background: #0369a1 !important;
      }

      #${STATUS_ID} .status-print-btn {
        background: #10a37f !important;
        color: #ffffff !important;
        border: none !important;
        padding: 5px 12px !important;
        border-radius: 5px !important;
        font-size: 12.5px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
      }
      #${STATUS_ID} .status-print-btn:hover {
        background: #0e8a6c !important;
      }

      #${STATUS_ID} .status-close-btn {
        background: #ef4444 !important;
        color: #ffffff !important;
        border: none !important;
        padding: 5px 12px !important;
        border-radius: 5px !important;
        font-size: 12.5px !important;
        font-weight: 500 !important;
        cursor: pointer !important;
      }
      #${STATUS_ID} .status-close-btn:hover {
        background: #dc2626 !important;
      }

      /* 画面上での印刷プレビューコンテナ */
      #${PRINT_ROOT_ID} {
        display: block !important;
        position: relative !important;
        width: 100% !important;
        max-width: 900px !important;
        margin: 60px auto 40px auto !important;
        padding: 24px 32px !important;
        background: #ffffff !important;
        color: #111111 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        font-size: 13.5px !important;
        line-height: 1.65 !important;
        border-radius: 8px !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08) !important;
        box-sizing: border-box !important;
      }

      #${PRINT_ROOT_ID} * {
        box-sizing: border-box !important;
      }

      #${PRINT_ROOT_ID} .print-page-title {
        font-size: 22px !important;
        font-weight: 700 !important;
        margin-bottom: 24px !important;
        padding-bottom: 12px !important;
        border-bottom: 2px solid #333333 !important;
        color: #111111 !important;
        page-break-after: avoid !important;
        break-after: avoid !important;
      }

      #${PRINT_ROOT_ID} .print-turn-wrapper {
        margin-bottom: 24px !important;
        padding: 14px 18px !important;
        border-radius: 6px !important;
        page-break-inside: auto !important;
        break-inside: auto !important;
      }

      #${PRINT_ROOT_ID} .print-turn-user {
        background-color: #f8fafc !important;
        border: 1px solid #cbd5e1 !important;
        border-left: 4px solid #2563eb !important;
      }

      #${PRINT_ROOT_ID} .print-turn-assistant {
        background-color: #ffffff !important;
        border: 1px solid #e2e8f0 !important;
        border-left: 4px solid #10a37f !important;
      }

      #${PRINT_ROOT_ID} .print-role-header {
        margin-bottom: 8px !important;
        padding-bottom: 5px !important;
        border-bottom: 1px dashed #e2e8f0 !important;
        page-break-after: avoid !important;
        break-after: avoid !important;
      }

      #${PRINT_ROOT_ID} .print-role-badge {
        font-weight: 700 !important;
        font-size: 12px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
      }

      #${PRINT_ROOT_ID} .print-turn-user .print-role-badge {
        color: #2563eb !important;
      }

      #${PRINT_ROOT_ID} .print-turn-assistant .print-role-badge {
        color: #10a37f !important;
      }

      #${PRINT_ROOT_ID} .print-turn-content {
        margin-top: 6px !important;
        word-break: break-word !important;
        color: #111111 !important;
      }
      #${PRINT_ROOT_ID} [class*="whitespace-pre-wrap"],
      #${PRINT_ROOT_ID} [data-message-author-role="user"] {
        white-space: pre-wrap;
      }

      /* DIL / リッチレンダラーの強制可視化 */
      #${PRINT_ROOT_ID} [class*="Reveal"],
      #${PRINT_ROOT_ID} [class*="DilRenderer"],
      #${PRINT_ROOT_ID} [class*="DilResponseRoot"],
      #${PRINT_ROOT_ID} [data-d-inline-reveal] {
        opacity: 1 !important;
        visibility: visible !important;
        display: block !important;
        max-height: none !important;
      }

      #${PRINT_ROOT_ID} [style*="max-height"] {
        max-height: none !important;
        overflow: visible !important;
      }

      /* ダークモード文字色の上書き解除 */
      #${PRINT_ROOT_ID} p,
      #${PRINT_ROOT_ID} span:not([class*="katex"]),
      #${PRINT_ROOT_ID} div,
      #${PRINT_ROOT_ID} li {
        color: #111111 !important;
      }

      /* コードブロック */
      #${PRINT_ROOT_ID} pre {
        background-color: #f8fafc !important;
        color: #1e293b !important;
        border: 1px solid #cbd5e1 !important;
        padding: 12px 16px !important;
        border-radius: 6px !important;
        white-space: pre-wrap !important;
        word-break: break-all !important;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
        font-size: 12px !important;
        line-height: 1.55 !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        margin: 12px 0 !important;
      }

      #${PRINT_ROOT_ID} code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
        font-size: 12px !important;
        background-color: #f1f5f9 !important;
        color: #0f172a !important;
        padding: 2px 4px !important;
        border-radius: 4px !important;
      }

      #${PRINT_ROOT_ID} pre code {
        background-color: transparent !important;
        padding: 0 !important;
        color: inherit !important;
      }

      /* テーブル */
      #${PRINT_ROOT_ID} table {
        width: 100% !important;
        border-collapse: collapse !important;
        margin: 14px 0 !important;
        font-size: 12.5px !important;
        page-break-inside: auto !important;
        break-inside: auto !important;
      }

      #${PRINT_ROOT_ID} tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }

      #${PRINT_ROOT_ID} th,
      #${PRINT_ROOT_ID} td {
        border: 1px solid #cbd5e1 !important;
        padding: 8px 12px !important;
        text-align: left !important;
        vertical-align: top !important;
        color: #111111 !important;
      }

      #${PRINT_ROOT_ID} th {
        background-color: #f1f5f9 !important;
        font-weight: 600 !important;
      }

      /* 画像 */
      #${PRINT_ROOT_ID} img {
        max-width: 100% !important;
        height: auto !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        margin: 10px 0 !important;
        border-radius: 4px !important;
      }

      /* 引用・見出し */
      #${PRINT_ROOT_ID} blockquote {
        border-left: 3px solid #94a3b8 !important;
        margin: 10px 0 !important;
        padding-left: 14px !important;
        color: #475569 !important;
      }

      #${PRINT_ROOT_ID} h1, #${PRINT_ROOT_ID} h2, #${PRINT_ROOT_ID} h3,
      #${PRINT_ROOT_ID} h4, #${PRINT_ROOT_ID} h5, #${PRINT_ROOT_ID} h6 {
        color: #0f172a !important;
        margin-top: 16px !important;
        margin-bottom: 8px !important;
        page-break-after: avoid !important;
        break-after: avoid !important;
      }

      /* 数式（KaTeX）の表示保護 */
      #${PRINT_ROOT_ID} .katex,
      #${PRINT_ROOT_ID} .katex-display {
        color: #111111 !important;
      }

      @page {
        size: A4 portrait;
        margin: 12mm 12mm 15mm 12mm;
      }

      @media print {
        /* 印刷時のリセット */
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          height: auto !important;
          min-height: auto !important;
          max-height: none !important;
          overflow: visible !important;
          position: static !important;
          background: #ffffff !important;
          color: #111111 !important;
        }

        #${STATUS_ID} {
          display: none !important;
        }

        #${PRINT_ROOT_ID} {
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          box-shadow: none !important;
          border-radius: 0 !important;
          overflow: visible !important;
        }

        /* 印刷時の改ページ切れ防止：flex要素の解除 */
        #${PRINT_ROOT_ID} [class*="flex-col"],
        #${PRINT_ROOT_ID} [class*="DilRenderer"] {
          display: block !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function findChatScrollContainer() {
    // 1. 最新の明確なタイムラインスクロールコンテナ
    const timelineEl = document.querySelector('[data-app-action-timeline-scroll], .thread-scroll-container');
    if (timelineEl) {
      return timelineEl;
    }

    // 2. 会話要素の親を辿る（新旧セレクタ双方対応）
    const sampleEl = document.querySelector(
      'article, [data-content-search-unit-key], [data-message-author-role], [data-testid^="conversation-turn-"], [class*="MarkdownRoot"], .markdown'
    );
    if (sampleEl) {
      let cur = sampleEl.parentElement;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        const style = window.getComputedStyle(cur);
        if (/(auto|scroll)/.test(style.overflowY) && cur.scrollHeight > cur.clientHeight) {
          return cur;
        }
        cur = cur.parentElement;
      }
    }

    // 3. main要素内のスクロールコンテナ（サイドバーnavを除外）
    const mainEl = document.querySelector('main');
    if (mainEl) {
      const candidates = [...mainEl.querySelectorAll('div')].filter((el) => {
        const style = window.getComputedStyle(el);
        return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 40;
      });
      if (candidates.length > 0) {
        candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
        return candidates[0];
      }
      const mainStyle = window.getComputedStyle(mainEl);
      if (/(auto|scroll)/.test(mainStyle.overflowY) && mainEl.scrollHeight > mainEl.clientHeight) {
        return mainEl;
      }
    }

    // 4. フォールバック: nav, aside を除外して探索
    const allDivs = [...document.querySelectorAll('div')].filter((el) => {
      if (el.closest('nav, aside, [role="navigation"]')) return false;
      const style = window.getComputedStyle(el);
      return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 40;
    });
    if (allDivs.length > 0) {
      allDivs.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
      return allDivs[0];
    }

    return document.scrollingElement || document.documentElement;
  }

  function getScroller(el) {
    const isDoc = el === document.scrollingElement || el === document.documentElement || el === document.body;
    const style = isDoc ? null : window.getComputedStyle(el);
    const isReverse = style ? style.flexDirection === 'column-reverse' : false;

    return {
      isReverse,
      getTop: () => (isDoc ? window.scrollY : el.scrollTop),
      getViewport: () => (isDoc ? window.innerHeight : el.clientHeight),
      getMaxTop: () => {
        if (isDoc) return document.documentElement.scrollHeight - window.innerHeight;
        return el.scrollHeight - el.clientHeight;
      },
      setTop: (val) => {
        if (isDoc) {
          window.scrollTo({ top: Math.max(0, val), behavior: 'instant' });
        } else {
          el.scrollTop = val;
          el.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
      }
    };
  }

  /**
   * 最新UIと旧UIの両方に対応した高精度ロール検出
   */
  function detectRole(el) {
    // 1. data-content-search-unit-key や data-chatgpt-search-unit-key (最新UIで最も確実)
    const unitKey = el.getAttribute('data-content-search-unit-key') ||
                    el.getAttribute('data-chatgpt-search-unit-key') ||
                    el.closest('[data-content-search-unit-key]')?.getAttribute('data-content-search-unit-key') ||
                    el.closest('[data-chatgpt-search-unit-key]')?.getAttribute('data-chatgpt-search-unit-key') ||
                    '';
    if (/:user\b/i.test(unitKey)) return 'user';
    if (/:assistant\b/i.test(unitKey)) return 'assistant';

    // 2. data-conversation-role
    const convRole = el.getAttribute('data-conversation-role') ||
                     el.querySelector('[data-conversation-role]')?.getAttribute('data-conversation-role');
    if (convRole === 'user') return 'user';
    if (convRole === 'assistant') return 'assistant';

    // 3. direct or child data-message-author-role (旧UI)
    const directRole = el.getAttribute('data-message-author-role');
    if (directRole === 'user') return 'user';
    if (directRole === 'assistant') return 'assistant';

    const childRole = el.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');
    if (childRole === 'user') return 'user';
    if (childRole === 'assistant') return 'assistant';

    // 4. クラス名や属性による識別
    if (el.querySelector('[data-user-message-bubble="true"], [data-markdown-text-tone="user-message"], .rich-text-user-turn')) {
      return 'user';
    }
    if (el.closest('.group\\/user-message') || el.matches('.group\\/user-message')) {
      return 'user';
    }
    if (el.querySelector('[data-markdown-text-style="assistant-message"], [class*="DilRenderer"], [class*="DilResponseRoot"]')) {
      return 'assistant';
    }

    // 5. 発言者ヘッダーのテキスト判定
    const headerText = el.querySelector('h4, h5')?.innerText ?? '';
    if (/あなたの発言/i.test(headerText)) return 'user';
    if (/ChatGPT\s*の(?:発言|応答)/i.test(headerText)) return 'assistant';

    const testId = (el.getAttribute('data-testid') || '') + ' ' + (el.className || '');
    if (/user/i.test(testId)) return 'user';
    if (/assistant|agent|gpt/i.test(testId)) return 'assistant';

    if (el.querySelector('[data-testid="user-avatar"], img[alt*="User"], img[alt*="ユーザー"]')) {
      return 'user';
    }

    return 'assistant';
  }

  /**
   * 現在画面に表示されているメッセージターン要素（ユーザー＆アシスタント）を完全網羅して抽出
   */
  function getCurrentVisibleTurns() {
    // 優先順位1: 最新UIのユニット要素 [data-content-search-unit-key] または [data-chatgpt-search-unit-key]
    const unitKeys = [...document.querySelectorAll('[data-content-search-unit-key], [data-chatgpt-search-unit-key]')].filter((el) => {
      if (el.closest(`#${PRINT_ROOT_ID}, #${STATUS_ID}`)) return false;
      const key = el.getAttribute('data-content-search-unit-key') || el.getAttribute('data-chatgpt-search-unit-key') || '';
      if (!/:(?:user|assistant)\b/i.test(key)) return false;
      return (el.innerText?.trim()?.length > 0) || el.querySelector('img, canvas');
    });
    if (unitKeys.length > 0) {
      return unitKeys.filter((el) => !unitKeys.some((other) => other !== el && other.contains(el)));
    }

    // 優先順位2: article (標準ターン要素)
    const articles = [...document.querySelectorAll('article')].filter((el) => {
      if (el.closest(`#${PRINT_ROOT_ID}, #${STATUS_ID}`)) return false;
      return (el.innerText?.trim()?.length > 0) || el.querySelector('img, canvas');
    });
    if (articles.length > 0) {
      return articles;
    }

    // 優先順位3: [data-testid^="conversation-turn-"]
    const testTurns = [...document.querySelectorAll('[data-testid^="conversation-turn-"]')].filter((el) => {
      if (el.closest(`#${PRINT_ROOT_ID}, #${STATUS_ID}`)) return false;
      return (el.innerText?.trim()?.length > 0) || el.querySelector('img, canvas');
    });
    if (testTurns.length > 0) {
      return testTurns;
    }

    // 優先順位4: [data-message-author-role]
    const roleEls = [...document.querySelectorAll('[data-message-author-role]')].filter((el) => {
      if (el.closest(`#${PRINT_ROOT_ID}, #${STATUS_ID}`)) return false;
      return (el.innerText?.trim()?.length > 0) || el.querySelector('img, canvas');
    });
    if (roleEls.length > 0) {
      return roleEls.filter((el) => !roleEls.some((other) => other !== el && other.contains(el)));
    }

    // 優先順位5: 最新DILコンポーネント・MarkdownRoot・whitespace-pre-wrap の包括探索
    const messageBodys = [...document.querySelectorAll(
      '[class*="MarkdownRoot"], [class*="DilRenderer"], [data-dil-source-message-id], .markdown, [class*="prose"], div[class*="whitespace-pre-wrap"]'
    )].filter((el) => !el.closest(`#${PRINT_ROOT_ID}, #${STATUS_ID}`));

    if (messageBodys.length > 0) {
      const resolved = messageBodys.map((mb) => {
        let cur = mb;
        while (cur.parentElement && cur.parentElement !== document.body && cur.parentElement.tagName.toLowerCase() !== 'main') {
          if (cur.parentElement.children.length > 1) return cur;
          cur = cur.parentElement;
        }
        return mb;
      });
      return [...new Set(resolved)].filter((el) => !resolved.some((other) => other !== el && other.contains(el)));
    }

    return [];
  }

  function getTurnId(el) {
    // 1. data-content-search-unit-key (最新UIの一意キー)
    const unitKey = el.getAttribute('data-content-search-unit-key') ||
                    el.getAttribute('data-chatgpt-search-unit-key') ||
                    el.querySelector('[data-content-search-unit-key]')?.getAttribute('data-content-search-unit-key');
    if (unitKey) return `unit-${unitKey}`;

    // 2. data-message-id or data-dil-source-message-id (UUID)
    const msgId = el.getAttribute('data-message-id') ||
                  el.getAttribute('data-dil-source-message-id') ||
                  el.querySelector('[data-message-id]')?.getAttribute('data-message-id') ||
                  el.querySelector('[data-dil-source-message-id]')?.getAttribute('data-dil-source-message-id');
    if (msgId) return `msg-${msgId}`;

    // 3. data-testid
    const testId = el.getAttribute('data-testid') ||
                   el.closest('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid');
    if (testId && testId.startsWith('conversation-turn-')) return testId;

    // 4. id
    if (el.id && el.id !== PRINT_ROOT_ID) return `id-${el.id}`;

    // 5. コンテンツベースの複合識別子
    const role = detectRole(el);
    const text = el.innerText?.trim() ?? '';
    const imgUrls = [...el.querySelectorAll('img')].map((i) => i.src).join('|');
    const snippet = text.slice(0, 100) + '___' + text.slice(-100);
    return `hash-${role}-${text.length}-${imgUrls}-${snippet}`;
  }

  function sanitizeAndClone(el) {
    const clone = el.cloneNode(true);
    const role = detectRole(el);

    // 【重要】長文プロンプト等の max-height / overflow-hidden のインラインスタイルを全解除
    clone.querySelectorAll('[style*="max-height"], [class*="overflow-hidden"]').forEach((box) => {
      box.style.maxHeight = 'none';
      box.style.overflow = 'visible';
    });
    if (clone.style?.maxHeight) {
      clone.style.maxHeight = 'none';
      clone.style.overflow = 'visible';
    }

    // 【重要】本文を含むコンテナを巻き込んで削除しない安全なボタン・UI除去
    clone.querySelectorAll('button, [role="button"], [data-testid*="action"], [data-testid*="copy"], [data-testid*="edit"]').forEach((btn) => {
      const hasContentBlock = btn.querySelector('p, pre, code, .markdown, [class*="prose"], table, ul, ol, h1, h2, h3, h4');
      if (hasContentBlock || (btn.innerText?.trim()?.length ?? 0) > 30) {
        btn.removeAttribute('role');
        btn.removeAttribute('tabindex');
        return;
      }
      btn.remove();
    });

    // スクリプトや不要なタグ、非表示タグを削除
    clone.querySelectorAll('script, style, noscript, input, textarea, .sr-only').forEach((n) => n.remove());

    // canvas を画像に変換
    const originalCanvases = [...el.querySelectorAll('canvas')];
    const cloneCanvases = [...clone.querySelectorAll('canvas')];
    cloneCanvases.forEach((cvs, idx) => {
      const orig = originalCanvases[idx];
      if (orig) {
        try {
          const img = document.createElement('img');
          img.src = orig.toDataURL('image/png');
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          cvs.parentNode?.replaceChild(img, cvs);
        } catch {
          // CORS等で失敗した場合はスキップ
        }
      }
    });

    // 画像URLの固定化と遅延読み込み解除
    const originalImgs = [...el.querySelectorAll('img')];
    const cloneImgs = [...clone.querySelectorAll('img')];
    cloneImgs.forEach((img, idx) => {
      const orig = originalImgs[idx];
      if (orig) {
        img.src = orig.currentSrc || orig.src;
        img.removeAttribute('loading');
        img.removeAttribute('srcset');
      }
    });

    // 数式はKaTeX専用の外部CSS/フォントに依存しないネイティブMathMLにする。
    clone.querySelectorAll('.katex').forEach(katex => {
      const math = katex.querySelector('math');
      if (math) katex.replaceWith(math.cloneNode(true));
    });

    // 移植先ではサイトのCSSはない。本文の折り畳み・不可視指定を解除。
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
      for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name) || attr.name === 'srcdoc') node.removeAttribute(attr.name);
      }
      for (const attr of ['href', 'src', 'xlink:href', 'action']) {
        if (/^\s*(javascript|vbscript):/i.test(node.getAttribute(attr) || '')) node.removeAttribute(attr);
      }
      node.removeAttribute('hidden');
      node.style?.removeProperty('content-visibility');
      node.style?.removeProperty('contain');
      if (!node.closest('.katex')) {
        for (const prop of ['height', 'max-height', 'overflow', 'overflow-y', 'position', 'transform', 'display', 'visibility', 'opacity']) node.style?.removeProperty(prop);
      }
      if (node.matches('a[href]')) node.setAttribute('href', new URL(node.getAttribute('href'), location.href).href);
    }
    clone.querySelectorAll('iframe, object, embed, link, meta, base, form').forEach(n => n.remove());
    clone.querySelectorAll('details').forEach(n => n.open = true);

    const wrapper = document.createElement('div');
    wrapper.className = `print-turn-wrapper print-turn-${role}`;

    const roleHeader = document.createElement('div');
    roleHeader.className = 'print-role-header';

    const roleBadge = document.createElement('span');
    roleBadge.className = 'print-role-badge';
    roleBadge.textContent = role === 'user' ? 'ユーザー (Prompt)' : 'ChatGPT';

    roleHeader.appendChild(roleBadge);
    wrapper.appendChild(roleHeader);

    const contentBody = document.createElement('div');
    contentBody.className = 'print-turn-content';
    contentBody.appendChild(clone);
    wrapper.appendChild(contentBody);

    return wrapper;
  }

  async function waitForImages(container) {
    const imgs = [...container.querySelectorAll('img')];
    if (imgs.length === 0) return;

    const promises = imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        window.setTimeout(resolve, 3000);
      });
    });

    await Promise.all(promises);
  }

  try {
    addStyles();
    statusEl = createStatus();

    const scrollContainer = findChatScrollContainer();
    const scroller = getScroller(scrollContainer);

    // 収集用: 順序付き配列 + 重複検出Set
    const collectedOrder = [];
    const seenIds = new Map();

    function harvestCurrentView() {
      const turns = getCurrentVisibleTurns();
      for (const turn of turns) {
        const id = getTurnId(turn);
        const wrapper = sanitizeAndClone(turn);
        if (!wrapper) continue;
        if (!seenIds.has(id)) {
          seenIds.set(id, collectedOrder.length);
          collectedOrder.push({ id, wrapper });
        } else {
          const item = collectedOrder[seenIds.get(id)];
          if (wrapper.textContent.length >= item.wrapper.textContent.length) item.wrapper = wrapper;
        }
      }
    }

    // DOMに2件以上あっても、仮想スクロールで過去ログが省略される。
    // 先頭へ移動後、必ず全体を走査して時系列で収集する。
    updateStatus(statusEl, '会話の先頭を読み込んでいます…');
    const initialScrollTop = scroller.getTop();
    const startTop = () => scroller.isReverse ? -Math.max(0, scroller.getMaxTop()) : 0;
    for (let i = 0; i < 10; i++) {
      scroller.setTop(startTop());
      await sleep(250);
      await nextPaint();
      if (Math.abs(scroller.getTop() - startTop()) < 2) {
        const oldMax = scroller.getMaxTop();
        await sleep(250);
        if (Math.abs(oldMax - scroller.getMaxTop()) < 2) break;
      }
    }
    let endReached = false;
    let stableEnd = 0;
    for (let i = 0; i < MAX_SCAN_ITERATIONS; i++) {
      harvestCurrentView();
      updateStatus(statusEl, `会話を収集中: ${collectedOrder.length}件のメッセージ`);
      const top = scroller.getTop();
      const endTop = scroller.isReverse ? 0 : Math.max(0, scroller.getMaxTop());
      if (Math.abs(top - endTop) < 2) {
        stableEnd++;
        if (stableEnd >= 3) { endReached = true; break; }
      } else {
        stableEnd = 0;
      }
      scroller.setTop(Math.min(endTop, top + Math.max(200, scroller.getViewport() * 0.75)));
      await sleep(180);
      await nextPaint();
    }
    scroller.setTop(initialScrollTop);
    if (!endReached) {
      throw new Error('走査上限に達したため、全件収集を確認できません。会話を分割するか、MAX_SCAN_ITERATIONSを増やしてください。');
    }

    // 最終回収
    harvestCurrentView();
    updateStatus(statusEl, `収集完了: 計${collectedOrder.length}件のメッセージ`);

    if (collectedOrder.length === 0) {
      throw new Error('会話メッセージを検出できませんでした。');
    }

    // 印刷用コンテナの構築
    document.getElementById(PRINT_ROOT_ID)?.remove();
    printRootEl = document.createElement('div');
    printRootEl.id = PRINT_ROOT_ID;

    const titleText = getConversationTitle();
    const heading = document.createElement('div');
    heading.className = 'print-page-title';
    heading.textContent = titleText;
    printRootEl.appendChild(heading);

    // 収集したメッセージを追加
    for (const item of collectedOrder) {
      printRootEl.appendChild(item.wrapper);
    }

    // 元のChatGPTの既存UI要素を一時的に非表示にして、印刷用プレビューをマウント
    const bodyChildren = [...document.body.children];
    originalHiddenNodes = [];
    for (const child of bodyChildren) {
      if (child.id !== STATUS_ID && child.id !== STYLE_ID) {
        child.setAttribute('data-original-display', child.style.display || '');
        child.style.display = 'none';
        originalHiddenNodes.push(child);
      }
    }

    document.body.appendChild(printRootEl);

    // 画像の読み込み完了を待機
    updateStatus(statusEl, '画像の読み込みを確認しています…');
    await waitForImages(printRootEl);

    await nextPaint();
    await sleep(200);

    const date = new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date()).replaceAll('/', '-');

    const fileBaseName = `${safeFileTitle(titleText)}_${date}`;
    document.title = fileBaseName;

    // 自動でHTMLファイルを保存（ダウンロード）
    downloadHtmlFile(fileBaseName, printRootEl);

    window.addEventListener('afterprint', onAfterPrint);
    updateStatus(statusEl, 'HTMLを保存しました。続けてPDF印刷プレビューを開きます… (画面上のボタンからいつでも個別に再保存可能)', true);
    await sleep(400);

    // 印刷ダイアログの表示（PDF保存）
    await openPrintTab().catch(reportPrintError);

  } catch (error) {
    console.error('ChatGPT PDF Print:', error);
    cleanup();
    window.alert(
      `${error instanceof Error ? error.message : '印刷処理に失敗しました。'}\n` +
      'ページを再読み込みしてから、もう一度お試しください。'
    );
  }
})();
