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
        contentRelease: DWProtocol.RELEASE,
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
      const urlChanged = canonicalUrl() !== pageUrl;
      if (urlChanged) {
        pageUrl = canonicalUrl(); candidate = null;
        if (!force) { markHistory(); return { scanStatus: 'page_changed_baseline_reset', forceScan: false, historyReplay: false }; }
      }
      const state = await send('dialog-bridge-state', { pageUrl });
      if (!state.enabled) { candidate = null; markHistory(); setStatus('auto_mode_off'); return {
        scanStatus: 'auto_mode_off', forceScan: force, historyReplay: force,
        runtime: { contentRelease: DWProtocol.RELEASE, backgroundRelease: state.backgroundRelease, manifestVersion: state.manifestVersion },
      }; }
      const jobs = state.jobs || []; const latest = jobs.at(-1) || null;
      if (latest) setStatus(`${latest.state}${latest.recordId ? ` ${latest.recordId}` : ''}${latest.error ? `: ${latest.error}` : ''}`);
      const nodes = DWAdapters.nodes(document, config);
      if (!nodes.length) { setStatus('assistant_dom_not_detected'); return {
        scanStatus: 'assistant_dom_not_detected', forceScan: force, historyReplay: force, assistantNodeCount: 0,
        runtime: { contentRelease: DWProtocol.RELEASE, backgroundRelease: state.backgroundRelease, manifestVersion: state.manifestVersion },
        lastJob: latest,
      }; }

      const runtime = { contentRelease: DWProtocol.RELEASE, backgroundRelease: state.backgroundRelease, manifestVersion: state.manifestVersion,
        reloadRequired: Boolean(state.backgroundRelease && state.backgroundRelease !== DWProtocol.RELEASE) };
      if (runtime.reloadRequired) return { scanStatus: 'TAB_RELOAD_REQUIRED', forceScan: force, historyReplay: force,
        runtime, assistantNodeCount: nodes.length, lastJob: latest };

      const auth = force ? await send('dialog-agent-status').catch(error => ({ paired: false, reason: error.message || String(error) })) : null;
      const candidates = force ? [...nodes].reverse() : [nodes.at(-1)];
      const diagnostics = [];
      let selected = null;

      for (const node of candidates) {
        const text = DWAdapters.text(node);
        const diagnostic = { hasSidecarStart: text.includes(DWProtocol.START), hasSidecarEnd: text.includes(DWProtocol.END), latestAssistantTail: text.slice(-600) };
        diagnostics.push(diagnostic);

        if (!force && baseline.get(node) === text) {
          if (latest && !['verified','completed','blocked','exhausted','verification_failed'].includes(latest.state)) schedule(2000);
          return { scanStatus: 'unchanged', forceScan: false, historyReplay: false, runtime, auth, assistantNodeCount: nodes.length,
            scannedNodeCount: 1, ...diagnostic, parsed: false, lastJob: latest };
        }
        if (DWAdapters.busy(document, config)) { candidate = null; schedule(800); return { scanStatus: 'assistant_busy', forceScan: force,
          historyReplay: force, runtime, auth, assistantNodeCount: nodes.length, scannedNodeCount: diagnostics.length, ...diagnostic, busy: true, lastJob: latest }; }
        if (!force) {
          if (!candidate || candidate.node !== node || candidate.text !== text) {
            candidate = { node, text, since: Date.now() }; schedule(1600); return { scanStatus: 'stabilizing', forceScan: false,
              historyReplay: false, runtime, assistantNodeCount: nodes.length, scannedNodeCount: 1, ...diagnostic, parsed: false, lastJob: latest };
          }
          if (Date.now() - candidate.since < 1500) { schedule(800); return { scanStatus: 'stabilizing', forceScan: false,
            historyReplay: false, runtime, assistantNodeCount: nodes.length, scannedNodeCount: 1, ...diagnostic, parsed: false, lastJob: latest }; }
        }

        let parsed;
        try { parsed = DWProtocol.parseSidecar(text); }
        catch (error) {
          const markerAt = text.lastIndexOf(DWProtocol.START);
          const diagnosticHead = markerAt >= 0 ? text.slice(markerAt, markerAt + 180) : text.slice(-180);
          if (!force) throw error;
          diagnostics[diagnostics.length - 1] = { ...diagnostic, parseError: error.message || String(error),
            diagnosticCodePoints: [...diagnosticHead].slice(0, 120).map(char => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`) };
          continue;
        }
        if (!parsed) {
          if (!force) { baseline.set(node, text); candidate = null; return { scanStatus: 'no_sidecar', forceScan: false, historyReplay: false,
            runtime, assistantNodeCount: nodes.length, scannedNodeCount: 1, ...diagnostic, parsed: false, lastJob: latest }; }
          continue;
        }

        const full = DWProtocol.parseSidecar(DWAdapters.text(node, true));
        if (!full || full.command !== parsed.command) {
          const error = new Error('formatted_sidecar_payload_changed: use a plain-text block or file import');
          if (!force) throw error;
          diagnostics[diagnostics.length - 1] = { ...diagnostic, parseError: error.message };
          continue;
        }

        let expectedJobId = null;
        if (force) {
          const actionKey = parsed.id || DWAdapters.messageId(node) || parsed.command;
          expectedJobId = await DWProtocol.hash(`${location.origin}\0${pageUrl}\0${actionKey}`);
          if (jobs.some(job => job.id === expectedJobId)) continue;
        }
        selected = { node, text, parsed, diagnostic, expectedJobId };
        break;
      }

      if (!selected) {
        if (!force) candidate = null;
        const lastDiagnostic = diagnostics[0] || { hasSidecarStart: false, hasSidecarEnd: false, latestAssistantTail: '' };
        return { scanStatus: force ? 'history_replay_no_unprocessed_sidecar' : 'no_sidecar', forceScan: force, historyReplay: force,
          runtime, auth, assistantNodeCount: nodes.length, scannedNodeCount: diagnostics.length, ...lastDiagnostic,
          parsed: false, lastJob: latest, diagnostics: force ? diagnostics : undefined };
      }

      setStatus('queueing');
      const result = await send('dialog-bridge-enqueue', { command: selected.parsed.command, actionId: selected.parsed.id,
        messageId: DWAdapters.messageId(selected.node), pageTitle: document.title });
      concealSidecar(selected.node);
      baseline.set(selected.node, selected.text); candidate = null; setStatus(result.state); schedule(2000);
      return { scanStatus: 'enqueued', forceScan: force, historyReplay: force, runtime, auth,
        assistantNodeCount: nodes.length, scannedNodeCount: diagnostics.length,
        ...selected.diagnostic, parsed: true, enqueued: true, actionId: selected.parsed.id, state: result.state, lastJob: result };
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
