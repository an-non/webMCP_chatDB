import assert from 'node:assert/strict';
import { DIALOG_TOOL_NAMES } from '../lib/dialog-tools.ts';
import { createWebMcpTools } from '../app/webmcp-adapter.ts';
import { handleRemoteMcp, type RemoteMcpConfig } from '../lib/server/remote-mcp.ts';

const expected = [
  'get_dialog_index_overview','list_suggested_indexes','search_dialog_records','get_dialog_record',
  'save_and_index_dialog_record','update_dialog_record','move_dialog_record_index','delete_dialog_record',
  'get_dialog_index_activity','save_dialog_file_base64','organize_text_with_external_ai',
];
assert.deepEqual([...DIALOG_TOOL_NAMES], expected);

let changed = 0; const invoked: string[] = [];
const webTools = createWebMcpTools(async (name) => { invoked.push(name); return { name }; }, () => { changed += 1; });
assert.deepEqual(webTools.map((tool) => tool.name), expected);
assert.equal(webTools.length, 11);
await webTools[0].execute?.({}); assert.equal(changed, 0);
await webTools[4].execute?.({ title: 'test', content: 'test' }); assert.equal(changed, 1);
assert.deepEqual(invoked, [expected[0], expected[4]]);

const config: RemoteMcpConfig = { token: 'short-lived-test-token', workspaceId: 'test-workspace', allowedOrigins: [] };
const request = (body: unknown, token = config.token) => new Request('https://example.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const invoke = async (name: string) => ({ invoked: name });

const disabled = await handleRemoteMcp(request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), { allowedOrigins: [] }, invoke as any);
assert.equal(disabled.status, 503);
const unauthorized = await handleRemoteMcp(request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ''), config, invoke as any);
assert.equal(unauthorized.status, 401);
const spoofedSiteHeader = new Request('https://example.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': 'spoofed-site-user' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
const spoofedSiteHeaderResponse = await handleRemoteMcp(spoofedSiteHeader, config, invoke as any);
assert.equal(spoofedSiteHeaderResponse.status, 401);
assert.match(spoofedSiteHeaderResponse.headers.get('www-authenticate') ?? '', /^Bearer /);

const disallowedOrigin = new Request('https://example.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}`, origin: 'https://evil.example' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
const disallowedOriginResponse = await handleRemoteMcp(disallowedOrigin, config, invoke as any);
assert.equal(disallowedOriginResponse.status, 403);

const initialized = await handleRemoteMcp(request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'regression', version: '1' } } }), config, invoke as any);
assert.equal(initialized.status, 200);
assert.equal((await initialized.json() as any).result.protocolVersion, '2025-06-18');

const listed = await handleRemoteMcp(request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), config, invoke as any);
assert.equal(listed.status, 200);
assert.deepEqual((await listed.json() as any).result.tools.map((tool: any) => tool.name), expected);

const called = await handleRemoteMcp(request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: expected[0], arguments: {} } }), config, invoke as any);
assert.equal(called.status, 200);
assert.deepEqual((await called.json() as any).result.structuredContent, { invoked: expected[0] });

console.log('MCP regression PASS: 11 WebMCP adapters; Remote MCP static-Bearer fail-closed auth, spoofed-header rejection, origin enforcement, initialize, tools/list, and tools/call.');
