'use strict';
(async () => {
  const message = document.getElementById('message');
  const pdf = document.getElementById('pdf');
  const htmlButton = document.getElementById('html');
  try {
    const token = new URL(location.href).searchParams.get('id');
    if (!/^[0-9a-f-]{36}$/i.test(token || '')) throw new Error('印刷データの識別子がありません');
    const key = `pdf-job-${token}`;
    const stored = await chrome.storage.session.get(key);
    const payload = stored[key];
    if (!payload) throw new Error('会話データがありません。元の会話で拡張機能を実行し直してください');
    // 実行可能なタグやイベント属性を取り除いてから専用タブに移す。
    const template = document.createElement('template');
    template.innerHTML = payload.html;
    template.content.querySelectorAll('script, iframe, object, embed, link, meta, base, form').forEach(n => n.remove());
    for (const node of template.content.querySelectorAll('*')) {
      for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name) || attr.name === 'srcdoc') node.removeAttribute(attr.name);
      }
      for (const attr of ['href', 'src', 'xlink:href']) {
        if (/^\s*(javascript|vbscript):/i.test(node.getAttribute(attr) || '')) node.removeAttribute(attr);
      }
    }
    const root = template.content.querySelector('#chatgpt-pdf-print-root');
    if (!root?.querySelector('.print-turn-wrapper')) throw new Error('会話本文を検出できませんでした');
    const style = document.createElement('style');
    style.textContent = payload.css;
    document.head.appendChild(style);
    document.getElementById('conversation').appendChild(root);
    document.title = payload.title;
    const images = [...root.querySelectorAll('img')];
    images.forEach(img => img.loading = 'eager');
    await Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
      const timer = setTimeout(resolve, 5000);
      const done = () => { clearTimeout(timer); resolve(); };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    })));
    await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 5000))]);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const turns = root.querySelectorAll('.print-turn-wrapper').length;
    const imageWarning = images.some(img => !img.complete || img.naturalWidth === 0) ? ' 一部の画像を読み込めませんでした。' : '';
    message.textContent = `${turns}件の発言を収集しました。送信先を「PDFに保存」にしてください。${imageWarning}`;
    pdf.disabled = false;
    htmlButton.disabled = false;
    const doPrint = () => {
      if (root.getBoundingClientRect().height < 1) {
        message.textContent = '会話の表示を確認できません。タブを再読み込みしてください。';
        return;
      }
      window.print();
    };
    pdf.addEventListener('click', doPrint);
    htmlButton.addEventListener('click', () => {
      const title = document.createElement('title');
      title.textContent = payload.title;
      const doc = `<!doctype html><html lang="ja"><head><meta charset="utf-8">${title.outerHTML}<style>${payload.css}</style></head><body>${root.outerHTML}</body></html>`;
      const url = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${payload.title}.html`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
    });
    setTimeout(doPrint, 400);
  } catch (error) {
    message.textContent = `読み込みに失敗しました: ${error.message}`;
    console.error('ChatGPT PDF Print:', error);
  }
})();
