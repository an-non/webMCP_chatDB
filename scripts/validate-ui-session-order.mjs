import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../public/dialog-index-integration.js', import.meta.url), 'utf8');
const calls = [];

class FakeElement {
  constructor() {
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  appendChild() {}
  insertBefore() {}
  addEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const document = {
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement() { return new FakeElement(); },
};
const windowObject = { addEventListener() {} };
const response = (body, status = 200, headers = {}) => Promise.resolve(new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
}));

const context = vm.createContext({
  console,
  document,
  window: windowObject,
  parent: { postMessage() {} },
  location: { origin: 'https://dialog.example', href: 'https://dialog.example/dialog_index_tank_verified.html' },
  Node: { TEXT_NODE: 3 },
  URL,
  Headers,
  FormData,
  setTimeout,
  clearTimeout,
  fetch: async (input, init = {}) => {
    const path = typeof input === 'string' ? input : input.url;
    calls.push({ path, method: init.method || 'GET' });
    if (path === '/api/session') return response({ ok: true, workspaceId: '11111111-1111-4111-8111-111111111111' }, 200, { 'set-cookie': 'dialog_index_workspace=test' });
    if (path.startsWith('/api/records')) return response({ ok: true, records: [] });
    if (path === '/api/indexes') return response({ ok: true, indexes: [] });
    if (path === '/api/activity') return response({ ok: true, activity: [] });
    if (path === '/api/overview') return response({ ok: true, overview: { records: 0, indexes: 0, needsReview: 0 } });
    if (path === '/api/health') return response({ ok: true, db: { ok: true }, files: { ok: true }, webmcp: { toolCount: 11 }, remoteMcp: { enabled: true, authentication: { configured: true, workspaceConfigured: true, workspaceMatchesSession: true } } });
    return response({ ok: false, error: 'not_found' }, 404);
  },
});

vm.runInContext(code, context, { filename: 'dialog-index-integration.js' });
await new Promise((resolve) => setTimeout(resolve, 50));

assert.equal(calls[0]?.path, '/api/session');
assert.equal(calls[0]?.method, 'POST');
assert.ok(calls.some((call) => call.path.startsWith('/api/records?limit=100')));
assert.ok(calls.some((call) => call.path === '/api/overview'));
assert.ok(calls.some((call) => call.path === '/api/health'));
assert.ok(calls.slice(1).every((call) => call.path !== '/api/session'));

console.log(`UI session-order validation PASS: ${calls.length} requests, session established before all data reads.`);
