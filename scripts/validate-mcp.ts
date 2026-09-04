import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { DIALOG_TOOL_NAMES } from '../lib/dialog-tools.ts';
import { createWebMcpTools } from '../app/webmcp-adapter.ts';
import { handleRemoteMcp, type RemoteMcpConfig } from '../lib/server/remote-mcp.ts';
import {
  issueAuthorizationCode,
  issueRegisteredClient,
  redeemAuthorizationCode,
  verifyOAuthAccessToken,
  verifyRegisteredClient,
} from '../lib/server/oauth.ts';

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
assert.match(unauthorized.headers.get('www-authenticate') ?? '', /resource_metadata="https:\/\/example\.test\/\.well-known\/oauth-protected-resource"/);
const spoofedSiteHeader = new Request('https://example.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'oai-authenticated-user-id': 'spoofed-site-user' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
const spoofedSiteHeaderResponse = await handleRemoteMcp(spoofedSiteHeader, config, invoke as any);
assert.equal(spoofedSiteHeaderResponse.status, 401);

const disallowedOrigin = new Request('https://example.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}`, origin: 'https://evil.example' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
const disallowedOriginResponse = await handleRemoteMcp(disallowedOrigin, config, invoke as any);
assert.equal(disallowedOriginResponse.status, 403);

const initialized = await handleRemoteMcp(request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'regression', version: '1' } } }), config, invoke as any);
assert.equal(initialized.status, 200);
assert.equal((await initialized.json() as any).result.protocolVersion, '2025-06-18');

const listed = await handleRemoteMcp(request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), config, invoke as any);
assert.equal(listed.status, 200);
const listedTools = (await listed.json() as any).result.tools;
assert.deepEqual(listedTools.map((tool: any) => tool.name), expected);
assert.equal(listedTools[0].securitySchemes[0].type, 'oauth2');
assert.deepEqual(listedTools[0].securitySchemes[0].scopes, ['dialog.read']);
assert.deepEqual(listedTools[4].securitySchemes[0].scopes, ['dialog.write']);

const called = await handleRemoteMcp(request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: expected[0], arguments: {} } }), config, invoke as any);
assert.equal(called.status, 200);
assert.deepEqual((await called.json() as any).result.structuredContent, { invoked: expected[0] });

// OAuth 2.1 + PKCE regression. No real credentials or network calls are used.
const oldOAuthSecret = process.env.REMOTE_MCP_OAUTH_SIGNING_SECRET;
const oldWorkspace = process.env.REMOTE_MCP_WORKSPACE_ID;
const oldStaticToken = process.env.REMOTE_MCP_BEARER_TOKEN;
process.env.REMOTE_MCP_OAUTH_SIGNING_SECRET = 'regression-only-oauth-secret-please-never-use-in-production';
process.env.REMOTE_MCP_WORKSPACE_ID = 'oauth-test-workspace';
delete process.env.REMOTE_MCP_BEARER_TOKEN;

try {
  const oauthSecret = process.env.REMOTE_MCP_OAUTH_SIGNING_SECRET;
  const redirectUri = 'https://chatgpt.example/callback';
  const clientId = await issueRegisteredClient({ redirectUris: [redirectUri], clientName: 'Regression Client' }, oauthSecret);
  const client = await verifyRegisteredClient(clientId, oauthSecret);
  assert.ok(client);
  assert.deepEqual(client.redirectUris, [redirectUri]);

  const codeVerifier = base64url(randomBytes(48));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  const code = await issueAuthorizationCode({
    clientId,
    redirectUri,
    codeChallenge,
    resource: 'https://example.test/mcp',
    scope: 'dialog.read dialog.write offline_access',
    workspaceId: 'oauth-test-workspace',
    subject: 'regression-subject',
  }, oauthSecret);

  const consumed = new Set<string>();
  const tokens = await redeemAuthorizationCode({
    code,
    clientId,
    redirectUri,
    codeVerifier,
    resource: 'https://example.test/mcp',
    issuer: 'https://example.test',
    consumeNonce: async (nonce, workspaceId) => {
      assert.equal(workspaceId, 'oauth-test-workspace');
      if (consumed.has(nonce)) return false;
      consumed.add(nonce);
      return true;
    },
  }, oauthSecret) as any;
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(typeof tokens.access_token, 'string');
  assert.equal(typeof tokens.refresh_token, 'string');

  const access = await verifyOAuthAccessToken(tokens.access_token, new Request('https://example.test/mcp'), oauthSecret, 'oauth-test-workspace');
  assert.ok(access);
  assert.equal(access.subject, 'regression-subject');
  assert.deepEqual(access.scopes, ['dialog.read', 'dialog.write', 'offline_access']);

  const oauthConfig: RemoteMcpConfig = { workspaceId: 'oauth-test-workspace', allowedOrigins: [] };
  const oauthListRequest = new Request('https://example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.access_token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }),
  });
  const oauthListResponse = await handleRemoteMcp(oauthListRequest, oauthConfig, invoke as any);
  assert.equal(oauthListResponse.status, 200);
  assert.equal((await oauthListResponse.json() as any).result.tools.length, 11);
} finally {
  restoreEnv('REMOTE_MCP_OAUTH_SIGNING_SECRET', oldOAuthSecret);
  restoreEnv('REMOTE_MCP_WORKSPACE_ID', oldWorkspace);
  restoreEnv('REMOTE_MCP_BEARER_TOKEN', oldStaticToken);
}

console.log('MCP regression PASS: 11 WebMCP tools; Remote MCP static Bearer; OAuth 2.1 PKCE token issuance/verification; protected-resource challenge; scope metadata; initialize/tools/list/tools/call.');

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function base64url(value: Uint8Array) {
  return Buffer.from(value).toString('base64url');
}
