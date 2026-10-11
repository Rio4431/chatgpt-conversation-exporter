const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const base = require('node:path').resolve(__dirname, '..') + '/';
function setup(dom) {
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  w.requestAnimationFrame = cb => w.setTimeout(cb, 0);
  const setTimeout = w.setTimeout.bind(w);
  w.setTimeout = (cb, ms, ...args) => setTimeout(cb, Math.min(ms, 1), ...args);
  w.URL.createObjectURL = () => 'blob:mock';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.alert = text => { throw Error(text); };
  return w;
}
async function waitFor(fn) {
  for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error('Timed out');
}
async function exportFixture(reverse = false) {
  const dom = new JSDOM('<!doctype html><title>Study &lt;/title&gt; notes</title><main><div class="thread-scroll-container"></div></main>', { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only' });
  const w = setup(dom);
  const timeline = w.document.querySelector('.thread-scroll-container');
  let top = reverse ? 0 : 1800;
  function render() {
    const index = Math.floor((reverse ? top + 1800 : top) / 100);
    timeline.innerHTML = '';
    for (let i = Math.max(0,index-1); i <= Math.min(19,index+2); i++) {
      const article = w.document.createElement('article');
      article.setAttribute('data-testid', `conversation-turn-${i}`);
      article.setAttribute('data-message-author-role', i % 2 ? 'assistant' : 'user');
      article.innerHTML = `<div class="whitespace-pre-wrap" style="max-height:19lh;overflow:hidden">Message ${i}<p>Paragraph ${i}</p>${i === 1 ? '<span class="katex"><span class="katex-mathml"><math><msup><mi>x</mi><mn>2</mn></msup></math></span><span class="katex-html">duplicated x2</span></span>' : ''}</div>`;
      timeline.appendChild(article);
    }
  }
  timeline.style.flexDirection = reverse ? 'column-reverse' : 'column';
  Object.defineProperties(timeline, {
    scrollHeight: { get: () => 2000 }, clientHeight: { get: () => 200 },
    scrollTop: { get: () => top, set: val => { top = Math.max(reverse ? -1800 : 0,Math.min(reverse ? 0 : 1800,val)); render(); } }
  });
  render();
  let request;
  w.chrome = { runtime: { async sendMessage(message) { request = message; return { ok: true }; } } };
  w.print = () => { throw Error('Must not print source site'); };
  w.eval(fs.readFileSync(base + 'print-chat.js','utf8'));
  await waitFor(() => request);
  return { dom, request, top };
}
test('whole source script exports every prompt/answer in order, converts math, and restores UI', async () => {
  const {dom,request,top} = await exportFixture();
  const doc = new JSDOM(request.payload.html).window.document;
  const turns = [...doc.querySelectorAll('.print-turn-wrapper')];
  assert.equal(turns.length,20);
  turns.forEach((turn,i) => {
    assert.match(turn.textContent, new RegExp(`Message ${i}Paragraph`));
    assert.ok(turn.classList.contains(i%2 ? 'print-turn-assistant' : 'print-turn-user'));
  });
  assert.equal(doc.querySelectorAll('math').length,1);
  assert.equal(doc.querySelectorAll('.katex-html').length,0);
  assert.equal(doc.querySelector('[style*="max-height: 19lh"]'),null);
  assert.equal(top,1800);
  dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));
  assert.equal(dom.window.document.querySelector('#chatgpt-pdf-print-root'),null);
  assert.equal(dom.window.document.querySelector('main').style.display,'');
  dom.window.close();
});
test('full script supports reverse virtual scroll without dropping or duplicating turns', async () => {
  const {dom,request,top} = await exportFixture(true);
  const doc = new JSDOM(request.payload.html).window.document;
  assert.equal(doc.querySelectorAll('.print-turn-wrapper').length,20);
  assert.equal(top,0);
  dom.window.close();
});
test('dedicated print document contains conversation, waits for content, and permits repeat printing', async () => {
  const fixture = await exportFixture();
  const dom = new JSDOM(fs.readFileSync(base + 'print.html','utf8'), {url:'https://example.test/print.html?id=00000000-0000-0000-0000-000000000001',runScripts:'outside-only'});
  const w=setup(dom);
  w.chrome = {storage:{session:{async get(key){return {[key]:fixture.request.payload};}}}};
  w.document.fonts = {ready:Promise.resolve()};
  w.HTMLElement.prototype.getBoundingClientRect = () => ({height:100});
  let printed=0;
  w.print=()=>printed++;
  w.eval(fs.readFileSync(base+'print-view.js','utf8'));
  await waitFor(()=>printed===1);
  assert.equal(w.document.querySelectorAll('.print-turn-wrapper').length,20);
  assert.match(w.document.getElementById('message').textContent,/20件/);
  w.document.getElementById('pdf').click();
  assert.equal(printed,2);
  assert.equal(w.document.querySelectorAll('#toolbar').length,1);
  dom.window.close();fixture.dom.window.close();
});
