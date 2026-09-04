import { DIALOG_TOOL_DEFINITIONS, isDialogToolName, type DialogToolInput, type DialogToolName } from '../dialog-tools.ts';
import { getOAuthRuntimeConfig, oauthRuntimeConfigured, verifyOAuthAccessToken } from './oauth';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-03-26', '2025-06-18']);

export type RemoteMcpConfig = {
  token?: string;
  workspaceId?: string;
  allowedOrigins: string[];
};

type RemoteMcpAuth = {
  kind: 'static-bearer' | 'oauth';
  workspaceId: string;
  scopes: string[];
  subject?: string;
};

export type RemoteMcpInvoker = (name: DialogToolName, input: DialogToolInput) => Promise<unknown>;

export function getRemoteMcpConfig(): RemoteMcpConfig {
  return {
    token: value('REMOTE_MCP_BEARER_TOKEN'),
    workspaceId: value('REMOTE_MCP_WORKSPACE_ID'),
    allowedOrigins: (value('REMOTE_MCP_ALLOWED_ORIGINS') ?? '').split(',').map((item) => item.trim()).filter(Boolean),
  };
}

export function remoteMcpConfigured(config = getRemoteMcpConfig()) {
  return Boolean(config.workspaceId && (config.token || oauthRuntimeConfigured()));
}

export function remoteMcpAuthenticated(request: Request, config = getRemoteMcpConfig()) {
  if (!config.token || !config.workspaceId) return false;
  const token = bearerToken(request);
  return Boolean(token && constantTimeEqual(token, config.token));
}

export async function handleRemoteMcp(request: Request, config: RemoteMcpConfig, invoke: RemoteMcpInvoker): Promise<Response> {
  const headers = { 'cache-control': 'no-store' };
  if (!remoteMcpConfigured(config)) return Response.json({ error: 'remote_mcp_not_configured' }, { status: 503, headers });
  if (!originAllowed(request, config)) return Response.json({ error: 'origin_not_allowed' }, { status: 403, headers });

  const auth = await authenticateRemoteMcp(request, config);
  if (!auth) return unauthorized(request);

  if (request.method === 'GET' || request.method === 'DELETE') return new Response(null, { status: 405, headers: { ...headers, allow: 'POST' } });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, allow: 'POST' } });

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return Response.json({ error: 'content_type_must_be_application_json' }, { status: 415, headers });
  let message: any;
  try { message = await request.json(); }
  catch { return jsonRpc(null, undefined, { code: -32700, message: 'Parse error' }, 400); }
  if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return jsonRpc(message?.id ?? null, undefined, { code: -32600, message: 'Invalid Request' }, 400);
  }
  if (message.id === undefined) return new Response(null, { status: 202, headers });

  try {
    switch (message.method) {
      case 'initialize': {
        const requested = typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : MCP_PROTOCOL_VERSION;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : MCP_PROTOCOL_VERSION;
        return jsonRpc(message.id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'dialog-index-mcp', version: '0.5.0' },
          instructions: 'Authenticated access to the configured Dialog Index workspace. Use search before asking the user for a logical path.',
        });
      }
      case 'ping': return jsonRpc(message.id, {});
      case 'tools/list': return jsonRpc(message.id, { tools: remoteToolDefinitions() });
      case 'tools/call': {
        const name = message.params?.name;
        if (!isDialogToolName(name)) return jsonRpc(message.id, undefined, { code: -32602, message: `Unknown tool: ${String(name)}` });
        const required = requiredScope(name);
        if (auth.kind === 'oauth' && !auth.scopes.includes(required)) {
          const challenge = oauthChallenge(request, required);
          return jsonRpc(message.id, {
            content: [{ type: 'text', text: `OAuth scope ${required} is required.` }],
            isError: true,
            _meta: { 'mcp/www_authenticate': challenge },
          });
        }
        const args = message.params?.arguments;
        const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
        try {
          const result = await invoke(name, input);
          return jsonRpc(message.id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false });
        } catch (error) {
          const messageText = error instanceof Error ? error.message : 'tool_execution_failed';
          return jsonRpc(message.id, { content: [{ type: 'text', text: messageText }], isError: true });
        }
      }
      default: return jsonRpc(message.id, undefined, { code: -32601, message: 'Method not found' });
    }
  } catch (error) {
    return jsonRpc(message.id, undefined, { code: -32603, message: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

async function authenticateRemoteMcp(request: Request, config: RemoteMcpConfig): Promise<RemoteMcpAuth | null> {
  const token = bearerToken(request);
  if (!token || !config.workspaceId) return null;
  if (config.token && constantTimeEqual(token, config.token)) {
    return { kind: 'static-bearer', workspaceId: config.workspaceId, scopes: ['dialog.read', 'dialog.write', 'offline_access'] };
  }
  const oauth = getOAuthRuntimeConfig();
  if (!oauthRuntimeConfigured(oauth) || !oauth.signingSecret) return null;
  const access = await verifyOAuthAccessToken(token, request, oauth.signingSecret, config.workspaceId);
  if (!access) return null;
  return { kind: 'oauth', workspaceId: access.workspaceId, scopes: access.scopes, subject: access.subject };
}

function remoteToolDefinitions() {
  return DIALOG_TOOL_DEFINITIONS.map((definition) => ({
    ...definition,
    securitySchemes: [{ type: 'oauth2', scopes: [requiredScope(definition.name)] }],
  }));
}

function requiredScope(name: DialogToolName) {
  const definition = DIALOG_TOOL_DEFINITIONS.find((item) => item.name === name);
  return definition?.annotations?.readOnlyHint ? 'dialog.read' : 'dialog.write';
}

function unauthorized(request: Request) {
  return Response.json({ error: 'unauthorized' }, {
    status: 401,
    headers: {
      'cache-control': 'no-store',
      'www-authenticate': oauthChallenge(request, 'dialog.read dialog.write'),
    },
  });
}

function oauthChallenge(request: Request, scope: string) {
  const origin = new URL(request.url).origin;
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="${scope}"`;
}

function jsonRpc(id: unknown, result?: unknown, error?: { code: number; message: string }, status = 200) {
  return Response.json(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }, { status, headers: { 'cache-control': 'no-store' } });
}

function bearerToken(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function originAllowed(request: Request, config: RemoteMcpConfig) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const ownOrigin = new URL(request.url).origin;
  return origin === ownOrigin || config.allowedOrigins.includes(origin);
}

function constantTimeEqual(left: string, right: string) {
  const max = Math.max(left.length, right.length); let difference = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

function value(name: string) { return process.env[name]?.trim() || undefined; }
