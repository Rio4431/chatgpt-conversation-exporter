'use strict';

/**
 * 拡張機能アイコンがクリックされたとき、現在のタブへ印刷処理を注入します。
 * activeTab 権限を使うため、常時のサイト閲覧権限は要求しません。
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) {
    return;
  }

  const url = tab.url ?? '';
  const supported =
    url.startsWith('https://chatgpt.com/') ||
    url.startsWith('https://chat.openai.com/');

  try {
    if (!supported) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          window.alert(
            'ChatGPTの会話画面または共有画面を開いてから、拡張機能を実行してください。'
          );
        }
      });
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['print-chat.js']
    });
  } catch (error) {
    console.error('ChatGPT PDF Print:', error);

    // chrome:// など、スクリプトを注入できないページでは表示できない場合があります。
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (message) => window.alert(message),
        args: [
          '印刷処理を開始できませんでした。ページを再読み込みしてから、もう一度実行してください。'
        ]
      });
    } catch {
      // 注入そのものが禁止されているページでは何もしません。
    }
  }
});

// 印刷はChatGPTとは別の拡張機能ページで行う。
// service workerの停止後にも受け渡しできるよう、ブラウザ内のsession領域を使う。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'OPEN_PRINT_TAB') return;
  const url = sender.tab?.url || '';
  if (sender.id !== chrome.runtime.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url)) {
    sendResponse({ ok: false, error: '対応していない送信元です' });
    return;
  }
  (async () => {
    const payload = message.payload;
    if (!payload || typeof payload.html !== 'string' || typeof payload.css !== 'string' || typeof payload.title !== 'string') {
      throw new Error('会話データが不正です');
    }
    const token = crypto.randomUUID();
    const key = `pdf-job-${token}`;
    await chrome.storage.session.set({ [key]: payload });
    try {
      const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`print.html?id=${token}`) });
      await chrome.storage.session.set({ [`pdf-tab-${tab.id}`]: key });
    } catch (error) {
      await chrome.storage.session.remove(key);
      throw error;
    }
    sendResponse({ ok: true });
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const mapping = `pdf-tab-${tabId}`;
  const values = await chrome.storage.session.get(mapping);
  await chrome.storage.session.remove(values[mapping] ? [mapping, values[mapping]] : mapping);
});
