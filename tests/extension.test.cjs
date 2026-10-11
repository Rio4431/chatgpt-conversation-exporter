const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const base = require('node:path').resolve(__dirname, '..') + '/';
const source = fs.readFileSync(base + 'print-chat.js', 'utf8');
function service({ failure = false } = {}) {
  let listener, removed;
  const store = {}, tabs = [];
  const chrome = {
    runtime: { id: 'extension', getURL: path => 'chrome-extension://extension/' + path, onMessage: { addListener: fn => listener = fn } },
    action: { onClicked: { addListener() {} } }, scripting: {},
    storage: { session: {
      async set(values) { Object.assign(store, values); },
      async get(key) { return { [key]: store[key] }; },
      async remove(keys) { for (const key of [keys].flat()) delete store[key]; }
    } },
    tabs: { async create(tab) { if (failure) throw Error('tabs failure'); tabs.push(tab); return { id: tabs.length }; }, onRemoved: { addListener: fn => removed = fn } }
  };
  vm.runInNewContext(fs.readFileSync(base + 'background.js', 'utf8'), { chrome, crypto, console });
  return { store, tabs, removed: (...args) => removed(...args), send: (payload, url = 'https://chatgpt.com/c/test') => new Promise(resolve => {
    assert.equal(listener({ type: 'OPEN_PRINT_TAB', payload }, { id: 'extension', tab: { url } }, resolve), /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url) ? true : undefined);
  }) };
}
const payload = { title: 'Conversation', html: '<div>Prompt and answer</div>', css: 'body{color:black}' };
test('dedicated extension tab receives exact conversation and cleans up after closing', async () => {
  const api = service();
  assert.equal((await api.send(payload)).ok, true);
  assert.match(api.tabs[0].url, /^chrome-extension:\/\/extension\/print.html\?id=/);
  const key = api.store['pdf-tab-1'];
  assert.deepEqual(api.store[key], payload);
  await api.removed(1);
  assert.equal(Object.keys(api.store).length, 0);
});
test('simultaneous exports use different tokens and preserve each conversation', async () => {
  const api = service();
  await Promise.all([api.send(payload), api.send({ ...payload, title: 'Other' })]);
  assert.notEqual(api.tabs[0].url, api.tabs[1].url);
  assert.equal(Object.keys(api.store).filter(key => key.startsWith('pdf-job-')).length, 2);
});
test('tab failure removes temporary conversation; unsupported sender is rejected', async () => {
  const api = service({ failure: true });
  assert.equal((await api.send(payload)).ok, false);
  assert.equal(Object.keys(api.store).length, 0);
  assert.equal((await api.send(payload, 'https://example.com/')).ok, false);
});
const scanCode = source.slice(source.indexOf('    // DOMに2件以上'), source.indexOf('    // 最終回収'));
async function scan(reverse = false, max = 200) {
  let top = reverse ? 0 : 1000;
  const seen = new Set();
  const context = {
    MAX_SCAN_ITERATIONS: max, statusEl: {}, collectedOrder: [], updateStatus() {}, sleep: async () => {}, nextPaint: async () => {},
    scroller: { isReverse: reverse, getTop: () => top, getMaxTop: () => 1000, getViewport: () => 200, setTop: val => top = Math.max(reverse ? -1000 : 0, Math.min(reverse ? 0 : 1000, val)) },
    harvestCurrentView() {
      const position = Math.round((reverse ? top + 1000 : top) / 100);
      for (let i = Math.max(0, position - 1); i <= Math.min(10, position + 1); i++) seen.add(i);
    }
  };
  await vm.runInNewContext('(async () => {' + scanCode + '})()', context);
  return { seen: [...seen].sort((a,b) => a-b), top };
}
test('normal virtual scroll collects earlier and final turns even when latest pair exists', async () => {
  const result = await scan();
  assert.deepEqual(result.seen, Array.from({ length: 11 }, (_, i) => i));
  assert.equal(result.top, 1000);
});
test('reverse virtual scroll visits negative positions and restores original scroll', async () => {
  const result = await scan(true);
  assert.deepEqual(result.seen, Array.from({ length: 11 }, (_, i) => i));
  assert.equal(result.top, 0);
});
test('scan limit fails explicitly instead of reporting complete conversation', async () => {
  await assert.rejects(scan(false, 2), /走査上限/);
});
test('PDF action in source page never prints the ChatGPT document', () => {
  assert.equal(source.includes('window.print('), false);
  const manifest = JSON.parse(fs.readFileSync(base + 'manifest.json', 'utf8'));
  assert.equal(manifest.version, '1.0');
  assert.ok(manifest.permissions.includes('storage'));
  for (const file of ['print.html','print-view.js','print-view.css']) assert.ok(fs.existsSync(base + file));
});
