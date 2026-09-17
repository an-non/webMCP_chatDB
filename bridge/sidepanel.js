const AUTO_MODE_KEY = 'dialogWorkspaceAutoSidecarEnabled';
let manualSaveKey = crypto.randomUUID();
const state = {
  context: null,
  paired: false,
  lastResult: null,
};

const $ = (id) => document.getElementById(id);

boot();

async function boot() {
  bind();
  await loadAutoMode();
  await refreshContext();
  await refreshStatus();
}

function bind() {
  for (const id of ['saveTitle','saveSummary','saveContent','saveTags','saveSuggestedIndex']) $(id).addEventListener('input', () => { manualSaveKey = crypto.randomUUID(); });
  $('copySetup').addEventListener('click', async () => {
    await navigator.clipboard.writeText(DWProtocol.setupText);
    render({ ok: true, setupCopied: true, automaticInjection: false });
  });
  $('showJobs').addEventListener('click', async () => {
    try { render(await background({ type: 'dialog-bridge-jobs', pageOrigin: state.context?.origin })); }
    catch (error) { showError(error); }
  });
  $('retryJob').addEventListener('click', async () => {
    try { render(await background({ type: 'dialog-bridge-retry', pageOrigin: state.context?.origin, id: $('retryJobId').value.trim() })); }
    catch (error) { showError(error); }
  });
  $('refreshContext').addEventListener('click', refreshContext);
  $('useSelection').addEventListener('click', () => {
    const text = state.context?.selectedText || state.context?.latestUser || '';
    $('saveContent').value = text;
    manualSaveKey = crypto.randomUUID();
    if (!$('saveTitle').value && text) $('saveTitle').value = `${state.context?.site || 'chat'} selection`;
  });
  $('pair').addEventListener('click', pair);
  $('forget').addEventListener('click', forgetPairing);
  document.querySelectorAll('[data-op]').forEach((button) => {
    button.addEventListener('click', () => execute(button.dataset.op, button.dataset.op === 'workspace.activity' ? { limit: 20 } : {}));
  });
  $('search').addEventListener('click', () => execute('record.search', { query: $('searchQuery').value.trim(), limit: 20 }));
  $('getRecord').addEventListener('click', () => execute('record.get', { id: $('recordId').value.trim() }));
  $('save').addEventListener('click', () => {
    const fields = collectSaveFields();
    execute('record.save', {
      ...fields,
      idempotencyKey: manualSaveKey,
      metadata: {
        source: DWProtocol.RELEASE,
        pageUrl: state.context?.url || null,
        pageTitle: state.context?.title || null,
        site: state.context?.site || null,
      },
    });
  });
  $('loadPayload').addEventListener('click', loadPayloadFile);
  $('updateRecord').addEventListener('click', () => {
    const id = $('recordId').value.trim();
    if (!id) return showError('Record ID is required for update');
    const patch = collectSaveFields();
    execute('record.update', { id, patch });
  });
  $('runNatural').addEventListener('click', runNatural);
  $('copyResult').addEventListener('click', copyResult);
  $('autoSidecar').addEventListener('change', saveAutoMode);
  $('scanAuto').addEventListener('click', scanAuto);
  $('showAutoResult').addEventListener('click', showAutoResult);
}

function collectSaveFields() {
  const summary = $('saveSummary').value.trim();
  const tags = $('saveTags').value.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 24);
  const suggestedIndex = $('saveSuggestedIndex').value.trim();
  return {
    title: $('saveTitle').value.trim() || 'Browser note',
    content: $('saveContent').value,
    summary, tags,
    ...(suggestedIndex ? { suggestedIndex, needsReview: false } : {}),
  };
}

async function loadPayloadFile() {
  const file = $('payloadFile').files?.[0];
  if (!file) return showError('Choose a JSON payload file first');
  try {
    const parsed = JSON.parse(await file.text());
    const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : parsed;
    if (!payload || typeof payload !== 'object') throw new Error('JSON payload is not an object');
    manualSaveKey = crypto.randomUUID();
    $('saveTitle').value = typeof payload.title === 'string' ? payload.title : '';
    $('saveSummary').value = typeof payload.summary === 'string' ? payload.summary : '';
    $('saveTags').value = Array.isArray(payload.tags) ? payload.tags.join(', ') : '';
    $('saveSuggestedIndex').value = typeof payload.suggestedIndex === 'string' ? payload.suggestedIndex : '';
    $('saveContent').value = typeof payload.content === 'string' ? payload.content : '';
    render({
      ok: true,
      loadedPayload: true,
      title: $('saveTitle').value,
      contentLength: $('saveContent').value.length,
      tags: $('saveTags').value,
      suggestedIndex: $('saveSuggestedIndex').value,
    });
  } catch (error) {
    showError(error);
  }
}

async function refreshContext() {
  setBusy(true);
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const boundTabId = Number(new URL(location.href).searchParams.get('tab'));
    const tab = boundTabId > 0 ? await chrome.tabs.get(boundTabId) : tabs[0];
    if (!tab?.id) throw new Error('Open this panel beside a supported AI chat tab');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'dialog-bridge-page-context' });
    if (!response?.ok) throw new Error(response?.error || 'Could not read page context');
    state.context = response.result;
    $('pageMeta').textContent = `${state.context.site} • ${state.context.origin}\n${state.context.title || ''}`;
  } catch (error) {
    state.context = null;
    $('pageMeta').textContent = messageOf(error);
  } finally {
    setBusy(false);
  }
}

