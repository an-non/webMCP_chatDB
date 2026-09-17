(() => {
  'use strict';
  // Host-page writes are limited to our badge and, after a durable enqueue,
  // safely isolated sidecar blocks. No composer edits, send/stop clicks, fetch
  // interception, normal-answer hiding or feedback turns.
  const HOST_ID = 'dialog-workspace-bridge-host';
  // A previous extension generation can leave its badge in the page after an
  // extension reload. Do not let that stale DOM node suppress this generation.
  document.getElementById(HOST_ID)?.remove();
  const config = DWAdapters.adapter(location.hostname);
  if (!config) return;
  const baseline = new WeakMap();
  let pageUrl = canonicalUrl();
  let timer = null;
  let busyScan = false;
  let candidate = null;
  let statusText = 'starting';
  let stopped = false;
  const host = document.createElement('div'); host.id = HOST_ID;
  Object.assign(host.style, { position: 'fixed', bottom: '12px', right: '12px', zIndex: '2147483647' });
  const shadow = host.attachShadow({ mode: 'open' });
  const badge = document.createElement('button'); badge.type = 'button'; badge.textContent = 'DI';
  badge.title = DWProtocol.RELEASE;
  badge.style.cssText = 'padding:10px;border:1px solid #888;border-radius:8px;background:Canvas;color:CanvasText;cursor:pointer';
  badge.onclick = () => void send('dialog-bridge-open-panel').catch(error => setStatus(error.message));
  shadow.append(badge); document.documentElement.append(host);
  markHistory();
  const observer = new MutationObserver(records => {
    if (records.every(record => host.contains(record.target))) return;
    schedule();
  });
  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'dialog-bridge-page-context') {
      const assistants = DWAdapters.nodes(document, config);
      respond({ ok: true, result: { site: config.site, origin: location.origin, url: canonicalUrl(), title: document.title,
        adapterStatus: assistants.length ? statusText : 'assistant_dom_not_detected',
        selectedText: String(window.getSelection()?.toString() || ''),
        latestUser: document.querySelectorAll(config.users).length ? [...document.querySelectorAll(config.users)].at(-1).textContent : '',
        latestAssistant: assistants.length ? DWAdapters.text(assistants.at(-1)) : '' } });
      return false;
    }
    if (message.type === 'dialog-bridge-auto-scan') {
      scan(true).then(result => respond({ ok: true, result: { status: statusText, historyReplay: true, ...result } })).catch(error => respond({ ok: false, error: error.message }));
      return true;
    }
    return false;
  });
  void send('dialog-agent-status').then(s => setStatus(s.paired ? `paired ${s.workspaceId}` : s.reason || 'not_paired')).catch(e => {
    if (isInvalidatedContext(e)) return shutdown(e.message);
    setStatus(e.message);
  });
  schedule();
  function canonicalUrl() { return location.origin + location.pathname + location.search; }
  function markHistory() { DWAdapters.nodes(document, config).forEach(n => baseline.set(n, DWAdapters.text(n))); }
  function schedule(delay = 800) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void scan().catch(e => {
        if (isInvalidatedContext(e)) return shutdown(e.message);
        setStatus(e.message); schedule(5000);
      });
    }, delay);
  }
  function isInvalidatedContext(error) {
    const message = String(error?.message || error || '');
    return /Extension context invalidated|Receiving end does not exist|No SW/i.test(message);
  }
  function shutdown(reason) {
    stopped = true; clearTimeout(timer); timer = null; candidate = null;
    observer.disconnect();
    statusText = `stopped: ${reason}`;
  }
  function setStatus(text) { statusText = text; badge.title = `${DWProtocol.RELEASE}: ${text}`; badge.textContent = text.startsWith('verified') ? 'DI OK' : 'DI'; }
  async function scan(force = false) {
    if (stopped) return;
    if (busyScan) { schedule(); return; }
    busyScan = true;
    try {
      if (canonicalUrl() !== pageUrl) { pageUrl = canonicalUrl(); candidate = null; markHistory(); return; }
      const state = await send('dialog-bridge-state', { pageUrl });
      if (!state.enabled) { candidate = null; markHistory(); setStatus('auto_mode_off'); return; }
      const jobs = state.jobs || []; const latest = jobs.at(-1);
      if (latest) setStatus(`${latest.state}${latest.recordId ? ` ${latest.recordId}` : ''}${latest.error ? `: ${latest.error}` : ''}`);
      const nodes = DWAdapters.nodes(document, config); const node = nodes.at(-1);
      if (!node) { setStatus('assistant_dom_not_detected'); return; }
      const text = DWAdapters.text(node);
      const diagnostic = { release: DWProtocol.RELEASE, site: config.site, assistantNodeCount: nodes.length, hasSidecarStart: text.includes(DWProtocol.START), hasSidecarEnd: text.includes(DWProtocol.END), latestAssistantTail: text.slice(-600) };
      if (!force && baseline.get(node) === text) { if (latest && !['verified','completed','blocked','exhausted','verification_failed'].includes(latest.state)) schedule(2000); return diagnostic; }
      if (DWAdapters.busy(document, config)) { candidate = null; schedule(800); return { ...diagnostic, busy: true }; }
      if (!force) {
        if (!candidate || candidate.node !== node || candidate.text !== text) {
          candidate = { node, text, since: Date.now() }; schedule(1600); return diagnostic;
        }
        if (Date.now() - candidate.since < 1500) { schedule(800); return diagnostic; }
      }
      const parsed = DWProtocol.parseSidecar(text);
      if (!parsed) { if (!force) baseline.set(node, text); candidate = null; return { ...diagnostic, parsed: false }; }
      // Removing quoted/code examples must never silently shorten a save body.
      const full = DWProtocol.parseSidecar(DWAdapters.text(node, true));
      if (!full || full.command !== parsed.command) throw new Error('formatted_sidecar_payload_changed: use a plain-text block or file import');
      setStatus('queueing');
      const result = await send('dialog-bridge-enqueue', { command: parsed.command, actionId: parsed.id,
        messageId: DWAdapters.messageId(node), pageTitle: document.title });
      // Conceal only a safely isolated sidecar block after durable enqueue succeeds.
      // Never hide a block that also contains normal assistant prose.
      concealSidecar(node);
      // Mark only after durable enqueue succeeds; actual success is in outbox.
      baseline.set(node, text); candidate = null; setStatus(result.state); schedule(2000);
      return { ...diagnostic, parsed: true, enqueued: true, actionId: parsed.id, state: result.state };
    } finally { busyScan = false; }
  }

  function concealSidecar(node) {
    const blocks = [...node.querySelectorAll('p,div,li,section,article')];
    // Single isolated block.
    for (const block of blocks.slice().reverse()) {
      const value = DWProtocol.normalize(block.textContent || '').trim();
      if (!value.startsWith(DWProtocol.START) || !value.endsWith(DWProtocol.END)) continue;
      try {
        if (!DWProtocol.parseSidecar(value)) continue;
        block.style.display = 'none';
        block.setAttribute('data-dialog-workspace-sidecar', 'hidden');
        return true;
      } catch {}
    }
    // Markdown renderers often split the envelope into sibling paragraphs.
    const parents = [...new Set(blocks.map(block => block.parentElement).filter(Boolean))];
    for (const parent of parents) {
      const children = [...parent.children];
      for (let start = 0; start < children.length; start += 1) {
        const first = DWProtocol.normalize(children[start].textContent || '').trim();
        if (!first.startsWith(DWProtocol.START)) continue;
        for (let end = start; end < children.length; end += 1) {
          const last = DWProtocol.normalize(children[end].textContent || '').trim();
          if (!last.endsWith(DWProtocol.END)) continue;
          const range = children.slice(start, end + 1);
          const joined = range.map(child => DWProtocol.normalize(child.textContent || '').trim()).join('\n');
          try {
            if (!DWProtocol.parseSidecar(joined)) break;
            range.forEach(child => {
              child.style.display = 'none';
              child.setAttribute('data-dialog-workspace-sidecar', 'hidden');
            });
            return true;
          } catch { break; }
        }
      }
    }
    return false;
  }

  function send(type, extra = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, pageOrigin: location.origin, ...extra }, response => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response?.ok) return reject(new Error(response?.error || 'bridge_error'));
        resolve(response.result);
      });
    });
  }
})();
