import { DIALOG_TOOL_DEFINITIONS, isDialogToolName, type DialogToolInput, type DialogToolName } from '../dialog-tools.ts';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2025-03-26', '2025-06-18']);

export type RemoteMcpConfig = {
  token?: string;
  workspaceId?: string;
  allowedOrigins: string[];
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
  return Boolean(config.token && config.workspaceId);
}

export function remoteMcpAuthenticated(request: Request, config = getRemoteMcpConfig()) {
  if (!remoteMcpConfigured(config)) return false;
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') && constantTimeEqual(header.slice(7), config.token!);
}

export async function handleRemoteMcp(request: Request, config: RemoteMcpConfig, invoke: RemoteMcpInvoker): Promise<Response> {
  const headers = { 'cache-control': 'no-store' };
  if (!remoteMcpConfigured(config)) return Response.json({ error: 'remote_mcp_not_configured' }, { status: 503, headers });
  if (!originAllowed(request, config)) return Response.json({ error: 'origin_not_allowed' }, { status: 403, headers });
  if (!remoteMcpAuthenticated(request, config)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: { ...headers, 'www-authenticate': 'Bearer realm="Dialog Index Remote MCP"' } });
  }
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
        return jsonRpc(message.id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'dialog-index-mcp', version: '0.3.0' }, instructions: 'Authenticated access to the configured Dialog Index workspace.' });
      }
      case 'ping': return jsonRpc(message.id, {});
      case 'tools/list': return jsonRpc(message.id, { tools: DIALOG_TOOL_DEFINITIONS });
      case 'tools/call': {
        const name = message.params?.name;
        if (!isDialogToolName(name)) return jsonRpc(message.id, undefined, { code: -32602, message: `Unknown tool: ${String(name)}` });
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

function jsonRpc(id: unknown, result?: unknown, error?: { code: number; message: string }, status = 200) {
  return Response.json(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }, { status, headers: { 'cache-control': 'no-store' } });
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
