export type InvocationSource = 'webmcp' | 'remote-mcp' | 'web-ui';

export function sourceFromRequest(request: Request): InvocationSource {
  const value = request.headers.get('x-dialog-source');
  return value === 'webmcp' ? 'webmcp' : 'web-ui';
}
