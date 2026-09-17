'use strict';
importScripts('protocol.js', 'outbox.js');
const BASE = 'https://dialog-index-mcp.mars-inc-7675.chatgpt.site';
const SESSION_KEY = 'dialogWorkspaceSessionsV1';
const AUTO_KEY = 'dialogWorkspaceAutoSidecarEnabled';
const LEGACY_TOKEN = 'dialogWorkspaceAgentToken';
const LEGACY_PAIR = 'dialogWorkspacePairingId';
const PAGE_STATUS_KEY = 'dialogWorkspacePageStatusV1';
const ALARM = 'dialog-workspace-outbox';
let sessionLock = Promise.resolve();
const mutateSessions = fn => {
  const result = sessionLock.then(fn, fn); sessionLock = result.catch(() => {}); return result;
};
const queue = DWOutbox.createOutbox({
  storage: chrome.storage.local, status,
  command: (origin, payload) => authed('/api/agent/command', origin, payload),
  get: (origin, id) => authed('/api/agent/execute', origin, { operation: 'record.get', arguments: { id } }),
  notify: async () => {}, // Results are read from the origin-scoped durable outbox.
  schedule: when => chrome.alarms.create(ALARM, { when }),
});
void initialize();
chrome.runtime.onInstalled.addListener(() => { void initialize(); });
chrome.runtime.onStartup.addListener(() => { void initialize(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void drainSafely(); });
chrome.action.onClicked.addListener(tab => { void openPanel(tab?.id); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(result => respond({ ok: true, result }))
    .catch(error => respond({ ok: false, error: error.message || String(error), code: error.code || null }));
  return true;
});
async function initialize() {
  // Credentials and queued data are private to extension pages / the worker.
  await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
  await chrome.alarms.create(ALARM, { delayInMinutes: 0.5 });
}
async function drainSafely() {
  if ((await chrome.storage.local.get(AUTO_KEY))[AUTO_KEY] === false) return;
  try { await queue.drain(); }
  catch (error) {
    await chrome.storage.local.set({ dialogWorkspaceQueueError: error.message || String(error) });
    await chrome.alarms.create(ALARM, { delayInMinutes: 0.5 });
  }
}
async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('invalid_sender');
  const trusted = String(sender.url || '').startsWith(chrome.runtime.getURL(''));
  const senderOrigin = origin(sender.url || sender.tab?.url);
  const pageOrigin = trusted ? origin(message?.pageOrigin) : senderOrigin;
  if (!pageOrigin) throw new Error('unsupported_page_origin');
  if (!trusted && message.pageOrigin && message.pageOrigin !== pageOrigin) throw new Error('origin_mismatch');
  if (!trusted && sender.frameId && sender.frameId !== 0) throw new Error('top_frame_only');
  switch (message.type) {
    case 'dialog-bridge-open-panel': return openPanel(sender.tab?.id ?? message.tabId);
    case 'dialog-agent-status': return status(pageOrigin);
    case 'dialog-bridge-state': {
      const enabled = (await chrome.storage.local.get(AUTO_KEY))[AUTO_KEY] !== false;
      return { enabled, release: DWProtocol.RELEASE, jobs: await queue.list(pageOrigin, message.pageUrl) };
    }
    case 'dialog-bridge-enqueue': {
      if (trusted) throw new Error('enqueue_requires_chat_content_script');
      if ((await chrome.storage.local.get(AUTO_KEY))[AUTO_KEY] === false) throw new Error('auto_mode_disabled');
      const pageUrl = String(sender.url || sender.tab.url).split('#')[0];
      const result = await queue.enqueue({ command: message.command, actionId: message.actionId,
        messageId: message.messageId, origin: pageOrigin, pageUrl, pageTitle: String(message.pageTitle || '').slice(0, 300) });
      await chrome.alarms.create(ALARM, { when: Date.now() + 1000 });
      void drainSafely(); return result;
    }
    case 'dialog-bridge-adapter-status': {
      const stored = (await chrome.storage.local.get(PAGE_STATUS_KEY))[PAGE_STATUS_KEY] || {};
      stored[String(sender.tab?.id)] = { ...message.status, origin: pageOrigin, at: new Date().toISOString() };
      await chrome.storage.local.set({ [PAGE_STATUS_KEY]: stored }); return { recorded: true };
    }
  }
  if (!trusted) throw new Error('operation_requires_extension_panel');
  switch (message.type) {
    case 'dialog-agent-pair': return pair(message.pairingCode, pageOrigin);
    case 'dialog-agent-forget':
      await mutateSessions(async () => {
        const sessions = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY] || {};
        delete sessions[pageOrigin]; await chrome.storage.local.set({ [SESSION_KEY]: sessions });
        if (pageOrigin === 'https://chatgpt.com') await chrome.storage.local.remove([LEGACY_TOKEN, LEGACY_PAIR]);
      });
      return { paired: false, reason: 'local_token_removed_only' };
    case 'dialog-agent-command': return authed('/api/agent/command', pageOrigin, message.payload);
    case 'dialog-agent-execute': return authed('/api/agent/execute', pageOrigin, message.payload);
    case 'dialog-bridge-jobs': return queue.list(pageOrigin);
    case 'dialog-bridge-retry': {
      const job = await queue.retry(message.id, pageOrigin); void drainSafely(); return job;
    }
    case 'dialog-bridge-setup': return { text: DWProtocol.setupText };
    default: throw new Error('unknown_bridge_message');
  }
}
function origin(url) {
  try { const value = new URL(url).origin; return DWProtocol.ORIGINS.includes(value) ? value : ''; } catch { return ''; }
}
async function tokenFor(pageOrigin) {
  const saved = await chrome.storage.local.get([SESSION_KEY, LEGACY_TOKEN, LEGACY_PAIR]);
  if (saved[SESSION_KEY]?.[pageOrigin]?.token) return saved[SESSION_KEY][pageOrigin].token;
  // Legacy v19.x used a single token. Only try it for the original ChatGPT
  // origin; never copy an unverified token into other AI origins.
  if (pageOrigin === 'https://chatgpt.com' && typeof saved[LEGACY_TOKEN] === 'string') return saved[LEGACY_TOKEN];
  return '';
}
async function request(path, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const encoded = JSON.stringify(body ?? {});
    if (DWProtocol.byteLength(encoded) > 1000000) throw Object.assign(new Error('request_too_large'), { retryable: false });
    const response = await fetch(BASE + path, { method: 'POST', cache: 'no-store', redirect: 'error',
      headers: { 'content-type': 'application/json', ...headers }, body: encoded, signal: controller.signal });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || result.ok !== true) {
      throw Object.assign(new Error(result?.error || `HTTP_${response.status}`), {
        code: result?.code, status: response.status,
        retryable: [408, 425, 429, 500, 502, 503, 504].includes(response.status),
      });
    }
    return result;
  } catch (error) {
    if (error.retryable === undefined) error.retryable = true;
    throw error;
  } finally { clearTimeout(timer); }
}
async function authed(path, pageOrigin, payload) {
  const token = await tokenFor(pageOrigin);
  if (!token) throw Object.assign(new Error('local_token_missing'), { retryable: false });
  // A 401 is diagnostic; it does not silently destroy the credential.
  return request(path, payload, { authorization: `Bearer ${token}`, 'x-dialog-agent-page-origin': pageOrigin });
}
async function status(pageOrigin) {
  if (!await tokenFor(pageOrigin)) return { paired: false, reason: 'local_token_missing', pageOrigin };
  try { return await authed('/api/agent/status', pageOrigin, {}); }
  catch (error) {
    if (error.status === 401 || error.status === 403) return { paired: false, reason: 'server_rejected_token', pageOrigin };
    throw error;
  }
}
async function pair(code, pageOrigin) {
  if (typeof code !== 'string' || !code.trim()) throw new Error('pairing_code_required');
  const result = await request('/api/agent/pair', { pairingCode: code.trim(), pageOrigin, clientName: `Dialog Workspace Bridge ${DWProtocol.RELEASE}` });
  if (!result.token) throw new Error('pair_response_missing_token');
  await mutateSessions(async () => {
    const sessions = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY] || {};
    sessions[pageOrigin] = { token: result.token, pairingId: result.pairingId, workspaceId: result.workspaceId };
    await chrome.storage.local.set({ [SESSION_KEY]: sessions });
    if (pageOrigin === 'https://chatgpt.com') await chrome.storage.local.set({ [LEGACY_TOKEN]: result.token, [LEGACY_PAIR]: result.pairingId });
  });
  return { paired: true, pairingId: result.pairingId, workspaceId: result.workspaceId, pageOrigin };
}
async function openPanel(tabId) {
  if (Number.isInteger(tabId) && chrome.sidePanel?.open) {
    try { await chrome.sidePanel.open({ tabId }); return { opened: 'sidePanel' }; } catch {}
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html${Number.isInteger(tabId) ? `?tab=${tabId}` : ''}`) });
  return { opened: 'extension-tab' };
}
