import fs from 'node:fs/promises';

const base = (process.env.DIALOG_INDEX_BASE_URL || 'https://dialog-index-mcp.mars-inc-7675.chatgpt.site').replace(/\/$/, '');
const remoteToken = process.env.REMOTE_MCP_BEARER_TOKEN || '';
const writeProbe = process.env.DIALOG_INDEX_WRITE_PROBE === '1';
const outputPath = process.env.DIALOG_INDEX_PROBE_OUTPUT || '';
const report = {
  tool: 'dialog-index-production-probe',
  startedAt: new Date().toISOString(),
  base,
  secretsExported: false,
  writeProbeRequested: writeProbe,
  checks: [],
  summary: { passed: 0, failed: 0, skipped: 0 },
};

let cookie = '';

function add(name, status, detail = {}) {
  report.checks.push({ name, status, ...detail });
  report.summary[status === 'pass' ? 'passed' : status === 'fail' ? 'failed' : 'skipped'] += 1;
}

async function request(path, init = {}, { withCookie = true } = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('accept', headers.get('accept') || 'application/json');
  if (withCookie && cookie) headers.set('cookie', cookie);
  const response = await fetch(`${base}${path}`, { ...init, headers, redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';', 1)[0];
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { response, body };
}

async function mcp(body, token = '') {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return request('/mcp', { method: 'POST', headers, body: JSON.stringify(body) }, { withCookie: false });
}

try {
  const session = await request('/api/session', { method: 'POST' });
  const sessionOk = session.response.ok && typeof session.body?.workspaceId === 'string' && Boolean(cookie);
  add('browser session', sessionOk ? 'pass' : 'fail', {
    httpStatus: session.response.status,
    workspaceId: session.body?.workspaceId || null,
    cookieReceived: Boolean(cookie),
  });

  const health = await request('/api/health');
  const healthBody = health.body || {};
  add('health endpoint', health.response.status === 200 && healthBody.db?.ok && healthBody.files?.ok ? 'pass' : 'fail', {
    httpStatus: health.response.status,
    db: healthBody.db || null,
    files: healthBody.files || null,
    webmcp: healthBody.webmcp || null,
    remoteMcp: healthBody.remoteMcp || null,
  });
  add('WebMCP contract count', healthBody.webmcp?.toolCount === 11 ? 'pass' : 'fail', {
    toolCount: healthBody.webmcp?.toolCount ?? null,
  });

  const [overview, records, indexes, activity] = await Promise.all([
    request('/api/overview'),
    request('/api/records?limit=3'),
    request('/api/indexes'),
    request('/api/activity'),
  ]);
  add('browser API read path', [overview, records, indexes, activity].every((item) => item.response.ok) ? 'pass' : 'fail', {
    overviewStatus: overview.response.status,
    recordsStatus: records.response.status,
    indexesStatus: indexes.response.status,
    activityStatus: activity.response.status,
    overview: overview.body?.overview || null,
    recordsReturned: Array.isArray(records.body?.records) ? records.body.records.length : null,
    indexesReturned: Array.isArray(indexes.body?.indexes) ? indexes.body.indexes.length : null,
    activityReturned: Array.isArray(activity.body?.activity) ? activity.body.activity.length : null,
  });

  const unauth = await mcp({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dialog-index-probe', version: '1' } },
  });
  const unauthExpected = unauth.response.status === 401 || unauth.response.status === 503;
  add('Remote MCP fail-closed without token', unauthExpected ? 'pass' : 'fail', {
    httpStatus: unauth.response.status,
    body: unauth.body,
    wwwAuthenticate: unauth.response.headers.get('www-authenticate'),
  });

  if (remoteToken) {
    const init = await mcp({
      jsonrpc: '2.0', id: 2, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dialog-index-probe', version: '1' } },
    }, remoteToken);
    add('Remote MCP initialize', init.response.ok && init.body?.result?.protocolVersion ? 'pass' : 'fail', {
      httpStatus: init.response.status,
      protocolVersion: init.body?.result?.protocolVersion || null,
      serverInfo: init.body?.result?.serverInfo || null,
    });

    const list = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, remoteToken);
    const toolNames = Array.isArray(list.body?.result?.tools) ? list.body.result.tools.map((tool) => tool.name) : [];
    add('Remote MCP tools/list', list.response.ok && toolNames.length === 11 ? 'pass' : 'fail', {
      httpStatus: list.response.status,
      toolCount: toolNames.length,
      toolNames,
    });

    const overviewCall = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_dialog_index_overview', arguments: {} } }, remoteToken);
    add('Remote MCP read tool call', overviewCall.response.ok && overviewCall.body?.result?.isError === false ? 'pass' : 'fail', {
      httpStatus: overviewCall.response.status,
      structuredContent: overviewCall.body?.result?.structuredContent || null,
    });

    const match = healthBody.remoteMcp?.authentication?.workspaceMatchesSession;
    add('browser/Remote MCP workspace alignment', match === true ? 'pass' : match === false ? 'fail' : 'skip', {
      workspaceMatchesSession: match ?? null,
    });
  } else {
    add('authenticated Remote MCP checks', 'skip', { reason: 'REMOTE_MCP_BEARER_TOKEN was not provided to the local probe process' });
    add('browser/Remote MCP workspace alignment', healthBody.remoteMcp?.authentication?.workspaceMatchesSession === true ? 'pass' : healthBody.remoteMcp?.authentication?.workspaceMatchesSession === false ? 'fail' : 'skip', {
      workspaceMatchesSession: healthBody.remoteMcp?.authentication?.workspaceMatchesSession ?? null,
    });
  }

  if (writeProbe) {
    const marker = `probe-${Date.now()}`;
    const created = await request('/api/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: marker, content: 'Temporary end-to-end connectivity probe. Safe to delete.', suggestedIndex: '/inbox', tags: ['connectivity-probe'], needsReview: true }),
    });
    const id = created.body?.record?.id;
    const found = id ? await request(`/api/records?q=${encodeURIComponent(marker)}&limit=10`) : null;
    const deleted = id ? await request('/api/record', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    }) : null;
    const ok = created.response.ok && id && found?.response.ok && Array.isArray(found.body?.records) && found.body.records.some((record) => record.id === id) && deleted?.response.ok;
    add('browser API write/search/delete round trip', ok ? 'pass' : 'fail', {
      createStatus: created.response.status,
      recordId: id || null,
      searchStatus: found?.response.status ?? null,
      deleteStatus: deleted?.response.status ?? null,
    });
  } else {
    add('browser API write/search/delete round trip', 'skip', { reason: 'Set DIALOG_INDEX_WRITE_PROBE=1 to create and soft-delete one temporary probe record' });
  }
} catch (error) {
  add('probe execution', 'fail', { error: error instanceof Error ? error.message : String(error) });
}

report.finishedAt = new Date().toISOString();
const serialized = JSON.stringify(report, null, 2);
if (outputPath) await fs.writeFile(outputPath, serialized, 'utf8');
console.log(serialized);
if (report.summary.failed > 0) process.exitCode = 1;
