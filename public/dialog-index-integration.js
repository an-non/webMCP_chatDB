(() => {
  'use strict';

  const RECORD_LIMIT = 100;
  const SEARCH_DEBOUNCE_MS = 280;
  const state = {
    records: [],
    indexes: [],
    activity: [],
    health: null,
    overview: null,
    session: null,
    selected: null,
    query: '',
    selectedIndex: '',
    webmcp: 'checking',
    indexesExpanded: false,
    error: '',
    loading: false,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const moduleByName = (name) => $$('.mod').find((node) => $('.mod__name', node)?.textContent?.trim() === name);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const ago = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return String(value ?? '');
    const seconds = Math.max(0, (Date.now() - date.valueOf()) / 1000);
    if (seconds < 60) return `${Math.floor(seconds)}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };
  const time = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? String(value ?? '')
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  const shortId = (value) => value ? `${String(value).slice(0, 8)}…` : 'unknown';

  let sessionReady = null;
  let fullRefreshGeneration = 0;
  let recordRefreshGeneration = 0;
  let searchTimer = 0;

  async function fetchJson(path, init = {}, { allowHttpError = false } = {}) {
    const headers = new Headers(init.headers || {});
    headers.set('x-dialog-source', 'web-ui');
    const response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers,
    });
    const data = await response.json().catch(() => ({}));
    const envelopeError = data && typeof data === 'object' && data.ok === false;
    if (!allowHttpError && (!response.ok || envelopeError)) {
      throw new Error(data?.error || `${path} failed (${response.status})`);
    }
    return { response, data };
  }

  async function ensureSession() {
    sessionReady ??= fetchJson('/api/session', { method: 'POST' })
      .then(({ data }) => {
        state.session = data;
        return data;
      })
      .catch((error) => {
        sessionReady = null;
        throw error;
      });
    return sessionReady;
  }

  function buildRecordsUrl() {
    const url = new URL('/api/records', location.origin);
    url.searchParams.set('limit', String(RECORD_LIMIT));
    if (state.query.trim()) url.searchParams.set('q', state.query.trim());
    if (state.selectedIndex) url.searchParams.set('index', state.selectedIndex);
    return `${url.pathname}${url.search}`;
  }

  function renderRecords() {
    const mod = moduleByName('records');
    if (!mod) return;
    const list = state.records;
    const body = $('tbody', mod);
    const total = Number(state.overview?.records ?? list.length);
    const meta = state.loading ? 'loading' : `${list.length}`;
    $('.mod__meta', mod).textContent = meta;

    if (state.error && !list.length) {
      body.innerHTML = '<tr><td class="null wrap" colspan="5">data unavailable</td></tr>';
    } else if (!list.length) {
      body.innerHTML = '<tr><td class="null wrap" colspan="5">no records</td></tr>';
    } else {
      body.innerHTML = list.slice(0, 6).map((record, index) => (
        `<tr data-id="${esc(record.id)}" class="${state.selected?.id === record.id || (!state.selected && index === 0) ? 'on' : ''}">` +
          `<td class="d hide-s">${esc(record.id)}</td>` +
          `<td class="k">${esc(record.title)}</td>` +
          `<td>${esc(record.suggestedIndex)}</td>` +
          `<td class="g hide-m">${esc((record.tags || []).slice(0, 3).join(', ') || '—')}</td>` +
          `<td class="d">${esc(ago(record.updatedAt))}</td>` +
        '</tr>'
      )).join('');
    }

    const filters = [
      state.query.trim() ? `query “${esc(state.query.trim())}”` : '',
      state.selectedIndex ? `index ${esc(state.selectedIndex)}` : '',
    ].filter(Boolean).join(' · ');
    const capped = list.length >= RECORD_LIMIT ? '+' : '';
    $('.rows', mod).innerHTML = state.loading
      ? '(<b>loading</b>)'
      : `(<b>${Math.min(6, list.length)} rows</b> · ${list.length}${capped} returned · ${total} total${filters ? ` · ${filters}` : ''})`;

    $$('tbody tr[data-id]', mod).forEach((row) => row.addEventListener('click', () => {
      state.selected = state.records.find((record) => record.id === row.dataset.id) || null;
      renderRecords();
      renderDetail();
    }));

    if (!state.selected && list[0]) state.selected = list[0];
    if (state.selected && !list.some((record) => record.id === state.selected.id)) state.selected = list[0] || null;
    renderDetail();
  }

  function renderIndexes() {
    const mod = moduleByName('indexes');
    if (!mod) return;
    const shown = state.indexesExpanded ? state.indexes : state.indexes.slice(0, 6);
    $('.mod__meta', mod).textContent = state.loading ? 'loading' : `${state.indexes.length}`;
    const body = $('tbody', mod);

    if (state.error && !state.indexes.length) {
      body.innerHTML = '<tr><td class="null wrap" colspan="3">data unavailable</td></tr>';
    } else if (!shown.length) {
      body.innerHTML = '<tr><td class="null wrap" colspan="3">no indexes</td></tr>';
    } else {
      body.innerHTML = shown.map((item) => (
        `<tr data-index="${esc(item.suggested_index)}" class="${state.selectedIndex === item.suggested_index ? 'on' : ''}">` +
          `<td class="k">${esc(item.suggested_index)}</td>` +
          `<td class="n">${esc(item.count)}</td>` +
          '<td class="d">—</td>' +
        '</tr>'
      )).join('');
    }

    const controls = [];
    if (state.indexes.length > 6) {
      controls.push(`<button type="button" class="inline-action" data-action="toggle-indexes">${state.indexesExpanded ? 'show fewer' : `show ${state.indexes.length - 6} more`}</button>`);
    }
    if (state.selectedIndex) controls.push('<button type="button" class="inline-action" data-action="clear-index">clear filter</button>');
    $('.rows', mod).innerHTML = `(<b>${shown.length} rows</b> · ${Number(state.overview?.records ?? state.records.length)} records total${controls.length ? ` · ${controls.join(' · ')}` : ''})`;

    $$('tbody tr[data-index]', mod).forEach((row) => row.addEventListener('click', () => {
      state.selectedIndex = state.selectedIndex === row.dataset.index ? '' : (row.dataset.index || '');
      void refreshRecords();
      renderIndexes();
    }));
    $('[data-action="toggle-indexes"]', mod)?.addEventListener('click', () => {
      state.indexesExpanded = !state.indexesExpanded;
      renderIndexes();
    });
    $('[data-action="clear-index"]', mod)?.addEventListener('click', () => {
      state.selectedIndex = '';
      void refreshRecords();
      renderIndexes();
    });
  }

  function renderDetail() {
    const mod = moduleByName('detail');
    const record = state.selected;
    if (!mod) return;
    if (!record) {
      $('.mod__meta', mod).textContent = '0 rows';
      $('.q', mod).innerHTML = '<b>sea=#</b> <i>select</i> * <i>from</i> records <i>where</i> id = :selected \\gx';
      $('tbody', mod).innerHTML = '<tr><th scope="row">status</th><td class="null">no record selected</td></tr>';
      return;
    }

    $('.mod__meta', mod).textContent = '1 row';
    $('.q', mod).innerHTML = `<b>sea=#</b> <i>select</i> * <i>from</i> records <i>where</i> id = '${esc(record.id)}' \\gx`;
    const filename = typeof record.metadata?.filename === 'string' ? record.metadata.filename : 'download';
    const values = [
      { key: 'id', value: record.id, cls: 'k' },
      { key: 'title', value: record.title, cls: 'k wrap' },
      { key: 'idx', value: record.suggestedIndex },
      { key: 'source', value: record.recordType },
      { key: 'tags', value: (record.tags || []).join(', ') || '—', cls: 'g' },
      { key: 'body', value: record.content || record.summary || '(no text content)', cls: 'wrap' },
      { key: 'updated', value: new Date(record.updatedAt).toLocaleString(), cls: 'd' },
      { key: 'status', value: record.needsReview ? 'review' : 'stored', cls: 'state' },
    ];
    if (record.fileObjectKey) {
      values.splice(values.length - 2, 0, {
        key: 'file',
        html: `<a class="file-download" href="/api/file?id=${encodeURIComponent(record.id)}" download>${esc(filename)}</a>${record.sizeBytes != null ? ` <span class="d">(${esc(record.sizeBytes)} bytes)</span>` : ''}`,
      });
    }
    $('tbody', mod).innerHTML = values.map((item) => (
      `<tr><th scope="row">${esc(item.key)}</th><td class="${esc(item.cls || '')}">${item.html ?? esc(item.value)}</td></tr>`
    )).join('');
  }

  function renderActivity() {
    const mod = moduleByName('activity');
    if (!mod) return;
    $('.mod__meta', mod).textContent = state.loading ? 'loading' : `${state.activity.length} events`;
    const body = $('tbody', mod);
    if (state.error && !state.activity.length) {
      body.innerHTML = '<tr><td class="null wrap" colspan="4">data unavailable</td></tr>';
    } else if (!state.activity.length) {
      body.innerHTML = '<tr><td class="null wrap" colspan="4">no activity</td></tr>';
    } else {
      body.innerHTML = state.activity.slice(0, 6).map((item) => (
        `<tr><td class="d">${esc(time(`${item.created_at}Z`))}</td>` +
        `<td class="k">${esc(item.actor)}</td>` +
        `<td class="g">${esc(item.tool_name)}</td>` +
        '<td class="state">ok</td></tr>'
      )).join('');
    }
    $('.rows', mod).innerHTML = `(<b>${Math.min(6, state.activity.length)} rows</b> · append-only)`;
  }

  function renderOverview() {
    const count = $$('.counts b');
    const records = state.overview?.records;
    const indexes = state.overview?.indexes;
    if (count[0]) count[0].textContent = Number.isFinite(records) ? String(records) : (state.loading ? '…' : '—');
    if (count[1]) count[1].textContent = Number.isFinite(indexes) ? String(indexes) : (state.loading ? '…' : '—');
    if (count[2]) {
      count[2].textContent = state.health ? (state.health.files?.ok ? '✓' : '×') : (state.loading ? '…' : '—');
      if (count[2].nextSibling) count[2].nextSibling.textContent = 'FILES';
    }
    const counts = $('.counts');
    if (counts) counts.title = state.error || '';
  }

  function renderHealth() {
    const mod = moduleByName('access');
    const health = state.health;
    if (!mod) return;
    $('.mod__meta', mod).textContent = health ? `${health.webmcp?.toolCount ?? 11} tools` : '— tools';
    const cells = $$('tbody tr', mod).map((row) => $('td:last-child', row));
    const auth = health?.remoteMcp?.authentication;
    const remoteReady = Boolean(health?.remoteMcp?.enabled && auth?.configured && auth?.workspaceConfigured);
    const match = auth?.workspaceMatchesSession;
    const remoteState = !health
      ? 'unknown'
      : !remoteReady
        ? 'disabled · fail-closed'
        : match === true
          ? 'ready · same workspace'
          : match === false
            ? 'ready · different workspace'
            : 'ready · workspace unverified';
    const values = [
      state.webmcp === 'checking' ? 'checking' : `${state.webmcp} · ${health?.webmcp?.toolCount ?? 11}`,
      remoteState,
      !health ? 'unknown' : (health.db?.ok ? 'connected' : 'unavailable'),
      !health ? 'unknown' : (health.files?.ok ? 'connected' : 'unavailable'),
    ];
    cells.forEach((cell, index) => {
      if (!cell) return;
      cell.textContent = values[index];
      cell.className = /unavailable|disabled|different|unknown|error/.test(values[index]) ? 'null' : 'state';
    });
    const footer = $('.rows', mod);
    if (footer) {
      const alignment = match === true ? 'workspace aligned' : match === false ? 'workspace mismatch' : 'workspace unverified';
      footer.innerHTML = `(<b>4 rows</b> · session ${esc(shortId(state.session?.workspaceId))} · ${alignment})`;
    }
    const ingest = moduleByName('ingest');
    if (ingest) $('.mod__meta', ingest).textContent = !health ? 'R2 unknown' : (health.files?.ok ? 'R2 ready' : 'R2 unavailable');
    renderOverview();
  }

  function renderRuntimeStatus() {
    let status = $('#dialogRuntimeStatus');
    if (!status) {
      status = document.createElement('span');
      status.id = 'dialogRuntimeStatus';
      status.className = 'runtime-status';
      const line = $('.tank__status');
      if (line) line.insertBefore(status, line.lastElementChild);
    }
    if (!status) return;
    status.textContent = state.loading ? 'loading data' : state.error ? `data error: ${state.error}` : 'data live';
    status.classList.toggle('runtime-status--error', Boolean(state.error));
  }

  function renderAll() {
    renderRecords();
    renderIndexes();
    renderActivity();
    renderHealth();
    renderOverview();
    renderRuntimeStatus();
  }

  async function refreshRecords() {
    const generation = ++recordRefreshGeneration;
    try {
      await ensureSession();
      const { data } = await fetchJson(buildRecordsUrl());
      if (generation !== recordRefreshGeneration) return;
      state.records = Array.isArray(data.records) ? data.records : [];
      state.error = '';
      if (state.selected) state.selected = state.records.find((record) => record.id === state.selected.id) || null;
      renderRecords();
      renderIndexes();
      renderRuntimeStatus();
    } catch (error) {
      if (generation !== recordRefreshGeneration) return;
      state.records = [];
      state.selected = null;
      state.error = error instanceof Error ? error.message : 'record search failed';
      renderRecords();
      renderDetail();
      renderRuntimeStatus();
    }
  }

  async function refresh() {
    const generation = ++fullRefreshGeneration;
    recordRefreshGeneration += 1;
    state.loading = true;
    state.error = '';
    renderAll();

    try {
      await ensureSession();
      const requests = await Promise.allSettled([
        fetchJson(buildRecordsUrl()),
        fetchJson('/api/indexes'),
        fetchJson('/api/activity'),
        fetchJson('/api/health', {}, { allowHttpError: true }),
        fetchJson('/api/overview'),
      ]);
      if (generation !== fullRefreshGeneration) return;

      const errors = [];
      const [records, indexes, activity, health, overview] = requests;
      if (records.status === 'fulfilled') state.records = Array.isArray(records.value.data.records) ? records.value.data.records : [];
      else { state.records = []; errors.push(`records: ${records.reason?.message || 'failed'}`); }
      if (indexes.status === 'fulfilled') state.indexes = Array.isArray(indexes.value.data.indexes) ? indexes.value.data.indexes : [];
      else { state.indexes = []; errors.push(`indexes: ${indexes.reason?.message || 'failed'}`); }
      if (activity.status === 'fulfilled') state.activity = Array.isArray(activity.value.data.activity) ? activity.value.data.activity : [];
      else { state.activity = []; errors.push(`activity: ${activity.reason?.message || 'failed'}`); }
      if (health.status === 'fulfilled') {
        state.health = health.value.data;
        if (!health.value.response.ok) errors.push(`health: HTTP ${health.value.response.status}`);
      } else { state.health = null; errors.push(`health: ${health.reason?.message || 'failed'}`); }
      if (overview.status === 'fulfilled') state.overview = overview.value.data.overview || null;
      else { state.overview = null; errors.push(`overview: ${overview.reason?.message || 'failed'}`); }

      state.error = errors.join(' · ');
      if (state.selected) state.selected = state.records.find((record) => record.id === state.selected.id) || null;
    } catch (error) {
      if (generation !== fullRefreshGeneration) return;
      state.records = [];
      state.indexes = [];
      state.activity = [];
      state.health = null;
      state.overview = null;
      state.selected = null;
      state.error = error instanceof Error ? error.message : 'refresh failed';
    } finally {
      if (generation === fullRefreshGeneration) {
        state.loading = false;
        renderAll();
      }
    }
  }

  function scheduleSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { void refreshRecords(); }, SEARCH_DEBOUNCE_MS);
  }

  function setQuery(value, immediate = true) {
    state.query = value;
    const prompt = $('.prompt');
    const text = prompt?.querySelector('[data-search-value]');
    if (text) text.textContent = value || 'search records, content, tags';
    if (immediate) void refreshRecords(); else scheduleSearch();
  }

  function wireSearch() {
    const prompt = $('.prompt');
    if (!prompt || prompt.dataset.wired) return;
    prompt.dataset.wired = 'true';
    const caret = $('.caret', prompt);
    const text = document.createElement('span');
    text.dataset.searchValue = '';
    text.className = 'search-value';
    text.contentEditable = 'true';
    text.role = 'searchbox';
    text.ariaLabel = 'Search records';
    text.spellcheck = false;
    text.textContent = 'search records, content, tags';
    prompt.insertBefore(text, caret);
    [...prompt.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('search records'))
      .forEach((node) => node.remove());
    text.addEventListener('input', () => {
      state.query = text.textContent === 'search records, content, tags' ? '' : (text.textContent || '').replace(/\n/g, ' ');
      scheduleSearch();
    });
    text.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        clearTimeout(searchTimer);
        void refreshRecords();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        state.selectedIndex = '';
        setQuery('', true);
        renderIndexes();
        text.blur();
      }
    });
    text.addEventListener('focus', () => { if (!state.query) text.textContent = ''; });
    text.addEventListener('blur', () => { if (!state.query) text.textContent = 'search records, content, tags'; });
  }

  function wireUpload() {
    const mod = moduleByName('ingest');
    if (!mod || mod.dataset.wired) return;
    mod.dataset.wired = 'true';
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    input.addEventListener('change', () => input.files?.[0] && void upload(input.files[0]));
    mod.appendChild(input);
    const note = $('.rows', mod);
    if (note) {
      note.tabIndex = 0;
      note.role = 'button';
      note.title = 'Select a file to upload';
      note.addEventListener('click', () => input.click());
      note.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          input.click();
        }
      });
    }
    mod.addEventListener('dragover', (event) => event.preventDefault());
    mod.addEventListener('drop', (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file) void upload(file);
    });
  }

  async function upload(file) {
    try {
      await ensureSession();
      const form = new FormData();
      form.set('file', file);
      form.set('title', file.name);
      if (state.selectedIndex) form.set('suggestedIndex', state.selectedIndex);
      await fetchJson('/api/upload', { method: 'POST', body: form });
      await refresh();
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'upload failed';
      renderRuntimeStatus();
    }
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === 'dialog-index:refresh') void refresh();
    if (event.data?.type === 'dialog-index:webmcp') {
      state.webmcp = event.data.status;
      renderHealth();
      renderRuntimeStatus();
    }
  });

  wireSearch();
  wireUpload();
  renderAll();
  void refresh();
  parent.postMessage({ type: 'dialog-index:ui-ready' }, location.origin);
})();