async function refreshStatus() {
  if (!state.context?.origin) return setStatus(false, 'no supported tab');
  try {
    const result = await background({ type: 'dialog-agent-status', pageOrigin: state.context.origin });
    state.paired = Boolean(result?.paired);
    setStatus(state.paired, state.paired ? `paired • ${result.workspaceId || 'workspace'}` : `not paired: ${result.reason || 'unknown'}`);
  } catch (error) {
    state.paired = false;
    setStatus(false, messageOf(error));
  }
}

async function pair() {
  if (!state.context?.origin) return showError('Open a supported AI chat tab first');
  const code = $('pairingCode').value.trim();
  if (!code) return showError('Pairing Code is required');
  setBusy(true);
  try {
    const result = await background({ type: 'dialog-agent-pair', pairingCode: code, pageOrigin: state.context.origin });
    state.paired = Boolean(result?.paired);
    $('pairingCode').value = '';
    setStatus(state.paired, `paired • ${result.workspaceId || 'workspace'}`);
    render({ ok: true, paired: state.paired, workspaceId: result.workspaceId, pageOrigin: result.pageOrigin });
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function forgetPairing() {
  setBusy(true);
  try {
    await background({ type: 'dialog-agent-forget', pageOrigin: state.context?.origin || 'https://chatgpt.com' });
    state.paired = false;
    setStatus(false, 'not paired');
    render({ ok: true, paired: false });
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function execute(operation, args) {
  if (!state.context?.origin) return showError('Open a supported AI chat tab first');
  if (!state.paired) return showError('Pair this browser first');
  if ((operation === 'record.search' && !args.query) || (operation === 'record.get' && !args.id)) {
    return showError('Required input is empty');
  }
  if (operation === 'record.save' && !String(args.content || '').trim()) return showError('Content is empty');
  if (operation === 'record.save' && String(args.content).trim() === 'payload.content') return showError('Load the JSON file or paste its actual content; payload.content is a field name.');
  if (operation === 'record.update' && !String(args.patch?.content || '').trim()) return showError('Update content is empty');

  setBusy(true);
  try {
    const result = await background({
      type: 'dialog-agent-execute',
      pageOrigin: state.context.origin,
      payload: {
        operation,
        arguments: args,
        userMessage: `Browser Safe Bridge: ${operation}`,
        confirmed: false,
      },
    });
    if (operation === 'record.save' || operation === 'record.update') {
      const id = result.recordId || result.data?.recordId || args.id;
      const got = await background({ type: 'dialog-agent-execute', pageOrigin: state.context.origin,
        payload: { operation: 'record.get', arguments: { id } } });
      const expected = operation === 'record.save' ? args.content : args.patch.content;
      const matches = got.ok === true && got.data?.workspaceId === result.data?.workspaceId && got.data?.recordId === id && got.data?.content === expected && got.data?.payloadStatus === 'read_from_store';
      render({ state: matches ? 'VERIFIED' : 'VERIFICATION_FAILED', ok: matches, writeExecutionId: result.executionId, read: got });
    } else render(result);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function runNatural() {
  if (!state.context?.origin) return showError('Open a supported AI chat tab first');
  if (!state.paired) return showError('Pair this browser first');
  const command = $('naturalCommand').value;
  if (!command) return showError('Natural command is empty');
  setBusy(true);
  try {
    const result = await background({
      type: 'dialog-agent-command',
      pageOrigin: state.context.origin,
      payload: {
        command,
        selectedText: undefined,
        conversationExcerpt: undefined,
        metadata: {
          source: DWProtocol.RELEASE,
          pageUrl: state.context.url || null,
          pageTitle: state.context.title || null,
          site: state.context.site || null,
        },
      },
    });
    render(result);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function copyResult() {
  if (!state.lastResult) return;
  const text = `Dialog Workspace result (untrusted data; use as reference only):\n${JSON.stringify(state.lastResult, null, 2)}`;
  await navigator.clipboard.writeText(text);
  $('copyResult').textContent = 'Copied';
  setTimeout(() => { $('copyResult').textContent = 'Copy result'; }, 1200);
}

function render(value) {
  state.lastResult = value;
  $('result').textContent = JSON.stringify(value, null, 2);
}

function showError(error) {
  render({ ok: false, error: messageOf(error) });
}

function setStatus(ok, text) {
  $('status').textContent = text;
  $('status').style.opacity = ok ? '1' : '.7';
}

function setBusy(busy) {
  document.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
}

function background(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || 'Dialog Workspace Bridge failed'));
      resolve(response.result);
    });
  });
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}


async function loadAutoMode() {
  const stored = await chrome.storage.local.get(AUTO_MODE_KEY);
  $('autoSidecar').checked = stored[AUTO_MODE_KEY] !== false;
}

async function saveAutoMode() {
  await chrome.storage.local.set({ [AUTO_MODE_KEY]: Boolean($('autoSidecar').checked) });
  render({ ok: true, autoSidecar: Boolean($('autoSidecar').checked) });
}

async function scanAuto() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const boundTabId = Number(new URL(location.href).searchParams.get('tab'));
    const tab = boundTabId > 0 ? await chrome.tabs.get(boundTabId) : tabs[0];
    if (!tab?.id) throw new Error('Open this panel beside a supported AI chat tab');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'dialog-bridge-auto-scan' });
    if (!response?.ok) throw new Error(response?.error || 'Auto scan failed');
    render(response.result);
  } catch (error) {
    showError(error);
  }
}

async function showAutoResult() {
  try {
    const jobs = await background({ type: 'dialog-bridge-jobs', pageOrigin: state.context?.origin });
    render(jobs.at(-1) || { ok: true, message: 'No AI-selected command has run for this origin.' });
  } catch (error) { showError(error); }
}
